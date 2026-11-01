import {reportHgwEvent,hackingLoopShouldStop} from './hgw-telemetry.js';
/** Schedule a weaken against its completion deadline; persist outcomes separately from timing. */
export async function main(ns) {
 const [target='',start=0,duration=0,description='',silent=false,loop=false,owner=0,timingMeta='']=ns.args;
 let meta=null;try{meta=typeof timingMeta==='string'?JSON.parse(timingMeta):null;}catch{}
 if(!target||!Number.isFinite(start)||!Number.isFinite(duration)||duration<0)return ns.print('Invalid hacking schedule.');
 const toleranceMs=Number.isFinite(meta?.toleranceMs)&&meta.toleranceMs>=0?meta.toleranceMs:100;
 let first=true,lastWarningAt=-Infinity,lastCompleted=0;
 do {
  if(owner&&!ns.isRunning(owner))return;
  if(loop&&hackingLoopShouldStop(ns,owner,target,'weaken',lastCompleted,meta))return;
  const began=Date.now(),period=duration*(loop?1:1),deadline=duration>0?(first?start:began)+period:null;
  const nativeTime=duration>0?ns.getWeakenTime(target):0;
  const additionalMsec=deadline===null?Math.max(0,first?start-began:0):Math.max(0,deadline-began-nativeTime);
  const startLateMs=first?Math.max(0,began-start):0;
  const unavoidableMs=deadline===null?0:Math.max(0,began+nativeTime-deadline);
  let value,error,failed=false;
  try{value=await ns.weaken(target,{additionalMsec});}
  catch(e){error=e;failed=true;}
  const at=Date.now(),lateMs=deadline===null?0:Math.max(0,at-deadline);
  const outcome=failed?'error':value===0?'no-weaken':'effect';
  const event={at,tool:'weaken',target,description:String(description).slice(0,100),pid:ns.pid,owner,
   deadline,lateMs,unavoidableMs,startLateMs,toleranceMs,legSpacingMs:Number.isFinite(meta?.legSpacingMs)&&meta.legSpacingMs>0?meta.legSpacingMs:null,outcome,value:Number.isFinite(value)?value:null,
   error:failed?String(error).slice(0,300):null};
  if(!loop&&meta?.batchVersion===1&&typeof meta.batchId==='string'&&meta.batchId.length<=160&&meta.batchTarget===target&&Array.isArray(meta.batchPlan)&&meta.batchPlan.length<=5)Object.assign(event,{batchVersion:1,batchId:meta.batchId,batchStep:meta.batchStep,batchPlan:meta.batchPlan,pieceThreads:meta.pieceThreads,physicalThreads:meta.physicalThreads});
  const delivered=reportHgwEvent(ns,meta,event,silent);
  // Normal zero-effect outcomes and compensated starts are measurements, never timing alerts.
  if(!silent&&(failed||lateMs>Math.max(toleranceMs,Number.isFinite(event.legSpacingMs)&&event.legSpacingMs>0?event.legSpacingMs/2:0))&&!delivered&&at-lastWarningAt>=60000){
   ns.toast(failed?`Operation error: weaken on ${target}: ${String(error).slice(0,160)}`:`Timing risk: weaken on ${target} completed ${Math.round(lateMs)} ms after its deadline.`,'warning');lastWarningAt=at;
  }
  if(failed)throw error;
  lastCompleted=at;
  first=false;
 }while(loop);
}
