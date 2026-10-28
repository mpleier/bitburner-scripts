import {readHgwTimeline} from '../hgw-timeline-policy.js';
import {readHackingProcessBudget} from '../hacking-process-policy.js';
import {readBackgroundHealth} from '../background-job-policy.js';
import {currentCloudPurchase} from '../cloud-status-policy.js';
import {commandPolicyVersion} from '../remote-api-command-policy.js';
import {collectControllerDiagnostics} from '../diagnostic-cadence-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as runtime from '../runtime-policy.js';
import {upgradeRemoteWorker} from '../remote-worker-policy.js';
import {readDashboardSummary,boundedDiagnostics} from '../diagnostics-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const reset={lastNodeReset:1,lastAugReset:2},target={policy:20,signature:'new',reset,now:1000,reserve:8};
function workerFixture(){
 const files=new Map([['remote-control/heartbeat.json',JSON.stringify({pid:8,at:11000,policy:19})]]),calls=[];
 let processes=[{pid:8,filename:'remote-api-agent.js',args:['--protocol-version',2]}],free=20,fail=false,kill=true;
 const ns={read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),ps:()=>processes,getScriptRam:()=>10,getRunningScript:()=>({ramUsage:10,threads:1}),getServerMaxRam:()=>100,getServerUsedRam:()=>100-free,kill:pid=>{calls.push(['kill',pid]);if(kill)processes=processes.filter(p=>p.pid!==pid);return kill;},run:(...args)=>{calls.push(['run',...args]);return fail?0:9;}};
 return {ns,files,calls,setProcesses:p=>processes=p,setFree:n=>free=n,setFail:v=>fail=v,setKill:v=>kill=v};
}
function settle(f){assert.equal(upgradeRemoteWorker(f.ns,target).state,'settling');return {...target,now:11000};}
test('idle worker upgrades after debounce and preserves the old autopilot heartbeat policy',()=>{
 const f=workerFixture(),options=settle(f);const r=upgradeRemoteWorker(f.ns,options);assert.equal(r.state,'started');assert.equal(r.legacyPolicy,19);
 assert.deepEqual(f.calls,[['kill',8],['run','remote-api-agent.js',1,'--protocol-version',2,'--legacy-policy',19]]);
});
test('in-flight or not-yet-acknowledged commands prevent replacement',()=>{
 for(const pending of ['job','missing','running']){
  const f=workerFixture(),o=settle(f);f.files.set('remote-control/request.json',JSON.stringify({id:'x',expiresAt:20000}));
  if(pending==='running')f.files.set('remote-control/results/x.json',JSON.stringify({state:'running'}));
  if(pending==='job')f.setProcesses([{pid:8,filename:'remote-api-agent.js',args:['--protocol-version',2]},{pid:10,filename:'remote-control/job.js'}]);
  assert.equal(upgradeRemoteWorker(f.ns,o).state,'waiting-command');assert.equal(f.calls.length,0);
 }
});
test('terminal receipts survive an upgrade without replaying their command',()=>{
 const f=workerFixture(),o=settle(f);const receipt=JSON.stringify({id:'x',state:'completed',result:1});f.files.set('remote-control/request.json',JSON.stringify({id:'x',expiresAt:20000}));f.files.set('remote-control/results/x.json',receipt);
 assert.equal(upgradeRemoteWorker(f.ns,o).state,'started');assert.equal(f.files.get('remote-control/results/x.json'),receipt);
});
test('RAM pressure, hard protection, pause and failed stop leave the worker running',()=>{
 for(const mode of ['ram','blocked','pause','kill']){
  const f=workerFixture(),o=settle(f);if(mode==='ram')f.setFree(0);if(mode==='blocked')o.blocked=true;if(mode==='pause')f.files.set('remote-control/paused/remote-api-agent.js.txt','true');if(mode==='kill')f.setKill(false);
  const r=upgradeRemoteWorker(f.ns,o);assert.notEqual(r.state,'started');assert.equal(f.calls.filter(c=>c[0]==='run').length,0);if(mode!=='kill')assert.equal(f.calls.length,0);
 }
});
test('current active signature avoids restart even when the legacy heartbeat policy is older',()=>{
 const f=workerFixture();f.files.set('remote-control/heartbeat.json',JSON.stringify({pid:8,at:1000,policy:19,activePolicy:20,signature:'new'}));assert.equal(upgradeRemoteWorker(f.ns,target).state,'current');assert.equal(f.calls.length,0);
});
test('three failed restorations stop repeated restart attempts',()=>{
 const f=workerFixture(),o=settle(f);f.setFail(true);for(let i=0;i<3;i++)assert.equal(upgradeRemoteWorker(f.ns,{...o,now:11000+i*1000}).state,'start-failed');
 assert.equal(upgradeRemoteWorker(f.ns,{...o,now:14000}).state,'retry-limit');assert.equal(f.calls.filter(c=>c[0]==='run').length,3);
});
test('worker emits legacy and active policies while autopilot delegates upgrades',()=>{
 const source=readFileSync(new URL('../remote-api-agent.js',import.meta.url),'utf8');assert.match(source,/policy:legacyPolicy,activePolicy:commandPolicyVersion,signature/);
 const auto=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');assert.doesNotMatch(auto,/workerHeartbeat.policy !== commandPolicyVersion/);assert.match(auto,/if \(!remoteWorker\)/);
});
function summaryFixture(){const files=new Map(),reads=[],now=10000;const ns={read:f=>{reads.push(f);return files.get(f)||'';},getResetInfo:()=>reset,ps:()=>[{pid:7,filename:'reliability-manager.js'}]};const summary={schemaVersion:1,at:now,ownerPid:7,nodeReset:1,augReset:2,pending:[]};files.set('tasks/dashboard-summary.json',JSON.stringify(summary));files.set('tasks/dashboard.json',JSON.stringify({full:true}));return {ns,files,reads,now,summary};}
test('fresh summaries avoid reading the large dashboard',()=>{
 const f=summaryFixture();assert.equal(readDashboardSummary(f.ns,f.now).ownerPid,7);assert.deepEqual(f.reads,['tasks/dashboard-summary.json']);
});
test('stale, future, foreign-reset and wrong-owner summaries fall back to detailed data',()=>{
 for(const patch of [{at:-30000},{at:11000},{nodeReset:3},{augReset:4},{ownerPid:8},{schemaVersion:2}]){const f=summaryFixture();f.files.set('tasks/dashboard-summary.json',JSON.stringify({...f.summary,...patch}));assert.deepEqual(readDashboardSummary(f.ns,f.now),{full:true});}
});
test('serialized generated status uses a valid summary and keeps detailed queries separate',async()=>{
 const f=summaryFixture();f.summary.at=Date.now();f.files.set('tasks/dashboard-summary.json',JSON.stringify(f.summary));const request={id:'qc',method:'automation.status',args:[],expiresAt:Date.now()+10000};let result;
 const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(request)).toString('base64'));await job.main({...f.ns,args:['[]','out','qc'],write:async(_,s)=>result=JSON.parse(s)});
 assert.equal(result.state,'completed');assert.equal(result.result.dashboard.schemaVersion,1);assert.ok(!f.reads.includes('tasks/dashboard.json'));
});

