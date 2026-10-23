import {captureTrainingBackground,trainingBackgroundDelta,recordPlayerTrainingCalibration} from './player-training-calibration-policy.js';
const keys=['strength','defense','dexterity','agility'];
/** Synchronous endpoints: BB XP is paid on completion, sleeve transfers are observed separately. */
export function captureParallelTrainingObservation(ns,input){
 try{
  const b=ns.bladeburner,a=b.getCurrentAction(),p=ns.getPlayer(),r=ns.getResetInfo(),w=ns.singularity.getCurrentWork();
  if(!['Contracts','Operations'].includes(a?.type)||a.name!==input.mission?.name||a.type!==input.mission?.type||!['CLASS','CRIME'].includes(w?.type))return null;
  const result={at:Date.now(),scope:JSON.stringify([r.lastNodeReset,r.lastAugReset,input.parent,input.target,p.city,p.mults,a.type,a.name,b.getCity(),b.getActionCurrentLevel(a.type,a.name),b.getSkillLevel('Hyperdrive'),w.type,w.location,w.classType,w.crimeType]),progress:b.getActionCurrentTime(),time:b.getActionTime(a.type,a.name),successes:b.getActionSuccesses(a.type,a.name),bonusMs:b.getBonusTime(),exp:Object.fromEntries(keys.map(k=>[k,p.exp[k]])),background:captureTrainingBackground(ns)};
  return [result.at,result.progress,result.time,result.successes,result.bonusMs,...Object.values(result.exp)].every(Number.isFinite)&&result.progress>=0&&result.time>=1000&&result.successes>=0&&result.bonusMs>=0?result:null;
 }catch{return null;}
}
/** Certify absence of any native completion, including hidden failed completions and queued work. */
export function parallelTrainingFragment(before,after){
 if(!before||!after||before.scope!==after.scope)return null;
 const elapsed=after.at-before.at,work=elapsed+before.bonusMs-after.bonusMs;
 if(![elapsed,work,before.progress,after.progress,before.time,after.time,before.successes,after.successes].every(Number.isFinite)||elapsed<100||elapsed>1500||work<0||work>elapsed*5+1000||before.successes!==after.successes||after.progress<before.progress||before.progress+Math.max(work,elapsed*5)+5000>=Math.min(before.time,after.time))return null;
 const background=trainingBackgroundDelta(before.background,after.background);if(!background)return null;
 const net={};for(const k of keys){const gain=after.exp?.[k]-before.exp?.[k];if(!Number.isFinite(gain)||gain<0||!Number.isFinite(background[k])||background[k]<0)return null;net[k]=Math.max(0,gain-background[k]);}
 return {start:before.at,end:after.at,scope:before.scope,seconds:elapsed/1000,net};
}
/** Sum only non-overlapping certified intervals; partial sessions cannot create optimistic XP multipliers. */
export function recordParallelTrainingCalibration(saved,{fragments,scope,at,id,choice,elapsedMs,reason,stable}){
 const rows=Array.isArray(fragments)&&fragments.length<=160?fragments:[];let last=-Infinity,totalMs=0,identity=null;const net=Object.fromEntries(keys.map(k=>[k,0]));
 for(const f of rows){
  if(!f||![f.start,f.end,f.seconds].every(Number.isFinite)||f.start<last||f.end<=f.start||f.end>at||Math.abs(f.seconds-(f.end-f.start)/1000)>1e-6||f.seconds<.1||f.seconds>1.5||keys.some(k=>!Number.isFinite(f.net?.[k])||f.net[k]<0)||identity!==null&&identity!==f.scope)return {...recordPlayerTrainingCalibration(saved,{scope,at,reason:'unverified'}),measurement:{accepted:false,reason:'invalid-fragments'}};
  identity=f.scope;last=f.end;totalMs+=f.end-f.start;for(const k of keys)net[k]+=f.net[k];
 }
 const seconds=totalMs/1000,zero=Object.fromEntries(keys.map(k=>[k,0])),eligible=['completed','mission-boundary'].includes(reason)&&stable&&seconds>=15&&seconds*1000<=elapsedMs+1;
 const result=recordPlayerTrainingCalibration(saved,{scope,at,id,choice:{...choice,durationMs:seconds*1000},before:zero,after:net,background:zero,nativeUpper:zero,elapsedMs:seconds*1000,reason:eligible?'completed':'unverified',stable:eligible});
 const accepted=result.samples.some(s=>s.id===id);
 return {...result,samples:result.samples.map(s=>s.id===id?{...s,evidence:'completion-free-fragments',fragments:rows.length}:s),measurement:{accepted,seconds,fragments:rows.length,excludedMs:Math.max(0,elapsedMs-seconds*1000),net,reason:accepted?'certified-no-native-completions':'insufficient-or-interrupted-evidence'}};
}
