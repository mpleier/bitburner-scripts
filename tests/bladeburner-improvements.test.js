import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readBladeburnerMaintenance,bladeburnerStaminaChance,bladeburnerRankRate,planBladeburnerLevels,bladeburnerPlanCacheValid,bladeburnerActionCompleted,startBladeburnerPlannedAction} from '../bladeburner-policy.js';
import {sleeveBladeburnerTasks} from '../sleeve-policy.js';
import {bladeburnerDifficulty} from '../bladeburner-action-data.js';

test('sustained rank includes passive regeneration and recovery duty',()=>{
 const m={time:1000,gain:10,loss:0,staminaCost:2,staminaRegen:1,hrcRegen:1};
 assert.equal(bladeburnerRankRate([1,1],m),10/1.5);
 assert.equal(bladeburnerRankRate([1,1],{...m,staminaCost:1}),10);
 assert.equal(bladeburnerRankRate([1,1],{...m,staminaRegen:0,hrcRegen:0}),0);
 assert.equal(bladeburnerRankRate([1,1],{...m,time:2000,nativeTime:1000}),10/2);
 assert.equal(bladeburnerRankRate([1,1],{time:1000,gain:10,loss:0}),10);
});

test('recovery can favor a lower action level and planner restores the live level',()=>{
 let level=1;
 const api={getActionCurrentLevel:()=>level,getActionMaxLevel:()=>2,getActionAutolevel:()=>false,
  setActionLevel:(_t,_n,n)=>{level=n;},getActionEstimatedSuccessChance:()=>[1,1],getActionTime:()=>1000,
  getActionRankGain:()=>level,getActionRankLoss:()=>0};
 assert.equal(planBladeburnerLevels(api,[['X','Contracts']],.99,bladeburnerRankRate,()=>true).X.level,2);
 const p=planBladeburnerLevels(api,[['X','Contracts']],.99,bladeburnerRankRate,()=>true,{actions:{X:{base:125,factor:100}},regen:1,hrc:1}).X;
 assert.equal(p.level,1);assert.ok(p.metrics.staminaCost>0);assert.equal(level,1);
});

test('cache has bounded age and invalidates on context changes or clock rollback',()=>{
 const cache={at:100,key:'a'};
 assert.equal(bladeburnerPlanCacheValid(cache,'a',101),true);
 for(const [key,at] of [['b',101],['a',99],['a',10100],['a',NaN]])assert.equal(bladeburnerPlanCacheValid(cache,key,at),false);
 const worker=Function('return ('+bladeburnerPlanCacheValid.toString()+')')();assert.equal(worker(cache,'a',101),true);
});

test('contracts and general actions detect accelerated completion without a count decrease',()=>{
 for(const type of ['Contracts','Operations','General']){
  const previous={name:'X',type,progress:900,successes:type==='General'?null:4};
  assert.equal(bladeburnerActionCompleted(previous,{...previous,progress:100}),true);
  assert.equal(bladeburnerActionCompleted(previous,{...previous,progress:950,successes:5}),type!=='General');
  assert.equal(bladeburnerActionCompleted(previous,{...previous,progress:950}),false);
  assert.equal(bladeburnerActionCompleted(previous,{...previous,name:'Y',progress:0}),false);
 }
 assert.equal(bladeburnerActionCompleted(null,{}),false);
});

