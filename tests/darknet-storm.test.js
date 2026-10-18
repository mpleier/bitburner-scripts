import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stormReadiness, planStorm, stormRequestFile, stormResultFile, applyStormReceipt } from '../darknet-storm-policy.js';
import { main as trigger } from '../darknet-storm.js';
const now = 10000000;
function reports() { return [
 {host:'darkweb',pid:1,at:now,version:1,live:true,busy:false,blockedRam:0,caches:0,contracts:0,seed:false,neighbours:['seed']},
 {host:'seed',pid:2,at:now,version:1,live:true,busy:false,blockedRam:0,caches:0,contracts:0,seed:true,neighbours:['darkweb']}
]; }
test('StormSeed requires a complete, fresh, live survey of reachable network',()=>{
 assert.equal(stormReadiness(reports(),['darkweb'],now).seedHost,'seed');
 for(const patch of [{busy:true},{blockedRam:1},{caches:1},{contracts:1},{live:false},{at:now-90001},{at:now+1},{version:0},{neighbours:null},{blockedRam:undefined}]) {
  const rows=reports();Object.assign(rows[1],patch);assert.equal(stormReadiness(rows,['darkweb'],now).ready,false,JSON.stringify(patch));
 }
 assert.equal(stormReadiness(reports().slice(0,1),['darkweb'],now).ready,false);
 assert.equal(stormReadiness(reports(),[],now).ready,false);
 const rows=reports();rows[1].neighbours.push('uncracked-labyrinth');
 assert.equal(stormReadiness(rows,['darkweb'],now).ready,false);
});
test('StormSeed ignores disconnected historical reports but requires a reachable seed',()=>{
 const rows=reports();rows.push({host:'deleted',at:0});
 assert.equal(stormReadiness(rows,['darkweb'],now).ready,true);
 rows[1].seed=false;assert.equal(stormReadiness(rows,['darkweb'],now).ready,false);
});
test('StormSeed quiet period survives restart and applies a short failed-attempt retry delay',()=>{
 const first=planStorm(reports(),['darkweb'],{},now,42);
 assert.equal(first.launch,false);
 const fresh=reports().map(row=>({...row,at:now+300000}));
 const ready=planStorm(fresh,['darkweb'],JSON.parse(JSON.stringify(first.state)),now+300000,42);
 assert.equal(ready.launch,true);
 ready.state.lastAttempt=now+300000;
 assert.equal(planStorm(fresh,['darkweb'],ready.state,now+300000,42).launch,false);
 const later=reports().map(row=>({...row,at:now+2100000}));
 assert.equal(planStorm(later,['darkweb'],ready.state,now+2100000,42).launch,true);
 assert.equal(planStorm(later,['darkweb'],ready.state,now+2100000,43).launch,false);
});
test('New rewards, missing reports, topology changes and busy scouts reset quiet period',()=>{
 const first=planStorm(reports(),['darkweb'],{},now,42);
 for(const change of ['reward','missing','busy','topology']) {
  const rows=reports().map(row=>({...row,at:now+300000}));
  if(change==='reward')rows[1].caches=1;
  if(change==='missing')rows.pop();
  if(change==='busy')rows[1].busy=true;
  if(change==='topology')rows[1].neighbours=[];
  const changed=planStorm(rows,['darkweb'],first.state,now+300000,42);
  assert.equal(changed.launch,false,change);
  const fresh=reports().map(row=>({...row,at:now+330000}));
  assert.equal(planStorm(fresh,['darkweb'],changed.state,now+330000,42).launch,false,change);
 }
});
async function fixture(change={}) {
 const time=Date.now(),rows=reports().map(row=>({...row,at:time}));
 const request={id:'test-dispatch',host:'seed',at:time,reset:42,reports:rows,roots:['darkweb'],signature:stormReadiness(rows,['darkweb'],time).signature};
 if(change.request)Object.assign(request,change.request);
 let calls=0;const local=new Map(Object.entries(change.local||{})),home=new Map(Object.entries(change.home||{}));
 const ns={disableLog(){},getHostname:()=> 'seed',
  fileExists:(file,host)=>host==='home'?home.has(file):local.has(file),
  scp:async(file,to,from)=>{
   if(file===change.failCopy)return false;
   if(to==='seed'&&from==='home'&&home.has(file))local.set(file,home.get(file));
   if(to==='home'&&from==='seed'&&local.has(file))home.set(file,local.get(file));
   return true;
  },
  read:file=>file===stormRequestFile?JSON.stringify(request):local.get(file)||'',
  write:async(file,text)=>local.set(file,text),isRunning:()=>true,sleep:async()=>{},getResetInfo:()=>({lastNodeReset:42}),
  ls:host=>host==='seed'?['STORM_SEED.exe',...(change.files||[])]:change.remoteFiles||[],
  ps:host=>[{filename:'darknet-node.js',pid:host==='seed'?2:1},...(change.processes||[])],
  dnet:{getServerDetails:()=>({blockedRam:change.blockedRam||0}),probe:()=>change.neighbours||['darkweb'],
   unleashStormSeed:()=>{calls++;if(change.throw)throw Error('unavailable Source File');return change.nativeFailure?{success:false,message:'Native rejection'}:{success:true};}},
  print(){},tprint(){}};
 if(change.missingAPI)delete ns.dnet.unleashStormSeed;
 await trigger(ns);
 if(change.receipt){change.receipt.value=JSON.parse(home.get(stormResultFile)||'null');}
 return calls;
}
test('Storm helper triggers only on selected host with current seed and clear rewards',async()=>{
 assert.equal(await fixture(),1);
 for(const change of [{files:['new.cache']},{files:['unsolved.cct']},{remoteFiles:['new.cache']},
  {blockedRam:1},{neighbours:['new-frontier']},{processes:[{filename:'darknet-migrate.js',pid:5}]},
  {request:{at:Date.now()-31000}},{request:{reset:99}},{request:{host:'other'}}])
  assert.equal(await fixture(change),0,JSON.stringify(change));
});
test('Missing StormSeed API/Source File fails gracefully',async()=>{
 assert.equal(await fixture({throw:true}),1);
 assert.equal(await fixture({missingAPI:true}),0);
});
test('Scouts deploy storm helpers and manager schedules only after complete survey',()=>{
 for(const file of ['darknet-manager.js','darknet-node.js']) {
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.match(source,/const codeFiles = \[[^\]]*"darknet-storm-policy\.js"/);
  assert.match(source,/const codeFiles = \[[^\]]*"darknet-storm\.js"/);
 }
});

