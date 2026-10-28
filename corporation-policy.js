import {corporationCalibrationQuote} from './corporation-calibration-policy.js';
import { officeJobCounts } from './automation-policy.js';
/** Material markups are additive dollars, not percentages of market price. */
export function materialSalePrice(item, data) {
 const quality = Number(item?.quality), markup = Number(data?.baseMarkup);
 if (!(quality >= 0) || !Number.isFinite(quality) || !(markup > 0) || !Number.isFinite(markup)) return 'MP';
 return `MP+${quality / markup}`;
}
export function outputBacklog(items) {
 return items.some(item => Number(item?.stored) > 0 && Number.isFinite(Number(item.actualSellAmount)) &&
  (Number(item.productionAmount) > 0 ?
    Number(item.stored) > Number(item.productionAmount) * 20 && Number(item.actualSellAmount) < Number(item.productionAmount) * 0.8 :
    Number(item.actualSellAmount) === 0));
}
export function boostPurchaseBudget(info, reserve, upkeep = 0, cycleSeconds = 10, {developmentSpeed=false}={}) {
 const cash = Math.max(0, Number(info.funds) || 0);
 const revenue = Math.max(0, Number(info.revenue) || 0), expenses = Math.max(0, Number(info.expenses) || 0);
 // A small startup allowance bootstraps a division before its first sales cycle.
 let allowance = revenue === 0 && expenses === 0 ? Math.min(10e6, cash * 0.01) : Math.max(0, revenue - expenses) * cycleSeconds * 0.5;
 const free=Math.max(0,cash-reserve-upkeep);
 if(developmentSpeed&&[cash,reserve,upkeep,cycleSeconds].every(Number.isFinite)&&cycleSeconds>0&&reserve>=0&&upkeep>=0&&
  (revenue>=expenses||free>=expenses*cycleSeconds*100))allowance=Math.max(allowance,Math.min(250e6,free*.02));
 return Math.max(0, Math.min(cash * 0.20, free, allowance));
}
export function treasuryPolicy(info, cycleSeconds = 10, {developmentSpeed=false}={}) {
 const cash = Math.max(0, Number(info.funds) || 0);
 const expenses = Math.max(0, Number(info.expenses) || 0);
 const reserve = Math.max(1e6, Math.min(5e9, cash * 0.1), expenses * cycleSeconds * 2);
 const recovering = cash < Math.max(10e6, reserve * 1.5);
 const spendable = Math.max(0, cash - reserve);
 const profitBudget = Math.max(0, (Number(info.revenue) || 0) - expenses) * cycleSeconds * 0.25;
 return { reserve, recovering, upkeepBudget: recovering ? 0 : Math.min(spendable, cash * 0.02, developmentSpeed?Math.max(profitBudget,spendable*.01):profitBudget) };
}
export function recoveryJobCounts(employees, products, recovering) {
 const interns = recovering && employees >= 6 ? Math.min(employees - 5, Math.ceil(employees * 0.25)) : 0;
 const productive = employees - interns;
 const jobs = interns > 0 ? officeJobCounts(productive - 5, products).map(count => count + 1) : officeJobCounts(productive, products);
 return [...jobs, interns];
}
export function priorSaleMultiplier(price) {
 const match = String(price ?? '').match(/^MP\s*\*\s*(\d+(?:\.\d+)?)$/);
 const value = Number(match?.[1]);
 return value > 0 && Number.isFinite(value) ? Math.max(1, Math.min(1e6, value)) : 1;
}
export function partySpendPerEmployee(morale, target, employees, budget) {
 if (!(employees > 0) || !(budget > 0) || !(morale > 0) || morale >= target - 1) return 0;
 // The game applies (morale + (multiplier-1)*10) * multiplier next START.
 const multiplier = (-(morale - 10) + Math.sqrt((morale - 10) ** 2 + 40 * target)) / 20;
 const needed = Math.max(0, multiplier - 1) * 1e7;
 const spend = Math.min(needed, budget / employees);
 // Tiny parties cannot offset natural decay and waste scarce operating cash.
 return spend >= 100000 ? spend : 0;
}

/** Discover the sell-through boundary quickly, then refine it geometrically. */
export function productPriceStep(item,state={},cycleSeconds=10){
 const current=Math.max(1,Number(state.multiplier)||priorSaleMultiplier(item?.desiredSellPrice));
 const produced=Number(item?.productionAmount),sold=Number(item?.actualSellAmount),stored=Number(item?.stored);
 if(!(produced>0)||!Number.isFinite(sold)||!(stored>=0))return {...state,multiplier:current};
 const rating=Number(item.effectiveRating??item.rating)||0;
 const changed=state.rating>0&&Math.abs(rating/state.rating-1)>.25;
 let low=changed?1:Math.max(1,Number(state.low)||1),high=changed?null:state.high;
 // Inventory is in units; production and actual sales are units per second.
 const clearing=sold>=produced*.98&&stored<=produced*cycleSeconds*.2;
 const blocked=sold<produced*.9||stored>produced*cycleSeconds*2;
 if(clearing){low=current;if(high&&high<=low)high=null;}
 else if(blocked){high=current;if(low>=high)low=1;}
 else return {...state,multiplier:current,rating};
 let multiplier=blocked&&current<=1?1:high?Math.sqrt(low*high):Math.min(1e6,current*2);
 // A large inventory needs sales above production. Invert the native square markup penalty
 // using observed sell-through; keep the production-cost floor while draining over three cycles.
 if(blocked&&stored>produced*cycleSeconds*2&&sold<produced*.9&&current>1){
  const target=produced+stored/(cycleSeconds*3);
  const recovery=1+(current-1)*(sold>0?Math.sqrt(sold/target):.25);
  multiplier=Math.min(multiplier,recovery);
  if(multiplier<low)low=1;
 }
 return {multiplier:Math.max(1,Math.min(1e6,multiplier)),low,high,rating};
}
/** Leave RP in the pool for production quality; TA.I and II are bought together. */
export function researchAffordable(points,cost,fraction=.2){return Number.isFinite(points)&&Number.isFinite(cost)&&cost>=0&&points>=cost&&cost<=points*fraction;}

