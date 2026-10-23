import test from 'node:test';
import assert from 'node:assert/strict';
import {planMarginalGangEquipment} from '../gang-policy.js';
const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};
const gear=[{name:'One',type:'Weapon',cost:10,stats:{str:1.1}},{name:'Two',type:'Armor',cost:10,stats:{str:1.1}}];
const budgets={available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100};
const plan=patch=>planMarginalGangEquipment({members:{A:member},equipment:gear,budgets,maxPurchases:2,
 evaluate:(_,e)=>({moneyGain:e.stats.str>1.2?100:1}),...patch});

test('superior bundle wins even while both individual items already qualify',()=>{
 const q=plan();assert.equal(q.orders.length,2);assert.ok(q.orders[0].bundleId);assert.equal(q.orders[0].bundleId,q.orders[1].bundleId);
 assert.equal(q.firstOpportunity.cost,20);assert.equal(q.firstOpportunity.cashPaybackSeconds,.2);assert.equal(q.diagnostics.bundleQualified,1);
});
test('better single still wins over an inferior or equal-return bundle',()=>{
 const q=plan({evaluate:()=>({moneyGain:1})});assert.equal(q.firstOpportunity.cost,10);assert.ok(q.orders.every(o=>!o.bundleId));
 const tie=plan({evaluate:(_,e)=>({moneyGain:e.cost})});assert.equal(tie.firstOpportunity.cost,10);
});
test('readiness guard sees the best combined candidate first and can reject it for a single',()=>{
 const calls=[],q=plan({purchaseGuard:c=>{calls.push(c.cost);return {allowed:!c.items};}});
 assert.deepEqual(calls.slice(0,2),[20,10]);assert.equal(q.firstOpportunity.cost,10);assert.ok(q.orders.every(o=>!o.bundleId));
 const only=plan({purchaseGuard:()=>({allowed:true}),maxPurchaseChecks:1});assert.equal(only.orders.length,2);assert.ok(only.orders[0].bundleId);
});
test('pair comparison retains total category and purchase-count caps',()=>{
 for(const b of [{available:19},{equipmentLimit:19}]){
  const q=plan({budgets:{...budgets,...b}});assert.ok(q.orders.every(o=>!o.bundleId));assert.ok(q.diagnostics.plannedCost<=19);
 }
 const one=plan({maxPurchases:1});assert.equal(one.orders.length,1);assert.equal(one.diagnostics.bundleEvaluations,0);
 const mixed=plan({equipment:[gear[0],{...gear[1],type:'Augmentation'}]});assert.equal(mixed.diagnostics.bundleEvaluations,0);
});
test('bundle search limits retain already-qualified single purchases',()=>{
 const zero=plan({maxBundleEvaluations:0});assert.equal(zero.diagnostics.bundleEvaluations,0);assert.equal(zero.orders.length,2);assert.ok(zero.orders.every(o=>!o.bundleId));
 const many=[...gear,{name:'Three',type:'Weapon',cost:10,stats:{str:1.1}}];
 const q=plan({equipment:many,maxBundleEvaluations:1});assert.equal(q.diagnostics.bundleEvaluations,1);assert.equal(q.diagnostics.bundleSearchLimited,true);assert.ok(q.orders.length>0);
});
test('global pair cap holds across members and passes without mutating input ownership',()=>{
 const equipment=Array.from({length:12},(_,i)=>({name:String(i),cost:1,type:'Weapon',stats:{str:1.01}}));
 const crew={A:member,B:{...member,name:'B'}};
 const q=plan({equipment,members:crew,evaluate:()=>({moneyGain:0})});
 assert.equal(q.diagnostics.bundleEvaluations,128);assert.equal(q.diagnostics.bundleSearchLimited,true);assert.deepEqual(member.upgrades,[]);
 assert.equal(q.diagnostics.bundleEvaluationsByMember.A,64);assert.equal(q.diagnostics.bundleEvaluationsByMember.B,64);
});
test('accepted bundle is followed by fresh crew valuations for later purchases',()=>{
 const seen=[],equipment=[...gear,{name:'Three',type:'Weapon',cost:30,stats:{str:1.01}}];
 const q=plan({equipment,maxPurchases:3,evaluate:(m,e)=>{seen.push([...m.upgrades]);return {moneyGain:e.stats.str>1.2?100:1};}});
 assert.equal(q.orders.length,3);assert.ok(q.orders[0].bundleId);assert.ok(seen.some(names=>names.includes('One')&&names.includes('Two')));
 assert.equal(new Set(q.orders.map(o=>o.equipmentName)).size,3);
});
test('soft time bound stops optional pair work while preserving usable singles',()=>{
 let time=0;
 const q=plan({maxPlanningMs:10,now:()=>time,evaluate:(_,e)=>{time+=6;return {moneyGain:e.stats.str>1.2?100:1};}});
 assert.ok(q.orders.length>0);assert.equal(q.diagnostics.bundleEvaluations,0);assert.equal(q.diagnostics.bundleSearchLimited,true);assert.equal(q.diagnostics.timeLimited,true);
});
test('bundle recruitment and progression costs still share the exception budget',()=>{
 const q=plan({evaluate:(_,e)=>({moneyGain:0,objectiveGain:e.stats.str>1.2?100:1,relativeObjectiveGain:.1}),recruitment:{allowProgression:true},budgets:{...budgets,bootstrapBudget:19}});
 assert.ok(q.orders.every(o=>!o.bundleId));assert.ok(q.diagnostics.plannedCost<=19);
});
