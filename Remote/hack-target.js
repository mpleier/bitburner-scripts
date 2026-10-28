/** Schedule a hack against its completion deadline; persist outcomes separately from timing. */
export async function main(ns) {
 const [target='',start=0,duration=0,description='',stock=false,silent=false,loop=false,owner=0,timingMeta='']=ns.args;
 let meta=null;try{meta=typeof timingMeta==='string'?JSON.parse(timingMeta):null;}catch{}
 if(!target||!Number.isFinite(start)||!Number.isFinite(duration)||duration<0)return ns.print('Invalid hacking schedule.');
 const toleranceMs=Number.isFinite(meta?.toleranceMs)&&meta.toleranceMs>=0?meta.toleranceMs:100;
 let first=true,lastWarningAt=-Infinity,lastCompleted=0;
 do {
  if(owner&&!ns.isRunning(owner))return;
  if(loop&&hackingLoopShouldStop(ns,owner,target,'hack',lastCompleted,meta))return;
  const began=Date.now(),period=duration*(loop?4:1),deadline=duration>0?(first?start:began)+period:null;
  const nativeTime=duration>0?ns.getHackTime(target):0;
  const additionalMsec=deadline===null?Math.max(0,first?start-began:0):Math.max(0,deadline-began-nativeTime);
  const startLateMs=first?Math.max(0,began-start):0;
  const unavoidableMs=deadline===null?0:Math.max(0,began+nativeTime-deadline);
  let value,error,failed=false;
  try{value=await ns.hack(target,{stock,additionalMsec});}
  catch(e){error=e;failed=true;}
  const at=Date.now(),lateMs=deadline===null?0:Math.max(0,at-deadline);
  const outcome=failed?'error':value===0?'zero-hack-result':'effect';
  const event={at,tool:'hack',target,description:String(description).slice(0,100),pid:ns.pid,owner,
   deadline,lateMs,unavoidableMs,startLateMs,toleranceMs,legSpacingMs:Number.isFinite(meta?.legSpacingMs)&&meta.legSpacingMs>0?meta.legSpacingMs:null,outcome,value:Number.isFinite(value)?value:null,
   error:failed?String(error).slice(0,300):null};
  if(!loop&&meta?.batchVersion===1&&typeof meta.batchId==='string'&&meta.batchId.length<=160&&meta.batchTarget===target&&Array.isArray(meta.batchPlan)&&meta.batchPlan.length<=5)Object.assign(event,{batchVersion:1,batchId:meta.batchId,batchStep:meta.batchStep,batchPlan:meta.batchPlan,pieceThreads:meta.pieceThreads,physicalThreads:meta.physicalThreads});
  const delivered=report(ns,meta,event,silent);
  // Normal zero-effect outcomes and compensated starts are measurements, never timing alerts.
  if(!silent&&(failed||lateMs>Math.max(toleranceMs,Number.isFinite(event.legSpacingMs)&&event.legSpacingMs>0?event.legSpacingMs/2:0))&&!delivered&&at-lastWarningAt>=60000){
   ns.toast(failed?`Operation error: hack on ${target}: ${String(error).slice(0,160)}`:`Timing risk: hack on ${target} completed ${Math.round(lateMs)} ms after its deadline.`,'warning');lastWarningAt=at;
  }
  if(failed)throw error;
  lastCompleted=at;
  first=false;
 }while(loop);
}

