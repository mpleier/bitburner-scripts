import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitNodePriorities, planBitNodePriority, sourceFileLevels } from '../bitnode-priority.js';

test('fresh-save progression starts with affordable Singularity automation',()=>{
 const plan=planBitNodePriority({},1);
 assert.equal(plan.nextBn,4);assert.equal(plan.recommended.targetLevel,3);assert.equal(plan.projectedLevels[1],1);
});
test('current run completion advances its level and skips achieved targets',()=>{
 const owned={1:1,4:2};
 const plan=planBitNodePriority(owned,4);
 assert.equal(plan.nextBn,1);assert.equal(plan.recommended.targetLevel,2);assert.equal(plan.projectedLevels[4],3);
 assert.deepEqual(owned,{1:1,4:2});
 const repeated=planBitNodePriority({4:3},4);
 assert.equal(repeated.projectedLevels[4],3);
});
test('all supported finite Source Files are covered with explicit increasing integer targets',()=>{
 const levels={};
 for(const step of bitNodePriorities){
  assert.ok(Number.isInteger(step.node)&&step.node>=1&&step.node<=15&&step.node!==12);
  assert.ok(Number.isInteger(step.targetLevel)&&step.targetLevel>=(levels[step.node]||0)&&step.targetLevel<=3);
  levels[step.node]=step.targetLevel;
 }
 for(let node=1;node<=15;node++)if(node!==12)assert.equal(levels[node],3);
 assert.ok(bitNodePriorities.findIndex(s=>s.node===9&&s.targetLevel===2)<bitNodePriorities.findIndex(s=>s.node===15));
 assert.ok(bitNodePriorities.findIndex(s=>s.node===13)<bitNodePriorities.findIndex(s=>s.node===7&&s.targetLevel===3));
});
test('progression completes all finite targets before choosing endless Recursion',()=>{
 let owned={},current=1,plan;
 for(let run=0;run<50;run++){
  plan=planBitNodePriority(owned,current);owned=plan.projectedLevels;current=plan.nextBn;
  if(plan.recommended.endless)break;
 }
 assert.equal(plan.nextBn,12);assert.equal(plan.recommended.endless,true);
 for(let node=1;node<=15;node++)if(node!==12)assert.equal(owned[node],3);
});
test('Recursion levels above nine retain their integer value and do not restart finite targets',()=>{
 const owned=Object.fromEntries(Array.from({length:15},(_,i)=>[i+1,3]));owned[12]=100;
 const plan=planBitNodePriority(owned,12);
 assert.equal(plan.projectedLevels[12],101);assert.equal(plan.recommended.targetLevel,102);assert.equal(plan.nextBn,12);
 assert.match(plan.recommended.reason,/NeuroFlux/);
});
test('explicit next-node overrides survive recommendations and invalid ones stay invalid',()=>{
 assert.equal(planBitNodePriority({},1,15).nextBn,15);
 assert.equal(planBitNodePriority({},1,15).validOverride,true);
 for(const override of [-1,16,1.5,NaN,Infinity,'4']){
  const plan=planBitNodePriority({},1,override);
  assert.equal(plan.validOverride,false);assert.ok(Object.is(plan.nextBn,override));
 }
});
test('planner accepts Map source files and sanitizes malformed levels',()=>{
 assert.deepEqual(sourceFileLevels(new Map([[4,3],[9,2]])),{4:3,9:2});
 assert.deepEqual(sourceFileLevels({4:Infinity,5:-1,16:3}),{4:0,5:0});
 assert.throws(()=>planBitNodePriority({},16),/Invalid current/);
});
test('autopilot uses and publishes the general planner without decimal target logic',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(source,/planBitNodePriority\(dictOwnedSourceFiles, resetInfo.currentNode, options\['next-bn'\]\)/);
 assert.match(source,/bitNodePriority: bnPriority/);
 assert.doesNotMatch(source,/defaultBnOrder|getSFLevel|12\.9999/);
});
