import test from 'node:test';
import assert from 'node:assert/strict';
import {gangPlanningHorizon} from '../gang-policy.js';
import {planSleeveAugPurchase} from '../sleeve-development-policy.js';
import {observeCorporationGrowth,scoreCorporationGrowth,executeCorporationGrowth} from '../corporation-policy.js';
import {readFileSync} from 'node:fs';
test('gang growth extends only with milestone or remaining-route evidence, with a one-hour automatic bound',()=>{
 assert.equal(gangPlanningHorizon().seconds,900);assert.equal(gangPlanningHorizon({remainingMs:4*3600000}).seconds,3600);
 assert.equal(gangPlanningHorizon({recruitSeconds:1000}).seconds,2000);assert.equal(gangPlanningHorizon({recruitSeconds:1e9}).seconds,3600);
 for(const remainingMs of [null,NaN,Infinity,-1])assert.equal(gangPlanningHorizon({remainingMs}).seconds,900);
});
test('gang deadlines cap extended windows and reset intent stops discretionary development',()=>{
 assert.equal(gangPlanningHorizon({remainingMs:100000,recruitSeconds:10000}).seconds,80);
 assert.equal(gangPlanningHorizon({remainingMs:4*3600000,installSeconds:60}).seconds,48);
 assert.equal(gangPlanningHorizon({resetPending:true}).seconds,0);
 assert.equal(gangPlanningHorizon({remainingMs:0}).seconds,0);
});
test('explicit gang baseline and disabled extension remain available without overriding known deadlines',()=>{
 assert.equal(gangPlanningHorizon({baseSeconds:1200,adaptive:false,remainingMs:10*3600000,recruitSeconds:1e6}).seconds,1200);
 assert.equal(gangPlanningHorizon({baseSeconds:1200,adaptive:false,installSeconds:50}).seconds,40);
 assert.equal(gangPlanningHorizon({baseSeconds:7200,remainingMs:10*3600000}).seconds,7200);
});
const sleeve={shock:0,sync:100};
const offers=[{name:'Cheap weak',cost:2,stats:{strength:1.01}},{name:'Strength',cost:5,stats:{strength:2}},{name:'Dexterity',cost:5,stats:{dexterity:2}}];
const synergistic=(s,stats,seconds,reset)=>reset?(stats.strength>=2&&stats.dexterity>=2?1000:1):100;
test('bounded sleeve search discovers a synergistic middle-cost bundle missed by the cheapest greedy basket and singles',()=>{
 const p=planSleeveAugPurchase({sleeve,offers,budget:10,objective:'xp',workForecast:synergistic});assert.deepEqual(p.names,['Dexterity','Strength']);assert.equal(p.cost,10);assert.equal(p.output,1000);assert.equal(p.search.exhaustive,false);
});
test('bundle search retains skill-rebuild, cash payback, shared budget and minimum batch requirements',()=>{
 assert.deepEqual(planSleeveAugPurchase({sleeve,offers,budget:9,workForecast:synergistic}).names,[]);
 assert.deepEqual(planSleeveAugPurchase({sleeve,offers,budget:10,workForecast:()=>100}).names,[]);
 const p=planSleeveAugPurchase({sleeve,offers,budget:10,objective:'money',workForecast:(s,stats,t,reset)=>reset?105:100});assert.deepEqual(p.names,[]);
});
test('sleeve candidate search is deterministic, bounded, deduplicated and rejects malformed multiplier data',()=>{
 let calls=0;const many=Array.from({length:200},(_,i)=>({name:'A'+i,cost:1+i,stats:{strength:1+i*.01}}));
 const workForecast=(s,stats,t,reset)=>{calls++;return reset?100*(stats.strength??1):10;};
 const p=planSleeveAugPurchase({sleeve,offers:many,budget:1000,workForecast});assert.ok(calls<=65);assert.ok(p.search.evaluations<=64);assert.equal(new Set(p.names).size,p.names.length);
 const duplicate=planSleeveAugPurchase({sleeve,offers:[...offers,offers[1]],budget:10,workForecast:synergistic});assert.deepEqual(duplicate.names,['Dexterity','Strength']);
 assert.deepEqual(planSleeveAugPurchase({sleeve,offers:[{name:'Bad',cost:1,stats:{strength:2,dexterity:NaN}}],budget:10,workForecast:synergistic}).names,[]);
});
test('serialized sleeve planner keeps its bounded bundle search self-contained for native work forecasts',()=>{
 const plan=Function('return ('+planSleeveAugPurchase.toString()+')')();assert.deepEqual(plan({sleeve,offers,budget:10,workForecast:synergistic}).names,['Dexterity','Strength']);
});
const row=(division='D',city='A',profit=100,more={})=>({key:division+'/'+city,division,city,profitPerSecond:profit,sellThrough:1,pressure:.5,backlog:false,...more});
function market(rows){let h;for(const at of [1000,11000,21000])h=observeCorporationGrowth(h,{scope:'node/corp',at,rows});return h;}
const plan=(label,division,score=1,kind='production',priority=0)=>({label,cost:100,score,priority,market:{division,kind},run:()=>true});
test('corporation scoring requires three observations and prices estimated effects from observed profitable output',()=>{
 let h=observeCorporationGrowth(null,{scope:'node/corp',at:1000,rows:[row()]});const plans=[plan('A','A'),plan('B','B')];assert.equal(scoreCorporationGrowth(plans,h),plans);
 h=market([row('A','A',10),row('B','A',100)]);const ranked=scoreCorporationGrowth(plans,h).sort((a,b)=>b.score-a.score);assert.equal(ranked[0].label,'B');assert.equal(ranked[0].profitPerSecond,100);
});
test('sales backlogs suppress discretionary production/storage while preserving sales and development priorities',()=>{
 const h=market([row('D','A',100,{sellThrough:.2,backlog:true,pressure:.95})]);
 const ranked=scoreCorporationGrowth([plan('Factory','D'),plan('Storage','D',1,'storage'),plan('Sales','D',1,'sales'),plan('Development','D',1,'development',1)],h);
 assert.deepEqual(ranked.map(p=>p.label),['Sales','Development']);assert.equal(ranked[0].bottleneckFactor,2);
});
test('warehouse pressure favors storage only when output is clearing; unconstrained demand discounts sales spending',()=>{
 const h=market([row('D','A',100,{pressure:.95})]);const ranked=scoreCorporationGrowth([plan('Storage','D',1,'storage'),plan('Sales','D',1,'sales')],h);
 assert.ok(ranked[0].score>ranked[1].score);assert.equal(ranked[1].bottleneckFactor,.5);
});
test('global corporation upgrades reflect the fraction of profit that can sell additional output',()=>{
 const h=market([row('A','A',100,{sellThrough:0,backlog:true}),row('B','A',100)]);const [p]=scoreCorporationGrowth([plan('Global',undefined)],h);assert.equal(p.bottleneckFactor,.5);
});
test('corporation evidence resets across scope changes, gaps, duplicate observations and malformed saved samples',()=>{
 const h=market([row()]);let n=observeCorporationGrowth(h,{scope:'other',at:31000,rows:[row()]});assert.equal(n.locations['D/A'].ready,false);
 n=observeCorporationGrowth(h,{scope:'node/corp',at:300000,rows:[row()]});assert.equal(n.locations['D/A'].ready,false);
 n=observeCorporationGrowth(h,{scope:'node/corp',at:21000,rows:[row()]});assert.equal(n.locations['D/A'].samples.length,3);
 n=observeCorporationGrowth({scope:'node/corp',at:21000,locations:{'D/A':{samples:'bad'}}},{scope:'node/corp',at:31000,rows:[row()]});assert.equal(n.locations['D/A'].ready,false);
});
test('observed losses do not invent profit or erase foundation priorities; native reserves still gate spending',()=>{
 const h=market([row('D','A',-100)]);const [p]=scoreCorporationGrowth([plan('Foundation','D',1,'development',2)],h);assert.equal(p.profitPerSecond,0);assert.match(p.growthBasis,/heuristic/);
 const result=executeCorporationGrowth([p],100,()=>100,50);assert.equal(result.decisions[0].state,'budget-wait');assert.equal(result.decisions[0].basis,p.growthBasis);
});
test('controllers wire the same horizon to training, equipment and ascension, and retain corporation native per-second profit units',()=>{
 const gangs=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),corp=readFileSync(new URL('../corporation-manager.js',import.meta.url),'utf8');
 assert.match(gangs,/horizonSeconds:growthHorizon.seconds/);assert.match(gangs,/horizon:growthHorizon.seconds/);assert.match(gangs,/forecastGangCrewTraining\(\{members,gang/);assert.match(gangs,/horizonSeconds:growthHorizon.seconds,bonusSeconds:growthHorizon.bonusSeconds/);
 assert.match(corp,/const completedCycle=managedOnce/);assert.match(corp,/if\(completedCycle\)growthMarket=observeCorporationGrowth/);assert.match(corp,/profitPerSecond:\(revenue-expenses\)\/Math.max\(1,divisionData.cities.length\),/);assert.match(corp,/scoreCorporationGrowth\(\[...growthPlans.values\(\)\],growthMarket\)/);
});
