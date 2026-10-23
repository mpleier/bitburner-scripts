import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangCheapEquipment,planMarginalGangEquipment,purchaseGangEquipment} from '../gang-policy.js';
const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};
const gear=(name,cost=9,type='Weapon')=>({name,cost,type,stats:{str:1.01}});
const budgets={available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:0};
const plan=patch=>planMarginalGangEquipment({members:{A:member},equipment:[gear('Cheap')],budgets,cheapCash:1000,maxBundleEvaluations:0,evaluate:()=>({moneyGain:0,objectiveGain:0,respectGain:0}),...patch});

test('strict one-percent eligibility rejects boundaries invalid prices and unknown cash',()=>{
 assert.equal(gangCheapEquipment(9.99,1000),true);assert.equal(gangCheapEquipment(10,1000),false);
 for(const cost of [0,-1,NaN,Infinity])assert.equal(gangCheapEquipment(cost,1000),false);
 for(const cash of [0,-1,NaN,Infinity])assert.equal(gangCheapEquipment(1,cash),false);
});
test('cheap equipment qualifies without ROI and without consuming exception funds',()=>{
 const q=plan();assert.equal(q.orders.length,1);assert.equal(q.orders[0].reason,'cheap');assert.equal(q.orders[0].cashPaybackSeconds,null);
 assert.equal(q.orders[0].cheapFraction,.01);assert.equal(q.diagnostics.cheapPlanned,1);assert.deepEqual(member.upgrades,[]);
 assert.equal(q.diagnostics.qualified,1);assert.deepEqual(q.diagnostics.rejected,[]);
 assert.equal(plan({cheapCash:null}).orders.length,0);assert.equal(plan({equipment:[gear('Boundary',10)]}).orders.length,0);
});
test('threshold shrinks after every purchase rather than using the original wallet',()=>{
 const equipment=Array.from({length:20},(_,i)=>gear('Item'+i));
 const q=plan({equipment,maxPurchases:32});assert.equal(q.orders.length,12);assert.equal(q.diagnostics.plannedCost,108);
 assert.ok(q.orders.every(o=>o.reason==='cheap'));assert.equal(q.diagnostics.cheapPlanned,12);
});
test('shared category explicit-zero and purchase-count limits remain authoritative',()=>{
 assert.equal(plan({budgets:{...budgets,available:18},equipment:[gear('A'),gear('B'),gear('C')]}).orders.length,2);
 assert.equal(plan({budgets:{...budgets,equipmentLimit:0}}).orders.length,0);
 assert.equal(plan({budgets:{...budgets,augLimit:0},equipment:[gear('Permanent',9,'Augmentation')]}).orders.length,0);
 assert.equal(plan({maxPurchases:1,equipment:[gear('A'),gear('B')]}).orders.length,1);
});
test('owned and ineligible temporary equipment do not become cheap purchases',()=>{
 assert.equal(plan({members:{A:{...member,upgrades:['Cheap']}}}).orders.length,0);
 const q=plan({equipment:[gear('Temporary'),gear('Permanent',9,'Augmentation')],evaluate:(_,e)=>e.type==='Augmentation'?{moneyGain:0}:null});
 assert.deepEqual(q.orders.map(o=>o.equipmentName),['Permanent']);
});
test('cheap catch-up runs first and larger equipment still needs its return forecast',()=>{
 const q=plan({cheapCash:10000,budgets:{...budgets,available:2000,equipmentLimit:2000},equipment:[gear('Cheap',10),gear('Large',1000)],maxPurchases:2,evaluate:(_,e)=>({moneyGain:e.cost===1000?200:0})});
 assert.deepEqual(q.orders.map(o=>o.reason),['cheap','production']);assert.equal(q.diagnostics.bundleEvaluations,0);
 assert.equal(plan({equipment:[gear('Large',1000)]}).orders.length,0);
});
test('augmentation readiness can reject cheap equipment without any ROI fallback bypass',()=>{
 const calls=[],q=plan({evaluate:()=>({moneyGain:1}),purchaseGuard:c=>{calls.push(c.reason);return {allowed:false,reason:'delays-augmentation'};}});
 assert.equal(q.orders.length,0);assert.deepEqual(calls,['cheap']);assert.equal(q.firstOpportunity,null);
});

const execute=Function('return ('+purchaseGangEquipment.toString()+')')();
function native({money=1000,reserve=0,cost=9,orders=1,fraction=.01,hold=0}={}){
 const calls=[],ns={getPlayer:()=>({money}),read:()=>String(hold),gang:{getEquipmentCost:()=>cost,purchaseEquipment:(_,n)=>{calls.push(n);money-=cost;return true;}}};
 const batch=Array.from({length:orders},(_,i)=>({member:'A',equipmentName:'Item'+i,cost,reason:'cheap',cheapFraction:fraction}));
 return {calls,receipts:execute(ns,batch,reserve,1000,()=>true,()=>true,true)};
}
test('serialized native execution rechecks shrinking cash for every cheap order',()=>{
 const q=native({orders:20});assert.equal(q.calls.length,12);assert.equal(q.receipts[12].reason,'cheap-threshold-changed');
 assert.ok(q.receipts.slice(0,12).every(r=>r.success));
});
test('native reserves and invalid fraction metadata cannot bypass one percent',()=>{
 assert.equal(native({reserve:100}).calls.length,0);assert.equal(native({cost:8,reserve:100}).calls.length,1);
 assert.equal(native({cost:8,hold:900}).calls.length,0);
 for(const fraction of [undefined,0,.02,NaN]){
  const q=native({fraction:fraction===undefined?null:fraction});assert.equal(q.calls.length,0);
 }
});
test('controller bases cheap purchases on native unreserved cash and retains ascension exclusion',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/cheapCash:homeMoney/);assert.match(s,/homeMoney = Math.max\(0, playerData.money - reserve\)/);
 assert.match(s,/equip.type!=='Augmentation'&&plannedAscensions.has\(member.name\)/);
});
