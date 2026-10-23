import test from 'node:test';
import assert from 'node:assert/strict';
import {hackingProcessInventory} from '../hacking-process-policy.js';
import {estimateHackingDrain,hackingDrainPadding} from '../hacking-deadline-policy.js';
import {targetSwitchEconomics} from '../hacking-target-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
function worker(extra={}){
 const meta={port:20,batchVersion:1,batchId:'1:2:7:1',nodeReset:1,augReset:2,batchTarget:'x',batchStep:'hack',pieceThreads:4,batchPlan:[{step:'hack',tool:'hack',threads:4,deadline:6000}]};
 return {filename:'Remote/hack-target.js',pid:10,threads:4,args:['x',1000,5000,'Batch 0-hack',false,false,false,7,JSON.stringify(meta)],...extra};
}
function inventory(workers=[worker()],extra={}){return hackingProcessInventory({ps:()=>workers,getScriptRam:()=>2,...extra},['home'],7,2000,reset);}
const estimate=(snapshot,extra={})=>estimateHackingDrain(snapshot,'x',{now:2200,ownerPid:7,reset,fallbackMs:20000,paddingMs:500,...extra});
function mutate(change){const p=worker(),m=JSON.parse(p.args[8]);change(p,m);p.args[8]=typeof m.raw==='string'?m.raw:JSON.stringify(m);return p;}

test('existing inventory captures future deadlines without extra host scans or native reads',()=>{
 let scans=0,costs=0;const inv=inventory([worker()],{ps:()=>{scans++;return [worker()];},getScriptRam:()=>{costs++;return 2;},scan:()=>assert.fail('unexpected scan')});
 assert.equal(scans,1);assert.equal(costs,1);assert.equal(inv.allocations.x.ram,8);assert.equal(inv.drain.targets.x.workers,1);assert.equal(inv.drain.targets.x.known,1);assert.equal(estimate(inv.drain).drainMs,4300);assert.equal(estimate(inv.drain).basis,'worker-deadlines');
});
test('latest split worker deadline controls remaining drain and queued work can exceed a full weaken',()=>{
 const second=mutate((p,m)=>{p.pid=11;p.args[1]=95000;m.batchId='1:2:7:2';m.batchPlan[0].deadline=100000;});
 const inv=inventory([worker(),second]);assert.equal(inv.drain.targets.x.workers,2);assert.equal(estimate(inv.drain).drainMs,98300);assert.ok(estimate(inv.drain).drainMs>20000);const mixed=inventory([second,mutate(p=>{p.args[6]=true;})]);assert.equal(estimate(mixed.drain).drainMs,98300);assert.equal(estimate(mixed.drain).basis,'full-weaken-fallback');
});
test('foreign, looping, manual, legacy, malformed and inconsistent workers retain full-weaken fallback',()=>{
 const bad=[mutate(p=>{p.args[7]=8;}),mutate(p=>{p.args[6]=true;}),worker({filename:'Remote/manualhack-target.js'}),mutate((p,m)=>{delete m.batchVersion;}),mutate((p,m)=>{m.raw='{bad';}),mutate((p,m)=>{m.augReset=3;}),mutate((p,m)=>{m.pieceThreads=3;}),mutate((p,m)=>{m.batchPlan[0].deadline=6001;}),mutate((p,m)=>{m.batchId='1:2:8:1';}),mutate((p,m)=>{m.batchPlan[0].tool='grow';})];
 for(const p of bad){const r=estimate(inventory([worker(),p]).drain);assert.equal(r.drainMs,20000);assert.equal(r.basis,'full-weaken-fallback');}
});
test('overdue work, stale snapshots, reset/owner changes and invalidation never imply zero remaining time',()=>{
 const snapshot=inventory().drain;
 for(const extra of [{now:6000},{now:10000},{ownerPid:8},{reset:{...reset,lastAugReset:3}}])assert.equal(estimate(snapshot,extra).basis,'full-weaken-fallback');
 for(const patch of [{complete:false},{invalidated:true},{at:3000}])assert.equal(estimate({...snapshot,...patch}).drainMs,20000);
 assert.equal(estimate(inventory([mutate((p,m)=>{p.args[1]=-4000;m.batchPlan[0].deadline=1000;})]).drain).drainMs,20000);
 assert.equal(estimate(undefined).drainMs,20000);
});
test('zero drain is allowed only for an empty target in a valid complete snapshot',()=>{
 const empty=inventory([]).drain;assert.equal(estimate(empty).drainMs,0);assert.equal(estimate(empty).basis,'empty-inventory');
 assert.equal(estimate({...empty,invalidated:true}).drainMs,20000);
 const failed=inventory([],{ps:()=>{throw Error('host gone');}});assert.equal(failed.complete,false);assert.equal(estimate(failed.drain).drainMs,20000);
 const unknown=worker();unknown.args[0]=null;assert.equal(estimate(inventory([unknown]).drain).drainMs,20000);
});
test('deadline inventory is bounded and duplicate hosts do not duplicate workers',()=>{
 let reads=0;const inv=hackingProcessInventory({ps:()=>{reads++;return [worker()];},getScriptRam:()=>2},['home','home'],7,2000,reset);assert.equal(reads,1);assert.equal(inv.drain.targets.x.workers,1);
 const many=Array.from({length:65},(_,i)=>{const p=worker();p.args[0]='x'+i;return p;});const bounded=inventory(many);assert.equal(Object.keys(bounded.drain.targets).length,64);assert.equal(bounded.drain.complete,false);
});
test('drain padding cannot be disabled and snapshot-only deadline estimates do not mutate input',()=>{
 const snapshot=inventory().drain,before=JSON.stringify(snapshot);assert.equal(estimate(snapshot,{paddingMs:0}).drainMs,4050);assert.equal(JSON.stringify(snapshot),before);
});
test('payback economics use remaining drain including valid zero and retain old fallback behavior',()=>{
 const current={projectedRate:100,weakMs:20000},candidate={projectedRate:200,prepMs:0,firstReceiptMs:21000};
 assert.equal(targetSwitchEconomics(current,candidate,1800000).paybackMs,82000);
 assert.equal(targetSwitchEconomics({...current,drain:{drainMs:5000,basis:'worker-deadlines'}},candidate,1800000).paybackMs,52000);
 const empty=targetSwitchEconomics({...current,drain:{drainMs:0,basis:'empty-inventory'}},candidate,1800000);assert.equal(empty.paybackMs,42000);assert.equal(empty.drainMs,0);
 assert.equal(targetSwitchEconomics({...current,drain:{drainMs:NaN}},candidate,1800000).paybackMs,82000);
});

