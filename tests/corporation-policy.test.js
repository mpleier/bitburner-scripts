import test from 'node:test';
import assert from 'node:assert/strict';
import { treasuryPolicy,recoveryJobCounts,priorSaleMultiplier,partySpendPerEmployee } from '../corporation-policy.js';
test('cash-starved corporation reserves operating cash and disables upkeep',()=>{
 const policy=treasuryPolicy({funds:438596,expenses:214491});
 assert.equal(policy.recovering,true);assert.equal(policy.upkeepBudget,0);assert.equal(policy.reserve,4289820);
});
test('healthy corporation budgets upkeep within cash after its operating reserve',()=>{
 const p=treasuryPolicy({funds:1e9,expenses:1e6,revenue:9e6});
 assert.equal(p.recovering,false);assert.ok(p.upkeepBudget<=1e9-p.reserve);assert.equal(p.upkeepBudget,20e6);
});
test('recovery staffing preserves production roles and total headcount',()=>{
 for(let n=0;n<=120;n++)for(const products of [false,true]){
  const jobs=recoveryJobCounts(n,products,true);assert.equal(jobs.reduce((s,v)=>s+v,0),n);
  assert.ok(jobs.every(v=>Number.isInteger(v)&&v>=0));if(n<6)assert.equal(jobs[5],0);else assert.ok(jobs.slice(0,5).every(v=>v>0));
 }
 assert.equal(recoveryJobCounts(15,false,true)[5],4);assert.equal(recoveryJobCounts(15,false,false)[5],0);
});
test('existing market multipliers survive manager restarts',()=>{
 assert.equal(priorSaleMultiplier('MP*3.5'),3.5);assert.equal(priorSaleMultiplier('MP'),1);
 assert.equal(priorSaleMultiplier('bad'),1);assert.equal(priorSaleMultiplier('MP*999999999'),1e6);
});
test('party spending is calculated from morale and respects the total allowance',()=>{
 const spend=partySpendPerEmployee(75,100,15,3000000);assert.equal(spend,200000);
 assert.ok(spend*15<=3000000);assert.equal(partySpendPerEmployee(75,100,15,10000),0);
 assert.equal(partySpendPerEmployee(100,100,15,1e9),0);
 const needed=partySpendPerEmployee(75,100,15,1e9),multiplier=1+needed/1e7;
 assert.ok(Math.abs((75+(multiplier-1)*10)*multiplier-100)<1e-8);
});

test('upkeep cannot consume more than a quarter of operating profit',()=>{
 assert.equal(treasuryPolicy({funds:1e9,revenue:1.5e6,expenses:1e6}).upkeepBudget,1.25e6);
 assert.equal(treasuryPolicy({funds:1e9,revenue:1e6,expenses:2e6}).upkeepBudget,0);
});