test('final StormSeed controls come from home, overriding local stale copies and failing closed on sync errors',async()=>{
 const paused='remote-control/paused/darknet-manager.js.txt',maintenance='tasks/automation-maintenance.json';
 assert.equal(await fixture({home:{[paused]:' true '}}),0);
 assert.equal(await fixture({home:{[maintenance]:JSON.stringify({ownerPid:7,expiresAt:Date.now()+60000})}}),0);
 assert.equal(await fixture({home:{[paused]:'true'},local:{[paused]:'false'}}),0);
 assert.equal(await fixture({home:{[paused]:'false'},local:{[paused]:'true'}}),1);
 assert.equal(await fixture({local:{[paused]:'true'}}),1);
 assert.equal(await fixture({home:{[paused]:'true'},failCopy:paused}),0);
 assert.equal(await fixture({home:{[maintenance]:'malformed'}}),0);
});
test('StormSeed helper acknowledges native success, native failure, cancellation and unavailable API',async()=>{
 for(const [change,expected] of [[{},true],[{nativeFailure:true},false],[{missingAPI:true},false],
  [{home:{'remote-control/paused/darknet-manager.js.txt':'true'}},false]]) {
  const receipt={};await fixture({...change,receipt});
  assert.equal(receipt.value.id,'test-dispatch');assert.equal(receipt.value.success,expected);
 }
});
test('only matching successful receipts establish thirty minute cooldown; failures retry in one minute',()=>{
 const first=planStorm(reports(),['darkweb'],{},now,42);
 const fresh=t=>reports().map(row=>({...row,at:t}));
 let state=planStorm(fresh(now+300000),['darkweb'],first.state,now+300000,42).state;
 state.lastAttempt=now+300000;state.pending={id:'dispatch',host:'seed',at:now+300000};
 const success={id:'dispatch',host:'seed',reset:42,at:now+300001,success:true};
 for(const patch of [{id:'old'},{host:'other'},{reset:43},{at:now+299999},{at:now+330001},{at:now+500000},{success:'true'}])
  assert.equal(applyStormReceipt(state,{...success,...patch},42,now+300010),state);
 const failed=applyStormReceipt(state,{...success,success:false},42,now+300010);
 assert.equal(planStorm(fresh(now+359999),['darkweb'],failed,now+359999,42).launch,false);
 assert.equal(planStorm(fresh(now+360000),['darkweb'],failed,now+360000,42).launch,true);
 const succeeded=applyStormReceipt(state,success,42,now+300010);
 assert.equal(succeeded.pending,undefined);assert.equal(succeeded.lastSuccess,success.at);
 assert.equal(planStorm(fresh(now+360000),['darkweb'],succeeded,now+360000,42).launch,false);
 assert.equal(planStorm(fresh(now+2100001),['darkweb'],succeeded,now+2100001,42).launch,true);
});
