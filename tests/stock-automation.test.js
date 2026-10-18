import {augmentationCashReserve} from '../spending-policy.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {stockTradeReceipt,stockReserve,holdYoungStock,stockOptionsError,stockControlAllowed,stockCycleAgreement,stockHistoryForecast,stockSnapshotExpression} from '../stock-policy.js';
function market({money=2e6,position=[0,0,0,0],fail=false,forecast=.7}={}){
 let cash=money,p=position.slice(),calls=0;
 const buy=(long,count)=>{calls++;if(fail)return 0;cash-=count*100+100000;p[long?0:2]+=count;p[long?1:3]=100;return 101;};
 const sell=(long,count)=>{calls++;if(fail)return 0;cash+=count*(long?110:2*p[3]-110)-100000;p[long?0:2]-=count;return 111;};
 return {wallet:()=>cash,calls:()=>calls,api:{getPosition:()=>p.slice(),getMaxShares:()=>1e6,getPurchaseCost:(_s,n,type)=>{assert.ok(['L','S'].includes(type),'invalid native PositionType '+type);return n*100+100000;},has4SDataTixApi:()=>true,getForecast:()=>forecast,buyStock:(_s,n)=>buy(true,n),buyShort:(_s,n)=>buy(false,n),sellStock:(_s,n)=>sell(true,n),sellShort:(_s,n)=>sell(false,n)}};
}
test('trade receipts use actual fill and cash rather than shifted API return prices',()=>{
 const m=market();const r=stockTradeReceipt(m.api,m.wallet,'AAA',1000,'buyStock',0,()=>true);assert.equal(r.shares,1000);assert.equal(r.cash,200000);assert.equal(r.price,100);
 const sold=stockTradeReceipt(m.api,m.wallet,'AAA',1000,'sellStock',0,()=>true);assert.equal(sold.cash,10000);assert.equal(sold.price,110);
});
test('short exits return collateral plus profit, including losses and commission',()=>{
 const m=market({position:[0,0,10000,100]});const r=stockTradeReceipt(m.api,m.wallet,'AAA',10000,'sellShort',0,()=>true);assert.equal(r.cash,800000);assert.equal(r.price,110);assert.equal(r.entry,100);
});
test('reserves, fresh forecast reversals, and pauses block native purchases',()=>{
 for(const opts of [{reserve:2e6},{forecast:.3},{allowed:false}]){
 const m=market(opts);const r=stockTradeReceipt(m.api,m.wallet,'AAA',1000,'buyStock',opts.reserve||0,()=>opts.allowed!==false);assert.equal(r.shares,0);assert.equal(m.calls(),0);
 }
 assert.equal(stockReserve('__default__','200'),200);assert.equal(stockReserve(0,'200'),0);assert.equal(stockReserve(null,'bad'),0);
});
test('failed transactions preserve positions and return no financial receipt',()=>{
 const m=market({fail:true,position:[1000,100,0,0]});assert.equal(stockTradeReceipt(m.api,m.wallet,'AAA',1000,'sellStock',0,()=>true).shares,0);
});
test('strong forecast reversals bypass minimum holds while small noise does not',()=>{
 assert.equal(holdYoungStock({sharesLong:100,sharesShort:0,prob:.3,ticksHeld:1},10,.15),false);
 assert.equal(holdYoungStock({sharesLong:100,sharesShort:0,prob:.49,ticksHeld:1},10,.15),true);
});
test('invalid stock options reject impossible cash fractions',()=>{
 const o={fracB:.4,fracH:.2,diversification:.34,'buy-4s-budget':.8,reserve:null,'buy-threshold':0,'sell-threshold':0,'pre-4s-buy-threshold-return':.001,'pre-4s-sell-threshold-return':0,'pre-4s-min-tick-history':21,'pre-4s-forecast-window':51,'pre-4s-inversion-detection-window':10,'pre-4s-min-blackout-window':10,'pre-4s-minimum-hold-time':10,'pre-4s-buy-threshold-probability':.15};
 assert.equal(stockOptionsError(o),null);for(const patch of [{fracH:.8},{reserve:-1},{'pre-4s-min-tick-history':100}])assert.ok(stockOptionsError({...o,...patch}));
});


