import {bladeburnerGrowthClock,bladeburnerGrowthCompletions} from './bladeburner-growth-clock-policy.js';
import {playerTrainingStaminaPayoff} from './player-training-stamina-policy.js';
/** Bounded lookahead for parent and city decisions. Training eligibility and all mutations remain with the controller. */
export function planBladeburnerGrowthFallbacks(entries,training,stamina,seconds,switchSeconds,value){
 const result={byName:Object.create(null),evaluatedPairs:0};
 if(!stamina||!training||training.kind!=='training'||typeof value!=='function'||!Number.isFinite(seconds)||seconds<=0||seconds>30||!Number.isFinite(switchSeconds)||switchSeconds<1||switchSeconds>=seconds)return result;
 const clock=bladeburnerGrowthClock(seconds,stamina.bonusMs??0);if(!clock)return result;
 const native=bladeburnerGrowthCompletions(training.time??stamina.time,seconds,clock.workSeconds,{progressMs:stamina.progressMs??0});if(!native)return result;
 const eligible=(entries||[]).filter(({raw,valued})=>raw?.kind==='mission'&&typeof raw.name==='string'&&raw.name&&Number.isSafeInteger(raw.supply)&&raw.supply>0&&Number.isFinite(raw.time)&&raw.time>0&&Number.isFinite(raw.duty)&&raw.duty>0&&raw.duty<=1&&Number.isFinite(raw.score)&&raw.score>0&&raw.rates&&Object.values(raw.rates).every(v=>Number.isFinite(v)&&v>=0)&&valued?.completion?.count>0&&Number.isFinite(valued.score)&&valued.score>0&&
  // Unpriced shared cleanup/recruitment dependencies cannot be combined safely.
  (raw.recovery?raw.recovery.otherMs===0:raw.duty===1));
 const diverse=rows=>{const seen=new Set(),first=[],rest=[];for(const row of rows){if(seen.has(row.raw.name))rest.push(row);else{seen.add(row.raw.name);first.push(row);}}return [...first,...rest].slice(0,8);};
 const prefixes=diverse([...eligible].filter(e=>e.raw.supply<=30&&e.valued.completion.count===e.raw.supply).sort((a,b)=>b.raw.score-a.raw.score));
 const tails=diverse([...eligible].sort((a,b)=>b.valued.score-a.valued.score));
 for(const first of prefixes){
  let prefix=null,prefixSeconds=0;
  for(let n=1;n+switchSeconds<seconds;n++){
   const q=value(first.raw,training,stamina,n);
   if(q?.completion?.count===first.raw.supply&&q.score>0){prefix=q;prefixSeconds=n;break;}
  }
  if(!prefix)continue;
  const afterSwitch=bladeburnerGrowthClock(prefixSeconds+switchSeconds,stamina.bonusMs??0);if(!afterSwitch)continue;
  const remainingSeconds=seconds-prefixSeconds-switchSeconds;
  for(const second of tails){
   if(second.raw.name===first.raw.name)continue;
   result.evaluatedPairs++;
   const tail=value({...second.raw,progressMs:0},training,{...stamina,progressMs:0,bonusMs:afterSwitch.remainingMs},remainingSeconds);
   if(!tail?.completion||tail.completion.count<=0||!Number.isFinite(tail.score)||tail.score<=0)continue;
   // Reconstruct original per-attempt rewards; never add separately stamina-adjusted endpoint gains.
   const firstWork=prefix.completion.count*first.raw.time/(1000*first.raw.duty),secondWork=tail.completion.count*second.raw.time/(1000*second.raw.duty);
   const rates=Object.fromEntries([...new Set([...Object.keys(first.raw.rates),...Object.keys(second.raw.rates)])].map(k=>[k,((first.raw.rates[k]??0)*firstWork+(second.raw.rates[k]??0)*secondWork)/seconds]));
   const xpScore=(first.raw.score*firstWork+second.raw.score*secondWork)/seconds;
   const payoff=playerTrainingStaminaPayoff({...stamina,speed:clock.multiplier},{nativeRates:Object.fromEntries(Object.entries(training.rates||{}).map(([k,v])=>[k,v*native.multiplier])),rates,seconds,baselineGain:training.score*seconds*native.multiplier,projectedGain:xpScore*seconds,nativeCompletions:native.count});
   const score=payoff?.projectedGain/seconds;
   const incumbent=result.byName[first.raw.name]?.score??first.valued.score;
   if(!Number.isFinite(score)||score<=incumbent)continue;
   result.byName[first.raw.name]={...first.valued,score,singleScore:first.valued.score,stamina:{...payoff.stamina,horizonSeconds:seconds,selectedCapacity:payoff.stamina.externalCapacity},fallback:{basis:'two-independent-missions',horizonSeconds:seconds,switchSeconds,first:{name:first.raw.name,level:first.raw.level,seconds:prefixSeconds,count:prefix.completion.count},second:{name:second.raw.name,level:second.raw.level,seconds:remainingSeconds,count:tail.completion.count},bonusRemainingMs:afterSwitch.remainingMs,xpScore,rates}};
  }
 }
 return result;
}
