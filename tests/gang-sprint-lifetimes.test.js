import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangEquipmentLifetime,rankGangEquipment,planMarginalGangEquipment,purchaseGangEquipment,forecastGangCrewTraining,forecastGangCrewAscensions,projectGangMember,projectFutureGangAscension,planGangTrainingBursts,restoreGangWantedPreparation,gangTerritorySample,gangTerritoryDeadline,gangTerritoryTiming} from '../gang-policy.js';
const keys=['hack','str','def','dex','agi','cha'],training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function members(count=3,exps=[]){return Object.fromEntries(Array.from({length:count},(_,i)=>{const m={name:'M'+i,task:'Work',earnedRespect:i===0?100:0,upgrades:[],augmentations:[]};for(const k of keys)Object.assign(m,{[k+'_exp']:k==='str'?(exps[i]||0):0,[k+'_asc_points']:0,[k+'_asc_mult']:1,[k+'_mult']:1});return [m.name,projectGangMember(m,null,0)];}));}
const budgets={available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:1000};
test('temporary equipment must repay within its expected lifetime while augmentations survive ascension',()=>{
 assert.equal(gangEquipmentLifetime('Weapon',900,20),20);assert.equal(gangEquipmentLifetime('Augmentation',900,20),900);assert.equal(gangEquipmentLifetime('Weapon',900,null),900);
 const base={type:'Weapon',cost:100,moneyGain:10,objectiveGain:10,respectGain:0};assert.equal(rankGangEquipment([{...base,lifetimeSeconds:5}],900).length,0);
 assert.equal(rankGangEquipment([{...base,lifetimeSeconds:20}],900).length,1);assert.equal(rankGangEquipment([{...base,type:'Augmentation',lifetimeSeconds:5}],900).length,1);
 for(const lifetimeSeconds of [-1,NaN,Infinity])assert.equal(rankGangEquipment([{...base,lifetimeSeconds}],900).length,0);
});
test('bounded equipment cannot claim recruitment that occurs after it is discarded',()=>{
 const order={type:'Weapon',cost:100,moneyGain:0,objectiveGain:0,respectGain:10},r={memberCount:5,respectRate:1,respectGap:1000,bootstrapBudget:1000};
 assert.equal(rankGangEquipment([{...order,lifetimeSeconds:20}],900,r).length,0);assert.equal(rankGangEquipment([{...order,lifetimeSeconds:120}],900,r)[0].reason,'recruitment');
 assert.equal(rankGangEquipment([{...order,type:'Augmentation',lifetimeSeconds:20}],900,r)[0].reason,'recruitment');
});
test('the relative-growth exception cannot bypass a known short equipment lifetime',()=>{
 const order={type:'Weapon',cost:100,moneyGain:0,objectiveGain:.01,relativeObjectiveGain:1,respectGain:0};
 assert.equal(rankGangEquipment([{...order,lifetimeSeconds:20}],900,{allowProgression:true,bootstrapBudget:1000}).length,0);
 assert.equal(rankGangEquipment([order],900,{allowProgression:true,bootstrapBudget:1000})[0].reason,'progression');
});
test('cheap temporary equipment receives a return forecast when ascension is near',()=>{
 let calls=0;const r=planMarginalGangEquipment({members:members(1),equipment:[{name:'Bat',type:'Weapon',cost:1,stats:{str:2}}],budgets,cheapCash:1000,cheapEligibility:()=>true,equipmentLifetime:()=>5,
  evaluate:()=>{calls++;return {moneyGain:10,objectiveGain:10,respectGain:0};},maxPurchases:1});
 assert.ok(calls>0);assert.equal(r.diagnostics.cheapFastTracked,0);assert.equal(r.orders.length,1);assert.equal(r.orders[0].reason,'production');assert.equal(r.orders[0].lifetimeSeconds,5);
});
test('expired and malformed lifetime quotes do not use cheap purchasing',()=>{
 for(const lifetime of [0,NaN,-1]){const r=planMarginalGangEquipment({members:members(1),equipment:[{name:'Bat',type:'Weapon',cost:1,stats:{str:2}}],budgets,cheapCash:1000,cheapEligibility:()=>true,equipmentLifetime:()=>lifetime,evaluate:()=>({moneyGain:10,objectiveGain:10,respectGain:0}),maxPurchases:1});assert.equal(r.orders.length,0);}
});
test('native purchase rechecks lifetime instead of spending against an expired payoff',()=>{
 let bought=0;const ns={read:()=>'',getPlayer:()=>({money:10000}),gang:{getEquipmentCost:()=>10,purchaseEquipment:()=>{bought++;return true;}}};
 const order={member:'M0',equipmentName:'Bat',type:'Weapon',cost:10,reason:'production',cashPaybackSeconds:2,lifetimeExpiresAt:Date.now()+1000};
 const r=purchaseGangEquipment(ns,[order],0,1000,()=>true,()=>true,true);assert.equal(r[0].reason,'equipment-lifetime-changed');assert.equal(bought,0);
 assert.equal(purchaseGangEquipment(ns,[{...order,lifetimeExpiresAt:Date.now()+10000}],0,1000,()=>true,()=>true,true)[0].success,true);assert.equal(bought,1);
});
function sprint(){return {members:members(),training,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':training},gang:{respect:10000,wantedLevel:1},growthFirst:true,allowJointTraining:true,horizonSeconds:1800,maxSimulations:120,goals:[{name:'recruit',resource:'respect',amount:10000}],evaluate:(m,g,t)=>{const respect=t==='Work'?(m.str>=65?10000:m.str>=30?100:m.str>=10?10:1):0;return {value:respect,money:t==='Work'?1:0,respect,wanted:0};}};}
test('recruitment sprints prefer earlier recruitment over higher production after the milestone',()=>{
 const input=sprint(),ordinary=forecastGangCrewTraining(input),fast=forecastGangCrewTraining({...input,recruitmentSprint:true});assert.ok(ordinary.jointPlan);assert.ok(fast.jointPlan);
 assert.ok(fast.jointPlan.recruitmentETA<ordinary.jointPlan.trainingMilestones.recruit);assert.ok(fast.jointPlan.production<ordinary.jointPlan.production);assert.ok(fast.jointPlan.recruitmentSecondsSaved>0);
});
test('sprints preserve imminent augmentation cash timing and do not invent unreachable recruits',()=>{
 const input=sprint();input.goals.push({name:'cash',group:'augmentation',resource:'money',amount:100});
 const r=forecastGangCrewTraining({...input,recruitmentSprint:true});assert.equal(r.jointPlan,null);assert.ok(Object.values(r.forecasts).every(f=>!f.train));
 const short=forecastGangCrewTraining({...sprint(),recruitmentSprint:true,horizonSeconds:35});if(short.jointPlan&&short.jointPlan.recruitmentETA>35)assert.equal(short.jointPlan.recruitmentSecondsSaved,0);
});
test('the scheduler can use a verified recruitment improvement without claiming production profit',()=>{
 const rows=['M0','M1','M2'].map(name=>({name,resetAt:0,permitted:true,value:1,mandatory:false,forecast:{train:false}}));
 const proposal={verified:true,gain:-100,recruitmentSecondsSaved:20,members:[{name:'M0',window:60,trainingTask:'Train Combat'},{name:'M1',window:60,trainingTask:'Train Combat'}]};
 const r=planGangTrainingBursts(rows,{},1000,proposal,{growthFirst:true});assert.equal(r.plans.M0,true);assert.equal(r.plans.M1,true);assert.equal(r.plans.M2,false);
});
function prep(){const team=members(5,[10000,0,100000,100000,100000]);return {members:team,names:['M0'],ascensions:{M0:projectFutureGangAscension(team.M0,team.M0)},training,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':training,'Vigilante Justice':{name:'Vigilante Justice',difficulty:1,strWeight:100,baseWanted:-.001}},gang:{respect:1000,wantedLevel:100},horizonSeconds:1800,waitWindows:[20,60,120],wantedPreparation:true,maxSimulations:120,evaluate:(m,g,t)=>{const value=t==='Work'?m.str*g.respect/(g.respect+g.wantedLevel):0;return {task:t,value,money:value,respect:0,wanted:t==='Vigilante Justice'?-1:0};}};}
test('wanted preparation selects a low opportunity-cost reducing worker and compares the full crew',()=>{
 const input=prep(),before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewAscensions(input),p=r.deferred.find(p=>p.preWantedSeconds>0);
 assert.ok(p);assert.equal(p.preparationMember,'M1');assert.ok(p.preWantedSeconds<=120);assert.equal(r.plans.length,0);assert.deepEqual({...input,evaluate:undefined},before);
});
test('wanted reduction alone cannot create a fictitious ascension advantage',()=>{
 const input=prep();input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.name==='M0'?100:m.name==='M1'?1:200)*g.respect/(g.respect+g.wantedLevel):0;return {task:t,value,money:value,respect:0,wanted:t==='Vigilante Justice'?-1:0};};const r=forecastGangCrewAscensions(input);assert.equal(r.plans.length,0);assert.ok(!r.deferred.some(p=>p.preWantedSeconds>0));
});
test('preparation cannot use a nonreducing worker or bypass future native eligibility',()=>{
 const input=prep(),evaluate=input.evaluate;input.evaluate=(m,g,t)=>({...evaluate(m,g,t),wanted:0});assert.ok(!forecastGangCrewAscensions(input).deferred.some(p=>p.preWantedSeconds>0));
 assert.ok(!forecastGangCrewAscensions({...prep(),ascensionEligible:()=>false}).deferred.some(p=>p.preWantedSeconds>0));
});
test('wanted preparation restores only within its reset scope, membership and bounded duration',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},p={member:'M1',target:'M0',resetAt:0,startedAt:1000,until:61000,task:'Vigilante Justice'},saved={nodeReset:1,augReset:2,wantedPreparation:p};
 assert.deepEqual(restoreGangWantedPreparation(saved,reset,['M0','M1'],{},2000),p);
 for(const bad of [{...p,until:122000},{...p,task:'Train Combat'},{...p,startedAt:3000},{...p,member:'missing'}])assert.equal(restoreGangWantedPreparation({...saved,wantedPreparation:bad},reset,['M0','M1'],{},2000),null);
 assert.equal(restoreGangWantedPreparation(saved,{...reset,lastAugReset:3},['M0','M1'],{},2000),null);assert.equal(restoreGangWantedPreparation(saved,reset,['M0','M1'],{},61000),null);
});
test('native work assignment keeps wanted preparation on justice during a warfare pulse',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('\n/** @param {NS} ns',start);let orders;
 const build=Function('getNsDataThroughFile',`const assignedTasks={M1:'Vigilante Justice'},memberProtectedTask=()=> 'Vigilante Justice',gangWarfareMemberEligible=()=>true,gangMutationAllowed=()=>true,applyGangWorkOrders=()=>{},log=()=>{};${source.slice(start,end)};return updateMemberActivities;`);
 const run=build(async(ns,code,path,args)=>{orders=JSON.parse(args[0]);return {assigned:1,failed:[]};});await run({}, {M1:{name:'M1',task:'Work',def:1000}},'Territory Warfare',{});assert.deepEqual(orders,[{name:'M1',task:'Vigilante Justice'}]);
});
test('expired wanted preparation releases work once on the fast loop',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r',''),start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('\n/** @param {NS} ns\n * Do some things',start),at=Date.now(),events=[];
 const cycle={info:{power:10,territoryWarfareEngaged:false},others:{Own:{power:10,territory:.5}},bonusMs:0,at};
 const build=Function('gangTerritorySample','gangTerritoryDeadline','gangTerritoryTiming','cycle','events',`const wantedPreparation={until:cycle.at-1},options={},trainingEpisodes={},trainingPlans={},ascensionRecoveries={};const maintenanceRequested=()=>false,myGangFaction='Own',myGangMembers=Array(12),updateInterval=200,territoryTickTime=20000,getNsDataThroughFile=async()=>cycle,log=()=>{};let lastOtherGangInfo=gangTerritorySample(null,cycle.others,'Own',cycle.at),lastLoopTime=cycle.at,territoryNextTick=cycle.at+20000,territoryTickDetected=true,isReadyForNextTerritoryTick=false,warfareFinished=false,territoryTickWaitPadding=200,lastTerritoryPower=10;const onTerritoryTick=async()=>{throw Error('Unexpected tick');},optimizeGangCrime=async()=>events.push('replan'),updateMemberActivities=async()=>events.push('assign');${source.slice(start,end)}return async()=>{await mainLoop({});await mainLoop({});};`);
 await build(gangTerritorySample,gangTerritoryDeadline,gangTerritoryTiming,cycle,events)();assert.deepEqual(events,['replan','assign']);
});

test('a known ascension beyond the planning horizon still prevents cheap-gear bypass',()=>{
 let calls=0;const r=planMarginalGangEquipment({members:members(1),equipment:[{name:'Bat',type:'Weapon',cost:1,stats:{str:2}}],budgets,cheapCash:1000,cheapEligibility:()=>true,equipmentLifetime:()=>10000,evaluate:()=>{calls++;return {moneyGain:10,objectiveGain:10,respectGain:0};},maxPurchases:1});assert.ok(calls>0);assert.equal(r.diagnostics.cheapFastTracked,0);assert.equal(r.orders[0].reason,'production');
});
test('an incomplete prep-only comparison cannot authorize a future wanted-preparation reset',()=>{
 const r=forecastGangCrewAscensions({...prep(),valuationOffset:2,maxSimulations:2});assert.deepEqual(r.plans,[]);assert.equal(r.waitChecks.M0,undefined);assert.ok(!r.deferred.some(p=>p.preWantedSeconds>0));
});

test('wanted repair cannot overwrite a protected preparation job with another task',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function fixWantedGainRate('),end=source.indexOf('async function recruitAvailableMembers(',start);let changes=0;
 const build=Function('changed',`const myGangMembers=['M1'],assignedTasks={M1:'Vigilante Justice'},strWantedReduction='Ethical Hacking',wantedRecoveryOrder=()=>['M1'],memberProtectedTask=()=> 'Vigilante Justice',log=()=>{},updateMemberActivities=async()=>changed();${source.slice(start,end)};return fixWantedGainRate;`);
 await build(()=>changes++)({}, {wantedLevelGainRate:1});assert.equal(changes,0);
});
