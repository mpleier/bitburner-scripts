import test from 'node:test';
import assert from 'node:assert/strict';
import {threadedMove} from '../darknet-maze.js';
import {scheduleNavigator} from '../darknet-navigator-policy.js';

// Maze position lives in DarknetState.labLocations[pid]. A fresh auth worker starts at a new
// random entrance, so every move must be made by the navigator's own PID.
test('threadedMove authenticates in-process and never spawns a fresh maze worker',async()=>{
 const receipt={code:401,message:'You have moved to 1,1.',data:'###\n#@#\n###'};
 let execCalls=0,authArgs=null;
 const ns={pid:7,getScriptRam:()=>2,getServerMaxRam:()=>10,getServerUsedRam:()=>0,
  exec:()=>{execCalls++;return 0;},
  dnet:{authenticate:async(...args)=>{authArgs=args;return receipt;}}};
 assert.deepEqual(await threadedMove(ns,'lab','north','home',1),receipt);
 assert.equal(execCalls,0);
 assert.deepEqual(authArgs,['lab','north']);
});

test('threadedMove reports a failed authenticate as null instead of throwing',async()=>{
 let execCalls=0;
 const ns={pid:7,exec:()=>{execCalls++;return 4;},
  dnet:{authenticate:async()=>{throw new Error('lost access');}}};
 assert.equal(await threadedMove(ns,'lab','east','home',2),null);
 assert.equal(execCalls,0);
});

test('scheduler reserves one auth worker thread instead of spending all RAM on the navigator',async()=>{
 let loot=true,started=null;const files=new Map();
 const ns={pid:1,getHostname:()=> 'source',ps:()=>loot?[{filename:'darknet-loot.js',pid:2,threads:8}]:[],fileExists:()=>true,
  getScriptRam:f=>f==='darknet-maze.js'||f==='darknet-auth.js'?5:10,getServerMaxRam:()=>50,getServerUsedRam:()=>loot?45:5,
  formulas:{dnet:{getAuthenticateTime:(_d,n)=>100000/n}},dnet:{getServerDetails:()=>({})},getPlayer:()=>({}),
  read:f=>files.get(f)||'',write:async(f,v)=>{files.set(f,v);},rm:async f=>files.delete(f),
  exec:(_f,_h,n)=>{started=n;return 3;}};
 // 45 GB free including reclaimable loot; 5 GB must stay for darknet-auth.js, leaving 8 navigator threads.
 assert.equal(await scheduleNavigator(ns,'lab',[1,2,'lab']),0);
 loot=false;
 assert.equal(await scheduleNavigator(ns,'lab',[1,2,'lab'],7),3);
 assert.equal(started,8);
});
