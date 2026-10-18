import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automationReloadFits} from '../runtime-policy.js';
import {bladeburnerTrainingProgress} from '../bladeburner-policy.js';
import {sleeveRecoveryObservation,sleeveCombatWorkers} from '../sleeve-development-policy.js';
import {planMarginalGangEquipment} from '../gang-policy.js';

test('reload uses actual old RAM when updated code grows or shrinks',()=>{
 assert.equal(automationReloadFits({free:10,newRam:30,oldRam:10,reserve:5}),false);
 assert.equal(automationReloadFits({free:10,newRam:10,oldRam:30,reserve:5}),true);
 assert.equal(automationReloadFits({free:10,newRam:10,oldRam:30,reserve:5,stopped:true}),false);
 assert.equal(automationReloadFits({free:70,newRam:20,oldRam:5,threads:4,reserve:10}),true);
});
test('missing native RAM and invalid requirements keep the old controller alive',()=>{
 for(const patch of [{oldRam:NaN},{newRam:0},{threads:0},{threads:1.5},{free:-1},{reserve:Infinity}])assert.equal(automationReloadFits({free:1,newRam:20,oldRam:10,...patch}),false);
 assert.equal(automationReloadFits({free:1,newRam:20}),false);
});
const reset={lastNodeReset:1,lastAugReset:2};
test('training counts one observed interval, never speculative selected actions',()=>{
 let saved={at:1000,pid:7,nodeReset:1,augReset:2,training:true,trainingTotal:2};
 assert.deepEqual(bladeburnerTrainingProgress(saved,reset,31000,7,true),{trainingTotal:3,elapsedMs:30000});
 assert.equal(bladeburnerTrainingProgress(saved,reset,31000,7,false).trainingTotal,2);
 assert.equal(bladeburnerTrainingProgress({...saved,training:false},reset,31000,7,true).trainingTotal,2);
});
test('training persists totals across reloads but never charges a reload gap or another reset',()=>{
 const saved={at:1000,pid:7,nodeReset:1,augReset:2,training:true,trainingTotal:12};
 assert.equal(bladeburnerTrainingProgress(saved,reset,31000,8,true).trainingTotal,12);
 assert.equal(bladeburnerTrainingProgress(saved,{...reset,lastAugReset:3},31000,7,true).trainingTotal,0);
 assert.equal(bladeburnerTrainingProgress({...saved,at:40000},reset,31000,7,true).trainingTotal,0);
 assert.equal(bladeburnerTrainingProgress(null,reset,31000,7,true).trainingTotal,0);
});
test('legacy fallback and development share one training counter',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.equal(source.includes('timesTrained +='),false);assert.equal(source.includes('timesTrained+='),false);
 assert.ok(source.includes('trainingTotal:timesTrained'));
});
const sleeve=(shock=3)=>({shock,sync:100,memory:100,skills:{strength:100,defense:100,dexterity:100,agility:100,intelligence:0},mults:{crime_success:1}});
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:10}};
test('recovery observations require matching owner and resets and consecutive recovery tasks',()=>{
 const previous={at:1000,pid:7,nodeReset:1,augReset:2,sleeves:[{shock:3,recovering:true,rate:null}]};
 const observed=sleeveRecoveryObservation(previous,[sleeve(2.9)],[{type:'RECOVERY'}],11000,reset,7);
 assert.ok(Math.abs(observed.sleeves[0].rate-.01)<1e-12);
 for(const patch of [{pid:8},{augReset:99},{at:12000},{at:-100000}])assert.equal(sleeveRecoveryObservation({...previous,...patch},[sleeve(2.9)],[{type:'RECOVERY'}],11000,reset,7).sleeves[0].rate,null);
 assert.equal(sleeveRecoveryObservation(previous,[sleeve(2.9)],[{type:'CRIME'}],11000,reset,7).sleeves[0].rate,null);
});
test('combat workers compare measured recovery and preserve nearest augmentation access',()=>{
 const sleeves=[sleeve(1),sleeve(3),sleeve(4),sleeve(70)],observation={sleeves:sleeves.map(()=>({rate:.001}))};
 const workers=sleeveCombatWorkers(sleeves,crimes,[],1,null,observation);
 assert.deepEqual(workers.map(w=>w.index),[1,2]);assert.ok(workers.every(w=>w.immediateOutput>w.recoveryFirstOutput));
 assert.equal(sleeveCombatWorkers(sleeves,crimes).length,1);
});
test('finishing quick recovery wins over borrowing more sleeves',()=>{
 const sleeves=[sleeve(.01),sleeve(.02)];
 assert.deepEqual(sleeveCombatWorkers(sleeves,crimes,[],1,null,{sleeves:[{rate:.01},{rate:.01}]}),[]);
 assert.deepEqual(sleeveCombatWorkers([sleeve(100)],crimes),[]);
});
const member={name:'A',str_mult:1,str_asc_mult:1,str_exp:100000,upgrades:[],augmentations:[]};
const equipment=[{name:'one',type:'Weapon',cost:10,stats:{str:2}},{name:'two',type:'Weapon',cost:10,stats:{str:2}}];
const budgets={available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:0};
test('equipment selection revalues remaining choices on the upgraded shadow member',()=>{
 const seen=[];
 const result=planMarginalGangEquipment({members:{A:member},equipment,budgets,evaluate:m=>{seen.push(m.str_mult);return {moneyGain:m.str_mult===1?1:0,objectiveGain:0,respectGain:0};}});
 assert.equal(result.orders.length,1);assert.ok(seen.includes(2));assert.equal(member.str_mult,1);assert.deepEqual(member.upgrades,[]);
});
test('marginal gang batches enforce category, shared and per-pass limits',()=>{
 const evaluate=()=>({moneyGain:1,objectiveGain:0,respectGain:0});
 assert.equal(planMarginalGangEquipment({members:{A:member},equipment,budgets:{...budgets,available:10},evaluate}).orders.length,1);
 assert.equal(planMarginalGangEquipment({members:{A:member},equipment,budgets:{...budgets,equipmentLimit:0},evaluate}).orders.length,0);
 assert.equal(planMarginalGangEquipment({members:{A:member},equipment,budgets,evaluate,maxPurchases:1}).orders.length,1);
});
test('respect exceptions share one budget across marginal iterations',()=>{
 const result=planMarginalGangEquipment({members:{A:member},equipment,budgets:{...budgets,bootstrapBudget:10},recruitment:{allowProgression:true},evaluate:()=>({moneyGain:0,objectiveGain:1,respectGain:0})});
 assert.equal(result.orders.length,1);assert.equal(result.orders[0].reason,'progression');
});
test('shadow member never receives the same upgrade twice',()=>{
 const result=planMarginalGangEquipment({members:{A:member},equipment,budgets,evaluate:()=>({moneyGain:1})});
 assert.equal(result.orders.length,2);assert.equal(new Set(result.orders.map(o=>o.equipmentName)).size,2);
});

