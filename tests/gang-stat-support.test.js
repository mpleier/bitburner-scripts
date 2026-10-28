import test from 'node:test';
import assert from 'node:assert/strict';
import {gangStatSupportCrew} from '../gang-stat-policy.js';
const train={name:'Train Combat',stats:100,respect:0,wanted:0};
const rates={A:[train,{name:'Terrorism',stats:0,respect:10,wanted:2}],B:[train,{name:'Vigilante Justice',stats:0,respect:0,wanted:-20}],C:[train]};
const bad={respect:875,wantedLevel:7140};
test('high wanted pairs a positive-wanted respect task with justice while limiting the crew to two',()=>{
 const p=gangStatSupportCrew(rates,bad);assert.deepEqual(p.assignments,{A:'Terrorism',B:'Vigilante Justice'});assert.equal(p.respect,10);assert.equal(p.wanted,-18);assert.equal(p.recovering,true);assert.ok(p.wanted<=p.target);
});
test('manual and mandatory recovery locks are never taken for support',()=>{
 assert.equal(gangStatSupportCrew(rates,bad,['A','B']),null);
 const p=gangStatSupportCrew(rates,bad,['A']);assert.deepEqual(p.assignments,{B:'Vigilante Justice'});
});
test('unachievable recovery target still makes progress without permitting wanted growth',()=>{
 const p=gangStatSupportCrew({...rates,B:[train,{name:'Vigilante Justice',respect:0,wanted:-3}]},bad);assert.equal(p.wanted,-1);assert.equal(p.respect,10);
 const onlyJustice=gangStatSupportCrew({...rates,B:[train,{name:'Vigilante Justice',respect:0,wanted:-1}]},bad);assert.deepEqual(onlyJustice.assignments,{B:'Vigilante Justice'});
});
test('a healthy penalty retains respect without unnecessary justice and uses a partner when needed',()=>{
 const healthy={respect:10000,wantedLevel:1};
 const p=gangStatSupportCrew({...rates,A:[train,{name:'Safe',respect:10,wanted:0}]},healthy);assert.deepEqual(p.assignments,{A:'Safe'});
 const pair=gangStatSupportCrew(rates,healthy);assert.equal(pair.wanted,-18);assert.equal(Object.keys(pair.assignments).length,2);
});
test('invalid task rates never create an unsafe or nonproductive assignment',()=>{
 assert.equal(gangStatSupportCrew({A:[train,{name:'Crime',respect:NaN,wanted:2}],B:[{name:'Justice',respect:0,wanted:NaN}]},bad),null);
});
