import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {homeRamWorkerKind,reclaimHomeRam} from '../home-ram-policy.js';
import {progressionSpeed} from '../progression-speed-policy.js';
import {automationReloadReady,maintenanceReloadJobs,supervisorUpdatePlan,handoffSupervisor} from '../runtime-policy.js';

test('scheduled HGW legs, legacy recovery and owner-bound workers are protected',()=>{
 for(const filename of ['Remote/hack-target.js','Remote/grow-target.js','Remote/weak-target.js','Remote/manualhack-target.js']){
  for(const args of [['n',1000,2000,''],['n',0,0,'Batch 4-weaken'],['n',0,0,'',false,false,false,7]])assert.equal(homeRamWorkerKind({filename,args}),'batch');
 }
 assert.equal(homeRamWorkerKind({filename:'Remote/weak-target.js',args:['n',0,0,'',false,false,7]}),'batch');
 assert.equal(homeRamWorkerKind({filename:'Remote/grow-target.js',args:['n']}),'batch');
 assert.equal(homeRamWorkerKind({filename:'Remote/weak-target.js'}),'batch');
 assert.equal(homeRamWorkerKind({filename:'Remote/hack-target.js',args:['n']}),'standalone-hack');
 assert.equal(homeRamWorkerKind({filename:'daemon.js'}),'protected');
});
function ramFixture(){
 let used=100;const killed=[],writes=[];
 const workers=[{pid:1,filename:'Remote/share.js',threads:1,args:[]},{pid:2,filename:'Temp/stanek.js.charge.js',threads:1,args:[]},
  {pid:3,filename:'Remote/hack-target.js',threads:1,args:['n',1000,2000,'Batch 1-hack']},
  {pid:4,filename:'Remote/weak-target.js',threads:1,args:['n',1000,2000,'Batch 1-weaken']},
  {pid:5,filename:'remote-api-agent.js',threads:1,args:[]}];
 const ns={pid:99,read:()=>'',write:(file,text)=>writes.push([file,JSON.parse(text)]),getServerMaxRam:()=>100,getServerUsedRam:()=>used,
  ps:()=>workers,getRunningScript:()=>({ramUsage:10}),getScriptRam:()=>999,kill:pid=>{killed.push(pid);used-=10;return true;}};
 return {ns,killed,writes};
}
test('RAM recovery reclaims share and charge first and defers rather than splitting a batch',()=>{
 const f=ramFixture();assert.equal(reclaimHomeRam(f.ns,30),false);assert.deepEqual(f.killed,[1,2]);
 const status=f.writes.at(-1)[1];assert.equal(status.reason,'Waiting for scheduled hacking work to finish');assert.equal(status.protectedCount,2);assert.equal(status.available,20);
 assert.deepEqual(status.canceled.map(p=>p.ram),[10,10]);
});
test('RAM pressure clears naturally after batch completion without killing its siblings',()=>{
 const f=ramFixture();f.ns.getServerUsedRam=()=>10;assert.equal(reclaimHomeRam(f.ns,80),true);assert.deepEqual(f.killed,[]);
});
test('RAM diagnostic writes are bounded and failed cancellation never claims success',()=>{
 const f=ramFixture();f.ns.kill=()=>false;f.ns.read=()=>JSON.stringify({at:Date.now()});
 assert.equal(reclaimHomeRam(f.ns,30),false);assert.deepEqual(f.writes,[]);
});

function speedSample(at,worth,reputation,previous,augReset=1){return progressionSpeed({snapshot:{at,worth,reputation,augReset,ready:[],targets:[]},previous,now:at,augReset,homeRam:128});}
test('frequent snapshots accumulate thirty seconds of cash and reputation evidence',()=>{
 let p;
 for(let seconds=0;seconds<=30;seconds+=5)p=speedSample(100000+seconds*1000,1000+seconds*10,{A:20+seconds*2},p).observation;
 assert.equal(p.cashRate,10);assert.equal(p.repRates.A,2);assert.equal(p.rateMeasuredAt,130000);assert.equal(p.rateBaseline.at,130000);
});
test('duplicate snapshots do not move the rate baseline or invent income',()=>{
 let p=speedSample(100000,1000,{A:20}).observation;
 for(let i=0;i<10;i++)p=speedSample(100000,1000,{A:20},p).observation;
 assert.equal(p.cashRate,0);assert.equal(p.rateBaseline.at,100000);
 p=speedSample(130000,1600,{A:50},p).observation;assert.equal(p.cashRate,20);assert.equal(p.repRates.A,1);
});
test('normal thirty-one-second cadence still learns each interval and handles net spending',()=>{
 const first=speedSample(100000,1000,{A:100}).observation;
 const next=speedSample(131000,1620,{A:162},first).observation;assert.equal(next.cashRate,20);assert.equal(next.repRates.A,2);
 const spend=speedSample(162000,100,{A:10},next).observation;assert.equal(spend.cashRate,0);assert.equal(spend.repRates.A,0);
});
test('ETA rates reset after long observation gaps, reset changes, or backward timestamps',()=>{
 const previous=speedSample(131000,1620,{A:162},speedSample(100000,1000,{A:100}).observation).observation;
 for(const [at,reset] of [[500000,1],[140000,2],[90000,1]]){
  const p=speedSample(at,2000,{A:200},previous,reset).observation;assert.equal(p.cashRate,0);assert.deepEqual(p.repRates,{});assert.equal(p.rateBaseline.at,at);
 }
});
test('legacy observations migrate into a baseline and new factions do not inherit fictional rates',()=>{
 const p=speedSample(131000,1620,{A:162,B:1000},{augReset:1,at:100000,worth:1000,reputation:{A:100}}).observation;
 assert.equal(p.cashRate,20);assert.equal(p.repRates.A,2);assert.equal(p.repRates.B,0);
});
test('invalid worth leaves prior valid observations intact',()=>{
 const prior=speedSample(100000,1000,{}).observation;
 for(const worth of [NaN,Infinity,-1])assert.equal(speedSample(131000,worth,{},prior).observation,prior);
});

