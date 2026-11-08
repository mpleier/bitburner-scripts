import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startupControllerTick,main} from '../bootstrap-start.js';
import {coreStartupReservation,reclaimStartupHelpers} from '../core-startup-policy.js';
function fixture({maximum=128,used=8,paused=[]}={}){
 const files=new Map(paused.map(s=>['remote-control/paused/'+s+'.txt','true'])),processes=[{pid:1,filename:'bootstrap-start.js'}],launches=[];
 const ram={'bootstrap-start.js':8,'autopilot.js':50.1,'reliability-manager.js':19.75,'daemon.js':69.2};
 let nativeUsed=used,next=2;
 const ns={pid:1,read:f=>files.get(f)||'',getResetInfo:()=>({lastNodeReset:100,lastAugReset:200}),ps:()=>processes.slice(),
  kill:pid=>{const i=processes.findIndex(p=>p.pid===pid);if(i<0)return false;nativeUsed-=ram[processes[i].filename]||0;processes.splice(i,1);return true;},isRunning:pid=>processes.some(p=>p.pid===pid),getServerMaxRam:()=>maximum,getServerUsedRam:()=>nativeUsed,getScriptRam:s=>ram[s]||0,
  run:s=>{launches.push(s);if(nativeUsed+ram[s]>maximum)return 0;nativeUsed+=ram[s];const pid=next++;processes.push({pid,filename:s});return pid;},
  write:async(f,s)=>files.set(f,s),disableLog:()=>{},print:()=>{}};
 return {ns,files,processes,launches,setUsed:v=>nativeUsed=v,ram};
}
test('post-reset recovery launches autopilot before supervisor and never starts daemon first',async()=>{
 const f=fixture();const first=await startupControllerTick(f.ns);assert.equal(first.controllers[0].state,'starting');
 assert.deepEqual(f.launches,['autopilot.js']);await startupControllerTick(f.ns);assert.deepEqual(f.launches,['autopilot.js','reliability-manager.js']);
 assert.equal((await startupControllerTick(f.ns)).state,'monitoring');assert.equal(f.launches.length,2);
});
test('insufficient RAM retains recovery and retries after native capacity changes',async()=>{
 const f=fixture({used:100.4});assert.equal((await startupControllerTick(f.ns)).controllers[0].state,'waiting-for-ram');assert.deepEqual(f.launches,[]);
 f.setUsed(8);await startupControllerTick(f.ns);assert.deepEqual(f.launches,['autopilot.js']);
});
test('core controller exit is recovered and duplicate launches are avoided',async()=>{
 const f=fixture();await startupControllerTick(f.ns);await startupControllerTick(f.ns);f.processes.splice(1,1);f.setUsed(27.75);
 await startupControllerTick(f.ns);assert.deepEqual(f.launches,['autopilot.js','reliability-manager.js','autopilot.js']);
});
test('explicit pauses, live transitions and activity locks are respected',async()=>{
 const f=fixture({paused:['autopilot.js']});await startupControllerTick(f.ns);assert.deepEqual(f.launches,['reliability-manager.js']);
 for(const file of ['tasks/automation-maintenance.json','tasks/activity-lock.json','tasks/progression-transition.json']){
  const g=fixture();g.processes.push({pid:99,filename:'test-owner.js'});g.files.set(file,JSON.stringify({ownerPid:99,expiresAt:Date.now()+10000}));assert.equal((await startupControllerTick(g.ns)).state,'protected-activity');assert.deepEqual(g.launches,[]);
 }
 const g=fixture();g.processes.push({pid:99,filename:'casino.js'});assert.equal((await startupControllerTick(g.ns)).state,'protected-activity');
});
test('optional launches reserve absent controllers; paused and running controllers cost nothing extra',()=>{
 const f=fixture();assert.equal(coreStartupReservation(f.ns,'health-manager.js'),69.85);
 assert.equal(coreStartupReservation(f.ns,'bootstrap-start.js'),0);
 f.processes.push({pid:2,filename:'autopilot.js'});assert.equal(coreStartupReservation(f.ns,'daemon.js'),19.75);
 f.files.set('remote-control/paused/reliability-manager.js.txt','true');assert.equal(coreStartupReservation(f.ns,'daemon.js'),0);
 assert.equal(coreStartupReservation(fixture({maximum:32}).ns,'health-manager.js'),0);
});
test('the recovery process stays resident after a successful handoff',async()=>{
 const f=fixture(),stop=new Error('stop'),snapshots=[];let loops=0;
 f.ns.sleep=async()=>{snapshots.push(f.launches.slice());if(++loops===4)throw stop;};
 await assert.rejects(main(f.ns),e=>e===stop);
 assert.equal(snapshots.length,4);assert.equal(JSON.parse(f.files.get('tasks/bootstrap-start.json')).state,'monitoring');
});
test('both native callback paths and launcher gates retain the restart controller',()=>{
 const auto=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),daemon=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');
 assert.match(auto,/coreStartupReservation\(ns,baseScriptName\)/);assert.match(daemon,/coreStartupReservation\(ns,tool.name\)/);
 assert.ok(daemon.indexOf('name: "bootstrap-start.js"')<daemon.indexOf('name: "autopilot.js"'));
 assert.match(auto,/\[nextBn, getFilePath\('bootstrap-start.js'\)\]/);
 assert.match(readFileSync(new URL('../ascend.js',import.meta.url),'utf8'),/getFilePath\('bootstrap-start.js'\)/);
});

test('critical recovery reclaims optional helpers without killing controllers or focus actions',()=>{
 const f=fixture({used:120});f.ram['hacknet-upgrade-manager.js']=13;f.ram['health-manager.js']=6;
 f.processes.push({pid:7,filename:'hacknet-upgrade-manager.js'},{pid:8,filename:'health-manager.js'},{pid:9,filename:'grafting-manager.js'},{pid:10,filename:'Remote/weak-target.js'});
 assert.equal(reclaimStartupHelpers(f.ns,20),true);
 assert.deepEqual(f.processes.map(p=>p.pid),[1,8,9,10]);
 assert.equal(reclaimStartupHelpers(f.ns,30),false);
 assert.deepEqual(f.processes.map(p=>p.pid),[1,9,10]);
});

test('autopilot restores the recovery controller before casino early returns after a reload',()=>{
 const s=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');
 const guard=s.indexOf("if(startUpRan&&!ns.ps('home').some(p=>p.filename.replace");
 assert.ok(guard>s.indexOf('if (!startUpRan) startUpRan = await startUp(ns);'));
 assert.ok(guard<s.indexOf('keepRunning = await mainLoop(ns);'));
});
