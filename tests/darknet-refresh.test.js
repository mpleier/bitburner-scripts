import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beginDarknetRefresh,observeDarknetRefresh,darknetRefreshEvidence} from '../darknet-refresh-policy.js';
import {darknetContractDisposition} from '../darknet-contract-policy.js';
import {darknetEconomics} from '../darknet-economics-policy.js';
import {planStorm,applyStormReceipt} from '../darknet-storm-policy.js';
const start=1e7,scope={reset:42,augReset:7,context:'same'};
const hosts=[{host:'a',pid:1},{host:'b',pid:2},{host:'c',pid:3}];
function cycle(patch={}){return {at:start,...scope,income:1000,lastCacheAt:0,reports:[],receipt:{id:'id',success:true,at:start},...patch};}
function begin(){return beginDarknetRefresh({}, {id:'id',at:start,...scope,hosts});}
function recovered(){let s=observeDarknetRefresh(begin(),cycle());s=observeDarknetRefresh(s,cycle({at:start+30000}));return observeDarknetRefresh(s,cycle({at:start+60000,income:1100,reports:hosts.map(r=>({...r,pid:r.pid+10,at:start+60000,live:true}))}));}
test('receipt-backed recovery requires renewed live scouts and rewards after the storm',()=>{
 let s=observeDarknetRefresh(begin(),cycle({income:5000}));assert.equal(s.active.recoveredAt,undefined);
 s=observeDarknetRefresh(s,cycle({at:start+30000,income:5000}));
 const old=hosts.map(r=>({...r,at:start+60000,live:true}));s=observeDarknetRefresh(s,cycle({at:start+60000,income:5100,reports:old}));assert.equal(s.active.recoveredAt,undefined);
 s=observeDarknetRefresh(s,cycle({at:start+90000,income:5200,reports:old.map(r=>({...r,pid:r.pid+10,at:start+90000}))}));assert.equal(s.active.recoveryMs,90000);
});
test('complete recovery measures a full continuously observed ten-minute return window',()=>{
 let s=recovered();assert.equal(s.active.recoveryMs,60000);
 for(let t=90000;t<=660000;t+=30000)s=observeDarknetRefresh(s,cycle({at:start+t,income:1100+t-60000}));
 assert.equal(s.active,undefined);assert.equal(s.samples.length,1);assert.equal(s.samples[0].windowMs,600000);assert.equal(s.samples[0].gain,600000);
 const e=darknetRefreshEvidence(s,scope,start+660000);assert.equal(e.ready,false);assert.equal(e.measuredRebuild,true);assert.equal(e.rebuildMs,75000);
});
test('missing receipts, gaps, resets, capability changes and backwards income never create samples',()=>{
 for(const patch of [{receipt:{id:'other',success:true,at:start}},{receipt:{id:'id',success:false,at:start}}]){const s=observeDarknetRefresh(begin(),cycle(patch));assert.equal(s.active.startedAt,undefined);}
 for(const patch of [{reset:43},{augReset:8},{context:'changed'},{income:NaN},{lastCacheAt:start+1}])assert.equal(observeDarknetRefresh(begin(),cycle(patch)).active,undefined);
 assert.equal(observeDarknetRefresh(recovered(),cycle({at:start+160000})).active,undefined);
 assert.equal(observeDarknetRefresh(recovered(),cycle({at:start+90000,income:999})).active,undefined);
});
test('cache recovery works without dollars and duplicate hosts cannot establish restored exploration',()=>{
 let s=observeDarknetRefresh(begin(),cycle());s=observeDarknetRefresh(s,cycle({at:start+30000}));
 const report={host:'new',pid:10,live:true,at:start+60000};
 s=observeDarknetRefresh(s,cycle({at:start+60000,lastCacheAt:start+60000,reports:[report,report,report]}));assert.equal(s.active.recoveredAt,undefined);
 s=observeDarknetRefresh(s,cycle({at:start+90000,lastCacheAt:start+90000,reports:hosts.map(r=>({...r,pid:r.pid+10,at:start+90000,live:true}))}));assert.equal(s.active.recoveryMs,90000);
});
function evidenceHistory(){return {samples:Array.from({length:3},(_,i)=>({...scope,at:start+i,complete:true,recoveryMs:60000,windowMs:600000,gain:660000}))};}
test('three comparable successful windows use slowest recovery and weakest net return',()=>{
 const h=evidenceHistory();h.samples[1].recoveryMs=120000;h.samples[2].gain=330000;
 const e=darknetRefreshEvidence(h,scope,start+100);assert.equal(e.ready,true);assert.equal(e.rebuildMs,150000);assert.equal(e.netRate,500);
 for(const patch of [{context:'other'},{complete:false},{recoveryMs:NaN},{windowMs:5000},{gain:-1},{at:start+1000}]){const bad=evidenceHistory();Object.assign(bad.samples[0],patch);assert.equal(darknetRefreshEvidence(bad,scope,start+100).ready,false);}
 assert.equal(darknetRefreshEvidence(h,{...scope,augReset:8},start+100).ready,false);
});
test('recovery timeout is censored and blocks optimistic income replacement',()=>{
 let s=begin();for(let t=0;t<=1830000;t+=30000)s=observeDarknetRefresh(s,cycle({at:start+t}));assert.equal(s.active,undefined);assert.equal(s.samples.at(-1).complete,false);
});
function economic(rate,evidence,lastCacheAt=0){let s;for(let t=0;t<=360000;t+=30000)s=darknetEconomics(s,1000+rate*t/1000,lastCacheAt,42,start+t,evidence);return s;}
test('small ongoing income can be replaced only with strong complete evidence and positive payback',()=>{
 const e=darknetRefreshEvidence(evidenceHistory(),scope,start+100);
 assert.equal(economic(100,e).allow,true);assert.equal(economic(100,e).allowLowIncome,true);assert.equal(economic(100,e).estimatedRebuildMs,75000);
 for(const proof of [{}, {...e,ready:false},{...e,samples:2},{...e,netRate:150},{...e,rebuildMs:2000000},{...e,netRate:Infinity}])assert.equal(economic(100,proof).allow,false);
 assert.equal(economic(100,e,start+350000).allow,false);assert.equal(economic(0,{}).allow,true);
});
test('contract disposition preserves validated, failed, retrying, stale and unknown-value rewards',()=>{
 const reports=[{host:'a',contractFiles:['reward.cct']}],reset={lastNodeReset:42,lastAugReset:7};
 const status={at:start,nodeReset:42,augReset:7,validationVersion:'v',contracts:[{host:'a',file:'reward.cct',type:'T'}]},validation={at:start,version:'v',types:{T:{state:'unsupported'}}};
 assert.equal(darknetContractDisposition(reports,status,validation,reset,start).allow,true);
 for(const state of ['passed','failed','retrying',undefined])assert.equal(darknetContractDisposition(reports,status,{...validation,types:{T:{state}}},reset,start).allow,false);
 for(const patch of [{at:start-90001},{nodeReset:43},{augReset:8},{validationVersion:'old'},{contracts:[]}])assert.equal(darknetContractDisposition(reports,{...status,...patch},validation,reset,start).allow,false);
 assert.equal(darknetContractDisposition(reports,status,{...validation,state:'unavailable'},reset,start).allow,false);
 assert.equal(darknetContractDisposition([],null,null,reset,start).allow,true);
});
test('collector publishes typed Dark Net inventory and manager/native helper both protect its option value',()=>{
 const collector=readFileSync(new URL('../Tasks/contractor.js',import.meta.url),'utf8');assert.match(collector,/tasks\/dnet-survey-/);assert.match(collector,/validationVersion:validation\?\.version/);assert.match(collector,/contractsDb.slice\(0,256\)/);
 for(const f of ['darknet-manager.js','darknet-storm.js'])assert.match(readFileSync(new URL('../'+f,import.meta.url),'utf8'),/darknetContractDisposition/);
});

