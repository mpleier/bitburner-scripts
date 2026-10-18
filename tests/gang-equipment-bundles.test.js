import test from 'node:test';
import assert from 'node:assert/strict';
import {planMarginalGangEquipment,rankGangEquipment,purchaseGangEquipment} from '../gang-policy.js';
const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]};
const gear=[{name:'one',type:'Weapon',cost:10,stats:{str:1.1}},{name:'two',type:'Armor',cost:10,stats:{str:1.1}}];
const budgets={available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100};
const plan=(extra={})=>planMarginalGangEquipment({members:{A:member},equipment:gear,budgets,
 evaluate:(m,e)=>({moneyGain:0,objectiveGain:e.stats.str>1.2?1:0,relativeObjectiveGain:e.stats.str>1.2?.1:0}),
 recruitment:{allowProgression:true},...extra});
test('joint stat multipliers unlock a pair that neither single unlocks',()=>{
 const p=plan();assert.equal(p.orders.length,2);assert.equal(p.orders[0].bundleId,p.orders[1].bundleId);
 assert.equal(p.firstOpportunity.cost,20);assert.equal(p.firstOpportunity.reason,'progression');
 assert.equal(p.diagnostics.plannedCost,20);assert.equal(p.diagnostics.bundleEvaluations,1);
 assert.deepEqual(member.upgrades,[]);assert.equal(member.str_mult,1);
});
test('pair cannot bypass total, category, exception or purchase-count caps',()=>{
 for(const patch of [{available:19},{equipmentLimit:0},{bootstrapBudget:19}])assert.equal(plan({budgets:{...budgets,...patch}}).orders.length,0);
 assert.equal(plan({maxPurchases:1}).orders.length,0);
 assert.equal(plan({recruitment:{allowProgression:false}}).orders.length,0);
});
test('meaningful progression has a capped budget and never reports cash ROI',()=>{
 const o={cost:1e6,moneyGain:0,objectiveGain:1,relativeObjectiveGain:.03};
 const r={allowProgression:true,bootstrapBudget:1e6};
 const [accepted]=rankGangEquipment([o],900,r);assert.equal(accepted.reason,'progression');assert.equal(accepted.cashPaybackSeconds,null);
 assert.equal(rankGangEquipment([{...o,relativeObjectiveGain:.019}],900,r).length,0);
 assert.equal(rankGangEquipment([o],900,{...r,bootstrapBudget:999999}).length,0);
 assert.equal(rankGangEquipment([{...o,objectiveGain:0}],900,r).length,0);
});
test('permanent gear wins equivalent return ties, without ignoring better returns',()=>{
 const weapon={cost:10,moneyGain:1,type:'Weapon'},aug={...weapon,type:'Augmentation'};

 assert.equal(rankGangEquipment([weapon,aug])[0].type,'Augmentation');
 assert.equal(rankGangEquipment([{...weapon,moneyGain:2},aug])[0].type,'Weapon');
});
test('diagnostics distinguish ownership, ineligible gear, budget and value filters',()=>{
 const p=plan({members:{A:{...member,upgrades:['one']}},evaluate:()=>null});
 assert.equal(p.diagnostics.owned,1);assert.equal(p.diagnostics.missing,1);assert.equal(p.diagnostics.ineligible,1);
 const q=plan({evaluate:()=>({moneyGain:1}),budgets:{...budgets,equipmentLimit:0}});
 assert.equal(q.diagnostics.qualified,2);assert.equal(q.diagnostics.budgetBlocked,2);assert.equal(q.orders.length,0);
 const z=plan({evaluate:()=>({moneyGain:0})});assert.ok(z.diagnostics.rejected.every(r=>r.reason==='no-projected-gain'));
});
test('affordable first opportunity excludes a blocked higher-ranked category',()=>{
 const p=plan({equipment:[gear[0],{...gear[1],type:'Augmentation'}],budgets:{...budgets,augLimit:0},evaluate:()=>({moneyGain:1})});
 assert.equal(p.firstOpportunity.type,'Weapon');assert.equal(p.orders.length,1);
});
test('pair search is bounded to twelve cheapest items per category and member',()=>{
 const equipment=Array.from({length:30},(_,i)=>({...gear[0],name:String(i),cost:i+1}));
 const p=plan({equipment,evaluate:()=>({moneyGain:0})});assert.equal(p.diagnostics.bundleEvaluations,66);
});
test('no mixed permanent and temporary bundle can bypass ascension exclusion',()=>{
 assert.equal(plan({equipment:[gear[0],{...gear[1],type:'Augmentation'}]}).orders.length,0);
});
const orders=()=>gear.map(g=>({member:'A',equipmentName:g.name,cost:g.cost,bundleId:'pair'}));
function native({money=100,prices=[10,10],reject=false}={}){
 const calls=[],claims=[];
 return {calls,claims,ns:{read:()=>'',getPlayer:()=>({money}),gang:{getEquipmentCost:n=>prices[n==='one'?0:1],
  purchaseEquipment:(m,n)=>{calls.push(n);return !reject;}}},claim:(ns,k,amount)=>{claims.push(amount);return true;}};
}
test('native bundle claims full funding once and preserves per-item receipts',()=>{
 const n=native();const receipts=purchaseGangEquipment(n.ns,orders(),0,20,n.claim,()=>true,true);
 assert.deepEqual(n.claims,[20]);assert.deepEqual(n.calls,['one','two']);assert.ok(receipts.every(r=>r.success));
});
test('native bundle preflight rejects the entire pair on changed price or insufficient cash',()=>{
 for(const options of [{prices:[10,11]},{prices:[NaN,10]},{money:19}]){
  const n=native(options);const r=purchaseGangEquipment(n.ns,orders(),0,20,n.claim,()=>true,true);
  assert.ok(r.every(r=>!r.success));assert.deepEqual(n.calls,[]);assert.deepEqual(n.claims,[]);
 }
});
test('native shared-budget denial and pause prevent bundle mutations',()=>{
 const n=native();purchaseGangEquipment(n.ns,orders(),0,20,()=>false,()=>true,true);assert.deepEqual(n.calls,[]);
 purchaseGangEquipment(n.ns,orders(),0,20,n.claim,()=>false,true);assert.deepEqual(n.calls,[]);
});
test('unexpected native rejection stops the rest of the bundle',()=>{
 const n=native({reject:true});const r=purchaseGangEquipment(n.ns,orders(),0,20,n.claim,()=>true,true);
 assert.deepEqual(n.calls,['one']);assert.equal(r[1].reason,'bundle-interrupted');
});
test('serialized purchase helper remains self-contained',()=>{
 const execute=Function('return ('+purchaseGangEquipment.toString()+')')();const n=native();
 assert.ok(execute(n.ns,orders(),0,20,n.claim,()=>true,true).every(r=>r.success));
});
