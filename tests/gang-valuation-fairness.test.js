import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planMarginalGangEquipment} from '../gang-policy.js';
const member=name=>({name,str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]});
const crew=()=>Object.fromEntries(['A','B','C','D'].map(n=>[n,member(n)]));
const equipment=Array.from({length:3},(_,i)=>({name:'Item'+i,cost:10,type:'Weapon',stats:{str:1.1}}));
const budgets={available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100};
const plan=patch=>planMarginalGangEquipment({members:crew(),equipment,budgets,maxBundleEvaluations:0,...patch});

test('initial valuations give each member one item before any second item',()=>{
 const calls=[],q=plan({evaluate:(m,e)=>{calls.push(m.name+':'+e.name);return null;}});
 assert.deepEqual(calls.slice(0,8),['A:Item0','B:Item0','C:Item0','D:Item0','A:Item1','B:Item1','C:Item1','D:Item1']);
 assert.equal(q.diagnostics.evaluations,12);assert.deepEqual(q.diagnostics.evaluationsByMember,{A:3,B:3,C:3,D:3});assert.equal(q.diagnostics.skippedEvaluations,0);
});
test('deadline cuts coverage fairly and accounts exactly for pending work',()=>{
 let time=0;const calls=[];
 const q=plan({maxPlanningMs:5,now:()=>time,evaluate:m=>{calls.push(m.name);time++;return null;}});
 assert.deepEqual(calls,['A','B','C','D','A']);assert.equal(q.diagnostics.skippedEvaluations,7);assert.equal(q.diagnostics.ineligible,5);
 assert.equal(q.diagnostics.nextValuationOffset,1);assert.equal(q.diagnostics.timeLimited,true);
});
test('carried offsets cover every member when each management batch can value only one item',()=>{
 let offset=0;const calls=[];
 for(let i=0;i<4;i++){
  let time=0;const q=plan({valuationOffset:offset,maxPlanningMs:1,now:()=>time,evaluate:m=>{calls.push(m.name);time++;return null;}});
  offset=q.diagnostics.nextValuationOffset;
 }
 assert.deepEqual(calls,['A','B','C','D']);assert.equal(offset,0);
});
test('owned items and members with no missing equipment do not consume valuation turns',()=>{
 const members=crew();members.A.upgrades=equipment.map(e=>e.name);members.B.upgrades=['Item0','Item1'];
 const calls=[],q=plan({members,evaluate:(m,e)=>{calls.push(m.name+':'+e.name);return null;}});
 assert.deepEqual(calls.slice(0,3),['B:Item2','C:Item0','D:Item0']);assert.equal(q.diagnostics.evaluations,7);assert.equal(q.diagnostics.owned,5);
});
test('whole-crew refresh uses the new projected crew after accepted equipment',()=>{
 const observations=[];
 const q=plan({members:{A:member('A'),B:member('B')},equipment:[equipment[0]],crewAware:true,maxPlanningMs:Infinity,maxPurchases:2,
  evaluate:(m,e,c)=>{observations.push({name:m.name,a:c.A.str_mult});return {moneyGain:1};}});
 assert.equal(q.orders.length,2);assert.equal(q.diagnostics.valuationPasses,2);
 assert.deepEqual(observations.map(o=>o.name),['A','B','B']);assert.equal(observations[2].a,1.1);
});
test('non-crew-aware callers refresh only the changed member and keep unaffected candidates',()=>{
 const calls=[],q=plan({members:{A:member('A'),B:member('B')},equipment:[equipment[0]],maxPurchases:2,
  evaluate:m=>{calls.push(m.name);return {moneyGain:1};}});
 assert.equal(q.orders.length,2);assert.deepEqual(calls,['A','B']);
});
test('zero budgets empty crews and malformed offsets remain safe',()=>{
 let calls=0;
 const q=plan({maxPlanningMs:0,now:()=>0,evaluate:()=>{calls++;return null;}});assert.equal(calls,0);assert.equal(q.diagnostics.skippedEvaluations,12);
 assert.equal(plan({members:{},evaluate:()=>null}).diagnostics.nextValuationOffset,0);
 for(const offset of [NaN,Infinity,-1,99,2.7]){
  const result=plan({valuationOffset:offset,evaluate:()=>null});assert.equal(result.diagnostics.evaluations,12);assert.ok(result.diagnostics.nextValuationOffset>=0&&result.diagnostics.nextValuationOffset<4);
 }
});
test('fair valuation order preserves input ownership and never increases a spending cap',()=>{
 const members=crew(),copy=structuredClone(members),q=plan({members,budgets:{...budgets,available:15},evaluate:()=>({moneyGain:1})});
 assert.equal(q.orders.length,1);assert.equal(q.diagnostics.plannedCost,10);assert.deepEqual(members,copy);
});
test('controller carries the cursor across management batches and resets it on startup',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/valuationOffset:equipmentValuationCursor/);assert.match(s,/equipmentValuationCursor=plan.diagnostics.nextValuationOffset/);
 assert.match(s,/equipmentValuationCursor=0;trainingPlans=/);
});
