import {backgroundJobDue,backgroundJobDispatched} from '../background-job-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {factionBackdoorServers,publishBackdoorCompletion,observeBackdoorCompletions,acknowledgeBackdoorCompletions} from '../backdoor-unlock-policy.js';
import {infrastructureCashBand,infrastructureAffordable,torProgramsHandoff} from '../early-game-policy.js';
import {main as worker} from '../Tasks/backdoor-all-servers.js.backdoor-one.js';
const reset={lastNodeReset:1,lastAugReset:2};
const event=(target='CSEC')=>({target,token:target+':5',at:1000,state:'completed',nodeReset:1,augReset:2});
test('completion files are independent per faction server and scoped to the installation reset',async()=>{
 const files={},ns={pid:5,getResetInfo:()=>reset,write:async(f,s)=>files[f]=JSON.parse(s)};
 await Promise.all(['CSEC','avmnite-02h'].map(h=>publishBackdoorCompletion(ns,h,reset)));
 assert.equal(Object.keys(files).length,2);assert.equal(files['tasks/backdoor-completed-CSEC.json'].state,'completed');
 assert.equal(await publishBackdoorCompletion(ns,'n00dles',reset),false);
 assert.equal(await publishBackdoorCompletion(ns,'CSEC',{...reset,lastAugReset:0}),false);
});
test('completion observation preserves pending events until acknowledged and rejects old reset data',()=>{
 let s=observeBackdoorCompletions(null,[event('CSEC'),event('avmnite-02h')],reset,1001);
 assert.equal(s.pending.length,2);s=acknowledgeBackdoorCompletions(s,[s.pending[0]]);
 assert.deepEqual(observeBackdoorCompletions(s,[event('CSEC'),event('avmnite-02h')],reset,1001).pending.map(e=>e.target),['avmnite-02h']);
 for(const patch of [{nodeReset:0},{augReset:0},{at:2000},{state:'started'},{target:'n00dles'}])assert.equal(observeBackdoorCompletions(null,[{...event(),...patch}],reset,1001).pending.length,0);
});
test('worker publishes completion only after successful native installation',async()=>{
 for(const success of [true,false]){
  const files={},ns={pid:8,args:['CSEC'],read:()=>'',getResetInfo:()=>reset,getScriptName:()=> 'Tasks/backdoor-all-servers.js.backdoor-one.js',
   write:async(f,s)=>files[f]=JSON.parse(s),print(){},toast(){},singularity:{getCurrentServer:()=> 'CSEC',installBackdoor:async()=>{if(!success)throw Error('native failure');}}};
  await worker(ns);assert.equal(!!files['tasks/backdoor-completed-CSEC.json'],success);
 }
});
async function rooting(){
 const source=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),a=source.indexOf('    async function prioritizeFactionRooting('),b=source.indexOf('    // Main targeting loop',a);
 let now=100000,paused=false,free=100,fails=false,ports=1;const rooted=new Set(),calls=[];
 const servers=['n00dles',...factionBackdoorServers].map((name,i)=>({name,canCrack:()=>i<=ports}));
 const context={backgroundJobDue,backgroundJobDispatched,Date:{now:()=>now},factionBackdoorServers,factionRootAttempts:new Map(),daemonHost:'home',getAllServers:()=>servers,getFilePath:s=>s,
  isScriptPaused:()=>paused,maintenanceRequested:()=>false,getServerByName:()=>({ramAvailable:()=>free}),log(){},doRoot:async(ns,s)=>{calls.push(s.name);if(fails)throw Error('RAM race');rooted.add(s.name);}};
 vm.runInNewContext(source.slice(a,b)+';globalThis.execute=prioritizeFactionRooting;',context);
 const ns={getScriptName:()=> 'daemon.js',hasRootAccess:h=>rooted.has(h),getScriptRam:()=>2};
 return{calls,rooted,run:()=>context.execute(ns),set:o=>{now=o.now??now;paused=o.paused??paused;free=o.free??free;fails=o.fails??fails;ports=o.ports??ports;}};
}
test('rooting prioritizes only faction targets and reacts as more port openers become available',async()=>{
 const h=await rooting();await h.run();assert.deepEqual(h.calls,['CSEC']);
 h.set({ports:2});await h.run();assert.deepEqual(h.calls,['CSEC','avmnite-02h']);await h.run();assert.equal(h.calls.length,2);
});
test('priority rooting defers pauses and RAM shortages and bounds failed-root retries',async()=>{
 const h=await rooting();h.set({paused:true});await h.run();assert.deepEqual(h.calls,[]);
 h.set({paused:false,free:1});await h.run();assert.deepEqual(h.calls,[]);
 h.set({free:100,fails:true});await assert.doesNotReject(h.run);assert.deepEqual(h.calls,['CSEC']);
 h.set({now:101000});await h.run();assert.equal(h.calls.length,1);
 h.set({now:105000,fails:false});await h.run();assert.equal(h.calls.length,2);
});
async function scheduler(){
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),a=s.indexOf('    async function runPeriodicScripts('),b=s.indexOf('    async function tryRunTool(',a),body=s.slice(a,b);
 let now=100000,active=false,canLaunch=false,attempts=0;const files={'tasks/backdoor-completed-CSEC.json':JSON.stringify(event())};
 const script={name:'faction-manager.js',factionInvites:true,interval:31000,lastRun:99000};
 const context={backgroundJobDue,backgroundJobDispatched,factionBackdoorServers,observeBackdoorCompletions,acknowledgeBackdoorCompletions,factionCompletionState:null,factionInviteWake:false,
  periodicScripts:[script],resetInfo:reset,Date:{now:()=>now},dictSourceFiles:{},options:{},infrastructureCashBand,infrastructureAffordable,torProgramsHandoff,
  getPlayerMoney:()=>0,getTool:s=>s,whichServerIsRunning:()=>active?['home',7]:[null,null],tryRunTool:async()=>{attempts++;return canLaunch;}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.execute=runPeriodicScripts;',context);
 const ns={read:f=>files[f]||'',sleep:async()=>{}};
 return{context,run:()=>context.execute(ns),get attempts(){return attempts;},set:o=>{now=o.now??now;active=o.active??active;canLaunch=o.canLaunch??canLaunch;}};
}
test('faction manager wakes after completion and retains RAM failures for a bounded retry',async()=>{
 const h=await scheduler();await h.run();assert.equal(h.attempts,1);assert.equal(h.context.factionInviteWake,true);
 h.set({now:100500,canLaunch:true});await h.run();assert.equal(h.attempts,1);
 h.set({now:101000});await h.run();assert.equal(h.attempts,2);assert.equal(h.context.factionInviteWake,false);
 h.set({now:102000});await h.run();assert.equal(h.attempts,2);
});
test('an in-flight faction manager cannot consume a completion it may have missed',async()=>{
 const h=await scheduler();h.set({active:true,canLaunch:true});await h.run();assert.equal(h.attempts,0);assert.equal(h.context.factionInviteWake,true);
 h.set({active:false,now:101000});await h.run();assert.equal(h.attempts,1);
});
test('startup and main loop root faction servers before ordinary target processing',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.match(s,/await prioritizeFactionRooting\(ns\);\s*\/\/ Immediately crack all servers/);
 assert.match(s,/await prioritizeFactionRooting\(ns\);\s*\/\/ Run some auxilliary/);
 assert.match(s,/_cachedPlayerInfo.factions.length > 0 \|\| getPlayerMoney\(ns\) > 1e9 \|\| factionInviteWake/);
 assert.equal((s.match(/let factionCompletionState/g)||[]).length,1);
});
