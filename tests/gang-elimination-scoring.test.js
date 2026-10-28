import test from 'node:test';
import assert from 'node:assert/strict';
import {observeGangAttrition,gangClashUncertainty,gangAttritionCalibration} from '../gang-attrition-policy.js';

const signature=g=>JSON.stringify(Object.entries(g).sort(([a],[b])=>a.localeCompare(b)).map(([name,v])=>[name,v.power,v.territory]));
function fixture(native=false){
 const scope={ownerPid:7,nodeReset:1,augReset:2,faction:'Own'};
 const w={power:22000,territory:.999999,rivals:[{name:'R',power:10000,territory:.000001}]};
 const expected={power:22100,territory:.9999998,rivals:[{name:'R',power:9950,territory:.0000002}]};
 const lease={...scope,startedAt:100000,expectedTickAt:100100,deadline:122000,observationForecast:{wallSeconds:20,expected:[expected,structuredClone(expected),structuredClone(expected)],uncertainty:gangClashUncertainty(w,22100)}};
 const cycle={at:100100,info:{faction:'Own',power:22100,territory:1},others:{Own:{power:22100,territory:1},R:{power:9950,territory:0}}};
 let receipt=null;
 if(native){
  Object.assign(lease,{monitorRequired:true,monitorPid:8,observationSignature:signature({Own:{power:22000,territory:.999999},R:{power:10000,territory:.000001}}),state:'cooldown',stopReason:'observed-tick',stoppedAt:100100});
  receipt={kind:'native-update-v1',state:'observed',...scope,startedAt:100000,observerPid:8,baselineSignature:lease.observationSignature,observedSignature:signature(cycle.others),at:100100,processedMs:2000,updates:1,largestUpdateMs:2000,info:cycle.info,others:cycle.others};
 }
 return {scope,lease,cycle,receipt};
}
const observe=f=>observeGangAttrition(f.lease,f.cycle,f.scope,[],f.receipt);

test('the last rival retains its zero-territory outcome and completes a scored observation',()=>{
 const f=fixture(),row=observe(f)[0];
 assert.equal(row.scored,true);assert.deepEqual(row.eliminatedRivals,['R']);assert.equal(row.rivals.length,1);
 assert.equal(row.rivals[0].name,'R');assert.equal(row.rivals[0].territory.actual,0);assert.equal(row.rivals[0].power.actual,9950);
 assert.equal(row.rivals[0].territory.insidePredictiveRange,true);
 const result=gangAttritionCalibration([row,{...row,key:'second',at:100101}],f.scope,100101);
 assert.equal(result.samples,2);assert.equal(result.misses,0);assert.equal(result.suspended,false);
});
test('a native first-event receipt preserves an elimination even when the controller sees later state',()=>{
 const f=fixture(true);f.cycle={at:110000,info:{faction:'Own',power:23000,territory:1},others:{}};
 const row=observe(f)[0];assert.equal(row.scored,true);assert.equal(row.at,100100);assert.equal(row.power.actual,22100);assert.deepEqual(row.eliminatedRivals,['R']);
 assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope,[row],f.receipt),null);
});
test('missing rivals are not fabricated as defeated and malformed finals remain unscored',()=>{
 for(const value of [undefined,null,{power:NaN,territory:0},{power:0,territory:0},{power:9950,territory:-1},{power:9950,territory:'0'},{power:9950,territory:Infinity}]){
  const f=fixture();if(value===undefined)delete f.cycle.others.R;else f.cycle.others.R=value;
  const row=observe(f)[0];assert.equal(row.scored,false);assert.equal(row.rivals,undefined);assert.equal(row.eliminatedRivals,undefined);
 }
 const f=fixture();f.cycle.others=Object.create({R:{power:9950,territory:0}});assert.equal(observe(f)[0].scored,false);
});
test('a newly active or malformed extra gang invalidates the cohort; dormant gangs are harmless',()=>{
 for(const value of [{power:50,territory:.1},null,{power:NaN,territory:0},{power:50,territory:-1}]){
  const f=fixture();f.cycle.others.New=value;assert.equal(observe(f)[0].scored,false);
 }
 for(const power of [0,50]){const f=fixture();f.cycle.others.Dormant={power,territory:0};assert.equal(observe(f)[0].scored,true);assert.deepEqual(observe(f)[0].eliminatedRivals,['R']);}
});
test('all growth scenarios must identify the same unique rival cohort',()=>{
 for(const mutate of [f=>f.lease.observationForecast.expected[1].rivals[0].name='Other',f=>f.lease.observationForecast.expected[1].rivals=[],f=>f.lease.observationForecast.expected[0].rivals.push({...f.lease.observationForecast.expected[0].rivals[0]}),f=>f.lease.observationForecast.expected[0].rivals[0].name='Own',f=>f.lease.observationForecast.expected[0].rivals[0].name=undefined]){
  const f=fixture();mutate(f);assert.equal(observe(f),null);
 }
});
test('partial intervals, interrupted attempts, reset mismatch and missing receipts remain protected',()=>{
 const early=fixture();early.cycle.at=100900;assert.equal(observe(early)[0].scored,false);
 const interrupted=fixture();Object.assign(interrupted.lease,{stoppedAt:100050,stopReason:'disabled'});assert.equal(observe(interrupted)[0].scored,false);
 const reset=fixture();reset.scope.augReset++;assert.equal(observe(reset),null);
 const missing=fixture(true);missing.receipt=null;assert.equal(observe(missing),null);
});
test('a mismatched player entry cannot turn an inconsistent snapshot into a valid elimination',()=>{
 const f=fixture();f.cycle.others.Own={power:22000,territory:1};assert.equal(observe(f)[0].scored,false);
});
test('multiple eliminations and surviving rivals remain in deterministic forecast order',()=>{
 const f=fixture();delete f.lease.observationForecast.uncertainty;
 for(const expected of f.lease.observationForecast.expected){expected.rivals=[{name:'Z',power:30,territory:.2},{name:'R',power:90,territory:.2},{name:'A',power:40,territory:.1}];expected.territory=.5;}
 f.cycle.info.territory=.8;f.cycle.others={A:{power:40,territory:0},R:{power:90,territory:.2},Z:{power:30,territory:0}};
 const row=observe(f)[0];assert.equal(row.scored,true);assert.deepEqual(row.rivals.map(r=>r.name),['Z','R','A']);assert.deepEqual(row.eliminatedRivals,['Z','A']);
});
test('favorable elimination does not hide unrelated adverse power errors',()=>{
 const f=fixture();f.cycle.info.power=20000;f.cycle.others.Own.power=20000;
 const row=observe(f)[0],result=gangAttritionCalibration([row,{...row,key:'second',at:100101}],f.scope,100101);
 assert.equal(row.scored,true);assert.equal(result.misses,2);assert.equal(result.suspended,true);
});
