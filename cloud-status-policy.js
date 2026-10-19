export function cloudDecisionDescription(result){
 if(result.purchased)return (result.upgrade?'Upgraded an existing server':'Purchased a server')+' to add capacity';
 return ({'shared-budget':'Waiting for shared spending allowance','idle-capacity':'Existing usable RAM has spare capacity',
  'reserved-cash':'Cash is reserved for other goals','no-affordable-capacity':'Waiting for an affordable capacity increase',
  'maximum-capacity':'All cloud servers have reached their RAM limit','disabled':'Cloud servers are disabled in this BitNode',
  'paused':'Cloud purchases are paused','maintenance':'Waiting for automation maintenance to finish',
  'api-unavailable':'Cloud purchase check is unavailable; it will retry','purchase-failed':'The game declined the purchase; costs will be checked again'})[result.reason]||'Waiting for the next cloud purchase check';
}

/** Cloud managers are one-shot: a finished PID does not invalidate a recent decision. */
export function currentCloudPurchase(record,reset,now=Date.now()){
 return record?.schemaVersion===1&&record.nodeReset===reset.lastNodeReset&&record.augReset===reset.lastAugReset&&
  Number.isFinite(record.at)&&record.at>=reset.lastAugReset&&record.at<=now&&now-record.at<=120000?record:null;
}
export function publishCloudPurchase(ns,result,now=Date.now()){
 const reset=ns.getResetInfo(),finite=n=>Number.isFinite(n)&&n>=0?n:null;
 const record={schemaVersion:1,at:now,pid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,
  description:cloudDecisionDescription(result),state:result.purchased?'purchased':'deferred',reason:String(result.reason||(result.purchased?'capacity-added':'unknown')).slice(0,160),
  name:typeof result.name==='string'?result.name:null,cost:finite(result.cost),ram:finite(result.ram),addedRam:finite(result.addedRam),
  budget:finite(result.budget),utilization:finite(result.utilization),upgrade:result.upgrade===true,error:result.error?String(result.error).slice(0,256):null};
 ns.write('tasks/cloud-purchase-status.json',JSON.stringify(record),'w');return record;
}
