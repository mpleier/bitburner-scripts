/** Stable structural capacity, excluding routine finite-batch process churn. */
export function createXpCapacityRecord({ownerPid,reset,mode,config=[],targets=[],hosts=[],workers=[],now=Date.now()}={}) {
 const base={schemaVersion:1,ownerPid,nodeReset:reset?.lastNodeReset,augReset:reset?.lastAugReset,at:now};
 const unavailable=reason=>({...base,state:'unavailable',reason});
 if(!Number.isSafeInteger(ownerPid)||ownerPid<=0||![base.nodeReset,base.augReset,now].every(Number.isFinite)||now<base.augReset||
  !['xp','income'].includes(mode)||!Array.isArray(hosts)||!hosts.length||!Array.isArray(workers)||!Array.isArray(config)||!Array.isArray(targets))return unavailable('Incomplete capacity inventory');
 const seen=new Set(),hardware=[];
 for(const h of hosts){
  if(!h||typeof h.host!=='string'||!h.host||seen.has(h.host)||![h.maxRam,h.usableRam,h.cores].every(Number.isFinite)||
   h.maxRam<0||h.usableRam<0||h.usableRam>h.maxRam||!Number.isSafeInteger(h.cores)||h.cores<1)return unavailable('Invalid host inventory');
  seen.add(h.host);hardware.push([h.host,h.maxRam,h.usableRam,h.cores]);
 }
 hardware.sort((a,b)=>a[0].localeCompare(b[0]));
 const groups=new Map(),pids=new Set();
 for(const w of workers){
  if(w?.owner!==ownerPid||!w.loop)continue;
  if(!seen.has(w.host)||typeof w.tool!=='string'||typeof w.target!=='string'||!Number.isSafeInteger(w.threads)||w.threads<=0||!Number.isSafeInteger(w.pid)||w.pid<=0)return unavailable('Incomplete looping worker inventory');
  const process=w.host+':'+w.pid;if(pids.has(process))continue;pids.add(process);
  const key=JSON.stringify([w.host,w.tool,w.target]);groups.set(key,(groups.get(key)||0)+w.threads);
 }
 const loops=[...groups].sort((a,b)=>a[0].localeCompare(b[0]));
 const text=JSON.stringify([ownerPid,mode,config,[...new Set(targets)].sort(),hardware,loops]);
 let a=2166136261,b=0x9e3779b9;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519);}
 return {...base,state:'ready',signature:'xp-capacity-v1:'+(a>>>0).toString(16)+':'+(b>>>0).toString(16)+':'+text.length,
  hosts:hardware.length,loopGroups:loops.length,loopThreads:loops.reduce((sum,row)=>sum+row[1],0),mode};
}

/** Self-contained reader embedded in the route snapshot worker; only the live daemon can own a quote. */
export function readXpCapacity(ns,daemon,reset,now=Date.now()) {
 if(!Number.isSafeInteger(daemon?.pid)||daemon.pid<=0)return {state:'daemon-offline'};
 try{
  const value=JSON.parse(ns.read('tasks/xp-capacity-'+daemon.pid+'.json'));
  if(value.schemaVersion!==1||value.state!=='ready'||value.ownerPid!==daemon.pid||value.nodeReset!==reset.lastNodeReset||value.augReset!==reset.lastAugReset||
   !Number.isFinite(value.at)||value.at<reset.lastAugReset||value.at>now||now-value.at>30000||
   typeof value.signature!=='string'||!/^xp-capacity-v1:[a-f0-9]+:[a-f0-9]+:\d+$/.test(value.signature))return {state:'unavailable'};
  return value;
 }catch{return {state:'unavailable'};}
}

export function xpCapacityKey(sample) {
 if(sample.xpCapacity===undefined)return 'legacy';
 const c=sample.xpCapacity;
 if(c?.schemaVersion!==1||c.state!=='ready'||c.nodeReset!==sample.nodeReset||c.augReset!==sample.augReset||
  !Number.isSafeInteger(c.ownerPid)||c.ownerPid<=0||!Number.isFinite(c.at)||c.at>sample.at||sample.at-c.at>30000||
  typeof c.signature!=='string'||!/^xp-capacity-v1:[a-f0-9]+:[a-f0-9]+:\d+$/.test(c.signature))return null;
 return c.ownerPid+':'+c.signature;
}
