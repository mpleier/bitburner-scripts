import test from 'node:test';
import assert from 'node:assert/strict';
import {nextLabyrinthMove,labyrinthRadarDue,recordLabyrinthEdge} from '../darknet-labyrinth-policy.js';
import {chooseMazeThreads} from '../darknet-navigator-policy.js';
test('routing prefers a passage to unknown geometry over an already mapped room',()=>{
 const s={labMap:{'1,1':6,'3,1':8,'1,3':5},labVisited:new Set(['1,1','1,3']),labEnd:null};
 assert.equal(nextLabyrinthMove(s,[1,1]),'south');s.labEnd='3,1';assert.equal(nextLabyrinthMove(s,[1,1]),'east');
});
test('radar skips known exits, cooldown, too few moves and completely mapped neighborhoods',()=>{
 const s={labMap:{},labEnd:null};assert.equal(labyrinthRadarDue(s,[3,3],40000,0,3),true);assert.equal(labyrinthRadarDue(s,[3,3],20000,0,3),false);assert.equal(labyrinthRadarDue(s,[3,3],40000,0,2),false);
 for(let x=1;x<=5;x+=2)for(let y=1;y<=5;y+=2)s.labMap[x+','+y]=0;assert.equal(labyrinthRadarDue(s,[3,3],40000,0,3),false);s.labEnd='9,9';assert.equal(labyrinthRadarDue(s,[9,9],40000,0,3),false);
});
test('repeated blocked moves refresh while distinct successful edges continue',()=>{
 const s={};assert.equal(recordLabyrinthEdge(s,[1,1],[1,1],'east').refresh,false);assert.equal(recordLabyrinthEdge(s,[1,1],[1,1],'east').refresh,true);
 const t={};for(let i=0;i<3;i++)assert.equal(recordLabyrinthEdge(t,[1,1],[3,1],'east').refresh,false);assert.equal(recordLabyrinthEdge(t,[1,1],[3,1],'east').refresh,true);
});
test('thread tuning respects available RAM, diminishing returns and unavailable formulas',()=>{
 assert.equal(chooseMazeThreads(8,n=>10000/n),8);assert.equal(chooseMazeThreads(2,n=>10000/n),2);assert.equal(chooseMazeThreads(8,()=>10000),1);assert.equal(chooseMazeThreads(8,()=>{throw Error('unavailable');}),1);assert.equal(chooseMazeThreads(0,()=>1),0);
});

test('new maze ownership chooses the fastest quoted host and keeps an active navigator',async()=>{
 const {electMazeLeases}=await import('../darknet-development-policy.js');
 const scope=[1,2,'lab','(The Labyrinth)'],reset={lastNodeReset:1,lastAugReset:2},now=1000000;
 const source=(host,pid,ms,navigator=false,active=false)=>({host,pid,at:now,live:true,navigator,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at:now,expectedMs:ms,active}]});
 const slow=source('slow',1,10000),fast=source('fast',9,2000);
 const chosen=electMazeLeases(null,[slow,fast],reset,3,now);assert.equal(chosen.leases[0].host,'fast');
 const active=source('slow',1,10000,true,true),prior={...chosen,leases:[{...chosen.leases[0],host:'slow',pid:1}]};
 assert.equal(electMazeLeases(prior,[active,fast],reset,3,now).leases[0].host,'slow');
 assert.equal(electMazeLeases(null,[source('unknown',1,null),fast],reset,3,now).leases[0].host,'fast');
});
test('radar ignores unreachable cells and expensive or unproductive scans without disabling later probes',()=>{
 const blocked={labMap:{'3,3':0},labEnd:null};assert.equal(labyrinthRadarDue(blocked,[3,3],40000,0,3),false);
 const fork={labMap:{'3,3':3},labEnd:null};assert.equal(labyrinthRadarDue(fork,[3,3],40000,0,3),true);
 assert.equal(labyrinthRadarDue(fork,[3,3],40000,0,3,{moveMs:1000,radarMs:2000}),false);
 assert.equal(labyrinthRadarDue(fork,[3,3],40000,0,3,{samples:2,cellsPerScan:0}),false);
 assert.equal(labyrinthRadarDue(fork,[3,3],40000,0,12,{samples:2,cellsPerScan:0}),true);
});
test('thread selection accepts cumulative gains beyond eight threads and limits RAM on plateaus',()=>{
 assert.ok(chooseMazeThreads(64,n=>64000/n)>8);
 assert.equal(chooseMazeThreads(64,n=>n>=4?1000:8000/n),4);
 let calls=0;chooseMazeThreads(1000,n=>{calls++;return 64000/n;});assert.equal(calls,64);
});
