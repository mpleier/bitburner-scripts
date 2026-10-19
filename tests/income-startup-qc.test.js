import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {purchaseHomeRam} from '../Tasks/ram-manager.js';
import {trainBladeburnerEntrySource} from '../node-route-selection-policy.js';
import {sleeveStartupPlan} from '../sleeve-policy.js';

const purchase=vm.runInNewContext('('+purchaseHomeRam.toString()+')');
function ramFixture(){
 const files={};let money=1000,ram=128,cost=100,claims=0,purchases=0;
 const ns={read:f=>files[f]||'',isRunning:()=>true,getResetInfo:()=>({bitNodeOptions:{}}),getServerMaxRam:()=>ram,getPlayer:()=>({money}),singularity:{getUpgradeHomeRamCost:()=>cost,upgradeHomeRam:()=>{purchases++;money-=cost;ram*=2;return true;}}};
 return {ns,files,run:(budget=200,reserve=null,expected=128)=>purchase(ns,budget,reserve,expected,()=>{claims++;return true;},()=>true),
  cost:v=>cost=v,money:v=>money=v,ram:v=>ram=v,counts:()=>({claims,purchases,money,ram})};
}
test('serialized RAM purchase uses its actual quote and reports actual expenditure',()=>{
 const f=ramFixture();f.cost(150);const p=f.run();assert.equal(p.purchased,true);assert.equal(p.cost,150);assert.equal(p.ram,256);assert.equal(f.counts().money,850);
});
test('RAM quote rising above remaining budget cannot consume shared allowance',()=>{
 const f=ramFixture();f.cost(201);assert.equal(f.run().reason,'budget');assert.equal(f.counts().claims,0);assert.equal(f.counts().purchases,0);
});
test('RAM purchase refreshes cash and file reserves at mutation time',()=>{
 for(const mode of ['cash','reserve']){const f=ramFixture();if(mode==='cash')f.money(99);else f.files['reserve.txt']='950';assert.equal(f.run().reason,'budget');assert.equal(f.counts().claims,0);}
});
test('explicit RAM reserve remains enforced',()=>{const f=ramFixture();assert.equal(f.run(200,950).reason,'budget');});
test('RAM purchase avoids duplicate upgrades after concurrent RAM changes',()=>{const f=ramFixture();f.ram(256);assert.equal(f.run().reason,'ram-changed');assert.equal(f.counts().claims,0);});
test('RAM purchase respects every supported pause spelling',()=>{
 for(const script of ['Tasks/ram-manager.js','/Tasks/ram-manager.js','ram-manager.js']){const f=ramFixture();f.files['remote-control/paused/'+script+'.txt']='true';assert.equal(f.run().reason,'paused');assert.equal(f.counts().claims,0);}
});
test('RAM purchase respects live maintenance and native home upgrade restrictions',()=>{
 const f=ramFixture();f.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:2,expiresAt:Date.now()+1000});assert.equal(f.run().reason,'maintenance');
 const g=ramFixture();g.ns.getResetInfo=()=>({bitNodeOptions:{restrictHomePCUpgrade:true}});assert.equal(g.run().reason,'restricted');
});
test('RAM purchase gracefully handles missing Source File/API and purchase failure',()=>{
 const f=ramFixture();f.ns.singularity.getUpgradeHomeRamCost=()=>{throw new Error('requires SF4');};assert.equal(f.run().reason,'api-unavailable');assert.equal(f.counts().claims,0);
 const g=ramFixture();g.ns.singularity.upgradeHomeRam=()=>false;assert.equal(g.run().reason,'purchase-failed');
});
test('RAM purchase rejects invalid quote, options, maximum RAM and denied shared allowance',()=>{
 for(const cost of [-1,NaN,Infinity]){const f=ramFixture();f.cost(cost);assert.equal(f.run().reason,'invalid-cost');assert.equal(f.counts().claims,0);}
 const f=ramFixture();assert.equal(f.run(NaN).reason,'invalid-budget');assert.equal(f.run(200,-1).reason,'invalid-budget');
 f.ram(2**30);assert.equal(f.run(200,null,2**30).reason,'maximum');
 const g=ramFixture();assert.equal(purchase(g.ns,200,null,128,()=>false,()=>true).reason,'shared-budget');assert.equal(g.counts().purchases,0);
 assert.equal(purchase(g.ns,200,null,128,()=>true,()=>false).reason,'restricted');
});

