import test from 'node:test';
import assert from 'node:assert/strict';
import {gangPlanningShouldYield,gangRecruitmentTrainingDelay,gangPowerBudgetPriority} from '../gang-growth-speed-policy.js';
import {spendingPlan} from '../spending-policy.js';
test('deadline planning yields for measured work and preserves unknown phases',()=>{
 assert.equal(gangPlanningShouldYield(20000,19000),true);assert.equal(gangPlanningShouldYield(20000,10000,200,8000),true);assert.equal(gangPlanningShouldYield(20000,1000),false);assert.equal(gangPlanningShouldYield(null,19000),false);
});
test('training delay is bounded and requires more readiness benefit than recruitment cost',()=>{
 const p={powerObjective:true,powerSecondsSaved:300,powerPaybackSeconds:200};
 assert.equal(gangRecruitmentTrainingDelay(600,620,p,900),30);assert.equal(gangRecruitmentTrainingDelay(120,130,p,900),2);assert.equal(gangRecruitmentTrainingDelay(600,950,p,900),2);assert.equal(gangRecruitmentTrainingDelay(600,620,{...p,powerSecondsSaved:10},900),2);assert.equal(gangRecruitmentTrainingDelay(600,620,{...p,powerObjective:false},900),2);
});
test('power budget priority requires finite completed payoff and raises bounded shared allowance',()=>{
 const q={reason:'power',powerObjective:true,powerGainPerTick:1,powerPaybackSeconds:300};assert.equal(gangPowerBudgetPriority(q,900),true);assert.equal(gangPowerBudgetPriority({...q,powerPaybackSeconds:1000},900),false);assert.equal(gangPowerBudgetPriority({...q,powerGainPerTick:0},900),false);
 const base={money:1e9,reserve:1e8,homeRam:1024};const a=spendingPlan(base),b=spendingPlan({...base,signals:{gangCapitalQuote:q,gangCapitalHorizon:900}});assert.ok(b.allowances.gang>a.allowances.gang);assert.ok(Object.values(b.allowances).reduce((n,v)=>n+v,0)<=9e8+1);
});
