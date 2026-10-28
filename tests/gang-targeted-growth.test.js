import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangWantedTolerance,gangTrainingTaskName,forecastGangCrewTraining,forecastGangCrewAscensions,projectGangMember,planGangTrainingBursts,restoreGangTrainingBursts,ascendGangMemberSafely,gangWarfareMemberEligible} from '../gang-policy.js';
const choices=['Train Combat','Train Hacking','Train Charisma'];
const tasks={Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':{name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25,baseWanted:0},'Train Hacking':{name:'Train Hacking',difficulty:45,hackWeight:100,baseWanted:0},'Train Charisma':{name:'Train Charisma',difficulty:8,chaWeight:100,baseWanted:0}};
function fixture(stat='cha'){
 const members=Object.fromEntries(['A','B'].map(name=>{const m={name,task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:0,[k+'_mult']:1,[k+'_asc_mult']:1});return [name,projectGangMember(m,null,0)];}));
 return {members,gang:{respect:1000,wantedLevel:1,respectGainRate:0},training:tasks['Train Combat'],trainingOptions:choices,tasks:structuredClone(tasks),names:['A'],horizonSeconds:900,
 evaluate:(m,g,t)=>{const value=t==='Work'?(m[stat]>=10?100:1):0;return {task:t,value,money:value,respect:0,wanted:0};}};
}
test('training selects the stat that unlocks productive work instead of the gang-type default',()=>{
 for(const [stat,expected]of [['str','Train Combat'],['hack','Train Hacking'],['cha','Train Charisma']]){
  const input=fixture(stat),before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewTraining(input);
  assert.equal(r.forecasts.A.train,true);assert.equal(r.forecasts.A.trainingTask,expected);
  assert.ok(r.forecasts.A.production>r.forecasts.A.baseline);assert.deepEqual({...input,evaluate:undefined},before);
 }
});
test('missing, duplicate and unsafe training task options cannot fabricate a task',()=>{
 const input=fixture('hack');delete input.tasks['Train Charisma'];
 const r=forecastGangCrewTraining({...input,trainingOptions:['Work','Train Hacking','Train Hacking','Unknown','Train Charisma']});
 assert.deepEqual(r.diagnostics.trainingTasks,['Train Hacking']);assert.equal(r.forecasts.A.trainingTask,'Train Hacking');
 assert.equal(forecastGangCrewTraining({...input,trainingOptions:['Work']}).diagnostics.baselineReady,false);
});
test('the expanded task search retains its simulation limit and rotating cursor',()=>{
 const input=fixture(),a=forecastGangCrewTraining({...input,maxSimulations:1}),b=forecastGangCrewTraining({...input,maxSimulations:1,valuationOffset:a.nextOffset});
 assert.equal(a.diagnostics.simulations,2);assert.equal(a.diagnostics.simulationLimited,true);assert.notEqual(a.nextOffset,b.nextOffset);
});
test('recovery uses its persisted task while candidate alternatives are evaluated',()=>{
 const input=fixture(),r=forecastGangCrewTraining({...input,recoveryUntil:{B:900},recoveryTasks:{B:'Train Charisma'},maxSimulations:0});
 assert.ok(r.diagnostics.baselineExperience.cha>0);assert.equal(r.diagnostics.baselineExperience.str,0);
});
test('a chosen task persists through the burst, restart and productive cooldown',()=>{
 const row={name:'A',resetAt:0,value:1,permitted:true,mandatory:false,forecast:{train:true,window:60,gain:100,trainingTask:'Train Charisma'}};
 const first=planGangTrainingBursts([row,{name:'B',value:1}],{},1000);
 assert.equal(first.episodes.A.task,'Train Charisma');
 const reset={lastNodeReset:1,lastAugReset:2},saved={nodeReset:1,augReset:2,episodes:first.episodes};
 const restored=restoreGangTrainingBursts(saved,reset,['A'],2000);assert.equal(restored.A.task,'Train Charisma');
 assert.equal(planGangTrainingBursts([row,{name:'B',value:1}],restored,62000).plans.A,false);
 saved.episodes.A.task='Work';assert.deepEqual(restoreGangTrainingBursts(saved,reset,['A'],2000),{});
});
test('native ascension applies the quoted training task and rejects non-training tasks before mutation',()=>{
 const run=task=>{const calls=[],ns={gang:{getMemberNames:()=>['A'],getGangInformation:()=>({isHacking:false}),getAscensionResult:()=>({}),getMemberInformation:()=>({}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:(n,t)=>calls.push(t)}};
  const invoke=Function('return ('+ascendGangMemberSafely.toString()+')')();
  const value=invoke(ns,'A',[],1.05,0,()=>[{name:'A'}],()=>true,{expiresAt:Date.now()+10000,name:'A',paybackSeconds:1,horizonSeconds:100,trainingTask:task});return {calls,value};};
 assert.deepEqual(run('Train Hacking').calls,['warfare','ascend','Train Hacking']);assert.deepEqual(run('Work').calls,[]);
});
test('executed task assignment retains a selected training task during warfare preparation',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('\n/** @param {NS} ns',start);let orders;
 const read=async(ns,code,path,args)=>{orders=JSON.parse(args[0]);return {deferred:false,failed:[],assigned:orders.length};};
 const build=Function('gangTrainingTaskName','gangWarfareMemberEligible','getNsDataThroughFile',`let pendingPowerPulse=null;const assignedTasks={A:'Train Charisma'},memberNeedsTraining=()=>true,isHackGang=false,memberProtectedTask=n=>gangTrainingTaskName(assignedTasks[n],false),applyGangWorkOrders=()=>{},gangMutationAllowed=()=>true,log=()=>{};${source.slice(start,end)};return updateMemberActivities;`);
 await build(gangTrainingTaskName,gangWarfareMemberEligible,read)({}, {A:{name:'A',def:1000,task:'Work'}},'Territory Warfare',{territoryClashChance:0});
 assert.deepEqual(orders,[{name:'A',task:'Train Charisma'}]);
});
test('invalid restored training names fall back to the native gang type',()=>{
 assert.equal(gangTrainingTaskName('Work',false),'Train Combat');assert.equal(gangTrainingTaskName(null,true),'Train Hacking');assert.equal(gangTrainingTaskName('Train Charisma',true),'Train Charisma');
});
test('wanted budget is continuous across the former recovery thresholds',()=>{
 const respect=100000,gain=.75;
 for(const loss of [.009,.011]){const wanted=respect*loss/(1-loss),a=gangWantedTolerance({respect,wantedLevel:wanted-.001,respectGainRate:gain}),b=gangWantedTolerance({respect,wantedLevel:wanted+.001,respectGainRate:gain});assert.ok(Math.abs(a-b)<.00001);}
});
test('wanted budget tracks ratio growth and corrects deviations over a bounded horizon',()=>{
 const respect=100000,gain=1,ratio=.009/.991,target=respect*ratio;
 const budget=gangWantedTolerance({respect,wantedLevel:target,respectGainRate:gain});assert.ok(Math.abs(budget-ratio*gain)<1e-12);
 assert.ok(gangWantedTolerance({respect,wantedLevel:target+100,respectGainRate:gain})<budget);
 assert.ok(gangWantedTolerance({respect,wantedLevel:target-100,respectGainRate:gain})>budget);
});
test('severe wanted debt recovers and bootstrap/floor cases remain productive',()=>{
 assert.equal(gangWantedTolerance({respect:1000,wantedLevel:100,respectGainRate:1}),0);
 assert.ok(gangWantedTolerance({respect:1,wantedLevel:1,respectGainRate:0})>0);
 assert.ok(gangWantedTolerance({respect:10000,wantedLevel:1,respectGainRate:1})>0);
 for(const patch of [{respect:NaN},{wantedLevel:Infinity},{respectGainRate:undefined}])assert.equal(gangWantedTolerance({respect:1000,wantedLevel:1,respectGainRate:1,...patch}),0);
});

