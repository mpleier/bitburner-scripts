import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {goNodePowerReward,analyzeGoBoard,goMoveOutcome,goSettledPass,recordGoPerformance,chooseGoBoardSize,rankGoOpponents} from '../go-policy.js';

// Original copying/flood-fill implementation retained here as an independent reference.
function group(board,x,y){const color=board[x][y],size=board.length,stones=[],seen=new Set(),liberties=new Set(),pending=[[x,y]];
 while(pending.length){const [a,b]=pending.pop(),key=a*size+b;if(seen.has(key))continue;seen.add(key);stones.push([a,b]);
  for(const [c,d]of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]){if(c<0||d<0||c>=size||d>=size)continue;
   if(board[c][d]==='.')liberties.add(c*size+d);else if(board[c][d]===color&&!seen.has(c*size+d))pending.push([c,d]);}}
 return {stones,liberties};}
function reference(board,x,y){if(board[x]?.[y]!=='.')return null;
 const next=board.map(r=>r.split('')),size=board.length,neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>a>=0&&b>=0&&a<size&&b<size),saved=new Set();
 for(const [a,b]of neighbors)if(board[a][b]==='X'){const g=group(board,a,b);if(g.liberties.size===1)for(const [c,d]of g.stones)saved.add(c*size+d);}
 next[x][y]='X';let captured=0;
 for(const [a,b]of neighbors)if(next[a][b]==='O'){const g=group(next,a,b);if(g.liberties.size===0){captured+=g.stones.length;for(const [c,d]of g.stones)next[c][d]='.';}}
 const own=group(next,x,y);return {captured,liberties:own.liberties.size,size:own.stones.length,saved:own.liberties.size>=2?saved.size:0};
}
let seed=12345;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;}
function randomBoard(size){return Array.from({length:size},()=>Array.from({length:size},()=>'.XO#'[Math.floor(random()*4)]).join(''));}

test('cached move evaluation exactly matches copying simulation across 600 seeded boards',()=>{
 for(let i=0;i<600;i++){
  const board=randomBoard([5,7,9,13][i%4]),analysis=analyzeGoBoard(board),before=[...board];
  for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)assert.deepEqual(goMoveOutcome(board,x,y,analysis),reference(board,x,y));
  assert.deepEqual(board,before);
 }
});
test('snapshot analysis deduplicates groups and stale snapshots cannot corrupt a move',()=>{
 const board=['XX.','X.O','..O'],a=analyzeGoBoard(board);assert.equal(a.groups.length,2);
 assert.equal(a.at[0],a.at[3]);board[0]='XO.';assert.deepEqual(goMoveOutcome(board,1,1,a),reference(board,1,1));
});
function settled(){const board=['XXXXX','X.X.X','XXXXX','X.X.X','XXXXX'],valid=board.map(r=>[...r].map(c=>c==='.')),controlled=board.map(r=>r.replaceAll('.','X'));
 const a=analyzeGoBoard(board),outcomes=new Map();for(let x=0;x<5;x++)for(let y=0;y<5;y++)if(valid[x][y])outcomes.set(x+','+y,goMoveOutcome(board,x,y,a));
 return {board,valid,controlled,outcomes,a};}
