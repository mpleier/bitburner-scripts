import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createXpCapacityRecord,readXpCapacity,xpCapacityKey} from '../xp-capacity-policy.js';
import {sampleRouteProgress,nodeRouteSnapshotSource,estimateDaemonRoute} from '../node-route-policy.js';
import {hackingWorker} from '../hacking-drain-policy.js';
const reset={lastNodeReset:1,lastAugReset:2},hosts=[{host:'home',maxRam:64,usableRam:48,cores:1},{host:'remote',maxRam:32,usableRam:32,cores:1}];
const loop={host:'remote',pid:10,owner:7,loop:true,tool:'hack',target:'n00dles',threads:5};
const record=(patch={})=>createXpCapacityRecord({ownerPid:7,reset,mode:'xp',config:['--xp-only'],targets:['n00dles'],hosts,workers:[loop],now:1000,...patch});
const sample=(at,capacity=record({now:at}))=>({at,exp:at/10,hackMult:1,hackingMultiplier:1,xpMultiplier:1,skillModel:'bn-effective-v2',augReset:2,nodeReset:1,xpMode:'xp',worth:100,xpCapacity:capacity});
function measured(){let state;for(let i=0;i<5;i++)state=sampleRouteProgress(state,sample(1000+i*15000));return state;}
test('capacity fingerprints ignore host order, duplicate inventory rows and routine finite worker churn',()=>{
 const base=record();assert.equal(record({hosts:[...hosts].reverse(),workers:[loop,loop,{...loop,loop:false,pid:99,threads:999}]}).signature,base.signature);
 assert.equal(record({workers:[{...loop,pid:100}]}).signature,base.signature);
 assert.equal(record({workers:[loop,{...loop,pid:99,owner:8,threads:999}]}).signature,base.signature);
});
test('RAM, reservations, cores, roots, settings, targets and loop thread changes invalidate capacity',()=>{
 const base=record().signature;
 for(const patch of [{hosts:[{...hosts[0],maxRam:128},hosts[1]]},{hosts:[{...hosts[0],usableRam:32},hosts[1]]},{hosts:[{...hosts[0],cores:2},hosts[1]]},{hosts:[hosts[0]] ,workers:[]},
  {config:['--xp-only','--max-targets',3]},{targets:['foodnstuff']},{workers:[{...loop,threads:4}]},{workers:[]},{ownerPid:8,workers:[]}])assert.notEqual(record(patch).signature,base);
});
test('incomplete host and loop inventory cannot publish ready capacity',()=>{
 for(const patch of [{hosts:[]},{hosts:[...hosts,hosts[0]]},{hosts:[{...hosts[0],usableRam:100}]},{workers:[{...loop,threads:0}]},{workers:[{...loop,host:'unknown'}]}])assert.equal(record(patch).state,'unavailable');
});
test('reader requires fresh same-reset capacity owned by the live daemon',()=>{
 const ns={read:()=>JSON.stringify(record())};assert.equal(readXpCapacity(ns,{pid:7},reset,1000).state,'ready');
 for(const [daemon,r,at]of [[{pid:8},reset,1000],[{pid:7},{...reset,lastAugReset:3},1000],[{pid:7},reset,999],[{pid:7},reset,31001],[null,reset,1000]])assert.notEqual(readXpCapacity(ns,daemon,r,at).state,'ready');
 assert.equal(readXpCapacity({read:()=>'{bad'},{pid:7},reset,1000).state,'unavailable');
});
test('stable capacity earns XP rates and changed capacity starts a fresh segment without erasing BB history',()=>{
 const old=measured();assert.equal(old.xpModes.xp.rate,100);assert.equal(old.samples.length,5);
 const changed=record({now:76000,workers:[{...loop,threads:4}]}),next=sampleRouteProgress(old,sample(76000,changed));
 assert.equal(next.xpModes.xp,undefined);assert.equal(next.samples.length,6);assert.equal(next.sampling,true);
 let state=next;for(let i=1;i<=4;i++)state=sampleRouteProgress(state,sample(76000+i*15000,{...changed,at:76000+i*15000}));
 assert.equal(state.xpModes.xp.rate,100);assert.equal(state.sampling,false);
});
test('missing receipts, restarts and future or stale capacity cannot reuse measured XP',()=>{
 for(const capacity of [{state:'unavailable'},{state:'daemon-offline'},record({now:76001}),record({now:1000}),record({ownerPid:8,workers:[],now:76000})]){
  const next=sampleRouteProgress(measured(),sample(76000,capacity));assert.equal(next.xpModes.xp,undefined);
 }
});
test('a current snapshot cannot use a rate from another capacity signature',()=>{
 const s={...sample(76000),hasRedPill:true,hacking:100,wdHack:200};
 const xp={at:76000,rate:100,low:75,high:125,capacityKey:xpCapacityKey(s)};
 assert.equal(estimateDaemonRoute(s,{xpModes:{xp}}).actionable,true);
 assert.equal(estimateDaemonRoute({...s,xpCapacity:record({now:76000,workers:[]})},{xpModes:{xp}}).actionable,false);
});
test('corrupted saved histories restart measurement rather than crashing',()=>{
 for(const samples of [null,{},[null],[{at:1}], [sample(2000),sample(1000)]]){
  const result=sampleRouteProgress({samples,xpModes:{xp:{at:1,rate:100}}},sample(1000));assert.equal(result.xpModes.xp,undefined);
 }
});
test('generated snapshot reads capacity without scanning or polling remote servers',()=>{
 const capacity=record({now:Date.now()});
 const ns={getPlayer:()=>({exp:{hacking:1000},skills:{hacking:100},mults:{hacking:1,hacking_exp:1,faction_rep:1},money:1}),getResetInfo:()=>({...reset,ownedAugs:{}}),
  ps:()=>[{pid:7,filename:'daemon.js',args:['-x']}],serverExists:()=>false,read:()=>JSON.stringify(capacity)};
 const snapshot=vm.runInNewContext(nodeRouteSnapshotSource(false,false,{HackingLevelMultiplier:1}),{ns});
 assert.equal(snapshot.xpMode,'xp');assert.equal(snapshot.xpCapacity.state,'ready');assert.ok(xpCapacityKey(snapshot));
});
test('executed daemon publisher reuses its cached inventory and writes only once per cadence',async()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('                if(Date.now()-lastXpCapacityAt>=10000)'),end=source.indexOf('                // Log some status updates',start),writes=[];
 let now=100000,calls=0;const server={name:'home',server:{cpuCores:1},hasRoot:()=>true,totalRam:()=>48};
 const context={lastXpCapacityAt:0,createXpCapacityRecord,hackingWorker,resetInfo:reset,xpOnly:true,targetsByExp:[{name:'n00dles'}],dictServerMaxRam:{home:64},getAllServers:()=>[server],
 processList:()=>{calls++;return [];},Date:class extends Date{static now(){return now;}}};
 vm.runInNewContext('globalThis.run=async function(ns){'+source.slice(start,end)+'}',context);
 const ns={pid:7,args:['--xp-only'],write:async(file,text)=>writes.push({file,value:JSON.parse(text)})};
 await context.run(ns);await context.run(ns);assert.equal(writes.length,1);assert.equal(calls,1);assert.equal(writes[0].value.state,'ready');assert.equal(writes[0].file,'tasks/xp-capacity-7.json');
 now+=10000;await context.run(ns);assert.equal(writes.length,2);assert.equal(writes[1].value.signature,writes[0].value.signature);
 context.processList=()=>{throw Error('inventory unavailable');};now+=10000;await context.run(ns);assert.equal(writes.at(-1).value.state,'unavailable');
});
