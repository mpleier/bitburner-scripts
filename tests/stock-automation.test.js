import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {stockTradeReceipt,stockReserve,holdYoungStock,stockOptionsError} from '../stock-policy.js';
function market({money=2e6,position=[0,0,0,0],fail=false,forecast=.7}={}){
 let cash=money,p=position.slice(),calls=0;
 const buy=(long,count)=>{calls++;if(fail)return 0;cash-=count*100+100000;p[long?0:2]+=count;p[long?1:3]=100;return 101;};
 const sell=(long,count)=>{calls++;if(fail)return 0;cash+=count*(long?110:2*p[3]-110)-100000;p[long?0:2]-=count;return 111;};
 return {wallet:()=>cash,calls:()=>calls,api:{getPosition:()=>p.slice(),getMaxShares:()=>1e6,getPurchaseCost:(_s,n)=>n*100+100000,has4SDataTixApi:()=>true,getForecast:()=>forecast,buyStock:(_s,n)=>buy(true,n),buyShort:(_s,n)=>buy(false,n),sellStock:(_s,n)=>sell(true,n),sellShort:(_s,n)=>sell(false,n)}};
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
 const context={stockTradeReceipt,stockReserve,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{assert.ok(args.every(a=>['string','number','boolean'].includes(typeof a)));ns.args=args;return vm.runInNewContext(expression,{ns});}};
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
  const context={stockTradeReceipt,stockReserve,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{ns.args=args;return vm.runInNewContext(expression,{ns});}};
  vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export function','function').replace('export async function','async function')+';globalThis.trade=transactStock;',context);
  return {m,trade:(...args)=>context.trade(ns,'AAA',1000,...args)};
 };
 const buy=await make();assert.equal((await buy.trade('buyStock',false,199999)).shares,0);assert.equal(buy.m.calls(),0);
 const sale=await make([1000,100,0,0],true);assert.equal((await sale.trade('sellStock')).shares,0);assert.equal(sale.m.calls(),0);
 assert.equal((await sale.trade('sellStock',true)).shares,1000);
});
