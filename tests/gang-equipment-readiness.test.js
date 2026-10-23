import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangEquipmentBudgets,gangEquipmentReadiness,planMarginalGangEquipment,purchaseGangEquipment} from '../gang-policy.js';
import {spendingPlan,adaptiveBudgetSignals} from '../spending-policy.js';
const rates=(money=1,respect=1)=>({A:[{name:'Work',money,respect,wanted:0}]});
const context={goal:{cost:1000,rep:0},money:900,factionRep:0,respectToRep:1,assignments:{A:'Work'},locked:[],tolerance:0};
const check=patch=>gangEquipmentReadiness({context,beforeRates:rates(.2),afterRates:rates(.22),cost:50,...patch});

test('good long-term cash payback cannot delay a nearby augmentation',()=>{
 const q=check();assert.equal(q.allowed,false);assert.equal(q.reason,'delays-augmentation');assert.equal(q.beforeSeconds,100);assert.ok(q.afterSeconds>136);
});
test('equipment that accelerates purchase readiness remains eligible',()=>{
 const q=check({afterRates:rates(.4)});assert.equal(q.allowed,true);assert.equal(q.afterSeconds,75);
 const ready=check({context:{...context,money:1100},cost:50});assert.equal(ready.allowed,true);assert.equal(ready.afterSeconds,0);
 assert.equal(check({context:{...context,money:1000},cost:50}).allowed,false);
});
test('reputation improvements may offset spending when money is not the bottleneck',()=>{
 const q=check({context:{...context,money:1000,goal:{cost:1000,rep:1000}},beforeRates:rates(1,1),afterRates:rates(1,2)});
 assert.equal(q.allowed,true);assert.equal(q.beforeSeconds,200);assert.equal(q.afterSeconds,100);
});
test('previous purchases consume cash and their projected crew gains must be repriced together',()=>{
 const c={...context,money:1000,goal:{cost:1000,rep:100}};
 assert.equal(check({context:c,cost:500,beforeRates:rates(1,.1),afterRates:rates(1,.2)}).allowed,true);
 const next=check({context:c,cost:400,spent:500,beforeRates:rates(1,.2),afterRates:rates(1,.4)});
 assert.equal(next.allowed,false);assert.equal(next.beforeSeconds,100);assert.equal(next.afterSeconds,180);
});
test('distant or unreachable goals retain growth policy while invalid upgrade evidence defers',()=>{
 assert.equal(check({context:{...context,money:100},horizon:100}).reason,'outside-purchase-horizon');
 assert.equal(check({beforeRates:rates(0,0)}).reason,'no-reachable-augmentation-quote');
 assert.equal(check({afterRates:{}}).allowed,false);
 for(const patch of [{cost:NaN},{spent:-1},{horizon:Infinity},{cost:901}])assert.equal(check(patch).allowed,false);
});

const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};
const gear=[{name:'One',type:'Weapon',cost:10,stats:{str:1.1}},{name:'Two',type:'Armor',cost:10,stats:{str:1.1}}];
const plan=patch=>planMarginalGangEquipment({members:{A:member},equipment:gear,evaluate:()=>({moneyGain:1}),
 budgets:{available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100},...patch});
test('equipment selector guards cumulative spend and exposes blocked readiness rather than funding it',()=>{
 const calls=[],q=plan({purchaseGuard:(c,crew,spent)=>{calls.push({cost:c.cost,spent,owned:[...crew.A.upgrades]});return {allowed:spent===0,reason:'test'};}});
 assert.equal(q.orders.length,1);assert.equal(q.diagnostics.purchaseBlocked,1);assert.deepEqual(calls.map(c=>c.spent),[0,10]);assert.ok(calls[1].owned.includes('One'));
 const blocked=plan({purchaseGuard:()=>({allowed:false,reason:'delays-augmentation'})});
 assert.equal(blocked.orders.length,0);assert.equal(blocked.firstOpportunity,null);assert.ok(blocked.diagnostics.purchaseReadiness.every(q=>!q.allowed));
});
test('synergistic bundles are checked once at their total cost',()=>{
 const calls=[],q=plan({evaluate:(_,e)=>({moneyGain:e.stats.str>1.2?1:0}),purchaseGuard:c=>{calls.push(c);return {allowed:true};}});
 assert.equal(q.orders.length,2);assert.equal(calls.length,1);assert.equal(calls[0].cost,20);assert.equal(calls[0].items.length,2);
 assert.equal(plan({evaluate:(_,e)=>({moneyGain:e.stats.str>1.2?1:0}),purchaseGuard:()=>({allowed:false})}).orders.length,0);
});
test('guard errors and exhausted quote budgets defer purchases without bypassing protection',()=>{
 assert.equal(plan({purchaseGuard:()=>{throw Error('bad quote');}}).orders.length,0);
 const q=plan({purchaseGuard:()=>({allowed:false}),maxPurchaseChecks:1});assert.equal(q.orders.length,0);assert.equal(q.diagnostics.purchaseChecks,1);assert.equal(q.diagnostics.purchaseCheckLimited,true);
 assert.equal(plan({purchaseGuard:()=>({allowed:true}),maxPurchaseChecks:0}).orders.length,0);
 assert.equal(plan().orders.length,2);
});
test('controller converts second-based equipment rates to cycles and uses spendable reserved cash',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/purchaseFocusContext&&myGangMembers.length>=12/);assert.match(s,/money:t.money\/5,respect:t.respect\/5,wanted:t.wanted\/5/);
 assert.match(s,/money:homeMoney,workFractions:fractionsFor\(crew\),bonusSeconds:equipmentBonus,tolerance:gangWantedTolerance/);assert.match(s,/cost:candidate.cost,spent,horizon:Math.min\(900,growthHorizon.seconds\)/);
 assert.match(s,/evaluate,purchaseGuard,crewAware:true/);
});

