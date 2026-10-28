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
 const p=ranked[0];if(!p||p.cost<=Math.min(bank,free))return null;
 const shortfall=Math.max(0,p.cost-Math.min(bank,free)),cashGap=Math.max(0,p.cost-free),waitSeconds=rate>0?shortfall/rate:null;
 const protect=waitSeconds!==null&&waitSeconds<=maxWaitSeconds;
 if(!protect&&!(cashGap>0&&cashGap<=1e9))return null;
 return {label:p.label,cost:p.cost,cashGap,waitSeconds,protect,amount:protect?Math.min(bank,free,p.cost):0};
}

/** Hash rewards must complete a quoted milestone in one purchase. Native consumers recheck usefulness. */
export function corporationHashMilestone(funding,research,{funds,reserve,fundCost,researchCost}={}) {
 if(![funds,reserve].every(Number.isFinite)||reserve<0||funds<reserve)return null;
 const priced=cost=>Number.isFinite(cost)&&cost>0&&cost<=5000;
 const r=research.find(r=>typeof r?.division==='string'&&typeof r.name==='string'&&[r.cost,r.points].every(Number.isFinite)&&r.points>=0&&r.cost>r.points&&r.cost-r.points<=1000);
 if(r&&priced(researchCost))return {action:'Exchange for Corporation Research',label:r.division+': '+r.name,gap:r.cost-r.points,reward:1000};
 if(funding&&Number.isFinite(funding.cashGap)&&funding.cashGap>0&&funding.cashGap<=1e9&&priced(fundCost))return {action:'Sell for Corporation Funds',label:funding.label,gap:funding.cashGap,reward:1e9};
 return null;
}

/** Display funding gaps without reserving cash for indefinitely unaffordable purchases. */
export function corporationFundingDiagnostics(plans,info,reserve,bank){
 if(![info?.funds,info?.revenue,info?.expenses,reserve,bank].every(Number.isFinite))return [];
 const free=Math.max(0,info.funds-Math.max(0,reserve)),available=Math.min(free,Math.max(0,bank)),rate=Math.max(0,info.revenue-info.expenses)*.75;
 const seen=new Set();
 return plans.filter(p=>typeof p?.label==='string'&&Number.isFinite(p.cost)&&p.cost>available&&!seen.has(p.label)&&seen.add(p.label)).slice(0,8).map(p=>({label:p.label,cost:p.cost,available,shortfall:p.cost-available,cashGap:Math.max(0,p.cost-free),estimatedSeconds:rate>0?(p.cost-available)/rate:null,basis:'Current net profit at 75% retention; other spending and future growth excluded'}));
}
