import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {bladeburnerGrowthClock as clock,bladeburnerGrowthCompletions as count,readBladeburnerTrainingProgress as progress} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina,playerTrainingStaminaPayoff} from '../player-training-stamina-policy.js';
import {valueBladeburnerStaminaGrowth as value,bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import {bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {choosePlayerCombatTraining} from '../player-combat-training-policy.js';
const keys=['strength','defense','dexterity','agility'],rates=Object.fromEntries(keys.map(k=>[k,1]));
const context={player:{skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{}},metadata:{baseDifficulty:100,weights:{strength:1,agility:1},decays:{strength:1,agility:1}}};
const quote=(bonusMs=0,progressMs=0)=>quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000,bonusMs,progressMs});
const training={kind:'training',name:'Training',score:.001,time:30000,rates};
test('whole cycles reject fractions, include valid progress and cap rewards at engine ticks',()=>{
 assert.equal(count(30000,15,15).count,0);assert.equal(count(30000,15,15,{progressMs:15000}).count,1);
 assert.equal(count(30000,30,149).count,4);assert.equal(count(30000,30,150).count,5);
 assert.equal(count(100,30,150).count,30);assert.equal(count(100,0.5,2.5).count,0);
 assert.equal(count(10000,30,30,{duty:.5}).count,1);assert.equal(count(10000,30,30,{duty:.5}).cycleMs,20000);
});
test('completion counts match an independent constant-clock engine replay',()=>{
 for(const time of [100,1000,1500,11000,30000,31000])for(const seconds of [1,5,15,30])for(const work of [1,3,5]){
  let elapsed=0,completed=0;
  for(let tick=0;tick<seconds;tick++){elapsed+=work*1000;if(elapsed>=time){completed++;elapsed-=time;}}
  assert.equal(count(time,seconds,work*seconds).count,completed,JSON.stringify({time,seconds,work}));
 }
});
test('invalid action clocks and progress never authorize a completion quote',()=>{
 for(const args of [[0,30,30],[-1,30,30],[NaN,30,30],[30000,0,0],[30000,31,31],[30000,30,29],[30000,30,151]])assert.equal(count(...args),null);
 for(const patch of [{duty:0},{duty:1.1},{progressMs:-1},{progressMs:30001},{progressMs:NaN}])assert.equal(count(30000,30,30,patch),null);
});
test('only current General Training can contribute progress and optional failures discard it',()=>{
 const api={getCurrentAction:()=>({type:'General',name:'Training'}),getActionCurrentTime:()=>20000};assert.equal(progress(api,30000),20000);
 for(const action of [null,{type:'Contracts',name:'Training'},{type:'General',name:'Field Analysis'}]){api.getCurrentAction=()=>action;assert.equal(progress(api,30000),0);}
 api.getCurrentAction=()=>({type:'General',name:'Training'});
 for(const invalid of [NaN,Infinity,-1,30001]){api.getActionCurrentTime=()=>invalid;assert.equal(progress(api,30000),0);}
 api.getActionCurrentTime=()=>{throw Error('Unavailable');};assert.equal(progress(api,30000),0);
});
test('incomplete Training cannot grant XP, agility capacity or permanent capacity',()=>{
 const before=JSON.stringify(training),empty=value(training,training,quote(),15),finishing=value(training,training,quote(0,15000),15);
 assert.equal(empty.score,0);assert.equal(empty.completion.count,0);assert.equal(empty.stamina.nativeCapacity,0);assert.equal(empty.stamina.bonusCapacity,0);
 assert.equal(finishing.completion.count,1);assert.equal(finishing.stamina.bonusCapacity,.04);assert.ok(finishing.score>0);assert.equal(finishing.rates,rates);assert.equal(JSON.stringify(training),before);
});
test('mission completion rewards retain original duty after regeneration repricing',()=>{
 const recovery={combatMs:10000,otherMs:2000,recoveryMs:10000,cost:54,passive:2,hrc:1};
 const mission={kind:'mission',name:'Tracking',time:10000,duty:10/22,recovery,rates:{...rates,agility:100},score:.002};
 const result=value(mission,training,quote(121000),30);
 assert.ok(result.regeneration.factor>1);assert.ok(result.completion.count>0);
 const expected=mission.score*(mission.time/mission.duty)*result.completion.count/30000;
 assert.ok(Math.abs(result.score-expected)<1e-12);assert.equal(result.rates,mission.rates);
 const short=value({...mission,time:40000,duty:1,recovery:null},training,quote(),30);assert.equal(short.score,0);
});
test('external comparison uses whole native completions and keeps gym work continuous',()=>{
 const candidate={kind:'gym',name:'strength',time:30000,costPerSecond:0,score:.004,rates};
 const opts={baselineScore:.001,remainingMs:15000,quotaLeft:1,money:1e9,reserve:0,stamina:quote(),nativeRates:rates};
 const fresh=choosePlayerCombatTraining([candidate],opts),ongoing=choosePlayerCombatTraining([candidate],{...opts,stamina:quote(0,15000)});
 assert.equal(fresh.nativeCompletion.count,0);assert.equal(fresh.baselineGain,0);assert.equal(fresh.stamina.bonusCapacity,0);
 assert.ok(ongoing);assert.equal(ongoing.nativeCompletion.count,1);assert.equal(ongoing.projectedGain,fresh.projectedGain);assert.ok(ongoing.baselineGain>0);
});
test('integer stamina completion input rejects corrupt counts and overrides fluid credit',()=>{
 const args={nativeRates:{agility:0},rates:{agility:0},seconds:15,baselineGain:0,projectedGain:0};
 assert.equal(playerTrainingStaminaPayoff(quote(),{...args,nativeCompletions:0}).stamina.bonusCapacity,0);
 for(const n of [-1,.5,NaN,Infinity])assert.equal(playerTrainingStaminaPayoff(quote(),{...args,nativeCompletions:n}),null);
 for(const progressMs of [-1,30001,NaN])assert.equal(quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000,progressMs}),null);
});
test('generated evaluators are self-contained and probes do not borrow active Training progress',()=>{
 const api={getActionTime:()=>30000,getSkillLevel:()=>0,getStamina:()=>[100,100],getBonusTime:()=>0,getCurrentAction:()=>({type:'General',name:'Training'}),getActionCurrentTime:()=>29999};
 const factory=vm.runInNewContext(bladeburnerStaminaGrowthSource),raw={trainingAllowed:true,trainingTime:30000};
 const short=factory(api,context,0,bladeburnerGrowthChoice,15)([],context,raw),whole=factory(api,context,0,bladeburnerGrowthChoice,30)([],context,raw);
 assert.equal(short.score,0);assert.equal(short.completion.count,0);assert.equal(whole.completion.count,1);assert.ok(whole.score>0);
 api.getBonusTime=()=>120000;const accelerated=factory(api,context,0,bladeburnerGrowthChoice,30)([],context,raw);assert.equal(accelerated.completion.count,4);assert.equal(accelerated.stamina.bonusCapacity,.16);
 assert.equal(clock(30,120000).workSeconds,149);
});
