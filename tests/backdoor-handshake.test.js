import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discoverBackdoorNetwork,waitForBackdoorStart} from '../backdoor-policy.js';
import {main as worker} from '../Tasks/backdoor-all-servers.js.backdoor-one.js';

test('one batched scan visits each host once and retains shortest home-rooted routes',()=>{
 const calls=[],network={home:['a','b','a'],a:['home','c'],b:['home','c'],c:['a','b']};
 const result=discoverBackdoorNetwork({scan:h=>{calls.push(h);return network[h];}});
 assert.deepEqual(calls,['home','a','b','c']);assert.deepEqual(result.routes.c,['home','a','c']);
 assert.deepEqual(result.errors,[]);
});
test('a failed scan does not discard reachable routes or loop on cycles',()=>{
 const result=discoverBackdoorNetwork({scan:h=>{if(h==='broken')throw Error('offline');return h==='home'?['broken','good']:['home'];}});
 assert.deepEqual(result.servers,['home','broken','good']);assert.equal(result.errors[0].host,'broken');
});
test('serialized discovery is self-contained and does not require one worker per server',()=>{
 const execute=new Function('ns','return ('+discoverBackdoorNetwork.toString()+')(ns)');let scans=0;
 const result=execute({scan:h=>{scans++;const i=Number(h.slice(1));return h==='home'?['s0']:i<68?['s'+(i+1)]:[];}});
 assert.equal(result.servers.length,70);assert.equal(scans,70);
});
function handshake(){
 let clock=0,running=true,record='',ticks=0;const killed=[];
 const ns={read:()=>record,isRunning:()=>running,kill:pid=>{killed.push(pid);running=false;},sleep:async ms=>{clock+=ms;ticks++;}};
 const options={pid:9,target:'CSEC',token:'run:1',path:'/Temp/test.json',timeout:50,poll:10};
 return{ns,options,killed,now:()=>clock,set:r=>record=JSON.stringify(r),run:allowed=>waitForBackdoorStart(ns,options,allowed||(()=>true),()=>clock),get ticks(){return ticks;},exit:()=>running=false};
}
test('confirmation checks PID, token and target and waits for a delayed genuine start',async()=>{
 const h=handshake();h.set({pid:9,target:'other',token:'run:1',state:'started'});
 const sleep=h.ns.sleep;h.ns.sleep=async ms=>{await sleep(ms);if(h.ticks===2)h.set({pid:9,target:'CSEC',token:'run:1',state:'started'});};
 assert.equal((await h.run()).state,'started');assert.equal(h.ticks,2);assert.deepEqual(h.killed,[]);
});
test('unconfirmed workers are stopped on timeout, cancellation and startup failure',async()=>{
 for(const state of ['timeout','cancelled','failed']){
  const h=handshake();if(state==='failed')h.set({pid:9,target:'CSEC',token:'run:1',state:'failed'});
  assert.equal((await h.run(()=>state!=='cancelled')).state,state);assert.deepEqual(h.killed,[9]);
 }
 const h=handshake();h.exit();assert.equal((await h.run()).state,'exited');assert.deepEqual(h.killed,[]);
});
test('stale tokens and PIDs cannot release the connection',async()=>{
 for(const patch of [{pid:8},{token:'old'},{target:'other'}]){
  const h=handshake();h.set({pid:9,target:'CSEC',token:'run:1',state:'started',...patch});assert.equal((await h.run()).state,'timeout');
 }
});
function nativeWorker({actual='CSEC',paused=false,ownerAlive=true,unavailable=false}={}){
 const files={},calls=[],path='/Temp/backdoor-start-1-1.json';let current=actual;
 const ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),pid:9,args:['CSEC',path,'run:1',1],getScriptName:()=> 'Tasks/backdoor-all-servers.js.backdoor-one.js',
  read:f=>paused&&f.includes('paused/')?'true':files[f]||'',isRunning:()=>ownerAlive,write:async(f,s)=>{files[f]=s;current='home';},print(){},toast(){},
  singularity:{getCurrentServer:()=>{if(unavailable)throw Error('SF4 unavailable');return current;},installBackdoor:async()=>{calls.push(current);}}};
 return{ns,calls,files,path};
}
test('worker invokes native installation on its verified target before acknowledging startup',async()=>{
 const h=nativeWorker();await worker(h.ns);assert.deepEqual(h.calls,['CSEC']);assert.equal(JSON.parse(h.files[h.path]).state,'started');
});
test('worker fails gracefully before installation for wrong connections, pauses, owner loss and missing SF4',async()=>{
 for(const options of [{actual:'home'},{paused:true},{ownerAlive:false},{unavailable:true}]){
  const h=nativeWorker(options);await assert.doesNotReject(worker(h.ns));assert.deepEqual(h.calls,[]);
  const receipt=JSON.parse(h.files[h.path]);assert.equal(receipt.state,'failed');assert.equal(receipt.target,'CSEC');
 }
});
test('native asynchronous failure does not become an unhandled rejection during confirmation',async()=>{
 const h=nativeWorker();h.ns.singularity.installBackdoor=()=>Promise.reject(Error('native rejection'));
 await assert.doesNotReject(worker(h.ns));
});
test('manager awaits worker confirmation instead of trusting a fixed startup sleep',async()=>{
 const s=await readFile(new URL('../Tasks/backdoor-all-servers.js',import.meta.url),'utf8');
 assert.match(s,/await waitForBackdoorStart/);assert.doesNotMatch(s,/await ns.sleep\(spawnDelay\)/);
 assert.match(s,/discoverBackdoorNetwork.toString\(\)/);assert.doesNotMatch(s,/ns.scan\(ns.args\[0\]\)/);
 assert.match(s,/finally\{ns.rm\(receipt,'home'\);\}/);
});
