import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {progressionSpeed,stabilizeAugmentationIncome,estimateMixedAugmentationWait} from '../progression-speed-policy.js';

const fields=['hacking','hacknet','gang','sleeves','work','crime','corporation','bladeburner'];
const sources=(extra={})=>({...Object.fromEntries(fields.map(key=>[key,0])),stock:0,casino:0,codingcontract:0,infiltration:0,other:0,...extra});
const start=100000;
function step(seconds,counters,previous,{worth=1000,augReset=1,income,targets=[],reputation={A:1000}}={}){
 const at=start+seconds*1000;
 const snapshot={at,augReset,worth,income:income===undefined?{at,sources:counters}:income,ready:[],targets,reputation,resetEconomics:{known:true,replacementCost:0}};
 return progressionSpeed({snapshot,previous,now:at,augReset,homeRam:128});
}
function steady(){
 let p=step(0,sources()).observation;
 p=step(31,sources({hacking:310}),p).observation;
 return step(62,sources({hacking:620}),p).observation;
}

test('recurring income requires two comparable intervals and leaves reputation measurement intact',()=>{
 let p=step(0,sources()).observation;
 p=step(31,sources({hacking:310}),p).observation;
 assert.equal(p.cashRate,0);assert.equal(p.cashObservation.samples.length,1);
 p=step(62,sources({hacking:620}),p).observation;
 assert.equal(p.cashRate,10);assert.equal(p.cashRateBasis,'Stable recurring income');
 assert.equal(p.cashObservation.samples.length,2);
});

test('stock valuations and common windfall categories cannot inflate recurring cash forecasts',()=>{
 let p=step(0,sources()).observation;
 for(const seconds of [31,62,93]){
  p=step(seconds,sources({hacking:seconds*10,stock:seconds*1e9,casino:1e10,codingcontract:5e9,infiltration:8e9,other:9e9}),p,
   {worth:1e12+seconds*1e10}).observation;
 }
 assert.equal(p.cashRate,10);
 assert.ok(p.cashObservation.samples.every(sample=>sample.rate===10));
});

test('a cold-start corporation windfall is not treated as a confirmed recurring income stream',()=>{
 let p=step(0,sources()).observation;
 p=step(31,sources({hacking:310,corporation:3e9}),p).observation;assert.equal(p.cashRate,0);
 p=step(62,sources({hacking:620,corporation:3e9}),p).observation;assert.equal(p.cashRate,10);
});

test('mature forecasts reject isolated spikes and respond immediately to a low income interval',()=>{
 let p=steady();
 p=step(93,sources({hacking:930,corporation:9e9}),p).observation;assert.equal(p.cashRate,10);
 p=step(124,sources({hacking:1240,corporation:9e9}),p).observation;assert.equal(p.cashRate,10);
 p=step(155,sources({hacking:1240,corporation:9e9}),p).observation;assert.equal(p.cashRate,0);
});

test('sustained growth eventually increases the estimate and history remains bounded',()=>{
 let p=steady(),hacking=620;
 for(const seconds of [93,124,155,186,217,248]){
  hacking+=3100;p=step(seconds,sources({hacking}),p).observation;
  if(seconds<=124)assert.equal(p.cashRate,10);
 }
 assert.equal(p.cashRate,100);assert.equal(p.cashObservation.samples.length,5);
});

test('frequent and duplicate snapshots preserve counter baselines without counting an interval twice',()=>{
 let p;
 for(let seconds=0;seconds<=60;seconds+=5)p=step(seconds,sources({hacking:seconds*10}),p).observation;
 assert.equal(p.cashRate,10);assert.equal(p.cashObservation.samples.length,2);
 const before=JSON.stringify(p.cashObservation.samples);
 for(let i=0;i<10;i++)p=step(60,sources({hacking:600}),p).observation;
 assert.equal(JSON.stringify(p.cashObservation.samples),before);
 assert.equal(p.rateBaseline.income.at,start+60000);
});

test('unavailable source counters clear the forecast instead of reverting to volatile net worth',()=>{
 const old=steady();
 const missing=step(93,sources(),old,{worth:1e15,income:null}).observation;
 assert.equal(missing.cashRate,0);assert.equal(missing.cashObservation.samples.length,0);
 assert.match(missing.cashRateBasis,/unavailable/);
 const recovered=step(124,sources({hacking:1240}),missing).observation;
 assert.equal(recovered.cashRate,0);
});

test('malformed, future or stale source records cannot preserve a previous optimistic forecast',()=>{
 const old=steady(),at=start+93000;
 for(const income of [{at:at+1,sources:sources()},{at:at-30001,sources:sources()},
  {at,sources:sources({hacking:NaN})},{at,sources:{}},{}]){
  const result=step(93,sources(),old,{income}).observation;
  assert.equal(result.cashRate,0);assert.equal(result.cashObservation.samples.length,0);
 }
});

test('reset changes, long gaps and reversed timestamps cannot carry income evidence forward',()=>{
 const old=steady();
 for(const options of [{seconds:93,augReset:2},{seconds:400,augReset:1},{seconds:0,augReset:1}]){
  const p=step(options.seconds,sources({hacking:1e10}),old,{augReset:options.augReset}).observation;
  assert.equal(p.cashRate,0);assert.equal(p.cashObservation.samples.length,0);
 }
});

