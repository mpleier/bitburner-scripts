import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dispatchContractDelivery,reconcileContractDelivery,refreshContractDelivery,validContractReceipt,contractReceiptPath,contractWorkerFiles} from '../contract-delivery-policy.js';
import {main as solver,codingContractTypesMetadata as metadata} from '../Tasks/contractor.js.solver.js';
import {contractKey,solverVersion} from '../contract-policy.js';
import {publishCloudPurchase,currentCloudPurchase} from '../cloud-status-policy.js';
const entry='Tasks/contractor.js.solver.js',version=solverVersion(metadata);
const contract=name=>({hostname:'n00dles',contract:name+'.cct',type:'Find Largest Prime Factor',dataJson:'9'});
function fixture(){
 const stores={home:new Map(),remote:new Map()},running=new Map(),copies=[],launches=[],attempts=[],logs=[],writes=[];
 const reset={lastNodeReset:1,lastAugReset:2};let serial=40,failPush=false,failDeploy=false,failExec=false;
 stores.home.set('tasks/contract-validation.json',JSON.stringify({version,types:Object.fromEntries(metadata.map(m=>[m.name,{state:'passed'}]))}));stores.home.set('tasks/contract-quarantine.json','{}');
 function read(host,file){if(stores[host].has(file))return stores[host].get(file);if(host==='home'&&file.endsWith('.js'))try{return readFileSync(new URL('../'+file,import.meta.url),'utf8');}catch{}return '';}
 function api(host,pid){return {pid,args:[],getHostname:()=>host,getResetInfo:()=>reset,read:file=>read(host,file),
  write:(file,text)=>{writes.push({host,file});if(host!=='home')assert.ok(file.startsWith('Temp/contracts-inbox/'),'remote worker must only write inbox receipts');stores[host].set(file,text);},
  rm:(file,h=host)=>stores[h].delete(file),fileExists:(file,h=host)=>!!read(h,file),hasRootAccess:()=>true,getScriptRam:()=>8,getServerMaxRam:h=>h==='home'?128:64,getServerUsedRam:h=>h==='home'?120:0,
  ps:h=>[...running].filter(([,p])=>p.host===h).map(([pid,p])=>({pid,filename:entry,args:p.args})),isRunning:pid=>running.has(pid),
  scp:async(files,destination,source=host)=>{
   files=Array.isArray(files)?files:[files];copies.push({files,destination,source});
   if(destination==='home'){assert.ok(files.every(f=>f.startsWith('Temp/contracts-inbox/')));if(failPush)return false;}
   if(failDeploy&&files.some(f=>f.endsWith('.js')))return false;
   let ok=true;for(const file of files){const text=read(source,file);if(!text){ok=false;continue;}stores[destination].set(file,text);}return ok;
  },
  exec:(filename,target,options,...args)=>{if(failExec)return 0;const pid=++serial;const p={host:target,args};running.set(pid,p);launches.push({pid,target,args});return pid;},
  print:m=>logs.push(m),tprint:m=>logs.push(m),toast(){},sleep:async()=>{},codingcontract:{attempt:(answer,file)=>{attempts.push({host,answer,file});return file.startsWith('wrong')?'':'reward';}}};}
 const home=api('home',7);
 const dispatch=(contracts=[contract('good'),contract('wrong')])=>dispatchContractDelivery(home,entry,contracts,['home','remote'],Date.now()-1);
 async function work(){const job=launches.at(-1),worker=api(job.target,job.pid);worker.args=job.args;try{await solver(worker);}finally{running.delete(job.pid);}}
 const active=()=>JSON.parse(stores.home.get('tasks/contracts-active.json'));
 return {home,stores,running,copies,launches,attempts,logs,writes,dispatch,work,active,api,reset,setFailPush:v=>failPush=v,setFailDeploy:v=>failDeploy=v,setFailExec:v=>failExec=v};
}

