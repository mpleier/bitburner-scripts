import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleNavigator} from '../darknet-navigator-policy.js';
test('navigator requests enough loot RAM for the useful quoted thread count even when one thread already fits',async()=>{
 let loot=true,request=null,started=null,args=null;const files=new Map();
 const ns={pid:1,getHostname:()=> 'source',ps:()=>loot?[{filename:'darknet-loot.js',pid:2,threads:4}]:[],fileExists:()=>true,getScriptRam:f=>f==='darknet-maze.js'?5:10,getServerMaxRam:()=>50,getServerUsedRam:()=>loot?45:5,
 formulas:{dnet:{getAuthenticateTime:(_d,n)=>100000/n}},dnet:{getServerDetails:()=>({})},getPlayer:()=>({}),read:f=>files.get(f)||'',write:async(f,v)=>{files.set(f,v);request=JSON.parse(v);},rm:async f=>files.delete(f),exec:(_f,_h,n,...rest)=>{started=n;args=rest;return 3;}};
 assert.equal(await scheduleNavigator(ns,'lab',[1,2,'lab']),0);assert.equal(started,null);assert.equal(request.pid,2);
 loot=false;assert.equal(await scheduleNavigator(ns,'lab',[1,2,'lab'],7),3);assert.equal(started,9);assert.equal(args.at(-1),7);assert.equal(files.size,0);
});
