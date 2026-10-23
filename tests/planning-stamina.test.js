import {scoreBladeburnerCityFallback} from '../bladeburner-city-fallback-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createBladeburnerStaminaGrowth,bladeburnerStaminaGrowthSource,valueBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,planBladeburnerGrowthLevels} from '../combat-growth-policy.js';
import {probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,planBladeburnerTeams,bladeburnerRankRate,bladeburnerStaminaChance,readBladeburnerMaintenance} from '../bladeburner-policy.js';
const keys=['strength','defense','dexterity','agility','charisma','hacking','intelligence'];
const player={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{bladeburner_stamina_gain:1},hp:{current:100,max:100}};
const metadata={baseDifficulty:50000,weights:{strength:1,agility:.01},decays:{strength:1,agility:1}},context={player,metadata,inferLevels:true};
const cost=.285*(50000**.28+50000/650),max=cost*1.5;
const actions=[['Strength','Contracts'],['Agility','Contracts']],data={Strength:{base:1,factor:1},Agility:{base:2,factor:1}},weights={Strength:{strength:1},Agility:{agility:1}};
function fixture(){
 const state={city:'Home',level:1,team:0,auto:true};
 const api={getCity:()=>state.city,switchCity:c=>{state.city=c;return true;},getActionCountRemaining:()=>10,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>2,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,l)=>state.level=l,getActionEstimatedSuccessChance:(_t,n)=>n==='Target'?[.2,.2]:(state.city==='Home'?n==='Strength':n==='Agility')?[1,1]:[.1,.1],getActionTime:t=>t==='General'?30000:1000,getActionRankGain:()=>1,getActionRankLoss:()=>0,getSkillLevel:()=>0,getStamina:()=>[max,max],getTeamSize:()=>state.team,setTeamSize:(_t,_n,v)=>state.team=v};
 return {api,state};
}
const make=(api,seconds=30)=>createBladeburnerStaminaGrowth(api,context,0,bladeburnerGrowthChoice,quotePlayerTrainingStamina,valueBladeburnerStaminaGrowth,seconds);
const rowFactory=growth=>name=>(chance,m)=>bladeburnerCityGrowthScore(chance,m,data[name],weights[name],context,0,bladeburnerRankRate,growth);
test('stamina-aware city scores can choose agility growth over the raw-XP favorite',()=>{
 const f=fixture(),recovery={stamina:[max,max],regen:1,hrc:1};
 const probe=growth=>probeBladeburnerCities(f.api,['Home','Other'],actions,.99,()=>true,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery,planBladeburnerLevels,null,rowFactory(growth));
 assert.equal(chooseBladeburnerCity(probe(bladeburnerGrowthChoice),'Home').city,'Home');
 assert.equal(chooseBladeburnerCity(probe(make(f.api)),'Home').city,'Other');
 assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
});
test('serialized growth evaluator matches the live pure evaluator without hidden bindings',()=>{
 const f=fixture(),raw={name:'Agility',time:1000,difficulty:2,chance:1,weights:weights.Agility,duty:1};
 const source=vm.runInNewContext(bladeburnerStaminaGrowthSource);
 const generated=source(f.api,context,0,bladeburnerGrowthChoice,15),direct=make(f.api,15);
 assert.equal(generated.staminaAdjusted,true);const a=generated([raw],context,{}),b=direct([raw],context,{});
 assert.equal(a.score,b.score);assert.equal(a.stamina.horizonSeconds,15);assert.ok(a.xpScore>0);
 for(const seconds of [0,NaN,31])assert.equal(make(f.api,seconds).staminaAdjusted,false);
 f.api.getSkillLevel=()=>{throw Error('Source File unavailable');};assert.equal(make(f.api).staminaAdjusted,false);
});
function expression(name){
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),re=name==='city'?/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/:/levelPlans=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-level-plan.txt'/;
 const literal=s.match(re)[1],bindings={scoreBladeburnerCityFallback,probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,bbMutationGuard:'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,planBladeburnerGrowthLevels,planBladeburnerTeams,bladeburnerStaminaGrowthSource};
 return Function(...Object.keys(bindings),'return '+literal)(...Object.values(bindings));
}
test('actual city worker executes adjusted and fallback branches while restoring state',()=>{
 const body=expression('city');
 for(const disabled of [false,true])for(const target of [metadata,null]){
  const f=fixture(),args=[JSON.stringify(['Home','Other']),JSON.stringify(actions),.99,7,JSON.stringify(data),disabled,50,JSON.stringify(target),JSON.stringify(weights),'Target',15];
  const rows=vm.runInNewContext(body,{ns:{args,bladeburner:f.api,isRunning:()=>true,getPlayer:()=>player}});
  assert.equal(rows[0].scoreBasis,target?'stamina-effective-competence':'rank');
  if(target){assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');assert.equal(rows[0].trainingBaseline,null);}
  assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
 }
});
test('actual level/team worker publishes adjusted scores and restores team, level and autolevel',()=>{
 const body=expression('level'),f=fixture();f.api.getActionEstimatedSuccessChance=()=>[1,1];
 const recovery={actions:data,stamina:[max,max],regen:1,hrc:1},args=[JSON.stringify(actions),.99,7,0,0,'0',JSON.stringify(recovery),JSON.stringify(context),0,JSON.stringify(weights),15];
 const plans=vm.runInNewContext(body,{ns:{args,bladeburner:f.api,isRunning:()=>true}});
 assert.equal(plans.Agility.scoreBasis,'stamina-effective-competence');assert.ok(plans.Agility.score>plans.Strength.score);assert.equal(f.state.level,1);assert.equal(f.state.team,0);assert.equal(f.state.auto,true);
});
test('city cache keys refresh for maximum capacity and horizon changes without tracking current-stamina noise',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('        const key=JSON.stringify([cityGrowthTarget,'),end=s.indexOf('\n',start),code=s.slice(start,end);
 const key=(current,maximum,spent=0)=>{const c={cityGrowthTarget:'Target',candidates:['Home'],actions,options:{},maintenanceKey:'m',rankReserves:{},reserveSupply:[],currentCity:'Home',squadKey:'s',cityState:{trainingVitals:{stamina:[current,maximum]}},developmentBudget:{spentMs:spent}};vm.runInNewContext(code+';globalThis.result=key;',c);return c.result;};
 assert.equal(key(20,40),key(30,40));assert.notEqual(key(20,40),key(20,41));assert.notEqual(key(20,40),key(20,40,110000));
});


