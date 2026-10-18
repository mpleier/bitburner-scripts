export function hackThreadsForFraction(fraction,perThread) {
 if(!Number.isFinite(fraction)||fraction<=0||!Number.isFinite(perThread)||perThread<=0)return 0;
 return Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor((Math.min(1,fraction)/perThread).toPrecision(14))));
}
export function canFitHackingJob(capacities,threads,split) {
 if(!Number.isSafeInteger(threads)||threads<=0)return false;
 const available=capacities.map(n=>Number.isFinite(n)?Math.max(0,Math.floor(n)):0);
 return (split?available.reduce((a,b)=>a+b,0):Math.max(0,...available))>=threads;
}
/** Roll back only workers launched by this batch when a later leg fails. */
export async function launchHackingBatch(items,launch,rollback,commit=()=>true) {
 const pids=[];
 try{for(const item of items){if(!item.threadsNeeded)continue;if(!await launch(item,pids)){await rollback(pids);return false;}}if(!await commit()){await rollback(pids);return false;}return true;}
 catch(error){await rollback(pids);throw error;}
}
