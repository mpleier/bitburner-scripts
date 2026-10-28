/** Existing rank workers may continue during unrelated leaf-controller reloads only. */
export function rankHashMaintenanceRequired(ns,actions) {
 try {
  const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));
  if(!(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid)))return false;
  const rankOnly=Array.isArray(actions)&&actions.length>0&&actions.every(a=>['Exchange for Bladeburner Rank','Exchange for Bladeburner SP'].includes(a));
  const independent=['corporation-manager.js','gangs.js','stockmaster.js','go.js'];
  return !(rankOnly&&Array.isArray(r.scripts)&&r.scripts.length>0&&r.scripts.every(s=>typeof s==='string'&&independent.includes(s.replace(/^\//,''))));
 }catch{return false;}
}

/** Quote the next rank exchange only, using current production and a fresh live worker. */
export function readRankHashUpgradeContext(ns,now=Date.now()) {
 try {
  const reset=ns.getResetInfo(),processes=ns.ps('home');
  if(ns.read('remote-control/paused/spend-hacknet-hashes.js.txt').trim()==='true')return null;
  const valid=processes.some(p=>{
   if(p.filename.replace(/^\//,'')!=='spend-hacknet-hashes.js')return false;
   let s;try{s=JSON.parse(ns.read('tasks/hash-worker-status-'+p.pid+'.json'));}catch{return false;}
   return s.pid===p.pid&&s.nodeReset===reset.lastNodeReset&&s.augReset===reset.lastAugReset&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<15000&&s.state==='spending'&&s.decision?.preferred==='Exchange for Bladeburner Rank'&&s.decision.rankGap>0;
  });
  if(!valid)return null;
  const cost=ns.hacknet.hashCost('Exchange for Bladeburner Rank'),hashes=ns.hacknet.numHashes(),capacity=ns.hacknet.hashCapacity();
  let production=0;
  for(let i=0;i<ns.hacknet.numNodes();i++){
   const rate=ns.hacknet.getNodeStats(i).production;
   if(!Number.isFinite(rate)||rate<0)return null;
   production+=rate;
  }
  if(![cost,hashes,capacity,production].every(Number.isFinite)||cost<=hashes||hashes<0||capacity<cost||production<=0)return null;
  return {remainingHashes:cost-hashes,production};
 }catch{return null;}
}

export function rankHashUpgradeValue(candidate,context) {
 if(!context||![candidate?.gain,candidate?.cost,context.production,context.remainingHashes].every(v=>Number.isFinite(v)&&v>0))return null;
 const secondsSaved=context.remainingHashes/context.production-context.remainingHashes/(context.production+candidate.gain);
 return {secondsSaved,secondsSavedPerDollar:secondsSaved/candidate.cost};
}
