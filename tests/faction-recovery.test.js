import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeFactionRecovery,factionRecoveryDelays} from '../faction-recovery-policy.js';
import {augmentationReputationForecast} from '../augmentation-reputation-policy.js';
import {estimateMixedAugmentationWait,progressionSpeed} from '../progression-speed-policy.js';
const minute=60000,hour=60*minute,r={lastNodeReset:1,lastAugReset:2};
function args(reset,at,{joined=true,working=true,rate=10,workType='hacking',multiplier=1,favor=10,...extra}={}){
 return {reset,now:at,rates:working&&joined?{A:rate}:{},snapshot:{nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at,
  reputation:joined?{A:0}:{},workFaction:working&&joined?'A':null,workType:working?workType:null,repMultiplier:multiplier,factionFavor:joined?{A:favor}:{},...extra}};
}
function completed(){
 const next={...r,lastAugReset:100001};let state=observeFactionRecovery(null,args(r,100000));
 state=observeFactionRecovery(state,args(next,130001,{joined:false,working:false}));
 state=observeFactionRecovery(state,args(next,160001,{working:false}));
 state=observeFactionRecovery(state,args(next,190001,{rate:8}));
 state=observeFactionRecovery(state,args(next,220001));
 return {state,next};
}

test('ordinary installs separately measure joined membership and restored work rate once',()=>{
 const {state,next}=completed();assert.equal(state.pending,null);assert.equal(state.samples.length,1);
 assert.equal(state.samples[0].joinedMs,minute);assert.equal(state.samples[0].workMs,2*minute);
 assert.equal(observeFactionRecovery(state,args(next,250001)).samples.length,1);
});

test('invitations do not imply membership and partial rejoining remains useful after work changes',()=>{
 const next={...r,lastAugReset:100001};let s=observeFactionRecovery(null,args(r,100000));
 s=observeFactionRecovery(s,args(next,130001,{joined:false,working:false,invitations:['A']}));assert.equal(s.samples.length,0);
 s=observeFactionRecovery(s,args(next,160001,{working:false}));assert.equal(s.samples[0].workMs,null);
 s=observeFactionRecovery(s,args(next,190001,{workFaction:'B'}));assert.equal(s.pending,null);
 const delays=factionRecoveryDelays(s,{...args(next,190001),snapshot:{...args(next,190001).snapshot,workFaction:'B'}});
 assert.equal(delays.A.joinedMs,minute);assert.equal(delays.A.workMs,null);
});

test('stale cross-node wrong-work and interrupted observations cannot create fast work samples',()=>{
 const b=observeFactionRecovery(null,args(r,100000)),next={...r,lastAugReset:100001};
 const pending=observeFactionRecovery(b,args(next,130001,{joined:false,working:false}));
 assert.equal(observeFactionRecovery(pending,args(next,260002)).samples.length,0);
 const changed=observeFactionRecovery(pending,args(next,160001,{workType:'field'}));assert.equal(changed.pending,null);assert.equal(changed.samples[0].workMs,null);
 assert.equal(observeFactionRecovery(b,args({...next,lastNodeReset:3},130001)).pending,null);
 const stale=observeFactionRecovery(b,{...args(next,200002),snapshot:args(next,100001).snapshot});assert.equal(stale,b);
});

test('reuse needs comparable faction rate work type favor and strongest observed multiplier',()=>{
 const {state,next}=completed(),base=args(next,220001);
 assert.deepEqual(factionRecoveryDelays(state,base).A,{joinedMs:minute,workMs:2*minute});
 const harder=args(next,220001,{rate:11});assert.equal(factionRecoveryDelays(state,harder).A.workMs,null);
 const other=args(next,220001,{workType:'field'});assert.equal(factionRecoveryDelays(state,other).A.workMs,null);
 for(const patch of [{multiplier:.5},{favor:9}])assert.deepEqual(factionRecoveryDelays(state,args(next,220001,patch)),{});
 assert.deepEqual(factionRecoveryDelays(state,{...base,now:220001+24*hour}),{});
});

test('temporary stronger conditions cannot leak a fast result to a weaker forecast',()=>{
 const next={...r,lastAugReset:100001};let s=observeFactionRecovery(null,args(r,100000));
 s=observeFactionRecovery(s,args(next,130001,{rate:5,multiplier:2,favor:20}));
 s=observeFactionRecovery(s,args(next,160001));
 assert.equal(s.samples[0].multiplier,2);assert.equal(s.samples[0].favor,20);
 assert.deepEqual(factionRecoveryDelays(s,args(next,160001)),{});
});

const target={name:'Useful',useful:true,cost:0,requirements:[{rep:10800,factions:['A'],providers:[{faction:'A',canDonate:false,requiredDonation:null}]}]};
const ctx=extra=>({horizonMs:4*hour,worth:0,cashRate:100,factionCashRate:100,reputation:{A:0},repRates:{A:1},donationUnitCost:1000,targets:[target],...extra});
const forecast=c=>augmentationReputationForecast([{name:'Rep',stats:{faction_rep:1.2}}],c,estimateMixedAugmentationWait);
test('funding quotes charge only observed delay beyond the shared recovery allowance',()=>{
 const delayed=forecast(ctx({recoveryDelays:{A:{joinedMs:10*minute,workMs:40*minute}},recoveryAllowanceMs:20*minute}));
 assert.equal(delayed.factionRecoveryMs,40*minute);assert.equal(delayed.extraFactionRecoveryMs,20*minute);
 assert.equal(delayed.resetWithBoostMs,170*minute);assert.equal(delayed.netSavingsMs,10*minute);
 const overlap=forecast(ctx({recoveryDelays:{A:{joinedMs:10*minute,workMs:15*minute}},recoveryAllowanceMs:20*minute}));
 assert.equal(overlap.extraFactionRecoveryMs,0);assert.equal(overlap.netSavingsMs,30*minute);
});

test('donation plans pay rejoining delay and can replace a delayed work plan',()=>{
 const donated={...target,requirements:[{...target.requirements[0],providers:[{faction:'A',canDonate:true,requiredDonation:10800}]}]};
 const c=ctx({targets:[donated],donationUnitCost:100,cashRate:100,factionCashRate:100,recoveryDelays:{A:{joinedMs:minute,workMs:2*hour}}});
 const q=forecast(c);assert.equal(q.factionRecoveryMs,minute);assert.equal(q.extraFactionRecoveryMs,minute);
 assert.equal(q.resetWithBoostMs,151*minute);
});

test('progression observations persist faction recovery and publish the same allowance used for reset planning',()=>{
 const now=2e6,snapshot={...args(r,now).snapshot,worth:0,ready:[],targets:[],resetEconomics:{known:true,replacementCost:0}};
 const previous={at:now-minute,augReset:2,worth:0,workFaction:'A',workType:'hacking',reputation:{A:0},repRates:{A:10}};
 snapshot.reputation.A=600;
 const q=progressionSpeed({snapshot,previous,now,augReset:2,nodeReset:1});
 assert.equal(q.observation.factionRecovery.baseline.faction,'A');assert.equal(q.reputationPlanningContext.recoveryAllowanceMs,q.recoveryMs);
 const different=progressionSpeed({snapshot:{...snapshot,workType:'field'},previous,now,augReset:2,nodeReset:1});
 assert.deepEqual(different.observation.reputationWorkRates,{});
});

test('producer carries work identity and native favor without another native worker',()=>{
 const s=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.match(s,/workType:w\?\.factionWorkType/);assert.match(s,/repMultiplier:playerData.mults.faction_rep/);assert.match(s,/factionFavor:Object.fromEntries/);
});
