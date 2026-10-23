import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastGangCrewTraining,forecastGangCrewAscensions,projectGangMember} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function fixture(exp=0,mult=1.05,cap=10){
 const m=projectGangMember({name:'A',str_exp:exp,str_mult:1,str_asc_mult:1,task:'Work'},null,0);
 return {members:{A:m,B:{...m,name:'B'}},names:['A'],ascensions:{A:{member:{...m,str_exp:0,str_asc_mult:mult},respectLoss:10}},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':training},horizonSeconds:900,evaluate:(m,g,t)=>{const v=t==='Work'?Math.min(cap,m.str):0;return {value:v,money:v,respect:0,wanted:0};}};
}
test('a profitable reset is rejected when training alone achieves the same production',()=>{
 const input=fixture();assert.equal(forecastGangCrewTraining(input).forecasts.A.train,true);
 const r=forecastGangCrewAscensions(input);assert.deepEqual(r.plans,[]);assert.ok(r.trainingAlternatives.A.production>r.forecasts.A.baseline);assert.equal(r.forecasts.A.trainingAlternativeBlocked,true);
});
test('a reset with a material advantage over training alone can still qualify',()=>{
 const r=forecastGangCrewAscensions(fixture(10000,10,Infinity));assert.equal(r.plans.length,1);assert.ok(r.plans[0].production>r.trainingAlternatives.A.production);assert.equal(r.plans[0].netGain,r.plans[0].production-r.plans[0].opportunityBaseline);assert.ok(r.plans[0].opportunityBaseline>=r.trainingAlternatives.A.production);assert.ok(r.plans[0].paybackSeconds<=900);
});
test('an unmatched reset cannot bypass exhausted simulation capacity',()=>{
 const r=forecastGangCrewAscensions({...fixture(10000,10,Infinity),maxSimulations:1});assert.deepEqual(r.plans,[]);assert.equal(r.diagnostics.simulations,2);assert.equal(r.diagnostics.simulationLimited,true);
 const paired=forecastGangCrewAscensions({...fixture(10000,10,Infinity),maxSimulations:2});assert.equal(paired.diagnostics.simulations,3);assert.equal(paired.plans.length,1);
});
test('training comparisons keep native snapshots and caller options unchanged',()=>{
 const input=fixture(10000,10,1000),before=structuredClone({...input,evaluate:undefined});forecastGangCrewAscensions(input);assert.deepEqual({...input,evaluate:undefined},before);
});
test('training-only forecasts respect the same shared milestone timeline',()=>{
 const input=fixture();input.goals=[{name:'cash',resource:'money',amount:10000}];
 const r=forecastGangCrewAscensions(input);assert.deepEqual(r.plans,[]);assert.ok(Number.isFinite(r.trainingAlternatives.A.milestones.cash));
});

test('a reset cannot delay reputation newly unlocked by training alone',()=>{
 const input=fixture(0,10,Infinity);input.goals=[{name:'rep',resource:'respect',amount:1000}];
 input.evaluate=(m,g,t)=>{const v=t==='Work'?m.str*m.str_asc_mult:0;return {value:v,money:v,respect:t==='Work'&&m.name==='A'&&m.str>=20?(m.str_asc_mult>1?.1:10):0,wanted:0};};
 assert.equal(forecastGangCrewTraining(input).forecasts.A.train,true);
 const r=forecastGangCrewAscensions(input);assert.deepEqual(r.plans,[]);assert.ok(Number.isFinite(r.trainingAlternatives.A.milestones.rep));assert.equal(r.forecasts.A.trainingAlternativeBlocked,true);
});
