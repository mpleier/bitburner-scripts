import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveStartupPlan} from '../sleeve-policy.js';
import {sleeveKarmaTrainingPlan} from '../sleeve-karma-training-policy.js';
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const sleeve=()=>({shock:90,sync:100,skills:{...Object.fromEntries(keys.map(k=>[k,1])),intelligence:0},exp:Object.fromEntries(keys.map(k=>[k,0])),mults:{}});
const crimes={Homicide:{difficulty:1,strength_success_weight:1,karma:3,time:3000,strength_exp:100,defense_exp:100}};
const opening={sleeves:[sleeve(),sleeve()],crimes,casinoPending:false,gangAvailable:true,karma:-53990};
test('player karma can finish the milestone while every shocked sleeve recovers',()=>{
 const alone=sleeveStartupPlan({...opening,recoveryRates:[.001,.001]});
 assert.equal(alone.workers.length,2);
 const player=sleeveStartupPlan({...opening,recoveryRates:[.001,.001],externalKarmaPerSecond:1});
 assert.deepEqual(player.workers,[]);assert.equal(player.etaSeconds,10);
 assert.deepEqual(Object.values(player.assignments),['recovery','recovery']);
});
test('measured recovery speed changes conditioning decisions and invalid measurements fall back safely',()=>{
 const slow=sleeveStartupPlan({...opening,recoveryRates:[.001,.001]});
 const fast=sleeveStartupPlan({...opening,recoveryRates:[1,1]});
 assert.equal(slow.conditioning.length,0);assert.equal(fast.conditioning.length,1);
 assert.deepEqual(sleeveStartupPlan({...opening,recoveryRates:[NaN,-1]}),sleeveStartupPlan(opening));
});
test('a faster recovery forecast returns an executable recovery recommendation',()=>{
 const plan=sleeveKarmaTrainingPlan({sleeves:[sleeve()],crimes,workers:[0],karma:-53000,recoveryRates:[1]});
 assert.equal(plan.best.action,'recovery');assert.equal(plan.best.index,0);
 assert.ok(plan.best.etaSeconds<plan.best.baselineSeconds*.9);assert.deepEqual(plan.choices,{});
});
test('ongoing crimes finish before recovery and player production enters training forecasts',()=>{
 const input={sleeves:[sleeve(),sleeve()],crimes,workers:[0,1],karma:-53000,recoveryRates:[1,1],externalKarmaPerSecond:2};
 const held=sleeveKarmaTrainingPlan({...input,tasks:[{type:'CRIME',crimeType:'Homicide',cyclesWorked:1,cyclesNeeded:15},{type:'CRIME',crimeType:'Homicide',cyclesWorked:1,cyclesNeeded:15}]});
 assert.equal(held.best,null);assert.deepEqual(held.choices,{0:'Homicide',1:'Homicide'});
 const plan=sleeveKarmaTrainingPlan(input);assert.ok(plan.otherKarmaPerSecond[0]>=2);
});
