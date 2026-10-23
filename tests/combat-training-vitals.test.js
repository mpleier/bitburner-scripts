import {bladeburnerTrainingPayoff} from '../bladeburner-training-policy.js';
import {captureBladeburnerPlanningState} from '../bladeburner-snapshot-readers.js';
import {bladeburnerCombinedSnapshotSource} from '../bladeburner-snapshot-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {refreshBladeburnerTrainingVitals,applyBladeburnerTrainingBaseline} from '../combat-growth-policy.js';
import {bladeburnerStaminaChance,bladeburnerDevelopmentAction,chooseBladeburnerCity} from '../bladeburner-policy.js';
const now=100000,reset={lastNodeReset:1,lastAugReset:2},target='Operation Zero',city='A',difficulty=125;
const cached={kind:'training',name:'Training',score:.0003,time:30000,hpRatio:1,stamina:[100,100],rawChance:[.5,.5],chance:[.5,.5]};
const rows=()=>[{city:'A',score:.0001,objective:'combat-xp',action:'Mission',level:1,trainingBaseline:cached},{city:'B',score:.0002,objective:'combat-xp',action:'Mission',level:1,trainingBaseline:cached}];
const settings={rank:5000,requiredRank:5000,threshold:.99,remainingMs:120000,trainingEnabled:true,enabled:true,lowStaminaPct:.5};
const vitals=()=>({at:now,target,city,nodeReset:1,augReset:2,hp:{current:100,max:100},stamina:[100,100],rawChance:[.5,.5]});
const refresh=(live=vitals(),quote=cached)=>refreshBladeburnerTrainingVitals(quote,live,target,city,reset,difficulty,bladeburnerStaminaChance,now);
const choose=live=>chooseBladeburnerCity(applyBladeburnerTrainingBaseline(rows(),city,refresh(live),settings,bladeburnerDevelopmentAction),city);
test('fresh damage removes Training baseline and fresh healing restores it without replacing cached score',()=>{
 const live=vitals();assert.equal(choose(live).city,'A');live.hp.current=49;assert.equal(choose(live).city,'B');live.hp.current=100;assert.equal(choose(live).city,'A');assert.equal(refresh(live).score,cached.score);
});
test('fresh stamina depletion and recovery immediately update Training eligibility',()=>{
 const live=vitals();live.stamina=[49,100];assert.equal(choose(live).city,'B');live.stamina=[100,100];assert.equal(choose(live).city,'A');
 live.rawChance=[1,1];live.stamina=[50,100];const q=refresh(live);assert.ok(q.chance[0]<q.rawChance[0]);assert.equal(choose(live).city,'B');
});
test('fresh Black Op readiness and uncertainty take priority over a stale blocked quote',()=>{
 const live=vitals();live.rawChance=[1,1];assert.equal(choose(live).city,'B');live.rawChance=[.5,1];assert.equal(choose(live).city,'B');live.rawChance=[.5,.5];assert.equal(choose(live).city,'A');
});
test('refresh is immutable and rejects invalid, stale or mismatched native vitals',()=>{
 const live=vitals(),before=structuredClone(live),quote=structuredClone(cached),q=refresh(live);assert.deepEqual(live,before);assert.deepEqual(cached,quote);assert.notEqual(q.stamina,live.stamina);assert.notEqual(q.rawChance,live.rawChance);
 for(const patch of [{at:now-15000},{at:now+1},{at:NaN},{target:'Other'},{city:'B'},{nodeReset:3},{augReset:3},{hp:null},{hp:{current:-1,max:100}},{hp:{current:101,max:100}},{hp:{current:1,max:0}},{stamina:[NaN,100]},{stamina:[101,100]},{stamina:[1,0]},{rawChance:[1,.5]},{rawChance:[Infinity,1]}])assert.equal(refresh({...live,...patch}),null);
 assert.equal(refresh(null),null);assert.equal(refresh(live,null),null);
});
test('missing difficulty and failed or malformed forecasts omit the baseline safely',()=>{
 for(const forecast of [null,()=>{throw Error('Unavailable');},()=>null,()=>[NaN,1],()=>[1,.5]])assert.equal(refreshBladeburnerTrainingVitals(cached,vitals(),target,city,reset,difficulty,forecast,now),null);
 assert.equal(refreshBladeburnerTrainingVitals(cached,vitals(),target,city,reset,NaN,bladeburnerStaminaChance,now),null);
});
test('generated city snapshot collects fresh vitals without optional APIs or mutations',()=>{
 const state={hp:{current:49,max:100},stamina:[50,100],chance:[.5,.5]},ns={getPlayer:()=>({hp:state.hp}),getResetInfo:()=>reset,bladeburner:{getCity:()=>city,getCityEstimatedPopulation:()=>100,getCityCommunities:()=>1,getCityChaos:()=>2,getStamina:()=>state.stamina,getActionEstimatedSuccessChance:(type,name)=>{assert.equal(type,'Black Operations');assert.equal(name,target);return state.chance;}}};
 const capture=t=>vm.runInNewContext('('+bladeburnerCombinedSnapshotSource+')(ns,["A"],target)',{ns,target:t,Date:{now:()=>now}});
 const live=capture(target).trainingVitals;assert.equal(live.hp.current,49);assert.equal(refresh(live).hpRatio,.49);assert.equal(capture(null).trainingVitals,null);
 ns.bladeburner.getStamina=()=>{throw Error('Unavailable');};const result=capture(target);assert.equal(result.trainingVitals,null);assert.equal(result.population.A,100);
});
test('executed controller applies fresh vitals every pass while preserving cached city rows',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('        const trainingBaseline=refreshBladeburnerTrainingVitals'),end=source.indexOf('        if(choice&&',start),block=source.slice(start,end);
 const saved={rows:rows(),at:now},live=vitals(),c={bladeburnerTrainingPayoff,trainingMilestone:{eligible:true,at:Date.now(),used:0,probeUntil:2},refreshBladeburnerTrainingVitals:(...args)=>refreshBladeburnerTrainingVitals(...args,now),applyBladeburnerTrainingBaseline,bladeburnerDevelopmentAction,chooseBladeburnerCity,bladeburnerStaminaChance,cityPlanCache:saved,cityState:{trainingVitals:live},cityGrowthTarget:target,currentCity:city,resetInfo:reset,blackOpMetadata:{[target]:{baseDifficulty:difficulty}},rank:5000,blackOpsRanks:{[target]:5000},options:{'success-threshold':.99,'training-limit':50,'low-stamina-pct':.5},developmentBudget:{spentMs:0},timesTrained:0,lowHealthTriggered:false,lowStaminaTriggered:false};
 const run=()=>{vm.runInNewContext('{'+block+'globalThis.selected=choice;}',c);return c.selected;};
 assert.ok(start>0&&end>start);assert.equal(run().city,'A');live.hp.current=1;assert.equal(run().city,'B');assert.equal(c.cityPlanCache,saved);assert.equal(saved.rows[0].action,'Mission');
});
test('production reads target vitals through the snapshot orchestrator before baseline refresh',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(s,/readBladeburnerSnapshot\(ns,getNsDataThroughFile,cityNames,cityGrowthTarget,resetInfo\)/);assert.ok(s.indexOf('const cityGrowthTarget=')<s.indexOf('const cityState=await'));assert.ok(s.indexOf('cityPlanCache={key,at:Date.now(),rows,environment:cityEnvironment,stats:cityStats};')<s.indexOf('const trainingBaseline=refreshBladeburnerTrainingVitals'));
});
