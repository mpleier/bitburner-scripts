import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareAugmentationInstall,augmentationResetDecision,observeCombatRecovery,progressionSpeed} from '../progression-speed-policy.js';
import {augmentationSavingsTarget} from '../progression-improvements-policy.js';
const minute=60000;
const reset={lastNodeReset:1,lastAugReset:2};
const route=(r,now,safe=true,name='Op')=>({nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at:now,selected:'bladeburner',development:{nextBlackOp:{name,safe}}});
const profitable={resetPaysBack:true,paybackMs:30*minute,recoveryBlocked:false};

test('ordinary count and quick-install requests need positive bounded payback, even after the first BN9 reset',()=>{
 for(const speed of [undefined,{}, {resetPaysBack:false,paybackMs:minute},{resetPaysBack:true,paybackMs:null},{resetPaysBack:true,paybackMs:5*60*minute}])
  assert.equal(augmentationResetDecision({requested:true,speed}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable}).allowed,true);
 assert.equal(augmentationResetDecision({requested:false,speed:profitable}).allowed,false);
});

test('verified milestones and the explicit economics override retain their reset exceptions',()=>{
 for(const flag of ['priority','favor','countUnlock','campaign','bn8Quick'])
  assert.equal(augmentationResetDecision({requested:true,[flag]:true,speed:{resetPaysBack:false,recoveryBlocked:true}}).allowed,true,flag);
 assert.equal(augmentationResetDecision({requested:true,adaptive:false}).allowed,true);
});

test('ordinary resets wait for combat recovery and do not interrupt a faster completion route',()=>{
 assert.equal(augmentationResetDecision({requested:true,speed:{...profitable,recoveryBlocked:true}}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable,remainingMs:20*minute}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable,remainingMs:2*60*minute}).allowed,true);
});

test('combat recovery starts only after an install with a fresh same-node safe baseline',()=>{
 const before=observeCombatRecovery(null,{reset,route:route(reset,100000),now:100000});
 const nextReset={...reset,lastAugReset:100001};
 const after=observeCombatRecovery(before,{reset:nextReset,route:route(nextReset,115000,false),now:115000});
 assert.equal(after.recovering,true);assert.equal(after.recoveryTarget,'Op');assert.equal(after.startedAt,100001);
 for(const previous of [{...before,baselineSafe:false},{...before,at:1},{...before,nodeReset:9},{...before,at:200000}])
  assert.equal(observeCombatRecovery(previous,{reset:nextReset,route:route(nextReset,115000,false),now:115000}).recovering,false);
});

test('safe recovery is measured for the same BlackOp once, with a bounded history',()=>{
 const before=observeCombatRecovery(null,{reset,route:route(reset,100000),now:100000}),r={...reset,lastAugReset:100001};
 let state=observeCombatRecovery(before,{reset:r,route:route(r,115000,false),now:115000});
 state=observeCombatRecovery(state,{reset:r,route:route(r,160001,true),now:160001});
 assert.equal(state.recovering,false);assert.equal(state.samples.length,1);assert.equal(state.samples[0].durationMs,60000);
 state=observeCombatRecovery(state,{reset:r,route:route(r,170000,true),now:170000});
 assert.equal(state.samples.length,1);assert.equal(state.baselineSafe,true);
});

test('changed targets, route changes and long observation gaps cannot create falsely fast recovery samples',()=>{
 const before=observeCombatRecovery(null,{reset,route:route(reset,100000),now:100000}),r={...reset,lastAugReset:100001};
 const pending=observeCombatRecovery(before,{reset:r,route:route(r,115000,false),now:115000});
 for(const [now,next]of [[130000,route(r,130000,true,'Other')],[230000,route(r,230000,true)],[130000,{...route(r,130000),selected:'hacking'}]]){
  const result=observeCombatRecovery(pending,{reset:r,route:next,now});
  assert.equal(result.recovering,false);assert.equal(result.samples.length,0);
 }
 const stale=observeCombatRecovery(pending,{reset:r,route:route(r,100000,true),now:160000});
 assert.equal(stale.recovering,true);assert.equal(stale.samples.length,0);
});

function speed(stats={},extra={}){
 const now=2e6,snapshot={at:now,augReset:2,worth:1e9,ready:[{name:'Aug',stats}],targets:[],reputation:{},resetEconomics:{known:true,replacementCost:0,gangLossPerSecond:0}};
 return progressionSpeed({snapshot,now,augReset:2,nodeReset:1,combatTarget:'Op',combat:true,homeRam:1024,...extra});
}
test('combat XP, maximum stamina and regeneration augmentations have positive route value',()=>{
 for(const key of ['strength_exp','defense_exp','dexterity_exp','agility_exp','bladeburner_max_stamina','bladeburner_stamina_gain'])
  assert.ok(speed({[key]:2}).gain>0,key);
 assert.equal(speed({hacking:2}).gain,0);
});

