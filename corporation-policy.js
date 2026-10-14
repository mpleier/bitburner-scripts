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
 const multiplier=blocked&&current<=1?1:high?Math.sqrt(low*high):Math.min(1e6,current*2);
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
