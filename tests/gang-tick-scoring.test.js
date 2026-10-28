import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeGangAttrition,startGangAttrition,gangAttritionSignature} from '../gang-attrition-policy.js';

function fixture(seconds=20){
 const expected={power:110,territory:.2,rivals:[{name:'R',power:90,territory:.8}]};
 const scope={ownerPid:7,nodeReset:1,augReset:2};
 const lease={...scope,faction:'Own',startedAt:100000,expectedTickAt:100100,observationForecast:{wallSeconds:seconds,expected:[expected,structuredClone(expected),structuredClone(expected)]}};
 const cycle={at:100100,info:{faction:'Own',power:110,territory:.2},others:{R:{power:90,territory:.8}}};
 return {lease,cycle,scope};
}
test('a short wait for the scheduled event scores one whole native update',()=>{
 const f=fixture(),result=observeGangAttrition(f.lease,f.cycle,f.scope)[0];
 assert.equal(result.scored,true);assert.equal(result.elapsedSeconds,.1);
 assert.equal(result.power.expected.min,110);assert.equal(result.power.errorFromBaseline,0);
 assert.equal(result.expectedTickAt,100100);assert.equal(result.timingBasis,'scheduled-tick');
 assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope,[result]),null);
});
test('event scoring tolerates bounded polling delay but rejects missed and early events',()=>{
 for(const offset of [0,150,500]){const f=fixture();f.cycle.at+=offset;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,true);}
 for(const at of [101000,120100]){const f=fixture();f.cycle.at=at;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);}
 const f=fixture();f.lease.expectedTickAt=110000;f.cycle.at=109000;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);
});
test('bonus-time timing cannot mistake the following fast tick for the target',()=>{
 const f=fixture(.8);f.cycle.at+=180;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,true);
 f.cycle.at=100900;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);
});
test('malformed schedules never fall back to legacy elapsed-time scoring',()=>{
 for(const at of [null,NaN,Infinity,0,99999,121001,'100100']){
  const f=fixture();f.lease.expectedTickAt=at;f.cycle.at=120000;
  assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);
 }
});
test('interrupted attempts remain unscored even when the next tick arrives on schedule',()=>{
 for(const stopReason of ['disabled','expired-or-orphaned','Participant set changed']){
  const f=fixture();Object.assign(f.lease,{stoppedAt:100050,stopReason});
  assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);
 }
 const f=fixture();Object.assign(f.lease,{stoppedAt:100100,stopReason:'observed-tick'});
 assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,true);
});
test('legacy leases retain interval scoring and reset protections',()=>{
 const f=fixture();delete f.lease.expectedTickAt;f.cycle.at=120000;
 assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,true);
 f.cycle.at=100100;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope)[0].scored,false);
 f.scope.augReset++;assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope),null);
});
function native(){
 const now=Date.now(),files={},calls=[],members=Array.from({length:12},(_,i)=>({name:'M'+i,def:1000,upgrades:[],augmentations:[]}));
 const g={faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0};
 const q={engage:true,eventTimingRequired:true,expectedTickAt:now+1000,observationForecast:{wallSeconds:20},ownerPid:7,nodeReset:1,augReset:2,at:now,deadline:now+5000,faction:'Own',power:22000,territory:.2,signature:gangAttritionSignature(members),rivals:[{name:'R',power:10000}]};
 const ns={args:[7],read:p=>files[p]||'',write:(p,v)=>files[p]=v,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),gang:{getGangInformation:()=>g,getMemberNames:()=>members.map(m=>m.name),getMemberInformation:n=>members.find(m=>m.name===n),getAllGangInformation:()=>({R:{power:10000,territory:.8}}),setTerritoryWarfare:v=>calls.push(v)}};
 return {ns,q,files,calls};
}
test('serialized native dispatch stores the exact target event',()=>{
 const f=native(),start=Function('return ('+startGangAttrition.toString()+')')();
 assert.equal(start(f.ns,f.q,()=>true),true);
 assert.equal(JSON.parse(f.files['tasks/gang-attrition.json']).expectedTickAt,f.q.expectedTickAt);
 assert.deepEqual(f.calls,[true]);
});
test('native dispatch rejects missing, passed, impossible and post-deadline events',()=>{
 for(const mutate of [f=>delete f.q.expectedTickAt,f=>f.q.expectedTickAt=Date.now()-1,f=>f.q.expectedTickAt=NaN,f=>f.q.expectedTickAt=f.q.deadline+1,f=>f.q.observationForecast.wallSeconds=NaN,f=>f.q.observationForecast.wallSeconds=21,f=>{f.q.observationForecast.wallSeconds=.8;f.q.expectedTickAt=Date.now()+3000;}]){
  const f=native();mutate(f);assert.equal(startGangAttrition(f.ns,f.q,()=>true),false);assert.deepEqual(f.calls,[]);
 }
});
test('controller sends the predicted event with mandatory native timing validation',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/eventTimingRequired:true,expectedTickAt:territoryNextTick/);
 assert.match(s,/observationForecast:quote.observationForecast/);
});