test('measured combat recovery replaces the fallback and payback includes downtime itself',()=>{
 const now=2e6,recovery={nodeReset:1,augReset:2,at:now,samples:[{nodeReset:1,augReset:2,target:'Op',finishedAt:now-1,durationMs:10*minute}],recovering:false};
 const measured=speed({strength:2},{combatRecovery:recovery});
 assert.equal(measured.recoveryMs,10*minute);assert.match(measured.recoveryBasis,/Measured/);
 assert.ok(Math.abs(measured.paybackMs-(10*minute+10*minute/measured.gain))<1e-6);
 assert.equal(speed({strength:2},{combatRecovery:{...recovery,nodeReset:2}}).recoveryMs,20*minute);
 assert.equal(speed({strength:2},{combatRecovery:{...recovery,at:now+1}}).recoveryMs,20*minute);
 assert.equal(speed({strength:2},{combatRecovery:{...recovery,recovering:true}}).recoveryBlocked,true);
});

test('cash saving and hash milestone funding include useful combat XP and stamina augmentations',()=>{
 for(const stats of [{strength_exp:1.5},{bladeburner_max_stamina:1.1},{bladeburner_stamina_gain:1.1}]){
  const snapshot={at:1000,augReset:2,reputation:{Faction:100},targets:[{name:'Useful',directCost:150,stats,rep:100,factions:['Faction']}]};
  assert.equal(augmentationSavingsTarget(snapshot,reset,100,'bladeburner',1000).name,'Useful');
 }
});

test('actual autopilot applies the economics gate after quick heuristics and before reserve/installation',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 const quick=s.indexOf('const quickInstallThreshold'),gate=s.indexOf('const economicsDecision=augmentationResetDecision'),queued=s.indexOf('if(totalCost===0&&pendingAugInclNfCount>0)');
 assert.ok(quick<gate&&gate<queued);assert.ok(s.includes('combatRecovery=observeCombatRecovery'));
 assert.ok(s.includes('combatRecovery,nodeReset:resetInfo.lastNodeReset'));
 assert.ok(s.includes("priority:priorityAugmentationReady(options['install-for-augs'],facman)"));
});

test('recovery from an earlier BlackOp cannot shorten the rebuild estimate for a harder new target',()=>{
 const now=2e6,recovery={nodeReset:1,augReset:2,at:now,samples:[{nodeReset:1,augReset:2,target:'Easy',finishedAt:now-1,durationMs:minute}]};
 assert.equal(speed({strength:2},{combatRecovery:recovery,combatTarget:'Hard'}).recoveryMs,20*minute);
 assert.equal(speed({strength:2},{combatRecovery:recovery,combatTarget:null}).recoveryMs,20*minute);
});

test('single final gate replaces the old first-BN9 veto so verified milestones remain reachable',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.ok(!s.includes('if(adaptiveEnabled&&inFirstBn9Aug&&speed.resetEconomics'));
 assert.ok(s.includes('countUnlock:speed.countMilestone===true||!inFirstBn9Aug&&speed.countProgress===true'));
});

test('install-versus-wait comparison uses the same horizon and rebuild cost for both options',()=>{
 const p=compareAugmentationInstall({gain:.2,combinedGain:.6,waitMs:5*minute,recoveryMs:20*minute,horizonMs:4*60*minute});
 assert.equal(p.worthWaiting,true);
 assert.equal(p.installWork,220*minute*1.2);
 assert.equal(p.waitWork,5*minute+215*minute*1.6);
 for(const patch of [{combinedGain:.21},{waitMs:16*minute},{waitMs:Infinity},{combinedGain:.1},{recoveryMs:-1},{horizonMs:20*minute}]){
  const result=compareAugmentationInstall({gain:.2,combinedGain:.6,waitMs:5*minute,recoveryMs:20*minute,...patch});
  assert.equal(result.worthWaiting,false);
 }
});

const waitDecision=(now,window=null,patch={})=>augmentationResetDecision({requested:true,speed:{...profitable,
 waitOptions:[{name:'Strong',at:now,etaMs:5*minute,worthWaiting:true}]},now,augReset:2,nodeReset:1,waitWindow:window,...patch});

test('beneficial bundling holds ordinary resets for a bounded shared wait window',()=>{
 const first=waitDecision(2e6);assert.equal(first.allowed,false);assert.match(first.reason,/Waiting for Strong/);
 assert.equal(first.waitWindow.expiresAt,2e6+15*minute);
 const later=waitDecision(2e6+8*minute,first.waitWindow);
 assert.equal(later.waitWindow.expiresAt,first.waitWindow.expiresAt);
 const expired=waitDecision(2e6+16*minute,first.waitWindow);assert.equal(expired.allowed,true);
});

