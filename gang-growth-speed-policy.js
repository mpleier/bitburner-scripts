/** Yield optional planning before the native assignment deadline. */
export function gangPlanningShouldYield(nextTick,now,padding=200,measuredMs=0){
 return Number.isFinite(nextTick)&&nextTick>0&&Number.isFinite(now)&&nextTick-now<=Math.max(2000,Math.min(10000,Math.max(0,measuredMs)*1.25+Math.max(0,padding)+400));
}
/** A small recruitment delay can buy a larger measured readiness improvement. */
export function gangRecruitmentTrainingDelay(before,after,power,horizon){
 if(!Number.isFinite(before)||before<=120||!Number.isFinite(after)||after>horizon||power?.powerObjective!==true||!Number.isFinite(power.powerSecondsSaved)||power.powerSecondsSaved<60||!Number.isFinite(power.powerPaybackSeconds)||power.powerPaybackSeconds>horizon)return 2;
 return Math.max(2,Math.min(30,before*.05,power.powerSecondsSaved*.1));
}
/** Budget priority requires completed power payback, not stalled territory alone. */
export function gangPowerBudgetPriority(opportunity,horizon){
 return opportunity?.powerObjective===true&&opportunity.reason==='power'&&Number.isFinite(opportunity.powerGainPerTick)&&opportunity.powerGainPerTick>0&&Number.isFinite(opportunity.powerPaybackSeconds)&&opportunity.powerPaybackSeconds>0&&opportunity.powerPaybackSeconds<=Math.min(900,horizon);
}
