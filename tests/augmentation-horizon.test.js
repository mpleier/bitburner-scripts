import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentationPaybackHorizon,augmentationRouteForecast,progressionSpeed,augmentationResetDecision,compareAugmentationInstall} from '../progression-speed-policy.js';
const hour=3600000,minute=60000,now=24*hour,reset={lastNodeReset:1,lastAugReset:2};
const plan=(patch={})=>({at:now,augReset:2,nodeReset:1,selected:'bladeburner',routes:{bladeburner:{actionable:true,etaMs:24*hour,lowerMs:16*hour}},...patch});

test('augmentation payback extensions need valid conservative bounds and remain capped',()=>{
 assert.equal(augmentationPaybackHorizon(),4*hour);
 for(const lower of [null,undefined,NaN,Infinity,-1,25*hour])assert.equal(augmentationPaybackHorizon(24*hour,lower),4*hour);
 assert.equal(augmentationPaybackHorizon(24*hour,16*hour),8*hour);
 assert.equal(augmentationPaybackHorizon(100*hour,80*hour),12*hour);
 assert.equal(augmentationPaybackHorizon(2*hour,hour),1.5*hour);
 assert.equal(augmentationPaybackHorizon(0,0),0);
});

test('stale cross-reset incomplete or nonactionable forecasts cannot extend reset horizons',()=>{
 assert.deepEqual(augmentationRouteForecast(plan(),reset,now),{remainingMs:24*hour,lowerMs:16*hour});
 for(const p of [null,plan({at:now+1}),plan({at:now-45001}),plan({augReset:3}),plan({nodeReset:3}),plan({routes:{}}),plan({routes:{bladeburner:{etaMs:24*hour,lowerMs:16*hour,actionable:false}}})])
  assert.deepEqual(augmentationRouteForecast(p,reset,now),{remainingMs:null,lowerMs:null});
 for(const lowerMs of [null,NaN,Infinity,-1,25*hour]){
  const p=plan();p.routes.bladeburner.lowerMs=lowerMs;
  assert.deepEqual(augmentationRouteForecast(p,reset,now),{remainingMs:24*hour,lowerMs:null});
 }
});

function speed(extra={}){
 const snapshot={at:now,augReset:2,worth:1e9,ready:[{name:'Aug',stats:{strength:2,defense:2,dexterity:2,agility:2}}],targets:[],reputation:{},resetEconomics:{known:true,replacementCost:0,gangLossPerSecond:0}};
 const previous={at:now-60000,augReset:2,worth:1e9,fingerprint:'["Aug"]',lastGrowthAt:now-20*minute};
 const combatRecovery={at:now,nodeReset:1,augReset:2,samples:[{nodeReset:1,augReset:2,target:'Op',finishedAt:now-1,durationMs:75*minute}]};
 return progressionSpeed({snapshot,previous,now,augReset:2,nodeReset:1,combat:true,combatTarget:'Op',combatRecovery,elapsed:20*hour,homeRam:1024,...extra});
}

test('a productive long-run basket can repay beyond four hours in both planning and final gate',()=>{
 const old=speed(),long=speed({routeRemainingMs:24*hour,routeLowerMs:16*hour});
 assert.ok(long.paybackMs>4*hour&&long.paybackMs<8*hour);
 assert.equal(old.resetPaysBack,false);assert.equal(old.earlyInstall,false);
 assert.equal(long.resetPaysBack,true);assert.equal(long.earlyInstall,true);assert.equal(long.paybackLimitMs,8*hour);
 assert.equal(augmentationResetDecision({requested:true,speed:long,remainingMs:24*hour,lowerMs:16*hour}).allowed,true);
});

test('final reset gate recomputes the limit rather than trusting saved limits',()=>{
 const profitable={resetPaysBack:true,paybackMs:6*hour,paybackLimitMs:100*hour};
 assert.equal(augmentationResetDecision({requested:true,speed:profitable}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable,remainingMs:24*hour}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable,remainingMs:24*hour,lowerMs:16*hour}).allowed,true);
 assert.equal(augmentationResetDecision({requested:true,speed:profitable,remainingMs:7*hour,lowerMs:6*hour}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:{...profitable,recoveryBlocked:true},remainingMs:24*hour,lowerMs:16*hour}).allowed,false);
});

test('long horizons cannot authorize unknown rebuild costs or nonpositive augmentation gains',()=>{
 const extra={routeRemainingMs:24*hour,routeLowerMs:16*hour};
 for(const patch of [{ready:[{name:'Aug',stats:{}}]},{resetEconomics:{known:false}}]){
  const snapshot={at:now,augReset:2,worth:1e9,ready:[{name:'Aug',stats:{strength:3}}],targets:[],reputation:{},resetEconomics:{known:true,replacementCost:0,gangLossPerSecond:0},...patch};
  const p=speed({...extra,snapshot});assert.equal(p.resetPaysBack,false);
  assert.equal(augmentationResetDecision({requested:true,speed:p,remainingMs:24*hour,lowerMs:16*hour}).allowed,false);
 }
});

test('install bundling shares the longer horizon while keeping the fifteen-minute wait bound',()=>{
 const args={gain:.2,combinedGain:.6,waitMs:5*minute,recoveryMs:30*minute,horizonMs:8*hour};
 const p=compareAugmentationInstall(args);assert.equal(p.worthWaiting,true);assert.equal(p.horizonMs,8*hour);
 assert.equal(p.installWork,(8*hour-30*minute)*1.2);
 for(const patch of [{horizonMs:12*hour+1},{waitMs:16*minute}])assert.equal(compareAugmentationInstall({...args,...patch}).worthWaiting,false);
});

test('autopilot feeds the same fresh forecast to the planner and final reset guard',()=>{
 const s=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(s,/const augmentationRoute=augmentationRouteForecast\(routePlan,resetInfo\)/);
 assert.match(s,/routeRemainingMs:augmentationRoute.remainingMs,routeLowerMs:augmentationRoute.lowerMs/);
 assert.match(s,/remainingMs:augmentationRoute.remainingMs,lowerMs:augmentationRoute.lowerMs/);
});
