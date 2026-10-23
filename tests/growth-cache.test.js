import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveRecoveryForecast,sleeveAugRecoveryPlan} from '../sleeve-development-policy.js';
import {gangTerritorySample,gangTerritoryDeadline} from '../gang-policy.js';
import {readFileSync} from 'node:fs';
const sleeve={shock:1,sync:100,skills:{strength:10},exp:{strength:10},mults:{strength_exp:1}};
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:100}};
const offers=[{name:'XP',cost:10,stats:{strength_exp:10}}];
const input={sleeve:{...sleeve,shock:0},offers,budget:10,crimes,objective:'xp',nodeMultiplier:1,horizon:899,minBatch:1};
test('recovery cache reuses bounded quotes and conservatively rounds cash and time',()=>{
 const cache=new Map(),stats={};
 const a=sleeveRecoveryForecast(input,{cache,stats,scope:1,now:100});
 const b=sleeveRecoveryForecast({...input,budget:10.01,horizon:898},{cache,stats,scope:1,now:200});
 assert.equal(stats.hits,1);assert.equal(stats.misses,1);assert.deepEqual(a,b);
 assert.ok(a.cost<=10);assert.equal(a.horizon,895);
 b.names.push('Mutated');assert.deepEqual(sleeveRecoveryForecast(input,{cache,now:300,scope:1}).names,['XP']);
});
test('cache expires and invalidates for cash, skills, offers, reset and forecast context',()=>{
 const cache=new Map(),stats={};
 sleeveRecoveryForecast(input,{cache,stats,scope:1,now:100});
 for(const [i,change] of [
  {budget:9},{sleeve:{...input.sleeve,skills:{strength:20}}},
  {offers:[{...offers[0],cost:11}]},{context:{crimeExpMultiplier:.5}},
  {objective:'money'}
 ].entries())sleeveRecoveryForecast({...input,...change},{cache,stats,scope:1,now:200+i});
 assert.equal(stats.hits||0,0);assert.equal(stats.misses,6);
 sleeveRecoveryForecast(input,{cache,stats,scope:2,now:300});assert.equal(stats.misses,7);
 sleeveRecoveryForecast(input,{cache,stats,scope:1,now:10100});assert.equal(stats.misses,8);
 for(let i=0;i<100;i++)sleeveRecoveryForecast({...input,offers:[]},{cache,scope:i,now:10200});
 assert.ok(cache.size<=64);
});
test('money and stored-cycle noise do not invalidate an unchanged recovery XP projection',()=>{
 const cache=new Map(),stats={};
 const person={skills:{strength:10},exp:{strength:1},mults:{strength:1},money:1};
 sleeveRecoveryForecast({...input,context:{player:person}},{cache,stats,now:100});
 sleeveRecoveryForecast({...input,sleeve:{...input.sleeve,storedCycles:300},context:{player:{...person,money:999}}},{cache,stats,now:200});
 assert.equal(stats.hits,1);
});
test('shared recovery allocation requotes a smaller batch for the remaining wallet',()=>{
 const catalog=[{name:'Small',cost:4,stats:{strength_exp:3}},{name:'Large',cost:6,stats:{strength_exp:3}}];
 const first=[{name:'Strong',cost:6,stats:{strength_exp:10}}];
 const plan=sleeveAugRecoveryPlan([sleeve,sleeve],[first,catalog],crimes,{sleeves:[{rate:1},{rate:1}]},10);
 assert.equal(Object.keys(plan).length,2);assert.equal(plan[0].cost,6);assert.equal(plan[1].cost,4);
 assert.equal(Object.values(plan).reduce((sum,p)=>sum+p.cost,0),10);
});
test('cached recovery allocation preserves the shared cash cap',()=>{
 const plan=sleeveAugRecoveryPlan([sleeve,sleeve],[offers,offers],crimes,{sleeves:[{rate:1},{rate:1}]},10,1,null,900,{cache:new Map(),now:1,cacheScope:'epoch'});
 assert.equal(Object.keys(plan).length,1);assert.equal(Object.values(plan)[0].cost,10);
});
test('territory observations detect rival ticks with unchanged own power',()=>{
 const gangs={Own:{power:10,territory:.5},Rival:{power:20,territory:.5}};
 const first=gangTerritorySample(null,gangs,'Own',100);
 assert.equal(first.changed,false);
 assert.equal(gangTerritorySample(first,gangs,'Own',200).changed,false);
 const next=gangTerritorySample(first,{...gangs,Rival:{power:21,territory:.5}},'Own',300);
 assert.equal(next.changed,true);
 assert.equal(gangTerritorySample(next,{...gangs,Rival:{power:21,territory:.5}},'Own',400).changed,false);
 assert.equal(gangTerritorySample(first,gangs,'Different faction',300).changed,false);
 assert.equal(gangTerritorySample(first,{},'Own',300).changed,false);
 assert.equal(gangTerritorySample(first,gangs,'Own',100).changed,false);
});
test('territory deadline accounts for bonus exhaustion and the normal stored batch',()=>{
 assert.equal(gangTerritoryDeadline(1000,0),21000);
 assert.equal(gangTerritoryDeadline(1000,2000),21000);
 assert.equal(gangTerritoryDeadline(1000,30000),1800);
 assert.equal(gangTerritoryDeadline(1000,11600),11400);
 assert.equal(gangTerritoryDeadline(1000,NaN),21000);
 assert.equal(gangTerritoryDeadline(NaN,0),null);
});
test('controller samples native clocks together and uses observed rival ticks',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/others:ns.gang.getAllGangInformation\(\),bonusMs:ns.gang.getBonusTime\(\),at:Date.now\(\)/);
 assert.match(source,/if \(tickObserved \|\|/);assert.match(source,/if \(tick.observed \|\|/);
 assert.doesNotMatch(source,/territoryTickTime\s*\/\s*\(ns.gang.getBonusTime\(\)\s*>\s*0\s*\?\s*5/);
});
test('executed gang polling confirms a rival tick once and forwards its native time',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('\n/** @param {NS} ns\n * Do some things',start);
 assert.ok(start>0&&end>start);
 const at=Date.now(),gangs={Own:{power:10,territory:.5},Rival:{power:20,territory:.5}};
 const previous=gangTerritorySample(null,gangs,'Own',at-200),cycle={info:{power:10,territoryWarfareEngaged:false},others:{...gangs,Rival:{power:21,territory:.5}},bonusMs:0,at};
 const events=[];
 const build=Function('getNsDataThroughFile','gangTerritorySample','gangTerritoryDeadline','gangTerritoryTiming','previous','cycle','events',`
  const wantedPreparation=null,options={},trainingEpisodes={},trainingPlans={},ascensionRecoveries={};
  const maintenanceRequested=()=>false,myGangFaction='Own',myGangMembers=Array(12),updateInterval=200,territoryTickTime=20000;
  let lastOtherGangInfo=previous,lastLoopTime=cycle.at-200,territoryNextTick=cycle.at,territoryTickDetected=true,
   isReadyForNextTerritoryTick=true,warfareFinished=false,territoryTickWaitPadding=200,lastTerritoryPower=10;
  const onTerritoryTick=async(ns,info,tick)=>events.push(tick);
  const updateMemberActivities=async()=>{throw Error('Unexpected warfare preparation on an observed tick');};
  const log=()=>{};
  ${source.slice(start,end)}
  return async()=>{await mainLoop({});await mainLoop({});};`);
 const {gangTerritoryTiming}=await import('../gang-policy.js');
 await build(async()=>cycle,gangTerritorySample,gangTerritoryDeadline,gangTerritoryTiming,previous,cycle,events)();
 assert.deepEqual(events,[{observed:true,at,bonusMs:0}]);
 const init=source.slice(0,start);
 assert.doesNotMatch(init,/observed:tickObserved/);
});
test('unchanged productive work skips polling and production timeouts preserve the territory phase',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('\n/** @param {NS} ns',start);
 const build=Function('const assignedTasks={A:"Work"},memberNeedsTraining=()=>false,memberProtectedTask=()=>null;'+source.slice(start,end)+';return updateMemberActivities;');
 assert.equal(await build()({}, {A:{name:'A',task:'Work',def:100}}),false);
 assert.match(source,/if\(restored.restored>0\)myGangInfo=await waitForGameUpdate/);assert.match(source,/changedWork\?await waitForGameUpdate/);
 const wait=source.slice(source.indexOf('async function waitForGameUpdate('),source.indexOf('\n/**',source.indexOf('async function waitForGameUpdate(')));
 assert.doesNotMatch(wait,/territoryTickDetected\s*=\s*false/);
});
