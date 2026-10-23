import test from 'node:test';
import assert from 'node:assert/strict';
import {gangEquipmentShortlist,planMarginalGangEquipment} from '../gang-policy.js';
const item=(name,cost=1,str=1.01)=>({name,cost,type:'Weapon',stats:{str}});
const cheap=Array.from({length:12},(_,i)=>item('Cheap'+String(i).padStart(2,'0')));
const good=[item('StrongA',20,1.4),item('StrongB',20,1.4)];
const values=[...cheap.map(e=>({equipmentName:e.name,moneyGain:.01})),...good.map(e=>({equipmentName:e.name,moneyGain:4}))];
const select=(items=[...cheap,...good],candidates=values,extra={})=>gangEquipmentShortlist(items,candidates,{available:100,categoryLimit:100,...extra});

test('shortlist retains cheap exploration and useful expensive equipment',()=>{
 const q=select();assert.equal(q.items.length,12);assert.equal(q.items.filter(e=>e.cost===1).length,10);
 assert.ok(good.every(e=>q.items.includes(e)));assert.ok(good.every(e=>q.benefitNames.includes(e.name)));
 assert.ok(cheap.slice(0,6).every(e=>q.items.includes(e)));
});
test('cash reputation and objective channels select different useful equipment',()=>{
 const extras=[item('Cash',20),item('Respect',20),item('Progress',20),item('Absolute',30)];
 const q=select([...cheap,...extras],[{equipmentName:'Cash',moneyGain:10},{equipmentName:'Respect',respectGain:10},{equipmentName:'Progress',objectiveGain:10},{equipmentName:'Absolute',moneyGain:12}]);
 assert.ok(extras.every(e=>q.items.includes(e)));assert.equal(new Set(q.items.map(e=>e.name)).size,q.items.length);
});
test('unscored zero-benefit data falls back to twelve inexpensive exploration items',()=>{
 const q=select([...cheap,...good],[]);assert.deepEqual(q.items,cheap);assert.deepEqual(q.benefitNames,[]);
});
test('unaffordable expensive items cannot consume shortlist slots without a feasible partner',()=>{
 const q=select([...cheap,item('Huge',100)],[{equipmentName:'Huge',moneyGain:100000}]);assert.ok(q.items.every(e=>e.name!=='Huge'));
 assert.equal(select([item('A',60),item('B',60)],[],{categoryLimit:100}).items.length,0);
 assert.equal(select([item('A',60),item('B',60)],[],{categoryLimit:200,available:200}).items.length,2);
});
test('invalid prices scores duplicate names and limits remain bounded and deterministic',()=>{
 const items=[...cheap,...good,item('StrongA',20),item('Bad',NaN),item('Negative',-1)];
 const q=select(items,[...values,{equipmentName:'Cheap10',moneyGain:Infinity}]);
 assert.ok(q.items.length<=12);assert.equal(new Set(q.items.map(e=>e.name)).size,q.items.length);assert.ok(q.items.every(e=>e.cost>0&&Number.isFinite(e.cost)));
 assert.deepEqual(select(items,values),select(items,values));assert.equal(select(items,values,{limit:1}).items.length,0);
 assert.equal(select(items,values,{available:NaN}).items.length,0);assert.equal(select(items,values,{limit:1000}).items.length,12);
});
test('shortlist does not mutate input prices stats order or valuation records',()=>{
 const items=[...cheap,...good],snapshot=structuredClone(items),v=structuredClone(values);select(items,values);
 assert.deepEqual(items,snapshot);assert.deepEqual(values,v);
});
test('bounded pair search discovers expensive synergy before cheap pairs exhaust the budget',()=>{
 const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};let calls=0;
 const q=planMarginalGangEquipment({members:{A:member},equipment:[...cheap,...good],maxPurchases:2,maxBundleEvaluations:2,
  budgets:{available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100},
  evaluate:(_,e)=>{calls++;return {moneyGain:e.stats.str>1.8?100:e.stats.str>=1.3?4:.01};}});
 assert.deepEqual(q.orders.map(o=>o.equipmentName).sort(),['StrongA','StrongB']);assert.ok(q.orders[0].bundleId);
 assert.equal(q.diagnostics.bundleEvaluations,2);assert.equal(calls,16);assert.equal(q.firstOpportunity.cost,40);
});
test('new shortlist cannot bypass guard or category budgets for valuable equipment',()=>{
 const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};
 const q=planMarginalGangEquipment({members:{A:member},equipment:[...cheap,...good],maxPurchases:2,maxBundleEvaluations:4,
  budgets:{available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100},purchaseGuard:c=>({allowed:!c.items}),
  evaluate:(_,e)=>({moneyGain:e.stats.str>1.8?100:e.stats.str>=1.3?4:.01})});
 assert.ok(q.orders.every(o=>!o.bundleId));assert.ok(q.diagnostics.purchaseBlocked>0);
});