/** Synchronous port operations make this bounded read/merge/write atomic between JS tasks. */
function report(ns,meta,event,silent) {
 if(meta?.port!==20||typeof ns.getPortHandle!=='function')return false;
 try {
  const port=ns.getPortHandle(20),head=port.peek();let data;
  if(head!=='NULL PORT DATA'){
   try{data=JSON.parse(head);}catch{return false;}
   if(data?.channel!=='hgw-v1')return false; // Do not consume another user's messages.
   port.read();
  }
  if(!data||data.augReset!==meta.augReset||data.nodeReset!==meta.nodeReset)
   data={channel:'hgw-v1',augReset:meta.augReset,nodeReset:meta.nodeReset,counts:{},targets:{},recent:[],alerts:[]};
  const spacingKnown=Number.isFinite(event.legSpacingMs)&&event.legSpacingMs>0;
  const counters={operations:1,spacingSamples:Number(spacingKnown),spacingRisks:Number(spacingKnown&&(!!event.error||event.lateMs>Math.max(event.toleranceMs,event.legSpacingMs/2))),deadlineOverruns:Number(event.lateMs>event.toleranceMs),
   unavoidableOverruns:Number(event.unavoidableMs>event.toleranceMs),
   compensatedStarts:Number(event.startLateMs>0&&event.lateMs<=event.toleranceMs&&!event.error),
   zeroHack:Number(event.outcome==='zero-hack-result'),noGrowth:Number(event.outcome==='no-growth'),
   noWeaken:Number(event.outcome==='no-weaken'),errors:Number(!!event.error)};
  const add=(record)=>{for(const [key,n]of Object.entries(counters))record[key]=(Number(record[key])||0)+n;
   record.maxLateMs=Math.max(Number(record.maxLateMs)||0,event.lateMs);return record;};
  data.counts=add(data.counts||{});data.targets||={};
  // Owner-scoped actual receipts; zero yields count as completions, never as money.
  if(Number.isSafeInteger(event.owner)&&event.owner>0){
   data.income||={};const k=JSON.stringify([event.owner,event.target]),old=data.income[k]||{};
   data.income[k]={owner:event.owner,target:event.target,at:event.at,
    money:(Number(old.money)||0)+(event.tool==='hack'&&Number.isFinite(event.value)&&event.value>0&&!event.error?event.value:0),
    completions:(Number(old.completions)||0)+Number(event.tool==='hack'),risks:(Number(old.risks)||0)+Number(!!event.error||event.lateMs>event.toleranceMs)};
   data.income=Object.fromEntries(Object.entries(data.income).sort((a,b)=>b[1].at-a[1].at).slice(0,64));
  }
  const key=event.tool+':'+event.target;data.targets[key]={...add(data.targets[key]||{}),at:event.at};
  const keys=Object.keys(data.targets);if(keys.length>64)delete data.targets[keys.sort((a,b)=>data.targets[a].at-data.targets[b].at)[0]];
  data.at=event.at;data.firstAt=Number.isFinite(data.firstAt)?Math.min(data.firstAt,event.at):event.at;
  data.delaySamples=mergeHgwDelaySamples(data.delaySamples,[event],{now:event.at,nodeReset:meta.nodeReset,augReset:meta.augReset});
  data.recent=[...(data.recent||[]),event].slice(-20);
  data.alerts=[...(data.alerts||[]),...(!silent&&(event.lateMs>event.toleranceMs||event.error)?[event]:[])].slice(-20);
  port.write(JSON.stringify(data));return true;
 }catch{return false;}
}

function hackingLoopShouldStop(ns,owner,target,tool,lastCompleted,meta) {
 if(!owner||typeof ns.read!=='function')return false;
 let plan;try{plan=JSON.parse(ns.read('tasks/hgw-drain-'+owner+'.json'));}catch{return false;}
 if(plan?.ownerPid!==owner||plan.nodeReset!==meta?.nodeReset||plan.augReset!==meta?.augReset)return false;
 const entry=plan.targets?.[target];if(!entry||!Number.isFinite(entry.stageAt))return false;
 if(tool==='hack')return ['attack','grow','weaken','complete'].includes(entry.stage);
 if(tool==='grow')return ['grow','weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
 return tool==='weaken'&&['weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
}

/** Bounded representative receipts; a batch maximum keeps its actual observation time. */
function mergeHgwDelaySamples(prior,events,{now,nodeReset,augReset,ownerPid=null}){
 const batches=new Map();
 for(const e of [...(Array.isArray(prior)?prior.slice(0,64):[]),...(Array.isArray(events)?events.slice(-64):[])]){
  if(!e||!Number.isSafeInteger(e.owner)||e.owner<=0||ownerPid!==null&&e.owner!==ownerPid||e.error||e.batchVersion!==1||typeof e.batchId!=='string'||e.batchId.length>160||!e.batchId.startsWith([nodeReset,augReset,e.owner].join(':')+':')||!['hack','grow','weaken'].includes(e.tool)||!Number.isSafeInteger(e.pid)||e.pid<=0||!Number.isFinite(e.at)||e.at>now||now-e.at>120000||!Number.isFinite(e.deadline)||!Number.isFinite(e.lateMs)||e.lateMs<0||Math.abs(Math.max(0,e.at-e.deadline)-e.lateMs)>2)continue;
  const old=batches.get(e.batchId);
  if(!old||e.lateMs>old.lateMs||e.lateMs===old.lateMs&&e.at>old.at)batches.set(e.batchId,{batchVersion:1,batchId:e.batchId,owner:e.owner,pid:e.pid,tool:e.tool,at:e.at,deadline:e.deadline,lateMs:e.lateMs});
 }
 return [...batches.values()].sort((a,b)=>b.at-a.at||a.batchId.localeCompare(b.batchId)).slice(0,64);
}
