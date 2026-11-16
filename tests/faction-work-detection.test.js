import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {measuredWorkType,overgrindTarget} from '../faction-policy.js';

// The rep-rate probe is under 450ms while engine lag under a big XP farm is routinely a second or more, so a
// zero sample means "no game tick landed in the window" — not that the faction supports no work type.
test('a zero rep-rate sample keeps the work already running instead of declaring the faction unsupported',()=>{
 assert.deepEqual(measuredWorkType([{work:'field',rate:0},{work:'security',rate:0},{work:'hacking',rate:0}],{factionWorkType:'security'}),
  {work:'security',measured:false});
 assert.deepEqual(measuredWorkType([{work:'field',rate:0},{work:'hacking',rate:44}],{factionWorkType:'security'}),
  {work:'hacking',measured:true});
 // Nothing running and nothing measured is the only genuine "no work type" answer.
 assert.equal(measuredWorkType([{work:'field',rate:0}],{factionWorkType:''}),null);
 assert.equal(measuredWorkType([],null),null);
 // Malformed samples cannot win the comparison.
 assert.deepEqual(measuredWorkType([{work:'field',rate:NaN},{work:'security',rate:-1},{work:'hacking',rate:undefined}],{factionWorkType:'field'}),
  {work:'field',measured:false});
});

test('the overgrind target is fixed per generation instead of receding with the live value',()=>{
 const key='Bachman & Associates/2';
 const first=overgrindTarget(null,45e6,1.05,key);
 assert.equal(first,Math.ceil(45e6*1.05));
 // The same saved record must answer the same target however much rep has grown since.
 assert.equal(overgrindTarget({key,target:first},46e6,1.05,key),first);
 assert.equal(overgrindTarget({key,target:first},48.596853e6,1.05,key),first);
 // A new generation (or another faction) recomputes from its own live value, and never below 1000.
 assert.equal(overgrindTarget({key,target:first},10,1.05,'Bachman & Associates/3'),1000);
 assert.equal(overgrindTarget({key:'other/2',target:first},10,1.05,key),1000);
 assert.equal(overgrindTarget({key,target:0},2e6,1.05,key),Math.ceil(2e6*1.05));
});

test('the work loop routes detection through the fallback and stops re-deriving the grind target',()=>{
 const source=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8');
 assert.match(source,/detectBestFactionWork\(ns, factionName, currentWork\)/);
 assert.match(source,/measuredWorkType\(samples, currentWork\)/);
 assert.match(source,/overgrindTarget\(overgrindRecord, overgrindRep, 1\.05, overgrindKey\)/);
 // The treadmill line recomputed the target from the live reputation on every pass.
 assert.doesNotMatch(source,/1000 \+ \(await getFactionReputation\(ns, mostFavorFaction\)\) \* 1\.05/);
});
