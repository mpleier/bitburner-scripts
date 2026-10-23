import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentationReputationForecast,readAugmentationReputationContext} from '../augmentation-reputation-policy.js';
import {estimateMixedAugmentationWait,progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
import {selectAugmentationBasketDrop} from '../faction-policy.js';
const minute=60000,hour=60*minute;
const aug=(name,mult)=>({name,price:100,prereqs:[],stats:{faction_rep:mult}});
const target={name:'Useful',useful:true,cost:0,requirements:[{rep:10800,factions:['A'],providers:[{faction:'A',canDonate:false,requiredDonation:null}]}]};
const context=(patch={})=>({horizonMs:4*hour,worth:0,cashRate:100,factionCashRate:100,reputation:{A:0},repRates:{A:1},donationUnitCost:1,targets:[target],...patch});
const forecast=(augs,c=context(),options)=>augmentationReputationForecast(augs,c,estimateMixedAugmentationWait,options);

test('twenty percent reputation gain saves one sixth of a measured work grind',()=>{
 const q=forecast([aug('Rep',1.2)]);assert.equal(q.grossSavingsMs,30*minute);assert.equal(q.netSavingsMs,30*minute);assert.equal(q.rebuildPenaltyMs,0);
 assert.equal(q.resetWithBoostMs,150*minute);assert.equal(q.gain,.125);
});

test('lost reputation is charged before a reset can receive useful unlock credit',()=>{
 const q=forecast([aug('Rep',1.2)],context({reputation:{A:9000}}));
 assert.equal(q.stayMs,30*minute);assert.equal(q.resetWithBoostMs,150*minute);
 assert.equal(q.netSavingsMs,0);assert.equal(q.gain,0);assert.equal(q.rebuildPenaltyMs,150*minute);
});

test('work donation and shared goals are one comparison rather than added savings',()=>{
 const donated={...target,requirements:[{rep:10800,factions:['A'],providers:[{faction:'A',canDonate:true,requiredDonation:10800}]}]};
 const q=forecast([aug('Rep',1.2)],context({targets:[donated],repRates:{}}));
 assert.equal(q.stayMs,108000);assert.equal(q.netSavingsMs,18000);
 const mixed=forecast([aug('Rep',1.2)],context({targets:[donated]}));assert.ok(mixed.stayMs<q.stayMs);assert.ok(mixed.netSavingsMs<30*minute);
 const shared={...target,requirements:[...target.requirements,...target.requirements]};
 assert.equal(forecast([aug('Rep',1.2)],context({targets:[shared,{...shared,name:'Other'}]})).netSavingsMs,30*minute);
});

test('no useful unlocked missing or self-referential goals invent reputation benefit',()=>{
 for(const c of [context({targets:[]}),context({targets:[{...target,useful:false}]}),context({targets:[{...target,name:'Rep'}]}),context({targets:[{...target,requirements:[{...target.requirements[0],rep:0}]}]}),context({repRates:{}})])
  assert.equal(forecast([aug('Rep',1.2)],c).gain,0);
 for(const m of [1,0,-1,NaN,Infinity])assert.equal(forecast([aug('Rep',m)]).gain,0);
 assert.doesNotThrow(()=>forecast([aug('Rep',2)],context({targets:[{...target,requirements:[null]}]})));
});

test('cash bottlenecks do not receive fictional work speed benefits and target evaluation is bounded',()=>{
 const money={...target,cost:1e9};assert.equal(forecast([aug('Rep',1.2)],context({targets:[money],cashRate:1,factionCashRate:1})).gain,0);
 let calls=0;const estimate=x=>{calls++;return estimateMixedAugmentationWait(x);};
 augmentationReputationForecast([aug('Rep',1.2)],context({targets:Array.from({length:20},(_,i)=>({...target,name:'T'+i}))}),estimate);
 assert.equal(calls,12);
});

test('basket valuation preserves a useful rep augmentation even with live combat scoring',()=>{
 const combatContext={player:{skills:{strength:100}},metadata:{weights:{strength:1},decays:{strength:1}}};
 const rep=aug('Rep',1.5),filler={name:'Filler',price:100,prereqs:[],stats:{hacking:1.01}};
 const q=selectAugmentationBasketDrop([rep,filler],{route:'bladeburner',multiplier:1,combatContext,reputationContext:context(),reputationEstimator:estimateMixedAugmentationWait});
 assert.equal(q.name,'Filler');assert.ok(q.lostBenefit<.01);
});

test('basket marginal benefit and reset net benefit can select different useful goals',()=>{
 const other={...target,name:'Other',requirements:[{rep:6000,factions:['B'],providers:[{faction:'B',canDonate:false,requiredDonation:null}]}]};
 const c=context({targets:[target,other],reputation:{A:9000,B:0},repRates:{A:1,B:1}});
 assert.equal(forecast([aug('Rep',1.2)],c).target,'Other');
 const marginal=forecast([aug('Rep',1.2)],c,{marginal:true});assert.equal(marginal.target,'Useful');assert.equal(marginal.grossSavingsMs,30*minute);
});

test('reputation context rejects stale cross-reset incomplete or changed ownership evidence',()=>{
 const c={...context(),schemaVersion:1,at:1000,nodeReset:1,augReset:2,ownershipSignature:'same'};
 const ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),read:()=>JSON.stringify({reputationPlanningContext:c})};
 const owned={complete:true,signature:'same'};assert.ok(readAugmentationReputationContext(ns,owned,2000));
 assert.equal(readAugmentationReputationContext(ns,{complete:true,signature:'manual'},2000),null);
 assert.equal(readAugmentationReputationContext(ns,{signature:'same'},2000),null);
 for(const patch of [{at:2001},{at:0,nodeReset:9},{augReset:9},{horizonMs:0}]){
  Object.assign(c,{at:1000,nodeReset:1,augReset:2,horizonMs:4*hour},patch);assert.equal(readAugmentationReputationContext(ns,owned,2000),null);
 }
 assert.equal(readAugmentationReputationContext(ns,owned,100000),null);
});

