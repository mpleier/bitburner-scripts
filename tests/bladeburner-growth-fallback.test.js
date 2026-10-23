import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planBladeburnerGrowthFallbacks as plan} from '../bladeburner-growth-fallback-policy.js';
import {rankBladeburnerStaminaGrowth as rank,valueBladeburnerStaminaGrowth as value} from '../bladeburner-growth-stamina-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {bladeburnerGrowthClock as clock} from '../bladeburner-growth-clock-policy.js';
const keys=['strength','defense','dexterity','agility'];
const context={player:{skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{}},metadata:{baseDifficulty:100,weights:{strength:1},decays:{strength:1}}};
const quote=(bonusMs=0)=>quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000,bonusMs});
const training={kind:'training',name:'Training',time:30000,score:.00001,rates:{strength:.01,agility:0}};
const a={kind:'mission',name:'Scarce',time:1000,duty:1,supply:1,score:.01,rates:{strength:10,agility:0}};
const b={kind:'mission',name:'Available',time:1000,duty:1,supply:100,score:.001,rates:{strength:1,agility:0}};
const entries=(rows,q=quote(),seconds=30)=>rows.map(raw=>({raw,valued:value(raw,training,q,seconds)}));
test('a scarce mission followed by a safe fallback can beat repeating the best single mission',()=>{
 const q=quote(),before=JSON.stringify([a,b,q]),result=rank([a,b],training,q),choice=result.choice;
 assert.equal(choice.name,'Scarce');assert.equal(choice.kind,'mission');assert.equal(choice.singleScore,.01/30);
 assert.equal(choice.fallback.first.count,1);assert.equal(choice.fallback.second.name,'Available');assert.equal(choice.fallback.second.count,27);
 assert.equal(choice.fallback.first.seconds+choice.fallback.switchSeconds+choice.fallback.second.seconds,30);
 assert.ok(Math.abs(choice.score-(.01+.027)/30)<1e-12);assert.equal(choice.rates,a.rates);assert.equal(choice.xpScore,a.score);
 assert.equal(result.byName.Scarce,choice);assert.equal(JSON.stringify([a,b,q]),before);
});
test('a switch delay is charged and marginal combinations retain the existing single-mission choice',()=>{
 const marginal={...a,score:.002};assert.equal(rank([marginal,b],training,quote()).choice.name,'Available');
 assert.equal(rank([a,b],training,quote(),{switchSeconds:29}).choice.name,'Available');
 assert.equal(rank([a,b],training,quote(),{switchSeconds:30}).fallbackPairs,0);
});
test('the prefix and switching interval debit one finite bonus budget before the fallback',()=>{
 const first={...a,time:5000,score:.1},second={...b,time:5000},q=quote(21000),result=rank([first,second],training,q),f=result.byName.Scarce.fallback;
 assert.equal(f.first.seconds,1);assert.equal(f.bonusRemainingMs,9000);assert.equal(f.second.seconds,27);assert.equal(f.second.count,7);
 const spent=21000-f.bonusRemainingMs+clock(f.second.seconds,f.bonusRemainingMs).consumedMs;
 assert.equal(spent,clock(30,21000).consumedMs);assert.ok(f.first.count<=first.supply);assert.ok(f.second.count<=second.supply);
});
test('fallback progress starts at zero and neither exhausted nor duplicate stock can be reused',()=>{
 const first={...a,time:10000,score:.1},second={...b,time:10000,supply:1,progressMs:9999},result=rank([first,second],training,quote());
 assert.equal(result.byName.Scarce.fallback.first.seconds,10);assert.equal(result.byName.Scarce.fallback.second.seconds,18);assert.equal(result.byName.Scarce.fallback.second.count,1);
 const duplicate=plan(entries([a,{...a,score:.005}]),training,quote(),30,2,value);assert.equal(duplicate.evaluatedPairs,0);assert.deepEqual(Object.keys(duplicate.byName),[]);
 const exhausted=rank([a,{...b,supply:0}],training,quote());assert.equal(exhausted.fallbackPairs,0);
});
test('combined stamina capacity is valued once using the combined raw XP endpoint',()=>{
 const c={...context,metadata:{baseDifficulty:50000,weights:{strength:1},decays:{strength:1}}},cost=.285*(50000**.28+50000/650),maximum=cost*1.5;
 const q=quotePlayerTrainingStamina(c,{stamina:[maximum,maximum],cyber:0,time:30000}),first={...a,rates:{strength:10,agility:10}};
 const result=rank([first,b],training,q),f=result.byName.Scarce.fallback;assert.ok(f);
 const agilityXp=f.rates.agility*30,level=q.levelMult*(32*Math.log(q.xp+agilityXp+534.6)-200);
 const capacity=(Math.max(q.agility,level)**.8-q.agility**.8)*q.capacityMult;
 const start=Math.min(1,Math.max(0,2*(1-cost/maximum))),end=Math.min(1,Math.max(0,2*(1-cost/(maximum+capacity))));
 const expected=(f.xpScore*30*end+q.competence*(end-start))/30;
 assert.ok(Math.abs(result.byName.Scarce.score-expected)<1e-10);assert.ok(Math.abs(result.byName.Scarce.stamina.externalCapacity-capacity)<1e-10);
});
test('Training cannot enter a pair or bypass its ordinary selection gate',()=>{
 const result=rank([a,b],training,quote(),{trainingAllowed:false});assert.equal(result.training,null);assert.notEqual(result.choice.fallback.second.name,'Training');
 const strong={...training,score:1};assert.equal(rank([a,b],strong,quote(),{trainingAllowed:true}).choice.name,'Training');assert.notEqual(rank([a,b],strong,quote(),{trainingAllowed:false}).choice.name,'Training');
});
test('unknown optional data, coupled upkeep and unbounded stock retain ordinary ranking',()=>{
 for(const q of [null,{bonusMs:NaN}])assert.equal(rank([a,b],training,q).fallbackPairs,0);
 for(const first of [{...a,supply:undefined},{...a,supply:null},{...a,recovery:{otherMs:100}},{...a,duty:.5,recovery:null}])assert.equal(plan(entries([first,b]),training,quote(),30,2,value).evaluatedPairs,0);
 for(const delay of [0,-1,NaN,Infinity])assert.equal(plan(entries([a,b]),training,quote(),30,delay,value).evaluatedPairs,0);
});
test('candidate search is bounded without dropping stronger single-job alternatives',()=>{
 const rows=Array.from({length:40},(_,i)=>({...a,name:'M'+i,score:.01+i*.001}));let calls=0;
 const result=plan(entries(rows),training,quote(),30,2,(...args)=>{calls++;return value(...args);});assert.ok(result.evaluatedPairs<=64);assert.ok(calls<=8*30+64);assert.ok(Object.keys(result.byName).length<=8);
 const steady={...b,name:'Steady',score:100};assert.equal(rank([...rows,steady],training,quote()).choice.name,'Steady');
});
test('parent compares rank-work opportunity using the same first-action forecast and preserves execution guards',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(source,/switchSeconds:Math\.max\(1,\(options\['update-interval'\]\?\?2000\)\/1000\)/);
 assert.match(source,/valuedGrowth\.byName\?\.\[bestActionName\]\?\?valueBladeburnerStaminaGrowth/);
 assert.match(source,/if\(growthChoice\?\.kind==='training'&&!bladeburnerTrainingPayoff/);
 assert.match(source,/bestActionName=growthChoice\.name/);assert.ok(!source.includes('bestActionName=growthChoice.fallback.second'));
});
