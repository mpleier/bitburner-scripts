import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runBackgroundCheck,backgroundHealthSnapshot,readBackgroundHealth,backgroundJobDue,backgroundJobDispatched} from '../background-job-policy.js';
import {sharedNetworkSnapshot,readSharedNetwork} from '../network-snapshot-policy.js';
const reset={lastAugReset:1,lastNodeReset:2};

test('dispatch health distinguishes launches, existing processes and expected blocking',async()=>{
 const tool={name:'job.js'};let now=1000;
 for(const outcome of ['launched','running','blocked:ram','blocked:paused','failed'])
  await runBackgroundCheck({},tool,async()=>{tool.lastOutcome=outcome;now+=5;return outcome==='launched';},()=>now);
 const r=backgroundHealthSnapshot({pid:7,isRunning:()=>false},[tool],reset,now).jobs[0];
 assert.equal(r.launched,1);assert.equal(r.running,1);assert.equal(r.blocked,2);assert.equal(r.failed,1);assert.equal(r.dispatchMs,5);
 assert.equal(r.blockedReasons.ram,1);assert.equal(r.blockedReasons.paused,1);
});
test('dispatch exceptions remain errors and the rolling observation list is bounded',async()=>{
 const tool={name:'job.js'};
 await assert.rejects(runBackgroundCheck({},tool,async()=>{throw Error('broken');},()=>1000),/broken/);
 assert.match(tool.health.lastError,/broken/);
 for(let i=0;i<100;i++)await runBackgroundCheck({},tool,async()=>{tool.lastOutcome='running';return true;},()=>2000+i);
 assert.equal(tool.health.events.length,64);
 const r=backgroundHealthSnapshot({pid:7,isRunning:()=>false},[tool],reset,400000).jobs[0];assert.equal(r.checks,0);
});
test('execution lifetimes are bounded observations and exits never claim success',async()=>{
 const tool={name:'job.js'};
 await runBackgroundCheck({},tool,async()=>{tool.lastOutcome='launched';tool.lastPid=8;return true;},()=>1000);
 backgroundHealthSnapshot({pid:7,isRunning:()=>true},[tool],reset,4000);
 const r=backgroundHealthSnapshot({pid:7,isRunning:()=>false},[tool],reset,6000).jobs[0];
 assert.equal(r.active,null);assert.deepEqual(r.lastExecution,{pid:8,exitObservedAt:6000,runtimeLowerMs:3000,runtimeUpperMs:5000,result:'exit-observed'});
});
test('job health accepts only fresh live current-run reports',()=>{
 let record={schemaVersion:1,at:1000,ownerPid:7,nodeReset:2,augReset:1,jobs:[]};
 const ns={read:()=>JSON.stringify(record),getResetInfo:()=>reset,isRunning:p=>p===7};
 assert.ok(readBackgroundHealth(ns,2000));
 for(const patch of [{at:3000},{at:-30000},{ownerPid:9},{nodeReset:3},{augReset:3},{jobs:null},{schemaVersion:2}]){
  const original=record;record={...record,...patch};assert.equal(readBackgroundHealth(ns,2000),null);record=original;
 }
});
test('ordinary work has a bounded deterministic phase; critical startup remains immediate',()=>{
 const a={name:'contractor',interval:60000},b={name:'analyze-hack',interval:60000};
 backgroundJobDue(a,1000);backgroundJobDue(b,1000);
 assert.ok(a.nextDue>=1000&&a.nextDue<=3000);assert.ok(b.nextDue>=1000&&b.nextDue<=3000);assert.notEqual(a.nextDue,b.nextDue);
 assert.equal(backgroundJobDue(a,a.nextDue),true);
 for(const flag of ['infrastructure','backdoorUnlocks','factionInvites'])assert.equal(backgroundJobDue({name:'critical',interval:60000,[flag]:true},1000),true);
 assert.equal(backgroundJobDue({name:'job',interval:60000,lastRun:1000,nextDue:999999},2000,true),true);
});
test('blocked dispatches back off up to thirty seconds and success restores the interval',()=>{
 const job={name:'job.js',interval:60000,lastRun:1000};
 for(const delay of [1000,2000,4000,8000,16000,30000,30000]){backgroundJobDispatched(job,'blocked:ram',1000);assert.equal(job.nextDue,1000+delay);}
 backgroundJobDispatched(job,'running',1000);assert.equal(job.retryCount,0);assert.ok(job.nextDue>=61000&&job.nextDue<=63000);
 backgroundJobDispatched(job,'blocked:paused',1000);assert.ok(job.nextDue>=61000);
 job.lastRun=5000;job.nextDue=6000;backgroundJobDue(job,1000);assert.equal(job.lastRun,0);assert.ok(job.nextDue<=3000);
});
test('snapshot publication includes all hosts and consumers cannot mutate the original list',()=>{
 const hosts=['home','n00dles','hacknet-server-0','home'],r=sharedNetworkSnapshot(hosts,7,reset,1000);
 assert.deepEqual(r.servers,['home','n00dles','hacknet-server-0']);assert.equal(hosts.length,4);
 for(const invalid of [[],['n00dles'],['home',null],['home','']])assert.equal(sharedNetworkSnapshot(invalid,7,reset),null);
});
test('shared discovery rejects stale, future, foreign, dead and malformed snapshots',()=>{
 let record=sharedNetworkSnapshot(['home','n00dles'],7,reset,1000);
 const ns={getHostname:()=> 'home',getResetInfo:()=>reset,isRunning:p=>p===7,read:()=>JSON.stringify(record)};
 assert.deepEqual(readSharedNetwork(ns,2000).servers,['home','n00dles']);
 for(const patch of [{at:3000},{at:-14000},{ownerPid:9},{nodeReset:3},{augReset:3},{servers:['n00dles']},{schemaVersion:2}]){
  const original=record;record={...record,...patch};assert.equal(readSharedNetwork(ns,2000),null);record=original;
 }
 assert.equal(readSharedNetwork({...ns,getHostname:()=> 'remote'},2000),null);
});
test('contract collector uses shared discovery while listing current contract files live',async()=>{
 const s=await readFile(new URL('../Tasks/contractor.js',import.meta.url),'utf8');let scans=0,lists=[];
 const ns={pid:9,getHostname:()=> 'home',getResetInfo:()=>({lastNodeReset:42,lastAugReset:7}),print(){},ls:(h,prefix)=>{if(prefix==='tasks/dnet-survey-')return [];lists.push(h);if(h==='deleted')throw Error('host gone');return [];},write:async()=>{}};
 const context={ns,instanceCount:async()=>1,log(){},reconcileContractDelivery:async()=>({busy:false}),disableLogs(){},readSharedNetwork:()=>({servers:['home','deleted']}),getNsDataThroughFile:async()=>{scans++;return ['home'];}};
 vm.runInNewContext(s.slice(s.indexOf('export async function main')).replace('export async function main','async function main')+';globalThis.collect=main;',context);
 await context.collect(ns);assert.equal(scans,0);assert.deepEqual(lists,['home','deleted']);
 context.readSharedNetwork=()=>null;lists=[];await context.collect(ns);assert.equal(scans,1);assert.deepEqual(lists,['home']);
});


