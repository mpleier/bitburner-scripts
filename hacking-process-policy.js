import {recordHackingDeadline} from './hacking-deadline-policy.js';
/** Global HGW process limit, independent of thread/RAM counts. Existing work is never killed. */
export function updateHackingProcessBudget(previous,{now=Date.now(),inventory=null,lagMs=0,maxWorkers=2048}={}) {
 const maximum=Number.isSafeInteger(maxWorkers)&&maxWorkers>=4?maxWorkers:2048;
 let s=previous&&previous.at<=now&&previous.maximum===maximum?{...previous}:{maximum,factor:1,bad:0,clean:0,changedAt:now,used:0,inventoryAt:null,ready:false};
 const lag=Number.isFinite(lagMs)&&lagMs>=0?lagMs:0;
 s.bad=lag>=250?s.bad+1:0;s.clean=lag<50?s.clean+1:0;
 if(s.bad>=3){s.factor=Math.max(.125,s.factor*.75);s.bad=0;s.clean=0;s.changedAt=now;}
 else if(s.clean>=30&&now-s.changedAt>=60000){s.factor=Math.min(1,s.factor+.1);s.clean=0;s.changedAt=now;}
 if(inventory){s.ready=inventory.complete===true&&Number.isSafeInteger(inventory.workers)&&inventory.workers>=0;
  if(s.ready){s.used=inventory.workers;s.totalProcesses=inventory.total;s.inventoryAt=now;}}
 s.limit=Math.max(4,Math.floor(maximum*s.factor));s.lagMs=lag;s.at=now;
 s.reason=!s.ready?'Waiting for a complete process inventory':s.factor<1?'Reduced new-worker capacity after sustained scheduling lag':'Normal worker capacity';
 return s;
}
/** Count all HGW owners so simultaneous schedulers cannot bypass the global limit. */
export function hackingProcessInventory(ns,hosts,ownerPid,now=Date.now(),reset=null) {
 let workers=0,total=0,complete=true;const allocations={};
 const drain={schemaVersion:1,hostCount:0,at:now,ownerPid,nodeReset:reset?.lastNodeReset??null,augReset:reset?.lastAugReset??null,complete:true,invalidated:false,targets:Object.create(null)};
 for(const host of new Set(hosts))try{
  if(typeof ns.hasRootAccess==='function'&&!ns.hasRootAccess(host))continue;
  const ps=ns.ps(host);drain.hostCount++;total+=ps.length;const costs=new Map();
  for(const p of ps){
   const match=/^\/?Remote\/(hack|grow|weak|manualhack)-target\.js$/.exec(p.filename);if(!match)continue;workers++;
   if(ownerPid!==undefined)recordHackingDeadline(drain,p);
   if(ownerPid===undefined||p.args?.[match[1]==='weak'?6:7]!==ownerPid)continue;
   const target=p.args?.[0];if(typeof target!=='string')continue;
   const a=allocations[target]||={ram:0,manual:false};if(match[1]==='manualhack')a.manual=true;
   if(!costs.has(p.filename))costs.set(p.filename,ns.getScriptRam(p.filename,host));
   const ram=costs.get(p.filename)*p.threads;if(!(Number.isFinite(ram)&&ram>0)){complete=false;continue;}a.ram+=ram;
  }
 }catch{complete=false;}
 drain.complete=drain.complete&&complete&&drain.hostCount>0;
 return {workers,total,complete,...(ownerPid===undefined?{}:{allocations,drain})};
}
export function reserveHackingProcess(state,now=Date.now()) {
 if(!state?.ready||!Number.isFinite(state.inventoryAt)||state.inventoryAt>now||now-state.inventoryAt>=15000||state.used>=state.limit)return false;
 state.used++;return true;
}
export function releaseHackingProcess(state){if(state)state.used=Math.max(0,state.used-1);}

/** Self-contained status reader used by the supervisor. */
export function readHackingProcessBudget(ns,now=Date.now()) {
 try{const b=JSON.parse(ns.read('tasks/hgw-process-budget.json')),r=ns.getResetInfo();
  return Number.isFinite(b?.at)&&b.at<=now&&now-b.at<15000&&b.nodeReset===r.lastNodeReset&&b.augReset===r.lastAugReset&&ns.isRunning(b.ownerPid)&&Number.isFinite(b.limit)&&Number.isFinite(b.used)?b:null;
 }catch{return null;}
}
