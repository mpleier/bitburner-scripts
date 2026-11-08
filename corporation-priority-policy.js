/** Growth priority ends after private funding, profitable mature products and safe operating capital. */
export function corporationGrowthPhase(info,{enabled=true,reserve=0,pricingReady=false}={}) {
 const known=[info?.funds,info?.revenue,info?.expenses,reserve].every(Number.isFinite)&&reserve>=0;
 const mature=known&&info.public===true&&pricingReady===true&&info.revenue>info.expenses&&info.funds>=Math.max(1e9,reserve*5);
 return {active:enabled===true&&!mature,reason:!enabled?'Development priority disabled':mature?'Mature profitable corporation: release player income':'Prioritize private funding, products and pricing'};
}

/** Protect a near-term high-ranked purchase, not an indefinitely unaffordable wish list. */
export function corporationFundingGoal(plans,info,reserve,bank,{enabled=true,maxWaitSeconds=120}={}) {
 if(!enabled||![info?.funds,info?.revenue,info?.expenses,reserve,bank,maxWaitSeconds].every(Number.isFinite)||reserve<0||bank<0||maxWaitSeconds<=0)return null;
 const free=Math.max(0,info.funds-reserve),rate=Math.max(0,info.revenue-info.expenses)*.75;
 const ranked=plans.filter(p=>typeof p?.label==='string'&&Number.isFinite(p.cost)&&p.cost>0&&Number.isFinite(p.score)&&p.score>0)
  .sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||b.score-a.score||a.cost-b.cost);
 // A top-ranked wish-list item must not hide a reachable lower-ranked plan.
 for(const p of ranked){
  if(p.cost<=Math.min(bank,free))return null;
  const shortfall=Math.max(0,p.cost-Math.min(bank,free)),cashGap=Math.max(0,p.cost-free),waitSeconds=rate>0?shortfall/rate:null;
  const protect=waitSeconds!==null&&waitSeconds<=maxWaitSeconds;
  if(protect||cashGap>0&&cashGap<=16e9)
   return {label:p.label,cost:p.cost,cashGap,waitSeconds,protect,amount:protect?Math.min(bank,free,p.cost):0};
 }
 return null;
}

/** Quote the entire bounded reward sequence, including native escalating prices. */
export function corporationHashMilestone(funding,research,{funds,reserve,fundCost,researchCost,quote=null,maxHashes=5000,maxPurchases=16,remainingBudget=null}={}) {
 if(![funds,reserve].every(Number.isFinite)||reserve<0||funds<reserve)return null;
 if(!Number.isFinite(maxHashes)||maxHashes<=0||!Number.isSafeInteger(maxPurchases)||maxPurchases<1||maxPurchases>32)return null;
 const make=(action,label,gap,reward,extra={})=>{
  const purchases=Math.ceil(gap/reward);if(!(Number.isFinite(gap)&&gap>0&&purchases>=1&&purchases<=maxPurchases))return null;
  const key=JSON.stringify([action,label,action==='Sell for Corporation Funds'&&Number.isFinite(extra.target)?extra.target:null]);
  const remaining=remainingBudget?remainingBudget(key):{purchases:16,hashes:5000};
  if(!remaining||purchases>remaining.purchases)return null;
  let totalHashes;try{totalHashes=quote?quote(action,purchases):purchases===1?(action==='Sell for Corporation Funds'?fundCost:researchCost):Infinity;}catch{return null;}
  if(!Number.isFinite(totalHashes)||totalHashes<=0||totalHashes>Math.min(maxHashes,remaining.hashes))return null;
  return {action,label,gap,reward,purchases,totalHashes,key,...extra};
 };
 for(const r of research||[]){
  if(typeof r?.division!=='string'||typeof r.name!=='string'||![r.cost,r.points].every(Number.isFinite)||r.points<0)continue;
  const plan=make('Exchange for Corporation Research',r.division+': '+r.name,r.cost-r.points,1000,{division:r.division,research:r.name,target:r.cost});if(plan)return plan;
 }
 if(funding&&typeof funding.label==='string')return make('Sell for Corporation Funds',funding.label,funding.cashGap,1e9,{target:funding.cost,...(funding.staged===true?{staged:true}:{})});
 return null;
}

/** Display funding gaps without reserving cash for indefinitely unaffordable purchases. */
export function corporationFundingDiagnostics(plans,info,reserve,bank){
 if(![info?.funds,info?.revenue,info?.expenses,reserve,bank].every(Number.isFinite))return [];
 const free=Math.max(0,info.funds-Math.max(0,reserve)),available=Math.min(free,Math.max(0,bank)),rate=Math.max(0,info.revenue-info.expenses)*.75;
 const seen=new Set();
 return plans.filter(p=>typeof p?.label==='string'&&Number.isFinite(p.cost)&&p.cost>available&&!seen.has(p.label)&&seen.add(p.label)).slice(0,8).map(p=>({label:p.label,cost:p.cost,available,shortfall:p.cost-available,cashGap:Math.max(0,p.cost-free),budgetGap:Math.max(0,p.cost-available),cashAffordable:p.cost<=free,estimatedSeconds:rate>0?(p.cost-available)/rate:null,basis:'Current net profit at 75% retention; other spending and future growth excluded'}));
}
