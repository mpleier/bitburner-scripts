import test from 'node:test';
import assert from 'node:assert/strict';
import {observeLabyrinth,mazeRecoveryTransition,labyrinthRouteDistance} from '../darknet-labyrinth-policy.js';
test('changed geometry invalidates the exit and leaves entrance uncertain for resize planning',()=>{
 const s={labMap:{'9,9':2},labVisited:new Set(['1,1','9,9']),labEntrance:'1,1',labEnd:'19,19',labEdgeCounts:{'9,9:east':4}};
 observeLabyrinth(s,{coords:[9,9],north:true,east:false,south:false,west:true});
 assert.equal(s.labEntrance,null);assert.equal(s.labEnd,null);assert.deepEqual(s.labEdgeCounts,{});
 assert.equal(labyrinthRouteDistance(s,s.labEntrance,'9,9'),null);
});
test('recovery streaks are independent, bounded, and clear after new map progress',()=>{
 let s={noRoute:0,loop:0};for(let i=0;i<7;i++)s=mazeRecoveryTransition(s,'loop');assert.equal(s.stop,false);
 s=mazeRecoveryTransition(s,'no-route');assert.equal(s.stop,false);assert.equal(s.noRoute,1);assert.equal(s.loop,7);
 s=mazeRecoveryTransition(s,'progress');assert.deepEqual(s,{noRoute:0,loop:0,stop:false});
 for(let i=0;i<3;i++)s=mazeRecoveryTransition(s,'no-route');assert.equal(s.stop,true);
 s=mazeRecoveryTransition(s,'progress');for(let i=0;i<8;i++)s=mazeRecoveryTransition(s,'loop');assert.equal(s.stop,true);
});
