import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observeCasinoReset,forecastCasinoReset} from '../casino-reset-policy.js';
import {progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
const minute=60000,now=10e6,reset={lastNodeReset:1,lastAugReset:now-40*minute};
const success={mode:'complete',augReset:reset.lastAugReset,at:reset.lastAugReset+2*minute,earnings:10.1e9};
const evidence=()=>observeCasinoReset(null,success,reset,now);
const forecast=(extra={},e=evidence())=>forecastCasinoReset(e,{reset,now,seedFundable:true,homeRam:1024,casinoRam:20,...extra});
test('successful reset-to-casino time includes bootstrap time and earns a bounded one-time payout',()=>{
 const p=forecast();assert.equal(p.available,true);assert.equal(p.durationMs,2.5*minute);assert.equal(p.amount,1e10-300000);assert.equal(p.samples,1);
});
test('casino completion observations deduplicate reloads and retain no more than three same-node resets',()=>{
 let p=evidence();p=observeCasinoReset(p,success,reset,now);assert.equal(p.samples.length,1);
 for(let i=1;i<=5;i++)p=observeCasinoReset(p,{...success,augReset:success.augReset-i*minute,at:success.at-i*minute},reset,now);
 assert.equal(p.samples.length,3);assert.equal(p.samples[0].augReset,success.augReset);
 assert.equal(observeCasinoReset(p,null,{lastNodeReset:now,lastAugReset:now},now).samples.length,0);
});
test('failed, incomplete, foreign-node, invalid and future reports cannot establish casino funding',()=>{
 for(const patch of [{mode:'failed'},{mode:'playing'},{earnings:1e9},{earnings:Infinity},{augReset:0},{augReset:now+1},{at:now+1},{at:success.augReset},{at:success.augReset-1}]){
  const p=observeCasinoReset(null,{...success,...patch},reset,now);assert.equal(p.samples.length,0,JSON.stringify(patch));
 }
 assert.equal(forecast({},null).available,false);
});
test('disabled, paused, restricted, unfundable, incompatible-RAM and high-income runs receive no casino credit',()=>{
 for(const patch of [{enabled:false},{paused:true},{allowed:false},{seedFundable:false},{homeRam:8},{casinoRam:0},{casinoRam:Infinity},{incomePerSecond:5e9/60}])assert.equal(forecast(patch).available,false,JSON.stringify(patch));
});
test('a current casino failure overrides an older successful measurement',()=>{
 for(const mode of ['failed','paused','starting','playing','reloading'])assert.equal(forecast({status:{mode,at:now-1,augReset:reset.lastAugReset}}).available,false);
 assert.equal(forecast({status:{mode:'failed',at:now-1,augReset:reset.lastAugReset-1}}).available,true);
});
test('several successful casino samples use the slowest observed elapsed time',()=>{
 const e=observeCasinoReset(evidence(),{...success,augReset:success.augReset-minute,at:success.at+minute},reset,now);
 assert.equal(forecast({},e).durationMs,5*minute);
});
function speed({casinoFunding=null,cost=15e9,known=true,gain=true}={}){
 const snapshot={at:now,augReset:reset.lastAugReset,worth:1e9,income:null,ready:gain?[{name:'Useful',stats:{hacking:10}}]:[],targets:[],reputation:{},resetEconomics:{known,replacementCost:cost,gangLossPerSecond:0}};
 return progressionSpeed({snapshot,now,augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,node:9,firstBn9:true,casinoFunding,elapsed:40*minute,homeRam:1024});
}
test('casino credit offsets a rebuild bill once without adding to recurring income',()=>{
 const p=speed({casinoFunding:forecast(),cost:8e9});assert.equal(p.resetEconomics.casinoCredit,8e9);assert.equal(p.resetEconomics.remainingRecoveryCost,0);assert.equal(p.resetEconomics.rebuildMs,0);assert.equal(p.observation.cashRate,0);
 assert.equal(p.recoveryMs,17.5*minute);assert.equal(p.resetPaysBack,true);assert.equal(speed({cost:8e9}).resetPaysBack,false);
});
test('cash above the casino payout still needs recurring income and casino winnings cannot fund current targets',()=>{
 const p=speed({casinoFunding:forecast()});assert.equal(p.resetEconomics.casinoCredit,1e10-300000);assert.equal(p.resetEconomics.remainingRecoveryCost,5e9+300000);assert.equal(p.resetEconomics.rebuildMs,null);assert.equal(p.resetPaysBack,false);
});
test('casino timing is charged even when there is no rebuild bill; payout never creates negative costs',()=>{
 const p=speed({casinoFunding:forecast(),cost:0}),baseline=speed({cost:0});assert.equal(p.resetEconomics.casinoCredit,0);assert.equal(p.resetEconomics.rebuildMs,0);assert.ok(p.paybackMs>baseline.paybackMs);
});
test('casino evidence does not bypass unknown economics, useful-augmentation or completion-route guards',()=>{
 const unknown=speed({casinoFunding:forecast(),known:false});assert.equal(unknown.resetEconomics.casinoCredit,0);assert.equal(unknown.resetPaysBack,false);
 const noGain=speed({casinoFunding:forecast(),cost:1e9,gain:false});assert.equal(noGain.resetPaysBack,false);assert.equal(augmentationResetDecision({requested:true,speed:noGain}).allowed,false);
 const p=speed({casinoFunding:forecast(),cost:1e9});assert.equal(augmentationResetDecision({requested:true,speed:p,remainingMs:minute}).allowed,false);
});
test('stale, foreign-reset and malformed forecasts cannot affect reset economics',()=>{
 const baseline=speed({cost:8e9});
 for(const patch of [{at:now-45001},{at:now+1},{augReset:1},{nodeReset:2},{amount:Infinity},{amount:2e10},{durationMs:0},{durationMs:Infinity},{available:false}]){
  const p=speed({cost:8e9,casinoFunding:{...forecast(),...patch}});assert.equal(p.resetEconomics.casinoCredit,0);assert.equal(p.recoveryMs,baseline.recoveryMs);
 }
});
test('actual autopilot records completion evidence, validates seed and permissions, and passes funding into the reset model',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(s,/observeCasinoReset\(casinoEvidence,casinoStatus,resetInfo\)/);
 assert.match(s,/forecastCasinoReset\(casinoEvidence/);assert.match(s,/previous:speedObservation,casinoFunding,/);
 assert.match(s,/seedFundable:installedAugmentations/);assert.match(s,/isScriptPaused\(ns,'casino.js'\)/);
});