/** Division.processSaleState and getAdvertisingFactors, evaluated in log space. */
export function salesPotential(item,division,industry,office,salesBots=0,product=false){
 const demand=item?.demand,competition=item?.competition,business=office?.employeeProductionByJob?.Business;
 const awareness=division?.awareness,popularity=division?.popularity,factor=industry?.advertisingFactor;
 if(![demand,competition,business,awareness,popularity,factor,salesBots].every(Number.isFinite)||business<0||awareness<0||popularity<0||factor<0)return null;
 const quality=product? .5*Math.max(0,Number(item.effectiveRating))**.65 : Number(item.quality)+.001;
 if(!(quality>0)||!Number.isFinite(quality))return null;
 const bp=1+business,businessFactor=bp**.26+bp*.0001;
 const ratio=awareness>0?Math.max(.01,(popularity+.001)/awareness):.01;
 const logAdvert=.85*(factor*Math.log1p(awareness)+factor*Math.log1p(popularity)+Math.log(ratio));
 const market=Math.max(.1,demand*(100-competition)*.01);
 const logPotential=Math.log(quality)+Math.log(businessFactor)+logAdvert+Math.log(market)+Math.log1p(.01*Math.max(0,salesBots));
 const value=Math.exp(Math.min(Math.log(Number.MAX_VALUE),logPotential));return value>0&&Number.isFinite(value)?value:null;
}
export function formulaSalePrice(item,potential,markupLimit,cycleSeconds=10){
 const base=Number(item?.marketPrice??item?.productionCost),production=Number(item?.productionAmount),stock=Number(item?.stored);
 if(!(potential>0)||!Number.isFinite(potential)||!(markupLimit>=0)||!Number.isFinite(markupLimit)||!(base>0)||!Number.isFinite(production)||production<0||!Number.isFinite(stock)||stock<0||!(cycleSeconds>0))return null;
 // At START the previous cycle's unsold inventory remains; next production adds a cycle's output.
 const target=production+stock/cycleSeconds;if(!(target>0))return null;
 const premium=Math.min(Number.MAX_VALUE-base,markupLimit*Math.sqrt(potential/target));
 return Number.isFinite(premium)?{price:'MP+'+premium,base,premium,target,potential,rating:Number(item.effectiveRating)||0}:null;
}
/** Infer immutable product markup only from an uncapped, penalized sales observation. */
export function inferProductMarkup(item,previous){
 const sold=Number(item?.actualSellAmount);
 if(!previous||!(previous.rating>0)||!(previous.potential>0)||!(previous.target>0)||!(previous.premium>0)||!(sold>0)||sold>=previous.target*.95||sold>=previous.potential*.95)return null;
 const limit=previous.premium*Math.sqrt(sold/previous.potential),markup=previous.rating/limit;
 return markup>0&&Number.isFinite(markup)?markup:null;
}
export function supportAdvertLimit(division,achievement=false){return !achievement&&!division?.makesProducts&&Number(division?.numAdVerts)>=8;}

/** Each rate persists independently; an irrelevant material must not skip input cleanup. */
export function clearCorporationBuyRates(c){
 let names=[];try{names=c.getCorporation().divisions;}catch{return;}
 for(const name of names){
  let d,industry;try{d=c.getDivision(name);industry=c.getIndustryData(d.industry);}catch{continue;}
  for(const city of d.cities||[]){
   try{if(!c.hasWarehouse(name,city))continue;}catch{continue;}
   for(const material of new Set(['Real Estate','Hardware','Robots','AI Cores',...Object.keys(industry.requiredMaterials||{})]))try{c.buyMaterial(name,city,material,0);}catch{}
  }
 }
}