test('unscanned and structurally incomplete inventories cannot certify empty targets',()=>{
 const noHosts=hackingProcessInventory({ps:()=>assert.fail('no host supplied')},[],7,2000,reset);assert.equal(estimate(noHosts.drain).basis,'full-weaken-fallback');
 const valid=inventory([]).drain;for(const patch of [{targets:null},{targets:[]},{hostCount:0},{schemaVersion:undefined},{invalidated:undefined}])assert.equal(estimate({...valid,...patch}).drainMs,20000);
});

const timingNow=200000;
function timingData(){return {at:timingNow,ownerPid:7,nodeReset:1,augReset:2,blocked:false,recent:Array.from({length:5},(_,i)=>({owner:7,pid:10+i,tool:'hack',at:timingNow-2000+i*400,deadline:timingNow-2700+i*400,lateMs:700,batchVersion:1,batchId:'1:2:7:'+i}))};}
const padding=(data,extra={})=>hackingDrainPadding(data,{now:timingNow,ownerPid:7,reset,baseMs:500,...extra});
test('drain padding uses independent fresh batch observations and never reduces the configured floor',()=>{
 const data=timingData(),before=JSON.stringify(data),r=padding(data);assert.equal(r.paddingMs,950);assert.equal(r.basis,'observed-batch-delays');assert.equal(r.batches,5);assert.equal(padding(data,{baseMs:1500}).paddingMs,1500);assert.equal(JSON.stringify(data),before);
});
test('split fragments and repeated receipts do not provide independent delay evidence',()=>{
 const data=timingData();data.recent=Array.from({length:40},(_,i)=>({...data.recent[0],pid:100+i}));assert.equal(padding(data).basis,'configured-minimum');assert.equal(padding(data).batches,1);
});
test('stale, blocked, foreign and reset-mismatched timing retains configured padding',()=>{
 for(const patch of [{at:timingNow-15001},{at:timingNow+1},{ownerPid:8},{nodeReset:3},{augReset:3},{blocked:true},{recent:null}])assert.equal(padding({...timingData(),...patch}).basis,'configured-minimum');
 assert.equal(padding(null).paddingMs,500);
});
test('invalid, future, old and contradictory receipts cannot calibrate drain padding',()=>{
 for(const patch of [{owner:8},{error:'failed'},{batchVersion:0},{batchId:'1:2:8:0'},{tool:'share'},{pid:0},{lateMs:Infinity},{lateMs:-1},{deadline:1},{at:timingNow+1},{at:timingNow-120001}]){
  const data=timingData();data.recent=data.recent.map(e=>({...e,...patch}));assert.equal(padding(data).basis,'configured-minimum');
 }
 const data=timingData();data.recent=data.recent.map(e=>({...e,at:timingNow,deadline:timingNow-700}));assert.equal(padding(data).basis,'configured-minimum');
});
