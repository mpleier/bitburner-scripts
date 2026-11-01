import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewRoutePresentation,overviewCompletionHookNotice} from '../overview-safety-policy.js';
const format=ms=>Math.ceil(ms/1000)+'s';
test('route probes show their remaining budget and never present a completion forecast',()=>{
 const plan={policy:'milestone-probe',selected:'bladeburner',probe:{target:'Operation readiness',until:3000},routes:{bladeburner:{actionable:true,etaMs:5000}}};
 const p=overviewRoutePresentation(plan,format,1000);assert.equal(p.label,'BB probe 2s');assert.equal(p.confidence,'probe');assert.match(p.note,/not a completion forecast/);
 assert.equal(overviewRoutePresentation(plan,format,4000).label,'BB probe ended');
});
test('finite estimates require actionable evidence and invalid durations remain blocked',()=>{
 const plan={selected:'hacking',routes:{hacking:{etaMs:12000,actionable:false}}};
 assert.equal(overviewRoutePresentation(plan,format).confidence,'provisional');plan.routes.hacking.actionable=true;
 assert.equal(overviewRoutePresentation(plan,format).confidence,'actionable');
 for(const etaMs of [-1,NaN,Infinity,null]){plan.routes.hacking.etaMs=etaMs;assert.equal(overviewRoutePresentation(plan,format).confidence,'blocked');}
});
test('completion holds appear only for this node and distinguish a running hook from an uncertain one',()=>{
 const reset={lastNodeReset:10};
 assert.match(overviewCompletionHookNotice({nodeReset:10,status:'uncertain',reason:'Interrupted claim'},reset),/Interrupted claim/);
 assert.match(overviewCompletionHookNotice({nodeReset:10,status:'claimed'},reset),/unconfirmed/);
 assert.match(overviewCompletionHookNotice({nodeReset:10,status:'started',pid:7},reset,[{pid:7}]),/is running/);
 assert.match(overviewCompletionHookNotice({nodeReset:10,status:'started',pid:7},reset,[]),/needs review/);
 assert.equal(overviewCompletionHookNotice({nodeReset:9,status:'uncertain'},reset),null);
 assert.equal(overviewCompletionHookNotice({nodeReset:10,status:'completed'},reset),null);
});
