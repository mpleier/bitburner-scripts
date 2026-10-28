/** Self-contained for fixed read-only diagnostics and collector severity. */
export function classifyHgwEvent(event){
 const spacingKnown=Number.isFinite(event?.legSpacingMs)&&event.legSpacingMs>0;
 const tolerance=Number.isFinite(event?.toleranceMs)&&event.toleranceMs>=0?event.toleranceMs:100;
 const thresholdMs=spacingKnown?Math.max(tolerance,event.legSpacingMs/2):tolerance;
 const kind=event?.error?'error':!Number.isFinite(event?.lateMs)||event.lateMs<0?'unknown':event.lateMs>thresholdMs?(spacingKnown?'spacing-risk':'unclassified-delay'):event.lateMs>tolerance?'deadline-miss':'on-time';
 return {kind,spacingKnown,thresholdMs};
}
/** Only reads two fixed files. Lifetime counts and recent owner events are distinct. */
export function readHgwTiming(ns,now,classify,summarize=()=>[]){
 const raw=ns.read('tasks/hgw-misfires.json');if(!raw)return {state:'waiting'};
 if(raw.length>300000)throw Error('HGW timing data exceeds diagnostic limit');
 const data=JSON.parse(raw),reset=ns.getResetInfo();
 if(!data||data.augReset!==reset.lastAugReset||data.nodeReset!==reset.lastNodeReset||!Number.isFinite(data.at)||data.at>now||now-data.at>15000)return {state:'stale'};
 if(!Number.isSafeInteger(data.ownerPid)||data.ownerPid<=0||!ns.isRunning(data.ownerPid))return {state:'worker-offline'};
 const keys=['operations','spacingSamples','spacingRisks','deadlineOverruns','unavoidableOverruns','compensatedStarts','zeroHack','noGrowth','noWeaken','errors','maxLateMs'];
 const counts=Object.fromEntries(keys.map(k=>[k,Number.isFinite(data.counts?.[k])&&data.counts[k]>=0?data.counts[k]:null]));
 const recent=(Array.isArray(data.recent)?data.recent:[]).filter(e=>e&&e.owner===data.ownerPid&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<=120000&&['hack','grow','weaken'].includes(e.tool)&&typeof e.target==='string'&&Number.isSafeInteger(e.pid)&&e.pid>0&&Number.isFinite(e.lateMs)&&e.lateMs>=0).slice(-20).map(e=>{
  const n=k=>Number.isFinite(e[k])?e[k]:null;
  return {at:e.at,ageMs:now-e.at,pid:e.pid,owner:e.owner,tool:e.tool,target:e.target.slice(0,100),description:String(e.description||'').slice(0,100),batchId:typeof e.batchId==='string'?e.batchId.slice(0,160):null,batchStep:typeof e.batchStep==='string'?e.batchStep.slice(0,30):null,pieceThreads:n('pieceThreads'),physicalThreads:n('physicalThreads'),deadline:n('deadline'),lateMs:e.lateMs,startLateMs:n('startLateMs'),unavoidableMs:n('unavoidableMs'),legSpacingMs:n('legSpacingMs'),toleranceMs:n('toleranceMs'),outcome:String(e.outcome||'').slice(0,40),error:e.error?String(e.error).slice(0,160):null,...classify(e)};
 });
 let pacing=null;const paceRaw=ns.read('tasks/hgw-pacing.json');
 if(paceRaw&&paceRaw.length<=30000)try{const p=JSON.parse(paceRaw);if(p?.pid===data.ownerPid&&p.augReset===data.augReset&&p.nodeReset===data.nodeReset&&Number.isFinite(p.at)&&p.at<=now&&now-p.at<=30000){pacing={};for(const k of ['at','windowAt','cycleMs','queueMs','targetCap','multiplier','latencyFloorMs','lateFraction','riskFraction','windowOperations'])pacing[k]=Number.isFinite(p[k])?p[k]:null;pacing.evidenceMode=String(p.evidenceMode||'').slice(0,40);}}catch{}
 return {state:'ready',at:now,telemetryAt:data.at,ownerPid:data.ownerPid,blocked:!!data.blocked,countsScope:'Reset-wide cumulative totals; may include previous owners',counts,pacing,recent,batches:summarize(data.recent,data.ownerPid,now),selection:{maxAgeMs:120000,limit:20,scope:'Current owner only; bounded event sample, not a complete measurement window'},limitations:'Ordering states cover only fully observed planned steps and all their threads; partial, failed, inconsistent and timestamp-tied samples never prove correct ordering. Cross-batch interference and untagged legacy/manual/looping work are not verified'};
}
