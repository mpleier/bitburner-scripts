import {scoreBladeburnerCityFallback} from '../bladeburner-city-fallback-policy.js';
import {bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining} from '../combat-growth-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readBladeburnerMaintenance,probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,bladeburnerRankRate,bladeburnerStaminaChance,nextBladeburnerProgressSkill,nextSkill,spendBladeburnerSkills,bladeburnerSkillGoal} from '../bladeburner-policy.js';
import {bladeburnerDifficulty} from '../bladeburner-action-data.js';
const data={A:{base:125,factor:1}},recovery={stamina:[100,100],regen:1,hrc:1};
function fixture(){
 const state={city:'Home',level:1,auto:true,probes:0};
 const api={getCity:()=>state.city,switchCity:city=>{state.city=city;return true;},getActionCountRemaining:()=>1,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>3,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,level)=>{state.level=level;},
  getActionEstimatedSuccessChance:()=>{state.probes++;return state.city==='Home'&&state.level>1?[.1,.1]:[1,1];},getActionTime:()=>1000,getActionRankGain:()=>10*state.level,getActionRankLoss:()=>0};
 return {api,state};
}
const probe=(api,allowed=()=>true,planner=planBladeburnerLevels)=>probeBladeburnerCities(api,['Home','Other'],[['A','Contracts']],.99,allowed,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery,planner);

