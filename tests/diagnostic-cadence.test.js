import {readDashboardSummary} from '../diagnostics-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectControllerDiagnostics} from '../diagnostic-cadence-policy.js';
import {supervisorHandoffStatus,supervisorUpdatePlan,scriptSignature} from '../runtime-policy.js';
import {upgradeRemoteWorker} from '../remote-worker-policy.js';
import {main as agent} from '../remote-api-agent.js';
const reset={lastNodeReset:1,lastAugReset:2};
test('thirty normal health passes produce five detailed snapshots instead of thirty',()=>{
 const processes=[{pid:1,filename:'daemon.js',args:[]}],ns={getScriptLogs:()=>Array.from({length:120},(_,i)=>'line '+i)};let state=null,details=0;
 for(let i=0;i<30;i++){state=collectControllerDiagnostics(ns,processes,state,1000+i*10000);if(state.detailDue)details++;}
 assert.equal(details,5);assert.equal(state.logs[0].lines.length,120);assert.equal(state.detailAt,241000);
});
test('new warnings appear between detail snapshots, are deduplicated, and expire',()=>{
 let lines=['normal'];const ns={getScriptLogs:()=>lines},processes=[{pid:1,filename:'daemon.js'}];let state=collectControllerDiagnostics(ns,processes,null,1000);
 lines=['WARNING: timing'];state=collectControllerDiagnostics(ns,processes,state,11000);assert.equal(state.detailDue,false);assert.equal(state.warnings.length,1);assert.equal(state.warnings[0].at,11000);assert.deepEqual(state.logs[0].lines,['normal']);
 state=collectControllerDiagnostics(ns,processes,state,21000);assert.equal(state.warnings.length,1);lines=[];state=collectControllerDiagnostics(ns,processes,state,330000);assert.equal(state.warnings.length,0);
});
test('warning collection, failures and process churn remain bounded',()=>{
 const processes=Array.from({length:100},(_,i)=>({pid:i,filename:'manager.js'})),ns={getScriptLogs:()=>{throw Error('unavailable');}};
 const state=collectControllerDiagnostics(ns,processes,null,1000);assert.equal(state.logs.length,32);assert.equal(state.warnings.length,24);
 const next=collectControllerDiagnostics({getScriptLogs:()=>[]},[{pid:101,filename:'new.js'}],state,11000);assert.deepEqual(Object.keys(next.fingerprints),['101']);
});
test('handoff explains RAM shortages while respecting native costs and reserved headroom',()=>{
 const ns={getRunningScript:()=>({ramUsage:10,threads:1}),getScriptName:()=> 'reliability-manager.js',getScriptRam:()=>20,getServerMaxRam:()=>100,getServerUsedRam:()=>90};
 const status=supervisorHandoffStatus(ns,{state:'ready'},{reserve:10});assert.equal(status.state,'waiting-ram');assert.equal(status.availableRam,20);assert.equal(status.requiredRam,30);assert.equal(status.shortfallRam,10);
 assert.equal(supervisorHandoffStatus({...ns,getServerUsedRam:()=>80},{state:'ready'},{reserve:10}).state,'ready');
 assert.equal(supervisorHandoffStatus(ns,{state:'ready'},{blocked:true}).state,'waiting-activity');
 assert.equal(supervisorHandoffStatus({...ns,getRunningScript:()=>null},{state:'ready'}).state,'waiting-process');
});
test('planning explains protected work, pending restores, settle time and retry limits',()=>{
 const input={reset,now:1000,launchedSignature:'old',currentSignature:'new'};
 assert.match(supervisorUpdatePlan({...input,protectedWork:true}).reason,/protected/);
 assert.match(supervisorUpdatePlan({...input,pendingRestores:true}).reason,/restored/);
 assert.match(supervisorUpdatePlan(input).reason,/settle/);
 const prior={...supervisorUpdatePlan(input),candidateAt:0,attempts:3,windowAt:1};assert.match(supervisorUpdatePlan({...input,previous:prior,now:11000}).reason,/retry/);
});

