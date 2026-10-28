import test from 'node:test';
import assert from 'node:assert/strict';
import {planHackingTargets,selectHackingTargetCandidates} from '../hacking-target-policy.js';
import {augmentationEconomicsChange} from '../augmentation-economics-policy.js';
const q=(name,projectedRate)=>({name,projectedRate,prepMs:1000,firstReceiptMs:2000,weakMs:1000});
const input=(now,candidates)=>({now,ownerPid:1,reset:{lastNodeReset:2,lastAugReset:3},current:'old',candidates});

test('small ranking fluctuations no longer starve a still-profitable confirmed switch',()=>{
 let p=null;
 for(let i=0;i<=12;i++)p=planHackingTargets(p,input(1000000+i*5000,[q('old',100),q('A',i%2?201:200),q('B',i%2?200:201)]));
 assert.equal(p.decision,'switch');assert.equal(p.preferred,'B');assert.equal(p.candidateSince,1000000);
});
test('materially better candidates reset confirmation and missing or unprofitable candidates cannot inherit it',()=>{
 const start=planHackingTargets(null,input(1000000,[q('old',100),q('A',200)]));
 const swapped=planHackingTargets(start,input(1005000,[q('old',100),q('A',200),q('B',1000)]));
 assert.equal(swapped.candidate,'B');assert.equal(swapped.candidateSince,1005000);
 for(const rows of [[q('old',100),q('B',201)],[q('old',100),q('A',110),q('B',201)]]){
  const p=planHackingTargets(start,input(1005000,rows));assert.equal(p.candidate,'B');assert.equal(p.candidateSince,1005000);
 }
 for(const patch of [{ownerPid:9},{reset:{lastNodeReset:2,lastAugReset:4}},{now:1020000}]){
  const p=planHackingTargets(start,{...input(1005000,[q('old',100),q('A',200)]),...patch});assert.notEqual(p.candidateSince,1000000);
 }
});
function market(rep=10000,at=1000000){return {version:1,complete:true,at,nodeReset:2,augReset:3,watch:{},joined:['A'],favorToDonate:150,repMultiplier:1,quotes:{Target:{price:1000,rep:100000}},factions:{A:{rep,favor:150,joined:true,thresholds:[100000]}}};}
test('routine rising-reputation funding changes coalesce for thirty seconds without sliding the baseline',()=>{
 const before=market(),after=market(25000,1029999),options={repRefreshMs:30000};
 assert.equal(augmentationEconomicsChange(before,after,options).changed,false);
 assert.equal(augmentationEconomicsChange(before,{...after,at:1030000},options).changed,true);
 assert.equal(augmentationEconomicsChange(before,after).changed,true);
 assert.equal(augmentationEconomicsChange(before,{...after,at:1030000},{repRefreshMs:Infinity}).changed,true);
 assert.equal(augmentationEconomicsChange(before,{...after,at:1030000},{repRefreshMs:1e9}).changed,true);
 assert.equal(before.at,1000000);
});
test('funding refresh coalescing never masks unlocks, prices, resets, favor, membership or reputation loss',()=>{
 const before=market(),options={repRefreshMs:30000};
 for(const after of [market(100001,1000001),market(5000,1000001),{...market(),augReset:4},{...market(),quotes:{Target:{price:999,rep:100000}}},{...market(),joined:[]},{...market(),repMultiplier:2},{...market(),factions:{A:{...market().factions.A,favor:151}}}])assert.equal(augmentationEconomicsChange(before,after,options).changed,true);
});

test('confirming candidate keeps an early quote slot outside the changing shortlist',()=>{const rows=Array.from({length:25},(_,i)=>({name:'s'+i,isPrepped:()=>false,time:i+1}));const selected=selectHackingTargetCandidates(rows,'s0',s=>s.time,'s24');assert.equal(selected.length,9);assert.equal(selected[1].name,'s24');assert.equal(new Set(selected.map(s=>s.name)).size,9);});