test('short executions are observed before another dispatch replaces their PID',async()=>{
 const tool={name:'job.js'},ns={isRunning:()=>false};
 await runBackgroundCheck(ns,tool,async()=>{tool.lastOutcome='launched';tool.lastPid=8;return true;},()=>1000);
 await runBackgroundCheck(ns,tool,async()=>{tool.lastOutcome='launched';tool.lastPid=9;return true;},()=>2000);
 assert.equal(tool.health.active.pid,9);assert.equal(tool.health.lastExecution.pid,8);assert.equal(tool.health.lastExecution.runtimeUpperMs,1000);
});
test('executed periodic scheduling spreads ordinary starts and backs off thrown failures',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),start=s.indexOf('    async function runPeriodicScripts('),end=s.indexOf('    async function tryRunTool(',start),body=s.slice(start,end);
 const job={name:'contractor',interval:60000};let now=1000,attempts=0,broken=true;
 const context={periodicScripts:[job],backgroundJobDue,backgroundJobDispatched,Date:{now:()=>now},getPlayerMoney:()=>0,infrastructureCashBand:()=>0,
  getTool:s=>s,dictSourceFiles:{},options:{},tryRunTool:async()=>{attempts++;job.lastOutcome=broken?'failed':'launched';if(broken)throw Error('launch failure');return true;}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.run=runPeriodicScripts;',context);
 const ns={read:()=>'',sleep:async()=>{}};
 await context.run(ns);assert.equal(attempts,0);
 now=job.nextDue;await assert.rejects(context.run(ns),/launch failure/);assert.equal(attempts,1);
 const retryAt=job.nextDue;now++;await context.run(ns);assert.equal(attempts,1);
 now=retryAt;broken=false;await context.run(ns);assert.equal(attempts,2);assert.equal(job.retryCount,0);assert.ok(job.nextDue>=now+60000);
});
