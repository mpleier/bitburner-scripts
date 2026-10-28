import test from 'node:test';
import assert from 'node:assert/strict';
import {observeLabyrinth,nextLabyrinthMove,packLabyrinthProgress,restoreLabyrinthProgress} from '../darknet-labyrinth-policy.js';
import {solveLabyrinth} from '../darknet-advanced.js';
const scope=[1,2,'lab','(The Labyrinth)',5,'numeric','maze'];
const report=(x,y,dirs)=>({success:true,coords:[x,y],north:false,east:false,south:false,west:false,...Object.fromEntries(dirs.map(d=>[d,true]))});
test('radar recognizes native 7x7 geometry without trimming space paths',()=>{
 const s={};observeLabyrinth(s,report(3,3,['east']),{success:true,message:['███████','███████','███████','███@ X█','███████','███████','███████'].join('\n')});
 assert.equal(s.labEnd,'5,3');assert.equal(nextLabyrinthMove(s,[3,3]),'east');
});
test('known geometry finds a frontier through previously visited cells after a new PID starts',()=>{
 const s={};observeLabyrinth(s,report(1,1,['east']));observeLabyrinth(s,report(3,1,['west','south']));observeLabyrinth(s,report(3,3,['north','east']));
 const saved=packLabyrinthProgress(s,scope,100),restored=restoreLabyrinthProgress(JSON.parse(JSON.stringify(saved)),scope,200);
 assert.equal(nextLabyrinthMove(restored,[1,1]),'east');assert.equal(nextLabyrinthMove(restored,[3,3]),'east');
});
test('changed native report discards stale maze geometry and endpoint',()=>{
 const s={};observeLabyrinth(s,report(1,1,['east']));s.labEnd='9,9';observeLabyrinth(s,report(1,1,['south']));assert.equal(s.labEnd,null);assert.equal(nextLabyrinthMove(s,[1,1]),'south');
});
test('checkpoints reject other resets, malformed maps, oversized and stale records',()=>{
 const s={};observeLabyrinth(s,report(1,1,['east']));const saved=packLabyrinthProgress(s,scope,100);
 for(const patch of [{at:101},{at:-21600001},{map:[['__proto__',1]]},{map:[['1,1',16]]},{visited:Array(4097).fill('1,1')},{end:'bad'}])assert.equal(restoreLabyrinthProgress({...saved,...patch},scope,100),null);
 assert.equal(restoreLabyrinthProgress(saved,[1,3,...scope.slice(2)],100),null);
});
test('actual solver uses radar occasionally and succeeds with native two-cell movement',async()=>{
 let x=1,radars=0,moves=0;const r=await solveLabyrinth(async d=>{assert.equal(d,'east');x+=2;moves++;return x===7?{success:true,password:'reward'}:{feedback:{}};},{},async()=>report(x,1,['east',...(x>1?['west']:[])]),async()=>{radars++;return {success:false};});
 assert.equal(r.success,true);assert.equal(moves,3);assert.equal(radars,1);
});
test('radar failures preserve report-driven exploration and bounded move budget',async()=>{
 let x=1;const s={};const r=await solveLabyrinth(async()=>{x+=2;return {feedback:{}};},s,async()=>report(x,1,['east',...(x>1?['west']:[])]),async()=>{throw Error('offline');});assert.equal(r.success,false);assert.match(r.reason,/budget/);assert.equal(s.labVisited.size,64);
});
