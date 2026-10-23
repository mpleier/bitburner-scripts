export function hacknetTierEligible(candidate,money) {
 if(!(candidate.cost>0)||!(candidate.payoff>=0)||!Number.isFinite(candidate.cost+candidate.payoff+money))return false;
 return candidate.payoff<=3600||candidate.payoff<=14400&&candidate.cost<=money*.1||
  candidate.payoff<=28800&&candidate.cost<=money*.01||candidate.cost<=money*.001;
}

/** Official production formulas, available without Formulas.exe. */
export function hacknetProduction(s,servers,multiplier=1) {
 if(servers)return .001*s.level*1.07**Math.log2(s.ram)*(1+(s.cores-1)/5)*Math.max(0,1-(s.ramUsed||0)/s.ram)*multiplier;
 return 1.5*s.level*1.035**(s.ram-1)*(s.cores+5)/6*multiplier;
}
export function hacknetServerMode(reset,stats) {
 if(stats)return Number(stats.hashCapacity)>0;
 if(reset?.bitNodeOptions?.disableHacknetServer)return false;
 const read=m=>typeof m?.get==='function'?m.get(9):m?.[9];
 const override=read(reset?.bitNodeOptions?.sourceFileOverrides);
 return override!==undefined?Number(override)>0:reset?.currentNode===9||Number(read(reset?.ownedSF))>0;
}
export function hacknetOptionsError(o,payoff) {
 for(const [key,value] of [['interval',o.interval],['max-spend',o['max-spend']],['max-payoff-time',payoff]])if(!Number.isFinite(value)||value<0)return key+' must be finite and nonnegative';
 if(o.reserve!=null&&(!Number.isFinite(o.reserve)||o.reserve<0))return 'reserve must be finite and nonnegative';
 return null;
}
export function hashOptionsError(o) {
 for(const key of ['interval','reserve-buffer','ignore-reserve-if-upgrade-cost-less-than-pct'])if(!Number.isFinite(o[key])||o[key]<0)return key+' must be finite and nonnegative';
 if(!Number.isSafeInteger(o['max-purchases-per-loop'])||o['max-purchases-per-loop']<1)return 'max-purchases-per-loop must be a positive integer';
 if(o.reserve!=null&&(!Number.isFinite(o.reserve)||o.reserve<0))return 'reserve must be finite and nonnegative';
 return null;
}
export function hashOverflowBuffer(production,interval,buffer=1) {return Math.max(0,production)*Math.max(200,interval)/1000+buffer;}
export function hashCapacityChoice(api,maxCost=Infinity) {
 const candidates=[];
 for(let i=0;i<api.numNodes();i++){const cost=api.getCacheUpgradeCost(i,1);if(Number.isFinite(cost)&&cost>0&&cost<=maxCost)candidates.push({kind:'cache',index:i,cost,gain:Number(api.getNodeStats?.(i)?.hashCapacity)||64});}
 const cost=api.getPurchaseNodeCost();if(api.numNodes()<api.maxNumNodes()&&Number.isFinite(cost)&&cost>0&&cost<=maxCost)candidates.push({kind:'node',cost,gain:64});
 const best=candidates.sort((a,b)=>a.cost/a.gain-b.cost/b.gain||a.cost-b.cost)[0];if(!best)return null;const {gain,...choice}=best;return choice;
}

/** Cash bottlenecks favor upgrades that repay within an hour. BN9 keeps its primary-engine policy. */
export function hacknetPayoffLimit(requested, plan, reset, now, ownerAlive) {
 if(ownerAlive&&plan?.reset===reset.lastAugReset&&plan?.expiresAt>now&&plan?.epoch<=now){
  if(plan.signals?.augmentationCashTarget)return Math.min(requested,3600);
  if(plan.signals?.route==='bladeburner')return Math.min(requested,7200);
 }
 if (reset.currentNode === 9 || !ownerAlive || plan?.reset !== reset.lastAugReset ||
     !(plan?.expiresAt > now) || plan?.epoch > now || plan?.signals?.bottleneck !== 'cash') return requested;
 return Math.min(requested, 3600);
}

