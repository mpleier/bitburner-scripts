import {isScriptPaused} from './automation-control.js';
export const wksAugmentation='SoA - phyzical WKS harmonizer';
/** WKS has broad reward/survival benefits; other puzzle aids retain price ordering. */
export function rankSoAAugmentations(items,owned,rep){
 const have=new Set(owned);
 return items.filter(a=>typeof a?.name==='string'&&!have.has(a.name)&&Array.isArray(a.prerequisites)&&a.prerequisites.every(p=>have.has(p))&&Number.isFinite(a.rep)&&a.rep>=0&&a.rep<=rep&&Number.isFinite(a.price)&&a.price>=0)
  .sort((a,b)=>Number(b.name===wksAugmentation)-Number(a.name===wksAugmentation)||a.price-b.price||a.name.localeCompare(b.name));
}

/** Only native cash-counter deltas from completed automatic runs count as income evidence. */
export function observeSoAInfiltration(previous,{reset,ownerPid,at,result,automatic}={}){
 const scoped=previous?.schemaVersion===1&&previous.nodeReset===reset?.lastNodeReset&&previous.augReset===reset?.lastAugReset&&previous.ownerPid===ownerPid;
 const state={schemaVersion:1,nodeReset:reset?.lastNodeReset,augReset:reset?.lastAugReset,ownerPid,at,samples:[]};
 if(!Number.isFinite(at)||!Number.isSafeInteger(ownerPid)||ownerPid<=0)return state;
 if(scoped&&Array.isArray(previous.samples))state.samples=previous.samples.filter(s=>Number.isFinite(s?.at)&&s.at<=at&&at-s.at<=1800000&&Number.isFinite(s.cash)&&s.cash>0&&Number.isFinite(s.durationMs)&&s.durationMs>=1000&&s.durationMs<=600000).slice(-6);
 if(automatic===true&&result?.manuallyStarted!==true&&result?.status==='completed'&&result.reward==='money'&&Number.isFinite(result.cashReward)&&result.cashReward>0&&Number.isFinite(result.durationMs)&&result.durationMs>=1000&&result.durationMs<=600000&&(!state.samples.length||state.samples.at(-1).at<at))
  state.samples=[...state.samples,{at,cash:result.cashReward,durationMs:result.durationMs}].slice(-6);
 return state;
}

export function readSoAInfiltrationIncome(ns,now=Date.now()){
 try{
  const r=ns.getResetInfo(),record=JSON.parse(ns.read('tasks/soa-infiltration-income.json')),status=JSON.parse(ns.read('tasks/infiltration-status.json'));
  if(record?.schemaVersion!==1||record.nodeReset!==r.lastNodeReset||record.augReset!==r.lastAugReset||!Number.isFinite(record.at)||record.at>now||now-record.at>300000||!Array.isArray(record.samples)||record.samples.length>6||record.samples.length<3||
   status.pid!==record.ownerPid||status.manuallyStarted===true||!Number.isFinite(status.at)||status.at>now||now-status.at>45000||!['running','completed','waiting-for-entry'].includes(status.status)||
   isScriptPaused(ns,'infiltration-manager.js')||!ns.ps('home').some(p=>p.pid===record.ownerPid&&p.filename.replace(/^\//,'')==='infiltration-manager.js'))return null;
  const samples=record.samples;
  if(!samples.every((s,i)=>Number.isFinite(s.at)&&s.at<=now&&now-s.at<=1800000&&Number.isFinite(s.cash)&&s.cash>0&&Number.isFinite(s.durationMs)&&s.durationMs>=1000&&s.durationMs<=600000&&(!i||s.at>samples[i-1].at))||now-samples.at(-1).at>300000)return null;
  const pairs=samples.slice(1).map((s,i)=>({ms:Math.max(s.durationMs,s.at-samples[i].at),cash:s.cash})).slice(-2);
  if(pairs.length<2||pairs.some(p=>p.ms<1000||p.ms>900000))return null;
  const rate=Math.min(...pairs.map(p=>p.cash*1000/p.ms));
  return Number.isFinite(rate)&&rate>0?{schemaVersion:1,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at:now,observedAt:samples.at(-1).at,rate,samples:samples.length,ownerPid:record.ownerPid}:null;
 }catch{return null;}
}

/** Credit only queued WKS and repeatedly measured active infiltration. The 50% native
 * cash bonus gets a further 50% haircut for market decay and uncertain future availability. */
export function soaInstallBenefit(snapshot,ready,{nodeReset,augReset,now=Date.now(),cashRate=0}={}){
 const none={gain:0,rate:0,reason:'No confirmed queued WKS income benefit'},soa=snapshot?.soa,e=soa?.infiltration;
 if(soa?.queued!==true||soa.installed!==false||!Array.isArray(ready)||!ready.some(a=>a.name===wksAugmentation)||!e||e.schemaVersion!==1||e.nodeReset!==nodeReset||e.augReset!==augReset||snapshot.nodeReset!==nodeReset||snapshot.augReset!==augReset||!Number.isFinite(e.at)||e.at>now||now-e.at>60000||!Number.isFinite(e.observedAt)||e.observedAt>e.at||now-e.observedAt>300000||!Number.isSafeInteger(e.samples)||e.samples<3||e.samples>6||!Number.isFinite(e.rate)||e.rate<=0||!Number.isFinite(cashRate)||cashRate<0)return none;
 if(!Number.isFinite(cashRate+e.rate))return none;
 const share=e.rate/(cashRate+e.rate);
 return {gain:.25*share,rate:e.rate,estimatedExtraCashPerSecond:e.rate*.25,reason:'Queued WKS: haircut applied to native cash bonus and observed infiltration share'};
}
