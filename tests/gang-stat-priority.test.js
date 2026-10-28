import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gangStatSupportCrew,gangStatReputationAnchor,gangMoneyAllowed,gangStatPriorityAllowed,gangStatTaskRate,gangStatFundingAnchor} from '../gang-stat-policy.js';
import {gangPreparationComparison,gangPreparationStatus,releaseGangPreparationTraining} from '../gang-power-policy.js';
import {gangWarfareContext,gangWarfareDuty,forecastGangCrewTraining,planGangTrainingBursts,projectGangMember} from '../gang-policy.js';
import {gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan} from '../gang-policy.js';
const now=100000,gang={faction:'Own',power:100,territory:.2,territoryClashChance:0};
const timing={detected:true,paddingMs:200,intervalMs:200,restoreMs:1,powerFocusEnabled:true,powerPriority:true,trainingFirst:true};
const snapshot={faction:'Own',at:now,gangs:{Own:{power:100,territory:.2},R:{power:100,territory:.8}},powerHistory:{R:[1,1,1]}};
test('stat priority follows the weakest matchup and ends at the configured safe target',()=>{
 assert.equal(gangWarfareContext(gang,snapshot,.75,now,timing).statPriority,true);assert.equal(gangPreparationStatus(gang,snapshot,.75,now).objective,'stat-growth');
 assert.equal(gangWarfareContext({...gang,power:300},snapshot,.75,now,timing).statPriority,false);assert.equal(gangPreparationStatus({...gang,power:300},snapshot,.75,now).objective,'balanced');
 assert.equal(gangWarfareContext({...gang,power:300},snapshot,.8,now,timing).statPriority,true);
 assert.notEqual(gangWarfareContext(gang,{...snapshot,at:1},.75,now,timing).statPriority,true);
 assert.equal(gangWarfareContext(gang,snapshot,.75,now,{...timing,powerFocusEnabled:false}).statPriority,false);
 const tougher={...snapshot,gangs:{...snapshot.gangs,Strong:{power:200,territory:.1}}};assert.equal(gangWarfareContext({...gang,power:300},tougher,.75,now,timing).statPriority,true);
});
test('preparation prefers skill growth among qualified plans while retaining finite readiness evidence',()=>{
 const fast={statPriority:true,statGain:10,warfareReadySeconds:100,powerGain:100},strong={statPriority:true,statGain:100,warfareReadySeconds:500,powerGain:10};
 assert.ok(gangPreparationComparison(strong,fast)<0);
 assert.ok(gangPreparationComparison({...strong,statPriority:false},{...fast,statPriority:false})>0);
 assert.ok(gangPreparationComparison({...strong,warfareReadySeconds:Infinity},fast)>0);
 const rows=['Fast','Strong','Income'].map((name,i)=>({name,resetAt:0,mandatory:false,permitted:true,value:1,forecast:i===2?{train:false}:{...(i===0?fast:strong),train:true,gain:-1,powerPriority:true,powerPreparation:true,powerObjective:true,powerPaybackSeconds:20,window:60,trainingTask:'Train Combat'}}));
 const r=planGangTrainingBursts(rows,{},now,null,{growthFirst:true,preparation:true});assert.equal(r.plans.Strong,true);assert.equal(r.plans.Fast,false);assert.equal(r.plans.Income,false);
 const released=releaseGangPreparationTraining(r.episodes,{enabled:true,ready:true});assert.deepEqual(released.episodes,{});
});
function crew(){
 const training={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25},work={name:'Work',difficulty:0},war={name:'Territory Warfare',difficulty:5,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,hackWeight:15,chaWeight:5};
 const members=Object.fromEntries(Array.from({length:12},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,task:'Work',str_exp:0,str_mult:1,str_asc_mult:1,earnedRespect:0,upgrades:[],augmentations:[]},null,0)];}));
 return {members,gang:{respect:10000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:work,'Territory Warfare':war},names:['M0'],warfare:{active:true,power:1,rivalPower:100,threshold:.75,territory:1/7,clashChance:0,powerFocus:true,powerPriority:true,statPriority:true,preparation:{enabled:true,active:true},rivals:[{name:'R',power:100,rate:1,territory:6/7,samples:4}],duty:gangWarfareDuty(timing)},horizonSeconds:900,windows:[20,60,120,200,300],evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0})};
}
test('real whole-crew forecasts expose skill gains and keep cash, manual and incomplete-search guards',()=>{
 const f=crew(),r=forecastGangCrewTraining(f),p=r.forecasts.M0;
 assert.equal(r.diagnostics.statPriority,true);assert.equal(p.train,true);assert.equal(p.statPriority,true);assert.ok(p.statGain>0);assert.ok(p.stats>p.statGain);assert.equal(p.powerObjective,true);
 const protectedCash=forecastGangCrewTraining({...f,goals:[{name:'cash',resource:'money',amount:1000}],evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'&&m.name==='M0'?12:0,respect:0,wanted:0})});assert.equal(protectedCash.forecasts.M0.train,false);
 assert.equal(forecastGangCrewTraining({...f,fixedTasks:{M0:'Work'}}).forecasts.M0,undefined);
 let clock=0;assert.equal(forecastGangCrewTraining({...f,maxPlanningMs:2,now:()=>clock++}).forecasts.M0.train,false);
});
test('ordinary skill-first work protects reserves and respects explicit focus and recruitment',()=>{
 const base={preparation:{enabled:true,known:true,active:true},funding:{known:true,deprioritize:true,at:now,expiresAt:now+1000,cash:1000,target:1000,reserveShortfall:0},members:12,now};assert.equal(gangStatPriorityAllowed(base),true);
 assert.equal(gangStatPriorityAllowed({...base,funding:{...base.funding,cash:1,target:1e12,deprioritize:false}}),true);
 for(const patch of [{members:11},{preparation:{...base.preparation,active:false}},{funding:{...base.funding,reserveShortfall:1}},{funding:{...base.funding,at:1}},{funding:{...base.funding,expiresAt:now}},{options:{'no-training':true}},{options:{'money-focus':true}},{options:{'reputation-focus':true}}])assert.equal(gangStatPriorityAllowed({...base,...patch}),false);
 const member=crew().members.M0,train=crew().training;assert.ok(gangStatTaskRate(member,train,projectGangMember)>gangStatTaskRate(member,{difficulty:1,strWeight:100},projectGangMember));assert.equal(gangObjectiveValue({stats:7,money:1e12},'stats'),7);
});
test('executed ordinary task planner trains for stats while retaining one cash producer',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,''),begin=source.indexOf('async function optimizeGangCrime('),end=source.indexOf('async function fixWantedGainRate(',begin),f=crew();
 const table={'Money':{name:'Money',difficulty:1,strWeight:100,baseWanted:0},'Train Combat':f.training,'Vigilante Justice':{name:'Vigilante Justice',difficulty:1,baseWanted:-1}};
 const ctx={Date,Math,gangStatSupportCrew,memberRecoveryProtected:()=>false,trainingPlans:{},trainingEpisodes:{},trainingReference:[],saveGangTraining:async()=>{},gangStatReputationAnchor,gangMoneyAllowed,gangStatTaskRate,gangStatFundingAnchor,projectGangMember,gangObjectiveValue,gangObjectiveWeight,gangTaskTotals,planGangWantedCrew,betterGangPlan,nextWantedDowngrade,largestWantedDowngrade,improveGangPlan,
  myGangMembers:Object.keys(f.members),allTaskStats:table,allTaskNames:Object.keys(table),assignedTasks:Object.fromEntries(Object.keys(f.members).map(n=>[n,'Money'])),purchaseGoal:null,purchaseFocusQuote:{focus:'money'},purchaseFocusContext:null,growthFocus:'stats',
  wantedPenaltyThreshold:.01,isHackGang:false,strWantedReduction:'Vigilante Justice',memberProtectedTask:()=>null,memberNeedsTraining:()=>false,getGangInfoDict:async()=>f.members,gangWantedTolerance:()=>0,updateGrowthFocus:async()=> 'stats',refreshForecastWantedLimits(){},refreshTrainingPlans(){},computeRepGains:()=>0,calculateMoneyGains:(_g,t,m)=>t==='Money'?(m.name==='M0'?100:10):0,computeWantedGains:()=>0,shuffleArray:x=>x,updateMemberActivities:async()=>{},waitForGameUpdate:async()=>({moneyGainRate:100,respectGainRate:0,wantedLevelGainRate:0,updateObserved:false}),formatMoney:String,formatNumberShort:String,log(){},fixWantedGainRate:async()=>{throw Error('Unexpected repair');}};
 vm.runInNewContext(source.slice(begin,end)+';globalThis.run=optimizeGangCrime;',ctx);await ctx.run({fileExists:()=>false},{territory:1,moneyGainRate:210,respectGainRate:0,wantedLevelGainRate:0});
 assert.equal(Object.values(ctx.assignedTasks).filter(t=>t==='Train Combat').length,11);assert.equal(ctx.assignedTasks.M0,'Money');assert.equal(ctx.growthFocus,'stats');
 ctx.assignedTasks=Object.fromEntries(Object.keys(f.members).map(n=>[n,'Money']));
 await ctx.run({fileExists:()=>false},{territory:.9,moneyGainRate:210,respectGainRate:0,wantedLevelGainRate:0});
 assert.equal(Object.values(ctx.assignedTasks).filter(t=>t==='Train Combat').length,12);

 // Reproduce the live freeze: every optional trainee is protected, existing
 // wanted is severe, and every productive crime needs a justice partner.
 ctx.trainingPlans=Object.fromEntries(Object.keys(f.members).map(n=>[n,true]));
 ctx.trainingEpisodes=Object.fromEntries(Object.keys(f.members).map(n=>[n,{task:'Train Combat'}]));
 ctx.memberProtectedTask=n=>ctx.trainingPlans[n]?'Train Combat':null;
 ctx.memberRecoveryProtected=n=>n==='M11';
 ctx.computeRepGains=(_g,t)=>t==='Money'?10:0;
 ctx.computeWantedGains=(_g,t)=>t==='Money'?2:t==='Vigilante Justice'?-20:0;
 await ctx.run({fileExists:()=>false,print:()=>{}},{territory:.2,respect:875,wantedLevel:7140,moneyGainRate:0,respectGainRate:0,wantedLevelGainRate:0});
 assert.equal(Object.values(ctx.assignedTasks).filter(t=>t==='Train Combat').length,10);
 assert.equal(Object.values(ctx.assignedTasks).filter(t=>t==='Money').length,1);
 assert.equal(Object.values(ctx.assignedTasks).filter(t=>t==='Vigilante Justice').length,1);
 assert.equal(ctx.assignedTasks.M11,'Train Combat');
 for(const [name,task]of Object.entries(ctx.assignedTasks))if(task!=='Train Combat'){
  assert.equal(ctx.trainingPlans[name],false);assert.equal(ctx.trainingEpisodes[name],undefined);
 }

});
