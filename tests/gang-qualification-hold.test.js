import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gangQualificationHold} from '../gang-qualification-hold-policy.js';

const reset={nodeReset:10,augReset:20};
const record={schemaVersion:2,at:100000,since:100000,ownerPid:5,nodeReset:10,augReset:20,host:'Speakers for the Dead'};
const valid={now:100000,ownerAlive:true,gang:false,nodeReset:10,augReset:20};

test('a fresh reset-scoped hold owned by a live qualifier blocks installs',()=>{
 assert.deepEqual(gangQualificationHold(record,valid),{host:'Speakers for the Dead',at:100000,since:100000});
});

test('a gang, dead owner or missing record cannot hold installs',()=>{
 assert.equal(gangQualificationHold(record,{...valid,gang:true}),null);
 assert.equal(gangQualificationHold(record,{...valid,ownerAlive:false}),null);
 for(const value of [null,undefined,{},'text',42])assert.equal(gangQualificationHold(value,valid),null);
});

test('expired, future and other-reset holds are rejected',()=>{
 assert.equal(gangQualificationHold(record,{...valid,now:100000+30*60*1000+1}),null);
 assert.equal(gangQualificationHold(record,{...valid,now:99999}),null);
 assert.equal(gangQualificationHold(record,{...valid,nodeReset:11}),null);
 assert.equal(gangQualificationHold(record,{...valid,augReset:21}),null);
 assert.equal(gangQualificationHold(record,{...valid,now:100000+5*60*1000,maxAgeMs:4*60*1000}),null);
});

test('malformed hosts and schemas cannot hold installs',()=>{
 for(const host of ['', '   ', null, 7, 'x'.repeat(65)])
  assert.equal(gangQualificationHold({...record,host},valid),null);
 // Schema 1 holds carried no window start, so they are inert: a legacy file cannot stall installs.
 for(const schemaVersion of [undefined,1,'2'])
  assert.equal(gangQualificationHold({...record,schemaVersion},valid),null);
});

test('a hold is a bounded delay, not an indefinite veto on installs',()=>{
 // Freshly started: blocks, and reports when the window opened.
 assert.deepEqual(gangQualificationHold({...record,since:100000},valid),{host:'Speakers for the Dead',at:100000,since:100000});
 // A renewed hold (fresh `at`) whose window opened over three hours ago must not block installs further.
 const renewed=100000+4*60*60*1000; // four hours after the window opened, still freshly renewed
 assert.equal(gangQualificationHold({...record,at:renewed,since:100000},{...valid,now:renewed}),null);
 assert.equal(gangQualificationHold({...record,at:renewed,since:100000},{...valid,now:renewed,maxHoldMs:10*60*60*1000})?.host,'Speakers for the Dead');
 // A hold must state when its window opened; without it nothing is assumed.
 assert.equal(gangQualificationHold({...record,since:undefined},valid),null);
 assert.equal(gangQualificationHold({...record,since:'soon'},valid),null);
});

test('the qualifier carries the original window start across renewals',async()=>{
 const faction=(await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 assert.match(faction,/let since = Date\.now\(\);/);
 assert.match(faction,/prior\?\.schemaVersion === 2 && prior\.nodeReset === reset\.lastNodeReset && prior\.augReset === reset\.lastAugReset/);
 assert.match(faction,/schemaVersion: 2, at: Date\.now\(\), since, ownerPid: ns\.pid/);
});

test('the qualifier publishes the hold, but it never gates an install',async()=>{
 const faction=(await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 assert.match(faction,/await writeGangQualificationHold\(ns, gangPlan\.inviteOrder\[0\]\)/);
 assert.match(faction,/tasks\/gang-qualification-hold\.json/);
 const autopilot=(await readFile(new URL('../autopilot.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 // The record stays published for diagnostics, but no install path may consult it.
 assert.doesNotMatch(autopilot,/gangQualificationHold/);
 assert.doesNotMatch(autopilot,/Holding augmentation installs until the gang host invitation/);
 assert.match(autopilot,/informational only: an install must never wait on a gang host/);
});