test('stamina-aware operation team probes honor support/reserve caps and restore the original squad',()=>{
 const body=expression('level'),f=fixture();f.api.getTeamSize=(...a)=>a.length?f.state.team:4;
 f.api.getActionEstimatedSuccessChance=t=>t==='Operations'?(f.state.team>=1?[1,1]:[.5,.5]):[1,1];
 const recovery={actions:data,stamina:[max,max],regen:1,hrc:1,maintenance:true,recruitment:{chance:1,time:1000}},args=[JSON.stringify([['Agility','Operations']]),.99,7,1,2,'1',JSON.stringify(recovery),JSON.stringify(context),0,JSON.stringify(weights),30];
 const plans=vm.runInNewContext(body,{ns:{args,bladeburner:f.api,isRunning:()=>true}});
 assert.ok(plans.Agility.team>=1&&plans.Agility.team<=2);assert.equal(plans.Agility.scoreBasis,'stamina-effective-competence');assert.equal(f.state.team,0);assert.equal(f.state.level,1);
});
test('active stamina probes restore temporary settings after cancellation or native errors',()=>{
 for(const mode of ['cancel','throw']){
  const f=fixture(),body=expression('city');let calls=0;
  if(mode==='throw'){const read=f.api.getActionEstimatedSuccessChance;f.api.getActionEstimatedSuccessChance=(...a)=>{if(f.state.city==='Other')throw Error('native');return read(...a);};}
  const args=[JSON.stringify(['Home','Other']),JSON.stringify(actions),.99,7,JSON.stringify(data),false,50,JSON.stringify(metadata),JSON.stringify(weights),'Target',30];
  try{vm.runInNewContext(body,{ns:{args,bladeburner:f.api,getPlayer:()=>player,isRunning:()=>mode==='cancel'?++calls<6:true}});}catch(error){assert.equal(mode,'throw');assert.match(String(error),/native/);}
  assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);assert.equal(f.state.team,0);assert.equal(f.state.auto,true);
 }
});