test('serialized stock worker uses fresh reserves and valid native argument types',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8');
 const m=market(),ns={pid:1,read:()=> '1950000',getPlayer:()=>({money:m.wallet()}),isRunning:()=>true,stock:m.api};
 const context={augmentationCashReserve,stockTradeReceipt,stockReserve,stockControlAllowed,stockHistoryForecast,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{assert.ok(args.every(a=>['string','number','boolean'].includes(typeof a)));ns.args=args;return vm.runInNewContext(expression,{ns});}};
 vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export function','function').replace('export async function','async function')+';globalThis.trade=transactStock;',context);
 const result=await context.trade(ns,'AAA',1000,'buyStock');assert.equal(result.shares,0);assert.equal(m.calls(),0);
});


test('fresh purchase quotes cannot exceed the original order allocation',()=>{
 for(const budget of [199999,-1,NaN,Infinity]){
  const m=market();assert.equal(stockTradeReceipt(m.api,m.wallet,'AAA',1000,'buyStock',0,()=>true,100000,budget).shares,0);assert.equal(m.calls(),0);
 }
 const m=market();assert.equal(stockTradeReceipt(m.api,m.wallet,'AAA',1000,'buyStock',0,()=>true,100000,200000).cash,200000);
});

test('short losses may consume cash while still closing the position',()=>{
 const m=market({position:[0,0,1000,10]});const r=stockTradeReceipt(m.api,m.wallet,'AAA',1000,'sellShort',0,()=>true);
 assert.equal(r.shares,1000);assert.equal(r.cash,-190000);assert.equal(r.price,110);assert.equal(m.api.getPosition('AAA')[2],0);
});

test('serialized workers preserve order allocations and explicit liquidation pause semantics',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8');
 const make=async(position=[0,0,0,0],paused=false)=>{
  const m=market({position}),ns={pid:1,read:path=>path==='reserve.txt'?'0':paused?'true':'',getPlayer:()=>({money:m.wallet()}),isRunning:()=>true,stock:m.api};
  const context={augmentationCashReserve,stockTradeReceipt,stockReserve,stockControlAllowed,stockHistoryForecast,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{ns.args=args;return vm.runInNewContext(expression,{ns});}};
  vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export function','function').replace('export async function','async function')+';globalThis.trade=transactStock;',context);
  return {m,trade:(...args)=>context.trade(ns,'AAA',1000,...args)};
 };
 const buy=await make();assert.equal((await buy.trade('buyStock',false,199999)).shares,0);assert.equal(buy.m.calls(),0);
 const sale=await make([1000,100,0,0],true);assert.equal((await sale.trade('sellStock')).shares,0);assert.equal(sale.m.calls(),0);
 assert.equal((await sale.trade('sellStock',true)).shares,1000);
});


test('cycle agreement stays monotonic within its intended cap and sparse history is neutral',()=>{
 assert.equal(stockCycleAgreement(6,10),10);assert.equal(stockCycleAgreement(10,8),10);assert.equal(stockCycleAgreement(10,20),14);
 assert.equal(stockHistoryForecast([]),.5);assert.equal(stockHistoryForecast([100]),.5);assert.equal(stockHistoryForecast([102,101,100]),1);
});

test('stock maintenance blocks ordinary commands but permits explicit liquidation',()=>{
 const ns={isRunning:()=>true,read:f=>f.includes('maintenance')?JSON.stringify({ownerPid:3,expiresAt:Date.now()+60000}):''};
 assert.equal(stockControlAllowed(ns,1),false);assert.equal(stockControlAllowed(ns,1,true),true);
 assert.equal(stockControlAllowed({...ns,isRunning:()=>false},1,true),false);
});

test('one synchronous snapshot collects consistent quotes, forecasts and positions',()=>{
 let calls=[];const ns={args:['AAA'],stock:Object.fromEntries(['getAskPrice','getBidPrice','getVolatility','getForecast','getPosition'].map((name,i)=>[name,()=>{calls.push(name);return i;}]))};
 const snapshot=vm.runInNewContext(stockSnapshotExpression(true,false),{ns});assert.equal(snapshot.AAA.ask,0);assert.equal(snapshot.AAA.position,4);assert.equal(calls.length,5);
 calls=[];const mockSnapshot=vm.runInNewContext(stockSnapshotExpression(false,true),{ns});assert.equal(mockSnapshot.AAA.position,null);assert.deepEqual(calls,['getAskPrice','getBidPrice']);
});

