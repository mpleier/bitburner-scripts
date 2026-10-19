/** Bounded dispatch observations. A returned PID proves launch, not successful completion. */
export async function runBackgroundCheck(ns,tool,check,now=()=>Date.now()) {
 const started=now();
 if(tool.health)observeExecution(ns,tool.health,started);
 tool.lastOutcome='failed';tool.lastPid=0;
 try{return await check();}
 catch(error){tool.lastOutcome='failed';tool.lastError=String(error).slice(0,200);throw error;}
 finally{
  const at=now(),outcome=tool.lastOutcome||'failed';
  const prior=tool.health||{},events=(prior.events||[]).filter(e=>e.at<=at&&at-e.at<300000);
  events.push({at,outcome,dispatchMs:Math.max(0,at-started)});
  tool.health={...prior,events:events.slice(-64),at,lastOutcome:outcome,lastError:outcome==='failed'?tool.lastError:null};
  if(outcome==='launched'&&Number.isSafeInteger(tool.lastPid)&&tool.lastPid>0)
   tool.health.active={pid:tool.lastPid,startedAt:at,lastSeenAt:at};
 }
}
/** Refresh lifecycle observations without scanning remote process lists. Exit status is unknown. */
export function backgroundHealthSnapshot(ns,tools,reset,now=Date.now()) {
 const jobs=[];
 for(const tool of tools){
  const h=tool.health;if(!h)continue;
  h.events=h.events.filter(e=>e.at<=now&&now-e.at<300000);
  observeExecution(ns,h,now);
  const counts={launched:0,running:0,blocked:0,failed:0},reasons={};
  for(const e of h.events){const kind=e.outcome.startsWith('blocked:')?'blocked':e.outcome;counts[kind]=(counts[kind]||0)+1;if(kind==='blocked')reasons[e.outcome.slice(8)]=(reasons[e.outcome.slice(8)]||0)+1;}
  jobs.push({script:tool.name,at:h.at,lastOutcome:h.lastOutcome,lastError:h.lastError,...counts,blockedReasons:reasons,
   checks:h.events.length,dispatchMs:h.events.length?Math.round(h.events.reduce((s,e)=>s+e.dispatchMs,0)/h.events.length):0,
   active:h.active?{...h.active}:null,lastExecution:h.lastExecution||null});
 }
 return {schemaVersion:1,at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,windowMs:300000,sampleLimit:64,jobs:jobs.slice(0,32)};
}
/** Self-contained reader; reject another run's or dead controller's observations. */
export function readBackgroundHealth(ns,now=Date.now()) {
 try{
  const r=JSON.parse(ns.read('tasks/background-jobs.json')),reset=ns.getResetInfo();
  return r?.schemaVersion===1&&r.at<=now&&now-r.at<30000&&r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&ns.isRunning(r.ownerPid)&&Array.isArray(r.jobs)?r:null;
 }catch{return null;}
}
function phase(name,limit){let h=0;for(const c of String(name))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return limit>0?h%(limit+1):0;}
/** Only ordinary periodic work is staggered; progression wakeups remain immediate. */
export function backgroundJobDue(job,now=Date.now(),urgent=false) {
 if(urgent)return true;
 if(job.lastRun>now){job.lastRun=0;delete job.nextDue;}
 if(!Number.isFinite(job.nextDue)){
  const delay=phase(job.name,Math.min(2000,Math.max(0,Math.floor((job.interval||0)*.1))));
  job.nextDue=job.lastRun?job.lastRun+job.interval:now+(job.infrastructure||job.backdoorUnlocks||job.factionInvites?0:delay);
 }
 return now>=job.nextDue;
}
/** RAM contention gets bounded retries; disabled/locked work retains its ordinary interval. */
export function backgroundJobDispatched(job,outcome,now=Date.now()) {
 const retry=['blocked:ram','blocked:compile','blocked:activity','blocked:maintenance','failed'].includes(outcome);
 job.retryCount=retry?Math.min(6,(job.retryCount||0)+1):0;
 const interval=Math.max(1000,Number(job.interval)||10000);
 const delay=retry?Math.min(interval,30000,1000*2**(job.retryCount-1)):interval+phase(job.name,Math.min(2000,Math.floor(interval*.1)));
 job.nextDue=now+delay;
}

function observeExecution(ns,h,now){
 if(!h.active)return;
 const active=h.active;
 if(ns.isRunning(active.pid))active.lastSeenAt=now;
 else{h.lastExecution={pid:active.pid,exitObservedAt:now,runtimeLowerMs:Math.max(0,active.lastSeenAt-active.startedAt),runtimeUpperMs:Math.max(0,now-active.startedAt),result:'exit-observed'};delete h.active;}
}