const sleeves=Array.from({length:4},()=>({shock:0,sync:100}));
const plan={chaos:0,threshold:.99,rankReady:true,chance:[.5,.6],counts:{Assassination:100}};
test('healthy spare sleeves target Black Op stats while respecting support and reputation',()=>{
 assert.deepEqual(sleeveBladeburnerTasks(sleeves,[null,{type:'FACTION'}],plan,[0]),{2:'combat-xp',3:'combat-xp'});
 assert.deepEqual(sleeveBladeburnerTasks(sleeves,[],plan,[],false),{0:'Infiltrate Synthoids',1:'Infiltrate Synthoids',2:'Infiltrate Synthoids',3:'Infiltrate Synthoids'});
 assert.deepEqual(sleeveBladeburnerTasks([{shock:1,sync:100},{shock:0,sync:99}],[],plan),{});
});
test('sleeves allocate bounded chaos and analysis workers and avoid unnecessary analysis',()=>{
 const r=sleeveBladeburnerTasks(sleeves,[],{...plan,chaos:80,chance:[.9,1]});
 assert.equal(Object.values(r).filter(x=>x==='Diplomacy').length,2);
 assert.equal(Object.values(r).filter(x=>x==='Field Analysis').length,1);
 assert.equal(Object.values(r).filter(x=>x==='Infiltrate Synthoids').length,1);
 assert.equal(Object.values(sleeveBladeburnerTasks(sleeves,[],{...plan,rankReady:false})).every(x=>x==='Infiltrate Synthoids'),true);
 const low=sleeveBladeburnerTasks(sleeves,[],{...plan,counts:{Assassination:1}});
 assert.equal(Object.values(low).filter(x=>x==='Infiltrate Synthoids').length,1);
 assert.deepEqual(sleeveBladeburnerTasks(sleeves,[],null),{});
});
test('recovery-aware worker serialization and native start safety remain independent of cache',()=>{
 const fn=Function('return ('+bladeburnerRankRate.toString()+')')();
 assert.equal(fn([1,1],{time:1000,gain:10,loss:0,staminaCost:2,staminaRegen:1,hrcRegen:1}),10/1.5);
 let level=1,auto=true,started=false;
 const api={getActionMaxLevel:()=>2,getActionCurrentLevel:()=>level,getActionAutolevel:()=>auto,setActionLevel:(_t,_n,n)=>level=n,setActionAutolevel:(_t,_n,v)=>auto=v,getActionEstimatedSuccessChance:()=>[.5,.6],startAction:()=>{started=true;return true;}};
 assert.equal(startBladeburnerPlannedAction(api,'Contracts','X',{level:2},.99,0,0,()=>true),false);
 assert.equal(started,false);assert.equal(level,1);assert.equal(auto,true);
 assert.equal(Object.keys(bladeburnerDifficulty).length,9);
});
test('runtime uses fresh guarded evidence and invalidates planning on relevant native state',async()=>{
 const bb=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 for(const token of ['bladeburnerPlanCacheValid(levelPlanCache','planning.population','planning.skills','teamSleeves.supporting','getActionSuccesses(a.type,a.name)','bladeburnerActionCompleted(actionProgress,progress)'])assert.ok(bb.includes(token),token);
 const sleeve=await readFile(new URL('../sleeve.js',import.meta.url),'utf8');
 for(const token of ['sleeveBladeburnerTasks(sleeveInfo','saved.augReset===reset.lastAugReset','Date.now()-saved.at<30000','disableSleeveExpAndAugmentation','blackOpMetadata[bladeburnerDevelopmentPlan?.target]'])assert.ok(sleeve.includes(token),token);
});

test('actual planning context obeys native named skill API',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const literal=source.match(/const planning=await getNsDataThroughFile\(ns,(`[^`]+`)/)[1];
 const code=Function('readBladeburnerMaintenance','bladeburnerStaminaChance','return '+literal)(readBladeburnerMaintenance,bladeburnerStaminaChance);
 const calls=[];
 const b={getStamina:()=>[5,10],getSkillNames:()=>['Reaper',"Cyber's Edge"],getSkillLevel:name=>{assert.equal(typeof name,'string');calls.push(name);return 2;},getCity:()=> 'A',getCityEstimatedPopulation:()=>1e9,getTeamSize:()=>0,getActionCurrentLevel:()=>1,getActionMaxLevel:()=>2,getActionAutolevel:()=>false};
 const ns={bladeburner:b,getPlayer:()=>({skills:{agility:100},mults:{bladeburner_stamina_gain:1}}),args:[JSON.stringify([['Tracking','Contracts']]),50,.99,JSON.stringify(bladeburnerDifficulty)]};
 const context=Function('ns','return '+code)(ns);
 assert.deepEqual(calls,['Reaper',"Cyber's Edge"]);assert.equal(context.skills.Reaper,2);assert.equal(context.population,1e9);assert.equal(context.actions[0][2],1);
});
