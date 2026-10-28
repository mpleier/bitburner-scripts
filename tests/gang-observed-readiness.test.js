import test from 'node:test';
import assert from 'node:assert/strict';
import {gangTerritorySample,gangObservedReadiness} from '../gang-policy.js';
const gang={faction:'Own',power:200,territory:.5,territoryClashChance:0};
const now=200000;
function snapshot(){return {at:now,tickAt:now,faction:'Own',gangs:{Own:{power:200,territory:.5},Rival:{power:100,territory:.5}},powerHistory:{Own:[8,10,12],Rival:[1,1,1]}};}
const estimate=(s=snapshot(),g=gang,bonus=0,model=20)=>gangObservedReadiness(g,s,.75,bonus,now,model);
test('observed crossing uses relative growth, a bounded range and model calibration',()=>{
 const r=estimate();assert.equal(r.state,'projected');assert.equal(r.samples,3);assert.ok(Math.abs(r.etaSeconds-100/(.5-.15))<1e-8);
 assert.ok(r.rangeSeconds.optimistic<r.etaSeconds);assert.ok(r.rangeSeconds.conservative>r.etaSeconds);assert.equal(r.modelRatio,.5);
});
test('bonus projection exhausts bonus before returning to ordinary speed',()=>{
 assert.ok(Math.abs(estimate(snapshot(),gang,240000).etaSeconds-estimate().etaSeconds+240)<1e-8);
 assert.equal(estimate(snapshot(),gang,1e7).etaSeconds,estimate().etaSeconds/25);
});
test('stalled and non-closing rates serialize honestly without finite invented time',()=>{
 const s=snapshot();s.powerHistory.Own=[0,0,0];const r=estimate(s);assert.equal(r.state,'not-closing');assert.equal(r.etaSeconds,null);assert.equal(r.rangeSeconds.conservative,null);assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});
test('sampling rejects sparse, stale, future, mismatched and invalid observations',()=>{
 for(const change of [s=>s.powerHistory.Own=[1,1],s=>s.powerHistory.Own=[1,NaN,1],s=>s.powerHistory.Rival=[1,1],s=>s.tickAt=now-45001,s=>s.tickAt=now+1,s=>s.faction='Other',s=>s.gangs.Own.power=201,s=>s.gangs.Own.territory=.4]){
  const s=snapshot();change(s);assert.equal(estimate(s).state,'sampling');
 }
 assert.equal(estimate(snapshot(),gang,-1).state,'sampling');assert.equal(estimate(snapshot(),gang,0,NaN).modelRatio,null);
});
test('ready state checks every rival and reports zero even with flat own gains',()=>{
 const s=snapshot(),g={...gang,power:400};s.gangs.Own.power=400;s.powerHistory.Own=[0,0,0];assert.equal(estimate(s,g).state,'ready');assert.equal(estimate(s,g).etaSeconds,0);
 s.gangs.Other={power:200,territory:.1};s.powerHistory.Other=[0,0,0];assert.equal(estimate(s,g).state,'not-closing');
});
function ticks(){let s;for(let i=0;i<15;i++)s=gangTerritorySample(s,{Own:{power:100+i*10,territory:.5},Rival:{power:100+i,territory:.5}},'Own',1000+i*20000);return s;}
test('native sampler retains own bounded gains without counting identical polls',()=>{
 const s=ticks();assert.equal(s.powerHistory.Own.length,8);assert.deepEqual(s.powerHistory.Own,Array(8).fill(10));
 const r=gangTerritorySample(s,s.gangs,'Own',s.at+200);assert.deepEqual(r.powerHistory,s.powerHistory);assert.equal(r.changed,false);
});
test('own losses, territory changes, missed updates and identity changes clear calibration',()=>{
 const s=ticks();for(const [power,territory,at,faction] of [[1,.5,s.at+20000,'Own'],[250,.6,s.at+20000,'Own'],[250,.5,s.at+60000,'Own'],[250,.5,s.at+20000,'Other']]){
  const r=gangTerritorySample(s,{...s.gangs,Own:{power,territory}},faction,at);assert.equal((r.powerHistory.Own||[]).length,0);
 }
});
test('one extreme gain cannot dominate the median calibration',()=>{
 const s=snapshot();s.powerHistory.Own=[10,10,100000];const r=estimate(s);assert.equal(r.observedPowerPerTick,10);assert.equal(r.modelRatio,.5);
});