function stockContext(source,context,append){context.augmentationCashReserve=augmentationCashReserve;context.stockHistoryForecast=stockHistoryForecast;vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export function','function').replace('export async function','async function')+append,context);}

test('mock trades debit and credit a separate wallet instead of reusing real cash',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8'),ns={read:()=>'',getScriptName:()=> 'stockmaster.js',print:()=>{}},context={stockReserve,achievementActionAllowed:()=>true,isScriptPaused:()=>false,formatMoney:String,getNsDataThroughFile:async()=>({money:2e6})};
 stockContext(source,context,';mock=true;mockCash=null;options={reserve:0};globalThis.buy=doBuy;globalThis.sell=doSellAll;globalThis.player=getPlayerInfo;');
 const stk={sym:'AAA',ask_price:100,bid_price:110,sharesLong:0,sharesShort:0,bullish:()=>true,owned(){return this.sharesLong+this.sharesShort>0;}};
 assert.equal((await context.player(ns)).money,2e6);
 assert.equal(await context.buy(ns,stk,1000,199999),0);
 assert.equal(await context.buy(ns,stk,1000,200000),200000);assert.equal((await context.player(ns)).money,1800000);
 await context.sell(ns,stk);assert.equal((await context.player(ns)).money,1810000);
});

test('disabled 4S does not liquidate or attempt access purchases',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8'),context={achievementActionAllowed:()=>true,getNsDataThroughFile:async()=>{throw Error('Unexpected API call');}};
 stockContext(source,context,';resetInfo={bitNodeOptions:{disable4SData:true}};globalThis.access=tryGet4SApi;');
 assert.equal(await context.access({}, {money:30e9},30e9),false);
});

test('partial 4S access purchases request a portfolio refresh even if API purchase fails',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8');
 const ns={pid:1,read:()=>'',print:()=>{},tprint:()=>{},toast:()=>{}},context={stockReserve,stockControlAllowed,achievementActionAllowed:()=>true,formatMoney:String,formatDuration:String,getNsDataThroughFile:async(_ns,expression)=>expression.includes('purchase4SMarketData()')};
 stockContext(source,context,';resetInfo={lastNodeReset:Date.now()};bitNodeMults={FourSigmaMarketDataCost:1,FourSigmaMarketDataApiCost:1};options={reserve:0};globalThis.access=tryGet4SApi;');
 assert.equal(await context.access(ns,{money:30e9},30e9),true);
});


test('short purchase quotes use the native S enum value',()=>{
 const m=market({forecast:.3});const receipt=stockTradeReceipt(m.api,m.wallet,'AAA',1000,'buyShort',0,()=>true);
 assert.equal(receipt.shares,1000);assert.equal(receipt.cash,200000);
});


test('native stock workers recheck augmentation cash goals even with a zero stock reserve',async()=>{
 const source=await readFile(new URL('../stockmaster.js',import.meta.url),'utf8'),m=market(),now=Date.now();
 let goal=1950000;
 const ns={pid:1,read:f=>f==='tasks/spending-plan.json'?JSON.stringify({epoch:now,expiresAt:now+60000,reset:3,ownerPid:7,signals:{augmentationCashTarget:{name:'Combat',cost:goal}}}):'0',getResetInfo:()=>({lastAugReset:3}),ps:()=>[{pid:7,filename:'autopilot.js'}],getPlayer:()=>({money:m.wallet()}),isRunning:()=>true,stock:m.api};
 const context={augmentationCashReserve,stockTradeReceipt,stockReserve,stockControlAllowed,stockHistoryForecast,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{ns.args=args;return vm.runInNewContext(expression,{ns});}};
 stockContext(source,context,';options={reserve:0};globalThis.trade=transactStock;');
 assert.equal((await context.trade(ns,'AAA',1000,'buyStock')).shares,0);assert.equal(m.calls(),0);
 goal=0;assert.equal((await context.trade(ns,'AAA',1000,'buyStock')).shares,1000);
});
