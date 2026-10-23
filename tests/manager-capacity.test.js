import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {managerCapacityPlan,postCasinoInfrastructure} from '../manager-capacity-policy.js';
import {backgroundJobDue,backgroundJobDispatched} from '../background-job-policy.js';
import {spendingPlan,adaptiveBudgetSignals,claimSpending} from '../spending-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
function fixture(){
 const files={},processes=[],costs={'autopilot.js':30,'optional.js':70,'Tasks/ram-manager.js':5,'Tasks/tor-manager.js':5,'Tasks/program-manager.js':5,'host-manager.js':8};let ram=128,used=0;
 const ns={pid:9,read:f=>files[f]||'',write:(f,s)=>files[f]=s,ps:()=>processes,getScriptRam:n=>costs[n]||0,getServerMaxRam:()=>ram,getServerUsedRam:()=>used,fileExists:n=>n in costs,getResetInfo:()=>reset,isRunning:p=>processes.some(r=>r.pid===p),getPlayer:()=>({money:1e9})};
 const request=(at=1000,extra={})=>files['tasks/post-casino-infrastructure.json']=JSON.stringify({version:1,at,nodeReset:1,augReset:2,state:'pending',index:0,...extra});
 let pid=10;const launches=[];const launch=(script,args)=>{launches.push({script,args});processes.push({filename:script,pid:++pid,threads:1});return pid;};
 return {ns,files,processes,costs,request,launch,launches,ram:v=>ram=v,used:v=>used=v};
}
test('capacity includes enabled optional managers, deduplicates running managers and uses phase peaks',()=>{
 const f=fixture();f.costs.phase1=10;f.costs.phase2=20;
 const p=managerCapacityPlan(f.ns,[{name:'autopilot.js',enabled:true},{name:'optional.js',enabled:true}], [{filename:'autopilot.js',threads:1}], [['phase1','phase2']]);
 assert.equal(p.controllerRam,100);assert.equal(p.workerReserve,36);assert.equal(p.target,256);assert.equal(p.complete,true);
});
test('disabled, paused, batch and transient scripts cannot inflate capacity; missing scripts remain explicit',()=>{
 const f=fixture();const ps=[{filename:'autopilot.js',threads:1},{filename:'Remote/hack-target.js',threads:1000},{filename:'Temp/job.js',threads:1000},{filename:'once.js',threads:1000,temporary:true}];
 const p=managerCapacityPlan(f.ns,[{name:'optional.js',enabled:false},{name:'other.js',enabled:true,paused:true}],ps);
 assert.equal(p.controllerRam,30);assert.equal(p.target,128);
 const missing=managerCapacityPlan(f.ns,[{name:'missing.js',enabled:true}],ps);assert.equal(missing.complete,false);assert.deepEqual(missing.unavailable,['missing.js']);
});
test('post-casino starts infrastructure in order, observes exits, and never duplicates a running task',()=>{
 const f=fixture();f.request();const call=t=>postCasinoInfrastructure(f.ns,reset,{4:1},f.launch,t);
 assert.equal(call(1000).active,true);call(1500);assert.equal(f.launches.length,1);
 for(let i=0;i<4;i++){f.processes.length=0;call(2000+i*1000);}
 assert.deepEqual(f.launches.map(l=>l.script),['Tasks/ram-manager.js','Tasks/tor-manager.js','Tasks/program-manager.js','host-manager.js']);
 assert.equal(JSON.parse(f.files['tasks/post-casino-infrastructure.json']).state,'complete');assert.equal(call(7000),null);
});
test('post-casino rejects stale, future, reset-mismatched and completed requests',()=>{
 for(const patch of [{at:2000},{nodeReset:3},{augReset:3},{state:'complete'},{state:'timed-out'}]){
  const f=fixture();f.request(1000,patch);assert.equal(postCasinoInfrastructure(f.ns,reset,{4:1},f.launch,1000),null);assert.equal(f.launches.length,0);
 }
 const f=fixture();f.request();assert.equal(postCasinoInfrastructure(f.ns,reset,{},f.launch,122000),null);
});
test('checkpoint honors Source Files and pauses, gives up on RAM pressure, and bounds failed launch retries',()=>{
 const f=fixture();f.request();postCasinoInfrastructure(f.ns,reset,{},f.launch,1000);assert.equal(f.launches[0].script,'host-manager.js');
 const g=fixture();g.request();g.used(128);assert.equal(postCasinoInfrastructure(g.ns,reset,{4:1},g.launch,1000).state,'waiting-for-ram');assert.equal(postCasinoInfrastructure(g.ns,reset,{4:1},g.launch,61000).active,false);
 const h=fixture();h.request();h.files['remote-control/paused/Tasks/ram-manager.js.txt']='true';postCasinoInfrastructure(h.ns,reset,{4:1},h.launch,1000);assert.equal(h.launches[0].script,'Tasks/tor-manager.js');
 const k=fixture();k.request();let attempts=0;for(let i=0;i<9;i++)postCasinoInfrastructure(k.ns,reset,{4:1},()=>{attempts++;return 0;},1000+i*1000);assert.equal(attempts,8);
});
test('full capacity gets a modest bounded budget and never overrides augmentation or corporation reserves',()=>{
 const args={money:200e9,reserve:10e9,homeRam:128,node:7,signals:{route:'bladeburner',fullHomeRam:{complete:true,target:256},corporationStartup:true}};
 const p=spendingPlan(args);assert.ok(p.allowances.home>=19e9);assert.ok(p.allowances.corporation>=150e9);assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=190e9+.001);
 const protectedPlan=spendingPlan({...args,signals:{...args.signals,augmentationCashTarget:{name:'Aug',cost:300e9}}});assert.ok(protectedPlan.allowances.home<=190e9*.02);
});
test('only fresh current-owner capacity records can influence cash budgets',()=>{
 const f=fixture(),now=Date.now();f.processes.push({pid:9,filename:'autopilot.js'});
 const record={at:now,ownerPid:9,nodeReset:1,augReset:2,complete:true,needsUpgrade:true,target:256};
 f.files['tasks/manager-capacity.json']=JSON.stringify(record);assert.equal(adaptiveBudgetSignals(f.ns).fullHomeRam.target,256);
 for(const patch of [{at:now+10000},{at:now-46000},{ownerPid:10},{nodeReset:3},{augReset:3},{complete:false},{needsUpgrade:false}]){
  f.files['tasks/manager-capacity.json']=JSON.stringify({...record,...patch});assert.equal(adaptiveBudgetSignals(f.ns).fullHomeRam,null);
 }
});
function scheduler(maximum=1024,lag=0){
 const s=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=s.indexOf('    async function runPeriodicScripts('),end=s.indexOf('    async function tryRunTool(',start),body=s.slice(start,end);let now=100000;
 const jobs=Array.from({length:12},(_,i)=>({name:'job'+i,interval:60000,lastRun:1,nextDue:1})),launched=[];
 const context={periodicScripts:jobs,lastSchedulingLagMs:lag,backgroundJobDue,backgroundJobDispatched,Date:{now:()=>now},getPlayerMoney:()=>0,infrastructureCashBand:()=>0,getTool:s=>s,dictSourceFiles:{},options:{},tryRunTool:async(ns,t)=>{launched.push(t.name);t.lastOutcome='launched';return true;}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.run=runPeriodicScripts;',context);
 const ns={getServerMaxRam:()=>maximum,getServerUsedRam:()=>0,read:()=>'',sleep:async()=>{}};
 return {run:()=>context.run(ns),jobs,launched,tick:()=>now++};
}
test('background dispatch is capped by home capacity and measured lag without starving deferred jobs',async()=>{
 for(const [ram,lag,limit]of [[32,0,1],[64,0,2],[128,0,3],[1024,0,6],[1024,300,1]]){
  const s=scheduler(ram,lag);await s.run();assert.equal(s.launched.length,limit);assert.equal(s.jobs[limit].lastRun,1);
  for(let i=0;i<12;i++){s.tick();await s.run();}assert.equal(new Set(s.launched).size,12);
 }
});
test('casino completion receipt precedes its completion hook and autopilot checks it before controller startup',()=>{
 const c=readFileSync(new URL('../casino.js',import.meta.url),'utf8');assert.ok(c.indexOf("tasks/post-casino-infrastructure.json")<c.indexOf('const outcome=launchCasinoHook'));
 const a=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');assert.ok(a.indexOf('const postCasino=')<a.indexOf('const existingDaemon ='));assert.match(a,/if\(postCasino\?\.active\)return/);
});
test('capacity counts multiple instances and excludes disabled optional demand',()=>{
 const f=fixture(),p=managerCapacityPlan(f.ns,[{name:'autopilot.js',enabled:true}], [{filename:'autopilot.js',threads:1},{filename:'autopilot.js',threads:2}]);
 assert.equal(p.controllerRam,90);
 const plan=spendingPlan({money:1e9,homeRam:128,node:7,signals:{route:'bladeburner',activeCategories:{home:false},fullHomeRam:{complete:true,target:256}}});assert.equal(plan.allowances.home,0);
});
test('native quote errors and thrown launch failures release the checkpoint without crashing',()=>{
 const f=fixture();f.request();f.ns.getScriptRam=()=>{throw Error('unavailable');};assert.equal(postCasinoInfrastructure(f.ns,reset,{4:1},f.launch,1000).state,'complete');
 const g=fixture();g.request();for(let i=0;i<8;i++)assert.doesNotThrow(()=>postCasinoInfrastructure(g.ns,reset,{4:1},()=>{throw Error('launch');},1000+i*1000));
 assert.equal(JSON.parse(g.files['tasks/post-casino-infrastructure.json']).state,'complete');
});
test('running background jobs do not use the cap and high RAM pressure admits only one new launch',async()=>{
 const s=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=s.indexOf('    async function runPeriodicScripts('),end=s.indexOf('    async function tryRunTool(',start),body=s.slice(start,end);
 const jobs=Array.from({length:7},(_,i)=>({name:'job'+i,interval:60000,lastRun:1,nextDue:1})),starts=[];
 const context={periodicScripts:jobs,backgroundJobDue,backgroundJobDispatched,Date:{now:()=>100000},getPlayerMoney:()=>0,infrastructureCashBand:()=>0,getTool:s=>s,dictSourceFiles:{},options:{},tryRunTool:async(ns,t)=>{t.lastOutcome=t.name==='job0'?'running':'launched';if(t.lastOutcome==='launched')starts.push(t.name);return true;}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.run=runPeriodicScripts;',context);
 await context.run({getServerMaxRam:()=>1024,getServerUsedRam:()=>1023,read:()=>'',sleep:async()=>{}});
 assert.deepEqual(starts,['job1']);assert.equal(jobs[2].lastRun,1);
});
test('cached capacity floor ends after a native home upgrade reaches its target',()=>{
 const f=fixture(),now=Date.now();f.processes.push({pid:9,filename:'autopilot.js'});
 f.files['tasks/spending-plan.json']=JSON.stringify({ownerPid:9,epoch:now,expiresAt:now+60000,reset:2,homeRam:128,signals:{route:'bladeburner',fullHomeRam:{complete:true,target:256}},allowances:{home:1e8}});
 assert.equal(claimSpending(f.ns,'home',3e7),true);f.ram(256);assert.equal(claimSpending(f.ns,'home',3e7),false);
});

test('capacity reports the minimum full-operation target even when home already exceeds it',()=>{const f=fixture();f.ram(2048);const p=managerCapacityPlan(f.ns,[{name:'autopilot.js',enabled:true}],[]);assert.equal(p.target,128);assert.equal(p.current,2048);assert.equal(p.needsUpgrade,false);});
