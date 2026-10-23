import {captureBladeburnerPlanningState} from '../bladeburner-snapshot-readers.js';
import {bladeburnerCombinedSnapshotSource} from '../bladeburner-snapshot-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerCityMaintenanceKey,bladeburnerCityEnvironmentChanged} from '../bladeburner-capability-policy.js';
import {bladeburnerRankSupply} from '../bladeburner-reserve-policy.js';
function fixture(){
 const state={bonus:0,count:21.1,task:{type:'BLADEBURNER',actionType:'General',actionName:'Diplomacy',cyclesNeeded:300,cyclesWorked:1},person:{shock:0,sync:100,skills:{charisma:1000}}};
 const ns={getResetInfo:()=>{throw Error('Not needed');},bladeburner:{getBonusTime:()=>state.bonus,getActionCountRemaining:()=>state.count,getCity:()=> 'A',getCityEstimatedPopulation:()=>100,getCityCommunities:()=>1,getCityChaos:()=>2},sleeve:{getNumSleeves:()=>1,getTask:()=>state.task,getSleeve:()=>state.person}};
 const snapshot=()=>captureBladeburnerPlanningState(ns,['A']).maintenance;
 return {state,ns,snapshot,key:()=>bladeburnerCityMaintenanceKey(snapshot())};
}
test('city maintenance signature refreshes on whole stock changes but ignores fractional regeneration',()=>{
 const f=fixture(),before=f.key();assert.ok(before);f.state.count=21.9;assert.equal(f.key(),before);f.state.count=22;assert.notEqual(f.key(),before);f.state.count=20.9;assert.notEqual(f.key(),before);
});
test('Diplomacy assignments, health, sync, charisma and duration refresh city estimates',()=>{
 for(const mutate of [s=>s.task=null,s=>s.task={type:'SUPPORT'},s=>s.person.shock=1,s=>s.person.sync=99,s=>s.person.skills.charisma++,s=>s.task.cyclesNeeded++]){
  const f=fixture(),before=f.key();mutate(f.state);assert.notEqual(f.key(),before);
 }
});
test('task progress and amount of bonus time within the same speed regime preserve cached estimates',()=>{
 const f=fixture(),before=f.key();f.state.task.cyclesWorked=200;f.state.bonus=999;assert.equal(f.key(),before);f.state.bonus=1000;assert.notEqual(f.key(),before);const fast=f.key();f.state.bonus=9000;assert.equal(f.key(),fast);
});
test('unavailable optional sleeves discard partial evidence and remain a stable no-credit state',()=>{
 const f=fixture();f.ns.sleeve.getNumSleeves=()=>2;f.ns.sleeve.getTask=i=>{if(i===1)throw Error('Unavailable');return f.state.task;};assert.equal(f.snapshot().sleeves,null);assert.ok(f.key());
 f.ns.sleeve=undefined;assert.equal(f.snapshot().sleeves,null);assert.ok(f.key());
});
test('malformed stock, sleeve and speed snapshots cannot authorize cache reuse',()=>{
 const f=fixture(),s=f.snapshot();
 for(const patch of [{complete:false},{accelerated:null},{stock:[]},{stock:s.stock.map((p,i)=>i===0?[p[0],NaN]:p)},{sleeves:undefined},{sleeves:{count:9,entries:[]}},{sleeves:{count:1,entries:[[0,'diplomacy',0,100,1000,0]]}},{sleeves:{count:1,entries:[[0,'support'],[0,'support']]}}])assert.equal(bladeburnerCityMaintenanceKey({...s,...patch}),null);
 f.state.bonus=NaN;assert.equal(f.key(),null);f.ns.bladeburner.getActionCountRemaining=()=>{throw Error('Unavailable');};assert.equal(f.key(),null);
});
test('maintenance key canonicalizes stock and sleeve ordering without mutating snapshots',()=>{
 const f=fixture(),s=f.snapshot();s.sleeves={count:2,entries:[[1,'support'],...s.sleeves.entries]};const before=structuredClone(s),key=bladeburnerCityMaintenanceKey(s);assert.deepEqual(s,before);s.stock.reverse();s.sleeves.entries.reverse();assert.equal(bladeburnerCityMaintenanceKey(s),key);
});
test('generated city snapshot runs without module bindings and returns maintenance evidence',()=>{
 const f=fixture(),data=vm.runInNewContext('('+bladeburnerCombinedSnapshotSource+')(ns,["A"])',{ns:f.ns});assert.ok(bladeburnerCityMaintenanceKey(data.maintenance));assert.equal(data.population.A,100);
});
test('executed controller cache key includes reserve supply, guard readiness, maintenance and current city',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('        const maintenanceKey='),end=source.indexOf('            const rows=await',start);
 assert.ok(start>0&&end>start);const block=source.slice(start,end).replace(/if\(([^\n]+)\)\{\s*$/, 'globalThis.refresh=($1);');
 const f=fixture(),cityEnvironment=[['A',100,0]],c={cityEnvironment,bladeburnerCityEnvironmentChanged,bladeburnerCityMaintenanceKey,bladeburnerRankSupply,cityState:{maintenance:f.snapshot()},squadKey:'squad',developmentBudget:{spentMs:0},cityGrowthTarget:null,candidates:['A'],actions:[['Tracking','Contracts']],options:{'success-threshold':.99,'disable-level-optimization':false},rankReserves:{stealth:20,population:200,maxRank:1000,guardReady:true},rank:0,getCount:()=>201,currentCity:'A',cityPlanCache:null,Date:{now:()=>1000}};
 const run=()=>{vm.runInNewContext('{'+block+';globalThis.outputKey=key;}',c);return c.outputKey;};
 const original=run();assert.equal(c.refresh,true);c.cityPlanCache={key:original,at:1000,environment:cityEnvironment};run();assert.equal(c.refresh,false);
 for(const mutate of [()=>c.rankReserves.guardReady=false,()=>c.rankReserves.population=201,()=>c.getCount=()=>202,()=>c.currentCity='B',()=>c.cityState.maintenance={complete:false}]){mutate();const next=run();assert.equal(c.refresh,true);c.cityPlanCache={key:next,at:1000,environment:cityEnvironment};}
});