const train=vm.runInNewContext('('+trainBladeburnerEntrySource+')');
function training(){
 const files={'tasks/node-route-plan.json':{ownerPid:1,selected:'bladeburner',augReset:10,nodeReset:5,at:Date.now()},'tasks/activity-lock.json':{ownerPid:2,expiresAt:Date.now()+15000}};
 let work={type:'CRIME',crimeType:'Shoplift'};const commits=[];
 const stats={strength:1,defense:1,dexterity:90,agility:90};
 const ns={getResetInfo:()=>({lastAugReset:10,lastNodeReset:5}),read:f=>JSON.stringify(files[f]??null),isRunning:()=>true,ps:()=>[],getPlayer:()=>({skills:stats}),singularity:{
 getCurrentWork:()=>work,getCrimeChance:()=>1,getCrimeStats:name=>name==='Shoplift'?{strength_exp:0,defense_exp:0,dexterity_exp:1000,agility_exp:1000,time:2000}:{strength_exp:10,defense_exp:10,dexterity_exp:10,agility_exp:10,time:3000},
 commitCrime:name=>{commits.push(name);work={type:'CRIME',crimeType:name};return 3000;}}};
 return {ns,commits,stats};
}
test('entry training replaces its own Shoplift when strength and defense would remain stuck',()=>{
 const f=training(),p=train(f.ns,2,'Shoplift');assert.equal(p.state,'training');assert.notEqual(p.crime,'Shoplift');assert.equal(f.commits.length,1);
 assert.equal(train(f.ns,2,p.crime).crime,p.crime);assert.equal(f.commits.length,1);
});
test('entry training can use dexterity-only crime after strength and defense meet entry requirements',()=>{
 const f=training();f.stats.strength=100;f.stats.defense=100;assert.equal(train(f.ns,2,'Shoplift').crime,'Shoplift');assert.equal(f.commits.length,0);
});

const crimes={Homicide:{time:3000,karma:3,money:45000,difficulty:1,strength_success_weight:2,defense_success_weight:2,dexterity_success_weight:.5,agility_success_weight:.5}};
const weak=()=>({shock:99,sync:100,skills:{strength:1,defense:1,dexterity:1,agility:1,intelligence:34}});
const plan=extra=>sleeveStartupPlan({sleeves:Array.from({length:7},weak),crimes,money:1e9,casinoPending:false,gangAvailable:true,karma:-100,...extra});
test('weak shocked sleeves recover while one worker keeps gang karma progressing',()=>{
 const p=plan();assert.equal(p.workers.length,1);assert.equal(Object.values(p.assignments).filter(a=>a==='recovery').length,6);assert.ok(Number.isFinite(p.etaSeconds));
});
test('near-complete gang karma and casino seed take priority over weak-sleeve conditioning',()=>{
 assert.equal(plan({karma:-53999}).workers.length,7);
 const p=plan({money:1,casinoPending:true});assert.equal(p.stage,'casino-seed');assert.equal(p.workers.length,7);
});
test('productive healthy sleeve carries gang karma while weak shocked sleeves recover',()=>{
 const s={shock:0,sync:100,skills:{strength:1000,defense:1000,dexterity:1000,agility:1000}};
 const p=plan({sleeves:[s,weak()]});assert.ok(p.workers.includes(0));assert.equal(p.assignments[1],'recovery');
});
