import {captureBladeburnerPlanningState} from '../bladeburner-snapshot-readers.js';
import {bladeburnerCombinedSnapshotSource} from '../bladeburner-snapshot-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerCapabilityKey} from '../bladeburner-capability-policy.js';
const now=100000,reset={lastNodeReset:1,lastAugReset:2};
function fixture(){
 const state={levels:{Cloak:1,Hyperdrive:2},owned:new Map([['A',1],['NeuroFlux Governor',2]]),player:{money:100,entropy:0,exp:{strength:1000},skills:{strength:100},mults:{}}};
 const keys=[...['hacking','strength','defense','dexterity','agility','charisma'].flatMap(k=>[k,k+'_exp']),'bladeburner_success_chance','bladeburner_max_stamina','bladeburner_stamina_gain','bladeburner_analysis'];
 for(const key of keys)state.player.mults[key]=1;
 const ns={getPlayer:()=>state.player,getResetInfo:()=>({...reset,ownedAugs:state.owned}),bladeburner:{getSkillNames:()=>Object.keys(state.levels),getSkillLevel:k=>state.levels[k],getCity:()=> 'A',getCityEstimatedPopulation:c=>c==='A'?100:200,getCityCommunities:()=>1,getCityChaos:()=>2}};
 const capture=()=>vm.runInNewContext('('+bladeburnerCombinedSnapshotSource+')(ns,["A","B"])',{ns,Date:{now:()=>now}});
 return {state,ns,capture,key:()=>bladeburnerCapabilityKey(capture().capabilities,reset,now)};
}
test('native capability signature detects manual skill upgrades and is insensitive to field ordering',()=>{
 const f=fixture(),before=f.key();f.state.levels.Cloak++;assert.notEqual(f.key(),before);
 const s=f.capture().capabilities,copy=structuredClone(s);copy.skills.reverse();copy.owned.reverse();copy.multipliers.reverse();
 assert.equal(bladeburnerCapabilityKey(copy,reset,now),bladeburnerCapabilityKey(s,reset,now));
});
test('graft completion and entropy changes refresh planning without requiring optional APIs',()=>{
 for(const mutate of [f=>f.state.owned.set('Grafted augmentation',1),f=>f.state.player.entropy++,f=>f.state.player.mults.strength=1.2,f=>f.state.player.mults.bladeburner_success_chance=1.1,f=>f.state.owned.set('NeuroFlux Governor',3)]){
  const f=fixture(),before=f.key();mutate(f);assert.notEqual(f.key(),before);
 }
 const f=fixture();f.ns.singularity=new Proxy({},{get:()=>{throw Error('Optional Source File');}});f.ns.grafting=f.ns.singularity;assert.ok(f.key());
});
test('cash, raw XP, ordinary stat growth and in-progress graft work preserve the immediate capability signature',()=>{
 const f=fixture(),before=f.key();f.state.player.money+=1e9;f.state.player.exp.strength+=500;f.state.player.skills.strength++;f.state.player.work={type:'GRAFTING'};
 assert.equal(f.key(),before);
});
test('snapshot batches all four city views and preserves native ownership formats',()=>{
 const f=fixture(),data=f.capture();assert.equal(data.currentCity,'A');assert.equal(data.population.B,200);assert.equal(data.communities.A,1);assert.equal(data.chaos.B,2);
 const key=f.key();f.state.owned=Object.fromEntries(f.state.owned);assert.equal(f.key(),key);
});
test('unavailable capabilities leave city data usable but cannot authorize cache reuse',()=>{
 const f=fixture();f.ns.bladeburner.getSkillLevel=()=>{throw Error('Source File unavailable');};const data=f.capture();
 assert.equal(data.capabilities.complete,false);assert.match(data.capabilities.reason,/unavailable/);assert.equal(data.population.A,100);assert.equal(bladeburnerCapabilityKey(data.capabilities,reset,now),null);
});
test('stale, future, reset-mismatched and malformed native capability records fail closed',()=>{
 const f=fixture(),s=f.capture().capabilities;
 for(const patch of [{at:now-15000},{at:now+1},{nodeReset:4},{augReset:4},{entropy:NaN},{owned:null},{skills:[]},{multipliers:[]}])assert.equal(bladeburnerCapabilityKey({...s,...patch},reset,now),null);
 for(const [key,bad] of [['skills',[['Cloak',-1]]],['skills',[['Cloak',1],['Cloak',2]]],['multipliers',[['strength',Infinity]]],['owned',[['A',0]]]])assert.equal(bladeburnerCapabilityKey({...s,[key]:bad},reset,now),null);
});
test('stable signature preserves caches while changed or unknown input invalidates both',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    const capabilityKey=bladeburnerCapabilityKey(cityState.capabilities,resetInfo);'),end=source.indexOf('    const populationByCity=cityState.population',start);
 const f=fixture(),valid=f.capture().capabilities,key=f.key(),city={marker:'city'},level={marker:'level'};
 const c={bladeburnerCapabilityKey:(snapshot,r)=>bladeburnerCapabilityKey(snapshot,r,now),cityState:{capabilities:valid},resetInfo:reset,lastCapabilityKey:key,cityPlanCache:city,levelPlanCache:level};
 const body=source.slice(start,end);vm.runInNewContext('{'+body+'}',c);assert.equal(c.cityPlanCache,city);assert.equal(c.levelPlanCache,level);
 f.state.levels.Cloak++;c.cityState.capabilities=f.capture().capabilities;vm.runInNewContext('{'+body+'}',c);assert.equal(c.cityPlanCache,null);assert.equal(c.levelPlanCache,null);
 c.cityPlanCache=city;c.levelPlanCache=level;c.cityState.capabilities={complete:false};vm.runInNewContext('{'+body+'}',c);assert.equal(c.cityPlanCache,null);assert.equal(c.levelPlanCache,null);
});
test('production captures capabilities before city reuse and preserves protected-action guards',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(s.indexOf('if(isBlackOp(observedAction))')<s.indexOf('const cityState=await'));
 assert.ok(s.indexOf('capabilityKey!==lastCapabilityKey')<s.indexOf('if(!cityPlanCache||cityPlanCache.key'));
 assert.match(s,/let currentCity=cityState.currentCity/);
 assert.ok(!s.includes("await getBBDict(ns, 'getCityEstimatedPopulation(%)'"));
 assert.match(s,/cityPlanCache=null;lastCapabilityKey=null;levelPlanCache=null/);
});
