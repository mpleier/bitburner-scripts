import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gangPurchaseFocus,gangPurchasePlanTiming,gangFocus,gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan} from '../gang-policy.js';
const task=(name,money,respect,wanted=0)=>({name,money,respect,wanted});
const rates={M:[task('Money',20,1),task('Respect',1,20),task('Mixed',8,8),task('Train Combat',0,0)]};
const input=patch=>({goal:{cost:100,rep:100},money:0,factionRep:0,respectToRep:1,rates,assignments:{M:'Mixed'},...patch});

test('joint readiness selects reputation despite cash below the old half-cost cutoff',()=>{
 const q=gangPurchaseFocus(input({goal:{cost:100,rep:1000}}));
 assert.equal(q.focus,'respect');assert.equal(q.etaSeconds,20);assert.equal(q.assignments.M.name,'Respect');
 assert.equal(gangFocus({members:12,money:0,factionRep:0,goal:{cost:100,rep:1000},purchaseForecast:q}),'respect');
});
test('money-limited goals choose money and symmetric goals prefer balanced work',()=>{
 const money=gangPurchaseFocus(input({goal:{cost:1000,rep:100}}));assert.equal(money.focus,'money');assert.equal(money.etaSeconds,20);
 const balanced=gangPurchaseFocus(input());assert.equal(balanced.focus,'both money and respect');assert.equal(balanced.etaSeconds,2.5);
 assert.equal(gangPurchaseFocus(input({money:100})).assignments.M.name,'Respect');
 assert.equal(gangPurchaseFocus(input({factionRep:100})).assignments.M.name,'Money');
});
test('external income is parallel with gang reputation and native conversion changes the bottleneck',()=>{
 assert.equal(gangPurchaseFocus(input({otherCashRate:100})).assignments.M.name,'Respect');
 assert.equal(gangPurchaseFocus(input({respectToRep:.01})).assignments.M.name,'Respect');
 assert.equal(gangPurchaseFocus(input({respectToRep:100})).assignments.M.name,'Money');
});
test('wanted constraints and protected training apply to every compared crew',()=>{
 const q=gangPurchaseFocus(input({rates:{M:[task('Unsafe',1000,1000,1),task('Safe',1,1)]}}));
 assert.equal(q.assignments.M.name,'Safe');assert.equal(q.wanted,0);
 const locked=gangPurchaseFocus(input({locked:['M'],assignments:{M:'Train Combat'}}));assert.equal(locked,null);
 assert.equal(gangPurchaseFocus(input({locked:['M'],assignments:{M:'Missing'}})),null);
 assert.equal(gangPurchaseFocus(input({rates:{M:[task('Unsafe',100,100,1)]}})),null);
});
test('zero gaps and zero production do not invent infinite quotes or purchases',()=>{
 const zero={M:[task('Train',0,0)]};assert.equal(gangPurchaseFocus(input({rates:zero})),null);
 const q=gangPurchaseFocus(input({rates:zero,money:100,factionRep:100}));assert.equal(q.etaSeconds,0);
 for(const patch of [{money:NaN},{respectToRep:0},{otherCashRate:Infinity},{goal:{cost:-1,rep:1}},{rates:{M:[task('Invalid',NaN,1)]}}])
  assert.equal(gangPurchaseFocus(input(patch)),null);
});
test('explicit focus and recruitment retain priority over an augmentation forecast',()=>{
 const base={members:12,money:0,factionRep:0,goal:{cost:100,rep:100},purchaseForecast:{focus:'money',etaSeconds:10}};
 assert.equal(gangFocus({...base,members:11}),'respect');
 assert.equal(gangFocus({...base,reputationFocus:true}),'respect');assert.equal(gangFocus({...base,moneyFocus:true}),'money');
 assert.equal(gangFocus({...base,purchaseForecast:null}),'both money and respect');
});
test('small changes retain a freshly repriced incumbent and large changes switch',()=>{
 const previous={focus:'respect',weight:10,etaSeconds:1};
 const slightly={M:[task('Respect',10,10),task('Money',10.2,9.9)]};
 const q=gangPurchaseFocus(input({goal:{cost:100,rep:1},rates:slightly,previous}));
 assert.equal(q.focus,'respect');assert.equal(q.etaSeconds,2);assert.equal(q.incumbent,true);
 const fast={M:[task('Respect',1,10),task('Money',20,1)]};
 assert.equal(gangPurchaseFocus(input({goal:{cost:100,rep:1},rates:fast,previous})).focus,'money');
});
test('search is deterministic bounded and does not mutate task tables',()=>{
 const copy=structuredClone(rates),a=gangPurchaseFocus(input()),b=gangPurchaseFocus(input());
 assert.deepEqual(a,b);assert.deepEqual(rates,copy);assert.ok(a.candidates.length<=36);
 assert.equal(gangPurchaseFocus(input({rates:Object.fromEntries(Array.from({length:13},(_,i)=>[String(i),rates.M]))})),null);
});
test('controller shares focus weights and retains a faster feasible allocation after optimization',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/purchaseFocusQuote\?\.weight\?\?gangObjectiveWeight/);
 assert.match(s,/eta>purchaseFocusQuote.etaSeconds/);assert.match(s,/purchaseFocus:purchaseFocusQuote/);
 assert.match(s,/Math.min\(c.cashRate,c.factionCashRate\)-Math.max\(0,gang.moneyGainRate\)\*5/);
});

test('executed controller chooses faster joint readiness even when linear utility would keep current work',async()=>{
 const table=[...rates.M,task('Vigilante Justice',0,0,-1)];
 const contextInput=input(),initial=gangPurchaseFocus(contextInput);
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const begin=source.indexOf('async function optimizeGangCrime('),end=source.indexOf('async function fixWantedGainRate(',begin);
 let applied=null;
 const ctx={Date,Math,Object,Number,JSON,gangPurchaseFocus,gangPurchasePlanTiming,gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan,
  myGangMembers:['M'],allTaskNames:table.map(t=>t.name),assignedTasks:{M:'Money'},purchaseGoal:contextInput.goal,purchaseFocusQuote:initial,purchaseFocusContext:{...contextInput,rates:undefined},growthFocus:initial.focus,
  wantedPenaltyThreshold:.01,isHackGang:false,strWantedReduction:'Vigilante Justice',memberNeedsTraining:()=>false,memberProtectedTask:()=>null,
  getGangInfoDict:async()=>({M:{name:'M',task:'Money'}}),gangWantedTolerance:()=>0,updateGrowthFocus:async()=>initial.focus,
  refreshForecastWantedLimits(){},refreshTrainingPlans(){},computeRepGains:(_,name)=>table.find(t=>t.name===name).respect,
  calculateMoneyGains:(_,name)=>table.find(t=>t.name===name).money,computeWantedGains:(_,name)=>table.find(t=>t.name===name).wanted,
  shuffleArray:x=>x,updateMemberActivities:async()=>{applied=ctx.assignedTasks.M;},waitForGameUpdate:async()=>({moneyGainRate:8,respectGainRate:8,wantedLevelGainRate:0,updateObserved:false}),
  formatMoney:String,formatNumberShort:String,log(){},fixWantedGainRate:async()=>{throw Error('Unexpected wanted repair');}};
 vm.runInNewContext(source.slice(begin,end)+';globalThis.run=optimizeGangCrime;',ctx);
 await ctx.run({fileExists:()=>false},{moneyGainRate:20,respectGainRate:1,wantedLevelGainRate:0});
 assert.equal(applied,'Mixed');
});
