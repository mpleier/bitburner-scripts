import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangEquipmentDevelopment,projectGangMember} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0},work={name:'Work',difficulty:0,baseWanted:0};
function fixture(extra={}){
 const m=projectGangMember({name:'A',str_exp:1000,str_mult:1,str_asc_mult:1,task:'Work'},null,0);
 return {members:{A:m,B:{...m,name:'B'}},name:'A',stats:{str:1.1},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:work,'Train Combat':training},horizonSeconds:900,
  evaluate:(m,g,t)=>({value:t==='Work'?m.str:0,money:t==='Work'?m.str:0,respect:0,wanted:0}),compareFreeTraining:true,trainingPermitted:true,cost:10,costWeight:1,maxSimulations:5,...extra};
}
test('equipment comparisons include free training and charge the equipment bill once',()=>{
 const f=fixture(),r=forecastGangEquipmentDevelopment(f);assert.equal(r.verified,true);assert.equal(r.comparison.checks,3);assert.equal(r.comparison.allowed,false);assert.ok(r.comparison.freeTrainingSeconds>0);
 assert.equal(r.comparison.netGain,r.production-r.comparison.cashPenalty-r.comparison.freeProduction);assert.equal(r.comparison.cashPenalty,10);
});
test('a strong profitable upgrade can beat training while unaffordable benefit cannot',()=>{
 const yes=forecastGangEquipmentDevelopment(fixture({stats:{str:100},cost:1}));assert.equal(yes.comparison.allowed,true);
 const no=forecastGangEquipmentDevelopment(fixture({stats:{str:100},cost:1e12}));assert.equal(no.comparison.allowed,false);
});
test('manual and no-training settings compare only the retained productive plan',()=>{
 for(const patch of [{trainingPermitted:false},{fixedTasks:{A:'Work'}}]){
  const r=forecastGangEquipmentDevelopment(fixture({...patch,stats:{str:2},cost:1}));assert.equal(r.comparison.checks,0);assert.equal(r.comparison.freeTrainingSeconds,0);assert.equal(r.comparison.allowed,true);
 }
});
test('incomplete comparisons cannot authorize purchases or reuse partial benefits',()=>{
 assert.equal(forecastGangEquipmentDevelopment(fixture({maxSimulations:2})),null);
 for(const patch of [{cost:NaN},{costWeight:-1},{maxPlanningMs:0}])assert.equal(forecastGangEquipmentDevelopment(fixture(patch)),null);
});
test('committed training from the retained post-ascension crew is shared by both trajectories',()=>{
 const r=forecastGangEquipmentDevelopment(fixture({plannedTraining:[{name:'A',window:60,trainingTask:'Train Combat'}],stats:{str:2},cost:1}));assert.equal(r.verified,true);assert.equal(r.comparison.checks,3);assert.ok(r.production>r.baseline);
});
test('controller compares material purchases after ascension and preserves lifetime and readiness gates',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.ok(s.indexOf('await tryAscendMembers(ns, myGangInfo')<s.indexOf('await tryUpgradeMembers(ns, dictMembers)'));
 assert.match(s,/const ready=readinessGuard\?readinessGuard/);assert.match(s,/candidate.cost<=homeMoney\*\.01/);assert.match(s,/candidate.usefulSeconds\?\?growthHorizon.seconds/);assert.match(s,/comparisonChecks>=3/);assert.match(s,/developmentComparisons/);
});

test('fresh hypothetical ascension recovery can beat an equipment purchase without mutating the crew',()=>{
 const f=fixture(),before=structuredClone(f.members),retained={...f.members.A,str_exp:0,str_mult:1,str_asc_mult:100};
 const r=forecastGangEquipmentDevelopment({...f,alternativeAscension:{member:retained,respectLoss:1},maxSimulations:7});
 assert.equal(r.comparison.freeDevelopment,'ascension-and-recovery');assert.equal(r.comparison.checks,5);assert.equal(r.comparison.allowed,false);assert.deepEqual(f.members,before);
 assert.equal(forecastGangEquipmentDevelopment({...f,alternativeAscension:{member:retained,respectLoss:1},maxSimulations:5}),null);
});
