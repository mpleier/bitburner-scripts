import {quoteBladeburnerSkillThroughputs} from '../bladeburner-rank-acceleration-policy.js';
import {planBladeburnerLevels as skillLevelPlanner,bladeburnerRankRate as skillRankRate,bladeburnerStaminaChance as skillChance,readBladeburnerMaintenance as skillMaintenance} from '../bladeburner-policy.js';
import {bladeburnerSkillContext} from '../bladeburner-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bladeburnerSkillGoal,spendBladeburnerSkills,nextBladeburnerProgressSkill,nextSkill} from '../bladeburner-policy.js';

test('next skill quote uses native costs and the same weighted selector without purchases',()=>{
 let mutations=0;
 const api={getSkillPoints:()=>7,getSkillLevel:()=>1,getSkillUpgradeCost:name=>name==='A'?10:20,upgradeSkill:()=>mutations++};
 const goal=bladeburnerSkillGoal(api,['A','B'],{A:3},nextSkill);
 assert.equal(goal.name,'B');assert.equal(goal.cost,20);assert.equal(goal.shortfall,13);assert.equal(mutations,0);
});

test('next skill quote respects caps, invalid quotes and progression-specific banking',()=>{
 const api={getSkillPoints:()=>5,getSkillLevel:()=>90,getSkillUpgradeCost:()=>100};
 assert.equal(bladeburnerSkillGoal(api,['Overclock'],{},nextSkill).state,'no-useful-upgrade');
 assert.equal(bladeburnerSkillGoal({...api,getSkillPoints:()=>NaN},[],{},nextSkill).state,'unavailable');
 assert.equal(bladeburnerSkillGoal(api,['A'],{},()=> 'Unknown').state,'unavailable');
 const context={blocked:true};
 const goal=bladeburnerSkillGoal({...api,getSkillLevel:()=>2},['A'],{},(_n,_l,_c,points,_w,c)=>{assert.equal(points,Infinity);assert.equal(c,context);return 'A';},()=>context);
 assert.equal(goal.shortfall,95);
});

test('native skill-goal helper serializes without external dependencies',()=>{
 const quote=Function('return ('+bladeburnerSkillGoal.toString()+')')();
 assert.equal(quote({getSkillPoints:()=>10,getSkillLevel:()=>1,getSkillUpgradeCost:()=>10},['A'],{},()=> 'A').shortfall,0);
});

test('executed production skill worker publishes its post-purchase goal without altering the purchase result',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const start=source.indexOf('async function spendSkillPoints('),end=source.indexOf('/** @param {NS} ns',start);
 let level=89,points=5,upgrades=0;const files={};
 const api={getRank:()=>1000,getSkillPoints:()=>points,getSkillLevel:()=>level,getSkillUpgradeCost:()=>10,getStamina:()=>[100,100],
  upgradeSkill:()=>{upgrades++;level++;points-=10;return true;}};
 const ns={pid:7,read:file=>files[file]||'',write:(file,value)=>files[file]=value,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),
  getPlayer:()=>({skills:{},mults:{bladeburner_max_stamina:1}}),bladeburner:api};
 const read=async(_ns,expression,_file,args)=>{const worker={...ns,args};return Function('ns','return '+expression)(worker);};
 const make=Function('quoteBladeburnerSkillThroughputs','planBladeburnerLevels','bladeburnerRankRate','bladeburnerStaminaChance','readBladeburnerMaintenance','bladeburnerSkillContext','getNsDataThroughFile','spendBladeburnerSkills','bladeburnerSkillGoal','nextBladeburnerProgressSkill','nextSkill','bbMutationGuard','resetInfo','skillNames','costAdjustments','remainingBlackOpsNames','blackOpsRanks','options','blackOpMetadata','bladeburnerDifficulty','log','cityPlanCache','levelPlanCache',source.slice(start,end)+'return spendSkillPoints;');
 const run=make(quoteBladeburnerSkillThroughputs,skillLevelPlanner,skillRankRate,skillChance,skillMaintenance,bladeburnerSkillContext,read,spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill,'true',{lastNodeReset:1},['Overclock'],{},[],{},{'success-threshold':.99},{},{},()=>{});
 await run(ns);let goal=JSON.parse(files['tasks/hash-skill-goal.json']);
 assert.equal(goal.name,'Overclock');assert.equal(goal.shortfall,5);assert.equal(goal.ownerPid,7);assert.equal(goal.augReset,2);assert.equal(upgrades,0);
 points=10;await run(ns);goal=JSON.parse(files['tasks/hash-skill-goal.json']);
 assert.equal(upgrades,1);assert.equal(goal.state,'no-useful-upgrade');assert.equal(goal.points,0);
});

test('optional goal quote failures do not prevent the controller reporting skill purchases',()=>{
 const quote=bladeburnerSkillGoal({getSkillPoints:()=>{throw Error('API unavailable');}},[],{},()=>null);
 assert.equal(quote.state,'unavailable');assert.match(quote.reason,/API unavailable/);
});
