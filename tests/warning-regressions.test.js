import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {overviewIncomeRate,overviewStaminaText} from '../stats.js';
import {adaptiveHgwTiming} from '../progression-improvements-policy.js';

const stats=await readFile(new URL('../stats.js',import.meta.url),'utf8');
const hashes=await readFile(new URL('../spend-hacknet-hashes.js',import.meta.url),'utf8');

test('overview missing or partial stamina never indexes undefined data',()=>{
 for(const value of [undefined,null,{},[],[5],[NaN,10],[5,0],[-1,10],[5,Infinity]])
  assert.equal(overviewStaminaText(value),'Stamina unavailable');
 assert.equal(overviewStaminaText([5,10]),'Stamina 50.0%');
 assert.equal(overviewStaminaText([15,10]),'Stamina 100.0%');
 assert.ok(stats.includes("bb?overviewStaminaText(bb.stamina):''"));
});

test('overview income accepts native tuples and rejects missing or nonfinite data',()=>{
 assert.equal(overviewIncomeRate([123,456]),123);assert.equal(overviewIncomeRate([0,10]),0);
 assert.equal(overviewIncomeRate(123),123);
 for(const value of [undefined,null,[],{},[Infinity],['12']])assert.equal(overviewIncomeRate(value),null);
 assert.ok(!stats.includes('totalScriptInc[0]'));
});

test('optional overview reads validate numeric tuples and preserve null fallbacks',async()=>{
 const start=stats.indexOf('async function optionalHudRead('),end=stats.indexOf('/** Read local manager',start);
 for(const value of [undefined,null,{},[1],[NaN,10]]){
  const optional=Function('getNsDataThroughFile',stats.slice(start,end)+'return optionalHudRead;')(async()=>value);
  const fallback=[0,0];assert.deepEqual(await optional({},'', '',[],fallback),fallback);
 }
 const optional=Function('getNsDataThroughFile',stats.slice(start,end)+'return optionalHudRead;')(async()=>[1,10]);
 assert.deepEqual(await optional({},'','',[],[0,0]),[1,10]);
});

const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
async function capacityAttempt(kind,approved,success){
 const start=hashes.indexOf("                // If it's cheaper to buy a new hacknet node");
 const end=hashes.indexOf(' else if (nodes > 0) {',start);
 const block=hashes.slice(start,end);
 const nativeCalls=[],logs=[],reports=[];
 const ns={hacknet:{purchaseNode:()=>{nativeCalls.push('node');return success?0:-1;},upgradeCache:()=>{nativeCalls.push('cache');return success;}}};
 const run=AsyncFunction('ns','claimSpending','report','log','kind',
  "const choice={kind},nextNodeCost=kind==='node'?10:Infinity,nextCacheUpgradeCost=kind==='cache'?10:Infinity,lowestIndex=0,spendableMoney=100,nodes=1,capacityBudget=100,toBuy=['Goal'],formatMoney=String; for(let once=0;once<1;once++){"+block+'}');
 await run(ns,()=>approved,async(state,detail)=>reports.push({state,detail}),(_ns,text)=>logs.push(text),kind);
 return {nativeCalls,logs,reports};
}

test('capacity cash-budget denials do not attempt native purchases or raise failure warnings',async()=>{
 for(const kind of ['node','cache']){
  const r=await capacityAttempt(kind,false,false);
  assert.deepEqual(r.nativeCalls,[]);assert.deepEqual(r.logs,[]);
  assert.equal(r.reports[0].state,'saving');assert.match(r.reports[0].detail.reason,/shared cash budget/);
 }
});

test('capacity native failures remain warnings after budget approval; successes stay visible',async()=>{
 for(const kind of ['node','cache']){
  const fail=await capacityAttempt(kind,true,false);assert.deepEqual(fail.nativeCalls,[kind]);
  assert.match(fail.logs[0],/WARNING:.*native purchase failed after budget approval/);
  const success=await capacityAttempt(kind,true,true);assert.match(success.logs[0],/SUCCESS:/);
 }
});

test('capacity messages describe the route priority cost and budget deferrals publish savings status',()=>{
 assert.ok(hashes.includes('formatHashes(requestedCost)'));
 assert.ok(hashes.includes("More capacity is needed for this goal"));
 assert.ok(hashes.includes("await report('saving',{reason:message,capacityBudget"));
 assert.ok(!hashes.includes('failed for an unknown reason'));
});

const sample=(at,operations,risks,extras={})=>({at,augReset:1,nodeReset:2,counts:{operations,deadlineOverruns:risks,spacingSamples:operations,spacingRisks:risks},...extras});
test('three consecutive sparse spacing risks trigger bounded backoff after thirty seconds',()=>{
 let state=adaptiveHgwTiming(null,sample(100000,0,0),{now:100000});
 state=adaptiveHgwTiming(state,sample(130000,3,3),{now:130000});
 assert.equal(state.multiplier,1.5);assert.equal(state.windowOperations,3);
 const next=adaptiveHgwTiming(state,sample(160000,6,6),{now:160000});
 assert.equal(next.multiplier,1.5); // Preserve the one-minute adjustment cooldown.
});

test('sparse timing changes require complete risky spacing evidence and fresh telemetry',()=>{
 const initial=adaptiveHgwTiming(null,sample(100000,0,0),{now:100000});
 for(const telemetry of [sample(130000,3,1),sample(130000,2,2),sample(130000,3,3,{blocked:true}),sample(100000,3,3),{at:130000,augReset:1,nodeReset:2,counts:{operations:3,deadlineOverruns:3}}])
  assert.equal(adaptiveHgwTiming(initial,telemetry,{now:130000}).multiplier,1);
 assert.equal(adaptiveHgwTiming(initial,sample(120000,3,3),{now:120000}).multiplier,1);
});
