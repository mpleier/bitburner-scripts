import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chooseGangAscensions,gangAscensionAvailability,forecastGangCrewAscensions,projectGangMember,ascendGangMemberSafely} from '../gang-policy.js';
const names=Array.from({length:12},(_,i)=>'M'+i);
const choose=(loss,gang={respect:10000,wantedLevel:1},review=true)=>chooseGangAscensions({M0:{str:1.2,respect:loss}},gang,names,['str'],1.05,.05,12,true,review);
test('economic screening admits respect-heavy ascensions while legacy caps remain',()=>{
 assert.equal(choose(5000).length,1);assert.equal(choose(5000,undefined,false).length,0);
 assert.equal(choose(9999).length,0); // Immediate wanted-penalty loss exceeds the bounded screen.
 assert.equal(choose(9900,{respect:10000,wantedLevel:1000}).length,0);
 assert.equal(choose(1e20,{respect:1e20,wantedLevel:1}).length,0); // Subtracting the minimum reserve can round back to total respect.
 assert.equal(choose(9e19,{respect:1e20,wantedLevel:1}).length,1);
 assert.deepEqual(choose(0,{respect:Infinity,wantedLevel:1}),[]);
 for(const loss of [NaN,Infinity,-1])assert.deepEqual(choose(loss),[]);
 const native=Function('return ('+chooseGangAscensions.toString()+')')();assert.deepEqual(native({M0:{str:1.2,respect:5000}},{respect:10000,wantedLevel:1},names,['str'],1.05,.05,12,true,true),choose(5000));
});
test('near recruitment keeps the progress floor and never gives up an available recruit',()=>{
 const crew=names.slice(0,8),gang={respect:900,wantedLevel:1,respectForNextRecruit:1000};
 const run=(loss,g=gang)=>chooseGangAscensions({M0:{str:2,respect:loss}},g,crew,['str'],1.05,0,12,true,true);
 assert.equal(run(50).length,1);assert.equal(run(101).length,0);
 assert.equal(run(1,{...gang,respect:1000}).length,0);assert.equal(run(0,{...gang,respect:1000}).length,1);
 assert.deepEqual(chooseGangAscensions({M0:{str:2,respect:0}},gang,crew,['str'],1.05,0,12,true),[]);
});
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0},work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
function fixture(){
 const members=Object.fromEntries(['A','B','C'].map(name=>[name,projectGangMember({name,str_exp:10000,str_mult:1,str_asc_mult:1,task:'Work',upgrades:[],augmentations:[]},null,0)]));
 return {members,names:['A'],ascensions:{A:{member:{...members.A,str_exp:0,str_asc_mult:10},respectLoss:500}},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:work,'Train Combat':training},horizonSeconds:900,windows:[2,5,10,20,60],economicReview:true,evaluate:(m,g,t)=>({task:t,value:t==='Work'?m.str:0,money:t==='Work'?m.str:0,respect:0,wanted:0})};
}
test('overlapping recovery requires a remaining productive member and protects the candidate recovery',()=>{
 const f=fixture(),input={name:'A',members:f.members,values:{A:{value:1},B:{value:1},C:{value:1}},now:10000,allowConcurrent:true,recoveries:{B:{resetAt:5000,until:20000}},lastReset:{B:5000}};
 assert.equal(gangAscensionAvailability(input).allowed,true);
 assert.equal(gangAscensionAvailability({...input,episodes:{C:{until:20000}}}).allowed,false);
 assert.equal(gangAscensionAvailability({...input,episodes:{A:{until:20000}}}).reason,'Candidate training burst in progress');
 assert.equal(gangAscensionAvailability({...input,lastReset:{A:9000}}).allowed,false);
 const forecast=forecastGangCrewAscensions({...f,recoveryUntil:{B:100},recoveryTasks:{B:training.name},committedTraining:[{name:'B',window:100,trainingTask:training.name}]});
 assert.ok(forecast.plans.length);assert.equal(forecast.plans[0].economicReview,true);assert.equal(forecast.plans[0].model,'whole-crew');assert.ok(forecast.plans[0].paybackSeconds<=900);
 const blocked=forecastGangCrewAscensions({...f,windows:[60],goals:[{name:'cash',group:'augmentation',resource:'money',amount:3000}]});assert.deepEqual(blocked.plans,[]);
 let clock=0;assert.deepEqual(forecastGangCrewAscensions({...f,maxPlanningMs:2,now:()=>clock++}).plans,[]);
});
test('native recheck needs complete economic evidence to relax the respect cap',()=>{
 const members=Object.fromEntries(names.map(name=>[name,{name,...Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,100])),task:'Work',upgrades:[],augmentations:[]}])) ,calls=[];
 const gang={respect:10000,wantedLevel:1},results={str:2,respect:5000};
 const ns={getServerMoneyAvailable:()=>1000,gang:{getMemberNames:()=>names,getGangInformation:()=>gang,getAscensionResult:()=>results,getMemberInformation:n=>members[n],setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('training')}};
 const p={name:'M0',adaptive:true,economicReview:true,model:'whole-crew',expiresAt:Date.now()+5000,paybackSeconds:40,trainingSeconds:20,horizonSeconds:900,netGain:10,member:members.M0,ascension:results,gang:{...gang},crewNames:names,crewSnapshot:structuredClone(members),respectLoss:5000};
 const run=patch=>ascendGangMemberSafely(ns,'M0',['str'],1.05,.05,chooseGangAscensions,()=>true,{...p,...patch});
 for(const patch of [{economicReview:false},{model:'unknown'},{crewSnapshot:null},{netGain:0},{expiresAt:0},{paybackSeconds:901},{trainingSeconds:0}])assert.equal(run(patch),null);
 gang.wantedLevel=1000;assert.equal(run({}),null);gang.wantedLevel=1;
 assert.deepEqual(calls,[]);assert.ok(run({}));assert.deepEqual(calls,['warfare','ascend','training']);
});
test('executed controller sends young recovered members to a crew forecast outside power mode',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function tryAscendMembers('),end=source.indexOf('async function tryUpgradeMembers(',start),f=fixture();let capture;
 const now=10000;
 const ctx={Date:{now:()=>now},options:{'ascend-multi-threshold':1.05,'ascend-multi-threshold-spacing':.05,'min-training-ticks':10},myGangMembers:['A','B','C'],importantStats:['str'],isHackGang:false,territoryTickTime:20000,lastMemberReset:{A:5000},ascensionRecoveries:{B:{resetAt:5000,until:20000,task:training.name}},trainingEpisodes:{},trainingReference:[],ascensionValuationCursor:0,purchaseTimingContext:null,purchaseFocusContext:null,incomeFunding:null,lastOtherGangInfo:null,gangRivalsSnapshot:null,assignedTasks:{A:'Work',B:'Train Combat',C:'Work'},allTaskStats:f.tasks,equipments:[],growthHorizon:{seconds:900,bonusSeconds:0},detected:false,territoryTickDetected:false,territoryTickWaitPadding:200,updateInterval:200,postTickRestoreMs:1,resetInfo:{lastNodeReset:1,lastAugReset:2},
  activeWantedPreparation:()=>false,gangWarfareContext:()=>({}),gangWarfareThreshold:()=>.75,gangTrainingFirst:()=>true,gangAscensionTaskWeights:()=>['str'],gangPowerAscensionWeights:(_m,w)=>w,getGangInfoDict:async(_ns,_n,fn)=>fn==='getAscensionResult'?{A:{str:2,respect:1}}:f.members,chooseGangAscensions,gangAscensionAvailability,memberBestValue:()=>({value:1}),developmentSignature:()=>'',gangCommittedTraining:()=>[],forecastGangCrewAscensions:input=>{capture=input;return {plans:[],deferred:[],diagnostics:{},nextOffset:0};}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.run=tryAscendMembers;',ctx);await ctx.run({},f.gang);
 assert.ok(capture.ascensions.A);assert.equal(capture.economicReview,true);assert.deepEqual(Array.from(capture.windows).slice(0,3),[2,5,10]);assert.equal(capture.recoveryUntil.B,10);
});