test('alternate training tasks cannot bypass a nearby recruitment milestone',()=>{
 const input=fixture(),original=input.evaluate;
 input.goals=[{name:'recruit',resource:'respect',amount:10}];
 input.evaluate=(m,g,t)=>({...original(m,g,t),respect:t==='Work'?1:0});
 const r=forecastGangCrewTraining(input);assert.equal(r.forecasts.A.train,false);assert.equal(r.forecasts.A.milestoneBlocked,true);
});
test('alternate training tasks retain near-term warfare readiness protection',()=>{
 const input=fixture();
 for(const m of Object.values(input.members)){for(const k of ['hack','str','def','dex','agi'])m[k+'_exp']=1e6;Object.assign(m,projectGangMember(m,null,0));}
 input.warfare={active:true,power:1,rivalPower:1,threshold:.75,territory:.5,clashChance:0};
 const r=forecastGangCrewTraining(input);assert.equal(r.forecasts.A.train,false);assert.equal(r.forecasts.A.warfareBlocked,true);
});

test('wanted debt does not demand raw negative production in addition to native justice reduction',()=>{
 const budget=gangWantedTolerance({respect:100000,wantedLevel:1100,respectGainRate:.75});assert.equal(budget,0);
 // One feasible raw-neutral productive crew already decreases native wanted via justice.
 const after=(1100+budget*10)*(1-.001);assert.ok(after<1100);
});
