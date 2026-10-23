import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangCrewAscensions,gangAscensionAvailability,ascendGangMemberSafely,restoreGangTrainingBursts,projectGangMember} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
const work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
function fixture(){
 const members=Object.fromEntries(['A','B'].map(name=>[name,projectGangMember({name,str_exp:10000,str_mult:1,str_asc_mult:1,task:'Work',upgrades:[],augmentations:[]},null,0)]));
 return {members,names:['A'],ascensions:{A:{member:{...members.A,str_exp:0,str_asc_mult:10},respectLoss:10}},
  gang:{respect:1000,wantedLevel:1,respectGainRate:0},training,tasks:{Work:work,'Train Combat':training},horizonSeconds:900,
  evaluate:(m,g,t)=>({task:t,value:t==='Work'?m.str:0,money:t==='Work'?m.str:0,respect:0,wanted:0})};
}
test('shared crew ascension forecast returns positive net gains, training duration, and bounded payback',()=>{
 const input=fixture(),before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewAscensions(input);
 assert.equal(r.plans.length,1);assert.equal(r.plans[0].name,'A');
 assert.ok(r.plans[0].netGain>0);assert.ok(r.plans[0].paybackSeconds<=input.horizonSeconds);
 assert.ok(r.plans[0].trainingSeconds>0);assert.equal(r.diagnostics.model,'whole-crew');
 assert.deepEqual({...input,evaluate:undefined},before);
});
test('ascension cannot delay an imminent augmentation cash milestone',()=>{
 const input=fixture(),goals=[{name:'cash',group:'augmentation',resource:'money',amount:1000}];
 const r=forecastGangCrewAscensions({...input,goals});
 assert.deepEqual(r.plans,[]);assert.equal(r.forecasts.A.milestoneBlocked,true);
});
test('respect lost to ascension delays recruitment but does not erase faction reputation',()=>{
 const input=fixture();input.ascensions.A.respectLoss=100;
 input.evaluate=(m,g,t)=>({task:t,value:t==='Work'?m.str:0,money:0,respect:t==='Work'?1:0,wanted:0});
 const r=forecastGangCrewAscensions({...input,goals:[{name:'recruit',resource:'respect',gangRespect:true,amount:20},
  {name:'rep',resource:'respect',amount:20}]});
 assert.deepEqual(r.plans,[]);assert.equal(r.forecasts.A.baselineMilestones.recruit,10);
 // A later target allows a positive plan; its offset belongs only to gang respect.
 const late=forecastGangCrewAscensions({...input,evaluate:(m,g,t)=>{const value=t==='Work'?m.str:0;return {task:t,value,money:0,respect:value,wanted:0};},goals:[{name:'recruit',resource:'respect',gangRespect:true,amount:100000},
  {name:'rep',resource:'respect',amount:100000}]});
 // Both future milestones still have to pass the same safety gate.
 assert.ok(late.forecasts.A.baselineMilestones.rep===late.forecasts.A.baselineMilestones.recruit);
 assert.equal(late.plans.length,1);assert.ok(late.plans[0].ascensionMilestones.recruit>late.plans[0].ascensionMilestones.rep);
});
test('optional training and persisted ascension recovery each block another reset',()=>{
 const {members}=fixture(),values={A:{value:1},B:{value:1}},base={name:'A',members,values,now:5000,lastReset:{B:1000}};
 assert.equal(gangAscensionAvailability({...base,episodes:{B:{until:6000}}}).allowed,false);
 assert.equal(gangAscensionAvailability({...base,recoveries:{B:{resetAt:1000,until:6000}}}).reason,'Ascension recovery in progress');
 assert.equal(gangAscensionAvailability({...base,recoveries:{B:{resetAt:1000,until:4999}}}).allowed,true);
 assert.equal(gangAscensionAvailability({...base,recoveries:{B:{resetAt:999,until:6000}}}).allowed,true);
});
test('newly recruited and unproductive recovering members defer ascension',()=>{
 const {members}=fixture();members.B.task='Train Combat';
 const base={name:'A',members,values:{A:{value:10},B:{value:0}},lastReset:{B:1000},now:2000};
 assert.equal(gangAscensionAvailability(base).reason,'Another member is recovering');
 assert.equal(gangAscensionAvailability({...base,now:10000}).reason,'Another member is recovering');
 assert.equal(gangAscensionAvailability({...base,values:{A:{value:10},B:{value:1}},now:10000}).allowed,true);
 assert.equal(gangAscensionAvailability({...base,now:300000}).reason,'Preserve the remaining productive member');
});
test('a still-productive recovering member cannot bypass its planned recovery deadline',()=>{
 const {members}=fixture();members.B.task='Train Combat';
 const base={name:'A',members,values:{A:{value:100},B:{value:1}},lastReset:{B:1000},now:10000,
  recoveries:{B:{resetAt:1000,until:61000}}};
 assert.equal(gangAscensionAvailability(base).allowed,false);
 assert.equal(gangAscensionAvailability({...base,now:61000}).allowed,true);
});
test('native ascension refuses changed crew tasks, equipment, stats, and spent cash',()=>{
 const {members}=fixture(),names=Object.keys(members),calls=[];
 const plan={name:'A',expiresAt:Date.now()+5000,paybackSeconds:20,horizonSeconds:900,
  member:members.A,ascension:{str:2},crewNames:names,crewSnapshot:structuredClone(members),cashAtQuote:1000};
 let cash=1000;
 const ns={getServerMoneyAvailable:()=>cash,gang:{getMemberNames:()=>names,getGangInformation:()=>({respect:1000,wantedLevel:1}),
  getAscensionResult:()=>({str:2,respect:1}),getMemberInformation:name=>members[name],
  setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const invoke=()=>ascendGangMemberSafely(ns,'A',['str'],1.05,.05,()=>[{name:'A'}],()=>true,plan);
 members.B.task='Train Combat';assert.equal(invoke(),null);members.B.task='Work';
 members.B.upgrades=['Weapon'];assert.equal(invoke(),null);members.B.upgrades=[];
 const old=members.B.str;members.B.str*=2;assert.equal(invoke(),null);members.B.str=old;
 cash=900;assert.equal(invoke(),null);cash=995;assert.equal(invoke(),null);assert.deepEqual(calls,[]);
 cash=1000;assert.ok(invoke());assert.deepEqual(calls,['warfare','ascend','train']);
});
test('bounded ascension search rotates duration/member pairs and discards interrupted trajectories',()=>{
 const input=fixture(),a=forecastGangCrewAscensions({...input,maxSimulations:1});
 assert.equal(a.diagnostics.simulations,2);assert.equal(a.nextOffset,1);
 const b=forecastGangCrewAscensions({...input,maxSimulations:1,valuationOffset:a.nextOffset});assert.equal(b.nextOffset,2);
 let tick=0;const stopped=forecastGangCrewAscensions({...input,maxPlanningMs:60,now:()=>tick++});
 assert.equal(stopped.diagnostics.timeLimited,true);assert.deepEqual(stopped.plans,[]);
});
test('no multiplier change and malformed ascension snapshots cannot justify a reset',()=>{
 const input=fixture();
 assert.deepEqual(forecastGangCrewAscensions({...input,ascensions:{A:{member:input.members.A,respectLoss:10}}}).plans,[]);
 for(const respectLoss of [-1,NaN,Infinity])assert.deepEqual(forecastGangCrewAscensions({...input,ascensions:{A:{...input.ascensions.A,respectLoss}}}).plans,[]);
});
test('recovery deadlines survive reload and reset scope prevents stale restores',()=>{
 const entry={resetAt:1000,startedAt:1000,until:61000,workUntil:61000};
 const saved={nodeReset:1,augReset:2,episodes:{A:entry}},reset={lastNodeReset:1,lastAugReset:2};
 assert.deepEqual(restoreGangTrainingBursts(saved,reset,['A'],20000),{A:entry});
 assert.deepEqual(restoreGangTrainingBursts(saved,{...reset,lastAugReset:3},['A'],20000),{});
});
test('controller persists and enforces recovery while using a bounded shared purchase-aware forecast',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/forecastGangCrewAscensions\(\{members,gang:gangInfo/);
 assert.match(source,/maxPlanningMs:150,maxSimulations:60,valuationOffset:ascensionValuationCursor/);
 assert.match(source,/ascensionRecoveries\[member\]=\{resetAt,startedAt:resetAt,until,workUntil:until,task:assignedTasks\[member\],/);
 assert.match(source,/const mandatory=cycleActive\|\|recovering\|\|/);
 assert.match(source,/\(!ascensionRecovering\|\|options\['power-focus'\]\)&&row.permitted/);
 assert.match(source,/episodes:trainingEpisodes,ascensionRecoveries/);
 assert.match(source,/expiresAt:sampledAt\+5000/);
 assert.match(source,/gangRespect:true/);
 assert.match(source,/Object.entries\(ascensionRecoveries\).some\(\(\[name,recovery\]\)=>trainingPlans\[name\]&&recovery.until<=thisLoopStart\)/);
});

test('executed fast loop ends ascension recovery without waiting for territory',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('\n/** @param {NS} ns\n * Do some things',start);
 const policy=await import('../gang-policy.js'),at=Date.now(),events=[];
 const cycle={info:{power:10,territoryWarfareEngaged:false},others:{Own:{power:10,territory:.5}},bonusMs:0,at};
 const build=Function('gangTerritorySample','gangTerritoryDeadline','gangTerritoryTiming','cycle','events',`
  const gangTrainingScheduleTask=()=>null;const wantedPreparation=null,options={},trainingEpisodes={},trainingPlans={A:true},ascensionRecoveries={A:{until:cycle.at-1}};
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

test('purchase timing remains available before full recruitment and with an explicit focus',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const start=source.indexOf('async function updateGrowthFocus('),end=source.indexOf('function refreshForecastWantedLimits(',start);
 const make=Function(`let purchaseFocusQuote=null,purchaseFocusContext=null,purchaseTimingContext=null,gangFactionFavor=null,growthFocus;
  const ownedSourceFiles={4:1},myGangFaction='Faction',myGangMembers=Array(8),purchaseGoal={cost:1000,rep:100},requiredRep=100;
  const options={'money-focus':true},resetInfo={lastNodeReset:1,lastAugReset:2};
  const getNsDataThroughFile=async(ns,code)=>code==='ns.getPlayer()'?{money:500,mults:{faction_rep:2}}:{rep:50,favor:0};
  const gangFocus=()=> 'money';
  ${source.slice(start,end)}
  return async()=>{await updateGrowthFocus({read:()=>''},{moneyGainRate:0},{});return {purchaseTimingContext,purchaseFocusContext};};`);
 const result=await make()();
 assert.equal(result.purchaseTimingContext.factionRep,50);assert.equal(result.purchaseTimingContext.goal.rep,100);
 assert.equal(result.purchaseFocusContext,null);
});
