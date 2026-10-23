import test from 'node:test';
import assert from 'node:assert/strict';
import {gangAugmentationBundles,readSelectedGangBundleGoal} from '../gang-augmentation-bundle-policy.js';
import {progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
const a=(name,price,rep,prereqs=[],stats={strength:2},desired=true)=>({name,price,rep,prereqs,stats,desired});
const plan=(catalog,extra={})=>({faction:'Gang',catalog,owned:[],base:[],multiplier:2,donations:0,...extra});
const context={channels:{strength:1},reputation:0,repRate:1,cashRate:1,worth:0};
test('gang bundles share prerequisite cost reputation and multipliers exactly once',()=>{
 const q=gangAugmentationBundles(plan([a('Root',10,100,[],{strength:1.1},false),a('A',100,50,['Root']),a('B',50,80,['Root'])]),context);
 assert.equal(q.length,1);assert.equal(q[0].cashTarget,410);assert.equal(q[0].eta,410000);assert.equal(q[0].gangBundle.rep,100);
 assert.equal(q[0].augmentations.length,3);assert.equal(q[0].stats.strength,4.4);
});
test('committed basket donations and owned queued prerequisites are included without double inflation',()=>{
 const p=plan([a('A',100,20,['Queued']),a('B',50,30)],{owned:['Queued'],base:[a('Ready',10,0)],donations:7});
 const q=gangAugmentationBundles(p,{...context,worth:1000})[0];assert.equal(q.cashTarget,247);assert.equal(q.eta,30000);
 assert.equal(q.augmentations.some(a=>a.name==='Ready'||a.name==='Queued'),false);
});
test('invalid cycles missing suppliers malformed quotes and repeatable catalog are rejected',()=>{
 for(const catalog of [[a('A',10,1,['B']),a('B',10,1,['A'])],[a('A',10,1,['Missing']),a('B',10,1)],[a('A',NaN,1),a('B',1,1)],[a('A',1,1,[],{strength:NaN}),a('B',1,1)],[a('NeuroFlux Governor',1,1),a('B',1,1)]])assert.deepEqual(gangAugmentationBundles(plan(catalog),context),[]);
 for(const patch of [{multiplier:NaN},{donations:-1},{owned:[null]},{base:[a('Broken',1,0,['Missing'])]}])assert.deepEqual(gangAugmentationBundles(plan([a('A',1,1),a('B',1,1)],patch),context),[]);
});
test('unknown income reputation and overlong waits cannot justify bundling',()=>{
 const p=plan([a('A',10,100),a('B',10,100)]);
 for(const patch of [{cashRate:0},{repRate:0},{repRate:NaN},{cashRate:.0001}])assert.deepEqual(gangAugmentationBundles(p,{...context,...patch}),[]);
 assert.equal(gangAugmentationBundles(p,{...context,worth:100,reputation:100}).length,0);
});
test('bounded shortlist evaluates at most 35 pair and triple closures',()=>{
 const q=gangAugmentationBundles(plan(Array.from({length:40},(_,i)=>a('A'+i,1,1))),context);assert.ok(q.length<=35);assert.ok(q.length>0);
});
test('repeatable entries in committed basket retain separate increasing prices',()=>{
 const q=gangAugmentationBundles(plan([a('A',10,1),a('B',5,1)],{base:[a('NeuroFlux Governor',1,0),a('NeuroFlux Governor',2,0)]}),context)[0];
 assert.equal(q.cashTarget,10+10+4+16);
});
function speed({bad=false,repRate=1,at=1000000,recoveryCost=0}={}){
 const catalog=[a('A',10,100,[],{strength:5}),a('B',10,100,[],{dexterity:5})],gangBundlePlan=plan(catalog);
 const snapshot={at,augReset:2,nodeReset:1,worth:1000,reputation:{Gang:100},gangFaction:'Gang',gangRepRate:repRate,ready:[{name:'Ready',stats:{strength:2}}],targets:[],gangBundlePlan:{...gangBundlePlan,catalog:catalog.map(a=>({...a,rep:200}))},resetEconomics:{known:true,replacementCost:recoveryCost,gangLossPerSecond:0}};
 const previous={at:at-30000,augReset:2,worth:1000,reputation:{Gang:70},gangFaction:'Gang',repRates:{Gang:1},fingerprint:'["Ready"]',lastGrowthAt:at-700000};
 return progressionSpeed({snapshot,previous:bad?null:previous,now:at,augReset:2,nodeReset:1,combat:true,elapsed:3600000,homeRam:1024});
}
test('progression compares gang bundles using reset recovery and shares the fixed wait deadline',()=>{
 const q=speed();assert.ok(q.waitOptions.some(o=>o.gangBundle?.chain.length===2));const c=q.waitOptions.find(o=>o.gangBundle);
 assert.equal(c.etaMs,100000);assert.ok(c.recoveryMs>=1200000);assert.deepEqual(c.gangBundle.chain.sort(),['A','B']);
 const profitable={...q,resetPaysBack:true,paybackMs:4000000};
 const blocked=augmentationResetDecision({requested:true,speed:profitable,now:1000000,augReset:2,nodeReset:1});assert.equal(blocked.allowed,false);assert.ok(blocked.waitPlan.gangBundle);
 const expired={...blocked.waitWindow,expiresAt:1000001};assert.equal(augmentationResetDecision({requested:true,speed:profitable,waitWindow:expired,now:1000002,augReset:2,nodeReset:1}).allowed,true);
});
test('unmeasured or stopped gang production cannot publish a bundle wait',()=>{
 assert.equal(speed({bad:true}).waitOptions.some(o=>o.gangBundle),false);assert.equal(speed({repRate:0}).waitOptions.some(o=>o.gangBundle),false);
});

test('diverse shortlist finds affordable bundles outside the strongest six',()=>{
 const expensive=Array.from({length:8},(_,i)=>a('Expensive'+i,1e15,1e9,[],{strength:100+i}));
 const q=gangAugmentationBundles(plan([...expensive,a('Cheap1',1,5,[],{strength:1.1}),a('Cheap2',2,6,[],{strength:1.2})]),context);
 assert.ok(q.some(c=>c.gangBundle.chain.includes('Cheap1')&&c.gangBundle.chain.includes('Cheap2')));assert.ok(q.length<=35);
});
function selectedFixture(){
 const reset={lastNodeReset:1,lastAugReset:2},at=1000000;
 const p=plan([a('A',10,100),a('B',5,200)],{ownershipSignature:'owned'});
 const summary={schemaVersion:1,at,nodeReset:1,augReset:2,ownershipSignature:'owned',speedSnapshot:{gangBundlePlan:p}};
 const b={faction:'Gang',ownershipSignature:'owned',rep:200,cost:20,chain:['A','B']};
 const wait={schemaVersion:1,active:true,nodeReset:1,augReset:2,at,ownerPid:7,startedAt:at,expiresAt:at+900000,
  plan:{at,name:'A + B',worthWaiting:true,deadline:at+900000,cashTarget:20,gangBundle:b}};
 const ns={read:f=>JSON.stringify(f.includes('wait-plan')?wait:summary),ps:()=>[{pid:7,filename:'autopilot.js'}]};return {ns,wait,summary,b,reset,at};
}
test('selected gang bundle supplies combined cash and rep goal to production',()=>{
 const f=selectedFixture(),goal=readSelectedGangBundleGoal(f.ns,'Gang',f.reset,f.at+1000);
 assert.equal(goal.source,'selected-gang-bundle');assert.equal(goal.rep,200);assert.equal(goal.cost,20);assert.deepEqual(goal.chain,['A','B']);
});
test('stale disabled expired cross-reset dead-owner and changed-ownership bundle goals are ignored',()=>{
 for(const mutate of [f=>f.wait.active=false,f=>f.wait.at-=120001,f=>f.wait.augReset=3,f=>f.wait.expiresAt=f.at,f=>f.wait.plan.deadline=f.at,f=>f.b.ownershipSignature='changed',f=>f.summary.ownershipSignature='manual-purchase',f=>f.summary.at-=120001,f=>f.b.faction='Other',f=>f.b.rep=999,f=>f.b.cost=NaN,f=>f.b.chain=['Missing','B'],f=>f.b.chain=['A','A'],f=>f.ns.ps=()=>[]]){
  const f=selectedFixture();mutate(f);assert.equal(readSelectedGangBundleGoal(f.ns,'Gang',f.reset,f.at),null);
 }
 const f=selectedFixture();f.ns.read=()=>{throw Error('optional API unavailable');};assert.equal(readSelectedGangBundleGoal(f.ns,'Gang',f.reset,f.at),null);
});
