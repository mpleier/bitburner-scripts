import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planMarginalGangEquipment} from '../gang-policy.js';
const member=name=>({name,str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]});
const gear=(name,cost=9,type='Weapon')=>({name,cost,type,stats:{str:1.01}});
const budgets={available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:0};
const plan=patch=>planMarginalGangEquipment({members:{A:member('A')},equipment:[gear('Cheap')],budgets,cheapCash:1000,cheapEligibility:()=>true,
 maxBundleEvaluations:0,evaluate:()=>{throw Error('Unexpected return forecast');},...patch});

test('eligible cheap equipment is bought without invoking a return forecast',()=>{
 const q=plan();assert.equal(q.orders.length,1);assert.equal(q.orders[0].reason,'cheap');assert.equal(q.diagnostics.returnForecasts,0);
 assert.equal(q.diagnostics.cheapFastTracked,1);assert.equal(q.orders[0].cashPaybackSeconds,null);
});
test('ascension eligibility can exclude temporary gear while retaining permanent upgrades',()=>{
 const q=plan({equipment:[gear('Temporary'),gear('Permanent',9,'Augmentation')],cheapEligibility:(_,e)=>e.type==='Augmentation'});
 assert.deepEqual(q.orders.map(o=>o.equipmentName),['Permanent']);assert.ok(q.diagnostics.cheapEligibilityRejected>0);assert.equal(q.diagnostics.returnForecasts,0);
});
test('eligibility exceptions defer rather than falling through to an unapproved purchase',()=>{
 const q=plan({cheapEligibility:()=>{throw Error('Unavailable');}});assert.equal(q.orders.length,0);assert.equal(q.diagnostics.returnForecasts,0);assert.equal(q.diagnostics.cheapEligibilityRejected,1);
});
test('large items and callers without a cheap eligibility callback still invoke the existing evaluator',()=>{
 let calls=0;const evaluate=()=>{calls++;return {moneyGain:1};};
 const large=plan({equipment:[gear('Large',100)],evaluate});assert.equal(large.orders[0].reason,'production');assert.equal(calls,1);
 calls=0;const legacy=plan({cheapEligibility:null,evaluate});assert.equal(legacy.orders[0].reason,'cheap');assert.equal(calls,1);
});
test('a deferred item crossing above the shrinking threshold gets a fresh larger-item forecast',()=>{
 const calls=[],q=plan({members:{A:member('A'),B:member('B')},equipment:[gear('Item',9.99)],maxPurchases:2,
  evaluate:(m,e,c)=>{calls.push([m.name,c.A.upgrades.includes('Item')]);return {moneyGain:1};}});
 assert.deepEqual(q.orders.map(o=>o.reason),['cheap','production']);assert.deepEqual(calls,[['B',true]]);assert.equal(q.diagnostics.returnForecasts,1);
});
test('expired forecast budget cannot promote an unvalued formerly cheap item',()=>{
 let time=0;
 const q=plan({members:{A:member('A'),B:member('B')},equipment:[gear('Item',9.99)],maxPurchases:2,maxPlanningMs:10,now:()=>time,
  purchaseGuard:()=>{time=7;return {allowed:true};}});
 assert.equal(q.orders.length,1);assert.equal(q.diagnostics.deferredForecasts,1);assert.equal(q.diagnostics.returnForecasts,0);assert.equal(q.diagnostics.timeLimited,true);
});
test('augmentation readiness guard still executes and can deny a fast-tracked cheap item',()=>{
 let checks=0;const q=plan({purchaseGuard:()=>{checks++;return {allowed:false,reason:'delays-augmentation'};}});
 assert.equal(q.orders.length,0);assert.equal(checks,1);assert.equal(q.diagnostics.returnForecasts,0);assert.equal(q.firstOpportunity,null);
});
test('controlled replay preserves cheap purchases while reducing return evaluator calls',()=>{
 const equipment=[gear('One'),gear('Two'),gear('Three'),gear('Large',100)];
 let baselineCalls=0,fastCalls=0;
 const base=plan({equipment,maxPurchases:3,crewAware:true,maxPlanningMs:Infinity,cheapEligibility:null,evaluate:()=>{baselineCalls++;return {moneyGain:1};}});
 const fast=plan({equipment,maxPurchases:3,crewAware:true,maxPlanningMs:Infinity,evaluate:()=>{fastCalls++;return {moneyGain:1};}});
 assert.deepEqual(fast.orders.map(o=>o.equipmentName),base.orders.map(o=>o.equipmentName));
 assert.equal(baselineCalls,9);assert.equal(fastCalls,3);assert.equal(fast.diagnostics.returnForecasts,3);
});
test('fast tracking preserves ownership category and shared cash limits',()=>{
 const a=member('A'),copy=structuredClone(a);
 const q=plan({members:{A:a},equipment:[gear('One'),gear('Two'),gear('Three')],budgets:{...budgets,available:18}});
 assert.equal(q.orders.length,2);assert.equal(q.diagnostics.plannedCost,18);assert.deepEqual(a,copy);
 assert.equal(plan({budgets:{...budgets,equipmentLimit:0}}).orders.length,0);
});
test('controller supplies lightweight eligibility without removing the regular ascension guard',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/cheapEligibility:\(member,equip\)=>equip.type==='Augmentation'\|\|!plannedAscensions.has\(member.name\)/);
 assert.match(s,/equip.type!=='Augmentation'&&plannedAscensions.has\(member.name\)/);
 assert.match(s,/evaluate,purchaseGuard,crewAware:true/);
});
