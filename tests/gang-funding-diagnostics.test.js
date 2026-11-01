import test from 'node:test';
import assert from 'node:assert/strict';
import {gangFundingETA,gangReserveOwnership,readGangFunding} from '../gang-funding-diagnostics-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
test('funding time accounts for finite bonus and duty and credits external income once',()=>{
 assert.equal(gangFundingETA(1000,10,10,0,240),4);
 assert.equal(gangFundingETA(3000,10,10,0,240),60);
 assert.equal(gangFundingETA(1000,0,0,10,240),100);
 assert.equal(gangFundingETA(1000,5,5,0,0),200);
 assert.equal(gangFundingETA(1000,0,0),Infinity);
});
test('reserve ownership requires matching live provenance',()=>{
 const at=1000,r={amount:100,nodeReset:1,augReset:2,at,expiresAt:2000,purpose:'augmentation-install-basket'};
 const c={amount:100,nodeReset:1,augReset:2,now:at,ownerRunning:true};
 assert.equal(gangReserveOwnership(r,c).purpose,r.purpose);
 for(const change of [{amount:101},{ownerRunning:false},{augReset:3},{now:2001}])assert.equal(gangReserveOwnership(r,{...c,...change}).purpose,'unknown');
});
test('compact diagnostics reject stale snapshots and expose bounded current data',()=>{
 const now=Date.now(),r={at:now,ownerPid:1,nodeReset:1,augReset:2,gap:100};
 const ns={read:p=>p.endsWith('gang-funding.json')?JSON.stringify(r):'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),isRunning:()=>true};
 assert.equal(readGangFunding(ns).gap,100);r.nodeReset=0;assert.equal(readGangFunding(ns).state,'stale');
 const job=renderCommandJob({id:'funding-qc',method:'automation.gangFunding',args:[],expiresAt:now+60000});assert.ok(job);
 assert.match(job,/boundedDiagnostics/);
});
