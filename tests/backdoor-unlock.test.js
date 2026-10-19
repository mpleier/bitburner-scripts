import {backgroundJobDue,backgroundJobDispatched} from '../background-job-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {factionBackdoorServers,observeBackdoorUnlocks,acknowledgeBackdoorUnlocks} from '../backdoor-unlock-policy.js';
import {infrastructureCashBand,infrastructureAffordable,torProgramsHandoff} from '../early-game-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
const csec=(extra={})=>({name:'CSEC',requiredHackLevel:50,hasAdminRights:true,backdoorInstalled:false,...extra});
test('hacking eligibility wakes at the exact requirement and remains pending until dispatched',()=>{
 let s=observeBackdoorUnlocks(null,[csec()],49,reset);assert.deepEqual(s.pending,[]);
 s=observeBackdoorUnlocks(s,[csec()],50,reset);assert.deepEqual(s.pending,['CSEC']);
 s=observeBackdoorUnlocks(s,[csec()],51,reset);assert.deepEqual(s.pending,['CSEC']);
 s=acknowledgeBackdoorUnlocks(s,s.pending);assert.deepEqual(observeBackdoorUnlocks(s,[csec()],52,reset).pending,[]);
});
test('root acquisition wakes eligible factions while unavailable or installed hosts do not',()=>{
 const s=observeBackdoorUnlocks(null,[csec({hasAdminRights:false})],100,reset);assert.deepEqual(s.pending,[]);
 assert.deepEqual(observeBackdoorUnlocks(s,[csec()],100,reset).pending,['CSEC']);
 for(const target of [csec({backdoorInstalled:true}),csec({name:'n00dles'}),csec({requiredHackLevel:NaN})])assert.deepEqual(observeBackdoorUnlocks(null,[target],100,reset).pending,[]);
});
test('unlock state is reset-scoped and acknowledgments cannot suppress unrelated targets',()=>{
 let s=observeBackdoorUnlocks(null,[csec(),csec({name:'avmnite-02h'})],100,reset);
 s=acknowledgeBackdoorUnlocks(s,['CSEC','n00dles']);assert.deepEqual(s.pending,['avmnite-02h']);
 assert.deepEqual(observeBackdoorUnlocks(s,[csec()],100,{...reset,lastAugReset:3}).pending,['CSEC']);
 assert.deepEqual(observeBackdoorUnlocks(s,[csec()],100,{...reset,lastNodeReset:4}).pending,['CSEC']);
});
test('pending work survives temporary loss of eligibility without acknowledging a launch',()=>{
 let s=observeBackdoorUnlocks(null,[csec()],50,reset);s=observeBackdoorUnlocks(s,[csec()],49,reset);assert.deepEqual(s.pending,[]);
 assert.deepEqual(observeBackdoorUnlocks(s,[csec()],50,reset).pending,['CSEC']);
});
async function scheduler(){
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),a=s.indexOf('    async function runPeriodicScripts('),b=s.indexOf('    async function tryRunTool(',a),body=s.slice(a,b);
 let now=100000,hacking=49,root=true,active=false,canLaunch=true,attempts=0;
 const script={name:'/Tasks/backdoor-all-servers.js',backdoorUnlocks:true,interval:33000,lastRun:99500};
 const context={backgroundJobDue,backgroundJobDispatched,periodicScripts:[script],resetInfo:reset,factionBackdoorState:null,factionBackdoorServers,observeBackdoorUnlocks,acknowledgeBackdoorUnlocks,
  infrastructureCashBand,infrastructureAffordable,torProgramsHandoff,Date:{now:()=>now},dictSourceFiles:{4:3},options:{},dictInitialServerInfos:{CSEC:{backdoorInstalled:false}},
  getAllServers:()=>[{name:'CSEC',requiredHackLevel:50}],playerHackSkill:()=>hacking,getPlayerMoney:()=>0,
  getTool:s=>s,whichServerIsRunning:()=>active?['home',77]:[null,null],tryRunTool:async()=>{attempts++;return canLaunch;}};
 const ns={hasRootAccess:()=>root,read:()=>'',sleep:async()=>{}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.execute=runPeriodicScripts;',context);
 return{run:()=>context.execute(ns),context,script,get attempts(){return attempts;},set:o=>{now=o.now??now;hacking=o.hacking??hacking;root=o.root??root;active=o.active??active;canLaunch=o.canLaunch??canLaunch;}};
}
test('actual scheduler reacts to a hacking unlock after the one-second cooldown rather than 33 seconds',async()=>{
 const h=await scheduler();await h.run();assert.equal(h.attempts,0);
 h.set({hacking:50,now:100100});await h.run();assert.equal(h.attempts,0);
 h.set({now:100500});await h.run();assert.equal(h.attempts,1);assert.deepEqual([...h.context.factionBackdoorState.pending],[]);
 h.set({now:101500,hacking:51});await h.run();assert.equal(h.attempts,1);
});
test('actual scheduler reacts to root acquisition and retains RAM failures for bounded retries',async()=>{
 const h=await scheduler();h.set({hacking:50,root:false,now:100500});await h.run();assert.equal(h.attempts,0);
 h.set({root:true,canLaunch:false});await h.run();assert.equal(h.attempts,1);assert.deepEqual([...h.context.factionBackdoorState.pending],['CSEC']);
 h.set({now:101000,canLaunch:true});await h.run();assert.equal(h.attempts,1);
 h.set({now:101500});await h.run();assert.equal(h.attempts,2);assert.deepEqual([...h.context.factionBackdoorState.pending],[]);
});
test('an in-flight manager cannot consume an unlock it may not have scanned',async()=>{
 const h=await scheduler();h.set({hacking:50,now:100500,active:true});await h.run();assert.equal(h.attempts,0);assert.deepEqual([...h.context.factionBackdoorState.pending],['CSEC']);
 h.set({now:101500,active:false});await h.run();assert.equal(h.attempts,1);
});
test('ordinary interval remains a retry path after an unlock was dispatched',async()=>{
 const h=await scheduler();h.set({hacking:50,now:100500});await h.run();assert.equal(h.attempts,1);
 h.set({now:134501});await h.run();assert.equal(h.attempts,2);
});
test('daemon unlock state shares controller scope and keeps native launch guards',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.ok(s.indexOf('let factionBackdoorState = null;')<s.indexOf('    async function startup('));
 assert.equal((s.match(/let factionBackdoorState/g)||[]).length,1);
 assert.match(s,/backdoorUnlocks: true, shouldRun: \(\) => 4 in dictSourceFiles/);
 assert.match(s,/await tryRunTool\(ns, tool\)/);
});
