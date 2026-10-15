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
export function boostPurchaseBudget(info, reserve, upkeep = 0, cycleSeconds = 10) {
 const cash = Math.max(0, Number(info.funds) || 0);
 const revenue = Math.max(0, Number(info.revenue) || 0), expenses = Math.max(0, Number(info.expenses) || 0);
 // A small startup allowance bootstraps a division before its first sales cycle.
 const allowance = revenue === 0 && expenses === 0 ? Math.min(10e6, cash * 0.01) : Math.max(0, revenue - expenses) * cycleSeconds * 0.5;
 return Math.max(0, Math.min(cash * 0.20, cash - reserve - upkeep, allowance));
}
export function treasuryPolicy(info, cycleSeconds = 10) {
 const cash = Math.max(0, Number(info.funds) || 0);
 const expenses = Math.max(0, Number(info.expenses) || 0);
 const reserve = Math.max(1e6, Math.min(5e9, cash * 0.1), expenses * cycleSeconds * 2);
 const recovering = cash < Math.max(10e6, reserve * 1.5);
 const spendable = Math.max(0, cash - reserve);
 const profitBudget = Math.max(0, (Number(info.revenue) || 0) - expenses) * cycleSeconds * 0.25;
 return { reserve, recovering, upkeepBudget: recovering ? 0 : Math.min(spendable, cash * 0.02, profitBudget) };
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
 if(n-interns<6)return initial;
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
export function executeCorporationGrowth(plans,budget,cash,reserve,allowed=()=>true){
 let remaining=Number.isFinite(budget)?Math.max(0,budget):0,spent=0;const decisions=[];
 for(const plan of [...plans].filter(p=>Number.isFinite(p.cost)&&p.cost>0&&Number.isFinite(p.score)).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||b.score-a.score||a.cost-b.cost)){
  if(!allowed())break;
  const hold=typeof reserve==='function'?reserve():reserve;
  if(plan.cost>remaining||!Number.isFinite(cash())||!Number.isFinite(hold)||cash()<=hold+plan.cost){decisions.push({label:plan.label,state:'budget-wait',cost:plan.cost});continue;}
  const before=cash();let ok=false;try{ok=plan.run()!==false;}catch{}
  const paid=Math.max(0,before-cash()),committed=ok?Math.max(0,Number(plan.commit)||0):0,charged=Math.max(paid,committed);remaining=Math.max(0,remaining-charged);spent+=charged;
  decisions.push({label:plan.label,state:ok?(committed?'ordered':'purchased'):'rejected',cost:charged});
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
 // Legacy products get one conservative full development window before evaluation.
 return stronger||oldInvestment===0&&elapsed>=Math.max(settling,15*60000)||elapsed>=Math.max(settling,developmentMs*3,30*60000);
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
export function corporationResearchGoal({laboratory=false,ta1=false,ta2=false,points=0,laboratoryCost,ta1Cost,ta2Cost}={},products=false){
 const stage=ta2?'quality':laboratory?'pricing':'laboratory';
 const cost=stage==='laboratory'?laboratoryCost:stage==='pricing'?(ta1?0:ta1Cost)+ta2Cost:0;
 const target=Number.isFinite(cost)&&cost>=0?cost*2:null;
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
