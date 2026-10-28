/** Product.createProduct's native productivity formula, expressed in normal market-cycle time.
 * Existing buffered game time may finish sooner; future staffing changes are not projected. */
export function corporationDevelopmentDelay(office,progress=0,cycleSeconds=10){
 const jobs=office?.employeeProductionByJob,op=jobs?.Operations,engineer=jobs?.Engineer,management=jobs?.Management;
 if(![op,engineer,management,progress,cycleSeconds].every(Number.isFinite)||[op,engineer,management,progress].some(v=>v<0)||progress>100||cycleSeconds<=0)return null;
 if(progress===100)return 0;
 const total=op+engineer+management;if(!(total>0))return null;
 const perCycle=.01*(engineer**.34+op**.2)*(1+management/(1.2*total));
 if(!Number.isFinite(perCycle)||perCycle<=0)return null;
 const ms=Math.ceil((100-progress)/perCycle)*cycleSeconds*1000;
 return Number.isFinite(ms)&&ms>=0?ms:null;
}

/** Await a product only when there is no mature product earning from this division yet. */
export function corporationAdvertisingDelay(products,pendingDelayMs,cycleSeconds=10){
 if(!Array.isArray(products)||!Number.isFinite(cycleSeconds)||cycleSeconds<=0)return null;
 const settling=3*cycleSeconds*1000;
 if(products.some(p=>Number.isFinite(p?.developmentProgress)&&p.developmentProgress>=100))return settling;
 if(products.some(p=>Number.isFinite(p?.developmentProgress)&&p.developmentProgress>=0&&p.developmentProgress<100)&&Number.isFinite(pendingDelayMs)&&pendingDelayMs>=0)return pendingDelayMs+settling;
 return null;
}

/** Cash-return timing estimate, not observed marginal profit. A bounded operating horizon
 * discounts optional delayed opportunities; bootstrap priorities remain available. */
export function planCorporationDelayedReturns(plans,{remainingMs=null,horizonMs=21600000}={}){
 if(!Number.isFinite(horizonMs)||horizonMs<=0)return plans;
 const knownEnd=Number.isFinite(remainingMs)&&remainingMs>=0;
 return plans.flatMap(plan=>{
  const delay=plan.market?.delay;
  if(!delay||!['advertising','product-development'].includes(delay.kind))return [plan];
  if(knownEnd&&remainingMs===0)return [];
  if(!Number.isFinite(delay.ms)||delay.ms<0||!Number.isFinite(plan.score)||plan.score<0)return [{...plan,delayedReturn:{state:'unknown',kind:delay.kind,basis:'Timing unavailable; retain existing estimate'}}];
  // Unknown node duration must not permanently veto slow but useful development.
  const waitingFactor=horizonMs/(horizonMs+delay.ms),earningFraction=knownEnd?Math.max(0,1-delay.ms/remainingMs):1;
  const factor=waitingFactor*earningFraction;
  if(factor===0&&!(plan.priority>0))return [];
  const bootstrap=plan.priority>0;
  return [{...plan,score:bootstrap?plan.score:plan.score*factor,delayedReturn:{state:'estimated',kind:delay.kind,delayMs:delay.ms,horizonMs,remainingMs:knownEnd?remainingMs:null,factor:bootstrap?1:factor,bootstrap,
   basis:'Native current-productivity delay and estimated benefit; not measured cash payback'}}];
 });
}
