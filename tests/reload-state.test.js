import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stockHistoryCheckpoint,restoreStockHistory,stockHistoryForecast} from '../stock-policy.js';
import {gangMaintenanceStatus} from '../gang-policy.js';
import {adaptiveBudgetSignals} from '../spending-policy.js';
const reset={lastNodeReset:10,lastAugReset:20};
const settings={minHistory:21,longWindow:51,nearWindow:10,cycleLength:75,maxHistory:151};
const stock=()=>({sym:'AAA',ask_price:102,bid_price:98,priceHistory:[100,99,98,97],lastInversion:4,lastTickProbability:.8,
 prob:1,probStdDev:0,vol:1/99,nearTermForecast:1,longTermForecast:1,ticksHeld:30,sharesLong:10,boughtPrice:90,sharesShort:0,boughtPriceShort:0});
const checkpoint=()=>stockHistoryCheckpoint([stock()],{pid:7,reset,settings,mock:false,has4s:false,lastTick:500,marketCycleDetected:true,detectedCycleTick:12,inversionAgreementThreshold:8,at:1000});
const quotes=()=>({AAA:{ask:102,bid:98,position:[10,90,0,0]}});
const restore=(saved,options={})=>restoreStockHistory(typeof saved==='string'?saved:JSON.stringify(saved),{reset,settings,mock:false,has4s:false,quotes:quotes(),pid:8,now:2000,...options});
test('stock history survives a quick reload without restoring ownership or cash',()=>{
 const p=checkpoint(),r=restore(p);assert.equal(r.reason,'restored');assert.equal(r.state.detectedCycleTick,12);
 assert.equal(r.state.stocks.AAA.ticksHeld,30);assert.deepEqual(r.state.stocks.AAA.priceHistory,[100,99,98,97]);
 assert.equal(r.state.cash,undefined);assert.equal(r.state.stocks.AAA.sharesLong,undefined);
 r.state.stocks.AAA.priceHistory.push(1);assert.equal(p.stocks.AAA.priceHistory.length,4);
});
test('checkpoint retains at most the bounded history window',()=>{
 const s={...stock(),priceHistory:Array.from({length:200},()=>100)};
 const p=stockHistoryCheckpoint([s],{pid:7,reset,settings,mock:false,has4s:false,lastTick:500,marketCycleDetected:false,detectedCycleTick:0,inversionAgreementThreshold:6,at:1000});
 assert.equal(p.stocks.AAA.priceHistory.length,151);assert.equal(s.priceHistory.length,200);
});
test('missed ticks, expiry, future timestamps and reset changes require a cold start',()=>{
 assert.equal(restore(checkpoint(),{quotes:{AAA:{...quotes().AAA,ask:103}}}).reason,'quote-changed');
 assert.equal(restore(checkpoint(),{now:16001}).reason,'expired');assert.equal(restore(checkpoint(),{now:999}).reason,'expired');
 assert.equal(restore({...checkpoint(),augReset:21}).reason,'reset-mismatch');
 assert.equal(restore({...checkpoint(),nodeReset:11}).reason,'reset-mismatch');
});
test('settings, 4S and mock state never leak across incompatible runs',()=>{
 assert.equal(restore(checkpoint(),{settings:{...settings,nearWindow:20}}).reason,'settings-mismatch');
 assert.equal(restore(checkpoint(),{mock:true}).reason,'mode-mismatch');assert.equal(restore(checkpoint(),{has4s:true}).reason,'mode-mismatch');
});
test('live owners, malformed files and missing symbols cannot restore state',()=>{
 assert.equal(restore(checkpoint(),{processes:[{pid:7}]}).reason,'producer-still-running');
 for(const raw of ['', '{','null','[]'])assert.equal(restore(raw).state,null);
 assert.equal(restore('x'.repeat(1000001)).reason,'missing-or-oversized');
 assert.equal(restore({...checkpoint(),stocks:{}}).reason,'symbol-mismatch');
 assert.equal(restore(checkpoint(),{quotes:{}}).reason,'symbol-mismatch');
});
test('invalid history, phase and forecast values are rejected',()=>{
 for(const patch of [{lastTick:1001},{lastTick:0},{detectedCycleTick:75},{marketCycleDetected:1},{inversionAgreementThreshold:15}])assert.equal(restore({...checkpoint(),...patch}).reason,'invalid-phase');
 for(const patch of [{priceHistory:[]},{priceHistory:[101]},{priceHistory:[100,-1]},{priceHistory:Array(152).fill(100)},
  {prob:2},{vol:-1},{lastInversion:-1},{ticksHeld:1.5},{probStdDev:null}]){
  const p=checkpoint();Object.assign(p.stocks.AAA,patch);assert.equal(restore(p).state,null);
 }
});
test('held age only carries over when current native positions exactly match',()=>{
 for(const position of [[0,0,10,90],[11,90,0,0],[10,91,0,0],null]){
  const r=restore(checkpoint(),{quotes:{AAA:{ask:102,bid:98,position}}});assert.equal(r.state.stocks.AAA.ticksHeld,0);
 }
});
test('unchanged quotes restore before tick detection and refresh always publishes native positions',()=>{
 const source=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('const saved=restoreStockHistory')<source.indexOf('const ticked = allStocks.some'));
 assert.match(source,/Object.assign\(stock,\{ask_price:old.ask,bid_price:old.bid,priceHistory/);
 const refresh=source.slice(source.indexOf('async function refresh'),source.indexOf('// Historical probability'));
 assert.ok(refresh.includes("await ns.write('/Temp/stock-probabilities.txt'"));
 assert.ok(refresh.indexOf('stk.sharesLong =')<refresh.indexOf('stockManipulationSnapshot(allStocks'));
 assert.ok(refresh.includes('stockHistoryCheckpoint(allStocks'));
 assert.equal((source.match(/stockManipulationSnapshot\(allStocks/g)||[]).length,1);
});
test('complete gang diagnostics persist through repeated maintenance without becoming fresh',()=>{
 const saved={at:1000,pid:7,nodeReset:10,augReset:20,info:{territory:.2},equipmentDiagnostics:{owned:30},tasks:{A:'Mug'}};
 const first=gangMaintenanceStatus(saved,7,reset,2000),second=gangMaintenanceStatus(first,7,reset,3000);
 assert.equal(second.at,3000);assert.equal(second.dataAt,1000);assert.equal(second.status,'maintenance');
 assert.deepEqual(second.equipmentDiagnostics,{owned:30});assert.deepEqual(second.tasks,{A:'Mug'});assert.equal(saved.status,undefined);
});
test('maintenance cannot reuse diagnostics from dead owners, other resets or future measurements',()=>{
 const saved={at:1000,pid:7,nodeReset:10,augReset:20,info:{territory:.2}};
 for(const patch of [{pid:8},{nodeReset:11},{augReset:21},{dataAt:3000},{dataAt:null},{info:null}]){
  const r=gangMaintenanceStatus({...saved,...patch},7,reset,2000);assert.equal(r.info,undefined);assert.equal(r.dataAt,null);assert.equal(r.pid,7);
 }
 assert.equal(gangMaintenanceStatus(null,7,reset,2000).dataAt,null);
});
test('budget signals age retained gang metrics by measurement time, not maintenance heartbeat',()=>{
 const now=Date.now(),reset={lastNodeReset:10,lastAugReset:20};let dataAt=now-1000;
 const ns={read:f=>f==='tasks/gang-status.json'?JSON.stringify({at:now,dataAt,pid:7,memberCount:12,info:{territory:.2}}):f==='tasks/budget-progress.json'?JSON.stringify({at:now-21*60000,nodeReset:10,territory:.2}):'',
  isRunning:()=>true,getResetInfo:()=>reset,write(){}};
 assert.equal(adaptiveBudgetSignals(ns).gangStalled,true);
 dataAt=now-121000;assert.equal(adaptiveBudgetSignals(ns).gangStalled,false);
 dataAt=now+10000;assert.equal(adaptiveBudgetSignals(ns).gangStalled,false);
 dataAt=null;assert.equal(adaptiveBudgetSignals(ns).gangStalled,false);
});

test('restored estimated forecasts are recomputed from bounded raw prices',()=>{
 const p=checkpoint();p.stocks.AAA.prob=.1;p.stocks.AAA.nearTermForecast=.2;p.stocks.AAA.longTermForecast=.3;p.stocks.AAA.vol=.9;
 const r=restore(p).state.stocks.AAA;
 assert.equal(r.prob,1);assert.equal(r.nearTermForecast,1);assert.equal(r.longTermForecast,1);assert.ok(Math.abs(r.vol-1/97)<1e-12);
});

test('production refresh restores without inventing a tick and cold-starts across quote changes',async()=>{
 const source=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function refresh('),source.indexOf('// Historical probability'));
 const factory=Function('env',`const {ns,getNsDataThroughFile,stockSnapshotExpression,restoreStockHistory,stockHistoryCheckpoint,stockManipulationSnapshot,stockPromotionSignals,resetInfo,allStockSymbols,stockHistorySettings,stockHistoryFile,initial}=env;
  const Date={now:()=>2000};const mock=false,expectedTickTime=6000,sleepInterval=1000,catchUpTickTime=4000,stockSignalFile='promotion';
  let pendingStockHistory=initial,lastTick=0,marketCycleDetected=false,detectedCycleTick=0,inversionAgreementThreshold=6,lastRapidTickWarningAt=0,rapidTickStreak=0,lastHistorySaveAt=0,historyRestoration,updates=0;
  const log=()=>{},formatDuration=String,formatMoney=String;
  const updateForecast=async(ns,stocks)=>{updates++;for(const s of stocks){s.priceHistory.unshift(s.price);s.prob=.5;s.probStdDev=.5;s.vol=0;s.nearTermForecast=.5;s.longTermForecast=.5;}};
  ${body}
  return async stocks=>{await refresh(ns,false,stocks,[]);return {stocks,updates,lastTick,historyRestoration};};`);
 const {stockManipulationSnapshot}=await import('../stock-policy.js');
 for(const changed of [false,true]){
  const writes={},q={AAA:{ask:changed?103:102,bid:98,vol:null,prob:null,position:[10,90,0,0]}};
  const ns={pid:8,ps:()=>[],write:async(f,data)=>{writes[f]=JSON.parse(data);}};
  const execute=factory({ns,getNsDataThroughFile:async()=>q,stockSnapshotExpression:()=>'',restoreStockHistory:(raw,options)=>restoreStockHistory(raw,{...options,now:2000}),stockHistoryCheckpoint,
   stockManipulationSnapshot,stockPromotionSignals:()=>({}),resetInfo:reset,allStockSymbols:['AAA'],stockHistorySettings:()=>settings,stockHistoryFile:()=> 'history',initial:JSON.stringify(checkpoint())});
  const initial={sym:'AAA',priceHistory:[],lastInversion:0,positionValue(){return this.sharesLong*this.bid_price;},owned(){return this.sharesLong+this.sharesShort>0;}};
  const result=await execute([initial]);
  assert.equal(result.updates,changed?1:0);assert.equal(result.historyRestoration.restored,!changed);
  assert.equal(result.stocks[0].priceHistory.length,changed?1:4);
  assert.equal(writes['/Temp/stock-probabilities.txt'].positions.AAA.sharesLong,10);
  assert.equal(writes.history.pid,8);assert.equal(writes.history.stocks.AAA.ask,q.AAA.ask);
 }
});

test('bid-only changes count as market ticks in production detection',()=>{
 const source=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');
 assert.match(source,/const ticked = allStocks.some\(stk => stk.ask_price != dictAskPrices\[stk.sym\] \|\| stk.bid_price != dictBidPrices\[stk.sym\]\)/);
});

