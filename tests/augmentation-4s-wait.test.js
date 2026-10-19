import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {augmentationFourSigmaWait as decide} from '../progression-speed-policy.js';
import {augmentationCountCandidates} from '../faction-policy.js';
import {fallbackBitNodeMultipliers} from '../bitnode-fallbacks.js';
const minute=60000,now=1000000,reset={lastNodeReset:1,lastAugReset:2};
const input=(extra={})=>({route:'hacking',reset,now,worth:95e9,cost:100e9,threshold:.9,stockPid:7,
 stock:{pid:7,at:now,nodeReset:1,augReset:2,reserve:10e9,fourSigmaFunding:{enabled:true,budgetFraction:.6}},
 income:{at:now,augReset:2,cashRate:1e9,cashObservation:{schemaVersion:1,augReset:2,mode:'sources-v1',samples:[{at:now-30000,rate:1e9},{at:now,rate:1e9}]}},...extra});
test('Daedalus candidate planning uses multipliers loaded before the first count decision',()=>{
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('bitNodeMults = await tryGetBitNodeMultipliers(ns)')<source.indexOf('const needed=bitNodeMults.DaedalusAugsRequirement'));
 assert.equal(source.split('bitNodeMults = await tryGetBitNodeMultipliers(ns)').length,2);
 const owned=Array.from({length:30},(_,i)=>'Owned '+i),offers=Array.from({length:8},(_,i)=>({name:'New '+i,price:1,rep:1,available:true,prereqs:[]}));
 assert.equal(augmentationCountCandidates(offers,owned,fallbackBitNodeMultipliers(7).DaedalusAugsRequirement,1000).length,5);
 assert.equal(augmentationCountCandidates(offers,owned,fallbackBitNodeMultipliers(1).DaedalusAugsRequirement,1000).length,0);
});
test('4S wait uses stock purchase budget and reserves, not just the advertised price',()=>{
 const result=decide(input());assert.equal(result.wait,true);assert.equal(result.target,110e9/.6);assert.equal(result.etaMs,(result.target-95e9)/1e9*1000);assert.equal(result.deadline,now+15*minute);
});
test('Bladeburner and unknown routes never defer installs for 4S',()=>{
 for(const route of ['bladeburner',null,'unknown'])assert.equal(decide(input({route})).wait,false);
});
test('disabled, stale, paused, foreign-reset or wrong-owner stocks cannot hold an install',()=>{
 for(const change of [{at:now-60001},{at:now+1},{pid:8},{nodeReset:3},{augReset:3},{fourSigmaFunding:{enabled:false,budgetFraction:.6}},{reserve:NaN},{fourSigmaFunding:{enabled:true,budgetFraction:0}}])
  assert.equal(decide(input({stock:{...input().stock,...change}})).wait,false);
 assert.equal(decide(input({stockPid:0})).wait,false);
});
test('unfunded 4S needs fresh confirmed recurring income, not a stock-price spike',()=>{
 for(const income of [null,{...input().income,cashRate:0},{...input().income,at:now+1},{...input().income,at:now-120001},{...input().income,augReset:3},
  {...input().income,cashObservation:{...input().income.cashObservation,mode:'legacy-worth-v1'}},
  {...input().income,cashObservation:{...input().income.cashObservation,samples:[{at:now,rate:1e9}]}}])assert.equal(decide(input({income})).wait,false);
});
test('already fundable 4S permits a bounded purchase window without income evidence',()=>{
 const result=decide(input({worth:200e9,income:null}));assert.equal(result.wait,true);assert.equal(result.etaMs,0);
});
test('proximity threshold and zero threshold cannot bypass funding or deadlines',()=>{
 assert.equal(decide(input({worth:50e9})).wait,false);assert.equal(decide(input({worth:50e9,threshold:0})).wait,true);
 assert.equal(decide(input({threshold:0,income:null})).wait,false);
});
test('long funding times do not block an otherwise useful install',()=>{
 assert.equal(decide(input({income:{...input().income,cashRate:1}})).wait,false);
 assert.equal(decide(input({paybackMs:minute})).wait,false);
 assert.equal(decide(input({remainingMs:minute})).wait,false);
});
test('reloads and changed prices cannot extend the shared deadline',()=>{
 const first=decide(input()),later=now+minute;
 const next=decide(input({now:later,cost:90e9,stock:{...input().stock,at:later},window:first.window}));
 assert.equal(next.wait,true);assert.equal(next.deadline,first.deadline);assert.equal(next.window.startedAt,now);
});
test('expiration and changed funding ETA fail open for installation',()=>{
 const first=decide(input());assert.equal(decide(input({now:first.deadline,worth:200e9,stock:{...input().stock,at:first.deadline},window:first.window})).wait,false);
 const window={...first.window,expiresAt:now+1000};assert.equal(decide(input({window})).wait,false);
});
test('a saved window belongs only to its original resets and cannot be future dated',()=>{
 const first=decide(input());assert.equal(decide(input({window:{...first.window,startedAt:now+1}})).wait,false);
 const next=decide(input({window:{...first.window,augReset:0,startedAt:100}}));assert.equal(next.window.startedAt,now);
});
test('actual autopilot bypasses the 4S hold on Bladeburner and saves a deadline on hacking',async()=>{
 const text=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=text.indexOf('        // Are we close to being able to afford 4S TIX data?'),end=text.indexOf('        if (resetInfo.currentNode == 8)',start);
 const writes=[],ctx={augmentationFourSigmaWait:decide,have4STixApi:false,have4SData:true,priorityAugmentationReady:()=>false,achievementActionAllowed:()=>true,
 facmanOutput:{},options:{'wait-for-4s-threshold':.9},resetInfo:reset,bitNodeMults:{FourSigmaMarketDataApiCost:4},routePlan:{selected:'bladeburner',routes:{}},speedObservation:input().income,speed:{paybackMs:2*60*minute},
 isScriptPaused:()=>false,getStocksValue:async()=>0,getNsDataThroughFile:async()=>false,formatDuration:String,setStatus(){},Date:class extends Date{static now(){return now;}}};
 const ns={pid:4,read:f=>f.includes('stock-status')?JSON.stringify(input().stock):'',ps:()=>[{pid:7,filename:'stockmaster.js'}],write:async(f,s)=>writes.push({f,value:JSON.parse(s)})};
 vm.runInNewContext('globalThis.run=async(ns,player)=>{'+text.slice(start,end)+'return false;}',ctx);
 assert.equal(await ctx.run(ns,{money:95e9}),false);assert.equal(writes.length,0);
 ctx.routePlan.selected='hacking';assert.equal(await ctx.run(ns,{money:95e9}),true);assert.equal(writes[0].value.expiresAt,now+15*minute);assert.equal(writes[0].value.active,true);
});
test('stockmaster publishes the effective budget used by its native purchase path',()=>{
 const source=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');assert.ok(source.includes("budgetFraction:options['buy-4s-budget']-fracH"));
 assert.ok(source.includes("corpus * (options['buy-4s-budget'] - fracH) - reserve"));assert.ok(source.includes('nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,fourSigmaFunding'));
});

test('malformed saved income samples and zero reset payback cannot create a wait',()=>{
 for(const samples of [[null,null],[{},{}],[{at:now,rate:1e9},{at:now,rate:1e9}]]){
  const income={...input().income,cashObservation:{...input().income.cashObservation,samples}};
  assert.equal(decide(input({income})).wait,false);
 }
 assert.equal(decide(input({paybackMs:0,worth:200e9})).wait,false);
});
