import {gangAggressionGuardSource} from '../gang-aggression-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangMonitorBackoff,gangAttritionCalibration,planGangAttrition,startGangAttrition} from '../gang-attrition-policy.js';
import {warfareDecision} from '../gang-policy.js';
const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
function waiter(read,members=['A'],assignments={A:'Train Combat'}){
 const start=source.indexOf('async function waitForGameUpdate('),end=source.indexOf('\n/**',start);
 return Function('myGangMembers','assignedTasks','getNsDataThroughFile','return ('+source.slice(start,end)+')')(members,assignments,read);
}
const oldInfo={moneyGainRate:100,respectGainRate:10,wantedLevelGainRate:-1,wantedLevel:100},zero={moneyGainRate:0,respectGainRate:0,wantedLevelGainRate:0,wantedLevel:100};

test('switching every member to training waits for native processing instead of reusing productive rates',async()=>{
 let resolve,reads=0;
 const wait=waiter(async()=>{reads++;return zero;}),promise=wait({gang:{nextUpdate:()=>new Promise(r=>resolve=r)}},oldInfo);
 assert.equal(reads,0);resolve(2000);const result=await promise;
 assert.equal(reads,1);assert.equal(result.moneyGainRate,0);assert.equal(result.updateObserved,true);assert.equal(result.updateCycles,10);
 assert.equal(oldInfo.moneyGainRate,100);
});
test('rate verification uses actual full-roster assignments from the fresh snapshot',async()=>{
 let args;
 const wait=waiter(async(...a)=>{args=a;return {info:zero,names:['A'],tasks:{A:'Train Combat'}};});
 const result=await wait({gang:{nextUpdate:async()=>5000}},oldInfo,{A:'Train Combat'});
 assert.equal(result.updateObserved,true);assert.equal(result.assignmentsVerified,true);assert.equal(result.updateCycles,25);assert.deepEqual(args[3],['A']);
 assert.match(args[1],/getMemberInformation\(name\).task/);
});
test('deferred tasks, partial rosters and changed task names defer warnings and repair safely',async()=>{
 for(const patch of [{tasks:{A:'Human Trafficking'}},{names:['A','B']},{names:[]},{names:['A','A']},{tasks:{}}]){
  const wait=waiter(async()=>({info:zero,names:['A'],tasks:{A:'Train Combat'},...patch}));
  const result=await wait({gang:{nextUpdate:async()=>2000}},oldInfo,{A:'Train Combat'});
  assert.equal(result.updateObserved,false);assert.equal(result.assignmentsVerified,false);
 }
});
test('missing Source Files, invalid batch sizes, read failures and malformed rate snapshots remain unverified',async()=>{
 for(const elapsed of [undefined,NaN,Infinity,0,-1]){
  const wait=waiter(async()=>zero),result=await wait({gang:{nextUpdate:async()=>elapsed}},oldInfo);assert.equal(result.updateObserved,false);
 }
 const unavailable=waiter(async()=>zero);assert.equal((await unavailable({gang:{nextUpdate:async()=>{throw Error('No Source File');}}},oldInfo)).updateObserved,false);
 const failed=waiter(async()=>{throw Error('Member unavailable');});assert.equal((await failed({gang:{nextUpdate:async()=>2000}},oldInfo,{A:'Train Combat'})).updateObserved,false);
 for(const info of [null,{}, {...zero,moneyGainRate:NaN}]){
  const run=waiter(async()=>({info,names:['A'],tasks:{A:'Train Combat'}}));assert.equal((await run({gang:{nextUpdate:async()=>2000}},oldInfo,{A:'Train Combat'})).updateObserved,false);
 }
});
test('warnings require confirmed processing and new task plans are supplied for verification',()=>{
 assert.match(source,/waitForGameUpdate\(ns, oldGangInfo,Object.fromEntries/);
 assert.match(source,/if \(myGangInfo.updateObserved===true&&\(\(expectedWanted/);
 assert.doesNotMatch(source,/if \(myGangInfo.updateObserved!==false&&\(\(expectedWanted/);
 assert.match(source,/updateObserved===true\?'SUCCESS: Optimized':'INFO: Planned'/);
});
test('a new task plan cannot reuse verification from the prior plan when rates remain equal',async()=>{
 const start=source.indexOf('        const oldGangInfo = myGangInfo;'),end=source.indexOf('        log(ns, `${myGangInfo.updateObserved',start);
 assert.ok(start>=0&&end>start);let waits=0;
 const run=Function('updateMemberActivities','gangTaskTotals','waitForGameUpdate',`return async function(myGangInfo){const ns={},dictMembers={},bestTaskAssignments={A:{name:'Train Hacking'}};${source.slice(start,end)}return myGangInfo;}`)(async()=>{},()=>({money:0,respect:0,wanted:0}),async()=>{waits++;throw Error('No rate change to verify');});
 const result=await run({...zero,updateObserved:true,assignmentsVerified:true});
 assert.equal(result.updateObserved,false);assert.equal(result.assignmentsVerified,false);assert.equal(waits,0);
});

const now=100000,scope={nodeReset:1,augReset:2,faction:'Own'};
function attempt(id,state='timeout',at=now){const row={ownerPid:7,observerPid:10+id,nodeReset:1,augReset:2,faction:'Own',startedAt:at-5000,deadline:at+17000,finishedAt:at,state,source:'receipt'};row.key=[row.ownerPid,row.nodeReset,row.augReset,row.startedAt,row.observerPid].join(':');return row;}
test('two, three and four failures produce bounded 90-minute, three-hour and six-hour retries',()=>{
 for(const [count,delay]of [[1,0],[2,5400000],[3,10800000],[4,21600000],[8,21600000]]){
  const rows=Array.from({length:count},(_,i)=>attempt(i,'timeout',now-count+i+1)),result=gangMonitorBackoff(rows,scope,now);
  assert.equal(result.known,true);assert.equal(result.failures,count);assert.equal(result.delayMs,delay);assert.equal(result.suspended,count>=2);assert.equal(result.resumeAt,count>=2?now+delay:null);
 }
});
test('successful captures clear the streak and manual interruptions neither count nor extend it',()=>{
 const failed=[attempt(1,'timeout',now-3000),attempt(2,'error',now-2000)];
 const result=gangMonitorBackoff([...failed,attempt(3,'interrupted',now-1000)],scope,now);assert.equal(result.failures,2);assert.equal(result.lastFailureAt,now-2000);
 assert.equal(gangMonitorBackoff([...failed,attempt(4,'observed')],scope,now).failures,0);
 assert.equal(gangMonitorBackoff([...failed,attempt(4,'observed',now-1000),attempt(5)],scope,now).failures,1);
});
test('a timed retry expires and requires fresh checks rather than remaining permanently blocked',()=>{
 const rows=[attempt(1,'timeout',now-1),attempt(2)],until=now+5400000;
 assert.equal(gangMonitorBackoff(rows,scope,until-1).suspended,true);assert.equal(gangMonitorBackoff(rows,scope,until).suspended,false);
});
test('restarts preserve health history but foreign resets, factions and stale evidence do not',()=>{
 const failed=[attempt(1,'timeout',now-1),attempt(2)];assert.equal(gangMonitorBackoff(failed,{...scope,ownerPid:99},now).suspended,true);
 for(const patch of [{nodeReset:3,augReset:4},{augReset:3},{faction:'Other'}])assert.equal(gangMonitorBackoff(failed,{...scope,...patch},now).failures,0);
 assert.equal(gangMonitorBackoff(failed,scope,now+21600001).failures,0);
});
test('duplicate and corrupt records cannot inflate monitor failures',()=>{
 const a=attempt(1);assert.equal(gangMonitorBackoff([a,a],scope,now).failures,1);
 for(const patch of [{key:'bad'},{source:'lease'},{finishedAt:now+1},{observerPid:0},{state:'unknown'},{deadline:now+22000}])assert.equal(gangMonitorBackoff([a,{...attempt(2),...patch}],scope,now).failures,1);
 assert.equal(gangMonitorBackoff(null,scope,now).known,false);assert.equal(gangMonitorBackoff([],scope,now).suspended,false);
});
test('overdue pending attempts become capture failures, with no need to wait for report publication',()=>{
 const rows=[attempt(1,'missing-receipt',now-5000),attempt(2,'pending',now-4000)];rows[0].source='expired';rows[1].source='lease';delete rows[1].finishedAt;
 assert.equal(gangMonitorBackoff(rows,scope,now+16000).failures,2);
});
test('capture backoff is separate from forecast calibration and pure planner refuses paused health',()=>{
 const rows=[attempt(1,'timeout',now-1),attempt(2)],health=gangMonitorBackoff(rows,scope,now);
 assert.equal(health.suspended,true);assert.equal(gangAttritionCalibration(rows,scope,now).samples,0);
 assert.equal(planGangAttrition({monitorHealth:health}).engage,false);
 assert.equal(planGangAttrition({monitorHealth:{known:false}}).engage,false);
});
test('serialized native dispatch rereads monitor outcomes immediately before any engagement',t=>{
 t.mock.method(Date,'now',()=>now);let members=0;
 const rows=[attempt(1,'timeout',now-1),attempt(2)],q={engage:true,monitorHealthRequired:true,ownerPid:7,nodeReset:1,augReset:2,at:now,deadline:now+22000,faction:'Own',power:22000,territory:.2,signature:'valid'};
 const ns={args:[7],read:()=>JSON.stringify(rows),isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),gang:{getGangInformation:()=>({faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0}),getMemberNames:()=>{members++;return [];}}};
 const start=Function('return ('+startGangAttrition.toString()+')')(),check=Function('return ('+gangMonitorBackoff.toString()+')')();
 assert.equal(gangMonitorBackoff([],scope,now).suspended,false);
 assert.equal(start(ns,q,()=>true,null,null,check),false);assert.equal(members,0);
 ns.read=()=>'[]';assert.equal(start(ns,q,()=>true,null,null,check),false);assert.equal(members,1);
 members=0;ns.read=()=>'{bad';assert.equal(start(ns,q,()=>true,null,null,check),false);assert.equal(members,0);
 assert.equal(start(ns,q,()=>true),false);
});
test('routine warfare remains available while early attempts are paused by monitor health',async t=>{
 t.mock.method(Date,'now',()=>now);const start=source.indexOf('async function enableOrDisableWarfare('),end=source.indexOf('\n// Ram-dodging helper',start),calls=[];
 const q=JSON.stringify([attempt(1,'timeout',now-1),attempt(2)]),ns={pid:7,read:p=>p==='tasks/gang-attrition-attempts.json'?q:p==='tasks/gang-attrition-observations.json'?'[]':'{}',write:async()=>{}};
 const run=Function('gangMonitorBackoff','gangAttritionCalibration','warfareDecision','getNsDataThroughFile','gangAggressionGuardSource',`const resetInfo={lastNodeReset:1,lastAugReset:2},myGangFaction='Own',options={};let warfareFinished=false;const gangMutationAllowed=()=>true,gangWarfareThreshold=()=>.7,formatNumberShort=String,log=()=>{};return (${source.slice(start,end)});`)(gangMonitorBackoff,gangAttritionCalibration,warfareDecision,async(_ns,code,_path,args)=>{if(code==='ns.gang.getAllGangInformation()')return {R:{power:1000,territory:.8}};calls.push(args);return true;},gangAggressionGuardSource);
 await run(ns,{faction:'Own',power:10000,territory:.2,territoryWarfareEngaged:false});assert.equal(calls.length,1);assert.equal(calls[0][0],true);
});
