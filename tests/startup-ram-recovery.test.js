import test from 'node:test';
import assert from 'node:assert/strict';
import {startupChargeRamTarget,affordableRouteSnapshot,startupPendingRam} from '../startup-ram-policy.js';
test('startup capacity breaks pending-manager and charging circular wait',()=>{
 assert.equal(startupChargeRamTarget({maximum:128,used:95,pending:107}),512);
 assert.equal(startupChargeRamTarget({maximum:512,used:95,pending:107}),null);
 assert.equal(startupChargeRamTarget({maximum:128,used:20,pending:0}),null);
 assert.equal(startupChargeRamTarget({maximum:128,used:NaN,pending:107}),null);
});
test('route snapshot selects only a compiled worker that fits current free RAM',async()=>{
 let source='',writes=0;const ns={write:async(_f,v)=>{source=v;writes++;},getScriptRam:()=>source.includes('full')?64.8:source.includes('singularity')?40:4,getServerMaxRam:()=>128,getServerUsedRam:()=>95};
 const variants=['full','singularity','basic'].map(source=>({source}));const q=await affordableRouteSnapshot(ns,variants);assert.equal(q.source,'basic');assert.equal(writes,3);
 ns.getServerUsedRam=()=>60;assert.equal((await affordableRouteSnapshot(ns,variants)).source,'full');
 ns.getServerUsedRam=()=>126;assert.equal(await affordableRouteSnapshot(ns,variants),null);
});

test('started managers no longer keep their provisional RAM reservation',()=>{
 const rows=[{script:'a.js',ram:100,state:'waiting-for-ram'},{script:'b.js',ram:20,state:'waiting-for-activity'},{script:'c.js',ram:300,state:'needs-home-ram'}];
 assert.equal(startupPendingRam(rows,[{filename:'/a.js'}],8),28);assert.equal(startupPendingRam(rows,[{filename:'a.js'},{filename:'b.js'}],8),8);
});
