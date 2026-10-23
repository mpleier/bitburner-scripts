import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGangAscensions,gangAscensionTaskWeights,gangPlanningHorizon,forecastGangCrewTraining,forecastGangCrewAscensions,forecastGangEquipmentDevelopment,projectFutureGangAscension,projectGangMember,ascendGangMemberSafely} from '../gang-policy.js';
const keys=['hack','str','def','dex','agi','cha'],training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function fixture(count=3,exp=5000){
 const m={name:'M0',task:'Work',earnedRespect:10,upgrades:[],augmentations:[]};for(const k of keys)Object.assign(m,{[k+'_exp']:k==='str'?exp:0,[k+'_asc_points']:0,[k+'_asc_mult']:1,[k+'_mult']:1});const A=projectGangMember(m,null,0);
 const members=Object.fromEntries(Array.from({length:count},(_,i)=>['M'+i,{...A,name:'M'+i}]));
 return {members,names:['M0'],ascensions:{M0:projectFutureGangAscension(A,A)},training,tasks:{Work:{name:'Work',difficulty:0,strWeight:100,baseWanted:0},'Train Combat':training},gang:{respect:10000,wantedLevel:1},horizonSeconds:1800,waitWindows:[20,60,120],maxSimulations:120,evaluate:(m,g,t)=>{const value=t==='Work'?m.str:0;return {task:t,value,money:value,respect:0,wanted:0};}};
}
test('task-aware ascension admits useful hacking and charisma gains in a combat gang',()=>{
 const input=fixture(),tasks={Work:{name:'Work',strWeight:100},Fraud:{name:'Fraud',hackWeight:70,chaWeight:30}};
 const results={M0:{hack:2,cha:2,str:1,def:1,dex:1,agi:1,respect:1}},weights=gangAscensionTaskWeights(input.members,results,tasks,(m,t)=>({value:t==='Fraud'?m.hack*1000+m.cha:1}));
 assert.deepEqual(weights.M0,{hack:70,cha:30});
 assert.equal(chooseGangAscensions(results,input.gang,Object.keys(input.members),['str','def','dex','agi'],1.05,0,12,true).length,0);
 assert.equal(chooseGangAscensions(results,input.gang,Object.keys(input.members),weights,1.05,0,12,true).length,1);
});
test('weighted ascension rejects missing or malformed weights and preserves loss guard',()=>{
 const results={M0:{hack:2,respect:100}},gang={respect:1000,respectForNextRecruit:10000};
 for(const weights of [{},{M0:{}},{M0:{hack:NaN}},{M0:{hack:-1}}])assert.deepEqual(chooseGangAscensions(results,gang,['M0'],weights,1.05,0,12,true),[]);
 assert.deepEqual(chooseGangAscensions({M0:{hack:2,respect:101}},gang,['M0'],{M0:{hack:1}},1.05,0,12,true),[]);
});
test('native ascension retains snapshot guards with task-aware weights',()=>{
 const input=fixture(2),m=input.members.M0,results={M0:{hack:2,cha:2,respect:1}},calls=[];
 const ns={gang:{getMemberNames:()=>Object.keys(input.members),getGangInformation:()=>input.gang,getAscensionResult:n=>results[n]||null,getMemberInformation:n=>input.members[n],setTerritoryWarfare:()=>calls.push('war'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const quote={adaptive:true,name:'M0',expiresAt:Date.now()+5000,paybackSeconds:20,horizonSeconds:900,member:m,ascension:results.M0};
 assert.ok(ascendGangMemberSafely(ns,'M0',{M0:{hack:70,cha:30}},1.05,0,chooseGangAscensions,()=>true,quote));assert.deepEqual(calls,['war','ascend','train']);
});
test('a proposed crew training plan cannot authorize an inferior reset',()=>{
 const input=fixture(3,0);input.ascensions.M0={member:{...input.members.M0,str_asc_mult:1.05},respectLoss:0};input.waitWindows=[];
 input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.str>=30?100:1):0;return {value,money:value,respect:0,wanted:0};};
 const referenceTraining=['M0','M1'].map(name=>({name,window:60,trainingTask:'Train Combat'}));
 const r=forecastGangCrewAscensions({...input,referenceTraining});assert.deepEqual(r.plans,[]);assert.equal(r.forecasts.M0.trainingReferenceBlocked,true);assert.equal(r.diagnostics.trainingReference.members,2);
});
test('a superior ascension can compete against a newly proposed training plan',()=>{
 const input=fixture();input.waitWindows=[];input.ascensions.M0={member:{...input.members.M0,str_exp:0,str_asc_mult:10},respectLoss:0};
 const r=forecastGangCrewAscensions({...input,referenceTraining:[{name:'M0',window:60,trainingTask:'Train Combat'}]});assert.equal(r.plans.length,1);assert.ok(r.plans[0].opportunityBaseline>=r.diagnostics.trainingReference.production);
});
test('incomplete and malformed training references cannot authorize a reset',()=>{
 for(const referenceTraining of [null,[null],[{name:'missing',window:60,trainingTask:'Train Combat'}]])assert.deepEqual(forecastGangCrewAscensions({...fixture(),referenceTraining}).plans,[]);
 let tick=0;const r=forecastGangCrewAscensions({...fixture(),referenceTraining:[{name:'M0',window:60,trainingTask:'Train Combat'}],now:()=>tick++,maxPlanningMs:5});assert.deepEqual(r.plans,[]);
});
test('group search can preserve the strongest producer instead of always training the first-ranked member',()=>{
 const input=fixture(4,0);input.ascensions=null;input.names=null;input.growthFirst=true;input.allowJointTraining=true;input.goals=[{name:'cash',resource:'money',amount:1000}];
 input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.name==='M0'?(m.str>=30?500:100):(m.str>=30?100:1)):0;return {value,money:value,respect:0,wanted:0};};
 const r=forecastGangCrewTraining(input);assert.ok(r.jointPlan);assert.ok(r.jointPlan.members.every(m=>m.name!=='M0'));assert.ok(r.jointPlan.trainingMilestones.cash<=r.jointPlan.baselineMilestones.cash+2);
});
test('development horizons may reach three hours but route and install bounds still win',()=>{
 const base={baseSeconds:900,recruitSeconds:80000,development:true};assert.equal(gangPlanningHorizon(base).seconds,10800);
 assert.equal(gangPlanningHorizon({...base,remainingMs:100000}).seconds,80);assert.equal(gangPlanningHorizon({...base,installSeconds:100}).seconds,80);assert.equal(gangPlanningHorizon({...base,resetPending:true}).seconds,0);
 assert.equal(gangPlanningHorizon({...base,development:false}).seconds,3600);
});
test('training before ascension is forecast with a future point gain and recovery',()=>{
 const input=fixture(2),before=structuredClone({...input,evaluate:undefined});const r=forecastGangCrewAscensions({...input,developmentCycles:true});
 const cycle=r.deferred.find(p=>p.preTrainingSeconds>0);assert.ok(cycle);assert.equal(r.plans.length,0);assert.ok(cycle.projectedMultipliers.str>input.ascensions.M0.member.str_asc_mult);assert.ok(cycle.trainingSeconds>0);assert.deepEqual({...input,evaluate:undefined},before);
});
test('a future cycle must pass projected native ascension eligibility',()=>{
 let calls=0;const r=forecastGangCrewAscensions({...fixture(2),developmentCycles:true,ascensionEligible:()=>{calls++;return false;}});assert.ok(calls>0);assert.ok(!r.deferred.some(p=>p.preTrainingSeconds>0));
});
test('equipment return forecasts account for XP earned during currently planned training',()=>{
 const input=fixture(3,0),before=structuredClone({...input,evaluate:undefined});
 const result=forecastGangEquipmentDevelopment({...input,name:'M0',stats:{str:2},plannedTraining:[{name:'M0',window:300,trainingTask:'Train Combat'}]});
 assert.ok(result?.verified);assert.ok(result.moneyGain>0);assert.ok(result.objectiveGain>0);assert.ok(result.production>result.baseline);assert.deepEqual({...input,evaluate:undefined},before);
});
test('equipment comparisons reject malformed schedules, stats and interrupted forecasts',()=>{
 const input={...fixture(),name:'M0',stats:{str:2},plannedTraining:[{name:'M0',window:60,trainingTask:'Train Combat'}]};
 for(const patch of [{stats:{str:NaN}},{stats:{str:.5}},{stats:{money:2}},{plannedTraining:[{name:'M0',window:901,trainingTask:'Train Combat'}]},{maxPlanningMs:0}])assert.equal(forecastGangEquipmentDevelopment({...input,...patch}),null);
 const noBenefit=forecastGangEquipmentDevelopment({...input,stats:{str:1}});assert.equal(noBenefit.objectiveGain,0);
});
test('controller compares boundary alternatives while retaining active episode locks',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(source,/const trainingLocks=trainingEpisodes;\s*await refreshTrainingPlans/);assert.match(source,/tryAscendMembers\(ns, myGangInfo,trainingLocks\)/);
 assert.match(source,/episodes:trainingLocks,recoveries:ascensionRecoveries/);assert.match(source,/referenceTraining:trainingReference,developmentCycles:!options\['no-training'\]/);
 assert.match(source,/delete trainingEpisodes\[member\];trainingReference=trainingReference.filter\(p=>p.name!==member\);trainingPlans\[member\]=true/);
});
test('cycle persistence schedules only training now and enforces a short active phase',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const start=source.indexOf('        if(!plans.length){'),end=source.indexOf('        plannedAscensions=',start),block=source.slice(start,end);
 assert.match(block,/developmentCycle:true/);assert.match(block,/preTrainingSeconds<=120/);assert.doesNotMatch(block,/ascendMember|runCommand|setTimeout/);
 assert.match(source,/cycleActive=.*cycle\.until-cycle\.startedAt<=120000/);
});

