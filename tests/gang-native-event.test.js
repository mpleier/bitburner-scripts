import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {main,monitorGangEvent} from '../gang-event-monitor.js';
import {observeGangAttrition,gangAttritionTimingStatus,startGangAttrition,gangAttritionSignature,gangAttritionCalibration,gangMonitorBackoff,gangAttritionCooldown} from '../gang-attrition-policy.js';
import {homeRamHeadroom} from '../home-ram-policy.js';
const path='tasks/gang-attrition.json',out='tasks/gang-attrition-event.json';
const sig=g=>JSON.stringify(Object.entries(g).sort(([a],[b])=>a.localeCompare(b)).map(([n,v])=>[n,v.power,v.territory]));
function fixture(t,steps=[{ms:2000,wall:3700,change:true}]){
 let now=100000,gangs={Own:{power:100,territory:.2},R:{power:90,territory:.8}};
 t.mock.method(Date,'now',()=>now);
 const ticket={ownerPid:7,nodeReset:1,augReset:2,startedAt:99900};
 const expected={power:110,territory:.2,rivals:[{name:'R',power:90,territory:.8}]};
 const lease={...ticket,monitorRequired:true,monitorPid:8,faction:'Own',state:'active',expectedTickAt:100100,deadline:121900,cooldownUntil:99900+45*60000,observationSignature:sig(gangs),observationForecast:{wallSeconds:20,expected:[expected,structuredClone(expected),structuredClone(expected)]}};
 const files={[path]:JSON.stringify(lease)},calls=[],logs=[];
 const ns={pid:8,args:[JSON.stringify(ticket)],read:p=>files[p]||'',write:async(p,v)=>{files[p]=v;},print:s=>logs.push(s),isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),sleep:()=>new Promise(()=>{}),gang:{getAllGangInformation:()=>structuredClone(gangs),getGangInformation:()=>({faction:'Own',...gangs.Own}),setTerritoryWarfare:v=>calls.push(v),nextUpdate:async()=>{
  const step=steps.shift();if(!step)throw Error('unexpected extra subscription');now+=step.wall??200;
  if(step.change)gangs.Own.power=110;
  if(step.apply)step.apply({files,ns,gangs});
  return step.ms;
 }}};
 return {ns,ticket,lease,files,calls,logs,setNow:n=>now=n,setGangs:g=>gangs=g,receipt:()=>JSON.parse(files[out]),current:()=>JSON.parse(files[path])};
}
test('a late native event is captured once and warfare is disabled immediately',async t=>{
 const f=fixture(t);await monitorGangEvent(f.ns,f.ticket);
 const r=f.receipt();assert.equal(r.state,'observed');assert.equal(r.at,103700);assert.equal(r.processedMs,2000);assert.equal(r.updates,1);assert.deepEqual(f.calls,[false]);
 assert.equal(f.current().state,'cooldown');assert.equal(f.current().stopReason,'observed-tick');assert.equal(f.current().cooldownUntil,f.lease.cooldownUntil);
 // The controller may wake later with a different game snapshot: score the receipt.
 const cycle={at:110000,info:{faction:'Own',power:999,territory:.3},others:{}};
 const row=observeGangAttrition(f.current(),cycle,{ownerPid:7,nodeReset:1,augReset:2},[],r)[0];
 assert.equal(row.scored,true);assert.equal(row.at,103700);assert.equal(row.power.actual,110);assert.equal(row.timingBasis,'native-update');assert.equal(row.timingErrorMs,3600);
 assert.equal(observeGangAttrition(f.current(),cycle,{ownerPid:7,nodeReset:1,augReset:2},[row],r),null);
});
test('bonus updates are counted in game milliseconds and the monitor stops at the first change',async t=>{
 const f=fixture(t,[{ms:5000},{ms:5000},{ms:5000},{ms:5000,change:true},{ms:5000,change:true}]);
 await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().processedMs,20000);assert.equal(f.receipt().updates,4);assert.equal(f.receipt().largestUpdateMs,5000);assert.deepEqual(f.calls,[false]);
});
test('more than one native territory interval is ambiguous and cannot produce scored evidence',async t=>{
 const f=fixture(t,Array.from({length:5},(_,i)=>({ms:5000,change:i===4})));await monitorGangEvent(f.ns,f.ticket);
 assert.equal(f.receipt().state,'ambiguous-interval');assert.deepEqual(f.calls,[false]);
 assert.equal(observeGangAttrition(f.current(),{at:110000},f.ticket,[],f.receipt()),null);
});
test('timeout shuts down only the exact active lease and cannot emit an observed receipt',async t=>{
 const f=fixture(t);f.ns.gang.nextUpdate=()=>new Promise(()=>{});f.ns.sleep=async()=>{};
 t.mock.method(globalThis,'setTimeout',callback=>{queueMicrotask(()=>{f.setNow(f.lease.deadline);callback();});return 0;});
 t.mock.method(globalThis,'clearTimeout',()=>{});
 await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().state,'timeout');assert.deepEqual(f.calls,[false]);
});
test('native event races never leave a Netscript sleep running and cancel every timer',async t=>{
 const f=fixture(t,[{ms:2000},{ms:2000,change:true}]),scheduled=[],cleared=[];
 f.ns.sleep=()=>{throw Error('Blocking Netscript sleep must not be used in a race');};
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{scheduled.push({callback,delay});return scheduled.length-1;});
 t.mock.method(globalThis,'clearTimeout',id=>cleared.push(id));
 await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().state,'observed');assert.deepEqual(cleared,[0,1]);assert.deepEqual(f.calls,[false]);
 assert.ok(scheduled.every(t=>t.delay>0&&t.delay<=22000));
});
test('an event after the hard deadline is not scored',async t=>{
 const f=fixture(t,[{ms:2000,wall:23000,change:true}]);await monitorGangEvent(f.ns,f.ticket);
 assert.equal(f.receipt().state,'timeout');assert.deepEqual(f.calls,[false]);
});
test('an update that happened before monitor initialization is not guessed from the clock',async t=>{
 const f=fixture(t);f.setGangs({Own:{power:110,territory:.2},R:{power:90,territory:.8}});
 await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().state,'ambiguous-start');assert.deepEqual(f.calls,[false]);
});
test('reset, owner, and monitor-generation changes cannot disable another lease',async t=>{
 const f=fixture(t,[{ms:2000,change:true,apply:({files})=>{const q=JSON.parse(files[path]);q.startedAt++;files[path]=JSON.stringify(q);}}]);
 await monitorGangEvent(f.ns,f.ticket);assert.deepEqual(f.calls,[]);assert.equal(f.files[out],undefined);
});
test('a reset during the wait leaves the new run untouched',async t=>{
 const f=fixture(t,[{ms:2000,change:true,apply:({ns})=>{ns.getResetInfo=()=>({lastNodeReset:3,lastAugReset:4});}}]);
 await monitorGangEvent(f.ns,f.ticket);assert.deepEqual(f.calls,[]);assert.equal(f.files[out],undefined);
});
test('orphaned or interrupted attempts are shut down without creating a good observation',async t=>{
 const f=fixture(t);f.ns.isRunning=()=>false;await monitorGangEvent(f.ns,f.ticket);
 assert.equal(f.receipt().state,'interrupted');assert.deepEqual(f.calls,[false]);
});
test('manual disable is never re-enabled or mislabeled as a completed monitored event',async t=>{
 const f=fixture(t,[{ms:2000,change:true,apply:({files})=>{const q=JSON.parse(files[path]);q.state='cooldown';q.stopReason='disabled';q.stoppedAt=Date.now();files[path]=JSON.stringify(q);}}]);
 await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().state,'interrupted');assert.deepEqual(f.calls,[]);
});
test('unsupported, invalid and throwing update APIs fail gracefully and disable early warfare',async t=>{
 const f=fixture(t,[{ms:5001}]);await monitorGangEvent(f.ns,f.ticket);assert.equal(f.receipt().state,'invalid-update');assert.deepEqual(f.calls,[false]);
 const g=fixture(t);g.ns.gang.nextUpdate=()=>{throw Error('Source File unavailable');};await monitorGangEvent(g.ns,g.ticket);assert.equal(g.receipt().state,'error');assert.deepEqual(g.calls,[false]);assert.match(g.logs[0],/Source File/);
});
test('invalid entry arguments log locally without throwing',async t=>{
 const f=fixture(t);f.ns.args=['invalid'];await main(f.ns);assert.match(f.logs[0],/Invalid gang event monitor ticket/);assert.deepEqual(f.calls,[]);
});
test('a receipt must match every lease identity and contain a self-consistent first-event snapshot',async t=>{
 const f=fixture(t);await monitorGangEvent(f.ns,f.ticket);const receipt=f.receipt(),scope={ownerPid:7,nodeReset:1,augReset:2},cycle={at:110000};
 for(const patch of [{ownerPid:9},{nodeReset:9},{augReset:9},{startedAt:1},{observerPid:9},{baselineSignature:'other'},{at:130000},{processedMs:20001},{processedMs:NaN},{updates:0},{largestUpdateMs:5001},{observedSignature:'bad'},{info:{faction:'Own',power:111,territory:.2}}]){
  assert.equal(observeGangAttrition(f.current(),cycle,scope,[],{...receipt,...patch}),null);
 }
 assert.equal(observeGangAttrition(f.current(),cycle,scope,[],null),null);
});
test('timing diagnostics report recovered delays and exclude foreign or stale rows',async t=>{
 const f=fixture(t);await monitorGangEvent(f.ns,f.ticket);const scope={...f.ticket,faction:'Own'};
 const rows=observeGangAttrition(f.current(),{at:110000},scope,[],f.receipt());
 const result=gangAttritionTimingStatus([...rows,{...rows[0],at:110001},{...rows[0],augReset:3},{...rows[0],faction:'other'},{...rows[0],scored:false,at:100000}],f.current(),f.receipt(),scope,110000);
 assert.equal(result.samples,2);assert.equal(result.scored,1);assert.equal(result.unscored,1);assert.equal(result.nativeScored,1);assert.equal(result.delayedScored,1);assert.equal(result.absoluteErrorP95Ms,3600);assert.equal(result.monitor,'observed');
});
function dispatch(){
 const now=Date.now(),members=Array.from({length:12},(_,i)=>({name:'M'+i,def:1000,upgrades:[],augmentations:[]}));
 const gang={faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0};
 const files={},calls=[],runs=[],ns={args:[7],read:p=>files[p]||'',write:(p,v)=>files[p]=v,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),getServerMaxRam:()=>256,getServerUsedRam:()=>160,getScriptRam:()=>8,run:(...args)=>{runs.push(args);return 9;},gang:{getGangInformation:()=>gang,getAllGangInformation:()=>({Own:gang,R:{power:10000,territory:.8}}),getMemberNames:()=>members.map(m=>m.name),getMemberInformation:n=>members.find(m=>m.name===n),setTerritoryWarfare:v=>calls.push(v),nextUpdate:async()=>2000}};
 const q={engage:true,eventTimingRequired:true,monitorRequired:true,ownerPid:7,nodeReset:1,augReset:2,at:now,deadline:now+22000,expectedTickAt:now+5000,observationForecast:{wallSeconds:20},faction:'Own',power:22000,territory:.2,signature:gangAttritionSignature(members),rivals:[{name:'R',power:10000}]};
 return {ns,q,files,calls,runs};
}
test('native engagement launches exactly one monitor before enabling and preserves reserve RAM',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),literal=source.match(/const engaged=await getNsDataThroughFile\(ns,(`[^`]+`)/)[1];
 const expression=Function('startGangAttrition','gangMutationAllowed','gangAttritionCalibration','homeRamHeadroom','gangMonitorBackoff','gangAttritionCooldown','return '+literal)(startGangAttrition,()=>true,gangAttritionCalibration,homeRamHeadroom,gangMonitorBackoff,gangAttritionCooldown);
 const f=dispatch();f.ns.args=[7,JSON.stringify(f.q)];assert.equal(Function('ns','return '+expression)(f.ns),true);
 assert.deepEqual(f.calls,[true]);assert.equal(f.runs.length,1);assert.equal(f.runs[0][0],'gang-event-monitor.js');
 const state=JSON.parse(f.files[path]);assert.equal(state.monitorPid,9);assert.equal(state.monitorRequired,true);assert.equal(JSON.parse(f.runs[0][2]).startedAt,state.startedAt);
});
test('insufficient reserved RAM, failed launch and unavailable monitor API cannot enable warfare',()=>{
 for(const mutate of [f=>f.ns.getServerUsedRam=()=>200,f=>f.ns.getScriptRam=()=>0,f=>f.ns.run=()=>0,f=>f.ns.gang.nextUpdate=undefined,f=>f.files['home-ram-reserve.txt']='100']){
  const f=dispatch();mutate(f);assert.equal(startGangAttrition(f.ns,f.q,()=>true,null,homeRamHeadroom),false);assert.deepEqual(f.calls,[]);assert.equal(f.files[path],undefined);
 }
 const f=dispatch();assert.equal(startGangAttrition(f.ns,f.q,()=>true),false);assert.deepEqual(f.calls,[]);
});
test('controller requests monitored leases, consumes receipts and reports timing coverage',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/monitorRequired:true/);assert.match(source,/deadline:Date.now\(\)\+22000/);assert.match(source,/gang-attrition-event.json/);assert.match(source,/history,receipt\)/);assert.match(source,/publishGangAttemptCoverage\(ns,/);assert.match(source,/homeRamHeadroom.toString/);
});
