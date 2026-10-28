import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planSleeveAugPurchase,sleeveRecoveryForecast} from '../sleeve-development-policy.js';
const sleeve={shock:0,sync:100,skills:{strength:10},exp:{strength:10},mults:{strength_exp:1}};
const offers=Array.from({length:16},(_,i)=>({name:'XP '+i,cost:i+1,stats:{strength_exp:1.1+i*.037}}));
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:100}};
const input={sleeve,offers,budget:100,crimes,objective:'xp',nodeMultiplier:1,horizon:899,minBatch:1};
test('resumed bundle search matches a full search without repeating projections',()=>{
 const state={};let calls=0,baselineCalls=0,quota=2,result;
 const forecast=(s,stats,t,reset)=>{calls++;if(!reset)baselineCalls++;quota--;return reset?100*(stats.strength_exp??1):10;};
 for(let pass=0;pass<100;pass++){
  quota=2;result=planSleeveAugPurchase({...input,workForecast:forecast,resumeState:state,canEvaluate:()=>quota>0});
  if(!result.search?.timeLimited)break;
 }
 assert.equal(result.search.timeLimited,false);assert.equal(baselineCalls,1);
 assert.equal(calls,result.search.projections+1);assert.ok(state.done);assert.ok(state.seen.size<=64);
 const full=planSleeveAugPurchase({...input,workForecast:(s,stats,t,reset)=>reset?100*(stats.strength_exp??1):10});
 assert.deepEqual(result.names,full.names);assert.equal(result.cost,full.cost);assert.equal(result.output,full.output);
});
test('changed forecast inputs reset the continuation rather than reuse stale projected output',()=>{
 const state={};let baselineCalls=0;
 const forecast=(s,stats,t,reset)=>{if(!reset)baselineCalls++;return reset?100*(stats.strength_exp??1):10;};
 planSleeveAugPurchase({...input,workForecast:forecast,resumeState:state});
 const key=state.fingerprint;
 planSleeveAugPurchase({...input,budget:50,workForecast:forecast,resumeState:state});
 assert.equal(baselineCalls,2);assert.notEqual(state.fingerprint,key);
 planSleeveAugPurchase({...input,budget:50,sleeve:{...sleeve,exp:{strength:20}},workForecast:forecast,resumeState:state});
 assert.equal(baselineCalls,3);
 planSleeveAugPurchase({...input,budget:50,workForecast:()=>100,resumeState:state});assert.equal(state.hasBaseline,true);
});
test('cached recovery keeps incomplete searches separate and resumes them to completion',()=>{
 const cache=new Map(),searches=new Map(),stats={};let result;
 for(let pass=0;pass<160;pass++){
  let checks=0;
  result=sleeveRecoveryForecast({...input,canEvaluate:()=>++checks<4},{cache,searches,stats,scope:'node/aug',now:100+pass});
  if(cache.size)break;
  assert.ok(result.search.timeLimited);assert.equal(searches.size,1);
 }
 assert.equal(cache.size,1);assert.equal(searches.size,0);assert.ok(stats.resumed>0);assert.equal(result.search.timeLimited,false);
 const hit=sleeveRecoveryForecast({...input,canEvaluate:()=>false},{cache,searches,scope:'node/aug',now:500});
 assert.deepEqual(hit.names,result.names);
});
test('search continuations have bounded storage and expire without extending their initial timestamp',()=>{
 const cache=new Map(),searches=new Map();
 for(let i=0;i<24;i++){
  let checks=0;
  sleeveRecoveryForecast({...input,canEvaluate:()=>++checks<4},{cache,searches,scope:i,now:100});
 }
 assert.equal(searches.size,16);
 const last=[...searches.values()][15];assert.equal(last.at,100);
 sleeveRecoveryForecast({...input,canEvaluate:()=>false},{cache,searches,scope:'new',now:10100});
 assert.equal(searches.size,0);
});
test('native gang update coordination accepts unchanged snapshots and has no polling loop',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function waitForGameUpdate('),end=source.indexOf('\n/**',start),body=source.slice(start,end);
 assert.doesNotMatch(body,/while\s*\(|ns.sleep|JSON.stringify/);
 const build=Function('myGangMembers','assignedTasks','getNsDataThroughFile','return ('+body+');');
 let resolveUpdate,reads=0,updates=0;
 const info={power:1,moneyGainRate:0,respectGainRate:0,wantedLevelGainRate:0};
 const wait=build(['A'],{A:'Work'},async()=>{reads++;return info;});
 const waiting=wait({gang:{nextUpdate:()=>{updates++;return new Promise(resolve=>resolveUpdate=resolve);}}},info);
 assert.equal(updates,1);assert.equal(reads,0);resolveUpdate(2000);
 assert.deepEqual(await waiting,{...info,updateObserved:true,updateCycles:10});assert.equal(reads,1);
});
test('unavailable gang update access defers observed-rate validation safely',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,''),start=source.indexOf('async function waitForGameUpdate('),end=source.indexOf('\n/**',start);
 const build=Function('myGangMembers','assignedTasks','getNsDataThroughFile','return ('+source.slice(start,end)+');');
 const info={power:1};
 for(const ns of [{},{gang:{}},{gang:{nextUpdate:async()=>{throw Error('Source File unavailable');}}}]){
  const wait=build(['A'],{A:'Work'},async()=>info);assert.deepEqual(await wait(ns,info),{...info,updateObserved:false});
 }
 const failed=build(['A'],{A:'Work'},async()=>{throw Error('API unavailable');});
 assert.deepEqual(await failed({gang:{}},info),{...info,updateObserved:false});
 const training=build(['A'],{A:'Train Combat'},async()=>{throw Error('No read expected');});
 assert.deepEqual(await training({},info),{...info,updateObserved:false});
 assert.match(source,/myGangInfo.updateObserved!==false&&myGangInfo.wantedLevelGainRate/);
 assert.match(source,/if\(myGangInfo.updateObserved===false\)return/);
});
