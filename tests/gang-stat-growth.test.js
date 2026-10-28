import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGangStatTraining,gangTrainingScheduleTask,gangCommittedTraining} from '../gang-stat-policy.js';
import {projectGangMember,projectFutureGangAscension,forecastGangCrewTraining,forecastGangCrewAscensions,forecastGangEquipmentDevelopment,gangAscensionAvailability,gangPlanningHorizon,planGangGrowthTraining} from '../gang-policy.js';
import {gangPowerPurchaseAllowed} from '../gang-power-policy.js';
const keys=['hack','str','def','dex','agi','cha'];
const tasks={Work:{name:'Work',difficulty:0,strWeight:100},'Train Combat':{name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25},'Train Hacking':{name:'Train Hacking',difficulty:45,hackWeight:100},'Train Charisma':{name:'Train Charisma',difficulty:8,chaWeight:100}};
function fixture(){
 const base={task:'Work',earnedRespect:10,upgrades:[],augmentations:[],...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',k==='str'?50000:0],[k+'_asc_points',0],[k+'_asc_mult',1],[k+'_mult',1]]))};
 const members=Object.fromEntries(['A','B','C'].map(name=>[name,projectGangMember({...base,name},null,0)]));
 return {members,names:['A'],gang:{respect:10000,wantedLevel:1},training:tasks['Train Combat'],tasks,horizonSeconds:1800,windows:[60],trainingOptions:Object.keys(tasks).filter(t=>t.startsWith('Train ')),evaluate:(m,g,t)=>({value:t==='Work'?m.str:0,money:t==='Work'?m.str:0,respect:0,wanted:0})};
}
test('mixed phases prefer native skill growth over already saturated combat XP',()=>{
 const f=fixture(),m=f.members.A;
 for(const k of ['str','def','dex','agi'])Object.assign(m,{[k+'_exp']:1e12,[k]:1000});
 assert.equal(chooseGangStatTraining(m,tasks,30,projectGangMember),'Train Hacking');
 assert.equal(chooseGangStatTraining(m,tasks,NaN,projectGangMember),'Train Combat');
});
const episode={resetAt:0,startedAt:1000,until:61000,workUntil:61000,task:'Train Combat',mixedTraining:true,trainingSchedule:[{until:20,task:'Train Combat'},{until:40,task:'Train Hacking'},{until:60,task:'Train Charisma'}]};
test('schedule switches at boundaries and ends at original deadline',()=>{
 assert.equal(gangTrainingScheduleTask(episode,20999),'Train Combat');
 assert.equal(gangTrainingScheduleTask(episode,21000),'Train Hacking');
 assert.equal(gangTrainingScheduleTask(episode,41000),'Train Charisma');
 assert.equal(gangTrainingScheduleTask(episode,61000),null);
 assert.equal(gangTrainingScheduleTask(episode,0),null);
});
test('invalid schedules fail closed',()=>{
 for(const rows of [[],[{until:30,task:'Work'}],[{until:30,task:'Train Combat'}],[{until:60,task:'Train Combat'},{until:40,task:'Train Hacking'}]])assert.equal(gangTrainingScheduleTask({...episode,trainingSchedule:rows},2000),null);
});
test('committed schedules preserve remaining phases, reset scope and absolute deadline',()=>{
 const members=fixture().members,plans=gangCommittedTraining({A:episode},members,{},31000);
 assert.deepEqual(plans,[{name:'A',window:30,trainingTask:'Train Hacking',mixedTraining:true,trainingSchedule:[{until:10,task:'Train Hacking'},{until:30,task:'Train Charisma'}]}]);
 assert.deepEqual(gangCommittedTraining({A:episode},members,{A:1},31000),[]);
 assert.deepEqual(gangCommittedTraining({A:episode},members,{},61000),[]);
});
test('shared simulation accepts exact active phase boundaries and never extends short horizons',()=>{
 const f=fixture(),r=forecastGangCrewTraining({...f,horizonSeconds:90,committedTraining:[{name:'B',window:120,trainingTask:'Train Combat'}]});
 assert.equal(r.diagnostics.baselineReady,true);
 assert.ok(r.forecasts.A.baseline<1000000);
 const bad=forecastGangCrewTraining({...f,committedTraining:[{name:'B',window:60,trainingTask:'Train Combat',trainingSchedule:[{until:30,task:'Train Combat'}]}]});
 assert.equal(bad.diagnostics.baselineReady,false);
});
test('mixed training search is bounded and incomplete forecasts cannot authorize training',()=>{
 const f=fixture();let time=0;
 const r=forecastGangCrewTraining({...f,mixedTraining:true,maxPlanningMs:5,now:()=>time++});
 assert.equal(r.forecasts.A.train,false);assert.equal(r.diagnostics.timeLimited,true);
});
test('committed training reduces the baseline instead of inventing productive crew income',()=>{
 const f=fixture(),base=forecastGangCrewTraining(f),locked=forecastGangCrewTraining({...f,committedTraining:[{name:'B',window:900,trainingTask:'Train Hacking'}]});
 assert.ok(locked.forecasts.A.baseline<base.forecasts.A.baseline);
});
test('power mode permits overlap only while another member is actually productive',()=>{
 const f=fixture(),args={name:'A',members:f.members,values:{A:{value:1},B:{value:1},C:{value:1}},episodes:{B:{until:11000}},now:10000};
 assert.equal(gangAscensionAvailability(args).allowed,false);
 assert.equal(gangAscensionAvailability({...args,allowConcurrent:true}).allowed,true);
 assert.equal(gangAscensionAvailability({...args,allowConcurrent:true,episodes:{B:{until:11000},C:{until:11000}}}).allowed,false);
 assert.equal(gangAscensionAvailability({...args,allowConcurrent:true,recoveries:{A:{until:11000}}}).allowed,false);
 assert.equal(gangAscensionAvailability({...args,allowConcurrent:true,lastReset:{A:9000}}).allowed,false);
 const trainees=structuredClone(f.members);trainees.B.task='Train Combat';trainees.C.task='Train Combat';
 assert.equal(gangAscensionAvailability({...args,members:trainees,allowConcurrent:true}).allowed,false);
});
test('established power development extends horizon while route, install and reset caps prevail',()=>{
 const args={development:true,powerPriority:true,developmentAgeSeconds:4000,memberCount:12};
 assert.equal(gangPlanningHorizon(args).seconds,3600);
 assert.equal(gangPlanningHorizon({...args,developmentAgeSeconds:700,memberCount:6}).seconds,1800);
 assert.equal(gangPlanningHorizon({...args,remainingMs:100000}).seconds,80);
 assert.equal(gangPlanningHorizon({...args,installSeconds:50}).seconds,40);
 assert.equal(gangPlanningHorizon({...args,resetPending:true}).seconds,0);
 assert.equal(gangPlanningHorizon({...args,powerPriority:false}).seconds,900);
});
test('two cycle forecast performs matched alternatives without mutating members',()=>{
 const f=fixture(),before=structuredClone(f.members),ascensions={A:projectFutureGangAscension(f.members.A,f.members.A)};
 const r=forecastGangCrewAscensions({...f,ascensions,repeatAscensions:true,maxSimulations:100});
 assert.ok(r.diagnostics.twoCycleComparisons>0);
 assert.deepEqual(f.members,before);
 for(const p of r.plans){assert.ok(p.paybackSeconds<=f.horizonSeconds);assert.ok(p.ascensionCount<=2);}
});
test('second ascension eligibility is checked independently and interrupted comparisons remain bounded',()=>{
 const f=fixture(),ascensions={A:projectFutureGangAscension(f.members.A,f.members.A)};let checks=0;
 const r=forecastGangCrewAscensions({...f,ascensions,repeatAscensions:true,ascensionEligible:()=>{checks++;return false;},maxSimulations:100});
 assert.ok(checks>0);assert.ok(r.plans.every(p=>p.ascensionCount!==2));
 const short=forecastGangCrewAscensions({...f,ascensions,repeatAscensions:true,maxSimulations:1});assert.deepEqual(short.plans,[]);
});
test('equipment forecasts include power earned after an actual training phase',()=>{
 const f=fixture();f.tasks['Territory Warfare']={name:'Territory Warfare',difficulty:0};
 const r=forecastGangEquipmentDevelopment({...f,name:'A',stats:{hack:2},plannedTraining:[{name:'A',window:60,trainingTask:'Train Hacking'}],warfare:{active:true,power:1,rivalPower:100,territory:1/7,clashChance:0,threshold:.75,powerFocus:true,powerPriority:true,rivals:[{power:100,rate:0,territory:6/7,samples:4}],duty:{normalFraction:.9,bonusFraction:.75}}});
 assert.ok(r.projectedPower>r.baselinePower);assert.equal(r.powerObjective,false); // Small gains still have to pass the material payback gate.
});
test('native XP-only gear benefit requires the quoted training task and unreserved cash',()=>{
 const f=fixture(),m=f.members.A;Object.assign(m,{task:'Train Hacking',hack_exp:0,hack_mult:1,hack_asc_mult:1});
 const at=Date.now(),q={at,nodeReset:0,augReset:0,faction:'Own',horizon:900,power:1,territory:1/7,rivalPower:100,threshold:.75,trainingTask:'Train Hacking'};
 const ns={getResetInfo:()=>({lastNodeReset:0,lastAugReset:0}),getPlayer:()=>({money:10000}),read:()=>'',gang:{getGangInformation:()=>({faction:'Own',power:1,territory:1/7}),getAllGangInformation:()=>({Own:{power:1,territory:1/7},Rival:{power:100,territory:6/7}}),getMemberInformation:()=>m,getEquipmentStats:()=>({hack:1.01}),getTaskStats:t=>tasks[t]}};
 const order={member:'A',equipmentName:'Gear',cost:10,powerQuote:q,powerPaybackSeconds:60};
 assert.equal(gangPowerPurchaseAllowed(ns,order),true);
 m.task='Work';assert.equal(gangPowerPurchaseAllowed(ns,order),false);
 m.task='Train Hacking';q.reserve=9999;assert.equal(gangPowerPurchaseAllowed(ns,order),false);
});
test('selected phase schedules survive persistence without extending deadlines',()=>{
 const f=fixture(),rows=Object.keys(f.members).map(name=>({name,value:1,permitted:true,resetAt:0,mandatory:false,forecast:name==='A'?{train:true,gain:10,window:60,trainingTask:'Train Combat',mixedTraining:true,trainingSchedule:episode.trainingSchedule}:{train:false}}));
 const plan=planGangGrowthTraining(rows,{},1000);
 assert.deepEqual(plan.episodes.A.trainingSchedule,episode.trainingSchedule);assert.equal(plan.episodes.A.until,61000);
});
test('executed controller switches mixed phases, saves once and respects manual overrides',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r','');
 const start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('\n/** @param {NS} ns\n * Do some things',start);
 const policy=await import('../gang-policy.js');
 const build=Function('gangTerritorySample','gangTerritoryDeadline','gangTerritoryTiming','gangTrainingScheduleTask','manual',`
  const at=Date.now(),events=[],wantedPreparation=null,options={manualTasks:manual?{A:'Work'}:{}},assignedTasks={A:'Train Combat'},trainingPlans={A:true};
  const e={resetAt:0,startedAt:at-25000,until:at+35000,workUntil:at+35000,task:'Train Combat',mixedTraining:true,trainingSchedule:[{until:20,task:'Train Combat'},{until:40,task:'Train Hacking'},{until:60,task:'Train Charisma'}]};
  const trainingEpisodes={A:e},ascensionRecoveries={};
  const cycle={at,bonusMs:0,info:{power:10,territoryWarfareEngaged:false},others:{Own:{power:10,territory:.5}}};
  const maintenanceRequested=()=>false,myGangFaction='Own',myGangMembers=Array(12),updateInterval=200,territoryTickTime=20000;
  const getNsDataThroughFile=async()=>cycle,log=()=>{};
  let preparationPhase=null,pendingPowerPulse=null,powerCalibration=[];let lastOtherGangInfo=gangTerritorySample(null,cycle.others,'Own',at),lastLoopTime=at,territoryNextTick=at+20000,territoryTickDetected=true,isReadyForNextTerritoryTick=false,nextWarfareCheck=Infinity,warfareFinished=false,territoryTickWaitPadding=200,lastTerritoryPower=10;
  const updateMemberActivities=async()=>events.push('assign'),saveGangTraining=async()=>events.push('save');
  const onTerritoryTick=async()=>{throw Error('unexpected slow pass');};
  ${source.slice(start,end)}
  return async()=>{await mainLoop({});await mainLoop({});return {events,task:assignedTasks.A,until:e.until,original:at+35000};};`);
 for(const manual of [false,true]){
  const r=await build(policy.gangTerritorySample,policy.gangTerritoryDeadline,policy.gangTerritoryTiming,gangTrainingScheduleTask,manual)();
  assert.deepEqual(r.events,manual?[]:['assign','save']);assert.equal(r.task,manual?'Train Combat':'Train Hacking');assert.equal(r.until,r.original);
 }
});
test('two cycle forecasts require native ascension points and remain safe with cash deadlines',()=>{
 const f=fixture(),ascensions={A:projectFutureGangAscension(f.members.A,f.members.A)};
 delete f.members.A.str_asc_points;
 const missing=forecastGangCrewAscensions({...f,ascensions,repeatAscensions:true,maxSimulations:100});
 assert.equal(missing.diagnostics.twoCycleComparisons,undefined);
 const g=fixture(),r=forecastGangCrewAscensions({...g,ascensions:{A:projectFutureGangAscension(g.members.A,g.members.A)},repeatAscensions:true,goals:[{name:'cash',resource:'money',amount:1000}],maxSimulations:100});
 for(const p of r.plans)assert.ok(p.ascensionMilestones.cash<=p.baselineMilestones.cash+2);
});
