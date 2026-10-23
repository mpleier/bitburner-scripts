import test from 'node:test';
import assert from 'node:assert/strict';
import {gangTerritorySample,gangWarfareContext,gangWarfareReadyDelay,forecastGangCrewTraining,projectGangMember} from '../gang-policy.js';
const rows=(power,own=1,territory=.5)=>({Own:{power:own,territory:.5},Rival:{power,territory}});
function ticks(bonusMs=0){let sample;const step=bonusMs?800:20000;
 for(let i=0;i<7;i++){
  sample=gangTerritorySample(sample,rows(100+i*2), 'Own',1000+i*step,bonusMs);
  for(let j=1;j<step/200;j++)sample=gangTerritorySample(sample,rows(100+i*2),'Own',1000+i*step+j*200,bonusMs);
 }return sample;
}
const gang={faction:'Own',power:200,territory:.5,territoryClashChance:0};
test('only observed ticks contribute, not fast identical polls',()=>{
 const sample=ticks(),r=gangWarfareContext(gang,sample,.75,sample.at);
 assert.equal(r.rivals[0].rate,.1);assert.equal(r.rivals[0].samples,5);
 assert.equal(r.rivals[0].lowRate,.1);assert.equal(r.rivals[0].highRate,.1);
});
test('bonus territory ticks produce the same game-second trend',()=>{
 const sample=ticks(1e7);assert.equal(gangWarfareContext(gang,sample,.75,sample.at).rivals[0].rate,.1);
});
test('clash losses, territory changes, long pauses and faction changes invalidate trends',()=>{
 const sample=ticks();
 for(const [data,faction,at] of [[rows(1),'Own',141000],[rows(115,1,.4),'Own',141000],[rows(115),'Own',sample.at+60000],[rows(115),'Other',sample.at+200]]){
  const next=gangTerritorySample(sample,data,faction,at);
  assert.deepEqual(next.powerHistory.Rival||[],[]);
 }
});
test('insufficient observations retain fixed-power estimates',()=>{
 const sample=gangTerritorySample(null,rows(1),'Own',1);
 assert.equal(gangWarfareContext(gang,sample,.75,1).rivals[0].rate,0);
});
test('median limits one extreme positive tick; histories remain bounded',()=>{
 let sample,power=1;
 for(let i=0;i<20;i++){power+=i===16?10000:2;sample=gangTerritorySample(sample,rows(power),'Own',i*20000);
  for(let j=200;j<20000;j+=200)sample=gangTerritorySample(sample,rows(power),'Own',i*20000+j);}
 const rival=gangWarfareContext(gang,sample,.75,sample.at).rivals[0];
 assert.equal(rival.rate,.1);assert.equal(rival.samples,8);assert.ok(rival.highRate>rival.rate);
});
test('clock reversal resets history and inputs are not mutated',()=>{
 const sample=ticks(),before=structuredClone(sample);
 const next=gangTerritorySample(sample,rows(200),'Own',sample.at-1);
 assert.deepEqual(next.powerHistory,{});assert.deepEqual(sample,before);
});
test('readiness accounts for relative growth and rival overtaking',()=>{
 const w={threshold:.75,rivals:[{power:10,rate:1},{power:20,rate:0}]};
 assert.equal(gangWarfareReadyDelay(0,4,w),30);
 assert.equal(gangWarfareReadyDelay(0,2,w),Infinity);
 assert.equal(gangWarfareReadyDelay(0,4,w,10),60);
});
test('a faster rival can close the readiness window before another is reached',()=>{
 const w={threshold:.5,rivals:[{power:10,rate:2},{power:100,rate:0}]};
 assert.equal(gangWarfareReadyDelay(20,1,w),Infinity);
});
test('zero, perfect thresholds, no growth and malformed rivals remain safe',()=>{
 assert.equal(gangWarfareReadyDelay(0,1,{threshold:1,rivalPower:0}),Number.EPSILON);
 assert.equal(gangWarfareReadyDelay(1,1,{threshold:1,rivals:[{power:0,rate:1}]}),Infinity);
 assert.equal(gangWarfareReadyDelay(1,0,{threshold:.75,rivalPower:1}),Infinity);
 assert.equal(gangWarfareReadyDelay(1,1,{threshold:.75,rivals:[{power:1,rate:NaN}]}),Infinity);
});

test('missed ticks do not become an exaggerated single-tick growth sample',()=>{
 const sample=ticks();
 const next=gangTerritorySample(sample,rows(200),'Own',sample.tickAt+60000);
 assert.deepEqual(next.powerHistory.Rival,[]);
});

function forecast(rivals,bonusSeconds=0){
 const m={name:'A',task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:1e6,[k+'_mult']:1,[k+'_asc_mult']:1});
 const training={name:'Train Combat',difficulty:0,baseWanted:0};
 return forecastGangCrewTraining({members:{A:projectGangMember(m,null,0)},gang:{respect:100,wantedLevel:1,respectGainRate:0},training,
  tasks:{'Train Combat':training,Work:{name:'Work',difficulty:0,baseWanted:0}},horizonSeconds:100,bonusSeconds,
  warfare:{active:true,power:.1,rivalPower:1,threshold:.75,territory:.5,clashChance:0,...(rivals?{rivals}: {})},
  evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:0,respect:0,wanted:0})});
}
test('shared crew simulator uses growing rivals for readiness and exposes observation ranges',()=>{
 const fixed=forecast(),growing=forecast([{power:1,rate:1,samples:4,lowRate:.5,highRate:2}]);
 assert.ok(Number.isFinite(fixed.forecasts.A.baselineWarfareReadySeconds));
 assert.equal(growing.forecasts.A.baselineWarfareReadySeconds,Infinity);
 assert.equal(growing.diagnostics.rivalGrowth[0].samples,4);
 assert.equal(growing.diagnostics.warfare,'Observed rival growth, fixed territory');
});
test('shared crew simulator applies the same bonus clock to rival and player growth',()=>{
 const rivals=[{power:1,rate:.001,samples:4}],normal=forecast(rivals),fast=forecast(rivals,2400);
 assert.ok(Math.abs(normal.forecasts.A.baselineWarfareReadySeconds/fast.forecasts.A.baselineWarfareReadySeconds-25)<1e-8);
});
