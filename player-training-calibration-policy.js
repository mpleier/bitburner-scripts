import {combatXpValue} from './combat-growth-policy.js';
const stats=['strength','defense','dexterity','agility'];
const finiteXp=x=>stats.every(k=>Number.isFinite(x?.[k])&&x[k]>=0);
/** A healthy, fully synchronized receiver observes the same sleeve XP transfers as the player. */
export function captureTrainingBackground(ns){
 try{
  const count=ns.sleeve.getNumSleeves();
  if(!Number.isSafeInteger(count)||count<0||count>8)return null;
  if(count===0)return {count,observers:[]};
  const observers=[];
  for(let i=0;i<count;i++){const s=ns.sleeve.getSleeve(i);if(s.shock===0&&s.sync===100&&finiteXp(s.exp))observers.push({i,exp:Object.fromEntries(stats.map(k=>[k,s.exp[k]]))});}
  return observers.length>=2?{count,observers}:null;
 }catch{return null;}
}
export function trainingBackgroundDelta(before,after){
 const valid=s=>s&&Number.isSafeInteger(s.count)&&s.count>=0&&s.count<=8&&Array.isArray(s.observers)&&s.observers.length<=s.count&&new Set(s.observers.map(o=>o?.i)).size===s.observers.length&&s.observers.every(o=>Number.isSafeInteger(o?.i)&&o.i>=0&&o.i<s.count&&finiteXp(o.exp));
 if(!valid(before)||!valid(after)||before.count!==after.count)return null;
 if(before.count===0)return Object.fromEntries(stats.map(k=>[k,0]));
 const deltas=before.observers.map(a=>{const b=after.observers.find(b=>b.i===a.i);if(!b||!finiteXp(a.exp)||!finiteXp(b.exp))return null;const d=Object.fromEntries(stats.map(k=>[k,b.exp[k]-a.exp[k]]));return finiteXp(d)?d:null;}).filter(Boolean);
 if(deltas.length<2)return null;
 // Disagreement can indicate a reset or an observer losing eligibility between samples.
 if(stats.some(k=>Math.max(...deltas.map(d=>d[k]))-Math.min(...deltas.map(d=>d[k]))>Math.max(1e-6,Math.max(...deltas.map(d=>d[k]))*1e-8)))return null;
 return Object.fromEntries(stats.map(k=>[k,Math.max(...deltas.map(d=>d[k]))]));
}
export function playerTrainingScope(player,input){
 return JSON.stringify([input.nodeReset,input.augReset,input.parent,input.target,player.city,Object.entries(player.mults||{}).sort(([a],[b])=>a.localeCompare(b))]);
}
const quoteKey=q=>JSON.stringify([q.kind,q.name,q.gym??null,q.city,stats.map(k=>q.modelRates?.[k]??q.rates?.[k]??0)]);
function validSamples(saved,scope,now){
 if(!Array.isArray(saved?.samples)||saved.samples.length>48)return [];
 return saved.samples.filter(s=>s?.scope===scope&&typeof s.id==='string'&&typeof s.key==='string'&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=600000&&Number.isFinite(s.seconds)&&s.seconds>=15&&s.seconds<=31&&finiteXp(s.model)&&finiteXp(s.net)&&stats.every(k=>s.net[k]<=s.model[k])).slice(-48);
}
/** Downward-only calibration: unknown or interrupted background never becomes a zero estimate. */
export function recordPlayerTrainingCalibration(saved,session){
 const {scope,at,id,choice,before,after,background,nativeUpper,elapsedMs,reason,stable}=session;
 const samples=validSamples(saved,scope,at),result={schemaVersion:1,samples};
 if(reason!=='completed'||!stable||typeof id!=='string'||!Number.isFinite(at)||!Number.isFinite(elapsedMs)||elapsedMs<15000||elapsedMs>31000||!Number.isFinite(choice?.durationMs)||elapsedMs<choice.durationMs||elapsedMs>choice.durationMs+1000||!finiteXp(before)||!finiteXp(after)||!finiteXp(background)||!finiteXp(nativeUpper))return result;
 const rates=Object.fromEntries(stats.map(k=>[k,choice.modelRates?.[k]??choice.rates?.[k]??0]));
 if(!finiteXp(rates)||samples.some(s=>s.id===id)||stats.some(k=>after[k]<before[k]))return result;
 const seconds=elapsedMs/1000,model=Object.fromEntries(stats.map(k=>[k,rates[k]*seconds]));
 const net=Object.fromEntries(stats.map(k=>[k,Math.min(model[k],Math.max(0,after[k]-before[k]-background[k]-nativeUpper[k]))]));
 return {...result,samples:[...samples,{id,scope,at,key:quoteKey(choice),seconds,model,net}].slice(-48)};
}
export function calibratePlayerTrainingQuotes(quotes,saved,scope,now,context){
 const samples=validSamples(saved,scope,now);
 return quotes.map(q=>{
  const rows=[...new Map(samples.filter(s=>s.key===quoteKey(q)).map(s=>[s.id,s])).values()];
  if(rows.length<3||rows.reduce((s,r)=>s+r.seconds,0)<60)return q;
  const factors=stats.filter(k=>q.rates?.[k]>0).map(k=>rows.reduce((n,r)=>n+r.net[k],0)/rows.reduce((n,r)=>n+r.model[k],0));
  if(!factors.length||!factors.every(Number.isFinite))return q;
  const factor=Math.min(1,...factors),rates=Object.fromEntries(Object.entries(q.rates).map(([k,v])=>[k,v*factor]));
  return {...q,modelRates:q.rates,rates,score:Math.min(q.score,combatXpValue(rates,context)),calibration:{factor,samples:rows.length,seconds:rows.reduce((s,r)=>s+r.seconds,0)}};
 });
}

/** Take player and sleeve endpoints in one synchronous turn; other player work is not attributable to Training. */
export function captureNativeTrainingObservation(ns,training){
 const observation={player:ns.getPlayer(),background:null,workIdle:false,clock:null};
 if(!training)return observation;
 try{
  const action=ns.bladeburner.getCurrentAction();
  if(action?.type!=='General'||action.name!=='Training'||ns.singularity.getCurrentWork())return observation;
  observation.workIdle=true;observation.background=captureTrainingBackground(ns);
  const progress=ns.bladeburner.getActionCurrentTime(),duration=ns.bladeburner.getActionTime('General','Training');
  if(Number.isFinite(progress)&&progress>=0&&Number.isFinite(duration)&&duration>0&&progress<=duration)observation.clock={progress,duration};
 }catch{}
 return observation;
}
