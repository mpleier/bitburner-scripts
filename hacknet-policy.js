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
export function hashCapacityChoice(api) {
 const candidates=[];
 for(let i=0;i<api.numNodes();i++){const cost=api.getCacheUpgradeCost(i,1);if(Number.isFinite(cost)&&cost>0)candidates.push({kind:'cache',index:i,cost});}
 const cost=api.getPurchaseNodeCost();if(api.numNodes()<api.maxNumNodes()&&Number.isFinite(cost)&&cost>0)candidates.push({kind:'node',cost});
 return candidates.sort((a,b)=>a.cost-b.cost)[0]||null;
}
