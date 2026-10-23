import {scoreBladeburnerCityFallback} from '../bladeburner-city-fallback-policy.js';
import {bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining} from '../combat-growth-policy.js';
import {probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,bladeburnerRankRate,bladeburnerStaminaChance,readBladeburnerMaintenance} from '../bladeburner-policy.js';
const context={metadata:{weights:{strength:1},decays:{strength:.8}},player:{skills:{strength:100,agility:100},exp:{strength:1000},mults:{}},inferLevels:true};
const data={X:{base:125,factor:1},Y:{base:125,factor:1}},weights={X:{agility:1},Y:{strength:1}};
const recovery={stamina:[1000,1000],regen:1,hrc:1};
const factory=name=>(chance,m)=>bladeburnerCityGrowthScore(chance,m,data[name],weights[name],context,0,bladeburnerRankRate,bladeburnerGrowthChoice);
function fixture(){
 const state={city:'Home',level:1,auto:true,fail:false};
 const api={getCity:()=>state.city,switchCity:city=>{state.city=city;return true;},getActionCountRemaining:()=>10,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>3,getActionAutolevel:()=>state.auto,
  setActionLevel:(_t,_n,level)=>state.level=level,getActionEstimatedSuccessChance:(_t,name)=>{if(state.fail&&state.city==='Other')throw Error('native');return (state.city==='Home'?name==='X':name==='Y')?[1,1]:[.1,.1];},
  getActionTime:()=>1000,getActionRankGain:(_t,name)=>name==='X'?100:1,getActionRankLoss:()=>0,getSkillLevel:()=>0,getStamina:()=>recovery.stamina};
 return {state,api};
}
const actions=[['X','Contracts'],['Y','Contracts']];
const probe=(f,planner=planBladeburnerLevels,scoreFactory=factory,allowed=()=>true)=>probeBladeburnerCities(f.api,['Home','Other'],actions,.99,allowed,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery,planner,null,scoreFactory);
test('XP cities follow target capability while rank cities retain the faster rank action',()=>{
 const f=fixture(),rank=chooseBladeburnerCity(probe(f,planBladeburnerLevels,null),'Home'),xp=chooseBladeburnerCity(probe(f),'Home');
 assert.equal(rank.city,'Home');assert.equal(rank.action,'X');assert.equal(xp.city,'Other');assert.equal(xp.action,'Y');
 assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);assert.equal(f.state.auto,true);
});
test('disabled level optimization still compares native current-level XP output',()=>{
 const f=fixture();f.state.level=2;const result=chooseBladeburnerCity(probe(f,null),'Home');
 assert.equal(result.city,'Other');assert.equal(result.level,2);assert.equal(f.state.level,2);assert.equal(f.state.city,'Home');
});
test('XP city probes restore city and level after errors and cancellation',()=>{
 const f=fixture();f.state.fail=true;assert.throws(()=>probe(f),/native/);assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
 const g=fixture();let cancelled=false;const chance=g.api.getActionEstimatedSuccessChance;
 g.api.getActionEstimatedSuccessChance=(...args)=>{if(g.state.city==='Other')cancelled=true;return chance(...args);};
 assert.equal(probe(g,planBladeburnerLevels,factory,()=>!cancelled),null);assert.equal(g.state.city,'Home');assert.equal(g.state.level,1);
});
test('post-cost safety cannot be bypassed by an attractive XP reward',()=>{
 const f=fixture();const forecast=()=>[.1,.1];
 const rows=probeBladeburnerCities(f.api,['Home','Other'],actions,.99,()=>true,data,bladeburnerRankRate,forecast,recovery,planBladeburnerLevels,null,factory);
 assert.equal(chooseBladeburnerCity(rows,'Home'),null);assert.equal(f.state.city,'Home');
});
test('unknown XP data and invalid objective callbacks cannot invent a productive city',()=>{
 const f=fixture();const unknown=name=>(chance,m)=>bladeburnerCityGrowthScore(chance,m,data[name],null,context,0,bladeburnerRankRate,bladeburnerGrowthChoice);
 assert.equal(chooseBladeburnerCity(probe(f,planBladeburnerLevels,unknown),'Home'),null);
 assert.equal(chooseBladeburnerCity(probe(f,null,()=>null),'Home'),null);
 assert.equal(bladeburnerCityGrowthScore([1,1],{level:NaN},data.X,weights.X,context,0,bladeburnerRankRate,bladeburnerGrowthChoice),null);
});
test('relative switching margin also works at small competence-per-second scales',()=>{
 const rows=[{city:'Home',score:.0001},{city:'Other',score:.000102}];
 assert.equal(chooseBladeburnerCity(rows,'Home').city,'Home');rows[1].score=.000104;assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');
});
test('native production worker executes both rank and XP city objectives and restores state',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),literal=s.match(/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/)[1];
 const expression=Function('probeBladeburnerCities','bladeburnerRankRate','bladeburnerStaminaChance','planBladeburnerLevels','readBladeburnerMaintenance','bbMutationGuard','combatXpValue','bladeburnerGrowthChoice','bladeburnerCityGrowthScore','quoteBladeburnerCityTraining','bladeburnerStaminaGrowthSource','scoreBladeburnerCityFallback','return '+literal)(probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,bladeburnerStaminaGrowthSource,scoreBladeburnerCityFallback);
 for(const metadata of [null,context.metadata])for(const disabled of [false,true]){
  const f=fixture();const ns={bladeburner:f.api,isRunning:()=>true,getPlayer:()=>({...context.player,skills:{...context.player.skills,charisma:100},mults:{bladeburner_stamina_gain:1}}),args:[JSON.stringify(['Home','Other']),JSON.stringify(actions),.99,7,JSON.stringify(data),disabled,50,JSON.stringify(metadata),JSON.stringify(weights)]};
  const rows=vm.runInNewContext(expression,{ns}),best=chooseBladeburnerCity(rows,'Home');
  assert.equal(best.city,metadata?'Other':'Home');assert.equal(best.objective,metadata?'combat-xp':'rank');assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
 }
 assert.match(s,/JSON.stringify\(\[cityGrowthTarget,candidates,actions/);
 assert.match(s,/choice.objective==='combat-xp'\?'Best estimated combat-growth rate/);
});
