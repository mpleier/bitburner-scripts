import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangTerritoryTiming,gangObjectiveValue,gangObjectiveWeight,gangWantedTolerance,restoreGangProductiveTasks,rankGangEquipment,
 allocateGangEquipment,forecastGangAscension,projectGangMember,wantedRecoveryOrder,ascendGangMemberSafely,chooseGangAscensions} from '../gang-policy.js';
import {adaptiveBudgetSignals} from '../spending-policy.js';

test('post-tick restoration ignores dead members and protects existing work and training',()=>{
 const tasks={A:'Territory Warfare',B:'Train Combat',C:'Mug People',D:'Territory Warfare'},calls=[];
 const ns={gang:{getMemberNames:()=>Object.keys(tasks),getGangInformation:()=>({isHacking:false}),getMemberInformation:n=>({task:tasks[n]}),
 setMemberTask:(n,t)=>{calls.push([n,t]);tasks[n]=t;return true;}}};
 const result=restoreGangProductiveTasks(ns,{A:'Mug People',B:'Mug People',C:'Train Combat',Dead:'Mug People'},()=>true,1);
 assert.equal(result.restored,2);assert.deepEqual(calls,[['A','Mug People'],['D','Train Combat']]);
});
test('restoration honors pause before reads and between each assignment',()=>{
 assert.equal(restoreGangProductiveTasks({}, {},()=>false,1).deferred,true);
 let allowed=true,calls=0;
 const ns={gang:{getMemberNames:()=>['A','B'],getGangInformation:()=>({isHacking:true}),getMemberInformation:()=>({task:'Territory Warfare'}),setMemberTask:()=>{calls++;allowed=false;return true;}}};
 const result=restoreGangProductiveTasks(ns,{},()=>allowed,1);
 assert.equal(result.deferred,true);assert.equal(calls,1);
});
test('restoration reports genuine native rejection',()=>{
 const ns={gang:{getMemberNames:()=>['A'],getGangInformation:()=>({isHacking:false}),getMemberInformation:()=>({task:'Territory Warfare'}),setMemberTask:()=>false}};
 assert.deepEqual(restoreGangProductiveTasks(ns,{},()=>true,1).failed,['A']);
});
test('respect utility cannot claim cash payback or a profitable equipment classification',()=>{
 const order={cost:1000,moneyGain:0,objectiveGain:100000,respectGain:1};
 assert.deepEqual(rankGangEquipment([order]),[]);
 const p=rankGangEquipment([order],900,{allowProgression:true,bootstrapBudget:1000})[0];
 assert.equal(p.reason,'progression');assert.equal(p.cashPaybackSeconds,null);assert.equal(p.paybackSeconds,null);
 assert.equal(rankGangEquipment([{...order,moneyGain:10}])[0].cashPaybackSeconds,100);
 assert.deepEqual(rankGangEquipment([{cost:1,gain:100000}]),[]);
});
test('progression and recruitment purchases share one exception allowance',()=>{
 const ranked=[{cost:60,type:'Weapon',reason:'progression'},{cost:60,type:'Augmentation',reason:'recruitment'}, {cost:60,type:'Weapon',reason:'production'}];
 const orders=allocateGangEquipment(ranked,{available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:100});
 assert.deepEqual(orders,[ranked[0],ranked[2]]);
});
test('cash funding ignores old, progression and recruitment utility telemetry',()=>{
 const now=Date.now();let opportunity={paybackSeconds:1,cashPaybackSeconds:null,reason:'progression'},schemaVersion=2;
 const ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),isRunning:()=>true,write(){},read:f=>f==='tasks/gang-growth.json'?JSON.stringify({schemaVersion,at:now,pid:1,nodeReset:1,augReset:2,equipmentOpportunity:opportunity}):''};
 assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,null);
 opportunity={reason:'production',cashPaybackSeconds:60};assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,60);
 schemaVersion=undefined;assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,null);
});
test('mixed objectives use the purchase goal consistently in planning and recovery',()=>{
 const weight=gangObjectiveWeight({cost:75000,rep:100});assert.equal(weight,10);
 assert.equal(gangObjectiveValue({money:100,respect:2},'both money and respect',weight),12);
 assert.equal(gangObjectiveValue({money:100,respect:2},'respect',weight),2);
 assert.equal(gangObjectiveValue({money:100,respect:2},'money',weight),100);
 assert.equal(gangObjectiveWeight({cost:Infinity,rep:1}),1000);
 const rates={A:[{name:'Work',money:1000,respect:1,wanted:1,'both money and respect':101},{name:'Recover',money:0,respect:0,wanted:-1,'both money and respect':0}],
 B:[{name:'Work',money:2000,respect:1,wanted:1,'both money and respect':3},{name:'Recover',money:0,respect:0,wanted:-1,'both money and respect':0}]};
 assert.deepEqual(wantedRecoveryOrder(['A','B'],{A:'Work',B:'Work'},rates,'Recover','both money and respect'),['B','A']);
});
test('shared wanted tolerance retains sustain and recovery thresholds',()=>{
 assert.equal(gangWantedTolerance({respect:1000,wantedLevel:100,respectGainRate:1}),-1);
 assert.equal(gangWantedTolerance({respect:10000,wantedLevel:1,respectGainRate:1}),.1);
});
const work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
const tasks={Work:work,'Train Combat':training};
function scenario(count=12){
 const members=Object.fromEntries(Array.from({length:count},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,str_exp:i?1e9:10000,str_mult:1,str_asc_mult:1,task:'Work'},null,0)];}));
 const ascended={...members.M0,str_exp:0,str_asc_mult:10};
 const assignments=Object.fromEntries(Object.keys(members).map(n=>[n,'Work']));
 const gang={respect:1000,wantedLevel:1000,respectForNextRecruit:100000};
 const evaluate=(m,g,forced)=>{const task=forced||'Work',value=task==='Train Combat'?0:m.str*g.respect/(g.respect+g.wantedLevel);return {value,money:value,respect:0,wanted:0,task};};
 return {members,name:'M0',ascended,gang,training,tasks,assignments,evaluate,horizonSeconds:900};
}
test('whole-crew ascension rejects an individually profitable reset that harms the rest of the gang',()=>{
 const input=scenario(),evaluate=input.evaluate;
 const isolated=forecastGangAscension({...input,respectLoss:400,evaluate:(m,g,t)=>{const r=evaluate(m,g,t);return m.name==='M0'?r:{...r,value:0,money:0};}});
 assert.ok(isolated);
 assert.equal(forecastGangAscension({...input,respectLoss:400}),null);
 const good=forecastGangAscension({...input,respectLoss:0});assert.ok(good);assert.ok(good.netGain>0);assert.ok(good.paybackSeconds<=900);
});
test('ascension forecasts include recruit delay, working XP and training downtime',()=>{
 const input=scenario(3),evaluate=input.evaluate;
 const plan=forecastGangAscension({...input,gang:{...input.gang,respect:100,wantedLevel:1,respectForNextRecruit:1000},respectLoss:50,
 evaluate:(m,g,t)=>{const r=evaluate(m,g,t);return {...r,respect:r.task==='Train Combat'?0:1};}});
 assert.ok(plan);assert.ok(plan.recruitDelaySeconds>0);assert.ok(plan.recruitmentCost>0);
 const identical={...input,ascended:input.members.M0,training:work};
 assert.equal(forecastGangAscension(identical),null);
 for(const horizonSeconds of [NaN,Infinity,0,20])assert.equal(forecastGangAscension({...input,horizonSeconds}),null);
});
test('native ascension refuses changed crew membership and changed global economics',()=>{
 const names=Array.from({length:12},(_,i)=>'M'+i),calls=[];
 const ns={gang:{getMemberNames:()=>names,getGangInformation:()=>({respect:1000,wantedLevel:10}),getAscensionResult:()=>({str:2,respect:1}),getMemberInformation:()=>({str:100}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>calls.push('ascend')}};
 const plan={name:'M0',expiresAt:Date.now()+1000,paybackSeconds:60,horizonSeconds:900,member:{str:100},ascension:{str:2},adaptive:true};
 for(const patch of [{crewNames:names.slice(1)},{gang:{respect:500,wantedLevel:10}},{respectLoss:100}])
 assert.equal(ascendGangMemberSafely(ns,'M0',['str'],1.05,.05,chooseGangAscensions,()=>true,{...plan,...patch}),null);
 assert.deepEqual(calls,[]);
});
test('controller restores before development, shares goal weights and reports cash-only funding',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const tick=source.slice(source.indexOf('async function onTerritoryTick'),source.indexOf('async function updateMemberActivities'));
 assert.ok(tick.indexOf('restoreGangProductiveTasks.toString()')<tick.indexOf('nextRepRefresh'));
 assert.ok(tick.indexOf('if(restored.deferred)return;')<tick.indexOf('tryAscendMembers'));
 assert.match(source,/rates.forEach\(rate=>rate\[optStat\]=gangObjectiveValue/);
 assert.match(source,/forecastGangAscension\(\{members/);
 assert.match(source,/schemaVersion:2/);assert.match(source,/postTickRestoreMs/);
 assert.match(source,/candidate.wanted\/5>\(forecastWantedLimits/);
 assert.doesNotMatch(source,/v.money \/ 1000 \+ v.respect/);
});

test('territory timing cannot repeatedly reuse stale or unknown phases',()=>{
 const state={detected:false,nextTick:1000,now:100000,ready:false,finished:false};
 assert.deepEqual(gangTerritoryTiming(state),{prepare:false,overdue:false,management:false});
 assert.equal(gangTerritoryTiming({...state,detected:true,nextTick:null}).prepare,false);
 assert.equal(gangTerritoryTiming({...state,detected:true,now:900}).prepare,true);
 assert.equal(gangTerritoryTiming({...state,detected:true,ready:true}).overdue,true);
 assert.equal(gangTerritoryTiming({...state,finished:true}).management,true);
 assert.equal(gangTerritoryTiming({...state,finished:true}).prepare,false);
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/territoryTickDetected=false;territoryNextTick=null/);
 assert.match(source,/territoryTickDetected = true;\s+lastTerritoryPower = myGangInfo.power/);
 assert.match(source,/if \(timing.prepare\)/);
});