test('sleeve recovery persists after assignment and never references local state in the error handler',()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 const write=source.indexOf("await ns.write('tasks/sleeve-recovery-observation.json'");
 assert.ok(write>source.indexOf('const currentTasks ='));
 assert.equal(source.indexOf("await ns.write('tasks/sleeve-recovery-observation.json'",write+1),-1);
});
test('recovery speed expires when no longer calibrated on active recovery',()=>{
 const previous={at:399000,pid:7,nodeReset:1,augReset:2,sleeves:[{shock:3,recovering:false,rate:.01,measuredAt:1000}]};
 assert.equal(sleeveRecoveryObservation(previous,[sleeve(2.9)],[{type:'CRIME'}],400000,reset,7).sleeves[0].rate,null);
 assert.equal(sleeveRecoveryObservation({...previous,sleeves:[{...previous.sleeves[0],measuredAt:390000}]},[sleeve(2.9)],[{type:'CRIME'}],400000,reset,7).sleeves[0].rate,.01);
});

test('ROI changes and recovery-slot rotation preserve invested crime XP until completion',()=>{
 const sleeves=[sleeve(.01),sleeve(.02)],observation={sleeves:[{rate:.01},{rate:.01}]};
 const tasks=[{type:'CRIME',crimeType:'Mug',cyclesWorked:19,cyclesNeeded:20},null];
 let workers=sleeveCombatWorkers(sleeves,crimes,tasks,1,null,observation);
 assert.equal(workers.length,1);assert.equal(workers[0].index,0);assert.equal(workers[0].finishingBeforeRecovery,true);
 tasks[0].cyclesWorked=0;assert.deepEqual(sleeveCombatWorkers(sleeves,crimes,tasks,1,null,observation),[]);
});
