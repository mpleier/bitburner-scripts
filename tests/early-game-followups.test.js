import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {factionWorkerReady,infrastructureAffordable,infrastructureCashBand,publishInfrastructureCost,torProgramsHandoff} from '../early-game-policy.js';
import {main as bootstrap} from '../bootstrap-hacking.js';
const reset={lastAugReset:1,lastNodeReset:2};
test('readiness uses actual controller PID and reset identity, without a fixed startup delay',()=>{
 const record={pid:10,at:1000,augReset:1,nodeReset:2,state:'ready'};
 assert.equal(factionWorkerReady(record,{pid:10},reset,1001),true);
 for(const patch of [{pid:9},{augReset:0},{nodeReset:0},{state:'warming'},{at:2000}])assert.equal(factionWorkerReady({...record,...patch},{pid:10},reset,1001),false);
 assert.equal(factionWorkerReady(record,null,reset,1001),false);
});
test('affordability quotes protect reserves and fractional RAM budgets',()=>{
 const q={at:1000,augReset:1,nodeReset:2,cost:500000,budget:1};
 assert.equal(infrastructureAffordable(q,799999,300000,reset,1001),false);
 assert.equal(infrastructureAffordable(q,800000,300000,reset,1001),true);
 assert.equal(infrastructureAffordable({...q,budget:.5},999999,0,reset,1001),false);
 assert.equal(infrastructureAffordable({...q,budget:.5},1e6,0,reset,1001),true);
 for(const patch of [{at:2000},{at:-400000},{augReset:0},{nodeReset:0},{cost:null},{cost:Infinity}])assert.equal(infrastructureAffordable({...q,...patch},1e12,0,reset,1001),false);
});
test('one-shot cost publishing clears unavailable and completed purchase quotes',()=>{
 const files={},ns={getResetInfo:()=>reset,write:(f,s)=>files[f]=JSON.parse(s)};
 publishInfrastructureCost(ns,'tor',200000);assert.equal(files['tasks/infrastructure-tor.json'].cost,200000);
 publishInfrastructureCost(ns,'tor',null);assert.equal(files['tasks/infrastructure-tor.json'].cost,null);
});
async function scheduler(){
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');const a=s.indexOf('    async function runPeriodicScripts('),b=s.indexOf('    async function tryRunTool(',a),body=s.slice(a,b);
 let now=100000,money=749999;const launched=[],quote={at:100000,augReset:1,nodeReset:2,cost:750000,budget:1};
 const script={name:'programs',infrastructure:true,infrastructureKind:'programs',interval:26000,lastRun:99500,lastCashBand:2};
 const context={periodicScripts:[script],Date:{now:()=>now},resetInfo:reset,infrastructureCashBand,infrastructureAffordable,torProgramsHandoff,
  getPlayerMoney:()=>money,reservedMoney:()=>0,tryRunTool:async(ns,s)=>{launched.push(s.name);return true;},getTool:s=>s,dictSourceFiles:{},options:{}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.run=runPeriodicScripts;',context);
 const ns={read:f=>f.includes('infrastructure')?JSON.stringify(quote):'0',sleep:async()=>{}};
 return{run:()=>context.run(ns),launched,set:(cash,time)=>{money=cash;now=time;}};
}
test('exact cost wakeups fire within the same cash band and survive the retry cooldown',async()=>{
 const h=await scheduler();await h.run();assert.deepEqual(h.launched,[]);
 h.set(750000,100100);await h.run();assert.deepEqual(h.launched,[]);
 h.set(750000,100500);await h.run();assert.deepEqual(h.launched,['programs']);
 h.set(750000,101500);await h.run();assert.deepEqual(h.launched,['programs']);
});
function fixture({mode='hack',stop='owner'}={}){
 let active=true;const calls=[],files={};
 const server={hostname:'n00dles',hasAdminRights:false,numOpenPortsRequired:0,moneyMax:100,moneyAvailable:mode==='grow'?1:100,requiredHackingSkill:1,hackDifficulty:mode==='weaken'?10:1,minDifficulty:1};
 const perform=async name=>{calls.push(name);active=false;};
 const ns={args:[99],getScriptName:()=> 'bootstrap-hacking.js',read:f=>files[f]||'',getResetInfo:()=>reset,isRunning:()=>active,
  ps:()=>stop==='daemon'?[{filename:'daemon.js'}]:stop==='casino'?[{filename:'casino.js'}]:[],scan:h=>h==='home'?['n00dles']:['home'],getServer:()=>({...server}),hasRootAccess:()=>server.hasAdminRights,getServerNumPortsRequired:()=>server.numOpenPortsRequired,getServerRequiredHackingLevel:()=>server.requiredHackingSkill,getServerMaxMoney:()=>server.moneyMax,getServerMoneyAvailable:()=>server.moneyAvailable,getServerSecurityLevel:()=>server.hackDifficulty,getServerMinSecurityLevel:()=>server.minDifficulty,nuke:()=>{server.hasAdminRights=true;calls.push('root');},getHackingLevel:()=>1,getHackTime:()=>100,
  hack:()=>perform('hack'),grow:()=>perform('grow'),weaken:()=>perform('weaken'),sleep:async()=>{active=false;},print(){}};
 return{ns,calls,files};
}
test('small fallback roots free-port hosts and chooses hack, grow or weaken',async()=>{
 for(const mode of ['hack','grow','weaken']){const f=fixture({mode});await bootstrap(f.ns);assert.deepEqual(f.calls,['root',mode]);}
});
test('fallback respects ownership, pauses, maintenance and handoff to daemon or casino',async()=>{
 for(const stop of ['daemon','casino','owner','pause','maintenance']){
  const f=fixture({stop});
  if(stop==='owner')f.ns.isRunning=()=>false;
  if(stop==='pause')f.files['remote-control/paused/daemon.js.txt']='true';
  if(stop==='maintenance')f.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:100,expiresAt:Date.now()+10000});
  await bootstrap(f.ns);assert.deepEqual(f.calls,[],stop);
 }
});
test('fallback waits safely without accessible money targets',async()=>{
 const f=fixture();f.ns.getHackingLevel=()=>0;await bootstrap(f.ns);assert.deepEqual(f.calls,['root']);
});
test('autopilot readiness handoff and fallback replacement are wired to live state',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8'),daemon=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.match(s,/factionWorkerReady\(daemonReadiness,findScript\('daemon.js'\),resetInfo\)/);
 assert.doesNotMatch(s,/Date.now\(\) - daemonStartTime > 30000/);
 assert.match(s,/if\(fallback&&replaceable\)ns.kill\(fallback.pid\)/);
 assert.match(s,/launchScriptHelper\(ns,'bootstrap-hacking.js',\[ns.pid\]\)/);
 assert.ok(daemon.indexOf("state:'ready'")>daemon.indexOf('await kickstartHackXp(ns)'));
});
