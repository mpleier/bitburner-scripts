import test from 'node:test';
import assert from 'node:assert/strict';
import {electMazeLeases} from '../darknet-development-policy.js';
import {packLabyrinthProgress,restoreLabyrinthProgress,labyrinthRouteDistance,nextLabyrinthMove} from '../darknet-labyrinth-policy.js';
import {mazeResizePlan} from '../darknet-navigator-policy.js';
const now=1000000,scope=[1,2,'lab','(The Labyrinth)'],reset={lastNodeReset:1,lastAugReset:2};
const request=(host,pid,navigator,active,expectedMs)=>({host,pid,at:now,live:true,navigator,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at:now,progressAt:1,active,expectedMs}]});
test('a stalled navigator can hand ownership to a faster scout but an active call retains its owner',()=>{
 const prior={nodeReset:1,augReset:2,at:now-1000,leases:[{maze:'lab',scope,host:'slow',pid:1,startedAt:1}]};
 const slow=request('slow',1,true,false,10000),fast=request('fast',2,false,false,1000);
 assert.equal(electMazeLeases(prior,[slow,fast],reset,3,now).leases[0].host,'fast');
 slow.mazeRequests[0].active=true;assert.equal(electMazeLeases(prior,[slow,fast],reset,3,now).leases[0].host,'slow');
 assert.equal(electMazeLeases(null,[slow,fast],reset,3,now).leases[0].host,'slow');
});
test('checkpoints preserve bounded edge preferences, reject corrupt history and accept legacy saves',()=>{
 const state={labMap:{'1,1':6},labVisited:new Set(['1,1']),labEnd:null,labEntrance:'1,1',labEdgeCounts:{'1,1:east':8,'1,1:south':1},labRecentEdges:[{k:'1,1:east',moved:true}]};
 const saved=packLabyrinthProgress(state,scope,now),restored=restoreLabyrinthProgress(saved,scope,now);
 assert.deepEqual(restored.labEdgeCounts,state.labEdgeCounts);assert.deepEqual(restored.labRecentEdges,state.labRecentEdges);assert.equal(restored.labEntrance,'1,1');
 assert.equal(nextLabyrinthMove(restored,[1,1]),'south');
 assert.equal(restoreLabyrinthProgress({...saved,edges:[['bad',8]]},scope,now),null);
 assert.equal(restoreLabyrinthProgress({...saved,recent:[{k:'1,1:east',moved:'yes'}]},scope,now),null);
 const {edges,recent,entrance,...legacy}=saved;assert.ok(restoreLabyrinthProgress(legacy,scope,now));
 const large={...state,labEdgeCounts:Object.fromEntries(Array.from({length:2000},(_,i)=>[(i%500)+','+Math.floor(i/500)+':east',i+1]))};assert.equal(packLabyrinthProgress(large,scope,now).edges.length,1024);
});
test('thread upgrades must repay known retracing and restart cost rather than speculate about unknown work',()=>{
 const input={currentThreads:1,available:8,quote:n=>10000/n,remainingMoves:20,retraceMoves:2};
 assert.ok(mazeResizePlan(input));assert.equal(mazeResizePlan({...input,remainingMoves:1}),null);
 assert.equal(mazeResizePlan({...input,retraceMoves:200}),null);assert.equal(mazeResizePlan({...input,retraceMoves:null}),null);
 assert.equal(mazeResizePlan({...input,quote:()=>10000}),null);assert.equal(mazeResizePlan({...input,quote:()=>{throw Error('unavailable');}}),null);
 assert.equal(labyrinthRouteDistance({labMap:{'1,1':2,'3,1':10,'5,1':8}},'1,1','5,1'),2);
 assert.equal(labyrinthRouteDistance({labMap:{}},'1,1','5,1'),null);
});
