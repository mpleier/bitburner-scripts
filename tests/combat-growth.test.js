import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {combatXpValue,combatAugmentationValue,readCombatGrowthContext,quoteSleeveCombatGyms,chooseSleeveCombatGym,combatCrimeCompleted,bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {bladeburnerRankRate} from '../bladeburner-policy.js';
import {sleeveCombatCrime} from '../sleeve-development-policy.js';
import {selectAugmentationBasketDrop} from '../faction-policy.js';
import {blackOpMetadata,bladeburnerXpWeights} from '../bladeburner-action-data.js';
const stats=['hacking','strength','defense','dexterity','agility','charisma','intelligence'];
const player={skills:Object.fromEntries(stats.map(k=>[k,100])),exp:Object.fromEntries(stats.map(k=>[k,1000])),mults:{}};
const metadata={weights:Object.fromEntries(stats.map(k=>[k,k==='strength'?1:0])),decays:Object.fromEntries(stats.map(k=>[k,.8]))};
const context={player,metadata};
const sleeve={city:'Sector-12',shock:0,sync:100,skills:player.skills,mults:{}};
const q={city:'Sector-12',gym:'Powerhouse Gym',stat:'strength',gymType:'str',cost:100,rates:{strength:100}};

test('shared XP score matches native skill inverse sensitivity and effective-stat decays',()=>{
 const expected=.8*100**(-.2)*32/1534.6;
 assert.ok(Math.abs(combatXpValue({strength:1},context)-expected)<1e-12);
 assert.ok(Math.abs(combatXpValue({strength:1},{...context,effective:{strength:2}})-expected*2**.8)<1e-12);
 assert.equal(combatXpValue({strength:100},{...context,levelMultipliers:{strength:0}}),0);
 assert.equal(combatXpValue({agility:100},context),0);
 assert.equal(combatXpValue({strength:100},null),0);
});
test('crime and gym XP use the same competence units without doubling sleeve multipliers',()=>{
 const crimes={Mug:{time:1000,difficulty:1,strength_exp:100}};
 const crime=sleeveCombatCrime(sleeve,crimes,0,context);
 assert.ok(Math.abs(crime.rate-combatXpValue({strength:25},context))<1e-12);
 assert.ok(chooseSleeveCombatGym(sleeve,[q],crime,context,{money:10000,seconds:1}));
});
test('native gym quote uses enum arguments, per-cycle scaling and current-city gyms only',()=>{
 let calls=0;
 const ns={fileExists:()=>true,enums:{LocationName:{Sector12PowerhouseGym:'Powerhouse Gym'},GymType:{strength:'str',defense:'def',dexterity:'dex',agility:'agi'}},formulas:{work:{gymGains:(_s,stat,gym)=>{
  assert.ok(['str','def','dex','agi'].includes(stat));assert.equal(gym,'Powerhouse Gym');calls++;return {money:-20,strExp:2,defExp:0,dexExp:0,agiExp:0};
 }}}};
 const quote=vm.runInNewContext('('+quoteSleeveCombatGyms.toString()+')');
 const result=quote(ns,[sleeve,{...sleeve,city:'Chongqing'}]);
 assert.equal(result[0][0].cost,100);assert.equal(result[0][0].rates.strength,10);assert.equal(result[0][0].gymType,'str');assert.equal(result[1].length,0);assert.equal(calls,4);
});
test('missing Formulas or inaccessible optional APIs retain crime fallback',()=>{
 assert.deepEqual(quoteSleeveCombatGyms({fileExists:()=>false},[sleeve]),[]);
 assert.deepEqual(quoteSleeveCombatGyms({fileExists:()=>{throw Error('Source File');}},[sleeve]),[]);
 assert.equal(chooseSleeveCombatGym(sleeve,[],{rate:1},context,{money:1e9}),null);
});
test('gym selection enforces cash reserve, health of the sleeve, bounded charge and margin',()=>{
 const choose=(s=sleeve,quote=q,opt={})=>chooseSleeveCombatGym(s,[quote],{rate:0},context,{money:1100,reserve:500,seconds:5,...opt});
 assert.equal(choose().budget,600);assert.equal(choose(sleeve,q,{money:1099}),null);
 for(const patch of [{shock:1},{sync:99},{sync:NaN},{city:'Aevum'}])assert.equal(choose({...sleeve,...patch}),null);
 for(const seconds of [0,-1,NaN,121])assert.equal(choose(sleeve,q,{seconds}),null);
 assert.equal(choose(sleeve,{...q,cost:NaN}),null);
 assert.equal(chooseSleeveCombatGym(sleeve,[q],{rate:combatXpValue(q.rates,context)},context,{money:1e9}),null);
});
test('partial crimes are protected but repeating crimes cannot starve switching forever',()=>{
 const old={type:'CRIME',crimeType:'Mug',cyclesWorked:5,cyclesNeeded:10,tasksCompleted:1};
 assert.equal(chooseSleeveCombatGym(sleeve,[q],null,context,{money:1e9,task:old}),null);
 assert.equal(combatCrimeCompleted(old,{...old,cyclesWorked:8}),false);
 assert.equal(combatCrimeCompleted(old,{...old,cyclesWorked:2,tasksCompleted:2}),true);
 assert.equal(combatCrimeCompleted(old,{...old,cyclesWorked:2}),true);
 assert.equal(combatCrimeCompleted(old,{...old,crimeType:'Heist'}),false);
 assert.equal(combatCrimeCompleted(old,{...old,cyclesWorked:0}),true);
});
test('development mission XP uses native difficulty and failure-half XP, never rank rewards',()=>{
 const action={name:'Mission',time:1000,difficulty:100,chance:1,duty:1,weights:{strength:1},gain:1};
 const result=bladeburnerGrowthChoice([action],context,{hyperdrive:2});
 const gain=(100**.28+100/650)*1.2;
 assert.ok(Math.abs(result.rates.strength-gain)<1e-12);
 const failed=bladeburnerGrowthChoice([{...action,chance:0}],context,{hyperdrive:2});
 assert.ok(Math.abs(failed.score-result.score*.5)<1e-12);
 assert.equal(bladeburnerGrowthChoice([{...action,gain:1e9}],context,{hyperdrive:2}).score,result.score);
});
test('mission maintenance and recovery duty compete against bounded native Training',()=>{
 const action={name:'Mission',time:1000,difficulty:100,chance:1,duty:1,weights:{strength:1}};
 assert.equal(bladeburnerGrowthChoice([action],context,{trainingAllowed:true}).name,'Mission');
 assert.equal(bladeburnerGrowthChoice([{...action,duty:.01}],context,{trainingAllowed:true}).name,'Training');
 assert.equal(bladeburnerGrowthChoice([{...action,duty:.01}],context,{trainingAllowed:false}).name,'Mission');
 assert.equal(bladeburnerGrowthChoice([],context,{trainingAllowed:false}),null);
 assert.equal(bladeburnerGrowthChoice([{...action,difficulty:NaN}],context),null);
});
test('augmentation utility targets the blocked operation and recognizes XP and success bonuses',()=>{
 assert.ok(combatAugmentationValue({strength:1.5},context)>combatAugmentationValue({agility:2},context));
 assert.ok(combatAugmentationValue({strength_exp:1.5},context)>0);
 assert.ok(combatAugmentationValue({bladeburner_success_chance:1.1},context)>0);
 assert.equal(combatAugmentationValue({bladeburner_stamina_gain:NaN},context),null);
 assert.equal(combatAugmentationValue({},null),null);
 const aug=(name,stats)=>({name,stats,price:100,prereqs:[]});
 const cut=selectAugmentationBasketDrop([aug('Strength',{strength:1.5}),aug('Agility',{agility:2})],{route:'bladeburner',combatContext:context,multiplier:1});
 assert.equal(cut.name,'Agility');
});
test('combat context reader rejects stale evidence, reset mismatch and replacement controllers',()=>{
 const now=10000,r={lastNodeReset:1,lastAugReset:2},data={at:now,nodeReset:1,augReset:2,pid:7,chanceBlocked:true,metadata};
 const ns={getResetInfo:()=>r,read:()=>JSON.stringify(data),ps:()=>[{pid:7,filename:'bladeburner.js'}]};
 assert.ok(readCombatGrowthContext(ns,player,now));
 data.at=now-30000;assert.equal(readCombatGrowthContext(ns,player,now),null);
 data.at=now;data.nodeReset++;assert.equal(readCombatGrowthContext(ns,player,now),null);
 data.nodeReset=1;data.pid++;assert.equal(readCombatGrowthContext(ns,player,now),null);
});
test('native skill strings in production match the game enum and corrected paths include the skill',()=>{
 for(const name of ['bladeburner.js','bladeburner-policy.js','node-route-policy.js']){
  const text=readFileSync(new URL('../'+name,import.meta.url),'utf8');assert.ok(!text.includes('Evasive Systems'));assert.ok(text.includes('Evasive System'));
 }
});
test('native XP allocations preserve official asymmetry without using target weights as rewards',()=>{
 assert.equal(bladeburnerXpWeights.Tracking.dexterity,.35);
 assert.equal(bladeburnerXpWeights.Investigation.charisma,.25);
 assert.equal(bladeburnerXpWeights['Stealth Retirement Operation'].agility,.3);
 assert.equal(blackOpMetadata['Operation Zero'].weights.charisma,0);
});
test('actual controller wiring keeps safe unreserved missions, spending and Training budget gates',()=>{
 const bb=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),sl=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 assert.match(bb,/unreservedActions.filter\(name=>name!==nextBlackOp&&getCount\(name\)>=1&&minChance/);
 assert.match(bb,/chance=v.chance\?\?getChance\(name\)/);assert.match(bb,/bladeburnerRankRate\(chance,m,timing\)/);assert.match(bb,/chance\[0\]>=options\[\x27success-threshold\x27\]/);
 assert.match(bb,/duty:timing.duty/);
 assert.match(bb,/trainingAllowed:developmentAction==='Training'/);
 assert.match(sl,/claimSpending\(ns,'sleeves',gym.budget\)/);
 assert.match(sl,/combatCrimeCompleted\(combatGymProgress\[i\],actual\)/);
 assert.match(sl,/Date.now\(\)-combatGymAt>=10000/);
});

test('XP duty uses actual cycle timing, with no credit from cleanup rank rewards',()=>{
 const timing={};const metrics={time:1000,gain:10,loss:0,staminaCost:2,staminaRegen:0,hrcRegen:1};
 assert.equal(bladeburnerRankRate([1,1],metrics,timing),10/3);
 assert.equal(timing.duty,1/3);
 assert.equal(timing.rate,10/3);
});
