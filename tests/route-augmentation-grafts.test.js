import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {augmentationStatFilters} from '../faction-policy.js';
import {graftProgressionValue} from '../automation-policy.js';
import {graftTick} from '../grafting-manager.js';
import {estimateBladeburnerRoute} from '../node-route-policy.js';
const now=1000000,reset={lastNodeReset:1,lastAugReset:2};
const route={at:now,...{nodeReset:1,augReset:2},selected:'hacking',routes:{hacking:{actionable:true,phase:'xp',lowerMs:7200000,upperMs:10800000,xpRate:100}}};
const cash={at:now,augReset:2,cashRate:1e6,cashObservation:{schemaVersion:1,augReset:2,mode:'sources-v1',samples:[{at:now-30000,rate:1e6},{at:now,rate:1e6}]}};
const input=(extra={})=>({now,reset,route,cash,stats:{hacking_exp:2},factor:1,duration:60000,cost:1e6,...extra});
test('automatic augmentation filters follow the selected route rather than BitNode or age',()=>{
 assert.ok(!augmentationStatFilters({route:'hacking',node:7}).includes('strength'));
 assert.ok(augmentationStatFilters({route:'bladeburner',node:1}).includes('bladeburner'));
 assert.ok(!augmentationStatFilters({route:'bladeburner',node:7}).includes('hacking_money'));
 assert.deepEqual(augmentationStatFilters({node:8}),['hacking_level','hacking_exp']);
 const explicit=['_'];const result=augmentationStatFilters({route:'hacking',node:8,explicit});result.push('other');assert.deepEqual(explicit,['_']);
});
test('runtime count fillers are restricted to the hacking route and wildcard overrides remain explicit',()=>{
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(source.includes("if(augmentationRoute!=='bladeburner'&&!options['disable-count-building']"));
 assert.ok(source.includes("desiredStatsFilters=augmentationStatFilters({route:augmentationRoute,node:bitNode,explicit:options['stat-desired']})"));
 assert.ok(!source.includes('const willTakeAnyAug'));
});
test('actual augmentation constructor excludes irrelevant stats but preserves explicit milestones',()=>{
 const text=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 const start=text.indexOf('        this.name = aug;'),end=text.indexOf('        // Get the name of the',start);
 const code='globalThis.make=function(aug,augmentationStats){const reputationRequirement=0,price=1,augmentationPrereqs=[];'+text.slice(start,end)+';return this;}';
 const context={simulatedOwnedAugmentations:[],desiredAugs:["The Red Pill"],desiredStatsFilters:augmentationStatFilters({route:'bladeburner'}),isStatDesired:stat=>augmentationStatFilters({route:'bladeburner'}).some(filter=>stat.includes(filter)||stat===filter.replace('_level',''))};
 vm.runInNewContext(code,context);
 assert.equal(context.make.call({},'Hack',{hacking_money:1.5,strength:1}).desired,false);
 assert.equal(context.make.call({},'Combat',{strength:1.1}).desired,true);
 assert.equal(context.make.call({},'The Red Pill',{}).desired,true);
});
test('XP progression can repay a graft with no invented cash income',()=>{
 const r=graftProgressionValue(input());assert.equal(r.eligible,true);assert.equal(r.basis,'measured-xp-half-credit');assert.equal(r.savedMs,1800000);assert.equal(r.cashRebuildMs,1000);assert.equal(r.netSavedMs,1739000);
});
test('entropy losses, unknown work and short remaining routes cannot justify progression grafts',()=>{
 for(const patch of [{factor:.98},{duration:4000000},{cost:1e15},{incomeLossPerSecond:1e6},{stats:{strength:10}},
  {route:{...route,routes:{hacking:{...route.routes.hacking,phase:'backdoor'}}}},{route:{...route,routes:{hacking:{...route.routes.hacking,lowerMs:0}}}}])
 assert.equal(graftProgressionValue(input(patch)).eligible,false);
});
test('stale route, stale income, stock-price windfalls and malformed samples never grant permission',()=>{
 for(const patch of [{route:null},{route:{...route,at:now-45001}},{route:{...route,at:now+1}},{route:{...route,nodeReset:9}},{cash:null},{cash:{...cash,augReset:3}},
  {cash:{...cash,at:now-120001}},{cash:{...cash,cashObservation:{...cash.cashObservation,mode:'legacy-worth-v1'}}},
  {cash:{...cash,cashObservation:{...cash.cashObservation,samples:[null,null]}}}])assert.equal(graftProgressionValue(input(patch)).eligible,false);
});
test('Bladeburner recovery credits native regeneration only after protecting all known capability',()=>{
 const bb={...route,selected:'bladeburner',routes:{bladeburner:{actionable:true,lowerMs:7200000,upperMs:10800000,recoveryModel:'amortized-native',recoveryMs:4000000,staminaRecovery:{regen:10,hrc:0}}}};
 const r=graftProgressionValue(input({route:bb,stats:{bladeburner_stamina_gain:2}}));assert.equal(r.eligible,true);assert.equal(r.savedMs,1000000);
 assert.equal(graftProgressionValue(input({route:bb,stats:{bladeburner_stamina_gain:2},factor:.98})).eligible,false);
 assert.equal(graftProgressionValue(input({route:bb,stats:{bladeburner_success_chance:2}})).eligible,false);
 assert.equal(graftProgressionValue(input({route:{...bb,routes:{bladeburner:{...bb.routes.bladeburner,staminaRecovery:null}}},stats:{bladeburner_stamina_gain:2}})).eligible,false);
 const slower=graftProgressionValue(input({route:{...bb,routes:{bladeburner:{...bb.routes.bladeburner,staminaRecovery:{regen:10,hrc:10}}}},stats:{bladeburner_stamina_gain:2}}));assert.ok(slower.savedMs<r.savedMs);
});
function fixture(){
 const at=Date.now(),r={...reset,currentNode:10,ownedSF:new Map([[4,3]])},plan={...route,at,ownerPid:7},observed={...cash,at,cashObservation:{...cash.cashObservation,samples:[{at:at-30000,rate:1e6},{at,rate:1e6}]}};
 const store=new Map([['tasks/node-route-plan.json',JSON.stringify(plan)],['tasks/speed-observation.json',JSON.stringify(observed)]]),started=[];
 const ns={pid:5,read:f=>store.get(f)||'',getResetInfo:()=>r,ps:()=>[{pid:7,filename:'autopilot.js'}],getPlayer:()=>({city:'New Tokyo',money:1e9,entropy:0}),getTotalScriptIncome:()=>[0,0],getMoneySources:()=>({sinceInstall:{}}),
 singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>['Congruity Implant'],getAugmentationPrereq:()=>[],getAugmentationStats:()=>({hacking_exp:2}),travelToCity:()=>true},
 grafting:{getGraftableAugmentations:()=>['XP'],getAugmentationGraftPrice:()=>1e6,getAugmentationGraftTime:()=>60000,graftAugmentation:name=>{started.push(name);return true;}}};
 return {ns,store,started,plan};
}
test('actual graft manager can choose a progression-only graft with live evidence',()=>{
 const f=fixture(),r=graftTick(f.ns);assert.equal(r.status,'started');assert.equal(r.basis,'progression');assert.deepEqual(f.started,['XP']);
});
test('actual graft manager preserves reserve, queued ownership and stale-evidence safety',()=>{
 for(const mode of ['reserve','queued','stale']){
  const f=fixture();if(mode==='reserve')f.store.set('reserve.txt','1000000000');
  if(mode==='queued')f.ns.singularity.getOwnedAugmentations=()=>['Congruity Implant','XP'];
  if(mode==='stale')f.store.set('tasks/node-route-plan.json',JSON.stringify({...f.plan,at:Date.now()-60000}));
  assert.equal(graftTick(f.ns).status,'waiting');assert.equal(f.started.length,0);
 }
});