test('actual autopilot start block and supervisor recover together from RAM pressure and a failed launch',async()=>{
 const source=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=source.indexOf("        const remoteWorker = findScript('remote-api-agent.js');"),end=source.indexOf('        // Launch the standalone manager',start);
 assert.ok(start>0&&end>start);const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const startMissing=new AsyncFunction('ns','findScript','getFilePath','getNsDataThroughFile','launchScriptHelper',source.slice(start,end));
 let now=1000,free=0,fail=false,nextPid=9,processes=[{pid:8,filename:'remote-api-agent.js',args:['--protocol-version',2]}];const files=new Map(),calls=[];
 files.set('remote-control/heartbeat.json',JSON.stringify({pid:8,at:1000,policy:19}));
 const ns={pid:7,args:[],read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),ps:()=>processes,fileExists:()=>true,getScriptRam:()=>10,getRunningScript:()=>({ramUsage:10,threads:1}),getServerMaxRam:()=>100,getServerUsedRam:()=>100-free,kill:p=>{calls.push(['kill',p]);processes=processes.filter(v=>v.pid!==p);return true;},run:(name,threads,...args)=>{calls.push(['run',name,...args]);if(fail)return 0;processes.push({pid:nextPid,filename:name,args,threads});return nextPid++;}};
 const auto=()=>startMissing(ns,name=>processes.find(p=>p.filename===name),x=>x,async()=>free,(_,name,args)=>ns.run(name,1,...args));
 const target={policy:20,signature:scriptSignature(ns,'remote-api-agent.js'),reset,reserve:8};
 assert.equal(upgradeRemoteWorker(ns,{...target,now}).state,'settling');await auto();assert.equal(calls.length,0);
 now=11000;assert.equal(upgradeRemoteWorker(ns,{...target,now}).state,'waiting-ram');await auto();assert.equal(calls.length,0);
 free=30;fail=true;now=12000;assert.equal(upgradeRemoteWorker(ns,{...target,now}).state,'start-failed');assert.equal(processes.length,0);
 fail=false;await auto();assert.equal(processes.length,1);const worker=processes[0],stop=Error('stop test'),original=Date.now;Date.now=()=>now;
 try{await assert.rejects(agent({...ns,pid:worker.pid,args:worker.args,getHostname:()=> 'home',getScriptName:()=> 'remote-api-agent.js',disableLog(){},tprint(){},sleep:async()=>{throw stop;}}),e=>e===stop);}finally{Date.now=original;}
 for(let i=0;i<3;i++){await auto();assert.equal(upgradeRemoteWorker(ns,{...target,now}).state,'current');}
 assert.equal(calls.filter(c=>c[0]==='kill').length,1);assert.equal(calls.filter(c=>c[0]==='run').length,2);assert.equal(JSON.parse(files.get('remote-control/heartbeat.json')).policy,19);
});

test('warning checks cover the same 120-line window as detailed snapshots',()=>{
 const ns={getScriptLogs:()=>['WARNING: older line',...Array(100).fill('normal')]};const s=collectControllerDiagnostics(ns,[{pid:1,filename:'daemon.js'}],null,1000);assert.equal(s.warnings[0].line,'WARNING: older line');assert.equal(s.omittedProcesses,0);
});

test('UI falls back to detailed managers when summary fields have been truncated',()=>{
 const summary={schemaVersion:1,ownerPid:7,at:1000,nodeReset:1,augReset:2,managers:{truncated:true},pending:[]},full={managers:Array.from({length:20},(_,i)=>({script:String(i)})),pending:[]};
 const ns={read:f=>JSON.stringify(f==='tasks/dashboard-summary.json'?summary:full),getResetInfo:()=>reset,ps:()=>[{pid:7,filename:'reliability-manager.js'}]};
 assert.equal(readDashboardSummary(ns,1000,{requireManagers:true}).managers.length,20);summary.managers=full.managers;assert.equal(readDashboardSummary(ns,1000,{requireManagers:true}).managers.length,20);
});
test('warning classification occurs before shortening long log lines',()=>{
 const state=collectControllerDiagnostics({getScriptLogs:()=>['x'.repeat(600)+' ERROR: failure']},[{pid:1,filename:'daemon.js'}],null,1000);assert.equal(state.warnings.length,1);assert.equal(state.warnings[0].line.length,512);
});

test('API command facade avoids relative re-export sources unsupported by native RAM calculation',()=>{
 const source=readFileSync(new URL('../remote-api-command.js',import.meta.url),'utf8');assert.doesNotMatch(source,/export\s*\{[^}]+\}\s*from\s*['"]\./);
 assert.match(source,/export \{commandFile,heartbeatFile,commandPolicyVersion,resultFile,managedScripts,diagnosticScripts,validateCommand\};/);
});