test('a windfall remains spendable but does not imply that the next augmentation can be earned instantly',()=>{
 const worth=1e12,result=step(93,sources({hacking:930,casino:1e10}),steady(),{worth,
  targets:[{name:'Next',cost:worth+1000,rep:1000,factions:['A'],stats:{hacking:2}}]});
 assert.equal(result.observation.cashRate,10);assert.equal(result.next.eta,100000);
 const funded=step(93,sources({hacking:930,casino:1e10}),steady(),{worth,
  targets:[{name:'Funded',cost:worth,rep:1000,factions:['A'],stats:{hacking:2}}]});
 assert.equal(funded.next.eta,0);
});

test('legacy net-worth observations migrate separately and cannot contaminate source-based estimates',()=>{
 const at=start+62000,legacy=progressionSpeed({snapshot:{at,augReset:1,worth:1e15,ready:[],targets:[]},now:at,augReset:1,
  previous:{at:at-31000,augReset:1,worth:0},homeRam:128}).observation;
 assert.ok(legacy.cashRate>0);
 const current=step(93,sources({hacking:930}),legacy).observation;
 assert.equal(current.cashRate,0);assert.equal(current.cashObservation.mode,'sources-v1');
});

test('producer supplies optional native money-source counters and observations retain them between short polls',()=>{
 const producer=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(producer.includes('ns.getMoneySources().sinceInstall'));
 assert.ok(producer.includes('let income=null;'));assert.ok(producer.includes('const speedSnapshot={income,resetEconomics'));
 const p=steady();assert.equal(p.rateBaseline.income.sources.hacking,620);
 assert.equal(stabilizeAugmentationIncome({snapshot:{at:200000,income:null},augReset:1}).rate,0);
});


test('source forecasts separate interrupted job and crime earnings from income retained during faction work',()=>{
 let p;
 for(const seconds of [0,31,62])p=step(seconds,sources({work:seconds*70,crime:seconds*20,hacking:seconds*5,gang:seconds*3,sleeves:seconds*2}),p).observation;
 assert.equal(p.cashRate,100);assert.equal(p.cashRateDuringFactionWork,10);
 assert.ok(p.cashObservation.samples.every(sample=>sample.factionRate===10));
});

const need=(rep,donation)=>({rep,factions:['A'],providers:[{faction:'A',requiredDonation:donation}]});
const funding=extra=>estimateMixedAugmentationWait({requirements:[need(10,null)],cost:200,worth:100,
 cashRate:100,factionCashRate:1,reputation:{A:0},repRates:{A:1},...extra});

test('work-containing funding estimates use surviving income rather than interrupted player earnings',()=>{
 const plan=funding({});
 assert.equal(plan.seconds,100);assert.equal(plan.cashSeconds,100);assert.equal(plan.reputationSeconds,10);
 assert.equal(plan.cashRateDuringWork,1);assert.deepEqual(plan.workTargets,{A:10});
 assert.equal(funding({factionCashRate:0}),null);
});

test('cash-only saving and donations retain current job income without forcing a work switch',()=>{
 const funded=funding({reputation:{A:100},factionCashRate:0});
 assert.equal(funded.seconds,1);assert.deepEqual(funded.workTargets,{});
 const donate=funding({requirements:[need(100,100)],factionCashRate:0});
 assert.equal(donate.seconds,2);assert.equal(donate.donationCost,100);assert.deepEqual(donate.workTargets,{});
});

test('already banked cash permits faction work even with no surviving income',()=>{
 const plan=funding({worth:200,cashRate:100,factionCashRate:0});
 assert.equal(plan.seconds,10);assert.equal(plan.cashSeconds,0);assert.deepEqual(plan.workTargets,{A:10});
 const noIncome=funding({worth:200,cashRate:0,factionCashRate:0});
 assert.equal(noIncome.seconds,10);
});

test('native income split affects both legacy work estimates and mixed funding wait selection',()=>{
 let p;
 for(const seconds of [0,31,62])p=step(seconds,sources({hacking:seconds,work:seconds*99}),p,{reputation:{A:seconds}}).observation;
 const counters=sources({hacking:93,work:93*99});
 const target={name:'Target',cost:1100,rep:103,factions:['A'],stats:{hacking:2}};
 const legacy=step(93,counters,p,{reputation:{A:93},targets:[target]});
 assert.equal(legacy.observation.cashRate,100);assert.equal(legacy.observation.cashRateDuringFactionWork,1);
 assert.equal(legacy.next.eta,100000);
 const mixed=step(93,counters,p,{reputation:{A:93},targets:[{...target,requirements:[need(103,null)]}]});
 assert.equal(mixed.next.eta,100000);assert.equal(mixed.next.funding.cashRateDuringWork,1);
 const cashOnly=step(93,counters,p,{reputation:{A:93},targets:[{...target,rep:93}]});
 assert.equal(cashOnly.next.eta,1000);
});

test('old income histories cannot invent a surviving activity-independent rate during migration',()=>{
 let p=steady();
 p={...p,cashObservation:{...p.cashObservation,samples:p.cashObservation.samples.map(({at,rate})=>({at,rate}))}};
 p=step(93,sources({hacking:930}),p).observation;
 assert.equal(p.cashRate,10);assert.equal(p.cashRateDuringFactionWork,0);
 p=step(124,sources({hacking:1240}),p).observation;
 assert.equal(p.cashRateDuringFactionWork,10);
});

test('invalid faction-work income rates fail safely and higher rates cannot exceed observed total income',()=>{
 for(const value of [null,NaN,Infinity,-1])assert.equal(funding({factionCashRate:value}),null);
 const capped=funding({factionCashRate:200});
 assert.equal(capped.cashRateDuringWork,100);assert.equal(capped.seconds,10);
});
