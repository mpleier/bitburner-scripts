import test from 'node:test';
import assert from 'node:assert/strict';
import {compareGraftInstall,graftHandoff,freshAugmentationOffer,graftChannelGain,comparisonCashRate} from '../graft-install-policy.js';
import {graftEconomics} from '../automation-policy.js';
const reset={lastNodeReset:1,lastAugReset:2},now=1000000;
const processes=[{pid:10,filename:'autopilot.js'},{pid:11,filename:'grafting-manager.js'}];
const offer={schemaVersion:1,at:now,ownerPid:10,nodeReset:1,augReset:2,horizonMs:3600000,cashRate:1000,install:{eligible:true,gain:1,cost:1000,delayMs:0,downtimeMs:300000}};
const graft={gain:1,cost:1000,delayMs:60000,downtimeMs:0};
test('same horizon favors normal basket over costly slow graft',()=>{
 assert.equal(compareGraftInstall(offer,{...graft,cost:1e9}).winner,'install');
});
test('continuing work can make graft beat restart recovery',()=>{
 assert.equal(compareGraftInstall({...offer,install:{...offer.install,downtimeMs:1800000}},graft).winner,'graft');
 assert.equal(compareGraftInstall(offer,{...graft,gain:0}).winner,'install');
});
test('baseline and known bundle participate; missing economics stay unknown',()=>{
 assert.equal(compareGraftInstall({...offer,install:{...offer.install,eligible:false}},{...graft,gain:0}).winner,'wait');
 assert.equal(compareGraftInstall({...offer,wait:{...offer.install,gain:2,eligible:true}},graft).winner,'bundle');
 assert.equal(compareGraftInstall({...offer,cashRate:0},graft).winner,'unknown');
});
test('offers reject stale, wrong reset and dead owner',()=>{
 assert.equal(freshAugmentationOffer(offer,reset,processes,now),true);
 for(const bad of [{...offer,at:now-120001},{...offer,nodeReset:3},{...offer,ownerPid:99}])assert.equal(freshAugmentationOffer(bad,reset,processes,now),false);
});
test('handoff expires without renewal across controller restart',()=>{
 const o={...offer,install:{...offer.install,downtimeMs:1800000}};
 const proposal={at:now,ownerPid:11,nodeReset:1,augReset:2,name:'test',quote:graft};
 const first=graftHandoff(null,proposal,o,reset,processes,now);
 assert.equal(first.defer,true);
 assert.equal(graftHandoff(first.window,{...proposal,at:now+90001},{...o,at:now+90001},reset,processes,now+90001).defer,false);
 assert.equal(graftHandoff(null,{...proposal,ownerPid:99},o,reset,processes,now).defer,false);
});
test('channel scoring includes entropy and BB concurrency removes only BB lost cash',()=>{
 assert.ok(graftChannelGain({hacking_exp:2},{hacking_exp:.15},1)>0);
 assert.equal(graftChannelGain({},{hacking_exp:.15},.98),0);
 const q={stats:{hacking_money:2},cost:100,duration:1000,hackingIncome:100,rates:{bladeburner:100,work:50},focusImmune:true};
 assert.equal(graftEconomics(q).lostIncome,150);
 assert.equal(graftEconomics({...q,bladeburnerContinues:true}).lostIncome,50);
});

test('cash comparison rejects stale, unconfirmed and mismatched samples',()=>{
 const observation={at:now,augReset:2,cashRate:200,cashObservation:{schemaVersion:1,augReset:2,mode:'sources-v1',samples:[{at:now-30000,rate:100},{at:now,rate:150}]}};
 assert.equal(comparisonCashRate(observation,reset,now),100);
 assert.equal(comparisonCashRate({...observation,at:now-120001},reset,now),null);
 assert.equal(comparisonCashRate(observation,{...reset,lastAugReset:3},now),null);
 assert.equal(comparisonCashRate({...observation,cashObservation:{...observation.cashObservation,mode:'legacy-worth-v1'}},reset,now),null);
});
test('unknown eligible reset economics cannot be silently treated as free waiting',()=>{
 assert.equal(compareGraftInstall({...offer,install:{...offer.install,downtimeMs:null}},graft).winner,'unknown');
});
