import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ensureRemoteWorker} from '../bootstrap-start.js';

// The Remote API agent is the only channel the automation is observed through, and autopilot is its only other
// launcher — so a reset that takes both down left the bridge reporting connected:true / workerOnline:false with
// nothing ever restoring it. Bootstrap now guarantees the worker, ahead of any protected-activity guard.
function fixture({processes=[],paused=false,maxRam=1024,usedRam=16,agentRam=15.5,runResult=412}={}){
 const files=new Map();
 if(paused)files.set('remote-control/paused/remote-api-agent.js.txt','true');
 const run=[];
 const ns={pid:7,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),
  ps:()=>processes,kill:()=>true,getServerMaxRam:()=>maxRam,getServerUsedRam:()=>usedRam,
  getScriptRam:f=>f==='remote-api-agent.js'?agentRam:0,run:(...args)=>{run.push(args);return runResult;}};
 const result={controllers:[]};
 return {ns,result,run,files};
}

test('a running Remote API worker is reported, not launched twice',()=>{
 const f=fixture({processes:[{filename:'remote-api-agent.js',pid:99}]});
 ensureRemoteWorker(f.ns,f.ns.ps('home'),f.result);
 assert.deepEqual(f.result.agent,{script:'remote-api-agent.js',pid:99,state:'running'});
 assert.deepEqual(f.run,[]);
});

test('a paused Remote API worker is respected',()=>{
 const f=fixture({paused:true});
 ensureRemoteWorker(f.ns,f.ns.ps('home'),f.result);
 assert.equal(f.result.agent.state,'paused');assert.deepEqual(f.run,[]);
});

test('the worker is launched with its protocol version when nothing else started it',()=>{
 const f=fixture();
 ensureRemoteWorker(f.ns,f.ns.ps('home'),f.result);
 assert.deepEqual(f.run,[['remote-api-agent.js',1,'--protocol-version',2]]);
 assert.deepEqual(f.result.agent,{script:'remote-api-agent.js',pid:412,state:'starting'});
});

test('a launch the game refuses is reported as retrying rather than as started',()=>{
 const f=fixture({runResult:0});
 ensureRemoteWorker(f.ns,f.ns.ps('home'),f.result);
 assert.equal(f.result.agent.state,'retrying');
});

test('a host without room reports the shortfall instead of failing silently',()=>{
 const f=fixture({maxRam:16,usedRam:15});
 ensureRemoteWorker(f.ns,f.ns.ps('home'),f.result);
 assert.deepEqual(f.result.agent,{script:'remote-api-agent.js',state:'waiting-for-ram',required:15.5,free:1});
 assert.deepEqual(f.run,[]);
});

test('a running casino still gets a supervisor, but ascend stays a hard stop', async () => {
  // Live: three minutes after an install the fleet had bootstrap, autopilot and casino — and no supervisor, with 14
  // managers would-start on 1723 GB free and the dashboard 394 s stale.
  const {ensureSupervisor} = await import('../bootstrap-start.js');
  const calls=[];const ns={pid:5,read:()=>'',isRunning:()=>true,ps:()=>[],getServerMaxRam:()=>2048,getServerUsedRam:()=>124,
   getScriptRam:f=>f==='reliability-manager.js'?23.95:0,run:(...a)=>{calls.push(a);return 77;},kill:()=>true,rsync:()=>true};
  const result={controllers:[]};
  ensureSupervisor(ns,[],result);
  assert.deepEqual(result.supervisor,{script:'reliability-manager.js',pid:77,state:'starting'});
  assert.deepEqual(calls[0],['reliability-manager.js',1]);
  // Already running, paused, unreadable and RAM-bound are all reported rather than launched twice.
  ensureSupervisor(ns,[{filename:'/reliability-manager.js',pid:4}],result);
  assert.equal(result.supervisor.state,'running');
  const paused={...ns,read:f=>f==='remote-control/paused/reliability-manager.js.txt'?'true':''};
  ensureSupervisor(paused,[],result);assert.equal(result.supervisor.state,'paused');
  const tight={...ns,getServerUsedRam:()=>2030};ensureSupervisor(tight,[],result);
  assert.equal(result.supervisor.state,'waiting-for-ram');
  // The guard ordering is what makes this safe: the supervisor call sits before the protected-activity return, and
  // only casino (not ascend) can reach it.
  const source = readFileSync(new URL('../bootstrap-start.js', import.meta.url), 'utf8');
  const at = source.indexOf('if(casino&&!ascend)ensureSupervisor');
  assert.ok(at > 0 && at < source.indexOf("return {...result,state:'protected-activity'}"), 'the supervisor starts before the guard returns');
});