test('equipment production matches an independent native XP calculation after a fixed training phase',()=>{
 const input=fixture(3,0),duration=300,horizon=1800;
 const result=forecastGangEquipmentDevelopment({...input,name:'M0',stats:{str:2},plannedTraining:[{name:'M0',window:duration,trainingTask:'Train Combat'}]});
 const skill=mult=>Math.max(1,Math.floor(mult*(32*Math.log(duration*5*Math.pow(100,.9)*100/1500*((mult-1)/4+1)+534.5)-200)));
 const expected=(skill(2)-skill(1))*(horizon-duration)/horizon;assert.ok(Math.abs(result.moneyGain-expected)<1e-9);
});
test('an interrupted training-only wait comparison does not count as verified',()=>{
 const input=fixture(2,50000),r=forecastGangCrewAscensions({...input,maxSimulations:3});
 assert.equal(r.waitChecks.M0,undefined);assert.deepEqual(r.plans,[]);assert.ok(r.deferred.some(p=>p.reason==='Wait comparison incomplete'));
});

test('nonfinite native ascension multipliers cannot pass a weighted eligibility check',()=>{
 assert.deepEqual(chooseGangAscensions({M0:{hack:Infinity,respect:1}},{respect:1000},['M0'],{M0:{hack:1}},1.05,0,12,true),[]);
});
test('the no-training option prevents training-before-ascension cycles',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(source,/developmentCycles:!options\['no-training'\]/);assert.match(source,/cycleActive=!options\['no-training'\]/);
});
