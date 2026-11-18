import test from 'node:test';
import assert from 'node:assert/strict';
import {threadedMove} from '../darknet-maze.js';
import {scheduleNavigator} from '../darknet-navigator-policy.js';

test('threadedMove falls back to the in-process API when no auth worker can be started',async()=>{
 const receipt={code:401,message:'You have moved to 1,1.',data:'###\n#@#\n###'};
 let execCalls=0,authArgs=null;
 const ns={pid:7,getScriptRam:()=>2,getServerMaxRam:()=>10,getServerUsedRam:()=>0,
  exec:()=>{execCalls++;return 0;},
  dnet:{authenticate:async(...args)=>{authArgs=args;return receipt;}}};
 assert.deepEqual(await threadedMove(ns,'lab','north','home',1),receipt);
 assert.equal(execCalls,1);
 assert.deepEqual(authArgs,['lab','north']);
});

test('threadedMove falls back when there is no RAM even for one auth worker thread',async()=>{
 const receipt={code:401,message:'You cannot go that way. You are still at 1,1.',data:'###\n#@#\n###'};
 let execCalls=0;
 const ns={pid:7,getScriptRam:()=>2,getServerMaxRam:()=>10,getServerUsedRam:()=>10,
  exec:()=>{execCalls++;return 4;},
  dnet:{authenticate:async()=>receipt}};
 assert.deepEqual(await threadedMove(ns,'lab','east','home',2),receipt);
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