/** Evaluate production/development using the source office formulas; staffing weights also preserve sales and research. */
export function corporationOfficeScore(counts,perWorker,developing=false,context={}){
 const [op,en,bus,mg,rd]=counts.map((n,i)=>n*perWorker[i]),total=op+en+mg;
 if(!(total>0))return 0;
 const management=1+mg/(1.2*total),output=(op**.4+en**.3)*management,development=(en**.34+op**.2)*management;
 const business=(1+bus)**.26+(1+bus)*.0001;
 const speed=developing&&context.developmentSpeed;
 const researchWeight=Number.isFinite(context.researchWeight)?Math.max(0,context.researchWeight):(developing?.12:.08);
 const quality=context.materialQuality?estimatedMaterialQuality(en,context.materialQuality):1;
 return (developing?development:output)*business**(speed?.02:developing?.05:.2)*(1+rd)**(speed?Math.min(.04,researchWeight):researchWeight)*quality**.35;
}
export function optimizedOfficeJobs(office,products,developing=false,recovering=false,context={}){
 const n=Math.max(0,Math.floor(Number(office.numEmployees)||0)),initial=recoveryJobCounts(n,products,recovering),interns=initial[5];
 if(n-interns<6){
  // Small material offices alternate a sales worker into research for one full cycle in five.
  // Keep Operations and Engineering staffed; do not disturb recovery or product development.
  if(!products&&!recovering&&context.protectResearch&&context.researchPulse===true&&n>=3&&initial[4]===0&&initial[2]>0){initial[2]--;initial[4]++;}
  return initial;
 }
 const jobs=['Operations','Engineer','Business','Management','Research & Development'];
 const counts=initial.slice(0,5),exp=Math.max(0,Number(office.totalExperience)||0)/Math.max(1,n);
 const intelligence=Number(office.avgIntelligence)||75,charisma=Number(office.avgCharisma)||75,creativity=Number(office.avgCreativity)||75,efficiency=Number(office.avgEfficiency)||75;
 const base=[.6*intelligence+.1*charisma+exp+.5*creativity+efficiency,intelligence+.1*charisma+1.5*exp+efficiency,.4*intelligence+charisma+.5*exp,2*charisma+exp+.2*creativity+.7*efficiency,1.5*intelligence+.8*exp+creativity+.5*efficiency];
 const minimum=initial.slice(0,5).map(()=>1);
 if(context.protectResearch)minimum[4]=Math.max(1,initial[4]);
 // Unknown quality inputs retain a conservative engineering floor in material offices.
 if(!products&&context.protectEngineering)minimum[1]=Math.max(1,Math.ceil(initial[1]/2));
 const perWorker=jobs.map((job,i)=>{const assigned=Number(office.employeeJobs?.[job]),production=Number(office.employeeProductionByJob?.[job]);return assigned>0&&production>0&&Number.isFinite(production)?production/assigned:base[i]*(Number(office.avgMorale)||75)*(Number(office.avgEnergy)||75)/10000;});
 // Keep every role represented. Local search is bounded even in achievement-sized offices.
 for(let steps=0;steps<Math.min(120,n*5);steps++){
  let best=corporationOfficeScore(counts,perWorker,developing,context),move;
  for(let from=0;from<5;from++)if(counts[from]>minimum[from])for(let to=0;to<5;to++)if(to!==from){const next=[...counts];next[from]--;next[to]++;const score=corporationOfficeScore(next,perWorker,developing,context);if(score>best*(1+1e-9)){best=score;move=next;}}
  if(!move)break;counts.splice(0,5,...move);
 }
 return [...counts,interns];
}
/** Select the strongest available development office; an existing project keeps its creation city. */
export function corporationDevelopmentCity(offices,activeProduct=null){
 if(activeProduct?.creationCity&&offices.some(o=>o.city===activeProduct.creationCity))return activeProduct.creationCity;
 return [...offices].sort((a,b)=>corporationOfficeScore([1,1,1,1,1],['Operations','Engineer','Business','Management','Research & Development'].map(k=>Number(b.employeeProductionByJob?.[k])||Number(b.numEmployees)||1),true)-corporationOfficeScore([1,1,1,1,1],['Operations','Engineer','Business','Management','Research & Development'].map(k=>Number(a.employeeProductionByJob?.[k])||Number(a.numEmployees)||1),true)||String(a.city).localeCompare(String(b.city)))[0]?.city||null;
}
/** Shared capital planner: score is an estimated fractional benefit per dollar, not a measured payback. */
export function executeCorporationGrowth(plans,budget,cash,reserve,allowed=()=>true,options={}){
 let remaining=Number.isFinite(budget)?Math.max(0,budget):0,spent=0;const decisions=[],claimedAlternatives=new Set();
 const goal=options.hold;let held=goal?.protect===true&&typeof goal.label==='string'&&Number.isFinite(goal.amount)&&goal.amount>0?Math.min(remaining,goal.amount):0;
 for(const plan of [...plans].filter(p=>Number.isFinite(p.cost)&&p.cost>0&&Number.isFinite(p.score)).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||b.score-a.score||a.cost-b.cost)){
  if(!allowed())break;
  const alternatives=plan.exclusive??[];
  if(!Array.isArray(alternatives)||alternatives.length>4||alternatives.some(k=>typeof k!=='string'||!k)){decisions.push({label:plan.label,state:'invalid-alternatives',cost:0});continue;}
  if(alternatives.some(k=>claimedAlternatives.has(k))){decisions.push({label:plan.label,state:'alternative-purchased',cost:0});continue;}
  const evidence={...(plan.growthBasis?{basis:plan.growthBasis,profitPerSecond:plan.profitPerSecond,bottleneckFactor:plan.bottleneckFactor,score:plan.score}:{}),...(plan.delayedReturn?{delayedReturn:plan.delayedReturn}:{})};
  const hold=typeof reserve==='function'?reserve():reserve;
  const target=held>0&&plan.label===goal.label,available=Math.max(0,remaining-(target?0:held));
  if(plan.cost>available||!Number.isFinite(cash())||!Number.isFinite(hold)||cash()<=hold+plan.cost){decisions.push({label:plan.label,state:held>0&&!target&&plan.cost<=remaining?'growth-reserved':'budget-wait',cost:plan.cost,...evidence});continue;}
  if(target)held=0;
  const before=cash();let ok=false;try{ok=plan.run()!==false;}catch{}
  const paid=Math.max(0,before-cash()),committed=ok?Math.max(0,Number(plan.commit)||0):0,charged=Math.max(paid,committed);remaining=Math.max(0,remaining-charged);spent+=charged;
  if(ok||charged>0)for(const key of alternatives)claimedAlternatives.add(key);
  const quote=ok&&!committed?corporationCalibrationQuote(plan):null;
  decisions.push({label:plan.label,state:ok?(committed?'ordered':'purchased'):'rejected',cost:charged,...evidence,...(plan.advertisingBundle?{advertisingBundle:plan.advertisingBundle,advertisingReceipt:{...plan.advertisingReceipt}}:{}),...(plan.calibration?{calibration:plan.calibration}:{}),...(quote?{market:plan.market,calibrationQuote:quote}:{})});
 }
 return {remaining,spent,decisions};
}
export function usefulUpkeepResearch(name,offices,points,cost){
 if(!['AutoBrew','AutoPartyManager'].includes(name)||!researchAffordable(points,cost,.2))return false;
 return offices.some(o=>o.numEmployees>=9&&Number(name==='AutoBrew'?o.avgEnergy:o.avgMorale)<Number(name==='AutoBrew'?o.maxEnergy??100:o.maxMorale??100)-1);
}
/** Replace weak mature products after observed development time, preserving inventory sell-through and research improvements. */
export function productReplacementReady({product,investment,at=0,now=Date.now(),developmentMs=0,baselineResearch=0,research=0,baselineEmployees=0,employees=0,cycleSeconds=10}){
 const elapsed=now-at,settling=Math.max(cycleSeconds*1000*10,developmentMs*1.5);
 if(elapsed<settling||!(investment>0))return false;
 const oldInvestment=Number(product.designInvestment)||0;
 const stronger=oldInvestment>0&&investment>=oldInvestment*1.2||baselineResearch>0&&research>=baselineResearch*1.25||baselineEmployees>0&&employees>=baselineEmployees*1.2;
 // Missing historical evidence cannot justify retiring a revenue-producing product.
 return stronger;
}

