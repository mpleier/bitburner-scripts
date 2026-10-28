import test from 'node:test';
import assert from 'node:assert/strict';
import {corporationDevelopmentDelay,corporationAdvertisingDelay,planCorporationDelayedReturns} from '../corporation-delayed-return-policy.js';
import {executeCorporationGrowth,scoreCorporationGrowth} from '../corporation-policy.js';
const office=(op,eng,management)=>({employeeProductionByJob:{Operations:op,Engineer:eng,Management:management}});
const delayed=(kind,ms,extra={})=>({label:kind,cost:100,score:2,market:{kind:kind==='advertising'?'sales':'development',division:'D',delay:{kind,ms}},...extra});

test('development ETA agrees with cycle-by-cycle native progress and rounds completion conservatively',()=>{
 for(const [op,eng,mgmt]of [[1,1,0],[100,1000,500],[10000,50000,20000]])for(const progress of [0,25,99,100]){
  const perCycle=.01*(eng**.34+op**.2)*(1+mgmt/(1.2*(op+eng+mgmt)));
  let actual=progress,cycles=0;while(actual<100&&cycles<100000){actual+=Math.min(perCycle,100-actual);cycles++;}
  const quote=corporationDevelopmentDelay(office(op,eng,mgmt),progress,10);assert.ok(Math.abs(quote-cycles*10000)<=10000);
 }
 assert.equal(corporationDevelopmentDelay(office(1,1,0),0),50000000);
 assert.ok(corporationDevelopmentDelay(office(1000,1000,1000),50)<corporationDevelopmentDelay(office(1000,1000,1000),0));
});

test('invalid or missing development productivity keeps timing unknown',()=>{
 for(const o of [null,{},office(NaN,1,1),office(-1,1,1),office(0,0,0),office(0,0,100)])assert.equal(corporationDevelopmentDelay(o),null);
 for(const p of [-1,101,NaN,Infinity])assert.equal(corporationDevelopmentDelay(office(1,1,1),p),null);
 assert.equal(corporationDevelopmentDelay(office(1,1,1),0,0),null);
});

test('advertising waits for commercialization only when no mature product is already selling',()=>{
 assert.equal(corporationAdvertisingDelay([{developmentProgress:50}],600000),630000);
 assert.equal(corporationAdvertisingDelay([{developmentProgress:100},{developmentProgress:50}],600000),30000);
 assert.equal(corporationAdvertisingDelay([{developmentProgress:50}],null),null);
 assert.equal(corporationAdvertisingDelay([],600000),null);
});

test('optional delay changes capital allocation while an unknown node duration never vetoes a slow project',()=>{
 let cash=1000;const bought=[];
 const product=delayed('product-development',600000,{run:()=>{cash-=100;bought.push('product');return true;}}),instant={label:'immediate',cost:100,score:1.9,run:()=>{cash-=100;bought.push('immediate');return true;}};
 const plans=planCorporationDelayedReturns([product,instant],{remainingMs:1200000});
 executeCorporationGrowth(plans,100,()=>cash,0);assert.deepEqual(bought,['immediate']);
 const slow=planCorporationDelayedReturns([delayed('product-development',86400000)]);assert.equal(slow.length,1);assert.ok(slow[0].score>0);
 assert.equal(planCorporationDelayedReturns([product],{remainingMs:300000}).length,0);
 const boot=planCorporationDelayedReturns([{...product,priority:1}],{remainingMs:300000});assert.equal(boot[0].score,product.score);
 assert.equal(planCorporationDelayedReturns([{...product,priority:1}],{remainingMs:0}).length,0);
});

test('missing timing, stale invalid horizons and unaffected plans preserve the original estimates',()=>{
 const p=delayed('product-development',null),plain={label:'other',cost:100,score:2};
 assert.equal(planCorporationDelayedReturns([p])[0].score,2);assert.equal(planCorporationDelayedReturns([p])[0].delayedReturn.state,'unknown');
 assert.equal(planCorporationDelayedReturns([plain])[0],plain);
 const plans=[p];assert.equal(planCorporationDelayedReturns(plans,{horizonMs:NaN}),plans);
 assert.equal(planCorporationDelayedReturns([delayed('advertising',30000)],{remainingMs:-1})[0].delayedReturn.remainingMs,null);
 assert.equal(planCorporationDelayedReturns([p],{remainingMs:0}).length,0);
});

test('product development is priced against its own division and timing survives purchase diagnostics',()=>{
 const market={locations:{a:{ready:true,division:'D',city:'A',profitPerSecond:100},b:{ready:true,division:'Other',city:'B',profitPerSecond:10000}}};
 const scored=scoreCorporationGrowth([delayed('product-development',60000)],market);assert.equal(scored[0].profitPerSecond,100);assert.equal(scored[0].score,200);
 let cash=1000;const plans=planCorporationDelayedReturns([{...scored[0],run:()=>{cash-=100;return true;}}]);
 const result=executeCorporationGrowth(plans,100,()=>cash,0);assert.equal(result.decisions[0].delayedReturn.delayMs,60000);assert.match(result.decisions[0].delayedReturn.basis,/not measured/);
});
