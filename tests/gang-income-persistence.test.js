import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeGangIncome,restoreGangIncome,persistGangIncome} from '../gang-power-policy.js';
const keys=['hacking','hacknet','gang','sleeves','work','crime','corporation','bladeburner','darknet'];
const scope=now=>({nodeReset:1,augReset:2,now});
function snapshot(at){return {at,sources:Object.fromEntries(keys.map(k=>[k,k==='gang'?at*.01:k==='darknet'?at*.09:k==='corporation'?-10000+at*.001:k==='sleeves'?-at:0]))};}
function measured(){let p;for(let i=0;i<=3;i++){const at=1000+i*20000;p=observeGangIncome(p,snapshot(at),scope(at));}return p;}
test('same-reset fresh histories resume immediately after a JSON round trip',()=>{
 const original=measured(),saved=JSON.parse(JSON.stringify(original));const restored=restoreGangIncome(saved,scope(62000));
 assert.equal(restored.known,true);assert.equal(restored.samples.length,3);assert.equal(restored.gangRate,10);assert.equal(restored.externalRate,91);
 const continued=observeGangIncome(restored,snapshot(63000),scope(63000));assert.equal(continued.known,true);assert.equal(continued.samples.length,3);
 const next=observeGangIncome(restored,snapshot(81000),scope(81000));assert.deepEqual(next,observeGangIncome(original,snapshot(81000),scope(81000)));
});
test('restoration recomputes summaries and window rates from raw counters',()=>{
 const saved=measured();saved.externalRate=1e100;saved.gangRate=0;saved.gangShare=0;saved.known=false;saved.rateAt=1e100;saved.rates={};
 for(const r of saved.samples)r.rates={gang:1e99,darknet:1e99};
 const restored=restoreGangIncome(saved,scope(61000));assert.equal(restored.known,true);assert.equal(restored.gangRate,10);assert.equal(restored.externalRate,91);assert.equal(restored.samples[0].rates.darknet,90);
});
test('fast and duplicate observations cannot trust forged derived summaries',()=>{
 const saved=measured();saved.externalRate=1e100;saved.gangRate=0;
 assert.equal(observeGangIncome(saved,snapshot(61000),scope(61000)).externalRate,91);
 assert.equal(observeGangIncome(saved,snapshot(61500),scope(61500)).externalRate,91);
});
test('foreign resets, old schemas, future and stale baselines are rejected',()=>{
 const saved=measured();for(const change of [s=>s.nodeReset=9,s=>s.augReset=9,s=>s.schemaVersion=1,s=>s.baseline.at=62001,s=>s.baseline.at=1,s=>s.samples.push(...s.samples)]){
  const copy=structuredClone(saved);change(copy);assert.equal(restoreGangIncome(copy,scope(62000)),null);
 }
 assert.equal(restoreGangIncome(saved,scope(181001)),null);assert.equal(restoreGangIncome(saved,{...scope(62000),now:NaN}),null);
});
test('overlaps, gaps, incomplete channels, counter discontinuity and invalid raw values fail closed',()=>{
 for(const change of [s=>s.samples[1].seconds=21,s=>s.samples[1].seconds=19,s=>s.samples[1].at+=10,s=>delete s.samples[1].endSources.darknet,s=>s.samples[1].startSources.gang++,s=>s.samples[1].endSources.gang=Infinity,s=>s.samples[1].endSources.gang=-1,s=>s.baseline.sources.darknet++]){
  const copy=measured();change(copy);assert.equal(restoreGangIncome(copy,scope(61000)),null);
 }
});
test('signed cumulative counters are supported and declining sleeves do not become income',()=>{
 const p=measured();assert.ok(p.baseline.sources.corporation<0);assert.equal(p.rates.corporation,1);assert.equal(p.rates.sleeves,0);
 assert.equal(restoreGangIncome(p,scope(61000)).externalRate,91);
});
test('a paused history retains raw evidence but no stale income credit',()=>{
 const p=restoreGangIncome(measured(),scope(100000));assert.equal(p.known,false);assert.equal(p.externalRate,0);assert.equal(p.samples.length,3);
 const resumed=observeGangIncome(p,snapshot(101000),scope(101000));assert.equal(resumed.known,true);assert.equal(resumed.samples.length,4);
});
test('history remains bounded at long valid intervals and survives repeated restore cycles',()=>{
 let p;for(let i=0;i<10;i++){const at=1000+i*120000;p=observeGangIncome(p,snapshot(at),scope(at));p=restoreGangIncome(JSON.parse(JSON.stringify(p)),scope(at));assert.ok(p.samples.length<=5);}
 assert.equal(p.known,true);assert.equal(p.gangRate,10);
});
test('observed gross contribution is distinct from conservative income credit',()=>{
 let p,amount=0;for(let i=0;i<=3;i++){const at=1000+i*20000,s=snapshot(at);if(i===2)amount+=5400;s.sources.darknet=amount;p=observeGangIncome(p,s,scope(at));}
 assert.equal(p.known,true);assert.equal(p.rates.darknet,0);assert.ok(p.observedExternalRate>p.externalRate);assert.ok(p.observedGangShare<p.gangShare);
});
test('persistence writes once per completed baseline and stores raw boundaries',async()=>{
 const writes=[],ns={write:async(...args)=>writes.push(args)};let p=measured(),state=await persistGangIncome(ns,p,undefined,61000);
 assert.equal(writes.length,1);assert.equal(writes[0][0],'tasks/gang-income-observation.json');assert.equal(writes[0][2],'w');assert.ok(JSON.parse(writes[0][1]).samples[0].startSources);
 state=await persistGangIncome(ns,p,state,61500);assert.equal(writes.length,1);
 p=observeGangIncome(p,snapshot(81000),scope(81000));state=await persistGangIncome(ns,p,state,81000);assert.equal(writes.length,2);assert.equal(state.at,81000);
});
test('optional persistence failures preserve measurement, retry with backoff and throttle logs',async()=>{
 const p=measured();let calls=0,warnings=0;const ns={write:async()=>{calls++;throw Error('storage unavailable');},print:()=>warnings++};
 let state=await persistGangIncome(ns,p,{},61000);assert.equal(calls,1);assert.equal(warnings,1);assert.equal(state.at,undefined);assert.equal(state.retryAt,66000);
 state=await persistGangIncome(ns,p,state,62000);assert.equal(calls,1);
 state=await persistGangIncome(ns,p,state,67000);assert.equal(calls,2);assert.equal(warnings,1);
 state=await persistGangIncome(ns,p,state,122000);assert.equal(warnings,2);
 state=await persistGangIncome({write:async()=>{}},p,state,128000);assert.equal(state.at,61000);assert.equal(state.error,null);assert.equal(p.known,true);
});
test('invalid histories are not persisted and controller restoration is bounded and scoped',async()=>{
 let calls=0;await persistGangIncome({write:async()=>calls++},{},undefined,61000);assert.equal(calls,0);
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(source,/raw.length<=20000/);assert.match(source,/restoreGangIncome\(JSON.parse\(raw\),\{nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,now:Date.now\(\)\}\)/);
 assert.match(source,/persistGangIncome\(ns,incomeObservation,updateGrowthFocus.incomeSaveState\)/);assert.match(source,/conservatively credited recurring income/);assert.match(source,/observedGangShare:incomeObservation.observedGangShare/);
});
