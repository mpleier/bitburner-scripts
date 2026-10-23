import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createXpCapacityRecord} from '../xp-capacity-policy.js';
import {observeHackingRecovery,hackingRecoveryQuote} from '../hacking-recovery-policy.js';
import {progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
const minute=60000,reset={lastNodeReset:1,lastAugReset:2};
function snapshot(r,at,level=100,ownerPid=7,extra={}){
 const xpCapacity=createXpCapacityRecord({ownerPid,reset:r,now:at,mode:'xp',config:['--xp-only'],targets:['n00dles'],hosts:[{host:'home',maxRam:64,usableRam:32,cores:1}],workers:[{owner:ownerPid,pid:ownerPid+1,loop:true,host:'home',tool:'weaken',target:'n00dles',threads:8}]});
 return {nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at,hacking:level,hackMult:1,xpMultiplier:1,xpMode:'xp',xpCapacity,...extra};
}
const route=(r,at,selected='hacking')=>({nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at,selected});
const observe=(saved,r,at,level=100,extra={})=>observeHackingRecovery(saved,{reset:r,now:at,snapshot:snapshot(r,at,level),route:route(r,at),...extra});
function completed(){
 const before=observe(null,reset,100000),next={...reset,lastAugReset:100001};
 let state=observe(before,next,110000,2);state=observe(state,next,160001,100);
 return {state,next};
}

test('recovery capacity ignores daemon replacement while retaining mode hardware targets and workers',()=>{
 const a=snapshot(reset,1000),b=snapshot(reset,1000,100,70);
 assert.notEqual(a.xpCapacity.signature,b.xpCapacity.signature);
 assert.equal(a.xpCapacity.recoverySignature,b.xpCapacity.recoverySignature);
 const other=createXpCapacityRecord({ownerPid:7,reset,now:1000,mode:'income',hosts:[{host:'home',maxRam:64,usableRam:32,cores:1}]});
 assert.notEqual(a.xpCapacity.recoverySignature,other.recoverySignature);
});

test('only fresh same-node hacking baselines arm recovery across ordinary installs',()=>{
 const before=observe(null,reset,100000),next={...reset,lastAugReset:100001};
 assert.equal(observe(before,next,110000,2).recovering,true);
 for(const saved of [{...before,at:1},{...before,nodeReset:9},{...before,baseline:null}])assert.equal(observe(saved,next,110000,2).recovering,false);
 assert.equal(observe(null,reset,100000,100,{route:route(reset,100000,'bladeburner')}).baseline,null);
 assert.equal(observe(null,reset,100000,100,{snapshot:snapshot(reset,1)}).baseline,null);
});

test('reaching the previous hacking level records wall time once and survives owner changes',()=>{
 const before=observe(null,reset,100000),next={...reset,lastAugReset:100001};
 let state=observe(before,next,110000,20,{snapshot:snapshot(next,110000,20,70)});
 state=observe(state,next,160001,100,{snapshot:snapshot(next,160001,100,70)});
 assert.equal(state.recovering,false);assert.equal(state.samples.length,1);assert.equal(state.samples[0].durationMs,60000);
 assert.equal(observe(state,next,170001).samples.length,1);
});

test('changed route mode capacity and observation gaps cannot create fast recovery samples',()=>{
 const before=observe(null,reset,100000),next={...reset,lastAugReset:100001},pending=observe(before,next,110000,2);
 const changed=snapshot(next,120000,100);changed.xpCapacity.recoverySignature='xp-recovery-v1:aa:bb:1';
 for(const extra of [{route:route(next,120000,'bladeburner')},{snapshot:snapshot(next,120000,100,7,{xpMode:'income'})},{snapshot:changed}]){
  const state=observe(pending,next,120000,100,extra);assert.equal(state.recovering,false);assert.equal(state.samples.length,0);
 }
 assert.equal(observe(pending,next,210001,100).samples.length,0);
 const stale=observe(pending,next,120000,100,{snapshot:snapshot(next,1,100)});assert.equal(stale.recovering,true);assert.equal(stale.samples.length,0);
});

test('only comparable level capacity mode and multipliers can shorten the fallback',()=>{
 const {state,next}=completed(),quote=r=>hackingRecoveryQuote(r,{nodeReset:1,augReset:next.lastAugReset,now:170000});
 assert.equal(quote(state).durationMs,minute);assert.match(quote(state).basis,/Measured/);
 for(const baseline of [{...state.baseline,targetLevel:101},{...state.baseline,capacity:'xp-recovery-v1:aa:bb:1'},{...state.baseline,mode:'income'},{...state.baseline,hackMult:.9},{...state.baseline,xpMultiplier:.9},null])
  assert.equal(quote({...state,baseline}).durationMs,15*minute);
 assert.equal(quote({...state,baseline:{...state.baseline,targetLevel:90,hackMult:2,xpMultiplier:2}}).durationMs,minute);
});

test('temporary stronger multipliers cannot create a fast quote for a weaker future run',()=>{
 const before=observe(null,reset,100000),next={...reset,lastAugReset:100001};
 let state=observe(before,next,110000,20,{snapshot:snapshot(next,110000,20,7,{hackMult:2,xpMultiplier:3})});
 state=observe(state,next,160001,100);
 assert.equal(state.samples[0].hackMult,2);assert.equal(state.samples[0].xpMultiplier,3);
 assert.equal(hackingRecoveryQuote(state,{nodeReset:1,augReset:next.lastAugReset,now:170000}).durationMs,15*minute);
});

test('stale cross-reset future malformed and expired evidence falls back safely',()=>{
 const {state,next}=completed(),args={nodeReset:1,augReset:next.lastAugReset,now:170000};
 for(const r of [{...state,at:1},{...state,at:170001},{...state,nodeReset:9},{...state,augReset:9},{...state,samples:[{...state.samples[0],durationMs:NaN}]},{...state,samples:[{...state.samples[0],finishedAt:170001}]}])
  assert.equal(hackingRecoveryQuote(r,args).durationMs,15*minute);
 const expired=observe(state,next,26*minute);assert.equal(expired.samples.length,1);
 const old=observe(state,next,26*60*60*1000);assert.equal(old.samples.length,0);
});

test('pending recovery blocks ordinary resets and measured quotes feed hacking economics only',()=>{
 const {state,next}=completed(),now=170000;
 const s={at:now,augReset:next.lastAugReset,worth:1e9,ready:[{name:'Aug',stats:{hacking:2}}],targets:[],resetEconomics:{known:true,replacementCost:0}};
 const run=extra=>progressionSpeed({snapshot:s,now,augReset:next.lastAugReset,nodeReset:1,hackingRecovery:state,homeRam:128,...extra});
 assert.equal(run().recoveryMs,minute);assert.match(run().recoveryBasis,/Measured/);
 assert.equal(run({combat:true}).recoveryMs,20*minute);
 const blocked=run({hackingRecovery:{...state,recovering:true}});assert.equal(blocked.recoveryBlocked,true);
 assert.equal(augmentationResetDecision({requested:true,speed:blocked}).allowed,false);
});

test('actual autopilot observes the existing snapshot and feeds persistent recovery into reset planning',()=>{
 const source=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(source,/observeHackingRecovery\(hackingRecovery,\{reset:resetInfo,route:routePlan,snapshot:s,now:Date.now\(\)\}\)/);
 assert.match(source,/ns.write\('tasks\/hacking-recovery.json'/);
 assert.match(source,/firstBn9:inFirstBn9Aug,hackingRecovery,combatRecovery,nodeReset:/);
});
