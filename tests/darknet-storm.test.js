import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stormReadiness, planStorm, stormRequestFile, stormResultFile, applyStormReceipt, surveyFile } from '../darknet-storm-policy.js';
import { main as trigger } from '../darknet-storm.js';
const now = 10000000;
function reports() { return [
 {host:'darkweb',pid:1,at:now,version:1,live:true,busy:false,blockedRam:0,caches:0,contracts:0,seed:false,neighbours:['seed']},
 {host:'seed',pid:2,at:now,version:1,live:true,busy:false,blockedRam:0,caches:0,contracts:0,seed:true,neighbours:['darkweb']}
]; }
function settle(options={},rows=reports(),start=now){
 let result=planStorm(rows.map(r=>({...r,at:start})),['darkweb'],{},start,42,options);
 const duration=options.stalled?180000:30000;
 for(let t=30000;t<=duration;t+=30000)result=planStorm(rows.map(r=>({...r,at:start+t})),['darkweb'],result.state,start+t,42,options);
 return result;
}
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
 const ready=settle({},reports(),now+270000);
 assert.equal(ready.launch,true);
 ready.state.lastAttempt=now+300000;
 assert.equal(planStorm(fresh,['darkweb'],ready.state,now+300000,42).launch,false);
 const later=reports().map(row=>({...row,at:now+2100000}));
 assert.equal(planStorm(later,['darkweb'],ready.state,now+2100000,42).launch,false); // Unobserved gap resets qualification.
 assert.equal(planStorm(later,['darkweb'],ready.state,now+2100000,43).launch,false);
});
test('New rewards, missing reports, topology changes and busy scouts reset quiet period',()=>{
 const first=settle();
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
function rewardEvidence(time=Date.now(),patch={}) {return {schemaVersion:1,nodeReset:42,augReset:7,at:time,totals:{money:0,shares:0,programs:0,stockAccess:0,dataFiles:0,contracts:0,augmentations:0,karma:0,unknown:0},lastNoncashAt:{shares:0,programs:0,stockAccess:0,dataFiles:0,contracts:0,augmentations:0,unknown:0},coverage:{complete:true,liveHosts:2,pendingHosts:0},omitted:0,...patch};}
async function fixture(change={}) {
 const time=Date.now(),rows=reports().map(row=>({...row,at:time}));
 const request={rewardGuard:true,income:1000,lastCacheAt:0,id:'test-dispatch',host:'seed',at:time,reset:42,reports:rows,roots:['darkweb'],signature:stormReadiness(rows,['darkweb'],time).signature};
 if(change.request)Object.assign(request,change.request);
 for(const r of rows){r.stormHoldId=change.noAck?'old':request.id;r.at=time;r.contractFiles=[];r.lastCacheAt=0;}
 if(change.report)Object.assign(rows[1],change.report);
 if(change.locked)rows[1].neighbours.push('locked');
 request.signature=stormReadiness(rows,request.roots,time,{stalled:request.mode==='stalled',frontier:request.frontier||[]}).signature;
 let calls=0;const local=new Map(Object.entries(change.local||{})),home=new Map([['tasks/dnet-cache-rewards-summary.json',JSON.stringify(rewardEvidence(time))],['tasks/contracts-status.json',JSON.stringify({at:time,nodeReset:42,augReset:7,validationVersion:'v1',contracts:[{host:'seed',file:'hard.cct',type:'Unsupported'}]})],['tasks/contract-validation.json',JSON.stringify({at:time,version:'v1',types:{Unsupported:{state:'unsupported'}}})],...rows.map(r=>[surveyFile(r.host),JSON.stringify(r)]),...Object.entries(change.home||{})]);
 const ns={disableLog(){},getHostname:()=> 'seed',
  fileExists:(file,host)=>host==='home'?home.has(file):local.has(file),
  scp:async(file,to,from)=>{
   if(file===change.failCopy)return false;
   if(to==='seed'&&from==='home'&&home.has(file))local.set(file,home.get(file));
   if(change.afterCopy)change.afterCopy(file);
   if(to==='home'&&from==='seed'&&local.has(file))home.set(file,local.get(file));
   return true;
  },
  read:file=>file===stormRequestFile?JSON.stringify(request):local.get(file)||'',
  write:async(file,text)=>local.set(file,text),isRunning:()=>true,sleep:async()=>{if(change.afterSleep)change.afterSleep(home,rows);},getResetInfo:()=>({lastNodeReset:42,lastAugReset:7}),getMoneySources:()=>({sinceInstall:{darknet:change.income??1000}}),
  ls:host=>host==='locked'?[]:host==='seed'?['STORM_SEED.exe',...(change.files||[])]:change.remoteFiles||[],
  ps:host=>host==='home'?(change.homeProcesses||[]):host==='locked'?[]:[{filename:'darknet-node.js',pid:host==='seed'?2:1},...(change.processes||[])],
  dnet:{getServerDetails:host=>host==='locked'?{hasSession:change.frontierAuthenticated===true}:{blockedRam:change.blockedRam||0},probe:()=>change.neighbours||(change.locked?['darkweb','locked']:['darkweb']),
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
 const first=settle();
 const fresh=t=>reports().map(row=>({...row,at:t}));
 let state=settle({},reports(),now+270000).state;
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
 assert.equal(planStorm(fresh(now+2100001),['darkweb'],succeeded,now+2100001,42).launch,false); // Cooldown expiry alone cannot replace observation.
});

test('cleared networks qualify at thirty seconds with continuous reports, not five minutes',()=>{
 const first=planStorm(reports(),['darkweb'],{},now,42);assert.equal(first.launch,false);
 const almost=planStorm(reports().map(r=>({...r,at:now+29999})),['darkweb'],first.state,now+29999,42);assert.equal(almost.launch,false);
 assert.equal(settle().launch,true);assert.equal(settle().quietMs,30000);
 assert.equal(planStorm(reports().map(r=>({...r,at:now+300000})),['darkweb'],first.state,now+300000,42).launch,false);
});
test('confirmed locked frontiers qualify only after three minutes without progress',()=>{
 const rows=reports();rows[1].neighbours.push('locked');
 assert.equal(stormReadiness(rows,['darkweb'],now).ready,false);
 assert.equal(settle({stalled:true,frontier:['locked']},rows).launch,true);
 assert.equal(settle({stalled:true,frontier:[]},rows).launch,false);
 const first=planStorm(rows,['darkweb'],{},now,42,{stalled:true,frontier:['locked']});
 const later=rows.map(r=>({...r,at:now+90000}));assert.equal(planStorm(later,['darkweb'],first.state,now+90000,42,{stalled:true,frontier:['locked']}).launch,false);
});
test('unchanged contracts can qualify but caches, blocked RAM, busy scouts and missing reports cannot',()=>{
 const rows=reports();Object.assign(rows[1],{contracts:1,contractFiles:['hard.cct']});
 assert.equal(settle({stalled:true},rows).launch,true);assert.equal(settle({},rows).launch,false);
 for(const patch of [{caches:1},{blockedRam:1},{busy:true},{live:false},{contractFiles:undefined}]){const changed=structuredClone(rows);Object.assign(changed[1],patch);assert.equal(settle({stalled:true},changed).launch,false);}
 const first=settle({stalled:true},rows),later=rows.map(r=>({...r,at:now+630000}));later[1].contractFiles=['different.cct'];assert.equal(planStorm(later,['darkweb'],first.state,now+630000,42,{stalled:true}).launch,false);
});
test('helper requires fresh hold acknowledgements and keeps active contracts and controls protected',async()=>{
 assert.equal(await fixture({noAck:true}),0);
 assert.equal(await fixture({homeProcesses:[{filename:'Tasks/contractor.js'}]}),0);
 assert.equal(await fixture({homeProcesses:[{filename:'contract-validation.js'}]}),1);
 assert.equal(await fixture({home:{[surveyFile('seed')]:JSON.stringify({...reports()[1],at:Date.now(),busy:true,stormHoldId:'test-dispatch'})}}),0);
});
test('source wires locked-frontier native checks and a bounded scout hold instead of cancelling authentication',()=>{
 const scout=readFileSync(new URL('../darknet-node.js',import.meta.url),'utf8'),manager=readFileSync(new URL('../darknet-manager.js',import.meta.url),'utf8');
 assert.match(scout,/stormHoldId/);assert.match(scout,/Date.now\(\)-request.at<30000/);assert.match(manager,/hasSession===false/);assert.match(manager,/stalled:true,frontier/);
});

test('solver progress and scout replacement restart a stalled horizon',()=>{
 const rows=reports();rows[1].neighbours.push('locked');rows[1].solverProgress='a';const first=settle({stalled:true,frontier:['locked']},rows);
 for(const patch of [{solverProgress:'b'},{pid:999}]){
  const next=rows.map(r=>({...r,at:now+630000}));Object.assign(next[1],patch);
  assert.equal(planStorm(next,['darkweb'],first.state,now+630000,42,{stalled:true,frontier:['locked']}).launch,false);
 }
});
test('native stalled frontier is allowed only while locked and has no running work',async()=>{
 const request={mode:'stalled',frontier:['locked']};
 assert.equal(await fixture({locked:true,request}),1);
 assert.equal(await fixture({locked:true,request,frontierAuthenticated:true}),0);
 assert.equal(await fixture({processes:[{filename:'Tasks/contractor.js.solver.js',pid:9}]}),0);
});

test('native stalled contract dispatch verifies exact unchanged filenames',async()=>{
 const report={contracts:1,contractFiles:['hard.cct']},request={mode:'stalled',frontier:[]};
 assert.equal(await fixture({request,report,files:['hard.cct']}),1);
 assert.equal(await fixture({request,report,files:['different.cct']}),0);
 assert.equal(await fixture({request,report,files:['hard.cct','new.cache']}),0);
});
test('pause arriving during the hold wait is checked before native execution',async()=>{
 assert.equal(await fixture({noAck:true,afterSleep:(home,rows)=>{
  for(const r of rows)home.set(surveyFile(r.host),JSON.stringify({...r,stormHoldId:'test-dispatch'}));
  home.set('remote-control/paused/darknet-manager.js.txt','true');
 }}),0);
});
test('actual scout hold yields between passes and expires without cancelling a running operation',async()=>{
 const source=readFileSync(new URL('../darknet-node.js',import.meta.url),'utf8');
 const block=source.slice(source.indexOf("      if(ns.fileExists(stormRequestFile,'home'))try{"),source.indexOf('      await survey(true);'));
 const run=Function('ns','survey','heartbeat','stormRequestFile','return (async()=>{const self="seed",cacheFile="darknet-cache.js",stasisFile="darknet-stasis.js",migrateFile="darknet-migrate.js";let explored=0;for(let i=0;i<1;i++){'+block+';explored++;}return explored;})()');
 const events=[],request={id:'hold',at:Date.now()},ns={fileExists:()=>true,scp:async()=>true,read:()=>JSON.stringify(request),ps:()=>[],sleep:async n=>events.push(n)};
 assert.equal(await run(ns,async(busy,id)=>events.push([busy,id]),async()=>{},'request'),0);assert.deepEqual(events,[[false,'hold'],1000]);
 request.at=Date.now()-31000;assert.equal(await run(ns,async()=>{},async()=>{},'request'),1);
});

test('new income or a newly opened cache during dispatch cancels the native storm',async()=>{
 assert.equal(await fixture({income:1001}),0);assert.equal(await fixture({request:{income:undefined}}),0);
 assert.equal(await fixture({report:{lastCacheAt:Date.now()}}),0);
});

test('native refresh protects newly solvable or unknown contracts even after stalled qualification',async()=>{
 const report={contracts:1,contractFiles:['hard.cct']},request={mode:'stalled',frontier:[]};
 for(const value of ['',JSON.stringify({at:Date.now(),version:'v1',types:{Unsupported:{state:'passed'}}})])assert.equal(await fixture({request,report,files:['hard.cct'],home:{'tasks/contract-validation.json':value}}),0);
});
test('measured low-income allowance is bounded and never ignores a new cache',async()=>{
 assert.equal(await fixture({income:1005,request:{incomeTolerance:10}}),1);
 assert.equal(await fixture({income:1011,request:{incomeTolerance:10}}),0);
 assert.equal(await fixture({income:1005,request:{incomeTolerance:10},report:{lastCacheAt:Date.now()}}),0);
 assert.equal(await fixture({income:999,request:{incomeTolerance:10}}),0);
 for(const tolerance of [-1,Infinity,'10'])assert.equal(await fixture({request:{incomeTolerance:tolerance}}),0);
});

 test('anchor changes during hold are rechecked before consuming a StormSeed',async()=>{
  const file='tasks/dnet-anchor-request.json';
  for(const phase of ['prepare','release','apply','rollback'])assert.equal(await fixture({home:{[file]:JSON.stringify({expiresAt:Date.now()+60000,phase})}}),0);
  for(const phase of ['done','blocked'])assert.equal(await fixture({home:{[file]:JSON.stringify({expiresAt:Date.now()+60000,phase})}}),1);
  assert.equal(await fixture({home:{[file]:'malformed'}}),0);
  assert.equal(await fixture({home:{[file]:JSON.stringify({expiresAt:Date.now()+60000,phase:'prepare'})},failCopy:file}),0);
  assert.equal(await fixture({home:{[file]:JSON.stringify({expiresAt:Date.now()-1,phase:'prepare'})}}),1);
 });

test('final native refresh protects noncash rewards and incomplete or stale reward evidence',async()=>{
 const file='tasks/dnet-cache-rewards-summary.json',at=Date.now();
 for(const kind of ['shares','programs','stockAccess','dataFiles','contracts','augmentations','unknown']) {
  const summary=rewardEvidence(at);summary.totals[kind]=1;summary.lastNoncashAt[kind]=at;
  assert.equal(await fixture({home:{[file]:JSON.stringify(summary)}}),0,kind);
 }
 for(const patch of [{at:at-90001},{at:at+100000},{nodeReset:43},{augReset:8},{coverage:{complete:false,liveHosts:2,pendingHosts:1}},{omitted:1}])
  assert.equal(await fixture({home:{[file]:JSON.stringify(rewardEvidence(at,patch))}}),0);
 assert.equal(await fixture({home:{[file]:''}}),0);
 assert.equal(await fixture({failCopy:file}),0);
 assert.equal(await fixture({request:{rewardGuard:false}}),0);
});
test('dispatch expires if final reward evidence sync exceeds its lifetime',async()=>{
 const original=Date.now,at=original();let clock=at;Date.now=()=>clock;
 try{assert.equal(await fixture({afterCopy:file=>{if(file==='tasks/dnet-cache-rewards-summary.json')clock=at+30001;}}),0);}
 finally{Date.now=original;}
});
