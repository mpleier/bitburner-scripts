import test from 'node:test';
import assert from 'node:assert/strict';
import {gangEarlyFundingAnchor} from '../gang-stat-policy.js';
const assignments={A:'Respect',B:'Respect',C:'Respect',D:'Respect'};
const selectAnchor=(r,f,p=[],now=1000)=>gangEarlyFundingAnchor(r,{...f,early:{reviewed:true,cash:f.cash,target:f.target,...f.early}},p,now,assignments);
const funding={known:true,at:1000,expiresAt:31000,cash:0,target:10000,externalCashRate:0};
const rates=()=>Object.fromEntries(['A','B','C','D'].map(n=>[n,[{name:'Respect',respect:10,money:0,wanted:0,stats:1},{name:'Cash',respect:0,money:n==='D'?100:10,wanted:0,stats:0}]]));
test('one efficient worker can fund a concrete gap while preserving recruitment output',()=>{const q=selectAnchor(rates(),funding,[],1000);assert.equal(q.name,'D');assert.equal(q.task,'Cash');assert.equal(q.gap,10000);assert.notEqual(selectAnchor(rates(),funding,['D'],1000).name,'D');});
test('funding ends when covered, stale, unknown, or quickly supplied externally',()=>{for(const f of [{cash:10000},{known:false},{at:-40000},{expiresAt:999},{externalCashRate:100},{target:NaN},{cash:-1}])assert.equal(selectAnchor(rates(),{...funding,...f},[],1000),null);});
test('small crews, protected members, wanted-producing tasks and excessive respect loss are excluded',()=>{assert.equal(selectAnchor({A:rates().A},funding,[],1000),null);assert.equal(selectAnchor(rates(),funding,['A','B','C','D'],1000),null);const r=rates();for(const rows of Object.values(r))rows[1].wanted=1;assert.equal(selectAnchor(r,funding,[],1000),null);const concentrated=rates();concentrated.D[0].respect=1000;for(const n of ['A','B','C'])concentrated[n][1].money=0;assert.equal(selectAnchor(concentrated,funding,[],1000),null);});

test('unreviewed targets and unchanged income cannot activate a cash worker',()=>{
 assert.equal(selectAnchor(rates(),{...funding,early:{reviewed:false}}),null);
 const r=rates();for(const rows of Object.values(r))rows[0].money=1000;
 assert.equal(selectAnchor(r,funding),null);
});
test('actual crew income covers nearby goals and actual respect limits losses',()=>{
 const r=rates();for(const rows of Object.values(r))rows[0].money=10;
 assert.equal(selectAnchor(r,{...funding,target:100}),null);
 const mixed={A:'Respect',B:'Cash',C:'Cash',D:'Cash'};
 assert.equal(gangEarlyFundingAnchor(rates(),{...funding,early:{reviewed:true,cash:0,target:1000000}},[],1000,mixed),null);
 assert.equal(gangEarlyFundingAnchor(rates(),{...funding,early:{reviewed:true,cash:0,target:10000}},[],1000,{}),null);
});
