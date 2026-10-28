import test from 'node:test';
import assert from 'node:assert/strict';
import {selectHackingTargetCandidates,planHackingTargets} from '../hacking-target-policy.js';
import {infiltrationEntryAllowed} from '../infiltration-solvers.js';

test('quick intermediate targets escape a top-income shortlist whose preparation cannot repay',()=>{
 const make=(name,time,ready=false)=>({name,time,isPrepped:()=>ready});
 const rows=[...Array.from({length:8},(_,i)=>make('large'+i,500000)),make('old',2000,true),make('bridge',15000),make('ready',40000,true)];
 const selected=selectHackingTargetCandidates(rows,'old',s=>s.time);
 assert.equal(selected[0].name,'old');assert.ok(selected.some(s=>s.name==='bridge'));assert.ok(selected.some(s=>s.name==='large0'));
 assert.equal(new Set(selected.map(s=>s.name)).size,selected.length);assert.ok(selected.length<=9);
 const quotes=selected.map(s=>({name:s.name,projectedRate:s.name==='old'?5000:1e6,weakMs:s.time,firstReceiptMs:s.time+4000,prepMs:s.name.startsWith('large')?2800000:30000}));
 let p=null;for(let i=0;i<=12;i++)p=planHackingTargets(p,{now:1000000+i*5000,ownerPid:1,reset:{lastNodeReset:2,lastAugReset:3},current:'old',candidates:quotes});
 assert.equal(p.decision,'switch');assert.ok(['bridge','ready'].includes(p.preferred));
});

test('candidate selection tolerates invalid timing and preserves the incumbent and bounded ranking',()=>{
 const rows=Array.from({length:20},(_,i)=>({name:'server'+i,isPrepped:()=>false}));
 const chosen=selectHackingTargetCandidates(rows,'server19',()=>{throw Error('unavailable');});
 assert.equal(chosen[0].name,'server19');assert.equal(chosen.length,9);assert.ok(chosen.some(s=>s.name==='server0'));
 assert.deepEqual(selectHackingTargetCandidates([],'missing',()=>0),[]);
});

test('serialized late-entry guard gives Bladeburner priority even with installed Simulacrum',()=>{
 const now=Date.now(),reset={lastNodeReset:2,lastAugReset:3};
 let route={selected:'bladeburner',simulacrum:true,at:now,ownerPid:9,nodeReset:2,augReset:3};
 const ns={read:f=>f==='tasks/node-route-plan.json'?JSON.stringify(route):f==='tasks/activity-lock.json'?JSON.stringify({ownerPid:1,expiresAt:now+10000}):'',getResetInfo:()=>reset,isRunning:pid=>[1,9].includes(pid),ps:()=>[{pid:9,filename:'autopilot.js'}]};
 const allowed=Function('return ('+infiltrationEntryAllowed.toString()+')')();
 assert.equal(allowed(ns,1,true),false);assert.equal(allowed(ns,1,false),true);
 route={...route,simulacrum:false};assert.equal(allowed(ns,1,true),false);
 for(const patch of [{selected:'hacking'},{at:now-50000},{ownerPid:8},{augReset:4},{nodeReset:4},{at:now+50000}]){
  const before=route;route={...route,...patch};assert.equal(allowed(ns,1,true),true);route=before;
 }
});