test('remote leased solver sends a unique receipt and only home merges quarantine and summaries',async()=>{
 const f=fixture();f.stores.home.set('tasks/contract-quarantine.json',JSON.stringify({unrelated:{version:'old',at:1,error:'preserve'}}));
 const job=await f.dispatch();assert.equal(job.host,'remote');assert.ok(f.copies[0].files.includes('contract-delivery-policy.js'));assert.ok(f.copies[0].files.includes('helpers.js'));
 await f.work();assert.equal(f.attempts.length,2);assert.ok(f.attempts.every(a=>a.host==='remote'));assert.equal(f.stores.home.has('tasks/contracts-results.json'),false);
 const applied=await reconcileContractDelivery(f.home);assert.equal(applied.applied,true);
 const result=JSON.parse(f.stores.home.get('tasks/contracts-results.json'));assert.equal(result.total,2);assert.equal(result.solved,1);assert.equal(result.failed,1);
 const quarantine=JSON.parse(f.stores.home.get('tasks/contract-quarantine.json'));assert.equal(quarantine.unrelated.error,'preserve');assert.equal(quarantine[contractKey(contract('wrong'))].version,version);
 const snapshot=f.stores.home.get('tasks/contracts-results.json');assert.equal((await reconcileContractDelivery(f.home)).busy,false);assert.equal(f.stores.home.get('tasks/contracts-results.json'),snapshot);assert.equal(f.attempts.length,2);assert.equal(f.stores.home.has(contractReceiptPath(f.active().id)),false);assert.equal(f.stores.remote.has(contractReceiptPath(f.active().id)),false);
});
test('home recovers a saved remote receipt after a failed push without submitting contracts again',async()=>{
 const f=fixture();await f.dispatch();f.setFailPush(true);await f.work();assert.equal(f.attempts.length,2);assert.equal(f.stores.home.has(contractReceiptPath(f.active().id)),false);
 f.setFailPush(false);assert.equal((await reconcileContractDelivery(f.home)).applied,true);assert.equal(f.attempts.length,2);
});
test('home waits for a running worker before merging even a completed receipt',async()=>{
 const f=fixture();await f.dispatch();await f.work();const job=f.active();f.running.set(job.workerPid,{host:job.host,args:[]});assert.equal((await reconcileContractDelivery(f.home)).busy,true);assert.equal(f.stores.home.has('tasks/contracts-results.json'),false);
 f.running.clear();assert.equal((await reconcileContractDelivery(f.home)).applied,true);
});
test('lost receipt marks all affected outcomes uncertain and prevents same-version retries',async()=>{
 const f=fixture();await f.dispatch();f.running.clear();assert.equal((await reconcileContractDelivery(f.home)).uncertain,true);assert.equal(f.active().state,'uncertain');
 const q=JSON.parse(f.stores.home.get('tasks/contract-quarantine.json'));assert.ok(f.active().keys.every(k=>q[k].error.includes('uncertain')));
 assert.equal((await f.dispatch()).reason,'no-validated-contracts');assert.equal(f.launches.length,1);assert.equal(f.attempts.length,0);
});
test('receipt identity, resets, version, totals and quarantine scope must all match',async()=>{
 const f=fixture();await f.dispatch();await f.work();const job=f.active(),receipt=JSON.parse(f.stores.remote.get(contractReceiptPath(job.id)));
 assert.equal(validContractReceipt(receipt,job),true);
 for(const patch of [{id:'foreign'},{host:'foreign'},{workerPid:0},{version:'old'},{augReset:4},{nodeReset:4},{at:job.at-1},{at:job.expiresAt+60001},{total:999},{solved:2},{attempted:-1},{quarantine:{foreign:{version,at:receipt.at}}},{notified:['foreign']}])assert.equal(validContractReceipt({...receipt,...patch},job),false,JSON.stringify(patch));
 f.stores.home.set(contractReceiptPath(job.id),JSON.stringify({...receipt,id:'foreign'}));assert.equal((await reconcileContractDelivery(f.home)).uncertain,true);
});
test('remote solver cannot submit without a home lease or under a different worker PID',async()=>{
 const f=fixture();await f.dispatch();const launch=f.launches[0],remote=f.api('remote',launch.pid+1);remote.args=launch.args;await solver(remote);assert.equal(f.attempts.length,0);
 const naked=f.api('remote',launch.pid);naked.args=[JSON.stringify([contract('good')])];await solver(naked);assert.equal(f.attempts.length,0);
});
test('expired, wrong-version, reset or foreign-key leases defer rather than spend attempts',async()=>{
 for(const mode of ['expired','version','reset','key']){
  const f=fixture();await f.dispatch();const job=f.active();
  if(mode==='expired'){job.at=Date.now()-10000;job.expiresAt=Date.now()-1;}
  if(mode==='version')job.version='other';if(mode==='reset')job.augReset=99;if(mode==='key')job.keys=['foreign'];
  f.stores.home.set('tasks/contracts-active.json',JSON.stringify(job));await f.work();assert.equal(f.attempts.length,0,mode);
 }
});
test('changed validation and fresh quarantine are checked before each remote attempt',async()=>{
 const f=fixture();await f.dispatch();f.stores.home.set('tasks/contract-quarantine.json',JSON.stringify({[contractKey(contract('good'))]:{version,at:Date.now(),error:'already quarantined'}}));await f.work();assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].file,'wrong.cct');
 const g=fixture();await g.dispatch();g.stores.home.set('tasks/contract-validation.json',JSON.stringify({version:'new',types:{}}));await g.work();assert.equal(g.attempts.length,0);
});
test('pending delivery blocks new dispatch and unleased existing workers are respected',async()=>{
 const f=fixture();await f.dispatch();assert.equal((await f.dispatch()).reason,'pending-result-delivery');assert.equal(f.launches.length,1);
 const g=fixture();g.running.set(99,{host:'remote',args:[]});assert.equal((await g.dispatch()).reason,'worker-already-running');assert.equal(g.launches.length,0);
});
test('deployment and launch failures leave no uncertain submission lease',async()=>{
 for(const mode of ['copy','exec']){
  const f=fixture();if(mode==='copy')f.setFailDeploy(true);else f.setFailExec(true);
  const result=await f.dispatch();assert.equal(result.pid,0);assert.equal((await reconcileContractDelivery(f.home)).uncertain,undefined);assert.equal(f.attempts.length,0);
 }
});
test('missing validation, quarantined batches and invalid native RAM defer cleanly',async()=>{
 const f=fixture();f.stores.home.delete('tasks/contract-validation.json');assert.equal((await f.dispatch()).reason,'waiting-for-validation');
 const g=fixture();g.home.getScriptRam=()=>0;assert.equal((await g.dispatch()).reason,'invalid-worker');
});
test('dependency discovery includes transitive source files and never includes runtime snapshots',()=>{
 const f=fixture(),files=contractWorkerFiles(f.home,entry);assert.ok(files.includes('automation-manifest.js'));assert.ok(files.includes('home-ram-policy.js'));assert.ok(files.every(p=>p.endsWith('.js')));
 assert.throws(()=>contractWorkerFiles({...f.home,fileExists:()=>false},entry));assert.throws(()=>contractReceiptPath('../escape'));
});
test('dispatch bounds the batch and skips quarantined contracts without starving later work',async()=>{
 const f=fixture(),contracts=Array.from({length:100},(_,i)=>contract('good'+i));f.stores.home.set('tasks/contract-quarantine.json',JSON.stringify(Object.fromEntries(contracts.slice(0,30).map(c=>[contractKey(c),{version,at:Date.now()}]))));
 const result=await f.dispatch(contracts);assert.equal(result.count,64);const rows=JSON.parse(f.launches[0].args[0]);assert.equal(rows[0].contract,'good30.cct');assert.equal(rows.length,64);
});
test('cloud decisions retain a recent one-shot result and reject archived, future or stale records',()=>{
 const f=fixture();const record=publishCloudPurchase(f.home,{purchased:false,reason:'shared-budget',ram:128,cost:1000,budget:900,utilization:.9},Date.now());
 assert.equal(currentCloudPurchase(record,f.reset),record);assert.equal(record.state,'deferred');assert.equal(record.description,'Waiting for shared spending allowance');
 for(const patch of [{at:Date.now()+10000},{at:Date.now()-120001},{nodeReset:99},{augReset:99},{schemaVersion:0}])assert.equal(currentCloudPurchase({...record,...patch},f.reset),null);
 const bad=publishCloudPurchase(f.home,{purchased:false,cost:Infinity,error:'x'.repeat(1000)});assert.equal(bad.cost,null);assert.equal(bad.error.length,256);
});

test('supervisor diagnostics do not reference the removed local runtimeScripts binding',()=>{
 const source=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\bruntimeScripts\b/);assert.match(source,/watchedScripts\.includes/);
});

test('home fallback retains the same receipt protocol and respects reserved headroom',async()=>{
 const f=fixture();f.home.getServerUsedRam=()=>0;
 const job=await dispatchContractDelivery(f.home,entry,[contract('good')],['home'],Date.now()-1);assert.equal(job.host,'home');
 await f.work();assert.equal(f.stores.home.has('tasks/contracts-results.json'),false);assert.equal((await reconcileContractDelivery(f.home)).applied,true);assert.equal(f.attempts.length,1);
 const g=fixture();g.home.getServerUsedRam=()=>0;g.stores.home.set('home-ram-reserve.txt','124');assert.equal((await dispatchContractDelivery(g.home,entry,[contract('good')],['home'])).pid,0);
});
test('contract collection scheduler leaves room for its transient data workers',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');assert.match(source,/name: "\/Tasks\/contractor\.js", minRamReq: 16/);
});