test('settled passing requires two independent small eyes and a clear native score lead',()=>{
 const s=settled(),args=[s.board,s.valid,s.controlled,s.outcomes,'Netburners',s.a];assert.equal(goSettledPass(...args),true);
 assert.equal(goSettledPass(...args,{currentPlayer:'Black',blackScore:25,whiteScore:30}),false);
 assert.equal(goSettledPass(...args,{currentPlayer:'White',blackScore:25,whiteScore:1}),false);
 assert.equal(goSettledPass(...args,{currentPlayer:'Black',blackScore:25,whiteScore:1}),true);
});
test('settled passing refuses neutral regions, threatened groups and remaining captures',()=>{
 const s=settled();s.controlled[1]='X?XXX';assert.equal(goSettledPass(s.board,s.valid,s.controlled,s.outcomes,'Netburners',s.a),false);
 const t=settled();t.outcomes.set('1,1',{captured:1,saved:0});assert.equal(goSettledPass(t.board,t.valid,t.controlled,t.outcomes,'Netburners',t.a),false);
 const board=['XXXXX','X...X','X...X','X...X','XXXXX'],a=analyzeGoBoard(board),valid=board.map(r=>[...r].map(c=>c==='.'));
 assert.equal(goSettledPass(board,valid,board.map(()=> 'XXXXX'),new Map(),'Netburners',a),false);
});
const game=(extra={})=>({opponent:'Netburners',size:13,cheats:false,startedAt:1000,wins:5,losses:1,bonus:10,turns:100,...extra});
const stats={Netburners:{wins:6,losses:1,bonusPercent:11}};
test('game measurements record elapsed time and reward once and keep twenty recent games',()=>{
 let buckets={};for(let i=0;i<30;i++)buckets=recordGoPerformance(buckets,game(),stats,61000);
 const r=buckets['Netburners:13:normal'];assert.equal(r.games,20);assert.equal(r.completed,30);assert.equal(r.totalMs,1200000);assert.equal(r.totalBonus,20);
 assert.deepEqual(recordGoPerformance(buckets,null,stats),buckets);
});
test('partial, ambiguous, reset, invalid and paused-long games do not become throughput evidence',()=>{
 const buckets={};for(const g of [game({wins:0}),game({startedAt:62000}),game({startedAt:-2e6}),game({size:19}),game({bonus:NaN})])assert.equal(recordGoPerformance(buckets,g,stats,61000),buckets);
});
function bucket(size,extra={}){return {opponent:'Netburners',size,cheats:false,games:3,completed:3,wins:3,totalMs:180000,totalBonus:3,rewardVersion:2,...extra};}
test('adaptive boards establish a 13x13 baseline and sample alternatives gradually',()=>{
 assert.equal(chooseGoBoardSize('Netburners',{}),13);
 assert.equal(chooseGoBoardSize('Netburners',{a:bucket(13,{games:2,completed:2})}),13);
 assert.equal(chooseGoBoardSize('Netburners',{a:bucket(13)}),7);
 assert.equal(chooseGoBoardSize('Illuminati',{a:bucket(13,{opponent:'Illuminati'})}),5);
});
test('board selection favors measured reward per minute while rejecting unreliable sizes and other cheat modes',()=>{
 const rows={a:bucket(13,{completed:8}),b:bucket(7,{totalMs:30000,completed:8}),c:bucket(5,{totalMs:1000,wins:0,completed:8}),d:bucket(9,{totalMs:1,cheats:true})};
 assert.equal(chooseGoBoardSize('Netburners',rows),7);
});
test('board exploration continues after recent history caps at twenty games',()=>{
 const rows={a:bucket(13,{games:20,wins:20,completed:32}),b:bucket(7)};
 assert.equal(chooseGoBoardSize('Netburners',rows),9);
});
test('opponent ranking accounts for measured throughput without discarding the current goal',()=>{
 const measured={a:bucket(13,{totalBonus:.1}),b:bucket(13,{opponent:'The Black Hand',totalBonus:10})};
 const p=rankGoOpponents({},'hacknet',9,measured);assert.equal(p[0].name,'Netburners');
 const normal=rankGoOpponents({},'money',1),fast=rankGoOpponents({},'money',1,measured);
 assert.ok(fast.find(r=>r.name==='Netburners').score<normal.find(r=>r.name==='Netburners').score);
 assert.ok(fast.every(r=>Number.isFinite(r.score)));
});
test('malformed persisted metrics cannot introduce NaN scores or invalid board sizes',()=>{
 const bad={a:null,b:{opponent:'Netburners',games:3,totalMs:NaN,totalBonus:Infinity},c:bucket(19),d:bucket(7,{wins:NaN})};
 assert.equal(chooseGoBoardSize('Netburners',bad),13);
 assert.ok(rankGoOpponents({},'auto',9,bad).every(r=>Number.isFinite(r.score)));
});

async function controller(overrides={}){
 const source=await readFile(new URL('../go.js',import.meta.url),'utf8'),policy=await import('../go-policy.js'),opponentPolicy=await import('../go-opponent-policy.js');
 const writes=[],resets=[];
 const ns={pid:1,args:[],read:()=>'',getScriptName:()=> 'go.js',getResetInfo:()=>({currentNode:9,lastNodeReset:7}),isRunning:()=>true,
  clearLog(){},write:async(f,s)=>writes.push([f,JSON.parse(s)]),go:{analysis:{getStats:()=>({})},resetBoardState:(name,size)=>{resets.push([name,size]);return Array(size).fill('.'.repeat(size));}}};
 const context={...policy,...opponentPolicy,registerAutomation(){},automationHeartbeat(){},maintenanceRequested:()=>false,isScriptPaused:()=>false,achievementActionAllowed:()=>true,performance:{now:()=>0},ns};
 const injection=`globalThis.harness={checkNewGame,getAllPatterns,set:(opts,buckets={},explicit=false)=>{goOptions=opts;performanceBuckets=buckets;boardSizeExplicit=explicit;},cacheSize:()=>patternCache.size};`;
 const stripped=source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replace('export async function main','async function main').replace('export function autocomplete','function autocomplete').replace('    await start();',injection);
 Object.assign(context,overrides);await vm.runInNewContext(stripped+';main(ns)',context);return {...context.harness,ns,writes,resets};
}
test('actual controller honors explicit board-size and disabled adaptive settings',async()=>{
 for(const explicit of [true,false]){
  const h=await controller();h.set({goal:'hacknet',opponent:'Netburners','board-size':9,'adaptive-boards':explicit}, {},explicit);
  await h.checkNewGame(h.ns,{type:'gameOver'});assert.deepEqual(h.resets,[['Netburners',9]]);
 }
});
test('actual controller preserves the default board during streak achievements',async()=>{
 const h=await controller({liveGoGoals:()=>({goStreak:true})});h.set({goal:'speed',opponent:'Illuminati'}, {a:bucket(13,{opponent:'Illuminati'})});
 await h.checkNewGame(h.ns,{type:'gameOver'});assert.deepEqual(h.resets,[['Illuminati',13]]);
});
test('pattern variants are cached and symmetric duplicates are removed without mutation',async()=>{
 const h=await controller(),pattern=['XXX','X.X','XXX'],before=[...pattern],first=h.getAllPatterns(pattern);
 assert.equal(first.length,1);assert.equal(h.getAllPatterns([...pattern]),first);assert.deepEqual(pattern,before);assert.equal(h.cacheSize(),1);
});

