import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseRamRecoveryThreads,scheduleRamRecovery,ramRecoveryFile,ramRecoveryModel} from '../darknet-ram-policy.js';
import {main as ramMain} from '../darknet-ram.js';
import {main as scout} from '../darknet-node.js';
import {electMazeLeases,mazeLeaseIdentity} from '../darknet-development-policy.js';
import {readDarknetReports} from '../darknet-throughput-policy.js';
import {stormBlockerDetails,observeStormBlocker} from '../darknet-storm-policy.js';
test('thread choice uses exact expected recovery when available and always respects RAM and worker caps',()=>{
 assert.equal(chooseRamRecoveryThreads(1.2,7,n=>n*0.5),3);
 assert.equal(chooseRamRecoveryThreads(100,99,n=>n*0.5),8);
 assert.equal(chooseRamRecoveryThreads(1,2.9,()=>{throw Error('no formulas');}),2);
 assert.equal(chooseRamRecoveryThreads(0,8,()=>1),0);assert.equal(chooseRamRecoveryThreads(1,0.9,()=>1),0);
});
test('scheduler starts one bounded background worker without awaiting native recovery',async()=>{
 const calls=[],ns={pid:7,getHostname:()=> 'origin',fileExists:()=>true,ps:()=>[],getScriptRam:()=>3,getServerMaxRam:()=>32,getServerUsedRam:()=>15,read:()=>'',getPlayer:()=>({}),formulas:{dnet:{getExpectedRamBlockRemoved:(_d,n)=>n*0.5}},exec:(...args)=>{calls.push(args);return 99;}};
 assert.equal(await scheduleRamRecovery(ns,'target',{blockedRam:1.2,hasSession:true},[1,2,'target'], 'grant'),99);
 assert.equal(calls[0][2],3);assert.equal(calls[0][0],ramRecoveryFile);
 ns.ps=()=>[{filename:ramRecoveryFile}];assert.equal(await scheduleRamRecovery(ns,'other',{blockedRam:2,hasSession:true},[], 'grant'),0);assert.equal(calls.length,1);
});
function workerFixture(root=true){
 const now=Date.now(),scope=[1,2,'target',ramRecoveryModel,'model'],owner=root?'home':'origin',messages=[];
 const f=electMazeLeases(null,[{host:owner,pid:7,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now}]}],{lastNodeReset:1,lastAugReset:2},3,now);
 let native=0;
 const ns={pid:99,args:['target',7,JSON.stringify(scope),root?'root':mazeLeaseIdentity(f.leases[0])],disableLog(){},getHostname:()=>owner,read:file=>file==='tasks/dnet-cache-context.json'?JSON.stringify({nodeReset:1,augReset:2}):JSON.stringify(f),ps:()=>[{filename:root?'darknet-manager.js':'darknet-node.js',pid:7}],fileExists:()=>true,scp:async()=>true,isRunning:()=>true,print:s=>messages.push(s),dnet:{probe:()=>['target'],getServerDetails:()=>({hasSession:true,blockedRam:native?2:10,modelId:'model'}),memoryReallocation:async()=>{native++;return {success:true};}}};
 return {ns,f,native:()=>native,messages};
}
test('native RAM worker performs one action for its parent grant and reports observed RAM',async()=>{
 for(const root of [false,true]){const f=workerFixture(root);await ramMain(f.ns);assert.equal(f.native(),1);assert.match(f.messages[0],/10 -> 2 GB/);}
});
test('RAM worker declines stale grants, dead parents, disconnected or unauthenticated targets and changed resets',async()=>{
 const patches=[f=>{f.ns.args[3]='wrong';},f=>{f.f.leases[0].expiresAt=1;},f=>{f.ns.ps=()=>[];},f=>{f.ns.dnet.probe=()=>[];},f=>{f.ns.dnet.getServerDetails=()=>({hasSession:false,blockedRam:10,modelId:'model'});},f=>{f.ns.args[2]=JSON.stringify([9,10,'target',ramRecoveryModel,'model']);}];
 for(const patch of patches){const f=workerFixture(false);patch(f);await ramMain(f.ns);assert.equal(f.native(),0);}
});
test('only native-verified in-flight recovery keeps an old owner beyond its progress timeout',async()=>{
 const now=300000,scope=[1,2,'target',ramRecoveryModel,'model'],report={version:1,host:'origin',pid:7,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now,active:true}]};
 let active=false;const ns={ls:()=>['tasks/dnet-survey-origin.json'],read:()=>JSON.stringify(report),ps:()=>[{filename:'darknet-node.js',pid:7},...(active?[{filename:ramRecoveryFile,args:['target',7,JSON.stringify(scope)]}]:[])]};
 let snapshot=await readDarknetReports(ns,now);assert.equal(snapshot.surveys[0].mazeRequests[0].active,false);
 active=true;snapshot=await readDarknetReports(ns,now);assert.equal(snapshot.surveys[0].mazeRequests[0].active,true);
 const reset={lastNodeReset:1,lastAugReset:2},prior={nodeReset:1,augReset:2,at:now-30000,leases:[{host:'origin',pid:7,maze:'target',scope,startedAt:now-150000}]};
 const other={...report,host:'other',pid:8,mazeRequests:[{maze:'target',scope,at:now}]};
 const kept=electMazeLeases(prior,[...snapshot.surveys,other],reset,3,now);assert.equal(kept.leases[0].host,'origin');
 active=false;snapshot=await readDarknetReports(ns,now);const transferred=electMazeLeases(prior,[...snapshot.surveys,other],reset,3,now);assert.equal(transferred.leases[0].host,'other');
});
test('blocked RAM and reward counts can change without resetting their category durations',()=>{
 const now=100000,report={host:'target',at:now,version:1,live:true,busy:false,blockedRam:1.57,caches:0,contracts:2,neighbours:[]};
 let state=observeStormBlocker(null,stormBlockerDetails('target',report,now),now);
 state=observeStormBlocker(state,stormBlockerDetails('target',{...report,at:now+30000,blockedRam:0.28,contracts:1},now+30000),now+30000);
 assert.equal(state.since,now);assert.equal(state.categorySince['blocked RAM'],now);assert.equal(state.categorySince.contracts,now);assert.ok(state.reasons.includes('blocked RAM 0.28 GB'));
 state=observeStormBlocker(state,stormBlockerDetails('target',{...report,at:now+60000,blockedRam:0,contracts:1,caches:1},now+60000),now+60000);
 assert.equal(state.categorySince.contracts,now);assert.equal(state.categorySince.caches,now+60000);assert.equal(state.categorySince['blocked RAM'],undefined);
});
test('rejected saved credentials enter coordinated cracking; timeout credentials do not start a fallback search',async()=>{
 for(const mode of ['granted','waiting','timeout']){
  const now=Date.now(),scope=[1,2,'target','dictionary',3,'alphabetic',''],lease=electMazeLeases(null,[{host:'origin',pid:mode==='granted'?7:8,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now}]}],{lastNodeReset:1,lastAugReset:2},3,now);
  const files=new Map([['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})],['tasks/dnet-maze-leases.json',JSON.stringify(lease)],['darknet-passwords.txt','target=bad'],['darknet-candidates.txt','new']]),attempts=[],messages=[],stop=Error('stop');let passes=0;
  const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),rm:async f=>files.delete(f),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>files.has(f),scp:async()=>true,isRunning:()=>true,ps:()=>[],hasRootAccess:()=>true,getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{if(++passes>=2)throw stop;},
   dnet:{probe:()=>['target'],getServerDetails:h=>h==='target'?{modelId:'dictionary',passwordLength:3,passwordFormat:'alphabetic',data:'',blockedRam:0,hasSession:false,requiredCharismaSkill:0,isStationary:true}:{depth:0,difficulty:0},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0,getServerRequiredCharismaLevel:()=>Infinity,authenticate:async(_h,p)=>{attempts.push(p);return mode==='timeout'?{success:false,code:408}:p==='new'?{success:true,code:200}:{success:false,code:401};}}};
  await assert.rejects(scout(ns),e=>e===stop);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
  if(mode==='granted'){assert.equal(attempts[0],'bad');assert.ok(attempts.includes('new'));}
  else if(mode==='waiting')assert.deepEqual(attempts,['bad']);
  else{assert.equal(attempts.length,6);assert.ok(attempts.every(p=>p==='bad'));const survey=JSON.parse(files.get('tasks/dnet-survey-origin.json'));assert.equal(survey.mazeRequests.length,0);}
 }
});