test('payouts during the engine storm are rebased away before checking recovery',()=>{
 let s=observeDarknetRefresh(begin(),cycle());s=observeDarknetRefresh(s,cycle({at:start+15000,income:5000}));
 s=observeDarknetRefresh(s,cycle({at:start+30000,income:5000}));
 s=observeDarknetRefresh(s,cycle({at:start+60000,income:5000,reports:hosts.map(r=>({...r,pid:r.pid+10,at:start+60000,live:true}))}));assert.equal(s.active.recoveredAt,undefined);
});
test('a lost recovery observation censors the latest cycle rather than leaving optimistic approval',()=>{
 const h=evidenceHistory(),active=recovered().active;
 const result=observeDarknetRefresh({...h,active},cycle({at:start+160000}));
 assert.equal(result.samples.at(-1).complete,false);assert.equal(darknetRefreshEvidence(result,scope,start+160000).ready,false);
});
test('planner and matching native receipt preserve recovery history across dispatch and restart',()=>{
 const refresh=begin(),state={reset:42,refresh,pending:{id:'id',host:'seed',at:start}};
 const received=applyStormReceipt(state,{id:'id',host:'seed',reset:42,at:start,success:true},42,start);
 const plan=planStorm([],[],JSON.parse(JSON.stringify(received)),start+30000,42);
 assert.equal(plan.state.lastResult.id,'id');assert.equal(plan.state.refresh.active.id,'id');
 const observed=observeDarknetRefresh(plan.state.refresh,cycle({at:start+30000,receipt:plan.state.lastResult}));assert.equal(observed.active.startedAt,start);
});