/** Current native production, rather than a hypothetical idle fleet, funds a bounded cash investment. */
export function quoteHacknetInvestment(ns,candidate){
 try{
  if(!Number.isSafeInteger(ns.pid)||ns.pid<=0||!candidate||!['level','ram','cores'].includes(candidate.kind)||!Number.isSafeInteger(candidate.index)||candidate.index<0)return null;
  const s=ns.hacknet.getNodeStats(candidate.index),servers=Number(s.hashCapacity)>0;
  if(![s.production,s.level,s.ram,s.cores].every(v=>Number.isFinite(v)&&v>0)||servers&&candidate.kind==='ram')return null;
  const cost=candidate.kind==='level'?ns.hacknet.getLevelUpgradeCost(candidate.index,1):candidate.kind==='ram'?ns.hacknet.getRamUpgradeCost(candidate.index,1):ns.hacknet.getCoreUpgradeCost(candidate.index,1);
  if(!Number.isFinite(cost)||cost<=0||cost!==candidate.cost)return null;
  const ratio=candidate.kind==='level'?1/s.level:candidate.kind==='cores'?1/(s.cores+(servers?4:5)):Math.pow(1.035,s.ram)-1;
  const gain=s.production*ratio,reset=ns.getResetInfo(),now=Date.now();
  if(![reset.lastNodeReset,reset.lastAugReset].every(v=>Number.isFinite(v)&&v>=0))return null;
  let gainPerSecond=gain,delaySeconds=0,cashBatchSize=0;
  if(servers){
   if(!Number.isFinite(s.ramUsed)||s.ramUsed<0||s.ramUsed>=s.ram)return null;
   let cashWorker=false;
   for(const p of ns.ps('home')){
    if(p.filename.replace(/^\//,'')!=='spend-hacknet-hashes.js'||ns.read('remote-control/paused/spend-hacknet-hashes.js.txt').trim()==='true')continue;
    let receipt,status;try{receipt=JSON.parse(ns.read('tasks/hash-spending-'+p.pid+'.json'));status=JSON.parse(ns.read('tasks/hash-worker-status-'+p.pid+'.json'));}catch{continue;}
    const fresh=(v,age)=>v?.pid===p.pid&&v.nodeReset===reset.lastNodeReset&&v.augReset===reset.lastAugReset&&Number.isFinite(v.at)&&v.at<=now&&now-v.at<=age;
    if(fresh(receipt,30000)&&fresh(status,15000)&&receipt.action==='Sell for Money'&&receipt.success===true&&receipt.allowed===true&&Number.isFinite(receipt.spent)&&receipt.spent>0&&
     receipt.preferred==='Sell for Money'&&status.state==='spending'&&status.decision?.preferred==='Sell for Money'){cashWorker=true;break;}
   }
   if(!cashWorker)return null;
   const hashCost=ns.hacknet.hashCost('Sell for Money'),capacity=ns.hacknet.hashCapacity();
   if(!Number.isFinite(hashCost)||hashCost<=0||!Number.isFinite(capacity)||capacity<hashCost)return null;
   let production=0;for(let i=0;i<ns.hacknet.numNodes();i++){const rate=ns.hacknet.getNodeStats(i).production;if(!Number.isFinite(rate)||rate<0)return null;production+=rate;}
   gainPerSecond=gain*1e6/hashCost;delaySeconds=hashCost/(production+gain);cashBatchSize=1e6;
  }
  if(![gainPerSecond,delaySeconds].every(Number.isFinite)||gainPerSecond<=0||delaySeconds<0)return null;
  return {kind:'hacknet-production',at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,
   cost,gainPerSecond,delaySeconds,cashBatchSize,mode:servers?'hash':'money',upgrade:candidate.kind,index:candidate.index};
 }catch{return null;}
}