test('cached evaluator microbenchmark reports timings without a machine-dependent pass threshold',()=>{
 const board=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':x<8?'X':'O').join(''));
 const moves=[];for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(board[x][y]==='.')moves.push([x,y]);
 const start=performance.now();for(let i=0;i<50;i++)for(const [x,y]of moves)reference(board,x,y);const original=performance.now()-start;
 const next=performance.now();for(let i=0;i<50;i++){const analysis=analyzeGoBoard(board);for(const [x,y]of moves)goMoveOutcome(board,x,y,analysis);}const cached=performance.now()-next;
 console.log('IPvGO evaluation benchmark: original='+original.toFixed(2)+'ms cached='+cached.toFixed(2)+'ms ratio='+(original/cached).toFixed(2)+'x');
 assert.ok(Number.isFinite(original/cached));
});

test('reward measurements honor the special 5x5 Illuminati multiplier and native streak rules',()=>{
 assert.equal(goNodePowerReward(20,7.5,5,8,7),480);
 assert.equal(goNodePowerReward(20,7.5,13,8,7),120);
 assert.equal(goNodePowerReward(20,1.5,13,-1,8),5);
 assert.equal(goNodePowerReward(20,1.5,13,1,-8),50);
 assert.equal(goNodePowerReward(NaN,1.5,13,1,0),null);
});
test('measured node power distinguishes board throughput from diminishing percentage bonuses',()=>{
 const rows={a:bucket(13,{completed:8,totalBonus:10,totalReward:100,totalMs:100000}),b:bucket(7,{completed:8,totalBonus:1,totalReward:100,totalMs:20000})};
 assert.equal(chooseGoBoardSize('Netburners',rows),7);
});


test('board comparison never mixes node power with percentage bonus units',()=>{
 const rows={a:bucket(13,{completed:8,totalReward:100,totalBonus:1}),b:bucket(7,{completed:8,totalBonus:3,rewardVersion:undefined})};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false),7);
 rows.b.totalReward=50;rows.b.rewardVersion=2;
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false),13);
 // A genuine zero is measured data, not permission to switch units for that row.
 rows.a.totalReward=0;
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false),7);
});
test('legacy or invalid rewards fall back to bonus units for every candidate',()=>{
 for(const invalid of [null,NaN,-1,Infinity]){
  const rows={a:bucket(13,{completed:8,totalReward:100,totalBonus:1}),b:bucket(7,{completed:8,totalReward:invalid,totalBonus:3})};
  assert.equal(chooseGoBoardSize('Netburners',rows,false,false),7);
 }
 const legacy={a:bucket(13,{completed:8,totalReward:100,totalBonus:1,rewardVersion:undefined}),b:bucket(7,{completed:8,totalReward:1,totalBonus:3})};
 assert.equal(chooseGoBoardSize('Netburners',legacy,false,false),7);
});
test('critical cheat losses receive zero reward despite a nonzero final score',()=>{
 const g=game({cheats:true,winStreak:4}),final={blackScore:50,whiteScore:60,komi:1.5};
 const result=recordGoPerformance({},g,{Netburners:{wins:5,losses:2,bonusPercent:10,winStreak:-1}},61000,final)['Netburners:13:cheats'];
 assert.equal(result.totalReward,0);assert.equal(result.history[0].reward,0);assert.equal(result.history[0].bonus,0);assert.equal(result.rewardVersion,2);
});
test('ordinary losses with actual bonus gain retain their native reward',()=>{
 const result=recordGoPerformance({},game({winStreak:4}),{Netburners:{wins:5,losses:2,bonusPercent:11,winStreak:-1}},61000,{blackScore:50,whiteScore:60,komi:1.5})['Netburners:13:normal'];
 assert.equal(result.totalReward,12.5);
});
test('new observations repair old phantom rewards for zero-gain losses',()=>{
 const prior={'Netburners:13:normal':{completed:2,history:[{ms:60000,win:0,bonus:0,reward:100,logGain:0}]}};
 const result=recordGoPerformance(prior,game({winStreak:1}),{Netburners:{wins:6,losses:1,bonusPercent:11,winStreak:2}},61000,{blackScore:20,komi:1.5})['Netburners:13:normal'];
 assert.equal(result.history[0].reward,0);assert.equal(result.totalReward,15);
 assert.equal(prior['Netburners:13:normal'].history[0].reward,100);
});
