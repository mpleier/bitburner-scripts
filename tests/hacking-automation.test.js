import {reserveHackingProcess,releaseHackingProcess} from '../hacking-process-policy.js';
import {commitHackingCapacity,hackingWorker,withHackingLoopCapacity} from '../hacking-drain-policy.js';
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

async function executor({ram=[16,8],names=['alpha','beta'],split=false,copy=true,threads=10,args=[],captureCapacity=false,failLedger=false,ramAfterWrite=null,processLimit=100,failExecution=false}={}) {
 const source=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    async function arbitraryExecution('),end=source.indexOf('\n    }',start)+6,launched=[],runs=[];
 const servers=ram.map((n,i)=>({name:names[i],_files:{},hasRoot:()=>true,totalRam:()=>n,ramAvailable:()=>writes&&ramAfterWrite!==null?ramAfterWrite[i]:n}));
 const ledger=new Map();let writes=0;
 const ns={write:async(f,text)=>{writes++;if(failLedger)throw Error('write failed');ledger.set(f,text);},pid:7,getScriptName:()=> 'daemon.js',read:f=>ledger.get(f)||(f.includes('paused')||f.includes('maintenance')||f.includes('achievement')?'':'source')};
 const context={reserveHackingProcess,releaseHackingProcess,hackingProcessBudget:{ready:true,inventoryAt:Date.now(),used:0,limit:processLimit},commitHackingCapacity,resetInfo:{lastNodeReset:1,lastAugReset:2},hackingWorker,loopJobSequence:0,withHackingLoopCapacity,hackingDrain:null,reclaimHomeRam:()=>true,homeRamReserve:()=>0,canFitHackingJob,isScriptPaused:()=>false,maintenanceRequested:()=>false,getAllServersByFreeRam:()=>servers,getAllServersByMaxRam:()=>servers.slice(),verbose:false,daemonHost:'home',getFilePath:s=>s,doesFileExist:async()=>true,getNsDataThroughFile:async()=>copy,hashCode:()=>1,exec:async(ns,name,host,options,...args)=>{if(failExecution)return 0;if(options.threads*2>servers.find(s=>s.name===host).ramAvailable())return 0;runs.push({host,threads:options.threads,args,capacityRecorded:ledger.has("tasks/hgw-capacity-7.json")});return runs.length;},log:()=>{},formatRam:String,homeServer:{ramAvailable:()=>100},options:{}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.execute=arbitraryExecution;',context);
 const tool={name:'Remote/hack-target.js',shortName:'hack',cost:2,ignoreReservedRam:false,isThreadSpreadingAllowed:split,existsOnHost:async()=>false,deployedHashes:new Map(),runOptions:{}};
 const capacityJobs=captureCapacity?[]:null;const result=await context.execute(ns,tool,threads,args,null,false,null,launched,capacityJobs);return {result,runs,launched,tool,capacityJobs,ledger,writes,budget:context.hackingProcessBudget};
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

test('real split executor gives all fragments the full expected loop capacity and one job id',async()=>{
 const args=['n',1000,100,'job',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 const result=await executor({split:true,threads:10,args});assert.equal(result.result,true);
 const metadata=result.runs.map(r=>JSON.parse(r.args[8]));assert.ok(metadata.every(m=>m.expectedThreads===10));
 assert.equal(new Set(metadata.map(m=>m.jobId)).size,1);assert.equal(result.runs.reduce((sum,r)=>sum+r.threads,0),10);
 assert.equal(JSON.parse(args[8]).capacityVersion,undefined);
});

test('real executor records capacity only for fully allocated looping jobs',async()=>{
 const args=['n',1000,100,'job',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 const result=await executor({split:true,threads:10,args,captureCapacity:true});assert.equal(result.capacityJobs.length,1);
 assert.equal(result.capacityJobs[0].expectedThreads,10);assert.equal(result.capacityJobs[0].tool,'hack');assert.equal(result.capacityJobs[0].target,'n');
 const failed=await executor({split:true,threads:20,args,captureCapacity:true});assert.equal(failed.result,false);assert.equal(failed.capacityJobs.length,0);
 const finite=await executor({split:true,captureCapacity:true});assert.equal(finite.capacityJobs.length,0);
});

test('XP executor writes expected capacity before first inventory even after a partial allocation',async()=>{
 const args=['n',1000,100,'FarmXP',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 for(const threads of [10,20]){
  const result=await executor({split:true,threads,args});assert.equal(result.writes,1);assert.ok(result.runs.every(run=>run.capacityRecorded));
  const jobs=JSON.parse(result.ledger.get('tasks/hgw-capacity-7.json')).jobs;assert.equal(Object.values(jobs)[0].expectedThreads,threads);
  assert.equal(result.result,threads===10);
 }
});
test('failed XP ledger writes prevent workers starting; finite and batch jobs skip write-ahead',async()=>{
 const args=['n',1000,100,'FarmXP',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 const failed=await executor({split:true,args,failLedger:true});assert.equal(failed.result,false);assert.equal(failed.runs.length,0);
 const batch=await executor({split:true,args,captureCapacity:true});assert.equal(batch.writes,0);assert.equal(batch.capacityJobs.length,1);
 const finite=await executor({split:true});assert.equal(finite.writes,0);
});

test('XP executor refreshes RAM after manifest I/O and preserves unsplittable job requirements',async()=>{
 const args=['n',1000,100,'FarmXP',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 const unsplit=await executor({ram:[16],names:['home'],threads:4,args,ramAfterWrite:[2]});assert.equal(unsplit.result,false);assert.equal(unsplit.runs.length,0);
 const split=await executor({ram:[16],names:['home'],split:true,threads:4,args,ramAfterWrite:[2]});assert.equal(split.result,false);assert.equal(split.runs.length,1);assert.equal(split.runs[0].threads,1);
 assert.equal(Object.values(JSON.parse(split.ledger.get('tasks/hgw-capacity-7.json')).jobs)[0].expectedThreads,4);
 const none=await executor({ram:[16],names:['home'],split:true,threads:4,args,ramAfterWrite:[0]});assert.equal(none.runs.length,0);
});


test('real executor enforces process slots for split jobs and releases failed launch reservations',async()=>{
 const capped=await executor({split:true,processLimit:1});assert.equal(capped.result,false);assert.equal(capped.runs.length,1);assert.equal(capped.budget.used,1);
 const full=await executor({threads:2,processLimit:0});assert.equal(full.result,false);assert.equal(full.runs.length,0);
 const failed=await executor({threads:2,failExecution:true});assert.equal(failed.result,false);assert.equal(failed.budget.used,0);
});
