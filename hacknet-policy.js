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
