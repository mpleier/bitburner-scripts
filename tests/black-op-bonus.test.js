import test from 'node:test';
import assert from 'node:assert/strict';
import {blackOpBonusComparison as compare,blackOpExpectedTime,observeBlackOpImprovement,decideBlackOpRisk,blackOpRiskStartAllowed} from '../black-op-risk-policy.js';
const input={time:240000,p:.95,recoveryMs:120000,bonusMs:0,waits:[{ms:600000,chance:.99,units:'work'}],threshold:.99};
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
test('zero bonus preserves the constant-speed retry and preparation equations',()=>{
 const result=compare(input);near(result.nowMs,blackOpExpectedTime(input.time,input.p,input.recoveryMs));near(result.waitMs,300000+input.time/.99);
});
test('a finite bonus shortens both alternatives and depletion lies between normal and sustained acceleration',()=>{
 const normal=compare(input),partial=compare({...input,bonusMs:100000}),full=compare({...input,bonusMs:1e9});
 assert.ok(normal.nowMs>partial.nowMs&&partial.nowMs>full.nowMs);assert.ok(normal.waitMs>partial.waitMs&&partial.waitMs>full.waitMs);assert.ok(full.nowMs>=normal.nowMs/5);
});
test('failure branches cannot refresh the bonus or convert expected workload only once',()=>{
 const result=compare({...input,bonusMs:250000});
 const naive=blackOpExpectedTime(input.time,input.p,input.recoveryMs);const convertOnce=naive-Math.min(.8*naive,250000);
 assert.ok(result.nowMs>convertOnce+1000);assert.ok(result.nowMs>blackOpExpectedTime(input.time/5,input.p,input.recoveryMs/5));
});
test('preparation spends the entire shared budget before receiving productive-work credit',()=>{
 const result=compare({...input,p:1,recoveryMs:0,bonusMs:480000});
 // 600k work costs 120k wall and exhausts 480k bonus. Subsequent attempts are at 1x.
 near(result.waitMs,60000+240000/.99);
});
test('wall-clock growth remains separate from accelerated recruitment',()=>{
 const work=compare({...input,bonusMs:1e9});const wall=compare({...input,bonusMs:1e9,waits:[{ms:600000,chance:.99,units:'wall'}]});
 near(wall.waitMs-work.waitMs,240000);
});
test('external growth wall bounds remain optimistic when bonus is exhausted',()=>{
 const result=compare({...input,waits:[{ms:10000,workMs:1000000,chance:.99,units:'wall'}]});near(result.waitMs,5000+240000/.99);
});
test('invalid clocks, unsupported probability floors and missing waiting alternatives fail closed',()=>{
 for(const patch of [{bonusMs:-1},{bonusMs:NaN},{time:Infinity},{p:.89},{recoveryMs:-1},{waits:[]},{waits:[{ms:100,chance:.98}]},{waits:[{ms:100,chance:.99,units:'unknown'}]}])assert.equal(compare({...input,...patch}),null);
});
test('serialized comparison is self-contained for the final native worker',()=>{
 const standalone=Function('return ('+compare.toString()+')')();assert.deepEqual(standalone({...input,bonusMs:230000}),compare({...input,bonusMs:230000}));
});
function history(bonuses){let h;for(let i=0;i<3;i++)h=observeBlackOpImprovement(h,{at:i*15000,p:.94+i*.005,rank:1500,bonusMs:bonuses[i],stamina:[100,100],target:'X',city:'A',team:0,supporting:0,nodeReset:1,augReset:2},.99);return h;}
test('growth evidence normalizes elapsed work using observed bonus depletion',()=>{
 const h=history([200000,140000,80000]);near(h.workMs,300000);near(h.waitMs,60000);
});
test('impossible bonus grants and depletion reset improvement evidence',()=>{
 for(const bonuses of [[0,0,200000],[200000,140000,0]]){const h=history(bonuses);assert.equal(h.samples.length,1);assert.equal(h.waitMs,null);}
});
test('depleted-bonus observations retain the fast external wall-rate forecast',()=>{
 const h=history([120000,60000,0]);near(h.workMs,300000);near(h.waitMs,60000);
});
function ticket(){const q={at:100000,ownerPid:7,target:'X',nodeReset:1,augReset:2,city:'A',p:.95,rank:1500,loss:100,time:240000,money:1e9,hp:{current:100,max:100},stamina:[1000,1000],team:0,totalTeam:0,supporting:0,bonusMs:0,recruit:{time:30000,chance:1},hrcTime:1000};const c={cashIncome:{at:100000,rate:1e9,nodeReset:1,augReset:2},enabled:true,threshold:.99,floor:.9,target:'X',ownerPid:7,reset:{lastNodeReset:1,lastAugReset:2},requiredRank:1000,hpLoss:100,difficulty:1,waits:[{ms:600000,chance:.99,units:'work'}]};return {q,t:decideBlackOpRisk(q,c,100000)};}
test('native dispatch recomputes the comparison using fresh bonus and ages preparation conservatively',()=>{
 const {q,t}=ticket();assert.equal(t.adaptive,true);let captured;
 assert.equal(blackOpRiskStartAllowed(t,{...q,bonusMs:200000},101000,args=>{captured=args;return {savingMs:60000,waitMs:200000};}),true);
 assert.equal(captured.bonusMs,200000);assert.equal(captured.waits[0].ms,595000);assert.equal(blackOpRiskStartAllowed(t,q,100000,()=>({savingMs:1000,waitMs:200000})),false);
 assert.equal(blackOpRiskStartAllowed({...t,comparisonVersion:1},q,100000),false);
});
