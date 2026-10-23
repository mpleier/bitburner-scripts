import test from 'node:test';
import assert from 'node:assert/strict';
import {blackOpHospitalCost,decideBlackOpRisk,blackOpRiskStartAllowed} from '../black-op-risk-policy.js';
const q=()=>({at:100000,ownerPid:7,target:'X',nodeReset:1,augReset:2,city:'A',p:.95,rank:1500,loss:100,time:240000,money:1e9,hp:{current:100,max:100},stamina:[1000,1000],team:0,totalTeam:0,supporting:0,bonusMs:0,recruit:{time:30000,chance:1},hrcTime:1000});
const c=()=>({enabled:true,threshold:.99,floor:.9,target:'X',ownerPid:7,reset:{lastNodeReset:1,lastAugReset:2},requiredRank:1000,hpLoss:100,difficulty:1,waits:[{ms:600000,chance:.99}],cashIncome:{at:100000,rate:1e9,nodeReset:1,augReset:2}});
test('hospital cap includes overkill and existing injuries before applying the wallet limit',()=>{
 assert.equal(blackOpHospitalCost(1e9,{current:100,max:100},111),11100000);
 assert.equal(blackOpHospitalCost(1e9,{current:90,max:100},111),12100000);
 assert.equal(blackOpHospitalCost(1e6,{current:90,max:100},111),100000);
 assert.equal(blackOpHospitalCost(0,{current:90,max:100},111),0);
});
test('exact lethal boundary is hospitalized and nonlethal damage has no hospital bill',()=>{
 assert.equal(blackOpHospitalCost(1e9,{current:90,max:100},89),0);
 assert.equal(blackOpHospitalCost(1e9,{current:90,max:100},90),10000000);
});
test('independent damage-then-hospital simulation agrees over varying wealth, injuries and overkill',()=>{
 for(const money of [0,1,1e5,1e7,1e9,1e15])for(const max of [1,100,10000])for(const health of [max,max*.9,max*.5])for(const damage of [0,health-0.01,health,health+1,max*20]){
  const after=health-damage;
  const expected=after>0?0:Math.min(money/10,(max-after)*1e5);
  assert.equal(blackOpHospitalCost(money,{current:health,max},damage),expected);
 }
});
test('missing or invalid hospital inputs cannot quote an adaptive bill',()=>{
 for(const [money,hp,damage]of [[NaN,{current:1,max:1},1],[-1,{current:1,max:1},1],[1,null,1],[1,{current:0,max:1},1],[1,{current:2,max:1},1],[1,{current:1,max:1},-1],[1,{current:1,max:1},Infinity]])assert.equal(blackOpHospitalCost(money,hp,damage),null);
});
test('hospital calculator serializes without native APIs or external bindings',()=>{
 const native=Function('return ('+blackOpHospitalCost.toString()+')')();assert.equal(native(1e9,{current:90,max:100},111),12100000);
});
test('damage cap removes a false cash veto for wealthy players while preserving the loss limit for poor players',()=>{
 const quote={...q(),p:.9},context=c(),d=decideBlackOpRisk(quote,context,100000);
 assert.equal(d.adaptive,true);assert.equal(d.hospitalCost,11100000);assert.ok(d.expectedCashLoss<=quote.money*.01);
 assert.match(decideBlackOpRisk({...quote,money:1e6},context,100000).reason,/exceeds 1%/);
});
test('damage-based bill changes with live injuries and stops rising once damage cap binds',()=>{
 const quote={...q(),hp:{current:90,max:100}},t=decideBlackOpRisk(quote,c(),100000);let priced;
 assert.equal(blackOpRiskStartAllowed(t,{...quote,money:1e15,hp:{current:100,max:100}},100000,args=>{priced=args;return {savingMs:100000,waitMs:300000};}),true);
 assert.equal(t.hospitalCost,12100000);assert.equal(priced.failureWallMs,11.1);
});
test('healing across lethal boundary is covered by the conservative nonfatal recovery bound',()=>{
 const quote={...q(),hp:{current:90,max:100}},context={...c(),hpLoss:85},t=decideBlackOpRisk(quote,context,100000);
 assert.equal(t.adaptive,true);assert.equal(t.damage,94);
 assert.equal(t.nonfatalDamage,94);assert.equal(t.recoveryMs,47000);
 assert.equal(blackOpRiskStartAllowed(t,{...quote,hp:{current:100,max:100}},100000),true);
});
test('native guard rejects old schemas, damaged cost quotes and missing damage data',()=>{
 const quote=q(),t=decideBlackOpRisk(quote,c(),100000);
 for(const patch of [{comparisonVersion:3},{hospitalCost:t.hospitalCost-1},{damage:NaN},{damage:-1},{failureWallMs:0}])assert.equal(blackOpRiskStartAllowed({...t,...patch},quote,100000),false);
});

test('mixed lethal and nonlethal damage outcomes include surviving-hit HRC recovery',()=>{
 const quote=q(),d=decideBlackOpRisk(quote,c(),100000);
 assert.equal(d.damage,111);assert.equal(d.minimumDamage,91);assert.equal(d.nonfatalDamage,99);assert.equal(d.recoveryMs,50000);
});
test('guaranteed lethal rolls require only stamina recovery, while safe hits retain HP recovery',()=>{
 const quote=q(),context=c();context.hpLoss=200;let d=decideBlackOpRisk(quote,context,100000);
 assert.equal(d.nonfatalDamage,0);assert.equal(d.recoveryMs,1000);
 context.hpLoss=10;d=decideBlackOpRisk(quote,context,100000);assert.equal(d.damage,12);assert.equal(d.nonfatalDamage,12);assert.equal(d.recoveryMs,6000);
});
test('mixed-damage healing bound covers every surviving integer roll and possible pre-start HP',()=>{
 for(const max of [100,100.5,1000])for(const hpLoss of [1,50,85,100,200]){
  const quote={...q(),hp:{current:max*.9,max}},context={...c(),hpLoss};const d=decideBlackOpRisk(quote,context,100000);
  if(!d.adaptive)continue;
  for(let damage=d.minimumDamage;damage<=d.damage;damage++)for(const health of [quote.hp.current,max])if(damage<health)assert.ok(damage<=d.nonfatalDamage);
 }
});
