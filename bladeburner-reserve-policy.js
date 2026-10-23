/** Whole rank-farming attempts allowed by the controller's current reserve policy.
 * Self-contained for read-only forecast workers. Missing evidence preserves special-purpose stock. */
export function bladeburnerRankSupply(name,count,rank,reserves) {
 if(!Number.isFinite(count)||count<1)return 0;
 const whole=Math.floor(count);
 if(name==='Raid')return 0;
 if(name==='Stealth Retirement Operation') {
  const reserve=reserves?.stealth;
  return reserves?.guardReady===true&&Number.isSafeInteger(reserve)&&reserve>=0&&reserve<=1000000?Math.max(0,whole-reserve):0;
 }
 if(['Tracking','Investigation','Undercover Operation'].includes(name)) {
  if(!Number.isFinite(rank)||rank<0||!Number.isFinite(reserves?.population)||reserves.population<0||!Number.isFinite(reserves?.maxRank)||reserves.maxRank<1)return 0;
  const floor=reserves.population*(1-rank/(.99*reserves.maxRank));
  return Math.min(whole,Math.max(0,Math.ceil(count-floor)));
 }
 return whole;
}

/** Trust only a fresh current-reset controller snapshot and a live matching guard acknowledgement. */
export function readBladeburnerRankReserves(ns,reset,now=Date.now()) {
 try {
  const data=JSON.parse(ns.read('tasks/bladeburner-rank-reserves.json'));
  if(!Number.isFinite(data.at)||data.at>now||now-data.at>=30000||data.nodeReset!==reset.lastNodeReset||data.augReset!==reset.lastAugReset)return null;
  const processes=ns.ps('home');
  if(!processes.some(p=>p.pid===data.ownerPid&&p.filename.replace(/^\//,'')==='bladeburner.js'))return null;
  const reserves={population:data.population,maxRank:data.maxRank,stealth:data.stealth,guardReady:false};
  try {
   const ready=JSON.parse(ns.read('/Temp/bladeburner-stock-ready-'+data.ownerPid+'.txt'));
   const lease=JSON.parse(ns.read('tasks/bladeburner-stock-guard.json'));
   reserves.guardReady=data.guardReady===true&&ready.pid===data.guardPid&&ready.ownerPid===data.ownerPid&&ready.nodeReset===data.nodeReset&&ready.augReset===data.augReset&&
    processes.some(p=>p.pid===ready.pid&&p.filename.replace(/^\//,'')==='Temp/bladeburner-stock-guard.js')&&
    lease.ownerPid===data.ownerPid&&lease.nodeReset===data.nodeReset&&lease.augReset===data.augReset&&lease.reserve===data.stealth&&
    Number.isFinite(lease.at)&&lease.at<=now&&Number.isFinite(lease.expiresAt)&&lease.expiresAt>now&&lease.expiresAt<=now+30000&&['idle','farm','cleanup'].includes(lease.mode);
  }catch{}
  return reserves;
 }catch{return null;}
}