export function corporationAdvertBenefit(division,industry,wilson=0){
 const a=Number(division.awareness)||0,p=Number(division.popularity)||0,f=Number(industry.advertisingFactor)||0,m=1+.005*Math.max(0,wilson);
 if(f<=0||a>=Number.MAX_VALUE||p>=Number.MAX_VALUE)return 0;
 const log=(aw,pop)=>.85*(f*Math.log1p(aw)+f*Math.log1p(pop)+Math.log(aw>0?Math.max(.01,(pop+.001)/aw):.01));
 const nextA=(a+3*m)*1.005*m,nextP=(p+m)*1.01*m;
 return Math.max(0,Math.expm1(Math.min(20,log(nextA,nextP)-log(a,p))));
}

/** Source material quality includes engineering, the RP pool, AI cores, and input quality. */
export function estimatedMaterialQuality(engineering,{points=0,researchFactor=0,aiStored=0,aiFactor=0,inputQuality=1}={}){
 const values=[engineering,points,researchFactor,aiStored,aiFactor,inputQuality];
 if(!values.every(Number.isFinite)||values.some(x=>x<0))return 1;
 const temp=engineering/90+points**researchFactor+aiStored**aiFactor/10000;
 if(!Number.isFinite(temp))return 1;
 return Math.max(1,Math.min(temp,Math.max(1,inputQuality)*Math.max(1,Math.sqrt(temp))));
}
/** Staffing goals use the same retained-pool requirements as the research purchase policy. */
export function corporationResearchGoal({laboratory=false,ta1=false,ta2=false,points=0,laboratoryCost,ta1Cost,ta2Cost}={},products=false,context=null){
 const stage=ta2?'quality':laboratory?'pricing':'laboratory';
 const cost=stage==='laboratory'?laboratoryCost:stage==='pricing'?(ta1?0:ta1Cost)+ta2Cost:0;
 const target=stage==='quality'?0:corporationResearchDecision({name:stage==='laboratory'?'Hi-Tech R&D Laboratory':'Market-TA.II',points,cost,context}).target;
 const progress=target>0&&Number.isFinite(points)?Math.max(0,Math.min(1,points/target)):stage==='quality'?1:0;
 return {stage,target,points:Number.isFinite(points)?Math.max(0,points):0,progress,protectResearch:!ta2,protectEngineering:!products,researchWeight:ta2?.08:laboratory?.18:.20};
}

/** Core launches may use retained unallocated cash, but keep setup money and the operating reserve. */
export function corporationCoreFunding(funds,reserve,cost,bank,setup=5e9){
 if(![funds,reserve,cost,bank,setup].every(Number.isFinite)||funds<0||reserve<0||cost<=0||setup<0)return {ready:false,budget:0};
 const free=Math.max(0,funds-reserve),ready=free>cost+setup;
 return {ready,budget:Math.min(free,Math.max(0,bank,ready?cost+setup:0))};
}
/** Use the public industry field; older test data may use the internal division name. */
export function corporationScienceFactor(industry){
 const factor=Number(industry?.scienceFactor??industry?.researchFactor??0);
 return Number.isFinite(factor)&&factor>=0?factor:0;
}

/** Allocate observed division profit using each output's observed city sales share.
 * Prices and local costs are unavailable: this is a contribution estimate, not city profit.
 * Missing city/output readings retain the equal-share fallback and the division total. */
export function allocateCorporationCityProfit(rows){
 const groups=new Map();for(const row of rows){if(!row||typeof row.division!=='string')continue;
  if(!groups.has(row.division))groups.set(row.division,[]);groups.get(row.division).push(row);}
 const allocations=new Map();
 for(const group of groups.values()){
  const complete=group.every(r=>r.expectedCities===group.length&&Array.isArray(r.outputs)&&r.outputs.length>0&&
   r.outputs.every(o=>typeof o.name==='string'&&Number.isFinite(o.sold)&&o.sold>=0&&Number.isFinite(o.produced)&&o.produced>=0));
  if(!complete)continue;
  const names=[...new Set(group.flatMap(r=>r.outputs.map(o=>o.name)))];
  if(!group.every(r=>names.every(n=>r.outputs.some(o=>o.name===n))))continue;
  const shares=group.map(()=>0);let count=0;
  for(const name of names){
   const values=group.map(r=>r.outputs.find(o=>o.name===name).sold),sum=values.reduce((a,b)=>a+b,0);
   if(sum<=0)continue;count++;values.forEach((v,i)=>shares[i]+=v/sum);
  }
  if(!count)continue;
  const total=group.reduce((n,r)=>n+r.profitPerSecond,0);if(!Number.isFinite(total))continue;
  group.forEach((r,i)=>allocations.set(r,{...r,profitPerSecond:total*shares[i]/count,profitBasis:'Estimated city contribution from observed output sales'}));
 }
 return rows.map(r=>allocations.get(r)||r);
}

