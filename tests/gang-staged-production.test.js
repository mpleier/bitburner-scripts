import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gangTwoStageWait,gangPurchaseFocus,gangPurchasePlanTiming,gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan} from '../gang-policy.js';
const rate=(cashRate,repRate)=>({cashRate,repRate});
const task=(name,money,respect,wanted=0)=>({name,money,respect,wanted});
const input=patch=>({goal:{cost:10000,rep:10000},money:0,factionRep:0,respectToRep:1,
 rates:{M:[task('Money',20,1),task('Respect',1,20),task('Mixed',8,8)]},assignments:{M:'Money'},...patch});

test('two complementary phases can fund a goal that neither can complete alone',()=>{
 const q=gangTwoStageWait({cashGap:10000,repGap:10000,first:rate(100,0),second:rate(0,100)});
 assert.equal(q.firstSeconds,100);assert.equal(q.secondSeconds,100);assert.equal(q.etaSeconds,220);
 const plan=gangPurchaseFocus(input({rates:{M:[task('Money',20,0),task('Respect',0,20)]}}));
 assert.equal(plan.etaSeconds,220);assert.equal(plan.stages.length,2);assert.ok(Number.isFinite(plan.etaSeconds));
});
test('intersection credits both resources during both phases',()=>{
 const q=gangTwoStageWait({cashGap:10000,repGap:10000,first:rate(100,5),second:rate(5,100)});
 assert.ok(Math.abs(q.firstSeconds-10000/105)<1e-9);assert.ok(Math.abs(q.etaSeconds-(20000/105+20))<1e-9);
 assert.ok(q.firstSeconds*100+q.secondSeconds*5>=10000-1e-8);
 assert.ok(q.firstSeconds*5+q.secondSeconds*100>=10000-1e-8);
});
test('staged selection beats fixed allocations and diagnostics retain only bounded task lists',()=>{
 const q=gangPurchaseFocus(input());assert.equal(q.stages.length,2);assert.ok(q.etaSeconds<250);assert.ok(q.candidates.length<=36);
 assert.deepEqual(q.stages[0].tasks,[['M',q.assignments.M.name]]);
 assert.ok(q.candidates.every(c=>!c.stages&&!c.assignments));
});
test('minimum phase duration and conservative switch overhead reject fictional tiny gains',()=>{
 const q=gangPurchaseFocus(input({goal:{cost:100,rep:100}}));assert.equal(q.stages,undefined);assert.equal(q.etaSeconds,2.5);
 const min=gangTwoStageWait({cashGap:100,repGap:1000,first:rate(100,1),second:rate(1,100)});
 assert.ok(min.firstSeconds>=20);assert.equal(min.switchDelaySeconds,20);
});
test('fresh gaps reprice an ongoing stage rather than reusing its original elapsed time',()=>{
 const first=gangPurchaseFocus(input());
 const elapsed=20,second=gangPurchaseFocus(input({money:first.cashRate*elapsed,factionRep:first.repRate*elapsed,previous:first}));
 assert.equal(second.stageKey,first.stageKey);assert.ok(Math.abs(second.firstSeconds-(first.firstSeconds-elapsed))<1e-8);
 assert.ok(Math.abs(second.etaSeconds-(first.etaSeconds-elapsed))<1e-8);
});
test('completed first resource naturally switches to the remaining production goal',()=>{
 const q=gangPurchaseFocus(input({money:10000}));assert.equal(q.focus,'respect');assert.equal(q.stages,undefined);
 const r=gangPurchaseFocus(input({factionRep:10000}));assert.equal(r.focus,'money');assert.equal(r.stages,undefined);
});
test('stages preserve training locks wanted limits and cannot use unavailable production',()=>{
 const rates={M:[task('Money',20,0,1),task('Respect',0,20,1),task('Train',0,0,0)]};
 assert.equal(gangPurchaseFocus(input({rates})),null);
 assert.equal(gangPurchaseFocus(input({rates,locked:['M'],assignments:{M:'Train'}})),null);
 assert.equal(gangTwoStageWait({cashGap:100,repGap:100,first:rate(0,0),second:rate(100,0)}),null);
});
test('invalid zero-gap duplicate and nonfinite data cannot fabricate a staged completion',()=>{
 const base={cashGap:100,repGap:100,first:rate(100,0),second:rate(0,100)};
 for(const patch of [{cashGap:-1},{repGap:NaN},{first:rate(Infinity,1)},{minFirstSeconds:0},{switchDelaySeconds:0}])
  assert.equal(gangTwoStageWait({...base,...patch}),null);
 assert.equal(gangTwoStageWait({...base,cashGap:0,repGap:0}),null);
 const q=gangPurchaseFocus(input({rates:{M:[task('Only',1,1)]}}));assert.equal(q.stages,undefined);
});
test('breakpoint optimum matches a dense independent time scan for deterministic rate cases',()=>{
 for(let i=1;i<=40;i++){
  const cashGap=1000+i*211,repGap=2000+i*151,first=rate(20+i*3,i%4),second=rate(i%5,40+i*2);
  const q=gangTwoStageWait({cashGap,repGap,first,second});assert.ok(q);
  let brute=Infinity;
  for(let t=20;t<=1000;t+=.25){
   const cash=Math.max(0,cashGap-first.cashRate*t),rep=Math.max(0,repGap-first.repRate*t);
   const wait=(gap,r)=>gap<=0?0:r>0?gap/r:Infinity,s=Math.max(wait(cash,second.cashRate),wait(rep,second.repRate));
   if(s>0)brute=Math.min(brute,t+20+s);
  }
  assert.ok(q.etaSeconds<=brute+1e-7);assert.ok(brute-q.etaSeconds<1);
 }
});