test('changing augmentation targets or reloading the saved window cannot extend the deadline',()=>{
 const now=2e6,first=waitDecision(now),loaded=JSON.parse(JSON.stringify(first.waitWindow));
 const result=waitDecision(now+10*minute,loaded,{speed:{...profitable,waitOptions:[{name:'Other',at:now+10*minute,etaMs:2*minute,worthWaiting:true}]}});
 assert.equal(result.allowed,false);assert.equal(result.waitWindow.expiresAt,loaded.expiresAt);
 assert.equal(waitDecision(now+14*minute,loaded).allowed,true);
});

test('bounded waits use a reachable alternative when the highest-value candidate misses the deadline',()=>{
 const now=2e6,first=waitDecision(now),at=now+12*minute;
 const result=waitDecision(at,first.waitWindow,{speed:{...profitable,waitOptions:[
  {name:'Late',at,etaMs:5*minute,worthWaiting:true},{name:'Soon',at,etaMs:2*minute,worthWaiting:true}]}});
 assert.equal(result.waitPlan.name,'Soon');assert.equal(result.waitWindow.expiresAt,first.waitWindow.expiresAt);
});

test('unknown, stale or previous-reset wait records cannot force an install delay',()=>{
 const now=2e6;
 for(const candidate of [{name:'Unknown',at:now,etaMs:null,worthWaiting:true},{name:'Old',at:now-121000,etaMs:minute,worthWaiting:true},{name:'Tiny',at:now,etaMs:minute,worthWaiting:false}]){
  assert.equal(waitDecision(now,null,{speed:{...profitable,waitOptions:[candidate]}}).allowed,true);
 }
 const prior=waitDecision(now).waitWindow;
 const current=waitDecision(now+minute,{...prior,augReset:1});assert.equal(current.waitWindow.startedAt,now+minute);
 for(const flag of ['priority','favor','countUnlock','campaign','bn8Quick'])
  assert.equal(waitDecision(now,null,{[flag]:true}).allowed,true,flag);
 assert.equal(waitDecision(now,null,{requested:false}).waitWindow,undefined);
});

test('value comparison skips a nearer irrelevant augmentation in favor of a useful measured opportunity',()=>{
 const now=2e6,ready=[{name:'Ready',stats:{strength:10}}];
 const snapshot={at:now,augReset:2,worth:1e6,ready,reputation:{Faction:100},resetEconomics:{known:true,replacementCost:0},
 targets:[{name:'Speech',cost:1e6+6000,rep:100,factions:['Faction'],stats:{charisma:2}},
  {name:'Combat',cost:1e6+30000,rep:100,factions:['Faction'],stats:{strength:10}}]};
 const previous={augReset:2,at:now-60000,worth:1e6-6000,reputation:{Faction:100},fingerprint:JSON.stringify(['Ready']),lastGrowthAt:now-20*minute};
 const result=progressionSpeed({snapshot,previous,now,augReset:2,combat:true,homeRam:1024,elapsed:2*60*minute});
 assert.equal(result.next.name,'Speech');
 assert.equal(result.waitCandidate.name,'Combat');assert.equal(result.waitCandidate.etaMs,5*minute);
 assert.equal(result.waitOptions.some(a=>a.name==='Speech'),false);assert.equal(result.earlyInstall,true);
 assert.equal(result.delayMs,30000);
 const unknown=progressionSpeed({snapshot,now,augReset:2,combat:true,homeRam:1024});
 assert.equal(unknown.waitCandidate,null);
});

test('actual autopilot persists the reset-scoped wait window alongside its decision',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.ok(s.includes("ns.read('tasks/augmentation-wait-plan.json')"));
 assert.ok(s.includes('waitWindow:augmentationWaitWindow,now:Date.now(),augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset'));
 assert.ok(s.includes('augmentationWaitWindow=economicsDecision.waitWindow'));
});


test('shared donation top-ups shorten cash-funded ETA without requiring an observed reputation rate',()=>{
 const now=2e6,augReset=2;
 const snapshot={at:now,augReset,worth:1000,ready:[],reputation:{A:0},resetEconomics:{known:true,replacementCost:0},
  targets:[{name:'Target',cost:1100,donationCost:50,rep:150,factions:['A'],stats:{hacking:2}}]};
 const previous={augReset,at:now-60000,worth:940,reputation:{A:0}};
 const result=progressionSpeed({snapshot,previous,now,augReset,homeRam:1024});
 assert.equal(result.next.eta,150000);
 const doubleCounted=progressionSpeed({snapshot:{...snapshot,targets:[{...snapshot.targets[0],donationCost:150}]},previous,now,augReset,homeRam:1024});
 assert.equal(doubleCounted.next.eta,250000);
 assert.equal(result.next.bottleneck,'cash');
});
