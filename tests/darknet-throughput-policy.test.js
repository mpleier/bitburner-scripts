import test from 'node:test';
import assert from 'node:assert/strict';
import {readDarknetReports,rotatedTargets,packSolverProgress,restoreSolverProgress,createAttemptBudget} from '../darknet-throughput-policy.js';
import {electMazeLeases} from '../darknet-development-policy.js';
test('historical observations never trigger process queries; credentials survive retention',async()=>{
 const now=100000000,rows={'tasks/dnet-survey-old.json':{version:1,host:'old',pid:1,at:1},'tasks/dnet-fresh.json':{version:3,host:'fresh',pid:2,at:now-100},'tasks/dnet-solver-old.json':{version:1,scope:[],state:{}},'tasks/dnet-maze-leases.json':{version:1,at:1}};
 const queried=[],removed=[];const ns={ls:()=>Object.keys(rows),read:f=>JSON.stringify(rows[f]),ps:h=>{queried.push(h);return [{pid:2,filename:'darknet-node.js'}];},rm:async f=>removed.push(f)};
 const snapshot=await readDarknetReports(ns,now);assert.deepEqual(queried,['fresh']);assert.deepEqual(removed,['tasks/dnet-survey-old.json']);assert.equal(snapshot.heartbeats.length,1);
});
test('checkpoint roundtrips solver types and rejects wrong puzzle and oversized input',()=>{
 const scope=[1,2,'target','DeepGreen',4,'numeric','hint'],state={feedback:{big:12345678901234567890n,seen:new Set(['1234']),map:new Map([['x',2]])},candidates:{cursor:8}};
 const raw=packSolverProgress(scope,state);assert.deepEqual(restoreSolverProgress(raw,scope),state);assert.equal(restoreSolverProgress(raw,[1,3,...scope.slice(2)]),null);assert.equal(packSolverProgress(scope,{huge:'x'.repeat(250001)}),null);assert.equal(restoreSolverProgress('{',scope),null);
});
test('physical attempt and wall time caps include retries; target order rotates fairly',()=>{
 let now=0;const take=createAttemptBudget(8,10000,()=>now);for(let i=0;i<8;i++)assert.equal(take(),true);assert.equal(take(),false);
 const deadline=createAttemptBudget(8,10000,()=>now);now=10000;assert.equal(deadline(),false);
 assert.deepEqual(rotatedTargets(['a','b','c'],1),['b','c','a']);assert.deepEqual(rotatedTargets([],1),[]);
});
test('non-maze solvers share one owner, retain progress owner, and transfer stale grants',()=>{
 const now=100000,reset={lastNodeReset:1,lastAugReset:2},scope=[1,2,'target','NIL',4,'numeric','hint'];
 const report=(host,pid,progressAt)=>({host,pid,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now,progressAt}]});
 const first=electMazeLeases(null,[report('a',10,0),report('b',20,0)],reset,1,now);assert.equal(first.leases.length,1);assert.equal(first.leases[0].host,'a');
 const later=now+100000,rows=[report('a',10,0),report('b',20,0)].map(r=>({...r,at:later,mazeRequests:r.mazeRequests.map(q=>({...q,at:later}))}));
 const next=electMazeLeases(first,rows,reset,1,later);assert.equal(next.leases[0].host,'b');
});
import {main as scout} from '../darknet-node.js';
test('executed dictionary scouts require the grant and count native timeout retries',async()=>{
 for(const granted of [false,true]){
  const now=Date.now(),scope=[1,2,'target','dictionary',1,'numeric',''],reset={lastNodeReset:1,lastAugReset:2};
  const lease=electMazeLeases(null,[{host:'origin',pid:granted?7:8,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now}]}],reset,1,now);
  const files=new Map([['tasks/dnet-maze-leases.json',JSON.stringify(lease)],['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]),attempts=[],messages=[],peeks=[],stop=Error('stop');
  const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>f==='tasks/dnet-maze-leases.json',scp:async()=>true,isRunning:()=>true,ps:()=>[],hasRootAccess:()=>true,getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{throw stop;},
   dnet:{probe:()=>['target'],getServerDetails:h=>h==='target'?{modelId:'dictionary',passwordLength:1,passwordFormat:'numeric',data:'',blockedRam:0,hasSession:false,requiredCharismaSkill:0}:{depth:0,difficulty:0},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0,getServerRequiredCharismaLevel:()=>0,heartbleed:async()=>{peeks.push(1);return {success:true,logs:[]};},
    authenticate:async(_h,p)=>{attempts.push(p);return {success:false,code:attempts.length%3?408:401};}}};
  await assert.rejects(scout(ns),e=>e===stop);assert.equal(attempts.length,granted?16:0);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
  assert.equal(peeks.length,granted?1:0);
  if(granted)assert.ok(files.has('tasks/dnet-solver-target.json'));
 }
});
import {prioritizeDarknetTargets,readDarknetDeployment,recordPhishingAttempt,darknetDeploymentFile} from '../darknet-throughput-policy.js';
test('ready neighbors deploy before locked targets, preserving rotation within each group',()=>{
 const info=h=>({hasSession:['b','d'].includes(h)});
 assert.deepEqual(prioritizeDarknetTargets(['a','b','c','d'],2,info),['d','b','c','a']);
 assert.deepEqual(prioritizeDarknetTargets(['a','b'],0,()=>{throw Error('gone');}),['a','b']);
});
test('home deployment manifest accepts fresh complete files and rejects stale or unsafe paths',()=>{
 const now=1000000,manifest={version:1,at:now,files:['darknet-node.js','darknet-new-dependency.js','darknet-candidates.txt','tasks/dnet-cache-context.json']};
 assert.deepEqual(readDarknetDeployment(JSON.stringify(manifest),now),manifest.files);
 for(const value of [{...manifest,at:now-120001},{...manifest,at:now+1},{...manifest,files:['darknet-node.js','../unsafe.js']},{...manifest,files:['darknet-node.js','tasks/credentials.json']},{...manifest,files:['darknet-other.js']}])assert.equal(readDarknetDeployment(JSON.stringify(value),now),null);
});
test('phishing counts native results, latency, and errors without inventing revenue; reset and worker changes restart counts',()=>{
 const ctx={host:'darkweb',pid:1,threads:3,reset:{lastNodeReset:1,lastAugReset:2},started:1000,at:2000};
 const a=recordPhishingAttempt(null,{success:true,code:200,message:'$1b'},ctx);
 const b=recordPhishingAttempt(a,{success:false,code:455},{...ctx,started:2000,at:3500});
 const c=recordPhishingAttempt(b,null,{...ctx,started:3500,at:4000});
 assert.equal(c.attempts,3);assert.equal(c.successes,1);assert.equal(c.durationMs,3000);assert.deepEqual(c.failures,{'455':1,exception:1});assert.equal(c.money,undefined);assert.equal(c.threads,3);
 assert.equal(recordPhishingAttempt(c,{success:true},{...ctx,pid:2,at:5000}).attempts,1);
 assert.equal(recordPhishingAttempt(c,{success:true},{...ctx,reset:{lastNodeReset:3,lastAugReset:4},at:5000}).attempts,1);
});
test('scouts leave peer revisions alone and fetch fresh bootstrap files directly from home',async()=>{
 for(const running of [false,true]){
  const now=Date.now(),files=new Map([[darknetDeploymentFile,JSON.stringify({version:1,at:now,files:['darknet-node.js','darknet-new-dependency.js']})],['tasks/dnet-target.json',JSON.stringify({version:3,pid:99,at:now,revision:'old'})]]),events=[],messages=[],stop=Error('stop');
  const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>files.has(f),scp:async(f,to,from)=>{events.push(['copy',f,to,from]);return true;},isRunning:()=>true,ps:h=>running&&h==='target'?[{filename:'darknet-node.js',pid:99}]:[],hasRootAccess:()=>true,getServerMaxRam:()=>16,getServerUsedRam:()=>0,getScriptRam:()=>8.45,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{throw stop;},kill:()=>assert.fail('peer must not restart a differing revision'),exec:(file,host)=>{events.push(['start',file,host]);return 100;},
   dnet:{probe:()=>['target'],getServerDetails:h=>({depth:0,difficulty:0,hasSession:h==='target',blockedRam:0}),getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0}};
  await assert.rejects(scout(ns),e=>e===stop);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
  const deployments=events.filter(e=>e[0]==='copy'&&Array.isArray(e[1]));assert.equal(deployments.length,running?0:1);
  if(!running){assert.deepEqual(deployments[0],[ 'copy',['darknet-node.js','darknet-new-dependency.js'],'target','home']);assert.ok(events.findIndex(e=>e[0]==='start')>events.findIndex(e=>e===deployments[0]));}
 }
});