function speed({rep=60,targets=true,work='A',combat=true}={}){
 const now=2e6,ready=[aug('Rep',1.5)],t={...target,useful:undefined,rep:10800,stats:{strength:2,hacking:2},priority:-1,donationCost:null};
 return progressionSpeed({snapshot:{at:now,augReset:2,nodeReset:1,ownershipSignature:'same',worth:0,ready,workFaction:work,reputation:{A:rep},targets:targets?[t]:[],resetEconomics:{known:true,replacementCost:0}},
  previous:{at:now-minute,augReset:2,worth:0,workFaction:'A',reputation:{A:0},repRates:{A:1},fingerprint:'["Rep"]',lastGrowthAt:now-20*minute},
  now,augReset:2,nodeReset:1,combat,elapsed:hour,homeRam:128});
}
test('reset planning values useful rep unlocks on both routes and refuses rebuild-dominated resets',()=>{
 for(const combat of [true,false]){const q=speed({combat});assert.ok(q.reputationForecast.gain>0);assert.ok(q.gain>0);assert.equal(q.resetPaysBack,true);}
 assert.equal(speed({targets:false}).gain,0);assert.equal(speed({work:null}).gain,0);
 const expensive=speed({rep:9000});assert.equal(expensive.reputationForecast.gain,0);assert.equal(expensive.resetPaysBack,false);
 assert.equal(augmentationResetDecision({requested:true,speed:expensive}).allowed,false);
});

test('producer and purchasing paths carry native eligibility conversion and exact ownership context',()=>{
 const s=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.match(s,/donationUnitCost:playerData.mults.faction_rep>0/);assert.match(s,/canDonate:f.donationsUnlocked/);
 assert.match(s,/const reputationContext=readAugmentationReputationContext\(ns,ownershipSnapshot\)/);
 assert.match(s,/reputationContext,reputationEstimator:estimateMixedAugmentationWait/);
 assert.match(s,/getCurrentWork\(\)/);
});
