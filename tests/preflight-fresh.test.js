import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScriptPreflight,freshManagedLogs} from '../native-preflight-policy.js';
import {collectControllerDiagnostics} from '../diagnostic-cadence-policy.js';
import {validateCommand,diagnosticScripts,commandPolicyVersion} from '../remote-api-command-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
import {parseNativeQc} from '../scripts/native-qc-core.js';
const reset={lastNodeReset:1,lastAugReset:2},command=(method,args=[])=>({id:'qc',method,args,expiresAt:Date.now()+60000});
test('native preflight reports ready, missing, invalid and unavailable scripts without starting anything',()=>{
 const ns={getResetInfo:()=>reset,fileExists:name=>name!=='missing',getScriptRam:name=>{if(name==='throw')throw Error('unavailable');return name==='bad'?0:4;},run:()=>{throw Error('must not run');}};
 const r=nativeScriptPreflight(ns,['good','missing','bad','throw','good'],1000);assert.equal(r.ok,false);assert.deepEqual(r.scripts.map(s=>s.status),['ready','missing','invalid','unavailable']);assert.equal(r.nodeReset,1);assert.match(r.limitations,/not run/);
});
test('native preflight cannot accept nonfinite RAM as a successful check',()=>{
 for(const ram of [NaN,Infinity,-1,0])assert.equal(nativeScriptPreflight({getResetInfo:()=>reset,fileExists:()=>true,getScriptRam:()=>ram},['daemon.js']).ok,false);
});
test('native and fresh log commands enforce script allowlists and bounded arguments',()=>{
 assert.equal(commandPolicyVersion,26);assert.doesNotThrow(()=>validateCommand(command('automation.preflight')));assert.doesNotThrow(()=>validateCommand(command('automation.preflight',['daemon.js'])));
 assert.doesNotThrow(()=>validateCommand(command('automation.logsFresh',['spend-hacknet-hashes.js'])));
 for(const c of [command('automation.preflight',['secret.txt']),command('automation.preflight',Array(49).fill('daemon.js')),command('automation.logsFresh'),command('automation.logsFresh',['../x']),command('automation.logsFresh',['daemon.js',8])])assert.throws(()=>validateCommand(c));
});
test('fresh logs query live processes, not a stored dashboard, and report omitted instances',()=>{
 const pids=[];const r=freshManagedLogs({ps:()=>Array.from({length:8},(_,i)=>({pid:i,filename:i===0?'other.js':'daemon.js'})),getScriptLogs:pid=>{pids.push(pid);return Array.from({length:50},(_,i)=>String(i)+'x'.repeat(300));}},'daemon.js',1000);
 assert.equal(r.source,'native');assert.equal(r.processCount,7);assert.equal(r.omittedProcesses,3);assert.deepEqual(pids,[7,6,5,4]);assert.equal(r.logs[0].lines.length,10);assert.equal(r.logs[0].lines[0].slice(0,2),'40');assert.equal(r.logs[0].lines[0].length,256);
});
test('fresh logs retain per-process errors and absent scripts return an empty live sample',()=>{
 const r=freshManagedLogs({ps:()=>[{pid:1,filename:'daemon.js'}],getScriptLogs:()=>{throw Error('process exited');}},'daemon.js');assert.match(r.logs[0].error,/exited/);assert.deepEqual(r.logs[0].lines,[]);
 assert.deepEqual(freshManagedLogs({ps:()=>[]},'daemon.js').logs,[]);
});
async function generated(method,args,ns){let reply;const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(command(method,args))).toString('base64'));await job.main({...ns,args:[JSON.stringify(args),'out','qc'],write:async(file,s)=>{if(ns.write)await ns.write(file,s);if(file==='out')reply=JSON.parse(s);}});return reply;}
test('generated native preflight defaults to every diagnostic entrypoint and has no mutations',async()=>{
 const r=await generated('automation.preflight',[],{getResetInfo:()=>reset,fileExists:()=>true,getScriptRam:()=>4});assert.equal(r.state,'completed');assert.equal(r.result.ok,true);assert.equal(r.result.scripts.length,new Set(diagnosticScripts).size);
});
test('generated fresh log query remains within the response bound for worst-case escaped lines',async()=>{
 const r=await generated('automation.logsFresh',['daemon.js'],{ps:()=>Array.from({length:4},(_,i)=>({pid:i,filename:'daemon.js'})),getScriptLogs:()=>Array(10).fill('\u0000'.repeat(256))});
 assert.equal(r.state,'completed');assert.equal(r.result.logs.length,4);assert.equal(r.result.logs[0].lines.length,10);assert.ok(Buffer.byteLength(JSON.stringify(r.result))<=65536);
});
test('remote start does not remove a pause or launch after invalid native RAM or insufficient space',async()=>{
 for(const ram of [0,NaN,20]){
  const files=new Map([['remote-control/paused/daemon.js.txt','true']]);let runs=0;
  const r=await generated('start',['daemon.js'],{read:f=>files.get(f)||'',ps:()=>[],getScriptRam:()=>ram,getServerMaxRam:()=>10,getServerUsedRam:()=>5,rm:f=>files.delete(f),run:()=>{runs++;}});
  assert.equal(r.state,'failed');assert.equal(files.get('remote-control/paused/daemon.js.txt'),'true');assert.equal(runs,0);
 }
});
test('CLI QC parser rejects incomplete, failed, invalid and empty responses',()=>{
 for(const stdout of ['',JSON.stringify({queued:true}),JSON.stringify({state:'failed',error:'offline'}),JSON.stringify({state:'completed',result:{check:'native-ram',ok:false,scripts:[{status:'invalid',ram:0}]}}),JSON.stringify({state:'completed',result:{check:'native-ram',ok:true,scripts:[]}})])assert.equal(parseNativeQc(stdout).ok,false);
 const good=parseNativeQc(JSON.stringify({queued:true})+'\n'+JSON.stringify({state:'completed',result:{check:'native-ram',ok:true,scripts:[{script:'daemon.js',status:'ready',ram:4}]}}));assert.equal(good.ok,true);
});
test('retained warning text updates visibility without inflating confirmed occurrences',()=>{
 const ns={getScriptLogs:()=>['WARNING: repeated']},ps=[{pid:1,filename:'daemon.js'}];let s=null;
 for(const now of [1000,11000,21000])s=collectControllerDiagnostics(ns,ps,s,now);
 assert.equal(s.warnings.length,1);const w=s.warnings[0];assert.equal(w.visibleCount,1);assert.equal(w.confirmedOccurrences,1);assert.equal(w.observations,3);assert.equal(w.firstSeenAt,1000);assert.equal(w.lastSeenAt,21000);assert.equal(w.lastNewOccurrenceAt,1000);
});
test('warning count increases provide a conservative count as windows roll',()=>{
 let count=2;const ps=[{pid:1,filename:'daemon.js'}],ns={getScriptLogs:()=>Array(count).fill('ERROR: same')};let s=collectControllerDiagnostics(ns,ps,null,1000);
 count=3;s=collectControllerDiagnostics(ns,ps,s,11000);assert.equal(s.warnings[0].confirmedOccurrences,3);
 count=1;s=collectControllerDiagnostics(ns,ps,s,21000);assert.equal(s.warnings[0].confirmedOccurrences,3);
 count=2;s=collectControllerDiagnostics(ns,ps,s,31000);assert.equal(s.warnings[0].confirmedOccurrences,4);assert.equal(s.warnings[0].lastNewOccurrenceAt,31000);
});
test('warning observations are process-specific and fingerprints cover the full unshortened line',()=>{
 const prefix='x'.repeat(600);let lines=[prefix+' ERROR a',prefix+' ERROR b'];const ps=[{pid:1,filename:'daemon.js'}];let s=collectControllerDiagnostics({getScriptLogs:()=>lines},ps,null,1000);assert.equal(s.warnings.length,2);assert.notEqual(s.warnings[0].key,s.warnings[1].key);
 s=collectControllerDiagnostics({getScriptLogs:()=>['WARNING: new']},[{pid:2,filename:'daemon.js'}],s,11000);assert.ok(s.warnings.some(w=>w.pid===2&&w.confirmedOccurrences===1));assert.deepEqual(Object.keys(s.fingerprints),['2']);
});
test('visible warnings remain observable past five minutes and expire after leaving the window',()=>{
 let lines=['WARN: persistent'];const ns={getScriptLogs:()=>lines},ps=[{pid:1,filename:'daemon.js'}];let s=null;
 for(let t=1000;t<=401000;t+=10000)s=collectControllerDiagnostics(ns,ps,s,t);assert.equal(s.warnings.length,1);assert.equal(s.warnings[0].confirmedOccurrences,1);
 lines=[];s=collectControllerDiagnostics(ns,ps,s,711001);assert.equal(s.warnings.length,0);
});

test('thrown native launch errors also preserve existing pause state',async()=>{
 const files=new Map([['remote-control/paused/daemon.js.txt','true']]);
 const r=await generated('start',['daemon.js'],{read:f=>files.get(f)||'',ps:()=>[],getScriptRam:()=>5,getServerMaxRam:()=>100,getServerUsedRam:()=>0,rm:f=>files.delete(f),write:async(f,s)=>files.set(f,s),run:()=>{throw Error('native launch exception');}});
 assert.equal(r.state,'failed');assert.match(r.error,/native launch exception/);assert.equal(files.get('remote-control/paused/daemon.js.txt'),'true');
});
test('empty or inconsistent native check results cannot be reported as passed',()=>{
 assert.equal(nativeScriptPreflight({getResetInfo:()=>reset},[]).ok,false);
 for(const scripts of [[],[{script:'daemon.js',status:'ready',ram:4}]]){
  const r=parseNativeQc(JSON.stringify({state:'completed',result:{check:'native-ram',ok:false,scripts}}));assert.equal(r.ok,false);assert.doesNotMatch(r.message,/passed/);
 }
});
