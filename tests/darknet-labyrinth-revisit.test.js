import test from 'node:test';
import assert from 'node:assert/strict';
import {recordLabyrinthEdge} from '../darknet-labyrinth-policy.js';

test('revisiting one room and direction with real movement is not a stuck navigator', () => {
 const state={labRecentEdges:[]};
 let last;
 for(let i=0;i<20;i++)last=recordLabyrinthEdge(state,[1,1],[1,3],'south');
 assert.equal(state.labEdgeCounts['1,1:south'],20);
 assert.equal(last.repeated,0);
 assert.equal(last.refresh,false);
});

test('blocked moves still refresh position after a short streak', () => {
 const state={labRecentEdges:[]};
 let last;
 for(let i=0;i<6;i++)last=recordLabyrinthEdge(state,[1,1],[1,1],'south');
 assert.equal(last.repeated,6);
 assert.equal(last.refresh,true);
});

test('successful moves break a blocked streak', () => {
 const state={labRecentEdges:[]};
 recordLabyrinthEdge(state,[1,1],[1,1],'south');
 recordLabyrinthEdge(state,[1,1],[1,1],'south');
 let last=recordLabyrinthEdge(state,[1,3],[1,1],'north');
 assert.equal(last.refresh,false);
 for(let i=0;i<3;i++)last=recordLabyrinthEdge(state,[1,1],[1,3],'south');
 assert.equal(last.refresh,false);
});
