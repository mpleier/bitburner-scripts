import {quoteBladeburnerSkillThroughputs} from '../bladeburner-rank-acceleration-policy.js';
import {planBladeburnerLevels as skillLevelPlanner,bladeburnerRankRate as skillRankRate,bladeburnerStaminaChance as skillChance,readBladeburnerMaintenance as skillMaintenance} from '../bladeburner-policy.js';
import {bladeburnerSkillContext} from '../bladeburner-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBladeburnerProgressSkill,nextSkill,bladeburnerRecoveryTarget,recoveryRequired,spendBladeburnerSkills,bladeburnerSkillGoal} from '../bladeburner-policy.js';
import {readFile} from 'node:fs/promises';
const names=['Overclock','Reaper','Evasive System',"Cyber's Edge","Blade's Intuition",'Digital Observer','Tracer','Hands of Midas'];
const levels=Object.fromEntries(names.map(n=>[n,n==='Overclock'?80:10]));
const costs=Object.fromEntries(names.map(n=>[n,10]));
const context={skills:{agility:1000,dexterity:1000},mults:{bladeburner_stamina_gain:1},maxStaminaMultiplier:1,threshold:.99,stamina:[10000,10000],throughput:{type:'Operations',difficulty:100000,gain:100,loss:1,chance:1}};
const choose=(patch={},ls=levels,cs=costs,points=100)=>nextBladeburnerProgressSkill(names,ls,cs,points,{}, {...context,...patch},nextSkill);

test('rank grinding buys measured time savings rather than unrelated cheap income',()=>{
 assert.equal(choose({},levels,{...costs,'Hands of Midas':.001}),'Overclock');
});
test('native one-second floor and capped success do not waste points on Overclock',()=>{
 assert.equal(choose({throughput:{...context.throughput,difficulty:1}}, {...levels,Overclock:90}, {...costs,Reaper:1e9,'Evasive System':1e9,"Cyber's Edge":1e9}),null);
});
test('throughput skill comparison respects affordability, caps and missing data',()=>{
 assert.notEqual(choose({},levels,{...costs,Overclock:101}),'Overclock');
 assert.notEqual(choose({}, {...levels,Overclock:90}),'Overclock');
 assert.equal(choose({throughput:null},levels,{...costs,'Hands of Midas':.001}),'Hands of Midas');
});
test('contract success skill competes only for contracts and capped chances add no benefit',()=>{
 const cs={...costs,Tracer:.001,'Digital Observer':.001};
 assert.notEqual(choose({},levels,cs),'Tracer');
 assert.notEqual(choose({},levels,cs),'Digital Observer');
 assert.equal(choose({throughput:{...context.throughput,type:'Contracts',chance:.99}},levels,cs),'Tracer');
});
test('next Black Op preparation starts near the rank gate, preserving far-away grinding',()=>{
 const c={target:'A',rank:900,requiredRank:1000,chance:[.7,.8],threshold:.99};
 const ns=['Hands of Midas','Digital Observer'],ls={'Hands of Midas':0,'Digital Observer':0},cs={'Hands of Midas':1,'Digital Observer':10};
 assert.equal(nextBladeburnerProgressSkill(ns,ls,cs,10,{},c,nextSkill),'Digital Observer');
 assert.equal(nextBladeburnerProgressSkill(ns,ls,cs,10,{}, {...c,rank:899},nextSkill),'Hands of Midas');
 assert.equal(nextBladeburnerProgressSkill(ns,ls,cs,1,{},c,nextSkill),null);
});
test('full-stamina capacity can be developed before the Black Op rank gate',()=>{
 const c={target:'A',rank:900,requiredRank:1000,chance:[1,1],threshold:.99,metadata:{baseDifficulty:2000},stamina:[1,1]};
 assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge"],{"Cyber's Edge":0},{"Cyber's Edge":1},1,{},c,nextSkill),"Cyber's Edge");
});
test('stamina target covers the next action and a bounded repeat buffer',()=>{
 const a={chance:1,cost:30,time:1000,gain:100,loss:1};
 assert.equal(bladeburnerRecoveryTarget([45,100],[a]),.9);
 assert.equal(bladeburnerRecoveryTarget([45,100],[{...a,cost:1}]),.6);
 assert.equal(bladeburnerRecoveryTarget([45,100],[{...a,cost:80}]),.6);
 assert.equal(recoveryRequired(1,.7,{health:false,stamina:true},.5,bladeburnerRecoveryTarget([70,100],[a])).stamina,true);
});
test('recovery chooses useful rank work and retains option floors and fallback',()=>{
 const slow={chance:1,cost:1,time:10000,gain:1,loss:1},fast={chance:1,cost:30,time:1000,gain:100,loss:1};
 assert.equal(bladeburnerRecoveryTarget([100,100],[slow,fast]),.9);
 assert.equal(bladeburnerRecoveryTarget([100,100],[slow],.99,.95),.95);
 assert.equal(bladeburnerRecoveryTarget([0,100],[fast]),.6);
 assert.equal(bladeburnerRecoveryTarget([1,0],[fast]),.6);
 assert.equal(bladeburnerRecoveryTarget([100,100],[{...fast,chance:NaN}]),.6);
});
test('speed selector and recovery helper remain self-contained native worker functions',()=>{
 const select=Function('return ('+nextBladeburnerProgressSkill.toString()+')')();
 assert.equal(select(names,levels,costs,100,{},context,nextSkill),'Overclock');
 const recover=Function('return ('+bladeburnerRecoveryTarget.toString()+')')();
 assert.equal(recover([100,100],[]),.6);
});
test('controller wires native difficulty, raw chances and recovery target into production',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(source,/JSON.stringify\(blackOpMetadata\),JSON.stringify\(bladeburnerDifficulty\)/);
 assert.match(source,/nativeActionChances=\{\.\.\.contractChances/);
 assert.match(source,/options\['low-stamina-pct'\],recoveryTarget/);
 assert.match(source,/let throughput=null,throughputs=\[\];try/);
});

