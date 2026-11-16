import test from 'node:test';
import assert from 'node:assert/strict';
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
