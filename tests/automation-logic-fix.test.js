import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNodeRoute,restoreNodeProbe} from '../node-route-selection-policy.js';
import {recoveryDecision,registerAutomation,beginAutomationAction,endAutomationAction} from '../runtime-policy.js';
import {claimSpending} from '../spending-policy.js';
const now=1000000,reset={lastNodeReset:1,lastAugReset:2};
test('persisted probe budget survives restart and a missing-snapshot fallback without extending deadlines',()=>{
 const options={now,node:11,nodeReset:1,augReset:2,availability:{hacking:true,bladeburner:true},milestones:{bladeburner:{name:'op',etaMs:60000}}};
 const first=chooseNodeRoute({},null,options),record={nodeReset:1,augReset:2,at:now,probe:first.probe};
 const restored=restoreNodeProbe(JSON.stringify(record),reset,now+30000);assert.ok(restored);
 const resumed=chooseNodeRoute({},null,{...options,now:now+30000,probeState:restored});assert.equal(resumed.probe.until,first.probe.until);
 const fallback=chooseNodeRoute({},null,{...options,now:now+60000,milestones:{},probeState:restored});assert.equal(fallback.probe.status,'cooldown');assert.equal(fallback.probe.cooldownUntil,first.probe.cooldownUntil);
 const saved={...record,at:now+60000,probe:fallback.probe};assert.ok(restoreNodeProbe(saved,reset,now+90000));
 assert.equal(chooseNodeRoute({},null,{...options,now:now+90000,probeState:restoreNodeProbe(saved,reset,now+90000)}).policy,'bn-default');
 assert.equal(restoreNodeProbe(record,{...reset,lastAugReset:3},now),null);
 assert.equal(restoreNodeProbe(record,reset,first.probe.cooldownUntil+1),null);
});
test('native action protection expires and rejects the wrong controller, owner or unbounded deadline',()=>{
 const action={kind:'darknet-authenticate',startedAt:1000,expectedMs:300000,deadline:1021000};
 const input={script:'darknet-manager.js',pid:7,record:{pid:7,script:'darknet-manager.js',signature:'old',startedAt:1,at:1000,action},signature:'new',observedAt:1,now:400000};
 assert.equal(recoveryDecision(input),'busy-native');
 assert.equal(recoveryDecision({...input,now:1021001}),'reload');
 assert.equal(recoveryDecision({...input,pid:8}),'reload');
 assert.equal(recoveryDecision({...input,record:{...input.record,action:{...action,deadline:Infinity}}}),'reload');
 assert.equal(recoveryDecision({...input,script:'sleeve.js'}),'reload');
});
test('native action receipts are cleared on completion',()=>{
 const files=new Map(),ns={pid:12345,getScriptName:()=> 'darknet-manager.js',read:()=>'',write:(f,v)=>files.set(f,v)};
 registerAutomation(ns);assert.equal(beginAutomationAction(ns,'darknet-authenticate',300000),true);
 assert.equal(JSON.parse(files.get('tasks/runtime/12345.json')).action.expectedMs,300000);
 endAutomationAction(ns);assert.equal(JSON.parse(files.get('tasks/runtime/12345.json')).action,undefined);
});
test('stale managed budgets block optional purchases while standalone and capped bootstrap remain possible',()=>{
 const files=new Map(),processes=[{pid:1,filename:'autopilot.js'}];let ram=64;
 const ns={read:f=>files.get(f)||'',write:(f,v)=>files.set(f,v),getResetInfo:()=>reset,getPlayer:()=>({money:1000}),ps:()=>processes,getServerMaxRam:()=>ram};
 assert.equal(claimSpending(ns,'gang',1),false);
 assert.equal(claimSpending(ns,'home',300),true);assert.equal(claimSpending(ns,'home',300),false);
 ram=128;assert.equal(claimSpending(ns,'home',1),false);
 processes.length=0;assert.equal(claimSpending(ns,'gang',1),true);
 files.set('tasks/spending-plan.json',JSON.stringify({managed:true,expiresAt:1}));assert.equal(claimSpending(ns,'gang',1),false);
 files.set('spending-standalone.txt','true');assert.equal(claimSpending(ns,'gang',1),true);
 files.set('reserve.txt','1000');assert.equal(claimSpending(ns,'gang',1),false);
});
