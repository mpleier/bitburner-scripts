import test from 'node:test';
import assert from 'node:assert/strict';
import {darknetEconomics,recurringPlayerIncome} from '../darknet-economics-policy.js';
const start=10000000;
function run({rate=1,playerRate=1000,duration=180000,step=30000,evidence={},cache=0,context={}}={}) {
 let state;
 for(let t=0;t<=duration;t+=step)state=darknetEconomics(state,1000+rate*t/1000,cache>start+t?0:cache,42,start+t,evidence,
  {ready:true,mode:'stalled',playerIncome:10000+playerRate*t/1000,augReset:7,...context});
 return state;
}
test('bounded initial refresh works without three historical refreshes',()=>{
 const s=run();assert.equal(s.allow,true);assert.equal(s.trial,true);assert.equal(s.allowLowIncome,true);
 assert.equal(s.playerMoneyPerSecond,1000);assert.equal(s.estimatedLostIncome,330);
 assert.equal(run({duration:150000}).allow,false);
 assert.equal(run({rate:11}).allow,false); // More than one percent of recurring income.
 assert.equal(run({playerRate:0}).allow,false);
 assert.equal(run({context:{playerIncome:null}}).allow,false);
 assert.equal(run({context:{ready:false}}).allow,false);
 assert.equal(run({context:{mode:'unknown'}}).allow,false);
 assert.equal(run({evidence:{suspended:true}}).allow,false);
});
test('rebuild cost bounds trials and tiny historical payouts do not veto them',()=>{
 assert.equal(run({cache:start+170000}).allow,true);
 assert.equal(run({rate:100,cache:start+170000}).allow,false);
 assert.equal(run({rate:10,evidence:{measuredRebuild:true,rebuildMs:1500000}}).allow,true);
 assert.equal(run({rate:10,playerRate:1000,evidence:{measuredRebuild:true,rebuildMs:3100000}}).estimatedRebuildMs,330000);
 // Long measured rebuilds are not eligible for a speculative thirty-minute trial.
 assert.equal(run({rate:10,evidence:{measuredRebuild:true,rebuildMs:2250000}}).estimatedLostIncome,22500);
 assert.equal(run({rate:10,evidence:{measuredRebuild:true,rebuildMs:2250000}}).allow,false);
 assert.equal(run({rate:10,evidence:{measuredRebuild:true,rebuildMs:2250000},playerRate:800}).allow,false);
});
test('cleared empty networks qualify after thirty seconds, stalled ones after three minutes',()=>{
 assert.equal(run({rate:0,duration:30000,context:{mode:'cleared'}}).allow,true);
 assert.equal(run({rate:0,duration:0,context:{mode:'cleared'}}).allow,false);
 assert.equal(run({rate:0,duration:150000}).allow,false);
 assert.equal(run({rate:0}).allow,true);
 assert.equal(run({rate:0,cache:start+100000}).allow,false);
});
test('recurring income excludes casino, stock and total double counting',()=>{
 assert.equal(recurringPlayerIncome({hacking:100,gang:20,darknet:1,casino:1e12,stock:1e12,total:2e12,other:1e12}),121);
 for(const v of [NaN,Infinity,-1,'1'])assert.equal(recurringPlayerIncome({hacking:v}),null);
 assert.equal(recurringPlayerIncome(null),null);
});
test('aug resets, gaps, reversed income and invalid cache clocks require new observations',()=>{
 const s=run();
 for(const patch of [{augReset:8},{playerIncome:1}])assert.equal(darknetEconomics(s,1180,0,42,start+180001,{},
 {ready:true,mode:'stalled',augReset:7,playerIncome:190000,...patch}).allow,false);
 assert.equal(darknetEconomics(s,1179,0,42,start+180001,{}, {ready:true,mode:'stalled',augReset:7,playerIncome:190000}).allow,false);
 assert.equal(darknetEconomics(s,1300,0,42,start+300000,{}, {ready:true,mode:'stalled',augReset:7,playerIncome:310000}).allow,false);
 for(const cache of [NaN,Infinity,-1,start+400000])assert.equal(darknetEconomics(s,1180,cache,42,start+180001).allow,false);
});
test('rapid polling preserves bounded six-minute coverage and remains comparable to ordinary cadence',()=>{
 const rapid=run({duration:600000,step:1000}),normal=run({duration:600000});
 assert.equal(rapid.allow,normal.allow);assert.equal(rapid.moneyPerSecond,normal.moneyPerSecond);
 assert.ok(rapid.samples.length<=32);assert.ok(rapid.at-rapid.samples[0].at>=360000);
});
