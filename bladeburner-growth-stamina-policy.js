import {planBladeburnerGrowthFallbacks} from './bladeburner-growth-fallback-policy.js';
import {bladeburnerGrowthClock,bladeburnerGrowthCompletions,forecastBladeburnerGrowthDuty} from './bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina,playerTrainingStaminaPayoff} from './player-training-stamina-policy.js';
/** Keep raw XP rates for empirical checks; score the same full-recovery endpoint for each action. */
export function valueBladeburnerStaminaGrowth(choice,training,stamina,seconds=30){
 if(!choice||!Number.isFinite(choice.score)||choice.score<=0)return null;
 const bounded=choice.kind==='mission'&&choice.supply!==undefined;
 const maxCompletions=bounded?(Number.isSafeInteger(choice.supply)&&choice.supply>=0?choice.supply:0):null;
 const progressMs=Number.isFinite(choice.progressMs)&&choice.progressMs>=0&&choice.progressMs<=choice.time?choice.progressMs:0;
 const fallback=()=>{
  if(!bounded)return choice;
  const clock=bladeburnerGrowthClock(seconds,Number.isFinite(stamina?.bonusMs)&&stamina.bonusMs>=0?stamina.bonusMs:0);
  const completion=clock?bladeburnerGrowthCompletions(choice.time,seconds,clock.workSeconds,{duty:choice.duty??1,progressMs,maxCompletions}):null;
  return {...choice,xpScore:choice.score,score:completion?choice.score*completion.multiplier:0,rankRate:completion&&Number.isFinite(choice.rankPerCycle)&&choice.rankPerCycle>=0?completion.count*choice.rankPerCycle/seconds:null,completion};
 };
 if(!stamina||!Number.isFinite(seconds)||seconds<=0||seconds>30)return fallback();
 if(!training||!Number.isFinite(training.score)||training.score<=0)return fallback();
 const clock=bladeburnerGrowthClock(seconds,stamina.bonusMs??0);if(!clock)return fallback();
 const native=bladeburnerGrowthCompletions(training.time??stamina.time,seconds,clock.workSeconds,{progressMs:stamina.progressMs??0});
 const initial=choice.kind==='training'?native:bladeburnerGrowthCompletions(choice.time,seconds,clock.workSeconds,{duty:choice.duty??1,progressMs,maxCompletions});
 if(!native||!initial)return fallback();
 const scaled=(rates,m)=>Object.fromEntries(Object.entries(rates||{}).map(([k,v])=>[k,v*m]));
 const regeneration=forecastBladeburnerGrowthDuty(stamina,{...choice,rates:scaled(choice.rates,initial.multiplier/clock.multiplier)},seconds,clock.multiplier);
 const completion=choice.kind==='training'?native:bladeburnerGrowthCompletions(choice.time,seconds,clock.workSeconds,{duty:Math.min(1,(choice.duty??1)*regeneration.factor),progressMs,maxCompletions});
 if(!completion)return fallback();
 const factor=completion.multiplier*(choice.kind==='mission'?regeneration.factor:1);
 const value=playerTrainingStaminaPayoff({...stamina,speed:clock.multiplier},{nativeRates:scaled(training.rates,native.multiplier),rates:scaled(choice.rates,factor),seconds,baselineGain:training.score*seconds*native.multiplier,projectedGain:choice.score*seconds*factor,nativeCompletions:native.count});
 if(!value)return null;
 const gain=choice.kind==='training'?value.baselineGain:value.projectedGain;
 return {...choice,xpScore:choice.score,score:gain/seconds,rankRate:Number.isFinite(choice.rankPerCycle)&&choice.rankPerCycle>=0?completion.count*choice.rankPerCycle/seconds:null,bonus:clock,completion,regeneration,stamina:{...value.stamina,horizonSeconds:seconds,selectedCapacity:choice.kind==='training'?value.stamina.nativeCapacity:value.stamina.externalCapacity}};
}
/** Rank every eligible mission, rather than assuming the best XP mission remains best after capacity valuation. */
export function rankBladeburnerStaminaGrowth(missions,training,stamina,{trainingAllowed=false,seconds=30,switchSeconds=2}={}){
 let mission=null;const entries=[],byName=Object.create(null);
 for(const raw of missions||[]){const q=valueBladeburnerStaminaGrowth(raw,training,stamina,seconds);if(q?.kind==='mission'&&q.score>0){entries.push({raw,valued:q});if(!byName[q.name]||q.score>byName[q.name].score)byName[q.name]=q;}}
 const fallback=planBladeburnerGrowthFallbacks(entries,training,stamina,seconds,switchSeconds,valueBladeburnerStaminaGrowth);
 for(const q of [...Object.values(byName),...Object.values(fallback.byName)])if(!byName[q.name]||q.score>byName[q.name].score)byName[q.name]=q;
 for(const q of Object.values(byName))if(!mission||q.score>mission.score)mission=q;
 const native=trainingAllowed?valueBladeburnerStaminaGrowth(training,training,stamina,seconds):null;
 const choice=native?.kind==='training'&&native.score>0&&native.score>(mission?.score||0)?native:mission;
 return {choice,mission,training:native,byName,fallbackPairs:fallback.evaluatedPairs};
}


/** A single city-independent stamina reference keeps level/team probes in the parent's score units. */
export function createBladeburnerStaminaGrowth(api,context,hyperdrive,growth,quote,value,seconds=30,rank=null,switchSeconds=2){
 if(typeof growth!=='function')return ()=>null;
 let training=null,stamina=null;
 if(context)try{
  const time=api.getActionTime('General','Training');
  training=growth([],context,{hyperdrive,trainingTime:time,trainingAllowed:true});
  let bonusMs=0;try{bonusMs=api.getBonusTime();}catch{}
  if(!Number.isFinite(bonusMs)||bonusMs<0)bonusMs=0;
  stamina=quote(context,{stamina:api.getStamina(),cyber:api.getSkillLevel("Cyber's Edge"),time,bonusMs});
 }catch{}
 const evaluator=(actions,c,options)=>value(growth(actions,c,options),training,stamina,seconds);
 if(typeof rank==='function')evaluator.rank=(actions,c,options={})=>rank((actions||[]).map(a=>growth([a],c,{...options,trainingAllowed:false})),training,stamina,{trainingAllowed:false,seconds,switchSeconds});
 evaluator.staminaAdjusted=!!stamina&&Number.isFinite(seconds)&&seconds>0&&seconds<=30;
 return evaluator;
}
/** Embed explicit pure dependencies, preserving real native RAM accounting for API calls. */
export const bladeburnerStaminaGrowthSource=`((api,context,hyperdrive,growth,seconds=30,switchSeconds=2)=>{const bladeburnerGrowthCompletions=(${bladeburnerGrowthCompletions.toString()}),bladeburnerGrowthClock=(${bladeburnerGrowthClock.toString()}),forecastBladeburnerGrowthDuty=(${forecastBladeburnerGrowthDuty.toString()}),playerTrainingStaminaPayoff=(${playerTrainingStaminaPayoff.toString()}),quote=(${quotePlayerTrainingStamina.toString()}),value=(${valueBladeburnerStaminaGrowth.toString()}),valueBladeburnerStaminaGrowth=value,planBladeburnerGrowthFallbacks=(${planBladeburnerGrowthFallbacks.toString()}),rank=(${rankBladeburnerStaminaGrowth.toString()});return (${createBladeburnerStaminaGrowth.toString()})(api,context,hyperdrive,growth,quote,value,seconds,rank,switchSeconds);})`;