async function supervise({script='gangs.js',protectedWork=true,activity=false,failRuns=0,loops=2,free=512,onSleep=()=>{},diagnosticBound=boundedDiagnostics}={}){
 const text=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'');
 let now=300000,pass=0,pid=8;const files=new Map(),calls=[],writes=[];let processes=[{pid,filename:script,threads:2,args:['original']}];
 files.set('tasks/runtime/8.json',JSON.stringify({pid:8,signature:'old',startedAt:1,at:now}));
 const stop=Error('test complete');
 const ns={pid:7,args:[],disableLog(){},getScriptName:()=> 'reliability-manager.js',getResetInfo:()=>reset,atExit(){},read:f=>files.get(f)||'',write:(f,s)=>{writes.push({file:f,at:now});files.set(f,s);},rm:f=>files.delete(f),ps:()=>processes,getScriptRam:()=>10,getRunningScript:()=>({ramUsage:10,threads:2}),getServerMaxRam:()=>512,getServerUsedRam:()=>512-free,getScriptLogs:()=>[],ls:()=>[],isRunning:p=>processes.some(x=>x.pid===p),print(){},kill:p=>{calls.push(['kill',p]);processes=processes.filter(x=>x.pid!==p);return true;},run:(name,threads,...args)=>{calls.push(['run',name,threads,...args]);if(failRuns-->0)return 0;pid++;processes.push({pid,filename:name,threads,args});files.set('tasks/runtime/'+pid+'.json',JSON.stringify({pid,signature:runtime.scriptSignature(ns,name),startedAt:now,at:now}));return pid;},sleep:async()=>{pass++;onSleep({setFree:n=>free=n});now+=10000;if(pass>=loops)throw stop;}};
 const context={readHgwTimeline,readHackingProcessBudget,readBackgroundHealth,currentCloudPurchase,collectControllerDiagnostics,...runtime,Date:{now:()=>now},upgradeRemoteWorker:()=>({state:'test'}),commandPolicyVersion:20,boundedDiagnostics:diagnosticBound,hackingDrainActive:()=>false,collectHashSpendingStatus:()=>[],homeRamReserve:()=>8,reclaimHomeRam:()=>true,isScriptPaused:()=>false,activityRecord:()=>activity?{ownerPid:99}:null,getNsDataThroughFile:async()=>protectedWork,autopilotSourceFiles:()=>({4:3}),ns};
 vm.runInNewContext(text.replace('export async function','async function')+';globalThis.run=main;',context);await assert.rejects(context.run(ns),e=>e===stop);return {files,calls,writes};
}
test('executed supervisor reloads gangs during graft protection without global maintenance',async()=>{
 const r=await supervise();assert.deepEqual(r.calls,[['kill',8],['run','gangs.js',2,'original']]);assert.equal(r.files.has('tasks/automation-maintenance.json'),false);assert.ok(r.files.has('tasks/dashboard-summary.json'));
});
test('executed supervisor blocks player controllers and all independent reloads under activity locks',async()=>{
 for(const options of [{script:'autopilot.js'},{script:'gangs.js',activity:true}])assert.equal((await supervise(options)).calls.length,0);
});
test('executed supervisor restores a failed launch next pass with original arguments',async()=>{
 const r=await supervise({failRuns:1,loops:3});assert.equal(r.calls.filter(c=>c[0]==='kill').length,1);assert.equal(r.calls.filter(c=>c[0]==='run').length,2);assert.ok(r.calls.filter(c=>c[0]==='run').every(c=>c[2]===2&&c[3]==='original'));
});
test('executed supervisor waits for sufficient RAM before replacing a process',async()=>{
 const r=await supervise({free:0,onSleep:({setFree})=>setFree(512)});assert.equal(r.calls.filter(c=>c[0]==='kill').length,1);assert.equal(r.calls.filter(c=>c[0]==='run').length,1);
});

