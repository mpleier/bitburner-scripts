import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {observeFactionMembership,acknowledgeFactionMembership} from '../faction-reassessment-policy.js';

test('membership comparison ignores ordering and duplicates but detects same-count changes',()=>{
 const s=observeFactionMembership(null,['NiteSec','CyberSec']);assert.equal(s.changed,false);
 assert.equal(observeFactionMembership(s,['CyberSec','NiteSec','CyberSec']).changed,false);
 const changed=observeFactionMembership(s,['CyberSec','BitRunners']);assert.equal(changed.changed,true);assert.deepEqual(changed.added,['BitRunners']);
});
test('membership changes stay latched through snapshots until the planner acknowledges them',()=>{
 let s=observeFactionMembership(null,['CyberSec']);s=observeFactionMembership(s,['CyberSec','NiteSec']);
 s=observeFactionMembership(s,['CyberSec','NiteSec']);assert.equal(s.changed,true);
 s=observeFactionMembership(s,['CyberSec']);assert.equal(s.changed,true);
 s=acknowledgeFactionMembership(s);assert.equal(s.changed,false);
 assert.equal(observeFactionMembership(s,['CyberSec']).changed,false);
 assert.equal(observeFactionMembership(s,null),s);
});
async function harness(){
 const source=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');
 let now=100000,names=['CyberSec'],failed=false,blocked=false;const calls=[],logs=[];
 const ns={getScriptName:()=> 'work-for-factions.js',print:s=>logs.push(s)};
 const context={Date:{now:()=>now},observeFactionMembership,acknowledgeFactionMembership,isScriptPaused:()=>blocked,
  maintenanceRequested:()=>false,activityBusy:()=>false,automationHeartbeat(){},ns,
  getNsDataThroughFile:async(ns,expression)=>{calls.push(expression);if(failed)throw Error('No worker RAM');return expression.includes('getResetInfo')?{currentNode:9}:expression==='ns.getPlayer()'?{factions:[...names]}:[...names];}};
 const stripped=source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
 const begin=source.indexOf('async function mainLoop(ns) {'),end=source.indexOf('    // Immediately accept any outstanding faction invitations',begin);
 const assessment=source.slice(begin,end).replace('async function mainLoop','async function assessMembershipOnly')+'}';
 vm.runInNewContext(stripped+';'+assessment+`;activeNs=ns;mainLoopStart=Date.now();scope=5;numJoinedFactions=1;
 factionMembershipState=observeFactionMembership(null,['CyberSec']);lastMembershipProbeAt=Date.now();
 globalThis.h={probe:checkFactionMembership,player:getPlayerInfo,breaks:breakToMainLoop,assess:assessMembershipOnly,
 state:()=>factionMembershipState,scope:()=>scope};`,context);
 return{ns,logs,calls,h:context.h,set:o=>{now=o.now??now;names=o.names??names;failed=o.failed??failed;blocked=o.blocked??blocked;}};
}
test('reputation probes are throttled and new membership interrupts the ten-minute wait',async()=>{
 const x=await harness();assert.equal(await x.h.probe(x.ns),false);assert.equal(x.calls.length,0);
 x.set({now:105000,names:['CyberSec','NiteSec']});assert.equal(await x.h.probe(x.ns),true);assert.equal(x.h.breaks(),true);
 assert.deepEqual(x.calls,['ns.getPlayer().factions']);
 x.set({now:106000});assert.equal(await x.h.probe(x.ns),true);assert.equal(x.calls.length,1);
});
test('existing player snapshots detect changes without a separate probe',async()=>{
 const x=await harness();x.set({now:101000,names:['CyberSec','NiteSec']});await x.h.player(x.ns);
 assert.equal(x.h.breaks(),true);assert.equal(await x.h.probe(x.ns),true);assert.deepEqual(x.calls,['ns.getPlayer()']);
});
test('membership probe failures preserve ongoing work, warn once and retry after the cooldown',async()=>{
 const x=await harness();x.set({now:105000,failed:true});assert.equal(await x.h.probe(x.ns),false);
 x.set({now:110000});assert.equal(await x.h.probe(x.ns),false);assert.equal(x.logs.length,1);
 x.set({now:115000,failed:false,names:['CyberSec','NiteSec']});assert.equal(await x.h.probe(x.ns),true);
});
test('paused work yields without launching a membership query',async()=>{
 const x=await harness();x.set({now:105000,blocked:true});assert.equal(await x.h.probe(x.ns),true);assert.deepEqual(x.calls,[]);
});
test('actual planner prefix resets scope, acknowledges membership and reports the new priority level',async()=>{
 const x=await harness();x.set({now:105000,names:['CyberSec','NiteSec']});await x.h.probe(x.ns);
 await x.h.assess(x.ns);assert.equal(x.h.scope(),1);assert.equal(x.h.state().changed,false);assert.equal(x.h.breaks(),false);
 assert.ok(x.logs.some(s=>s.includes('priority level: 1')));
});
test('actual reputation-loop guard yields before assigning work when membership changes',async()=>{
 const source=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');
 const begin=source.indexOf('        if (await checkFactionMembership(ns) || breakToMainLoop())');
 const end=source.indexOf('        const currentWork',begin);assert.ok(begin>0&&end>begin);
 let assigned=0;const messages=[];
 const execute=new Function('checkFactionMembership','breakToMainLoop','assign','return async ns=>{'+source.slice(begin,end)+'assign();}');
 await execute(async()=>true,()=>false,()=>assigned++)({print:s=>messages.push(s)});
 assert.equal(assigned,0);assert.equal(messages.length,1);
});
test('explicit crime-focus boundaries and first/skip priorities remain in the existing planner',async()=>{
 const source=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');
 assert.match(source,/if \(!forever && breakToMainLoop\(\)\)/);
 assert.match(source,/firstFactions = \(options\['first'\]/);assert.match(source,/options.skip =/);
 assert.doesNotMatch(source,/ns.getPlayer\(\).factions;/);
});