test('higher adaptive equipment caps respect shared allowance and explicit user limits',()=>{
 const q=gangEquipmentBudgets({money:1000,sharedAllowance:1000});assert.deepEqual(q,{available:500,equipmentLimit:200,augLimit:500,bootstrapBudget:50});
 const small=gangEquipmentBudgets({money:1000,sharedAllowance:10});assert.equal(small.available,10);assert.equal(small.bootstrapBudget,10);
 const explicit=gangEquipmentBudgets({money:1000,sharedAllowance:1000,equipmentFraction:0,augmentationFraction:.01});assert.equal(explicit.equipmentLimit,0);assert.equal(explicit.augLimit,10);
 assert.equal(gangEquipmentBudgets({money:1000,sharedAllowance:1000,equipmentFraction:0,augmentationFraction:0}).bootstrapBudget,0);
 assert.equal(gangEquipmentBudgets({money:1000,sharedAllowance:1000,moneyFocus:true}).bootstrapBudget,0);
 assert.equal(gangEquipmentBudgets({money:NaN,sharedAllowance:1}).available,0);
});
test('quick cash returns and recruitment gains increase shared funding within the unreserved wallet',()=>{
 const base={money:1000,reserve:100,homeRam:1024,ownerPid:1,reset:1};
 const ordinary=spendingPlan(base),slow=spendingPlan({...base,signals:{gangEquipmentPayback:600}}),fast=spendingPlan({...base,signals:{gangEquipmentPayback:60}}),recruit=spendingPlan({...base,signals:{gangRecruitmentSecondsSaved:60}});
 assert.ok(fast.allowances.gang>slow.allowances.gang);assert.ok(slow.allowances.gang>ordinary.allowances.gang);assert.ok(recruit.allowances.gang>ordinary.allowances.gang);
 for(const p of [ordinary,slow,fast,recruit])assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=900+1e-8);
 for(const v of [NaN,Infinity,-1,19])assert.equal(spendingPlan({...base,signals:{gangRecruitmentSecondsSaved:v}}).allowances.gang,ordinary.allowances.gang);
});
test('recruitment funding signals retain reset owner and freshness validation',()=>{
 const now=Date.now();let alive=true,reset=2;
 const ns={ps:()=>[{pid:1,filename:'gangs.js'}],getResetInfo:()=>({lastNodeReset:1,lastAugReset:reset}),isRunning:()=>alive,write(){},read:f=>f==='tasks/gang-growth.json'?JSON.stringify({schemaVersion:2,at:now,pid:1,nodeReset:1,augReset:2,equipmentOpportunity:{reason:'recruitment',recruitSecondsSaved:50}}):''};
 assert.equal(adaptiveBudgetSignals(ns).gangRecruitmentSecondsSaved,50);alive=false;assert.equal(adaptiveBudgetSignals(ns).gangRecruitmentSecondsSaved,null);
 alive=true;reset=3;assert.equal(adaptiveBudgetSignals(ns).gangRecruitmentSecondsSaved,null);
});
test('guarded native batches stop after failure and protect the quoted spendable balance',()=>{
 const execute=Function('return ('+purchaseGangEquipment.toString()+')')();
 const run=({money=100,reject=false,prices=[10,10],bundle=false}={})=>{
  const calls=[],ns={getPlayer:()=>({money}),read:()=>'',gang:{getEquipmentCost:n=>prices[n==='One'?0:1],purchaseEquipment:(_,n)=>{calls.push(n);if(reject)return false;money-=10;return true;}}};
  const orders=gear.map((g,i)=>({equipmentName:g.name,member:'A',cost:10,readinessGuarded:true,readinessCashFloor:100-i*10,...(bundle?{bundleId:'bundle'}:{})}));
  return {calls,receipts:execute(ns,orders,0,20,()=>true,()=>true,true)};
 };
 const ok=run();assert.deepEqual(ok.calls,['One','Two']);assert.ok(ok.receipts.every(r=>r.success));
 assert.ok(run({bundle:true}).receipts.every(r=>r.success));
 const reject=run({reject:true});assert.deepEqual(reject.calls,['One']);assert.equal(reject.receipts[1].reason,'readiness-batch-interrupted');
 const poor=run({money:99});assert.deepEqual(poor.calls,[]);assert.equal(poor.receipts[0].reason,'readiness-cash-changed');
 const price=run({prices:[11,10]});assert.deepEqual(price.calls,[]);assert.equal(price.receipts[1].reason,'readiness-batch-interrupted');
});