test('joint planning finds the city whose higher safe level beats a current-level tie',()=>{
 const {api,state}=fixture();
 assert.equal(chooseBladeburnerCity(probe(api,()=>true,null),'Home').city,'Home');
 const rows=probe(api),choice=chooseBladeburnerCity(rows,'Home');
 assert.equal(choice.city,'Other');assert.equal(choice.level,3);
 assert.ok(choice.score>rows.find(r=>r.city==='Home').score);
 assert.equal(state.city,'Home');assert.equal(state.level,1);assert.equal(state.auto,true);
});
test('joint planning restores both city and level on native errors',()=>{
 const {api,state}=fixture();api.getActionRankGain=()=>{if(state.city==='Other'&&state.level>1)throw Error('native quote failed');return 10;};
 assert.throws(()=>probe(api),/native quote failed/);
 assert.equal(state.city,'Home');assert.equal(state.level,1);assert.equal(state.auto,true);
});
test('cancellation during a hypothetical level restores all settings and rejects the plan',()=>{
 const {api,state}=fixture();let cancelled=false;
 const original=api.getActionEstimatedSuccessChance;
 api.getActionEstimatedSuccessChance=()=>{if(state.city==='Other'&&state.level>1)cancelled=true;return original();};
 assert.equal(probe(api,()=>!cancelled),null);
 assert.equal(state.city,'Home');assert.equal(state.level,1);assert.equal(state.auto,true);
});
test('level probe budgets bound work and retain only actually measured safe candidates',()=>{
 const {api,state}=fixture();api.getActionMaxLevel=()=>Number.MAX_SAFE_INTEGER;
 api.getActionEstimatedSuccessChance=()=>{state.probes++;return [1,1];};
 const result=planBladeburnerLevels(api,[['A','Contracts']],.99,bladeburnerRankRate,()=>true,{...recovery,actions:data},bladeburnerStaminaChance,12);
 assert.ok(state.probes<=12);assert.ok(result.A);assert.ok(result.A.probes<=12);
 assert.equal(result.A.chance[0],1);assert.equal(state.level,1);
 for(const limit of [0,-1,NaN,129,1.5])assert.deepEqual(planBladeburnerLevels(api,[['A','Contracts']],.99,bladeburnerRankRate,()=>true,null,null,limit),{});
});
test('source-verified action flags cover every repeatable action',()=>{
 const expected={Tracking:[true,false],'Bounty Hunter':[false,true],Retirement:[false,true],Investigation:[true,false],'Undercover Operation':[true,false],'Sting Operation':[true,false],Raid:[false,true],'Stealth Retirement Operation':[true,true],Assassination:[true,true]};
 assert.deepEqual(Object.keys(bladeburnerDifficulty).sort(),Object.keys(expected).sort());
 for(const [name,flags]of Object.entries(expected))assert.deepEqual([bladeburnerDifficulty[name].isStealth,bladeburnerDifficulty[name].isKill],flags,name);
});
const names=['Cloak','Short-Circuit','Tracer','Digital Observer'];
const levels=Object.fromEntries(names.map(n=>[n,0])),costs=Object.fromEntries(names.map(n=>[n,10]));
const context={skills:{agility:1000,dexterity:1000},mults:{bladeburner_stamina_gain:1},maxStaminaMultiplier:1,threshold:.99,stamina:[10000,10000]};
const action={type:'Operations',difficulty:1000,gain:100,loss:1,chance:.95};
const choose=(a,ls=levels,cs=costs)=>nextBladeburnerProgressSkill(names,ls,cs,100,{}, {...context,throughputs:[a]},nextSkill);
test('Cloak and Short-Circuit unlock only their native flagged actions',()=>{
 assert.equal(choose({...action,isStealth:true}),'Cloak');
 assert.equal(choose({...action,isKill:true}),'Short-Circuit');
 assert.equal(choose({...action,isKill:true,type:'Contracts'}),'Short-Circuit');
 assert.equal(choose(action),null);
 assert.equal(choose({...action,isStealth:'true',isKill:1}),null);
});
test('flag bonuses respect diminishing gains, costs, caps and safety thresholds',()=>{
 assert.equal(choose({...action,isStealth:true,isKill:true},{...levels,Cloak:100}),'Short-Circuit');
 assert.equal(choose({...action,isStealth:true,isKill:true},levels,{...costs,Cloak:101}),'Short-Circuit');
 assert.equal(choose({...action,isStealth:true,chance:.1}),null);
 assert.equal(choose({...action,isStealth:true,isKill:true,chance:1}),null);
});
test('production skill worker passes action flags through to actual purchases',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const start=source.indexOf('async function spendSkillPoints('),end=source.indexOf('/** @param {NS} ns',start);
 let points=10;const bought=[],files={},ls={...levels};
 const api={getRank:()=>0,getSkillPoints:()=>points,getSkillLevel:name=>ls[name],getSkillUpgradeCost:()=>10,getStamina:()=>[10000,10000],getActionCountRemaining:()=>1,
  getCurrentAction:()=>{throw Error('explicit action list should be used');},getActionCurrentLevel:()=>1,getActionRankGain:()=>100,getActionRankLoss:()=>0,getActionEstimatedSuccessChance:()=>ls['Short-Circuit']?[1,1]:[.95,.95],upgradeSkill:name=>{bought.push(name);ls[name]++;points-=10;return true;}};
 const ns={pid:7,read:()=>'',write:(file,value)=>files[file]=value,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),getPlayer:()=>({skills:context.skills,mults:{...context.mults,bladeburner_max_stamina:1}}),bladeburner:api};
 const read=async(_ns,expression,_file,args)=>Function('ns','return '+expression)({...ns,args});
 const make=Function('getNsDataThroughFile','spendBladeburnerSkills','bladeburnerSkillGoal','nextBladeburnerProgressSkill','nextSkill','bbMutationGuard','resetInfo','skillNames','costAdjustments','remainingBlackOpsNames','blackOpsRanks','options','blackOpMetadata','bladeburnerDifficulty','log','cityPlanCache','levelPlanCache',source.slice(start,end)+'return spendSkillPoints;');
 const run=make(read,spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill,'true',{lastNodeReset:1},names,{},[],{},{'success-threshold':.99},{},bladeburnerDifficulty,()=>{});
 await run(ns,[['Retirement','Contracts']]);assert.deepEqual(bought,['Short-Circuit']);assert.equal(points,0);
 assert.equal(JSON.parse(files['tasks/hash-skill-goal.json']).state,'no-useful-upgrade');
});
test('production city worker executes the joint planner and honors the disable option',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const literal=source.match(/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/)[1];
 const expression=Function('probeBladeburnerCities','bladeburnerRankRate','bladeburnerStaminaChance','planBladeburnerLevels','readBladeburnerMaintenance','bbMutationGuard','combatXpValue','bladeburnerGrowthChoice','bladeburnerCityGrowthScore','quoteBladeburnerCityTraining','bladeburnerStaminaGrowthSource','scoreBladeburnerCityFallback','return '+literal)(probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,bladeburnerStaminaGrowthSource,scoreBladeburnerCityFallback);
 for(const disabled of [false,true]){
  const {api,state}=fixture();api.getStamina=()=>[100,100];api.getSkillLevel=()=>0;
  const ns={bladeburner:api,isRunning:()=>true,getPlayer:()=>({skills:{agility:1000},mults:{bladeburner_stamina_gain:1}}),args:[JSON.stringify(['Home','Other']),JSON.stringify([['A','Contracts']]),.99,7,JSON.stringify(data),disabled]};
  const rows=Function('ns','return '+expression)(ns),choice=chooseBladeburnerCity(rows,'Home');
  assert.equal(choice.city,disabled?'Home':'Other');assert.equal(choice.level,disabled?1:3);
  assert.equal(state.city,'Home');assert.equal(state.level,1);assert.equal(state.auto,true);
 }
});
