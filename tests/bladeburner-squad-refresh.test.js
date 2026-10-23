import {captureBladeburnerPlanningState} from '../bladeburner-snapshot-readers.js';
import {bladeburnerCombinedSnapshotSource} from '../bladeburner-snapshot-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerSquadKey} from '../bladeburner-capability-policy.js';
function fixture(){
 const state={total:20,operations:{Assassination:4,'Stealth Retirement Operation':0},blackOp:3,target:'Operation Zero'};
 const api={getOperationNames:()=>Object.keys(state.operations),getTeamSize:(type,name)=>type==='Operations'?state.operations[name]:type==='Black Operations'?state.blackOp:state.total,getCity:()=> 'A',getCityEstimatedPopulation:()=>100,getCityCommunities:()=>1,getCityChaos:()=>0};
 const ns={bladeburner:api,getResetInfo:()=>{throw Error('Not needed');}},snapshot=()=>captureBladeburnerPlanningState(ns,['A'],state.target).squads;
 return {state,api,ns,snapshot,key:()=>bladeburnerSquadKey(snapshot())};
}
test('squad snapshot reads total and all operation assignments including the pending Black Op',()=>{
 const f=fixture(),s=f.snapshot();assert.equal(s.total,20);assert.deepEqual(s.operations,[['Assassination',4],['Stealth Retirement Operation',0]]);assert.deepEqual(s.blackOp,['Operation Zero',3]);assert.ok(f.key());
});
test('recruitment, casualties and operation reassignment change the city squad key',()=>{
 for(const mutate of [s=>s.total++,s=>s.total--,s=>s.operations.Assassination++,s=>s.operations['Stealth Retirement Operation']=2,s=>delete s.operations.Assassination,s=>s.operations.Raid=0]){const f=fixture(),before=f.key();mutate(f.state);assert.notEqual(f.key(),before);}
});
test('pending Black Op assignment and target changes refresh while absent targets remain valid',()=>{
 const f=fixture(),before=f.key();f.state.blackOp++;assert.notEqual(f.key(),before);const teamChanged=f.key();f.state.target='Operation X';assert.notEqual(f.key(),teamChanged);f.state.target=null;assert.equal(f.snapshot().blackOp,null);assert.ok(f.key());
});
test('stable squad snapshots canonicalize operation ordering without mutation',()=>{
 const f=fixture(),s=f.snapshot(),copy=structuredClone(s),key=bladeburnerSquadKey(s);assert.deepEqual(s,copy);s.operations.reverse();assert.equal(bladeburnerSquadKey(s),key);f.state.operations={...f.state.operations,Assassination:100};assert.ok(f.key());
});
test('unknown, partial and malformed squad snapshots cannot authorize reuse',()=>{
 const f=fixture(),s=f.snapshot();
 for(const patch of [{complete:false},{total:NaN},{total:-1},{total:1.5},{operations:[]},{operations:[['Assassination',-1]]},{operations:[['Assassination',1],['Assassination',2]]},{operations:[['Assassination',Infinity]]},{blackOp:undefined},{blackOp:['Operation Zero',-1]}])assert.equal(bladeburnerSquadKey({...s,...patch}),null);
 for(const names of [[],['A','A'],[null],Array.from({length:65},(_,i)=>String(i))]){f.api.getOperationNames=()=>names;assert.equal(f.snapshot().complete,false);}
});
test('native read failures discard partial squads while preserving city data',()=>{
 const f=fixture();f.api.getTeamSize=(type,name)=>{if(name==='Stealth Retirement Operation')throw Error('Unavailable');return 20;};const data=captureBladeburnerPlanningState(f.ns,['A']);assert.equal(data.squads.complete,false);assert.equal(bladeburnerSquadKey(data.squads),null);assert.equal(data.population.A,100);
});
test('serialized squad capture uses read-only native APIs and no module bindings',()=>{
 const f=fixture();f.api.setTeamSize=()=>{throw Error('Mutation');};f.api.switchCity=f.api.setTeamSize;f.api.startAction=f.api.setTeamSize;
 const data=vm.runInNewContext('('+bladeburnerCombinedSnapshotSource+')(ns,["A"],"Operation Zero")',{ns:f.ns});assert.equal(bladeburnerSquadKey(data.squads),f.key());assert.equal(data.currentCity,'A');
});
test('executed controller preserves stable plans and refreshes after squad changes or unavailable evidence',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('        const squadKey='),end=s.indexOf('        const cityStats=',start),key=s.split('\n').find(line=>line.includes('const key=JSON.stringify([cityGrowthTarget')),condition=s.split('\n').find(line=>line.includes('if(!cityPlanCache||cityPlanCache.key')).trim().slice(3,-2);
 const f=fixture(),c={bladeburnerSquadKey,cityState:{squads:f.snapshot()},cityPlanCache:null,developmentBudget:{spentMs:0},cityGrowthTarget:null,candidates:['A'],actions:[['Assassination','Operations']],options:{'success-threshold':.99,'disable-level-optimization':false},maintenanceKey:'maintenance',rankReserves:{},reserveSupply:[],currentCity:'A',cityEnvironment:[['A',100,0]],bladeburnerCityEnvironmentChanged:()=>false,Date:{now:()=>1000}};
 const run=()=>{vm.runInNewContext('{'+s.slice(start,end)+key+';globalThis.outputKey=key;globalThis.refresh=('+condition+');}',c);return c.outputKey;};
 assert.ok(start>0&&end>start);const initial=run();c.cityPlanCache={key:initial,at:1000};run();assert.equal(c.refresh,false);
 for(const mutate of [()=>f.state.total++,()=>f.state.operations.Assassination++,()=>f.state.blackOp++]){mutate();c.cityState.squads=f.snapshot();const next=run();assert.equal(c.refresh,true);c.cityPlanCache={key:next,at:1000};run();assert.equal(c.refresh,false);}
 c.cityState.squads={complete:false};run();assert.equal(c.cityPlanCache,null);assert.equal(c.refresh,true);
});
test('squad invalidation runs after protected-action checks without adding a native worker',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.ok(s.indexOf('if(isBlackOp(observedAction))')<s.indexOf('const squadKey='));assert.match(s,/currentCity,squadKey,cityState\.trainingVitals\?\.stamina\?\.\[1\]\?\?null,Math\.min\(121000[\s\S]*?Math\.min\(30/);const block=s.slice(s.indexOf('const squadKey='),s.indexOf('const cityStats='));assert.ok(!block.includes('getNsDataThroughFile'));assert.ok(!bladeburnerCombinedSnapshotSource.includes('setTeamSize'));
});