test('malformed upgrade clocks reset debounce and newer active policies do not downgrade',()=>{
 const f=workerFixture();settle(f);let record=JSON.parse(f.files.get('tasks/remote-worker-upgrade.json'));record.candidateAt=1e15;f.files.set('tasks/remote-worker-upgrade.json',JSON.stringify(record));assert.equal(upgradeRemoteWorker(f.ns,{...target,now:11000}).state,'settling');
 f.files.set('remote-control/heartbeat.json',JSON.stringify({pid:8,at:12000,policy:19,activePolicy:21,signature:'new'}));assert.equal(upgradeRemoteWorker(f.ns,{...target,now:12000}).state,'current');assert.equal(f.calls.length,0);
});
test('actual worker heartbeat preserves the legacy policy and reports its active code signature',async()=>{
 const {main}=await import('../remote-api-agent.js');const files=new Map(),stop=Error('done');
 const ns={pid:9,args:['--protocol-version',2,'--legacy-policy',19],disableLog(){},getHostname:()=> 'home',getScriptName:()=> 'remote-api-agent.js',ps:()=>[],print(){},tprint(){},read:f=>files.get(f)||'',write:async(f,s)=>files.set(f,s),sleep:async()=>{throw stop;}};
 await assert.rejects(main(ns),e=>e===stop);const heartbeat=JSON.parse(files.get('remote-control/heartbeat.json'));assert.equal(heartbeat.policy,19);assert.equal(heartbeat.activePolicy,commandPolicyVersion);assert.equal(typeof heartbeat.signature,'string');
});

test('executed supervisor restores trusted summary metadata after diagnostic truncation',async()=>{
 const r=await supervise({diagnosticBound:()=>({at:null,ownerPid:null,nodeReset:{truncated:true}})});const summary=JSON.parse(r.files.get('tasks/dashboard-summary.json'));
 assert.equal(summary.schemaVersion,1);assert.equal(summary.ownerPid,7);assert.equal(typeof summary.at,'number');assert.equal(summary.nodeReset,1);assert.equal(summary.augReset,2);
});

test('legacy policy survives current and settling records when heartbeats become stale',()=>{
 const f=workerFixture();f.files.set('remote-control/heartbeat.json',JSON.stringify({pid:8,at:1000,policy:19,activePolicy:20,signature:'new'}));
 assert.equal(upgradeRemoteWorker(f.ns,target).legacyPolicy,19);
 assert.equal(upgradeRemoteWorker(f.ns,{...target,signature:'next',now:20000}).state,'settling');
 const result=upgradeRemoteWorker(f.ns,{...target,signature:'next',now:30000});assert.equal(result.state,'started');assert.equal(result.legacyPolicy,19);
});

test('executed supervisor publishes seven fresh summaries but only two full snapshots over a minute',async()=>{
 const r=await supervise({loops:7});assert.equal(r.writes.filter(w=>w.file==='tasks/dashboard-summary.json').length,7);assert.equal(r.writes.filter(w=>w.file==='tasks/dashboard.json').length,2);
 const full=JSON.parse(r.files.get('tasks/dashboard.json')),summary=JSON.parse(r.files.get('tasks/dashboard-summary.json'));assert.equal(summary.at,full.at);assert.equal(summary.diagnostics.detailAt,summary.at);
});

test('queued requests do not block restoring a missing or stale worker',()=>{
 for(const mode of ['missing','stale','missing-with-job']){
  const f=workerFixture(),o=settle(f);o.now=31000;
  f.files.set('remote-control/request.json',JSON.stringify({id:'x',expiresAt:90000}));
  if(mode==='missing')f.setProcesses([]);
  if(mode==='missing-with-job')f.setProcesses([{pid:10,filename:'remote-control/job.js',args:['[]','out','x']}]);
  assert.equal(upgradeRemoteWorker(f.ns,o).state,'started');
 }
 const f=workerFixture(),o=settle(f);o.now=31000;f.setProcesses([{pid:8,filename:'remote-api-agent.js',args:[]},{pid:10,filename:'remote-control/job.js'}]);
 assert.equal(upgradeRemoteWorker(f.ns,o).state,'waiting-command');
});