/** Completed-cycle evidence. Profit is divided equally across a division's cities by the caller. */
export function observeCorporationGrowth(previous,{scope,at,rows}={}){
 const locations={};if(typeof scope!=='string'||!Number.isFinite(at)||!Array.isArray(rows))return {scope,at,locations};
 const old=previous?.scope===scope&&previous.at<=at&&at-previous.at<=120000?previous.locations||{}:{};
 for(const row of allocateCorporationCityProfit(rows.slice(0,128))){
  if(typeof row?.key!=='string'||typeof row.division!=='string'||!Number.isFinite(row.profitPerSecond)||
   row.sellThrough!==null&&(!Number.isFinite(row.sellThrough)||row.sellThrough<0||row.sellThrough>1)||!Number.isFinite(row.pressure)||row.pressure<0)continue;
  const samples=(Array.isArray(old[row.key]?.samples)?old[row.key].samples:[]).filter(s=>Number.isFinite(s.at)&&s.at<at&&at-s.at<=120000&&Number.isFinite(s.profitPerSecond)&&(s.sellThrough===null||Number.isFinite(s.sellThrough)&&s.sellThrough>=0&&s.sellThrough<=1)).slice(-2);
  samples.push({...row,at});
  const ready=samples.length===3;
  locations[row.key]={division:row.division,city:row.city,samples,ready,profitBasis:row.profitBasis||'Equal share of observed division profit',
   profitPerSecond:ready?Math.max(0,Math.min(...samples.map(s=>s.profitPerSecond))):0,
   sellThrough:ready&&samples.every(s=>s.sellThrough!==null)?Math.min(...samples.map(s=>s.sellThrough)):null,
   backlog:ready&&samples.slice(-2).every(s=>s.backlog===true),pressure:row.pressure};
 }
 return {scope,at,locations};
}

/** Scale estimated upgrade effects by observed profit; this is not causal measured upgrade payback. */
export function scoreCorporationGrowth(plans,market){
 const rows=Object.values(market?.locations||{}).filter(r=>r&&r.ready&&Number.isFinite(r.profitPerSecond)&&r.profitPerSecond>=0);
 if(!rows.length)return plans;
 const reference=rows.reduce((sum,r)=>sum+r.profitPerSecond,0);
 return plans.flatMap(plan=>{
  const context=plan.market||{},kind=context.kind||'other';
  const scoped=rows.filter(r=>(!context.division||r.division===context.division)&&(!context.city||r.city===context.city));
  const measured=scoped.reduce((sum,r)=>sum+r.profitPerSecond,0);
  const base=measured>0?measured:reference>0?reference/Math.max(1,rows.length):1;
  let factor=1;
  if(scoped.length&&['production','storage','sales'].includes(kind)){
   const weights=scoped.map(r=>Math.max(1,r.profitPerSecond)),total=weights.reduce((a,b)=>a+b,0);
   factor=scoped.reduce((sum,r,i)=>{
    const sell=r.sellThrough??1;
    const demandBlocked=Array.isArray(r.samples)&&r.samples.length>=3&&r.samples.slice(-3).every(s=>Number.isFinite(s.sellThrough)&&s.sellThrough<.8);
    if(kind==='production'&&demandBlocked)return sum;
    const value=kind==='production'?(r.backlog?0:sell):kind==='storage'?(r.backlog?0:r.pressure>.8?1+(r.pressure-.8)*5:.1):r.backlog?2:sell<.95?1.5:.5;
    return sum+weights[i]*value;
   },0)/total;
  }
  if(factor===0&&['production','storage'].includes(kind)&&!(plan.priority>0))return [];
  return [{...plan,score:plan.score*base*factor,growthBasis:measured>0?(context.city?'Estimated city contribution with estimated marginal benefit':'Observed division profit with estimated marginal benefit'):'Comparable heuristic with observed bottleneck',profitPerSecond:measured,bottleneckFactor:factor}];
 });
}

