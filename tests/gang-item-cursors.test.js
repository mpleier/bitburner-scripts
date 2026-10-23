import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planMarginalGangEquipment} from '../gang-policy.js';
const member=name=>({name,str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]});
const equipment=Array.from({length:4},(_,i)=>({name:'Item'+i,cost:10,type:'Weapon',stats:{str:1.1}}));
const budgets={available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100};
const plan=patch=>planMarginalGangEquipment({members:{A:member('A')},equipment,budgets,maxBundleEvaluations:0,evaluate:()=>null,...patch});

test('short batches resume later equipment instead of restarting at the cheapest item',()=>{
 let items={},offset=0;const seen=[];
 for(let batch=0;batch<5;batch++){
  let time=0;const q=plan({valuationItems:items,valuationOffset:offset,maxPlanningMs:1,now:()=>time,evaluate:(m,e)=>{seen.push(e.name);time++;return null;}});
  items=q.diagnostics.nextValuationItems;offset=q.diagnostics.nextValuationOffset;
 }
 assert.deepEqual(seen,['Item0','Item1','Item2','Item3','Item0']);
});
test('member and item rotation together eventually cover every member and missing item',()=>{
 let valuationItems={},valuationOffset=0;const seen=[];
 for(let batch=0;batch<8;batch++){
  let time=0;const q=plan({members:{A:member('A'),B:member('B')},valuationItems,valuationOffset,maxPlanningMs:1,now:()=>time,
   evaluate:(m,e)=>{seen.push(m.name+':'+e.name);time++;return null;}});
  valuationItems=q.diagnostics.nextValuationItems;valuationOffset=q.diagnostics.nextValuationOffset;
 }
 assert.deepEqual(seen,['A:Item0','B:Item0','A:Item1','B:Item1','A:Item2','B:Item2','A:Item3','B:Item3']);
});
test('owned next items are skipped without dropping later missing items',()=>{
 const a=member('A');a.upgrades=['Item1'];const seen=[];
 plan({members:{A:a},valuationItems:{A:'Item1'},evaluate:(m,e)=>{seen.push(e.name);return null;}});
 assert.deepEqual(seen,['Item2','Item3','Item0']);
});
test('cursor names survive catalogue reordering and removed names fall back safely',()=>{
 const seen=[];plan({equipment:[equipment[2],equipment[0],equipment[3],equipment[1]],valuationItems:{A:'Item1'},evaluate:(m,e)=>{seen.push(e.name);return null;}});
 assert.equal(seen[0],'Item1');assert.equal(seen.length,4);
 for(const saved of [{A:'Removed'},{A:NaN},null,[],42]){
  const calls=[];plan({valuationItems:saved,evaluate:(m,e)=>{calls.push(e.name);return null;}});assert.equal(calls[0],'Item0');
 }
});
test('missing members are pruned and new members receive a valid fresh cursor',()=>{
 const q=plan({members:{B:member('B')},valuationItems:{A:'Item2',B:'Item1',Dead:'Item3'}});
 assert.deepEqual(q.diagnostics.nextValuationItems,{B:'Item1'});
 assert.deepEqual(plan({equipment:[]}).diagnostics.nextValuationItems,{A:null});
 assert.deepEqual(plan({members:{}}).diagnostics.nextValuationItems,{});
});
test('zero evaluation time leaves known positions intact and reports skipped work',()=>{
 const q=plan({valuationItems:{A:'Item2'},maxPlanningMs:0,now:()=>0});assert.equal(q.diagnostics.evaluations,0);
 assert.equal(q.diagnostics.nextValuationItems.A,'Item2');assert.equal(q.diagnostics.skippedEvaluations,4);
});
test('cursor reuse never reuses an old projected production valuation',()=>{
 let time=0;const first=plan({maxPlanningMs:1,now:()=>time,evaluate:()=>{time++;return null;}});
 const a=member('A');a.str_mult=3;const seen=[];
 plan({members:{A:a},valuationItems:first.diagnostics.nextValuationItems,evaluate:(m,e)=>{seen.push([e.name,m.str_mult]);return null;}});
 assert.deepEqual(seen[0],['Item1',3]);assert.equal(seen.length,4);
});
test('a full wrapped scan visits each missing item once without mutating saved state',()=>{
 const valuationItems={A:'Item2'},before=structuredClone(valuationItems),seen=[];
 const q=plan({valuationItems,evaluate:(m,e)=>{seen.push(e.name);return null;}});
 assert.deepEqual(seen,['Item2','Item3','Item0','Item1']);assert.equal(new Set(seen).size,4);assert.deepEqual(valuationItems,before);assert.equal(q.diagnostics.nextValuationItems.A,'Item2');
});
test('controller carries per-member positions and clears them at startup',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/valuationItems:equipmentValuationItems/);assert.match(s,/equipmentValuationItems=plan.diagnostics.nextValuationItems/);
 assert.match(s,/equipmentValuationItems=\{\};equipmentValuationCursor=0;trainingPlans=/);
});
