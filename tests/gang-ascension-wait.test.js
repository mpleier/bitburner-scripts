import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectFutureGangAscension,forecastGangCrewAscensions,projectGangMember} from '../gang-policy.js';
const keys=['hack','str','def','dex','agi','cha'];
function fixture(difficulty=500){
 const m={name:'A',task:'Work',earnedRespect:10,upgrades:['Weapon'],augmentations:['Implant']};
 for(const key of keys)Object.assign(m,{[key+'_exp']:key==='str'?5000:0,[key+'_asc_points']:0,[key+'_asc_mult']:1,[key+'_mult']:1});
 const A=projectGangMember(m,null,0),B={...A,name:'B'};
 const retained={...A};for(const key of keys)retained[key+'_mult']=1;
 const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
 return {members:{A,B},names:['A'],ascensions:{A:projectFutureGangAscension(A,retained)},
  training,tasks:{Work:{name:'Work',difficulty,strWeight:100,baseWanted:0},'Train Combat':training},
  gang:{respect:10000,wantedLevel:1,respectGainRate:0},horizonSeconds:900,waitWindows:[20,60,120],
  evaluate:(m,g,t)=>{const value=t==='Work'?m.str:0;return {task:t,value,money:value,respect:0,wanted:0};}};
}
test('future ascension follows point thresholds, multiplier floor and retained augmentations',()=>{
 const input=fixture(),m=input.members.A,retained={...m,str_mult:1.2};m.str_mult=2;
 const before=structuredClone({m,retained});
 const r=projectFutureGangAscension(m,retained);
 assert.equal(r.member.str_asc_points,4000);assert.equal(r.member.str_asc_mult,Math.sqrt(2));
 assert.equal(r.member.str_exp,0);assert.equal(r.member.str_mult,1.2);
 assert.equal(r.result.str,Math.sqrt(2));assert.equal(r.respectLoss,10);
 assert.deepEqual(r.member.upgrades,[]);assert.deepEqual(r.member.augmentations,['Implant']);
 assert.equal(r.member.hack_asc_mult,1);assert.deepEqual({m,retained},before);
 m.str_asc_points=8000;m.str_asc_mult=2;
 assert.equal(projectFutureGangAscension(m,retained).result.str,Math.sqrt(6)/2);
});
test('missing or malformed native ascension data never creates an invented multiplier',()=>{
 const {members,ascensions}=fixture();
 for(const patch of [{earnedRespect:NaN},{str_exp:Infinity},{str_asc_points:-1},{str_asc_points:undefined},{str_asc_mult:0}])
  assert.equal(projectFutureGangAscension({...members.A,...patch},ascensions.A.member),null);
 assert.equal(projectFutureGangAscension(members.A,{...ascensions.A.member,str_mult:NaN}),null);
});
test('strong working XP can favor a later ascension without authorizing it now',()=>{
 const input=fixture(),before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewAscensions(input);
 assert.deepEqual(r.plans,[]);assert.equal(r.deferred.length,1);assert.equal(r.deferred[0].waitSeconds,120);
 assert.ok(r.deferred[0].waitingGain>r.deferred[0].immediateGain*1.05);
 assert.ok(r.deferred[0].projectedMultipliers.str>input.ascensions.A.member.str_asc_mult);
 assert.deepEqual({...input,evaluate:undefined},before);
});
test('weak working XP favors a profitable immediate ascension',()=>{
 const r=forecastGangCrewAscensions(fixture(1));
 assert.equal(r.plans.length,1);assert.equal(r.deferred.length,0);
 assert.ok(r.plans[0].paybackSeconds<=900);assert.ok(r.waitChecks.A>0);
});
test('waiting earns income before the reset and increases the eventual respect deduction',()=>{
 const input=fixture(),evaluate=input.evaluate;
 input.evaluate=(m,g,t)=>({...evaluate(m,g,t),respect:t==='Work'?1:0});
 const r=forecastGangCrewAscensions(input),waiting=r.waitingForecasts.A;
 assert.ok(waiting?.train);assert.equal(waiting.respectLoss,10+waiting.waitSeconds);
 assert.ok(waiting.projectedMultipliers.str>input.ascensions.A.member.str_asc_mult);
});
test('waiting can preserve an augmentation milestone that immediate recovery would delay',()=>{
 const input=fixture();input.goals=[{name:'cash',group:'augmentation',resource:'money',amount:1000}];
 const r=forecastGangCrewAscensions(input);
 assert.deepEqual(r.plans,[]);assert.equal(r.forecasts.A.milestoneBlocked,true);
 assert.ok(r.waitingForecasts.A.train);
 assert.ok(r.waitingForecasts.A.trainingMilestones.cash<=r.forecasts.A.baselineMilestones.cash+2);
});
test('future native eligibility rejects impossible waits without suppressing a valid immediate plan',()=>{
 const input=fixture(1);let calls=0;
 const r=forecastGangCrewAscensions({...input,ascensionEligible:(member,state,reset)=>{calls++;assert.ok(reset.result.str>1);return false;}});
 assert.ok(calls>0);assert.ok(r.waitChecks.A>0);assert.equal(r.plans.length,1);assert.equal(r.deferred.length,0);
});
test('an unfinished wait comparison cannot authorize an otherwise profitable immediate reset',()=>{
 const r=forecastGangCrewAscensions({...fixture(1),maxSimulations:1});
 assert.deepEqual(r.plans,[]);assert.equal(r.deferred[0].reason,'Wait comparison incomplete');
 assert.equal(r.diagnostics.simulationLimited,true);
});
test('short horizons do not require waits that cannot fit alongside recovery',()=>{
 const input=fixture(1),r=forecastGangCrewAscensions({...input,horizonSeconds:35});
 assert.ok(!r.deferred.some(row=>row.reason==='Wait comparison incomplete'));
 assert.equal(r.waitChecks.A,undefined);
});
test('malformed wait windows are ignored and duplicate waits do not spend extra simulations',()=>{
 const input=fixture(1),clean=forecastGangCrewAscensions({...input,waitWindows:[20]});
 const dirty=forecastGangCrewAscensions({...input,waitWindows:[20,20,NaN,Infinity,-1,0,500]});
 assert.equal(dirty.diagnostics.simulations,clean.diagnostics.simulations);
 assert.equal(forecastGangCrewAscensions({...input,waitWindows:null}).plans.length,1);
});
test('missing native points falls back to the existing immediate forecast safely',()=>{
 const input=fixture(1);delete input.members.A.str_asc_points;
 const r=forecastGangCrewAscensions(input);assert.equal(r.plans.length,1);assert.equal(r.deferred.length,0);
});
test('search rotates immediate and delayed cases within the same bounded budget',()=>{
 const first=forecastGangCrewAscensions({...fixture(1),maxSimulations:2});assert.equal(first.nextOffset,1);
 const second=forecastGangCrewAscensions({...fixture(1),maxSimulations:2,valuationOffset:first.nextOffset});assert.equal(second.nextOffset,2);
 assert.ok(second.waitChecks.A>0);assert.equal(second.plans.length,0);
});
test('controller reports delayed alternatives but only sends immediate plans to native execution',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/waitWindows:\[20,60,120\],maxPlanningMs:150,maxSimulations:60/);
 assert.match(source,/waitingForecasts:crew.waitingForecasts,trainingAlternatives:crew.trainingAlternatives,deferred:crew.deferred/);
 assert.match(source,/for\(const plan of crew.plans\)/);
 assert.doesNotMatch(source,/for\(const plan of crew.deferred\)/);
 assert.match(source,/ascensionEligible:\(m,state,reset\)=>chooseGangAscensions/);
});
