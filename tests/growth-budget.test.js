import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planSleeveAugPurchase,sleeveRecoveryForecast,sleeveAugRecoveryPlan} from '../sleeve-development-policy.js';
import {gangDevelopmentTimeline,forecastGangTraining,forecastGangAscension} from '../gang-policy.js';
const sleeve={shock:1,sync:100,skills:{strength:10},exp:{strength:10},mults:{strength_exp:1}};
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:100}};
const offers=Array.from({length:16},(_,i)=>({name:'XP '+i,cost:1+i,stats:{strength_exp:2+i*.1}}));
const input={sleeve:{...sleeve,shock:0},offers,budget:100,crimes,objective:'xp',nodeMultiplier:1,horizon:899,minBatch:1};
test('bounded purchase search returns a valid partial decision and stops starting projections',()=>{
 let projections=0;
 const p=planSleeveAugPurchase({...input,workForecast:(s,stats,t,reset)=>{projections++;return reset?100*(stats.strength_exp??1):10;},canEvaluate:()=>projections<3});
 assert.equal(projections,3);assert.equal(p.search.timeLimited,true);assert.ok(p.names.length>0);assert.ok(p.cost<=input.budget);assert.ok(p.gain>0);
 const serialized=Function('return ('+planSleeveAugPurchase.toString()+')')();
 assert.equal(serialized({...input,canEvaluate:()=>false}).search.timeLimited,true);
});
test('partial forecasts are not cached and an exhausted allowance can still reuse a full quote',()=>{
 const cache=new Map(),stats={};let checks=0;
 const partial=sleeveRecoveryForecast({...input,canEvaluate:()=>++checks<4},{cache,stats,scope:1,now:100});
 assert.equal(partial.search.timeLimited,true);assert.equal(cache.size,0);
 const full=sleeveRecoveryForecast(input,{cache,stats,scope:1,now:200});assert.equal(cache.size,1);
 const hit=sleeveRecoveryForecast({...input,canEvaluate:()=>false},{cache,stats,scope:1,now:300});
 assert.deepEqual(hit.names,full.names);assert.equal(stats.hits,1);
 const denied=sleeveRecoveryForecast({...input,budget:50,canEvaluate:()=>false},{cache,stats,scope:1,now:300});
 assert.deepEqual(denied.names,[]);assert.equal(denied.search.timeLimited,true);assert.equal(cache.size,1);
});
test('recovery planning rotates after timeout, publishes timing and preserves shared cash',()=>{
 const state={cursor:0};let tick=0;
 const sleeves=[sleeve,sleeve,sleeve],observation={sleeves:sleeves.map(()=>({rate:1}))};
 for(let pass=0;pass<3;pass++){
  const stats={};const p=sleeveAugRecoveryPlan(sleeves,sleeves.map(()=>offers),crimes,observation,100,1,null,900,
   {maxPlanningMs:4,clock:()=>tick++,state,cacheStats:stats});
  assert.equal(stats.timeLimited,true);assert.equal(state.cursor,(pass+1)%3);
  assert.ok(Object.values(p).reduce((n,q)=>n+q.cost,0)<=100);assert.ok(Number.isFinite(stats.planningMs));
 }
 const stats={};assert.deepEqual(sleeveAugRecoveryPlan(sleeves,sleeves.map(()=>offers),crimes,observation,100,1,null,900,
  {maxPlanningMs:0,clock:()=>0,cacheStats:stats}),{});assert.equal(stats.timeLimited,true);
 assert.match(readFileSync(new URL('../sleeve.js',import.meta.url),'utf8'),/maxPlanningMs:40,state:recoveryPlanningState/);
});
test('automatic bonus windows shorten simulated training while explicit windows are respected',()=>{
 const ordinary=gangDevelopmentTimeline(900),fast=gangDevelopmentTimeline(900,null,24000);
 assert.deepEqual(ordinary.durations,[20,60,120,200,300]);
 assert.ok(fast.durations.includes(2));assert.ok(fast.durations.includes(2.4));assert.ok(fast.durations.includes(12));
 assert.ok(fast.times.length<200);assert.ok(fast.durations.every(s=>s>=2&&s<900));
 assert.deepEqual(gangDevelopmentTimeline(900,[60,120],24000).durations,[60,120]);
 assert.deepEqual(gangDevelopmentTimeline(900,[],24000).durations,[]);
 assert.deepEqual(gangDevelopmentTimeline(NaN),{durations:[],times:[]});
});
test('the shared timeline includes finite bonus exhaustion and never manufactures training gains',()=>{
 const timeline=gangDevelopmentTimeline(900,null,240);assert.ok(timeline.times.includes(10));
 const member={str:1,str_exp:0,str_mult:1,str_asc_mult:1},work={name:'Work',difficulty:1,strWeight:100};
 const evaluate=m=>({value:m.str,task:'Work'});
 for(const bonus of [0,24,240,24000])assert.equal(forecastGangTraining(member,work,{Work:work},evaluate,900,null,bonus).train,false);
 assert.equal(forecastGangTraining(member,work,{Work:work},evaluate,4,null,240).train,false);
});
test('ascension respects an explicitly disabled candidate set during bonus time',()=>{
 const member={name:'A',str:1,str_exp:0,str_mult:1,str_asc_mult:1,task:'Work'},work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
 const plan=forecastGangAscension({members:{A:member},name:'A',ascended:{...member,str_asc_mult:2},gang:{respect:1,wantedLevel:1,respectForNextRecruit:10},
  training:work,tasks:{Work:work},assignments:{A:'Work'},windows:[],bonusSeconds:24000,evaluate:m=>({task:'Work',value:m.str,money:m.str,respect:1,wanted:0})});
 assert.equal(plan,null);
});
test('training can select a short bonus window instead of overtraining for twenty seconds',()=>{
 const member={str:1,str_exp:0,str_mult:1,str_asc_mult:1},work={name:'Work',difficulty:1,strWeight:100},training={difficulty:30,strWeight:100};
 const evaluate=m=>({value:m.str>=20?100:1,task:'Work'});
 const previous=forecastGangTraining(member,training,{Work:work},evaluate,900,[20,60,120,200,300],240);
 const current=forecastGangTraining(member,training,{Work:work},evaluate,900,null,240);
 assert.equal(previous.window,20);assert.ok(current.train);assert.ok(current.window>=2&&current.window<20);
});
