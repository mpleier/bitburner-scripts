import {scoreBladeburnerCityFallback} from '../bladeburner-city-fallback-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerGrowthCompletions as count} from '../bladeburner-growth-clock-policy.js';
import {bladeburnerRankSupply as supply} from '../bladeburner-reserve-policy.js';
import {valueBladeburnerStaminaGrowth as value,rankBladeburnerStaminaGrowth as rank,bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,planBladeburnerGrowthLevels} from '../combat-growth-policy.js';
import {probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,planBladeburnerTeams,bladeburnerRankRate,bladeburnerStaminaChance,readBladeburnerMaintenance} from '../bladeburner-policy.js';
const keys=['strength','defense','dexterity','agility','charisma','hacking','intelligence'];
const player={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{bladeburner_stamina_gain:1},hp:{current:100,max:100}};
const metadata={baseDifficulty:100,weights:{strength:1},decays:{strength:1}},context={player,metadata,inferLevels:true};
const quote=bonusMs=>quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000,bonusMs});
const training={kind:'training',name:'Training',score:.0001,time:30000,rates:{strength:1,agility:0}};
const mission={kind:'mission',name:'Retirement',score:.002,time:1000,duty:1,rates:{strength:2,agility:0}};
test('whole completions never exceed stock, including progress and active bonus time',()=>{
 for(const maxCompletions of [0,1,2,30,100])for(const progressMs of [0,999]){const c=count(1000,30,150,{maxCompletions,progressMs});assert.equal(c.count,Math.min(30,maxCompletions));assert.equal(c.maxCompletions,maxCompletions);}
 for(const maxCompletions of [-1,.5,NaN,Infinity])assert.equal(count(1000,30,30,{maxCompletions}),null);
 assert.equal(count(1000,30,30).count,30);
});
test('stock cap preserves raw XP and per-attempt value while unknown supply gives zero credit',()=>{
 const one=value({...mission,supply:1,progressMs:999},training,quote(121000));assert.equal(one.completion.count,1);assert.equal(one.score,mission.score/30);assert.equal(one.rates,mission.rates);assert.equal(one.xpScore,mission.score);
 for(const n of [0,null,-1,.5,NaN,Infinity]){const q=value({...mission,supply:n},training,quote(121000));assert.equal(q.completion.count,0);assert.equal(q.score,0);}
 assert.equal(value(training,training,quote(121000)).completion.count,5);
});
test('missing optional stamina retains stock-capped XP instead of an unlimited fallback',()=>{
 for(const q of [null,{bonusMs:NaN}]){const result=value({...mission,supply:2},null,q);assert.equal(result.completion.count,2);assert.equal(result.score,mission.score*2/30);}
 assert.equal(value({...mission,supply:null},null,null).score,0);
 assert.equal(value({...mission,supply:1},null,null,0).score,0);
 assert.equal(value(mission,null,null),mission);
});
test('existing reserves determine whole usable attempts without assuming future generation',()=>{
 const reserves={stealth:200,guardReady:true,population:200,maxRank:1000};
 assert.equal(supply('Stealth Retirement Operation',201.9,0,reserves),1);assert.equal(supply('Stealth Retirement Operation',201.9,0,{...reserves,guardReady:false}),0);
 assert.equal(supply('Tracking',200.2,0,reserves),1);assert.equal(supply('Tracking',199.9,0,reserves),0);assert.equal(supply('Raid',1000,0,reserves),0);
 const result=value({...mission,supply:supply('Stealth Retirement Operation',201.9,0,reserves)},training,quote(121000));assert.equal(result.completion.count,1);
});
test('low stock changes mission selection and never restricts native Training',()=>{
 const scarce={...mission,name:'Scarce',supply:1},available={...mission,name:'Available',score:.001,supply:100};
 assert.equal(rank([scarce,available],training,quote(0)).choice.name,'Available');
 assert.equal(rank([{...scarce,supply:0}],training,quote(0),{trainingAllowed:true}).choice.name,'Training');
 const raw={name:'Retirement',time:1000,difficulty:1,chance:1,duty:1,weights:{strength:1}};
 const capped=bladeburnerGrowthChoice([raw],{...context,growthSupply:{Retirement:1}});assert.equal(capped.supply,1);
 const unknown=bladeburnerGrowthChoice([raw],{...context,growthSupply:{}});assert.equal(unknown.supply,null);
});
const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
function expression(name){
 const re=name==='city'?/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/:/levelPlans=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-level-plan.txt'/;
 const bindings={scoreBladeburnerCityFallback,probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,bbMutationGuard:'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,planBladeburnerGrowthLevels,planBladeburnerTeams,bladeburnerStaminaGrowthSource};
 return Function(...Object.keys(bindings),'return '+source.match(re)[1])(...Object.values(bindings));
}
function fixture(){
 const state={city:'A',level:1,team:0,auto:false};
 const api={getCity:()=>state.city,switchCity:c=>{state.city=c;return true;},getActionCountRemaining:()=>100,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>2,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,l)=>state.level=l,getActionEstimatedSuccessChance:()=>[1,1],getActionTime:t=>t==='General'?30000:1000,getActionRankGain:()=>1,getActionRankLoss:()=>0,getSkillLevel:()=>0,getStamina:()=>[100,100],getTeamSize:()=>state.team,setTeamSize:(_t,_n,t)=>state.team=t,getBonusTime:()=>121000};
 return {state,api};
}
test('actual city workers cap stock with optimization both enabled and disabled and restore state',()=>{
 const data={Retirement:{base:1,factor:1}},weights={Retirement:{strength:1}};
 for(const disabled of [false,true]){
  const scores=[];
  for(const stock of [0,1,2,100]){
   const f=fixture(),args=[JSON.stringify(['A','B']),JSON.stringify([['Retirement','Contracts']]),.99,7,JSON.stringify(data),disabled,50,JSON.stringify(metadata),JSON.stringify(weights),'Target',30,JSON.stringify({Retirement:stock})];
   const rows=vm.runInNewContext(expression('city'),{ns:{args,bladeburner:f.api,isRunning:()=>true,getPlayer:()=>player}});scores.push(rows[0].score);assert.equal(f.state.city,'A');assert.equal(f.state.level,1);
  }
  assert.equal(scores[0],0);assert.ok(scores[1]>0);assert.ok(Math.abs(scores[2]-2*scores[1])<1e-12);assert.ok(scores[3]>scores[2]);
 }
});
test('actual level/team growth worker receives the context stock cap and restores temporary settings',()=>{
 const data={Retirement:{base:1,factor:1}},weights={Retirement:{strength:1}},scores=[];
 for(const stock of [0,1,2]){
  const f=fixture(),args=[JSON.stringify([['Retirement','Contracts']]),.99,7,0,0,'0',JSON.stringify({actions:data,stamina:[100,100],regen:1,hrc:1}),JSON.stringify({...context,growthSupply:{Retirement:stock}}),0,JSON.stringify(weights),30];
  const plans=vm.runInNewContext(expression('level'),{ns:{args,bladeburner:f.api,isRunning:()=>true}});scores.push(plans.Retirement?.score??0);assert.equal(f.state.level,1);assert.equal(f.state.team,0);assert.equal(f.state.auto,false);
 }
 assert.equal(scores[0],0);assert.ok(scores[1]>0);assert.ok(Math.abs(scores[2]-2*scores[1])<1e-12);
});
test('city cache stock includes every candidate and level cache includes reserve-adjusted stock',()=>{
 const line=source.split('\n').find(l=>l.includes('const reserveSupply=actions.map'));
 const read=n=>{const c={actions:[['Retirement','Contracts']],bladeburnerRankSupply:supply,getCount:()=>n,rank:0,rankReserves:{}};vm.runInNewContext(line+';globalThis.stock=reserveSupply;',c);return JSON.stringify(c.stock);};
 assert.notEqual(read(1),read(2));assert.equal(read(1.1),read(1.9));assert.equal(read(100),read(99));assert.notEqual(read(29),read(30));
 assert.match(source,/growthContext\?\.metadata,growthContext\?\.growthSupply,currentCity/);
 assert.match(source,/JSON\.stringify\(Object\.fromEntries\(reserveSupply\)\)/);
 assert.match(source,/progressMs,supply:bladeburnerRankSupply\(name,getCount\(name\),rank,rankReserves\)/);
});
