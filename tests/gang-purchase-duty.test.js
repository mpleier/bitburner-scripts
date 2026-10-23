import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangReportedWantedRate,gangWarfareWorkFractions,gangWarfareProductionFactor,gangPurchasePlanTiming,gangPurchaseFocus,gangEquipmentReadiness,projectGangMember,gangObjectiveValue,planGangWantedCrew,gangWantedTolerance} from '../gang-policy.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const rows={A:{name:'A',def:150},B:{name:'B',def:1000}};
const warfare={active:true,clashChance:1,duty:{normalFraction:.1,bonusFraction:.75}};
const task=(name,money,respect,wanted=0)=>({name,money,respect,wanted});
const context={goal:{cost:1000,rep:1000},money:0,factionRep:0,respectToRep:1,workFractions:{A:{normal:.9,bonus:.25}}};
const assignments={A:task('Work',20,20)};
test('reported wanted matches an independent native batch calculation at both batch sizes',()=>{
 for(const cycles of [10,25])for(const justice of [0,1,6,12])for(const raw of [-.1,0,.5]){
  const old=100,wanted=(old+raw*cycles)*(1-justice*.001),reported=(wanted-old)/cycles;
  close(gangReportedWantedRate(raw,justice,wanted,cycles),reported);
 }
});
test('floor or unknown batch cannot fabricate a wanted mismatch; raw comparisons still work without justice',()=>{
 assert.equal(gangReportedWantedRate(-.1,1,1,10),null);
 assert.equal(gangReportedWantedRate(.1,1,100,undefined),null);
 assert.equal(gangReportedWantedRate(.1,0,1,undefined),.1);
 for(const args of [[NaN,0,1,10],[0,13,2,10],[0,1,0,10],[0,1,2,-1]])assert.equal(gangReportedWantedRate(...args),null);
});
test('defense upgrades can change another member warfare eligibility; training stays protected',()=>{
 const before=gangWarfareWorkFractions(rows,warfare),after=gangWarfareWorkFractions({...rows,B:{...rows.B,def:3000}},warfare);
 close(before.A.normal,.9);assert.equal(after.A.normal,1);close(after.B.normal,.9);
 assert.deepEqual(gangWarfareWorkFractions(rows,warfare,['A']).A,{normal:1,bonus:1});
 assert.equal(gangWarfareWorkFractions(rows,{active:false}).B.normal,1);
});
test('equipment production factors integrate work across the bonus boundary',()=>{
 close(gangWarfareProductionFactor({normal:.9,bonus:.25},100,240),(10*25*.25+90*.9)/100);
 assert.equal(gangWarfareProductionFactor({normal:1,bonus:1},0,0),0);
 assert.equal(gangWarfareProductionFactor({normal:NaN,bonus:1},100,0),0);
});
test('augmentation readiness uses pulse-adjusted cash and respect rates',()=>{
 const q=gangPurchasePlanTiming(context,assignments);close(q.cashRate,90);close(q.repRate,90);close(q.etaSeconds,1000/90);
 const quote=gangPurchaseFocus({...context,rates:{A:[assignments.A]},assignments:{A:'Work'}});
 close(quote.etaSeconds,q.etaSeconds);close(quote.assignments.A.money,20);
});
test('bonus income and external cash accrue in parallel without extending bonus into normal time',()=>{
 const c={...context,goal:{cost:100000,rep:10000},otherCashRate:50,bonusSeconds:240};
 const q=gangPurchasePlanTiming(c,assignments);
 close(q.cashSeconds,10+(100000-10*(625+50))/(90+50));
 close(q.repSeconds,10+(10000-6250)/90);
});
test('fully occupied bonus batches wait for normal production instead of returning an unreachable quote',()=>{
 const q=gangPurchasePlanTiming({...context,bonusSeconds:240,workFractions:{A:{normal:.9,bonus:0}}},assignments);
 close(q.etaSeconds,10+1000/90);
});
test('external income is not reduced by warfare downtime',()=>{
 const q=gangPurchasePlanTiming({...context,goal:{cost:1000,rep:0},otherCashRate:100,workFractions:{A:{normal:0,bonus:0}}},assignments);
 close(q.etaSeconds,10);
});
test('raw wanted limits remain enforced despite a low productive duty',()=>{
 const q=gangPurchaseFocus({...context,rates:{A:[task('Unsafe',100,100,1),task('Safe',1,1,0)]},tolerance:0});
 assert.equal(q.assignments.A.name,'Safe');assert.equal(q.wanted,0);
});
test('bonus quotes do not reuse constant-rate staged timing across bonus exhaustion',()=>{
 const q=gangPurchaseFocus({...context,bonusSeconds:240,rates:{A:[task('Cash',20,1),task('Rep',1,20),task('Balanced',8,8)]}});
 assert.ok(q);assert.equal(q.stages,undefined);assert.ok(q.candidates.every(c=>!c.stageKey));
});
test('equipment readiness reprices changed defense eligibility after an upgrade',()=>{
 const rates={A:[task('Work',20,20)]},c={...context,goal:{cost:1000,rep:0},money:500,workFractions:{A:{normal:.1,bonus:.1}}};
 const before=gangEquipmentReadiness({context:c,beforeRates:rates,afterRates:rates,cost:500,horizon:900});assert.equal(before.allowed,false);
 const after=gangEquipmentReadiness({context:c,beforeRates:rates,afterRates:rates,afterWorkFractions:{A:{normal:1,bonus:1}},cost:500,horizon:900});assert.equal(after.allowed,true);
});
test('invalid fractions and nonfinite bonus observations cannot authorize an augmentation quote',()=>{
 assert.equal(gangPurchaseFocus({...context,workFractions:{A:{normal:NaN,bonus:1}},rates:{A:[assignments.A]}}),null);
 assert.equal(gangPurchasePlanTiming({...context,bonusSeconds:Infinity},assignments),null);
});
test('native wait records observed batch size without changing unavailable-batch behavior',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function waitForGameUpdate('),end=source.indexOf('\n/**',start);
 const run=Function('myGangMembers','assignedTasks','getNsDataThroughFile','return ('+source.slice(start,end)+')')(['A'],{A:'Work'},async()=>({wantedLevel:100}));
 const normal=await run({gang:{nextUpdate:async()=>2000}},{}),bonus=await run({gang:{nextUpdate:async()=>5000}},{});
 assert.equal(normal.updateCycles,10);assert.equal(bonus.updateCycles,25);assert.equal(normal.updateObserved,true);
});
test('executed equipment quote includes whole-crew changes in power eligibility',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r',''),start=source.indexOf('        const cache=new WeakMap();\n        const rawRatesFor'),end=source.indexOf('        const {available,equipmentLimit',start);
 assert.ok(start>0&&end>start);
 const crew={};for(const [name,def]of [['A',150],['B',1000]]){
  const m={name,task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:Math.exp(((k==='def'?def:300)+200.1)/32)-534.5,[k+'_mult']:1,[k+'_asc_mult']:1});crew[name]=projectGangMember(m,null,0);
 }
 const build=Function('gangWarfareWorkFractions','gangWarfareProductionFactor','gangObjectiveValue','projectGangMember','planGangWantedCrew','gangWantedTolerance','dictMembers','lockedNames',
  `const expectedAscensionAt=()=>null,gangEquipmentLifetime=(_,h)=>h,activeWantedPreparation=()=>null;const warfare=${JSON.stringify(warfare)},locked=lockedNames,allTaskNames=['Work','Train Combat'],growthHorizon={seconds:100},equipmentBonus=0,shadow=1,growthFocus='money',plannedAscensions=new Set(),gang={respect:1000,wantedLevel:1,respectGainRate:0},wantedPenaltyThreshold=.01;
   const workTask=n=>locked.includes(n)?'Train Combat':'Work',calculateMoneyGains=(g,t,m)=>t==='Train Combat'?0:m.name==='A'?100:10,computeRepGains=()=>0,computeWantedGains=()=>0;
   ${source.slice(start,end)};return evaluate;`);
 const evaluate=build(gangWarfareWorkFractions,gangWarfareProductionFactor,gangObjectiveValue,projectGangMember,planGangWantedCrew,gangWantedTolerance,crew,[]);
 const q=evaluate(crew.B,{type:'Augmentation',stats:{def:3}},crew);
 close(q.moneyGain,50);close(q.objectiveGain,50);
 const trainingQuote=build(gangWarfareWorkFractions,gangWarfareProductionFactor,gangObjectiveValue,projectGangMember,planGangWantedCrew,gangWantedTolerance,crew,['A']);
 close(trainingQuote(crew.B,{type:'Augmentation',stats:{def:3}},crew).moneyGain,0);
});
