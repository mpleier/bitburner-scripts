import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangPowerSpendingFraction,gangPowerPurchaseAllowed} from '../gang-power-policy.js';
import {projectGangMember,purchaseGangEquipment,gangEquipmentBudgets,gangWarfareReadyDelay,gangWallSeconds} from '../gang-policy.js';
const evidence={powerPriority:true,beforeSeconds:1000,afterSeconds:800,horizon:900,clashChance:0};
test('larger power spending requires explicit priority and material reachable readiness savings',()=>{
 assert.equal(gangPowerSpendingFraction(evidence),.05);
 for(const patch of [{powerPriority:false},{clashChance:.1},{afterSeconds:990},{afterSeconds:901},{beforeSeconds:Infinity},{afterSeconds:NaN},{horizon:0}])assert.equal(gangPowerSpendingFraction({...evidence,...patch}),.01);
});
function fixture(){
 const keys=['hack','str','def','dex','agi','cha'],m=projectGangMember({name:'M0',...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',10000],[k+'_mult',1],[k+'_asc_mult',1]])),upgrades:[],augmentations:[]},null,0);
 const g={faction:'Own',power:100,territory:.2,territoryClashChance:0,territoryWarfareEngaged:false};
 const q={at:Date.now(),horizon:900,power:100,territory:.2,rivalPower:100,threshold:.75,faction:'Own',nodeReset:1,augReset:2,powerPriority:true,
  largerPurchase:{beforeSeconds:1000,afterSeconds:800,powerGainPerTick:.015*.2*m.str/95}};
 const order={reason:'power',type:'Weapon',member:'M0',equipmentName:'Gear',cost:20,powerPaybackSeconds:20,powerQuote:q};
 const ns={getPlayer:()=>({money:1000}),read:()=>'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),gang:{getGangInformation:()=>g,getAllGangInformation:()=>({Own:g,Rival:{power:100,territory:.8}}),getMemberInformation:()=>m,getEquipmentStats:()=>({str:2}),getEquipmentCost:()=>20,purchaseEquipment:()=>true}};
 return {ns,m,g,q,order};
}
test('serialized native power guard accepts a justified purchase above one percent',()=>{
 const f=fixture(),guard=Function('return ('+gangPowerPurchaseAllowed.toString()+')')();assert.equal(guard(f.ns,f.order),true);
});
test('larger native purchases reject weak evidence changed native benefits clashes and reserves',()=>{
 for(const mutate of [f=>delete f.q.largerPurchase,f=>f.q.powerPriority=false,f=>f.q.largerPurchase.afterSeconds=990,f=>f.q.largerPurchase.afterSeconds=901,
  f=>f.q.largerPurchase.powerGainPerTick*=10,f=>f.g.territoryClashChance=.1,f=>f.g.territoryWarfareEngaged=true,f=>f.q.trainingTask='Train Combat',
  f=>f.q.reserve=700,f=>f.order.cost=51,f=>f.ns.gang.getEquipmentStats=()=>({str:1}),f=>f.q.at-=6000]){const f=fixture();mutate(f);assert.equal(gangPowerPurchaseAllowed(f.ns,f.order),false);}
});
test('expanded power spending preserves batch shared allowance price and lifetime guards',()=>{
 const run=(patch={},claim=()=>true,budget=100)=>{const f=fixture();Object.assign(f.order,patch);return purchaseGangEquipment(f.ns,[f.order],0,budget,claim,()=>true,true,null,gangPowerPurchaseAllowed)[0];};
 assert.equal(run().reason,'purchased');assert.equal(run({},()=>false).reason,'shared-budget');assert.equal(run({},()=>true,10).reason,'batch-budget');
 assert.equal(run({lifetimeExpiresAt:Date.now()+1000}).reason,'equipment-lifetime-changed');assert.equal(run({cost:19}).reason,'price-increased');
 const b=gangEquipmentBudgets({money:1000,sharedAllowance:30});assert.equal(b.available,30);assert.equal(b.bootstrapBudget,30);
});
test('controller keeps unreachable warfare ETA infinite and uses the expanded evidence gate',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/Number.isFinite\(game\)\?gangWallSeconds\(game,equipmentBonus\):Infinity/);
 assert.match(s,/equip.cost<=homeMoney\*fraction/);assert.match(s,/largerPurchase=\{beforeSeconds:beforeETA,afterSeconds:afterETA,powerGainPerTick:after-before\}/);
 const delay=gangWarfareReadyDelay(1,0,{threshold:.75,rivalPower:100});assert.equal(delay,Infinity);
 assert.equal(Number.isFinite(delay)?gangWallSeconds(delay,0):Infinity,Infinity);
});