/** A bounded share of retained capital can compete for scored growth plans each cycle. */
export function corporationGrowthBudget(info,reserve,bank,cycleSeconds=10,developmentSpeed=false) {
 const cash=Number(info?.funds),revenue=Number(info?.revenue),expenses=Number(info?.expenses);
 if(![cash,revenue,expenses,reserve,cycleSeconds].every(Number.isFinite)||cash<0||reserve<0||cycleSeconds<=0||bank!==null&&(!Number.isFinite(bank)||bank<0))return 0;
 const free=Math.max(0,cash-reserve),profit=Math.max(0,revenue-expenses)*cycleSeconds;
 const retained=bank===null?free:bank;
 return Math.min(free,Math.max(retained+profit*(developmentSpeed?.75:.25),developmentSpeed?free*.15:0));
}
/** Tea and party requests, not a recurring fixed expense allowance. */
export function corporationOfficeUpkeepNeed(office,teaCostPerEmployee=500000) {
 const n=Number(office?.numEmployees),energy=Number(office?.avgEnergy),morale=Number(office?.avgMorale),maxEnergy=Number(office?.maxEnergy??100),maxMorale=Number(office?.maxMorale??100);
 if(![n,energy,morale,maxEnergy,maxMorale,teaCostPerEmployee].every(Number.isFinite)||n<=0||teaCostPerEmployee<0)return {tea:0,party:0,total:0};
 const tea=!office.autoTea&&energy<maxEnergy-2?n*teaCostPerEmployee:0;
 const party=office.autoParty?0:n*partySpendPerEmployee(morale,maxMorale,n,Number.MAX_VALUE);
 return {tea,party,total:tea+party};
}
export function allocateCorporationUpkeep(rows,budget,teaCostPerEmployee=500000) {
 const allocations=new Map();let remaining=Number.isFinite(budget)?Math.max(0,budget):0;
 for(const row of [...rows].sort((a,b)=>Number(b.product)-Number(a.product))){
  const need=corporationOfficeUpkeepNeed(row.office,teaCostPerEmployee);
  const tea=need.tea<=remaining?need.tea:0;remaining-=tea;
  const party=Math.min(need.party,remaining);remaining-=party;
  allocations.set(row.key,tea+party);
 }
 return allocations;
}
/** Estimate a three-seat HQ expansion; no claim of measured upgrade payback. */
export function corporationDevelopmentExpansion({size,cost,free,profitPerSecond=0,remainingMs=null,horizonSeconds=21600}={}) {
 if(![size,cost,free,profitPerSecond,horizonSeconds].every(Number.isFinite)||size<3||cost<=0||free<0||horizonSeconds<=0||cost>free*.1)return {ready:false};
 const benefit=((size+3)/size)**.34-1;
 const savedMs=Number.isFinite(remainingMs)&&remainingMs>0?remainingMs*(1-1/(1+benefit)):0;
 const payback=profitPerSecond>0?cost/(profitPerSecond*benefit):Infinity;
 return {ready:payback<=horizonSeconds||savedMs>=10000,benefit,paybackSeconds:payback,savedMs};
}

/** Conservative opportunity model, not a measured cash ROI. Unknown evidence retains legacy reserves. */
export function corporationResearchDecision({name,points,cost,context=null,legacyTarget=null}={}) {
 const legacyFraction=['Hi-Tech R&D Laboratory','Market-TA.II'].includes(name)?.5:.2;
 const target=Number.isFinite(cost)&&cost>=0?(Number.isFinite(legacyTarget)&&legacyTarget>=cost?legacyTarget:cost/legacyFraction):null;
 const base={ready:false,early:false,target,reason:'Retaining the research pool'};
 if(!Number.isFinite(points)||points<0||target===null||points<cost)return {...base,reason:'Research is not affordable'};
 const upkeepName=['AutoBrew','AutoPartyManager','AutoBrew + AutoPartyManager'].includes(name),upkeep=context?.upkeepValues?.[name];
 if(upkeepName&&(!upkeep?.known||!Number.isFinite(upkeep.benefit)||upkeep.benefit<=0))return {...base,reason:'Waiting for observed upkeep savings or unfunded recovery benefit'};
 const legacyReady=points>=target,fallback=legacyReady?{...base,ready:true,reason:'Legacy retained-pool threshold reached'}:base;
 const rateKnown=Number.isFinite(context?.rate)&&context.rate>0;
 if(!context?.valid||!legacyReady&&(!rateKnown||points<cost*1.25))return legacyReady?fallback:{...base,reason:'Waiting for evidence or a minimum retained pool'};
 const factor=context.scienceFactor;
 if(!Number.isFinite(factor)||factor<0||factor>1)return fallback;
 const remaining=points-cost;
 let loss=0;
 if(context.products){
  const before=1+points**factor/800,after=1+remaining**factor/800;loss=1-after/before;
 }else{
  if(!Array.isArray(context.qualityRows)||!context.qualityRows.length)return fallback;
  for(const row of context.qualityRows){
   if(![row.engineering,row.aiStored,row.aiFactor,row.inputQuality].every(Number.isFinite)||[row.engineering,row.aiStored,row.aiFactor,row.inputQuality].some(n=>n<0))return fallback;
   const quality=pool=>estimatedMaterialQuality(row.engineering,{points:pool,researchFactor:factor,aiStored:row.aiStored,aiFactor:row.aiFactor,inputQuality:row.inputQuality});
   loss=Math.max(loss,1-quality(remaining)/quality(points));
  }
 }
 let benefit=0;
 if(upkeepName)benefit=Math.max(0,Math.min(.5,upkeep.benefit));
 else if(name==='Hi-Tech R&D Laboratory')benefit=.1;
 else if(name==='Market-TA.II'&&context.salesReady&&Number.isFinite(context.pricingGap))benefit=Math.min(.25,Math.max(0,context.pricingGap));
 else if(context.salesReady&&!context.backlog){
  const effects={'Self-Correcting Assemblers':.1,'Drones - Assembly':.2,'uPgrade: Fulcrum':context.products?.05:0};
  benefit=(effects[name]||0)*Math.max(0,Math.min(1,context.sellThrough));
  if(['uPgrade: Capacity.I','uPgrade: Capacity.II'].includes(name)&&context.products&&context.canFundProduct&&context.maxProducts>0&&context.matureProducts>=context.maxProducts)benefit=1/context.maxProducts;
 }
 const horizon=1800,waitSeconds=legacyReady?0:(target-points)/context.rate;
 const early=benefit*Math.min(horizon,waitSeconds)>loss*horizon*1.25&&benefit>0;
 return {...base,ready:(!upkeepName||benefit>1.25*loss)&&(legacyReady||early),early:!legacyReady&&early,target:!legacyReady&&early?points:target,qualityLoss:loss,estimatedBenefit:benefit,waitSeconds,upkeep:upkeepName?upkeep:undefined,
  reason:upkeepName&&benefit<=1.25*loss?'Retained-pool quality cost exceeds the upkeep benefit':legacyReady?'Legacy retained-pool threshold reached':early?'Estimated earlier unlock benefit exceeds conservative retained-pool quality cost':'Retained-pool quality cost or short wait outweighs earlier unlock'};
}

