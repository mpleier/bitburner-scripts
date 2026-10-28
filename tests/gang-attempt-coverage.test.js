import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileGangAttempts,gangAttritionTimingStatus,publishGangAttemptCoverage,gangAttritionCalibration} from '../gang-attrition-policy.js';

const now=100000,scope={ownerPid:7,nodeReset:1,augReset:2,faction:'Own'};
function lease(patch={}){return {...scope,monitorRequired:true,monitorPid:8,startedAt:90000,deadline:112000,observationSignature:'baseline',state:'active',...patch};}
function receipt(q,state='timeout',patch={}){return {kind:'native-update-v1',ownerPid:q.ownerPid,nodeReset:q.nodeReset,augReset:q.augReset,startedAt:q.startedAt,observerPid:q.monitorPid,baselineSignature:q.observationSignature,state,at:now,...patch};}
const attempt=(q,state='timeout')=>reconcileGangAttempts([],q,receipt(q,state),scope,now)[0];
const scored=a=>({key:a.observationKey,ownerPid:a.ownerPid,observerPid:a.observerPid,nodeReset:a.nodeReset,augReset:a.augReset,faction:a.faction,at:now,scored:true,timingBasis:'native-update',timingErrorMs:100});

test('a pending attempt is durably keyed and repeated polling does not duplicate it',()=>{
 const q=lease(),rows=reconcileGangAttempts([],q,null,scope,now);
 assert.equal(rows.length,1);assert.equal(rows[0].state,'pending');assert.equal(rows[0].observerPid,8);
 assert.deepEqual(reconcileGangAttempts(rows,q,null,scope,now+1000),rows);
});
test('every terminal monitor outcome is counted once, including timeouts and interruptions',()=>{
 for(const state of ['observed','timeout','interrupted','ambiguous-start','ambiguous-interval','invalid-update','invalid-snapshot','update-limit','error']){
  const q=lease(),r=receipt(q,state),rows=reconcileGangAttempts([],q,r,scope,now);
  assert.equal(rows.length,1);assert.equal(rows[0].state,state);assert.equal(rows[0].source,'receipt');
  assert.deepEqual(reconcileGangAttempts([...rows,...rows],q,r,scope,now+1),rows);
 }
});
test('missing final receipts become unknown outcomes after a grace interval and can be reconciled later',()=>{
 const q=lease(),pending=reconcileGangAttempts([],q,null,scope,now);
 assert.equal(reconcileGangAttempts(pending,q,null,scope,q.deadline+2000)[0].state,'pending');
 const lost=reconcileGangAttempts(pending,q,null,scope,q.deadline+2001);
 assert.equal(lost[0].state,'missing-receipt');assert.equal(lost[0].source,'expired');
 const resolved=reconcileGangAttempts(lost,q,receipt(q,'observed',{at:q.deadline}),scope,q.deadline+2002);
 assert.equal(resolved[0].state,'observed');assert.equal(resolved[0].source,'receipt');
});
test('a stopped lease is counted as interrupted and a final receipt refines the reason',()=>{
 const q=lease({state:'cooldown',stopReason:'disabled',stoppedAt:95000});
 const rows=reconcileGangAttempts([],q,null,scope,now);assert.equal(rows[0].state,'interrupted');
 assert.equal(reconcileGangAttempts(rows,q,receipt(q,'error'),scope,now)[0].state,'error');
 const observed=lease({state:'cooldown',stopReason:'observed-tick',stoppedAt:95000});
 assert.equal(reconcileGangAttempts([],observed,null,scope,now)[0].state,'pending');
});
test('foreign, future and mismatched receipts cannot finish an attempt',()=>{
 const q=lease();
 for(const patch of [{ownerPid:9},{observerPid:9},{nodeReset:9},{augReset:9},{startedAt:1},{baselineSignature:'other'},{kind:'unknown'},{state:'unknown'},{at:now+1},{at:q.startedAt-1}]){
  assert.equal(reconcileGangAttempts([],q,receipt(q,'observed',patch),scope,now)[0].state,'pending');
 }
});
test('controller restarts retain the same run while node, augmentation and faction changes isolate history',()=>{
 const q=lease(),rows=reconcileGangAttempts([],q,receipt(q),scope,now);
 assert.deepEqual(reconcileGangAttempts(rows,null,null,{...scope,ownerPid:99},now+1),rows);
 for(const patch of [{nodeReset:3,augReset:4},{augReset:3},{faction:'Other'}])assert.deepEqual(reconcileGangAttempts(rows,q,receipt(q),{...scope,...patch},now),[]);
});
test('distinct monitor generations do not share outcomes',()=>{
 const first=lease(),rows=reconcileGangAttempts([],first,receipt(first),scope,now),second=lease({monitorPid:9});
 const result=reconcileGangAttempts(rows,second,receipt(first),scope,now);
 assert.equal(result.length,2);assert.equal(result.find(r=>r.observerPid===8).state,'timeout');assert.equal(result.find(r=>r.observerPid===9).state,'pending');
});
test('coverage uses unique attempts, includes pending and failed attempts, and separates completed coverage',()=>{
 const good=attempt(lease(),'observed'),bad=attempt(lease({monitorPid:9})),pending=reconcileGangAttempts([],lease({monitorPid:10}),null,scope,now)[0];
 const status=gangAttritionTimingStatus([scored(good),scored(good),scored(bad)],null,null,scope,now,[good,bad,pending]);
 assert.equal(status.attemptCount,3);assert.equal(status.completedAttempts,2);assert.equal(status.pendingAttempts,1);assert.equal(status.failedAttempts,1);assert.equal(status.scoredAttempts,1);
 assert.equal(status.attemptCoverage,1/3);assert.equal(status.completedCoverage,.5);assert.equal(status.unscoredCompletedAttempts,1);assert.deepEqual(status.outcomeCounts,{observed:1,pending:1,timeout:1});
});
test('captured but unscored receipts and unmatched generations do not count as usable observations',()=>{
 const q=lease(),a=attempt(q,'observed');
 const status=gangAttritionTimingStatus([{...scored(a),observerPid:999},{...scored(a),scored:false}],null,null,scope,now,[a]);
 assert.equal(status.observedAttempts,1);assert.equal(status.scoredAttempts,0);assert.equal(status.completedCoverage,0);
 assert.equal(gangAttritionTimingStatus([],null,null,scope,now,[]).attemptCoverage,null);
});
test('ledger retention is bounded, scoped, deterministic and resistant to corrupt entries',()=>{
 const rows=Array.from({length:100},(_,i)=>attempt(lease({startedAt:50000+i,deadline:72000+i,monitorPid:20+i})));
 const result=reconcileGangAttempts([...rows,{...rows[0],key:'bad'},{...rows[0],startedAt:now+1},null],null,null,scope,now);
 assert.equal(result.length,64);assert.equal(result[0].startedAt,50036);assert.equal(result.at(-1).startedAt,50099);
 assert.deepEqual(reconcileGangAttempts('corrupt',null,null,scope,now),[]);
 assert.deepEqual(reconcileGangAttempts(rows,null,null,scope,now+21600000),[]);
 assert.deepEqual(reconcileGangAttempts(rows,null,null,{...scope,augReset:NaN},now),[]);
});
test('completed receipts cannot regress to pending when the current receipt file disappears',()=>{
 const q=lease(),rows=reconcileGangAttempts([],q,receipt(q,'observed'),scope,now);
 assert.deepEqual(reconcileGangAttempts(rows,q,null,scope,now+1),rows);
 assert.deepEqual(reconcileGangAttempts(rows,null,null,scope,now+1),rows);
});
test('corrupt outcome provenance cannot replace a completed receipt or invent completed attempts',()=>{
 const row=attempt(lease(),'timeout');
 for(const patch of [{state:'pending',source:'receipt'},{state:'observed',source:'lease'},{state:'observed',source:'expired'},{state:'missing-receipt',source:'receipt'}]){
  const corrupt={...row,...patch};
  assert.deepEqual(reconcileGangAttempts([corrupt],null,null,scope,now),[]);
  assert.deepEqual(reconcileGangAttempts([row,corrupt],null,null,scope,now),[row]);
 }
});
test('publisher alone writes the ledger and timing report, never calibration observations',async()=>{
 const q=lease(),files={'tasks/gang-attrition.json':JSON.stringify(q),'tasks/gang-attrition-event.json':JSON.stringify(receipt(q))},writes=[];
 const ns={read:p=>files[p]||'',write:async(p,v)=>{files[p]=v;writes.push(p);}};
 await publishGangAttemptCoverage(ns,scope,now);await publishGangAttemptCoverage(ns,scope,now+1);
 assert.equal(writes.filter(p=>p==='tasks/gang-attrition-attempts.json').length,1);
 assert.equal(JSON.parse(files['tasks/gang-attrition-timing.json']).failedAttempts,1);
 assert.equal(writes.some(p=>p==='tasks/gang-attrition-observations.json'),false);
 assert.equal(gangAttritionCalibration(JSON.parse(files['tasks/gang-attrition-attempts.json']),scope,now).samples,0);
});
test('publisher records receipts without needing another territory tick and integrates with controller cadence',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/tickObserved\|\|thisLoopStart>=\(mainLoop.nextAttritionCoverageAt\|\|0\)/);
 assert.match(source,/nextAttritionCoverageAt=thisLoopStart\+2000/);assert.match(source,/await publishGangAttemptCoverage\(ns,/);
 assert.equal((source.match(/gang-attrition-timing.json/g)||[]).length,0);
 const monitor=readFileSync(new URL('../gang-event-monitor.js',import.meta.url),'utf8');assert.equal(monitor.includes('gang-attrition-attempts.json'),false);
});
test('reporting failures back off for a minute even when territory ticks keep arriving',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('    if((tickObserved||thisLoopStart>=(mainLoop.nextAttritionCoverageAt||0))'),end=source.indexOf('    // Recruitment is independent',start);
 assert.ok(start>=0&&end>start);
 let calls=0;const mainLoop={},warnings=[],ns={pid:7,print:s=>warnings.push(s)};
 const run=Function('mainLoop','publishGangAttemptCoverage',`return async function(thisLoopStart,tickObserved,ns){const resetInfo={lastNodeReset:1,lastAugReset:2},myGangFaction='Own';${source.slice(start,end)}}`)(mainLoop,async()=>{calls++;throw Error('temporary write failure');});
 await run(100,true,ns);await run(200,true,ns);await run(60099,true,ns);assert.equal(calls,1);assert.equal(warnings.length,1);
 await run(60100,true,ns);assert.equal(calls,2);assert.equal(warnings.length,2);
});
