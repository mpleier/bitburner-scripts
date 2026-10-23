import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeBlackOpCash,decideBlackOpRisk,blackOpRiskStartAllowed,blackOpBonusComparison} from '../black-op-risk-policy.js';
const sources=value=>({hacking:value,hacknet:0,gang:0,corporation:0,crime:0,work:0,sleeves:0});
const quote=(at=30000)=>({at,ownerPid:7,target:'X',nodeReset:1,augReset:2,city:'A',p:.95,rank:1500,loss:100,time:240000,money:1e9,hp:{current:100,max:100},stamina:[1000,1000],team:0,totalTeam:0,supporting:0,bonusMs:0,recruit:{time:30000,chance:1},hrcTime:1000,moneySources:sources(300000)});
const context=()=>({enabled:true,threshold:.99,floor:.9,target:'X',ownerPid:7,reset:{lastNodeReset:1,lastAugReset:2},requiredRank:1000,hpLoss:100,difficulty:1,waits:[{ms:600000,chance:.99}],cashIncome:{at:30000,rate:1e9,nodeReset:1,augReset:2}});
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
function observed(rows){let h;for(const [at,money,earned,patch] of rows)h=observeBlackOpCash(h,{...quote(at),money,moneySources:sources(earned),...patch});return h;}
test('cash replacement requires thirty seconds and uses half the minimum observed net income',()=>{
 const rows=[[0,1000,0],[15000,16000,30000],[30000,46000,90000]];
 assert.equal(observed(rows.slice(0,2)).rate,null);near(observed(rows).rate,500);
});
test('wallet windfalls cannot exceed independently observed recurring earnings',()=>{
 const h=observed([[0,1e9,0],[15000,2e9,30000],[30000,3e9,60000]]);near(h.rate,1000);
 const noRecurring=observed([[0,1e9,0],[15000,2e9,0],[30000,3e9,0]]);assert.equal(noRecurring.rate,0);
});
test('spending or falling cash can invalidate an otherwise profitable income stream',()=>{
 assert.equal(observed([[0,1e9,0],[15000,9e8,30000],[30000,1e9,60000]]).rate,0);
});
test('casino, stock, contracts and infiltration cannot establish cash replacement income',()=>{
 let h;for(const at of [0,15000,30000])h=observeBlackOpCash(h,{...quote(at),money:1e9+at,moneySources:{...sources(0),casino:at,stock:at,codingcontract:at,infiltration:at,other:at}});assert.equal(h.rate,0);
});
test('reset, counter regression, missing data and stale samples discard old cash evidence',()=>{
 const h=observed([[0,1e9,0],[15000,1e9+30000,30000],[30000,1e9+60000,60000]]);
 for(const patch of [{augReset:3},{nodeReset:3},{at:70000},{moneySources:sources(0)}]){const n=observeBlackOpCash(h,{...quote(31000),...patch});assert.equal(n.rate,null);assert.equal(n.samples.length,1);}
 for(const patch of [{moneySources:null},{moneySources:{hacking:1}},{money:NaN},{at:NaN}])assert.equal(observeBlackOpCash(h,{...quote(31000),...patch}).rate,null);
});
test('samples are throttled and source history is bounded',()=>{
 let h=observeBlackOpCash(null,quote(0));h=observeBlackOpCash(h,quote(1000));assert.equal(h.samples.length,1);
 for(let i=1;i<25;i++)h=observeBlackOpCash(h,{...quote(i*15000),money:1e9+i*30000,moneySources:sources(i*300000)});
 assert.ok(h.samples.length<=9);
});
test('paid lethal failure requires fresh reset-matched positive cash income',()=>{
 for(const patch of [null,{at:25000,rate:1e9,nodeReset:1,augReset:2},{at:30000,rate:0,nodeReset:1,augReset:2},{at:30000,rate:1e9,nodeReset:2,augReset:2},{at:30001,rate:1e9,nodeReset:1,augReset:2}]){const c=context();c.cashIncome=patch;assert.match(decideBlackOpRisk(quote(),c,30000).reason,/cash recovery/);}
});
test('slow cash recovery can make waiting preferable despite an otherwise winning operation',()=>{
 const q=quote(),c=context();assert.equal(decideBlackOpRisk(q,c,30000).adaptive,true);
 c.cashIncome.rate=100;const d=decideBlackOpRisk(q,c,30000);assert.equal(d.adaptive,false);assert.ok(d.expectedCashDelayMs>1e6);assert.match(d.reason,/Improving first/);
});
test('hospitalization opportunity cost is wall time and is never accelerated by bonus',()=>{
 const c=context(),q=quote();const ticket=decideBlackOpRisk(q,c,30000);
 near(ticket.failureWallMs,11.1);near(ticket.expectedCashDelayMs,(1-q.p)/q.p*11.1);
 for(const bonusMs of [0,100000,1e9]){const args={time:240000,p:.95,recoveryMs:1000,bonusMs,waits:c.waits,threshold:.99};near(blackOpBonusComparison({...args,failureWallMs:100000}).nowMs-blackOpBonusComparison(args).nowMs,100000*.05/.95);}
});
test('free or nonlethal failures retain existing safety checks without an income estimate',()=>{
 const c=context();c.cashIncome=null;c.hpLoss=1;assert.equal(decideBlackOpRisk(quote(),c,30000).adaptive,true);
 c.hpLoss=100;const d=decideBlackOpRisk({...quote(),money:0},c,30000);assert.equal(d.adaptive,true);assert.equal(d.expectedCashDelayMs,0);
});
test('final native guard reprices against the wallet and denies unpriced new hospitalization costs',()=>{
 const q=quote(),t=decideBlackOpRisk(q,context(),30000);let captured;
 assert.equal(blackOpRiskStartAllowed(t,{...q,money:2e9},30000,args=>{captured=args;return {savingMs:100000,waitMs:300000};}),true);near(captured.failureWallMs,11.1);
 const c=context();c.cashIncome=null;const free={...q,money:0},ticket=decideBlackOpRisk(free,c,30000);
 assert.equal(blackOpRiskStartAllowed(ticket,free,30000),true);assert.equal(blackOpRiskStartAllowed(ticket,{...free,money:1000},30000),false);
 for(const patch of [{cashRate:0},{failureWallMs:NaN},{hospitalCost:1},{failureWallMs:0,hospitalCost:1,cashRate:0}])assert.equal(blackOpRiskStartAllowed({...t,...patch},q,30000),false);
});
test('new cost input fails closed for invalid values and malformed stamina returns false',()=>{
 const args={time:240000,p:.95,recoveryMs:1000,bonusMs:0,waits:context().waits,threshold:.99};for(const failureWallMs of [-1,NaN,Infinity])assert.equal(blackOpBonusComparison({...args,failureWallMs}),null);
 const q=quote(),t=decideBlackOpRisk(q,context(),30000);assert.equal(blackOpRiskStartAllowed(t,{...q,stamina:{}},30000),false);
});
test('production keeps money API outside the existing 31.1 GB quote and wires the cash evidence',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(s,/blackOpCashHistory=observeBlackOpCash\(blackOpCashHistory,q\)/);assert.match(s,/cashIncome:blackOpCashHistory/);assert.match(s,/ns\.getMoneySources\(\)\.sinceInstall/);
 const leaf=readFileSync(new URL('../black-op-risk-source.js',import.meta.url),'utf8');assert.doesNotMatch(leaf,/getMoneySources/);
});
