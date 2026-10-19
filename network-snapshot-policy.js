/** Cache host discovery only. Resource availability and permissions must always be read live. */
export function sharedNetworkSnapshot(servers,ownerPid,reset,now=Date.now()) {
 if(!Number.isSafeInteger(ownerPid)||ownerPid<=0||!Array.isArray(servers)||!servers.includes('home')||servers.length>1024||servers.some(s=>typeof s!=='string'||!s||s.length>256))return null;
 return {schemaVersion:1,at:now,ownerPid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,servers:[...new Set(servers)]};
}
export function readSharedNetwork(ns,now=Date.now()) {
 try{
  if(ns.getHostname()!=='home')return null;
  const r=JSON.parse(ns.read('tasks/network-snapshot.json')),reset=ns.getResetInfo();
  if(r?.schemaVersion!==1||!Number.isFinite(r.at)||r.at>now||now-r.at>=15000||r.nodeReset!==reset.lastNodeReset||r.augReset!==reset.lastAugReset||!ns.isRunning(r.ownerPid))return null;
  return sharedNetworkSnapshot(r.servers,r.ownerPid,reset,r.at);
 }catch{return null;}
}