test('executed controller applies the first stage then switches when fresh cash is ready',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const begin=source.indexOf('async function optimizeGangCrime('),end=source.indexOf('async function fixWantedGainRate(',begin);
 const table=[task('Money',20,0),task('Respect',0,20),task('Train Combat',0,0),task('Vigilante Justice',0,0,-1)];
 async function run(money,assignment){
  const c=input({money,rates:{M:table},assignments:{M:assignment}}),q=gangPurchaseFocus(c);let applied=null;
  const ctx={Date,Math,Object,Number,JSON,gangPurchaseFocus,gangPurchasePlanTiming,gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan,
   myGangMembers:['M'],allTaskNames:table.map(t=>t.name),assignedTasks:{M:assignment},purchaseGoal:c.goal,purchaseFocusQuote:q,purchaseFocusContext:c,growthFocus:q.focus,
   wantedPenaltyThreshold:.01,isHackGang:false,strWantedReduction:'Vigilante Justice',memberNeedsTraining:()=>false,memberProtectedTask:()=>null,
   getGangInfoDict:async()=>({M:{name:'M',task:assignment}}),gangWantedTolerance:()=>0,updateGrowthFocus:async()=>q.focus,
   refreshForecastWantedLimits(){},refreshTrainingPlans(){},computeRepGains:(_,name)=>table.find(t=>t.name===name).respect,
   calculateMoneyGains:(_,name)=>table.find(t=>t.name===name).money,computeWantedGains:(_,name)=>table.find(t=>t.name===name).wanted,
   shuffleArray:x=>x,updateMemberActivities:async()=>{applied=ctx.assignedTasks.M;},waitForGameUpdate:async()=>({moneyGainRate:20,respectGainRate:20,wantedLevelGainRate:0,updateObserved:false}),
   formatMoney:String,formatNumberShort:String,log(){},fixWantedGainRate:async()=>{throw Error('Unexpected repair');}};
  vm.runInNewContext(source.slice(begin,end)+';globalThis.run=optimizeGangCrime;',ctx);
  const current=table.find(t=>t.name===assignment);
  await ctx.run({fileExists:()=>false},{moneyGainRate:current.money,respectGainRate:current.respect,wantedLevelGainRate:0});
  return {applied,quote:ctx.purchaseFocusQuote};
 }
 const first=await run(0,'Respect');assert.equal(first.applied,'Money');assert.equal(first.quote.stages.length,2);
 const second=await run(10000,'Money');assert.equal(second.applied,'Respect');assert.equal(second.quote.stages,undefined);
});