test('executed production worker supplies throughput context and publishes its post-purchase quote',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const start=source.indexOf('async function spendSkillPoints('),end=source.indexOf('/** @param {NS} ns',start);
 let level=80,points=10;const files={};
 const api={getRank:()=>0,getSkillPoints:()=>points,getSkillLevel:()=>level,getSkillUpgradeCost:()=>10,getStamina:()=>[10000,10000],
  getCurrentAction:()=>({type:'Operations',name:'Test'}),getActionCurrentLevel:()=>1,getActionRankGain:()=>100,getActionRankLoss:()=>1,getActionEstimatedSuccessChance:()=>[1,1],
  upgradeSkill:()=>{level++;points-=10;return true;}};
 const ns={pid:7,read:file=>files[file]||'',write:(file,value)=>files[file]=value,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),
  getPlayer:()=>({skills:context.skills,mults:{...context.mults,bladeburner_max_stamina:1}}),bladeburner:api};
 const read=async(_ns,expression,_file,args)=>Function('ns','return '+expression)({...ns,args});
 const make=Function('quoteBladeburnerSkillThroughputs','planBladeburnerLevels','bladeburnerRankRate','bladeburnerStaminaChance','readBladeburnerMaintenance','bladeburnerSkillContext','getNsDataThroughFile','spendBladeburnerSkills','bladeburnerSkillGoal','nextBladeburnerProgressSkill','nextSkill','bbMutationGuard','resetInfo','skillNames','costAdjustments','remainingBlackOpsNames','blackOpsRanks','options','blackOpMetadata','bladeburnerDifficulty','log','cityPlanCache','levelPlanCache',source.slice(start,end)+'return spendSkillPoints;');
 const run=make(quoteBladeburnerSkillThroughputs,skillLevelPlanner,skillRankRate,skillChance,skillMaintenance,bladeburnerSkillContext,read,spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill,'true',{lastNodeReset:1},['Overclock'],{},[],{},{'success-threshold':.99},{},{Test:{base:100000,factor:1}},()=>{});
 await run(ns);
 assert.equal(level,81);assert.equal(points,0);
 const goal=JSON.parse(files['tasks/hash-skill-goal.json']);
 assert.equal(goal.name,'Overclock');assert.equal(goal.shortfall,10);
});