/** Remove our own prior research spend from the observed production delta. */
export function corporationResearchRate(previous,points,now=Date.now()) {
 if(!Number.isFinite(points)||points<0||![previous?.at,previous?.points,previous?.spent,now].every(Number.isFinite)||previous.points<0||previous.spent<0||previous.spent>previous.points)return null;
 const elapsed=now-previous.at,gain=points-previous.points+previous.spent;
 return elapsed>0&&elapsed<=120000&&gain>=0?gain/(elapsed/1000):null;
}

/** Quote bounded prerequisite closures without changing ownership or budgets. */
export function planCorporationResearchBundles({names=[],owned=[],costs={},parents={},points,context=null}={}) {
 if(!Array.isArray(names)||names.length>256||!Array.isArray(owned)||!Number.isFinite(points)||points<0)return [];
 const have=new Set(owned),catalog=new Set(names),plans=[];
 const addPlan=(target,items)=>{
  let cost=0,legacyTarget=0;
  for(const item of items){const fraction=['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'].includes(item.name)?.5:.2;legacyTarget=Math.max(legacyTarget,cost+item.cost/fraction);cost+=item.cost;}
  const decision=corporationResearchDecision({name:target,points,cost,context,legacyTarget});
  if(!decision.ready||!Number.isFinite(cost)||cost<=0)return;
  const score=Number.isFinite(decision.estimatedBenefit)&&Number.isFinite(decision.qualityLoss)?Math.max(0,decision.estimatedBenefit-1.25*decision.qualityLoss)/cost:0;
  if(!Number.isFinite(score)||score<0)return;
  plans.push({target,items,cost,retainedPoints:points-cost,decision,score,order:plans.length});
 };
 for(const target of catalog){
  if(have.has(target)||['Drones','Automatic Drug Administration'].includes(target))continue;
  const items=[],visiting=new Set(),done=new Set();
  const visit=name=>{
   if(have.has(name)||done.has(name))return true;
   if(!catalog.has(name)||visiting.has(name)||visiting.size>=32||typeof name!=='string')return false;
   const cost=costs[name],parent=name==='Hi-Tech R&D Laboratory'?null:parents[name]||'Hi-Tech R&D Laboratory';
   if(!Number.isFinite(cost)||cost<0)return false;
   visiting.add(name);if(parent&&!visit(parent))return false;visiting.delete(name);
   done.add(name);items.push({name,cost,parent});return true;
  };
  if(!visit(target)||items.length<1)continue;
  addPlan(target,items);
 }
 const pair='AutoBrew + AutoPartyManager',joint=context?.upkeepValues?.[pair];
 if(catalog.has('AutoBrew')&&catalog.has('AutoPartyManager')&&!have.has('AutoBrew')&&!have.has('AutoPartyManager')&&have.has('Hi-Tech R&D Laboratory')&&
  joint?.known&&joint.benefit>Math.max(context?.upkeepValues?.AutoBrew?.benefit||0,context?.upkeepValues?.AutoPartyManager?.benefit||0)+1e-9){
  const items=['AutoBrew','AutoPartyManager'].map(name=>({name,cost:costs[name],parent:'Hi-Tech R&D Laboratory'}));
  if(items.every(item=>Number.isFinite(item.cost)&&item.cost>=0))addPlan(pair,items.sort((a,b)=>b.cost-a.cost));
 }
 return plans.sort((a,b)=>b.score-a.score||a.order-b.order);
}

/** Recheck the entire remaining package and retained pool before every native mutation. */
export function executeCorporationResearchBundle(api,plan,allowed=()=>true) {
 const purchased=[];let spent=0;
 const result=(complete,reason)=>({complete,reason,purchased,spent});
 try{
  if(!Array.isArray(plan?.items)||!plan.items.length||plan.items.length>32||!Number.isFinite(plan.retainedPoints)||plan.retainedPoints<0)return result(false,'Invalid research package');
  const names=new Set();
  for(const item of plan.items){
   if(typeof item.name!=='string'||!item.name||names.has(item.name)||!Number.isFinite(item.cost)||item.cost<0)return result(false,'Malformed research package');
   if(item.parent&&!names.has(item.parent)&&api.owned(item.parent)!==true)return result(false,'Research package prerequisite is missing');
   names.add(item.name);
  }
  for(let i=0;i<plan.items.length;i++){
   if(!allowed())return result(false,'Research control is paused');
   const remaining=[];
   for(const item of plan.items.slice(i)){
    const owned=api.owned(item.name);if(owned===true)continue;if(owned!==false)return result(false,'Research ownership unavailable');
    const cost=api.cost(item.name);if(!Number.isFinite(cost)||cost<0||cost!==item.cost)return result(false,'Research package quote changed');remaining.push(item);
   }
   const balance=api.points(),required=remaining.reduce((sum,item)=>sum+item.cost,plan.retainedPoints);
   if(!Number.isFinite(balance)||!Number.isFinite(required)||balance<required)return result(false,'Research package or retained pool is no longer funded');
   const item=plan.items[i];if(api.owned(item.name)===true)continue;
   if(item.parent&&api.owned(item.parent)!==true)return result(false,'Research prerequisite unavailable');
   if(!api.buy(item.name))return result(false,'Native research purchase failed');
   purchased.push(item.name);spent+=item.cost;
  }
  return result(true,'Research package completed');
 }catch{return result(false,'Research package check failed');}
}

