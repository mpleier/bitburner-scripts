import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {hackThreadsForFraction,canFitHackingJob,launchHackingBatch} from '../hacking-policy.js';
import {main as manualHack} from '../Remote/manualhack-target.js';
import {main as hack} from '../Remote/hack-target.js';

test('zero or invalid hacking production cannot create infinite thread requests',()=>{
 for(const value of [0,NaN,Infinity,-1])assert.equal(hackThreadsForFraction(.1,value),0);
 assert.equal(hackThreadsForFraction(.1,.01),10);assert.equal(hackThreadsForFraction(2,.1),10);
});

test('unsplittable jobs require one host while explicitly split jobs can use several',()=>{
 assert.equal(canFitHackingJob([8,4],10,false),false);assert.equal(canFitHackingJob([8,4],10,true),true);
 assert.equal(canFitHackingJob([NaN,Infinity],1,true),false);assert.equal(canFitHackingJob([8],.5,false),false);
});

test('failed or throwing batches roll back only their recorded worker PIDs',async()=>{
 const killed=[];assert.equal(await launchHackingBatch([{threadsNeeded:1},{threadsNeeded:1}],async(item,pids)=>{if(pids.length)return false;pids.push(11);return true;},pids=>killed.push(...pids)),false);assert.deepEqual(killed,[11]);
 await assert.rejects(()=>launchHackingBatch([{threadsNeeded:1}],async(item,pids)=>{pids.push(12);throw Error('exec failed');},pids=>killed.push(...pids)),/exec failed/);assert.deepEqual(killed,[11,12]);
 let calls=0;assert.equal(await launchHackingBatch([{threadsNeeded:0}],()=>{calls++;},()=>{}),true);assert.equal(calls,0);
});

async function executor({ram=[16,8],names=['alpha','beta'],split=false,copy=true,threads=10}={}) {
 const source=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    async function arbitraryExecution('),end=source.indexOf('\n    }',start)+6,launched=[],runs=[];
 const servers=ram.map((n,i)=>({name:names[i],_files:{},hasRoot:()=>true,totalRam:()=>n,ramAvailable:()=>n}));
 const ns={getScriptName:()=> 'daemon.js',read:f=>f.includes('paused')||f.includes('maintenance')||f.includes('achievement')?'':'source'};
 const context={reclaimHomeRam:()=>true,homeRamReserve:()=>0,canFitHackingJob,isScriptPaused:()=>false,maintenanceRequested:()=>false,getAllServersByFreeRam:()=>servers,getAllServersByMaxRam:()=>servers.slice(),verbose:false,daemonHost:'home',getFilePath:s=>s,doesFileExist:async()=>true,getNsDataThroughFile:async()=>copy,hashCode:()=>1,exec:async(ns,name,host,options)=>{runs.push({host,threads:options.threads});return runs.length;},log:()=>{},formatRam:String,homeServer:{ramAvailable:()=>100},options:{}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.execute=arbitraryExecution;',context);
 const tool={name:'Remote/hack-target.js',shortName:'hack',cost:2,ignoreReservedRam:false,isThreadSpreadingAllowed:split,existsOnHost:async()=>false,deployedHashes:new Map(),runOptions:{}};
 const result=await context.execute(ns,tool,threads,[],null,false,null,launched);return {result,runs,launched,tool};
}

test('real executor refuses partial unsplittable launches and failed script copies',async()=>{
 assert.deepEqual((await executor()).runs,[]);
 for(const threads of [NaN,Infinity,.5,-1])assert.deepEqual((await executor({split:true,threads})).runs,[]);
 const failed=await executor({copy:false,threads:2});assert.equal(failed.result,false);assert.deepEqual(failed.runs,[]);assert.equal(failed.tool.deployedHashes.size,0);
 const split=await executor({split:true});assert.equal(split.result,true);assert.equal(split.runs.length,2);assert.equal(split.launched.length,2);
});

test('real executor places fitting hacks on ordinary hosts before Hacknet',async()=>{
 const result=await executor({ram:[64,32,16],names:['hacknet-server-0','home','alpha'],threads:2});assert.equal(result.result,true);assert.equal(result.runs[0].host,'alpha');
});

test('manual worker accepts normal daemon arguments and avoids hacking a changed terminal target',async()=>{
 let calls=0;const ns={args:['alpha',Date.now(),1000,'Batch 0-hack',false,true,false,0],getServer:()=>({isConnectedTo:true}),singularity:{manualHack:async()=>{calls++;return 1;}},print:()=>{},sleep:async()=>{},toast:()=>{throw Error('Unexpected toast');}};
 await manualHack(ns);assert.equal(calls,1);await manualHack({...ns,getServer:()=>({isConnectedTo:false})});assert.equal(calls,1);
});

test('looping worker maintains its planned period after duration changes and stops with its parent',async()=>{
 let now=1000,calls=0,options=[];
 const original=Date.now;Date.now=()=>now;
 try{await hack({args:['alpha',1100,100,'xp',false,true,true,9],isRunning:()=>calls<2,getHackTime:()=>calls?50:100,hack:async(target,o)=>{options.push(o.additionalMsec);calls++;now+=400;return 1;},toast:()=>{},print:()=>{}});}
 finally{Date.now=original;}
 assert.deepEqual(options,[400,350]);assert.equal(calls,2);
});


test('daemon assigns startup options before reading the manual-hacking flag',async()=>{
 const source=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 const assignment=source.indexOf('options = runOptions;'),guard=source.indexOf('if(options.i&&!(4 in dictSourceFiles))');
 assert.ok(assignment>=0&&guard>assignment);
 const line=source.slice(guard,source.indexOf('\n',guard));
 const options={i:true};new Function('options','dictSourceFiles','ns','log',line)(options,{}, {},()=>{});assert.equal(options.i,false);
});
