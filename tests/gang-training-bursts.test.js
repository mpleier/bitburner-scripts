import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restoreGangTrainingBursts,forecastGangTraining,planGangTrainingBursts} from '../gang-policy.js';
const row=(name,patch={})=>({name,resetAt:0,value:10,permitted:true,mandatory:false,urgent:false,forecast:{train:true,window:20,gain:100},...patch});

test('optional bursts are deterministic, staggered, and retain productive crew',()=>{
 const input=[row('B'),row('A')],copy=structuredClone(input);
 const p=planGangTrainingBursts(input,{},1000);
 assert.deepEqual(p.plans,{B:false,A:true});assert.equal(p.episodes.A.until,21000);
 assert.deepEqual(input,copy);
 assert.deepEqual(planGangTrainingBursts([row('A')],{},1000).plans,{A:false});
 assert.deepEqual(planGangTrainingBursts([row('A'),row('B',{mandatory:true})],{},1000).plans,{A:false,B:true});
});
test('a burst ends at its original deadline and cannot roll over into more training',()=>{
 const rows=[row('A'),row('B')],first=planGangTrainingBursts(rows,{},1000);
 const running=planGangTrainingBursts(rows,first.episodes,15000);
 assert.equal(running.episodes.A.until,21000);assert.equal(running.plans.A,true);
 const expired=planGangTrainingBursts(rows,running.episodes,21000);
 assert.equal(expired.plans.A,false);assert.equal(expired.plans.B,true);
 assert.equal(expired.reasons.A,'Productive interval after training');
 assert.equal(planGangTrainingBursts([row('A'),row('B',{permitted:false})],expired.episodes,41000).plans.A,true);
});
test('recruit guard, flags and milestone veto stop active optional training',()=>{
 for(const patch of [{urgent:true},{permitted:false},{forecast:{milestoneBlocked:true}}]){
  const rows=[row('A'),row('B')],state=planGangTrainingBursts(rows,{},1000).episodes;
  assert.equal(planGangTrainingBursts([row('A',patch),row('B')],state,5000).plans.A,false);
 }
});
test('recruit/ascension reset invalidates a prior episode and recovery is not slot limited',()=>{
 const old=planGangTrainingBursts([row('A'),row('B')],{},1000).episodes;
 const p=planGangTrainingBursts([row('A',{resetAt:4000,mandatory:true}),row('B',{mandatory:true})],old,5000);
 assert.deepEqual(p.episodes,{});assert.deepEqual(p.plans,{A:true,B:true});
 assert.deepEqual(planGangTrainingBursts([row('C')],old,5000).episodes,{});
});
test('invalid training windows cannot start episodes',()=>{
 for(const window of [0,-1,NaN,Infinity])assert.equal(planGangTrainingBursts([row('A',{forecast:{train:true,window,gain:100}}),row('B',{permitted:false})],{},1000).plans.A,false);
});
const member={str:1,str_exp:0,str_mult:1,str_asc_mult:1};
const train={difficulty:100,strWeight:100},work={difficulty:1,strWeight:100};
const evaluate=m=>({value:m.str>=30?100:1,money:m.str>=30?100:1,respect:m.str>=30?100:1,task:'Work'});

test('milestone-aware forecast rejects profitable training that delays an imminent recruit',()=>{
 const ordinary=forecastGangTraining(member,train,{Work:work},evaluate,900);
 assert.equal(ordinary.train,true);
 const plan=forecastGangTraining(member,train,{Work:work},evaluate,900,null,0,{other:{respect:1},goals:[{name:'recruit',resource:'respect',amount:10}]});
 assert.equal(plan.train,false);assert.equal(plan.milestoneBlocked,true);assert.equal(plan.baselineMilestones.recruit,5);
});
test('training can win when it accelerates a distant milestone',()=>{
 const p=forecastGangTraining(member,train,{Work:work},evaluate,900,null,0,{goals:[{name:'recruit',resource:'respect',amount:20000}]});
 assert.equal(p.train,true);assert.ok(p.trainingMilestones.recruit<p.baselineMilestones.recruit);
});
test('augmentation timing uses the slower of cash and reputation requirements',()=>{
 const p=forecastGangTraining(member,train,{Work:work},evaluate,900,null,0,{other:{respect:1000},goals:[
  {name:'rep',group:'augmentation',resource:'respect',amount:10},
  {name:'cash',group:'augmentation',resource:'money',amount:20000}]});
 assert.equal(p.train,true);assert.ok(p.trainingMilestones.cash<p.baselineMilestones.cash);
});
test('external income does not receive gang bonus-time acceleration',()=>{
 const evaluate=()=>({value:1,money:0,respect:0,task:'Work'});
 const p=forecastGangTraining(member,train,{Work:work},evaluate,100,null,2400,{otherCashRate:10,goals:[{name:'cash',resource:'money',amount:500}]});
 assert.equal(p.baselineMilestones.cash,50);
});
test('unreachable goals remain infinite and model inputs are not mutated',()=>{
 const context={other:{respect:0},goals:[{name:'rep',resource:'respect',amount:100}]},before=structuredClone(context);
 const p=forecastGangTraining(member,train,{Work:work},m=>({...evaluate(m),respect:0}),900,null,0,context);
 assert.equal(p.baselineMilestones.rep,Infinity);assert.equal(p.train,true);assert.deepEqual(context,before);
});