/** Actual cash charges, including zero-spend cycles, smooth upkeep research value. */
export function observeCorporationUpkeep(previous,paid,now=Date.now()) {
 const valid=s=>s&&[s.at,s.tea,s.party].every(Number.isFinite)&&s.tea>=0&&s.party>=0&&s.at<=now&&now-s.at<=120000;
 if(!Number.isFinite(now)||![paid?.tea,paid?.party].every(Number.isFinite)||paid.tea<0||paid.party<0)return [];
 const samples=(Array.isArray(previous)?previous:[]).filter(s=>valid(s)&&s.at<now).slice(-2);
 return [...samples,{at:now,tea:paid.tea,party:paid.party}];
}
/** Normalize observed savings and unfunded recovery into a bounded fractional opportunity estimate. */
export function corporationUpkeepResearchValues(offices,{samples=[],revenue,expenses,cycleSeconds=10,now=Date.now()}={}) {
 const valid=s=>s&&[s.at,s.tea,s.party].every(Number.isFinite)&&s.at<=now&&now-s.at<=120000&&s.tea>=0&&s.party>=0;
 const history=Array.isArray(samples)?samples.filter(valid).slice(-3):[];
 const cashKnown=history.length===3&&new Set(history.map(s=>s.at)).size===3&&[revenue,expenses,cycleSeconds].every(Number.isFinite)&&revenue>=0&&expenses>=0&&cycleSeconds>0;
 const rows=Array.isArray(offices)?offices:[],total=rows.reduce((sum,r)=>sum+Math.max(0,Number(r.office?.numEmployees)||0),0),values={};
 for(const [name,kind,metric,maxMetric,other,otherMax]of [['AutoBrew','tea','avgEnergy','maxEnergy','avgMorale','maxMorale'],['AutoPartyManager','party','avgMorale','maxMorale','avgEnergy','maxEnergy']]){
  const savingsPerSecond=cashKnown?history.reduce((sum,s)=>sum+s[kind],0)/(history.length*cycleSeconds):0;
  let staffingBenefit=0;
  for(const row of rows){
   const o=row.office,n=Number(o?.numEmployees),current=Number(o?.[metric]),maximum=Number(o?.[maxMetric]??100),otherValue=Number(o?.[other]),otherTarget=Number(o?.[otherMax]??100),interns=Number(o?.employeeJobs?.Intern??0);
   // Cash-funded recovery is already in the baseline; do not count its workers a second time.
   if(row.fundedBudget!==0||![n,current,maximum,otherValue,otherTarget,interns,total].every(Number.isFinite)||n<9||current<=0||maximum<=0||otherValue<otherTarget-2&&!(name==='AutoBrew'?o.autoParty:o.autoTea)||current>=maximum-1||interns<0||interns>=n||total<=0)continue;
   const restored=Math.max((maximum/current)**.3-1,interns>0?(n/(n-interns))**.3-1:0);
   staffingBenefit+=n/total*Math.max(0,Math.min(.25,restored));
  }
  const cashBenefit=cashKnown?Math.min(.25,savingsPerSecond/Math.max(1,revenue,expenses)):0;
  values[name]={known:cashKnown||staffingBenefit>0,savingsPerSecond,staffingBenefit,benefit:Math.min(.5,cashBenefit+staffingBenefit),samples:history.length};
 }
 const name='AutoBrew + AutoPartyManager';let staffingBenefit=0;
 for(const row of rows){
  const o=row.office,n=Number(o?.numEmployees),energy=Number(o?.avgEnergy),morale=Number(o?.avgMorale),maxEnergy=Number(o?.maxEnergy??100),maxMorale=Number(o?.maxMorale??100),interns=Number(o?.employeeJobs?.Intern??0);
  if(row.fundedBudget!==0||![n,energy,morale,maxEnergy,maxMorale,interns,total].every(Number.isFinite)||n<9||energy<=0||morale<=0||maxEnergy<=0||maxMorale<=0||interns<0||interns>=n||total<=0||energy>=maxEnergy-1&&morale>=maxMorale-1)continue;
  const restored=Math.max(((maxEnergy/energy)*(maxMorale/morale))**.3-1,interns>0?(n/(n-interns))**.3-1:0);
  staffingBenefit+=n/total*Math.max(0,Math.min(.25,restored));
 }
 const savingsPerSecond=values.AutoBrew.savingsPerSecond+values.AutoPartyManager.savingsPerSecond;
 const cashBenefit=cashKnown?Math.min(.25,savingsPerSecond/Math.max(1,revenue,expenses)):0;
 values[name]={known:cashKnown||staffingBenefit>0,savingsPerSecond,staffingBenefit,benefit:Math.min(.5,cashBenefit+staffingBenefit),samples:history.length};
 return values;
}

/** Existing warehouse-less material offices can research without new hires or cash spending. */
export function officeOnlyResearchJobs(office){
 const n=office?.numEmployees;
 if(!Number.isSafeInteger(n)||n<0||!Number.isFinite(office.avgEnergy)||!Number.isFinite(office.avgMorale))return null;
 // Larger offices need interns to stabilize morale/energy; smaller offices recover passively.
 const interns=n>=9?Math.min(n,Math.ceil(n/9)+((office.avgEnergy<95||office.avgMorale<95)?1:0)):0;
 return [0,0,0,0,n-interns,interns];
}

/** A division's latest launch is not evidence about a different product. */
export function corporationProductBaseline(history,legacy,name){
 if(typeof name!=='string'||!name)return {};
 const entry=history&&Object.hasOwn(history,name)?history[name]:null;
 return entry?.name===name?entry:legacy?.name===name?legacy:{};
}
