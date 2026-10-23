import test from 'node:test';
import assert from 'node:assert/strict';
import {observeBbStatReadiness,chooseParallelCombatTraining,startSleeveCombatGym,committedSleeveGymSeconds} from '../bb-stat-development-policy.js';
import {combatXpValue,quoteSleeveCombatGyms,chooseSleeveCombatGym} from '../combat-growth-policy.js';
import {quotePlayerCombatTraining,choosePlayerCombatTraining} from '../player-combat-training-policy.js';
import {sleeveBladeburnerTasks} from '../sleeve-policy.js';
import {sleeveDevelopmentActive} from '../sleeve-development-policy.js';
const skills={strength:1000,defense:1000,dexterity:700,agility:680,hacking:100,charisma:100,intelligence:160};
const player={city:'Aevum',skills,exp:Object.fromEntries(Object.keys(skills).map(k=>[k,10000])),mults:{}};
const metadata={baseDifficulty:2000,weights:{strength:.2,defense:.2,dexterity:.2,agility:.2,hacking:.1,intelligence:.1},decays:Object.fromEntries(Object.keys(skills).map(k=>[k,.8]))};
const context={player,metadata,inferLevels:true};
test('action speed adds discounted native dex/agi value while leaving strength unchanged',()=>{
 for(const stat of ['dexterity','agility'])assert.ok(combatXpValue({[stat]:100},{...context,speedWeight:.25})>combatXpValue({[stat]:100},context));
 assert.equal(combatXpValue({strength:100},{...context,speedWeight:.25}),combatXpValue({strength:100},context));
 assert.equal(combatXpValue({dexterity:100},{...context,speedWeight:NaN}),combatXpValue({dexterity:100},context));
 const floor={...context,metadata:{...metadata,baseDifficulty:.01}};assert.equal(combatXpValue({agility:100},{...floor,speedWeight:.25}),combatXpValue({agility:100},floor));
});
test('action-speed score matches an independent finite difference of the native formula',()=>{
 const rates={dexterity:1},base=combatXpValue(rates,context),scored=combatXpValue(rates,{...context,speedWeight:.25});
 const speed=s=>.5*(s.dexterity**.035+s.agility**.04+(s.dexterity+s.agility)/10000),dt=.0001;
 const mult=skills.dexterity/(32*Math.log(10000+534.6)-200),next={...skills,dexterity:mult*(32*Math.log(10000+dt+534.6)-200)};
 const competence=Object.entries(metadata.weights).reduce((v,[k,w])=>v+w*skills[k]**metadata.decays[k],0);
 const expected=.25*competence*Math.log(speed(next)/speed(skills))/dt;
 assert.ok(Math.abs(scored-base-expected)<1e-6);
});
const readiness=(at,p=.8,extra={})=>({target:'Typhoon',nodeReset:1,augReset:2,city:'Sector-12',chance:[p,p],threshold:.99,rankEtaMs:100000,at,...extra});
test('early preparation waits for observations and starts when stat readiness trails rank',()=>{
 let r;for(const t of [0,15000,30000])r=observeBbStatReadiness(r,readiness(t));
 assert.equal(r.statStalled,true);assert.equal(r.preparingStats,true);
 const fresh=observeBbStatReadiness(null,readiness(0));assert.equal(fresh.preparingStats,false);
 let fast;for(const [t,p]of [[0,.8],[15000,.85],[30000,.9]])fast=observeBbStatReadiness(fast,readiness(t,p));assert.equal(fast.preparingStats,false);
 let slow;for(const [t,p]of [[0,.8],[15000,.801],[30000,.802]])slow=observeBbStatReadiness(slow,readiness(t,p));assert.ok(slow.statEtaMs>100000);assert.equal(slow.preparingStats,true);
});
test('readiness rejects uncertainty, resets, clock rollback, stale samples and unknown rank rate',()=>{
 let r;for(const t of [0,15000,30000])r=observeBbStatReadiness(r,readiness(t));
 for(const patch of [{chance:[.8,.95]},{rankEtaMs:null},{rankEtaMs:1e9},{target:'Other'},{augReset:3},{at:1000},{at:100000}])assert.notEqual(observeBbStatReadiness(r,readiness(31000,.8,patch)).preparingStats,true);
});
test('early sleeve preparation retains a supply worker and protects support and reputation',()=>{
 const sleeves=Array.from({length:5},()=>({shock:0,sync:100})),tasks=[{type:'SUPPORT'},{type:'FACTION'},null,null,null];
 const plan={chaos:0,threshold:.99,chance:[.8,.8],rankReady:false,preparingStats:true,rankEtaMs:60000,statEtaMs:120000,counts:{Tracking:100}};
 const r=sleeveBladeburnerTasks(sleeves,tasks,plan,[0]);assert.equal(r[0],undefined);assert.equal(r[1],undefined);assert.equal(Object.values(r).filter(t=>t==='Infiltrate Synthoids').length,1);assert.equal(Object.values(r).filter(t=>t==='combat-xp').length,2);
 assert.ok(!Object.values(sleeveBladeburnerTasks(sleeves,tasks,{...plan,statEtaMs:1000},[0])).includes('combat-xp'));
 assert.ok(!Object.values(sleeveBladeburnerTasks(sleeves,tasks,plan,[0],false)).includes('combat-xp'));
});
test('early development evidence keeps reset ownership and age checks',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},p=[{pid:7,filename:'bladeburner.js'}],record={target:'Typhoon',pid:7,at:1000,nodeReset:1,augReset:2,preparingStats:true};
 assert.equal(sleeveDevelopmentActive(record,reset,p,2000),true);assert.equal(sleeveDevelopmentActive(record,reset,[],2000),false);assert.equal(sleeveDevelopmentActive(record,reset,p,40000),false);
});
const gym={kind:'gym',name:'agility',city:'Sector-12',fromCity:'Aevum',score:4,time:30000,costPerSecond:1,travelCost:200000,travelMs:1000};
const local={...gym,city:'Aevum',travelCost:0,travelMs:0,score:1};
const opts={simulacrum:true,remainingMs:30000,quotaLeft:10,money:1e9,reserve:0,localCity:'Aevum'};
test('parallel training preserves mission progress and prices travel and reserves',()=>{
 const r=chooseParallelCombatTraining([local,gym],opts);assert.equal(r.city,'Sector-12');assert.equal(r.durationMs,29000);assert.equal(r.cost,200030);assert.equal(r.foregoneRank,0);assert.equal(r.baselineGain,0);
 assert.equal(chooseParallelCombatTraining([gym],{...opts,simulacrum:false}),null);
 assert.equal(chooseParallelCombatTraining([gym],{...opts,reserve:999999999}),null);
 assert.equal(chooseParallelCombatTraining([local,{...gym,score:1.1}],opts).city,'Aevum');
 assert.equal(chooseParallelCombatTraining([local],{...opts,quotaLeft:0}),null);
});
test('ordinary training also rejects relocation without a material advantage',()=>{
 const options={baselineScore:.1,remainingMs:30000,quotaLeft:10,money:1e9,reserve:0};
 assert.equal(choosePlayerCombatTraining([local,{...gym,score:1.1}],options).city,'Aevum');
 assert.equal(choosePlayerCombatTraining([local,gym],options).city,'Sector-12');
});
function quotesFixture(){
 return {fileExists:()=>true,enums:{GymType:Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,k])),LocationName:{Sector12PowerhouseGym:'Powerhouse Gym',AevumSnapFitnessGym:'Snap Fitness'}},singularity:{getCrimeStats:()=>({time:3000}),getCrimeChance:()=>1},formulas:{work:{crimeGains:()=>({hackExp:0,strExp:1,defExp:0,dexExp:0,agiExp:0,chaExp:0}),gymGains:(p,t,g)=>({money:-1,strExp:g==='Powerhouse Gym'?20:1,defExp:0,dexExp:0,agiExp:0})}}};
}
test('native gym quotes enumerate valid destinations and use the destination city',()=>{
 const ns=quotesFixture(),s={...player,shock:0,sync:100};
 const q=quotePlayerCombatTraining(ns,context,true);assert.equal(q.filter(q=>q.kind==='gym').length,8);assert.equal(q.find(q=>q.city==='Sector-12').travelCost,200000);
 assert.equal(quotePlayerCombatTraining(ns,context).filter(q=>q.kind==='gym').length,4);
 assert.equal(quoteSleeveCombatGyms(ns,[s],true)[0].length,8);
 const chosen=chooseSleeveCombatGym(s,quoteSleeveCombatGyms(ns,[s],true)[0],{rate:0},context,{money:1e9,reserve:0,seconds:30});assert.equal(chosen.city,'Sector-12');assert.ok(chosen.budget>=200000);
});
function nativeGym(){
 let s={city:'Aevum',shock:0,sync:100},t=null,cash=1e9;const events=[];
 const ns={getPlayer:()=>({money:cash}),read:()=>'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),isRunning:p=>p===7,sleeve:{getSleeve:()=>s,getTask:()=>t,travel:(_i,city)=>{events.push('travel');s.city=city;return true;},setToGymWorkout:(_i,gym,type)=>{events.push('gym');t={type:'CLASS',location:gym,classType:type};return true;}}};
 const q={stat:'agility',gymType:'agility',gym:'Powerhouse Gym',city:'Sector-12',fromCity:'Aevum',cost:1};
 return {ns,q,events,shock:()=>s.shock=1,cash:v=>cash=v,task:v=>t=v};
}
test('native sleeve relocation rechecks complete cost, shock, crime progress and current city',()=>{
 const f=nativeGym();assert.equal(startSleeveCombatGym(f.ns,0,f.q,0),true);assert.deepEqual(f.events,['travel','gym']);
 for(const mode of ['shock','cash','crime','city']){const f=nativeGym();if(mode==='shock')f.shock();if(mode==='cash')f.cash(10000);if(mode==='crime')f.task({type:'CRIME',cyclesWorked:1,cyclesNeeded:5});if(mode==='city')f.q.fromCity='Volhaven';assert.equal(startSleeveCombatGym(f.ns,0,f.q,0),false);assert.deepEqual(f.events,[]);}
});
test('hash gym benefit counts confirmed sessions and rejects stale, replaced, or changed tasks',()=>{
 const f=nativeGym();startSleeveCombatGym(f.ns,0,f.q,0);
 const plan={at:1000,ownerPid:7,nodeReset:1,augReset:2,commitments:{0:{until:31000,gym:'Powerhouse Gym',gymType:'agility'}}};
 assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),29);
 assert.equal(committedSleeveGymSeconds(f.ns,{...plan,ownerPid:8},2000),0);
 assert.equal(committedSleeveGymSeconds(f.ns,plan,5000),0);
 assert.equal(committedSleeveGymSeconds(f.ns,{...plan,augReset:3},2000),0);
 f.task({type:'RECOVERY'});assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),0);
});
test('a verified completion permits leaving a repeating crime but stale credit does not',()=>{
 const f=nativeGym(),now=Date.now();f.task({type:'CRIME',crimeType:'Mug',cyclesWorked:1,cyclesNeeded:10,tasksCompleted:2});
 f.q.completionCredit={at:now,crimeType:'Mug',tasksCompleted:2};assert.equal(startSleeveCombatGym(f.ns,0,f.q,0),true);
 const stale=nativeGym();stale.task({type:'CRIME',crimeType:'Mug',cyclesWorked:1,cyclesNeeded:10,tasksCompleted:2});stale.q.completionCredit={at:now-10000,crimeType:'Mug',tasksCompleted:2};assert.equal(startSleeveCombatGym(stale.ns,0,stale.q,0),false);
});
test('native-confirmed player gym sessions add to the shared hash benefit once',()=>{
 const f=nativeGym();startSleeveCombatGym(f.ns,0,f.q,0);
 const plan={at:1000,ownerPid:7,nodeReset:1,augReset:2,commitments:{0:{until:31000,gym:'Powerhouse Gym',gymType:'agility'}}};
 const p={ownerPid:7,parent:7,nodeReset:1,augReset:2,until:31000,gym:'Powerhouse Gym',gymType:'agility'};
 f.ns.read=()=>JSON.stringify(p);f.ns.singularity={getCurrentWork:()=>({type:'CLASS',location:'Powerhouse Gym',classType:'agility'})};
 assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),58);
 p.until=100000;assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),29);
});
test('legacy gym targets retain upgrades with native bounded time-to-target instead of 900 seconds',()=>{
 const f=nativeGym();startSleeveCombatGym(f.ns,0,f.q,0);
 const plan={at:1000,ownerPid:7,nodeReset:1,augReset:2,targets:{0:{stat:'agility',target:1000,gym:'Powerhouse Gym',gymType:'agility'}}};
 f.ns.sleeve.getSleeve=()=>({shock:0,sync:100,skills:{agility:100},exp:{agility:10000}});f.ns.fileExists=()=>true;f.ns.formulas={work:{gymGains:()=>({agiExp:1})}};
 assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),30);
 plan.targets[0].target=50;assert.equal(committedSleeveGymSeconds(f.ns,plan,2000),0);
});