const reset={lastNodeReset:1,lastAugReset:2};
function update(previous,now=1000,extra={}){return supervisorUpdatePlan({previous,now,reset,launchedSignature:'old',currentSignature:'new',...extra});}
test('supervisor updates require a stable signature for ten seconds',()=>{
 const first=update();assert.equal(first.state,'settling');
 assert.equal(update(first,10999).state,'settling');assert.equal(update(first,11000).state,'ready');
 assert.equal(update(first,11000,{currentSignature:'newer'}).state,'settling');
 assert.equal(update(first,11000,{currentSignature:'old'}).state,'current');
});
test('protected player work, incomplete restoration and pause defer supervisor handoff',()=>{
 const first=update();
 for(const extra of [{protectedWork:true},{pendingRestores:true}])assert.equal(update(first,11000,extra).state,'deferred');
 assert.equal(update(first,11000,{paused:true}).state,'paused');
});
test('supervisor retry limits persist across instances but expire or reset with game epochs',()=>{
 const previous={...update(),attempts:3,windowAt:1000};
 assert.equal(update(previous,11000).state,'retry-limit');
 assert.equal(update(previous,901001).state,'ready');
 assert.equal(update(previous,11000,{reset:{...reset,lastAugReset:3}}).state,'settling');
});
function handoffFixture(){
 const calls=[];let free=100;
 const ns={pid:7,args:['--custom',42],getScriptName:()=>'/reliability-manager.js',getRunningScript:()=>({ramUsage:20,threads:2}),getServerMaxRam:()=>100,getServerUsedRam:()=>100-free,getScriptRam:()=>30,
  write:(file,value)=>calls.push(['write',file,JSON.parse(value)]),spawn:(...args)=>calls.push(['spawn',...args])};
 return {ns,calls,setFree:value=>free=value};
}
test('native supervisor handoff preserves arguments and threads and records its attempt before spawning',()=>{
 const f=handoffFixture(),plan=update(update(),11000);assert.equal(handoffSupervisor(f.ns,plan,{reserve:10}),true);
 assert.equal(f.calls[0][0],'write');assert.equal(f.calls[0][2].attempts,1);assert.equal(f.calls[0][2].state,'handoff');
 assert.deepEqual(f.calls[1],['spawn','/reliability-manager.js',{threads:2,spawnDelay:0},'--custom',42]);
});
test('supervisor never exits on insufficient RAM, a late activity lock, or unavailable running process data',()=>{
 for(const reason of ['ram','blocked','missing','not-ready']){
  const f=handoffFixture();if(reason==='ram')f.setFree(0);if(reason==='missing')f.ns.getRunningScript=()=>null;
  const plan=reason==='not-ready'?update():update(update(),11000);
  assert.equal(handoffSupervisor(f.ns,plan,{reserve:10,blocked:reason==='blocked'}),false);assert.deepEqual(f.calls,[]);
 }
});
test('native handoff failures leave a bounded retry record and propagate to supervisor error handling',()=>{
 const f=handoffFixture();f.ns.spawn=()=>{throw new Error('native rejection');};
 assert.throws(()=>handoffSupervisor(f.ns,update(update(),11000)),/native rejection/);assert.equal(f.calls[0][2].attempts,1);
});
test('supervisor integrates heartbeat, guarded self-updates and bounded RAM diagnostics',()=>{
 const source=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');
 assert.ok(source.includes('registerAutomation(ns)'));assert.ok(source.includes('automationHeartbeat(ns)'));
 assert.ok(source.includes('if(handoffSupervisor('));assert.ok(source.includes('supervisorUpdate:selfUpdate'));assert.ok(source.includes('homeRamReclaim:'));
});

test('waiting reloads cannot hold global maintenance while RAM or protected work blocks activation',()=>{
 const ns={getRunningScript:()=>({ramUsage:10}),getServerMaxRam:()=>100,getServerUsedRam:()=>90,getScriptRam:name=>name==='large.js'?80:10};
 const jobs=[{pid:1,filename:'large.js',threads:1},{pid:2,filename:'small.js',threads:1},{pid:3,filename:'stats.js',threads:1}];
 assert.equal(automationReloadReady(ns,jobs[0],5),false);
 assert.deepEqual(maintenanceReloadJobs(ns,jobs,5).map(p=>p.filename),['small.js']);
 assert.deepEqual(maintenanceReloadJobs(ns,jobs,5,true),[]);
 assert.equal(automationReloadReady(ns,{...jobs[1],stopped:true},5),false);
 ns.getRunningScript=()=>null;assert.deepEqual(maintenanceReloadJobs(ns,jobs,5),[]);
});
test('malformed future candidate clocks cannot postpone supervisor updates indefinitely',()=>{
 const previous={...update(),candidateAt:1e15};assert.equal(update(previous,11000).candidateAt,11000);
});
