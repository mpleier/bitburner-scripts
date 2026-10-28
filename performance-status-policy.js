/** Fixed, read-only performance views. Self-contained for the command worker.
 * Stale data is labelled instead of silently presenting it as live state. */
export function readAutomationPerformance(ns,section='hacking',now=Date.now()) {
 const reset=ns.getResetInfo(),processes=ns.ps('home');
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 const live=(value,script,maxAge=45000,requireReset=true)=>{
  if(!value)return {state:'missing',data:null};
  const owner=value.ownerPid??value.pid;
  const valid=Number.isFinite(value.at)&&value.at<=now&&now-value.at<=maxAge&&
   (requireReset?value.nodeReset===reset.lastNodeReset&&value.augReset===reset.lastAugReset:value.at>=Math.max(reset.lastNodeReset,reset.lastAugReset))&&
   processes.some(p=>p.pid===owner&&p.filename.replace(/^\//,'')===script);
  return {state:valid?'live':'stale',data:value};
 };
 const result={at:now,section,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset};
 if(section==='hacking'){
  const budget=live(read('tasks/hgw-process-budget.json'),'daemon.js',15000);
  const plan=live(read('tasks/hacking-target-plan.json'),'daemon.js',15000);
  const p=plan.data;
  return {...result,budget,plan:{state:plan.state,data:p&&{at:p.at,ownerPid:p.ownerPid,preferred:p.preferred,decision:p.decision,reason:p.reason,candidate:p.candidate,candidateSince:p.candidateSince,horizonMs:p.horizonMs,projectedRate:p.projectedRate,gates:p.gates,
   quotes:(p.quotes||[]).slice(0,9).map(q=>({name:q.name,projectedRate:q.projectedRate,fraction:q.fraction,fractionsTested:q.fractionsTested,fractionSearch:q.fractionSearch,ready:q.ready,prepMs:q.prepMs,firstReceiptMs:q.firstReceiptMs,residentRam:q.residentRam})),
   comparisons:(p.comparisons||[]).slice(0,8).map(q=>({name:q.name,eligible:q.eligible,reason:q.reason,paybackMs:q.paybackMs,netGain:q.netGain}))}}};
 }
 if(section==='progression'){
  const route=live(read('tasks/node-route-plan.json'),'autopilot.js'),p=route.data;
  return {...result,route:{state:route.state,data:p&&{at:p.at,ownerPid:p.ownerPid,selected:p.selected,reason:p.reason,simulacrum:p.simulacrum,
   routes:Object.fromEntries(Object.entries(p.routes||{}).slice(0,4).map(([key,r])=>[key,{etaMs:r.etaMs,lowerMs:r.lowerMs,upperMs:r.upperMs,reason:r.reason}])),
   nextBlackOp:p.development?.nextBlackOp}},risk:live(read('tasks/bladeburner-risk.json'),'bladeburner.js'),infiltration:live(read('tasks/infiltration-status.json'),'infiltration-manager.js',120000,false)};
 }
 if(section==='managers'){
  const paths=[['infiltration-manager.js','tasks/infiltration-status.json'],['go.js','tasks/go-status.json'],['sleeve.js','tasks/sleeve-status.json'],['corporation-manager.js','tasks/corporation-status.json']];
  return {...result,managers:paths.map(([script,path])=>{const r=read(path),p=processes.find(p=>p.filename.replace(/^\//,'')===script);
   return {script,pid:p?.pid??null,state:p?(r&&(r.pid??r.ownerPid)===p.pid&&Number.isFinite(r.at)&&r.at>=Math.max(reset.lastNodeReset,reset.lastAugReset)&&r.at<=now&&now-r.at<=120000?(r.state??r.status??r.mode??'running'):'awaiting-current-status'):'not-running',at:r?.at??null,reason:r?.reason??r?.error??null};})};
 }
 throw Error('Choose hacking, progression or managers');
}