test('controller reload restores original deadlines but rejects stale reset scope and malformed state',()=>{
 const reset={lastNodeReset:1,lastAugReset:2};
 const episodes=planGangTrainingBursts([row('A'),row('B')],{},1000).episodes;
 const saved={nodeReset:1,augReset:2,episodes};
 assert.deepEqual(restoreGangTrainingBursts(saved,reset,['A'],5000),episodes);
 assert.deepEqual(restoreGangTrainingBursts(saved,{...reset,lastAugReset:3},['A'],5000),{});
 assert.deepEqual(restoreGangTrainingBursts(saved,reset,['A'],50000),{});
 assert.deepEqual(restoreGangTrainingBursts({...saved,episodes:{A:{...episodes.A,until:Infinity}}},reset,['A'],5000),{});
 assert.equal(planGangTrainingBursts([row('A'),row('B')],restoreGangTrainingBursts(saved,reset,['A'],15000),15000).episodes.A.until,21000);
});

test('controller checks burst deadlines on its fast loop and replans wanted-safe work',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const main=source.slice(source.indexOf('async function mainLoop('),source.indexOf('async function onTerritoryTick('));
 assert.match(main,/episode.until<=thisLoopStart/);
 assert.match(main,/if\(trainingDue[^\n]+\{\s*if\(preparationDue\)wantedPreparation.expiredHandled=true;\s*await optimizeGangCrime\(ns,myGangInfo\);\s*await updateMemberActivities\(ns\);/);
 assert.match(source,/await refreshTrainingPlans\(ns,dictMembers,myGangInfo\)/);
 assert.match(source,/episodes:trainingEpisodes/);
});

test('executed fast loop returns an expired trainee to work without a territory event',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('\n/** @param {NS} ns\n * Do some things',start);
 const policy=await import('../gang-policy.js'),at=Date.now(),events=[];
 const cycle={info:{power:10,territoryWarfareEngaged:false},others:{Own:{power:10,territory:.5}},bonusMs:0,at};
 const build=Function('gangTerritorySample','gangTerritoryDeadline','gangTerritoryTiming','cycle','events',`
  const gangTrainingScheduleTask=()=>null;const wantedPreparation=null,options={},trainingEpisodes={A:{until:cycle.at-1}},trainingPlans={A:true},ascensionRecoveries={};
  const maintenanceRequested=()=>false,myGangFaction='Own',myGangMembers=Array(12),updateInterval=200,territoryTickTime=20000;
  const getNsDataThroughFile=async()=>cycle,log=()=>{};
  let lastOtherGangInfo=gangTerritorySample(null,cycle.others,'Own',cycle.at),lastLoopTime=cycle.at,
   territoryNextTick=cycle.at+20000,territoryTickDetected=true,isReadyForNextTerritoryTick=false,
   warfareFinished=false,territoryTickWaitPadding=200,lastTerritoryPower=10;
  const onTerritoryTick=async()=>{throw Error('Unexpected territory event');};
  const optimizeGangCrime=async()=>{events.push('replan');trainingPlans.A=false;};
  const updateMemberActivities=async()=>events.push('assign');
  ${source.slice(start,end)}
  return async()=>{await mainLoop({});await mainLoop({});};`);
 await build(policy.gangTerritorySample,policy.gangTerritoryDeadline,policy.gangTerritoryTiming,cycle,events)();
 assert.deepEqual(events,['replan','assign']);
});
