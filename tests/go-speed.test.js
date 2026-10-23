import * as replayPolicy from '../go-replay-policy.js';
import test from 'node:test';
const goCpuBenchmark=(name,run)=>test(name,{skip:process.env.BITBURNER_GO_BENCHMARKS!=='1'},run);
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {goNodePowerReward,goAliveChains,analyzeGoBoard,goMoveOutcome,goMoveOutcomes,goSettledPass,recordGoPerformance,chooseGoBoardSize,rankGoOpponents,chooseGoEngine,restoreGoEngines,goEngineEvidence,goEngineConfigurations,goProfileBuckets,trimGoProfiles,recordGoInterruptedTime,goInterruptedMs,goBoardObservation,goHistoryMatches,goActionIntervention,goPolicyRevisions} from '../go-policy.js';

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
 const context={...replayPolicy,...policy,...opponentPolicy,registerAutomation(){},automationHeartbeat(){},maintenanceRequested:()=>false,isScriptPaused:()=>false,achievementActionAllowed:()=>true,performance:{now:()=>0},ns};
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

goCpuBenchmark('cached evaluator microbenchmark reports timings without a machine-dependent pass threshold',()=>{
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

test('board throughput accepts a profitable 75-percent win rate without double-penalizing losses',()=>{
 const rows={a:bucket(13,{completed:8,games:20,wins:10,totalReward:3355.875,totalMs:2414735}),b:bucket(7,{completed:8,games:8,wins:6,totalReward:483.375,totalMs:189628})};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false),7);
});
test('board results expire and bounded trials refresh stale alternatives',()=>{
 const now=10000000;
 const row=(size,age,completed=8)=>bucket(size,{completed,at:now-age,history:Array.from({length:3},()=>({at:now-age,ms:10000,win:1,bonus:1,reward:10}))});
 const rows={a:row(13,1000,11),b:row(7,1900000),c:row(9,2000000),d:row(5,1000)};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,true,now),9);
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false,now),5);
 rows.a=row(13,7200001);assert.equal(chooseGoBoardSize('Netburners',rows,false,false,now),13);
});
test('board comparison ignores stale or future history instead of trusting aggregate totals',()=>{
 const now=10000000,h=(at,reward)=>({at,ms:10000,win:1,bonus:1,reward});
 const rows={a:bucket(13,{history:Array.from({length:3},()=>h(now,10))}),b:bucket(7,{totalReward:1e9,history:[h(now-7200001,1e9),h(now+1,1e9)]})};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false,now),13);
});

test('loss-only boards need real recent positive reward evidence before becoming preferred',()=>{
 const now=10000000,history=Array.from({length:3},()=>({at:now,ms:1000,win:0,bonus:.1,reward:10}));
 const rows={a:bucket(13,{completed:8,totalReward:10}),b:bucket(7,{completed:8,wins:0,history})};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false,now),7);
 for(const patch of [{reward:0,bonus:0},{reward:NaN},{at:now+1},{at:now-7200001}]){
  const bad={...rows,b:{...rows.b,history:history.map(g=>({...g,...patch}))}};assert.equal(chooseGoBoardSize('Netburners',bad,false,false,now),13);
 }
});
const engineNow=10000000;
function engineRows(reward=10,extra={}){return {a:{opponent:'Tetrads',size:7,cheats:false,rewardVersion:2,history:Array.from({length:6},(_,i)=>({at:engineNow-i*1000,ms:1000,reward,bonus:1,win:1})),...extra}};}
const engineOptions={opponent:'Tetrads',size:7,cheats:false,now:engineNow,completed:8};
test('search engine requires matching recent throughput evidence and a fifteen-percent gain',()=>{
 const engines={tactical:engineRows(10),'search-v1':engineRows(12)};
 assert.equal(chooseGoEngine(engines,engineOptions).engine,'search-v1');
 for(const reward of [0,10,11.4])assert.equal(chooseGoEngine({...engines,'search-v1':engineRows(reward)},engineOptions).engine,'tactical');
 for(const patch of [{opponent:'Daedalus'},{size:13},{cheats:true},{rewardVersion:1},{history:[{at:engineNow+1,ms:1000,reward:100,bonus:1,win:1}]}])
  assert.equal(chooseGoEngine({...engines,'search-v1':engineRows(100,patch)},engineOptions).engine,'tactical');
});
test('challenger trials are bounded, protect streaks, avoid board trials and honor explicit modes',()=>{
 const engines={tactical:engineRows(),'search-v1':{}};
 for(let completed=0;completed<24;completed++)assert.equal(chooseGoEngine(engines,{...engineOptions,completed}).trial,completed%8===7);
 for(const patch of [{protectStreak:true},{trial:true}])assert.equal(chooseGoEngine(engines,{...engineOptions,completed:7,...patch}).engine,'tactical');
 assert.equal(chooseGoEngine({}, {...engineOptions,completed:7}).reason,'requires-matching-baseline');
 assert.equal(chooseGoEngine({}, {...engineOptions,mode:'play'}).engine,'search-v1');
 assert.equal(chooseGoEngine({}, {...engineOptions,mode:'play',protectStreak:true}).engine,'tactical');
 for(const mode of ['off','shadow'])assert.equal(chooseGoEngine(engines,{...engineOptions,completed:7,mode}).trial,false);
});
test('stale search evidence is re-probed at most once per eight completions',()=>{
 const old=engineRows(8);old.a.history=old.a.history.map((g,i)=>({...g,at:engineNow-1900000-i*1000}));
 const engines={tactical:engineRows(),'search-v1':old};
 assert.equal(chooseGoEngine(engines,{...engineOptions,completed:7}).trial,true);
 assert.equal(chooseGoEngine(engines,{...engineOptions,completed:8}).trial,false);
 old.a.history=old.a.history.map(g=>({...g,at:engineNow-7200001}));
 assert.equal(chooseGoEngine(engines,engineOptions).engine,'tactical');
});

test('engine records migrate without mixing players or crossing augmentation resets',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},buckets=engineRows();
 assert.equal(restoreGoEngines({version:2,nodeReset:1,augReset:2,buckets},reset).tactical,buckets);
 assert.equal(restoreGoEngines({version:2,nodeReset:1,augReset:2,engine:'search-v1',buckets},reset)['search-v1'],buckets);
 const saved={version:3,nodeReset:1,augReset:2,engines:{tactical:buckets,'search-v1':engineRows(20)}};
 assert.equal(restoreGoEngines(saved,reset).tactical,buckets);
 assert.deepEqual(restoreGoEngines(saved,{...reset,lastAugReset:3}),{tactical:{},'search-v1':{}});
 for(const bad of [null,{}, {...saved,engines:[]},{...saved,engines:{tactical:[],'search-v1':null}},{version:2,nodeReset:1,augReset:2,engine:'other',buckets}])
  assert.deepEqual(restoreGoEngines(bad,reset),{tactical:{},'search-v1':{}});
});

test('board and opponent trials refresh tactical evidence even after search proves faster',()=>{
 const engines={tactical:engineRows(10),'search-v1':engineRows(20)};
 const decision=chooseGoEngine(engines,{...engineOptions,trial:true});assert.equal(decision.engine,'tactical');assert.equal(decision.reason,'isolated-board-opponent-trial');
 assert.equal(chooseGoEngine(engines,{...engineOptions,trial:true,mode:'play'}).engine,'search-v1');
});

test('reward-rate uncertainty matches an independent residual calculation and duration weighting',()=>{
 const h=[10,20,30].map((reward,i)=>({reward,ms:1000,at:i+1})),e=goEngineEvidence(h);
 assert.equal(e.rate,.02);assert.ok(Math.abs(e.standardError-Math.sqrt(300)/3000)<1e-12);
 assert.ok(Math.abs(e.upper-(.02+4.303*Math.sqrt(300)/3000))<1e-12);assert.equal(e.lower,0);assert.equal(e.effectiveSamples,3);
 const weighted=goEngineEvidence([{at:1,ms:1000,reward:10},{at:2,ms:9000,reward:90}]);
 assert.equal(weighted.rate,.01);assert.equal(weighted.standardError,0);assert.ok(weighted.effectiveSamples<2);
});
test('lucky outliers cannot promote search despite a point estimate above fifteen percent',()=>{
 const noisy=engineRows();noisy.a.history=noisy.a.history.map((g,i)=>({...g,reward:i===0?100:0}));
 const engines={tactical:engineRows(10),'search-v1':noisy},p=chooseGoEngine(engines,engineOptions);
 assert.ok(p.search.rate>p.tactical.rate*1.15);assert.equal(p.engine,'tactical');assert.equal(p.reason,'uncertain-throughput-gain');
 assert.equal(chooseGoEngine(engines,{...engineOptions,completed:7}).trial,true);
});
test('promotion requires six independent completions and enough duration coverage',()=>{
 const short=engineRows(20);short.a.history=short.a.history.slice(0,3);
 assert.equal(chooseGoEngine({tactical:engineRows(),'search-v1':short},engineOptions).engine,'tactical');
 const duplicate=engineRows(20);duplicate.a.history=duplicate.a.history.map(g=>({...g,at:engineNow}));
 assert.equal(chooseGoEngine({tactical:engineRows(),'search-v1':duplicate},engineOptions).search.samples,1);
 const dominant=engineRows(20);dominant.a.history[0].ms=100000;dominant.a.history[0].reward=2000;
 assert.equal(chooseGoEngine({tactical:engineRows(),'search-v1':dominant},engineOptions).engine,'tactical');
});
test('a promoted search engine still refreshes its tactical reference on bounded slots',()=>{
 const tactical=engineRows(10);tactical.a.history=tactical.a.history.map((g,i)=>({...g,at:engineNow-1900000-i*1000}));
 const engines={tactical,'search-v1':engineRows(20)};
 const p=chooseGoEngine(engines,{...engineOptions,completed:7});assert.equal(p.engine,'tactical');assert.equal(p.reason,'bounded-baseline-refresh');assert.equal(p.trial,true);
 assert.equal(chooseGoEngine(engines,{...engineOptions,completed:8}).engine,'search-v1');
});
test('invalid and overflowing evidence fails closed without corrupting a rate',()=>{
 for(const h of [[],[{at:1,ms:1000,reward:NaN}],Array.from({length:6},(_,i)=>({at:i,ms:1000,reward:1e308}))])assert.equal(goEngineEvidence(h).samples,0);
 const e=goEngineEvidence(Array.from({length:30},(_,i)=>({at:i+1,ms:1000,reward:1})));assert.equal(e.samples,20);assert.equal(e.lastAt,30);
});

test('uncertainty agrees with the mean covariance formula on unequal game durations',()=>{
 const h=[{at:1,ms:1000,reward:10},{at:2,ms:3000,reward:80},{at:3,ms:4000,reward:20},{at:4,ms:2000,reward:40}];
 const n=h.length,mr=h.reduce((s,g)=>s+g.reward,0)/n,mt=h.reduce((s,g)=>s+g.ms,0)/n,rate=mr/mt;
 const vr=h.reduce((s,g)=>s+(g.reward-mr)**2,0)/(n-1),vt=h.reduce((s,g)=>s+(g.ms-mt)**2,0)/(n-1),cov=h.reduce((s,g)=>s+(g.reward-mr)*(g.ms-mt),0)/(n-1);
 const expected=Math.sqrt((vr+rate**2*vt-2*rate*cov)/(n*mt**2));
 assert.ok(Math.abs(goEngineEvidence(h).standardError-expected)<1e-12);
});
test('seeded equal-quality noisy players yield fewer promotions than point estimates alone',()=>{
 let seed=18291;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
 let oldPromotions=0,newPromotions=0;
 for(let i=0;i<1000;i++){
  const arm=()=>{const r=engineRows();r.a.history=r.a.history.map(g=>({...g,reward:-10*Math.log(random()),ms:1000+Math.floor(random()*3000)}));return r;};
  const plan=chooseGoEngine({tactical:arm(),'search-v1':arm()},engineOptions);
  oldPromotions+=Number(plan.search.rate>plan.tactical.rate*1.15);newPromotions+=Number(plan.engine==='search-v1');
 }
 console.log('IPvGO equal-quality simulation: point-only promotions='+oldPromotions+'/1000; uncertainty-aware='+newPromotions+'/1000. Synthetic decisions, not measured gameplay speed.');
 assert.ok(oldPromotions>0);assert.ok(newPromotions<oldPromotions);
});

test('search budget identities are independent from automatic tactical measurements',()=>{
 const a=goEngineConfigurations(),b=goEngineConfigurations({'search-ms':10,'search-nodes':128});
 assert.equal(a.tactical,b.tactical);assert.notEqual(a['search-v1'],b['search-v1']);
 for(const mode of ['off','play'])assert.equal(goEngineConfigurations({'search-mode':mode}).tactical,a.tactical);
 const shadow=goEngineConfigurations({'search-mode':'shadow'});assert.notEqual(shadow.tactical,a.tactical);
 assert.notEqual(shadow.tactical,goEngineConfigurations({'search-mode':'shadow','search-ms':10}).tactical);
 for(const patch of [{'early-pass':false},{'allow-self-atari':true},{'cheat-chance-threshold':.95}]){
  const changed=goEngineConfigurations(patch);for(const engine of ['tactical','search-v1'])assert.notEqual(a[engine],changed[engine]);
 }
 for(const patch of [{'search-ms':NaN},{'search-nodes':1},{'search-mode':'bad'},{'cheat-chance-threshold':2}])assert.equal(goEngineConfigurations(patch),null);
});
test('configuration changes cannot inherit challenger promotions and switching back restores evidence',()=>{
 const configurations=goEngineConfigurations(),changed=goEngineConfigurations({'search-ms':10});
 const tactical=engineRows(10,{configuration:configurations.tactical}),search=engineRows(20,{configuration:configurations['search-v1']}),engines={tactical,'search-v1':search};
 assert.equal(chooseGoEngine(engines,{...engineOptions,configurations}).engine,'search-v1');
 const p=chooseGoEngine(engines,{...engineOptions,configurations:changed});assert.equal(p.engine,'tactical');assert.equal(p.search.samples,0);assert.equal(p.tactical.samples,6);
 assert.equal(chooseGoEngine(engines,{...engineOptions,configurations}).engine,'search-v1');
 const untagged={tactical:engineRows(10),'search-v1':engineRows(20)};assert.equal(chooseGoEngine(untagged,{...engineOptions,configurations}).reason,'requires-matching-baseline');
});
test('profile recording separates budgets, bounds archives, and keeps the current profile',()=>{
 let buckets={};for(let i=0;i<6;i++)buckets=recordGoPerformance(buckets,game({configuration:'profile'+i}),stats,61000+i);
 assert.equal(Object.keys(buckets).length,4);assert.equal(goProfileBuckets(buckets,'profile0')['Netburners:13:normal|profile0'],undefined);
 assert.equal(Object.values(goProfileBuckets(buckets,'profile5'))[0].games,1);
 buckets=recordGoPerformance(buckets,game({configuration:'profile5'}),stats,62000);assert.equal(Object.values(goProfileBuckets(buckets,'profile5'))[0].games,2);
 const a={a:{configuration:'a',at:1},b:{configuration:'b',at:2},c:{configuration:'c',at:3},d:{configuration:'d',at:4},e:{configuration:'e',at:5}};
 assert.ok(trimGoProfiles(a,'a').a);assert.equal(Object.keys(trimGoProfiles(a,'a')).length,4);assert.deepEqual(goProfileBuckets(a,null),{});
});
test('version-four migration retains tagged profiles and archives legacy rows without assigning a budget',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},configuration=goEngineConfigurations()['search-v1'],buckets=engineRows(20,{configuration});
 const restored=restoreGoEngines({version:4,nodeReset:1,augReset:2,engines:{'search-v1':buckets}},reset);
 assert.equal(goProfileBuckets(restored['search-v1'],configuration).a,buckets.a);
 const legacy=restoreGoEngines({version:3,nodeReset:1,augReset:2,engines:{'search-v1':engineRows(20)}},reset);
 assert.ok(legacy['search-v1'].a);assert.deepEqual(goProfileBuckets(legacy['search-v1'],configuration),{});
});

test('deliberate achievement failure attempts never become board throughput evidence',()=>{
 const before={prior:bucket(13)},g=game({measurementExcluded:'achievement-failure-attempt'});
 assert.equal(recordGoPerformance(before,g,stats,61000,{blackScore:30,komi:1.5}),before);
 assert.equal(recordGoPerformance(before,game(),stats,61000,{blackScore:30,komi:1.5})===before,false);
});

const checkpointReset={lastNodeReset:1,lastAugReset:2};
function checkpoint(overrides={}){return {schemaVersion:1,state:'active',id:'session-1',nodeReset:1,augReset:2,engine:'search-v1',at:engineNow,record:{opponent:'Tetrads',size:7,cheats:false,configuration:'test',startedAt:engineNow-5000},...overrides};}
test('interrupted time counts checkpoint-confirmed segments exactly once without completed outcomes',()=>{
 const session=checkpoint(),b=recordGoInterruptedTime({},session,checkpointReset,engineNow+60000),r=Object.values(b)[0];
 assert.equal(r.games,0);assert.equal(r.completed,0);assert.equal(r.totalReward,0);assert.equal(r.totalMs,0);assert.equal(r.history.length,0);
 assert.equal(goInterruptedMs([r],engineNow+60000),5000);assert.equal(recordGoInterruptedTime(b,session,checkpointReset,engineNow+60000),b);
 assert.equal(goInterruptedMs([r,r],engineNow+60000),5000);assert.equal(goInterruptedMs([r],engineNow+7200001),0);
});
test('invalid, foreign-reset and deliberately excluded checkpoints cannot incur ordinary overhead',()=>{
 const original={},session=checkpoint();
 for(const patch of [{state:'closed'},{augReset:3},{nodeReset:3},{at:engineNow+1},{at:engineNow-7200001},{id:''},{record:{...session.record,configuration:null}},{record:{...session.record,startedAt:engineNow-1800001}},{record:{...session.record,measurementExcluded:'achievement-failure-attempt'}}])
  assert.equal(recordGoInterruptedTime(original,{...session,...patch},checkpointReset,engineNow),original);
 assert.equal(recordGoInterruptedTime(original,session,{},engineNow),original);
});
test('completed receipts prevent interrupted charges after a crash between result and checkpoint saves',()=>{
 const configuration=goEngineConfigurations().tactical,g=game({id:'receipt',configuration}),b=recordGoPerformance({},g,stats,61000,{blackScore:30,komi:1.5});
 const session=checkpoint({id:'receipt',at:61000,record:{...g,startedAt:1000}});session.record.opponent='Netburners';session.record.size=13;
 assert.equal(recordGoInterruptedTime(b,session,checkpointReset,62000),b);
});
test('interruption overhead survives subsequent completed records without inflating sample counts',()=>{
 const configuration=goEngineConfigurations().tactical,session=checkpoint({engine:'tactical',at:60000,record:{opponent:'Netburners',size:13,cheats:false,configuration,startedAt:55000}});
 let b=recordGoInterruptedTime({},session,checkpointReset,60000);b=recordGoPerformance(b,game({id:'complete',configuration}),stats,61000,{blackScore:30,komi:1.5});
 const row=Object.values(b)[0];assert.equal(row.games,1);assert.equal(row.history[0].id,'complete');assert.equal(goInterruptedMs([row],61000),5000);
});
test('interrupted overhead lowers engine and board throughput without earning confidence samples',()=>{
 const search=engineRows(20);search.a.interruptions=[{id:'partial',at:engineNow,ms:10000}];
 const p=chooseGoEngine({tactical:engineRows(10),'search-v1':search},engineOptions);
 assert.equal(p.engine,'tactical');assert.equal(p.search.samples,6);assert.ok(Math.abs(p.search.rate-120/16000)<1e-12);assert.equal(p.search.interruptedMs,10000);
 const rows={a:bucket(13,{completed:8,totalReward:100,totalMs:10000}),b:bucket(7,{completed:8,totalReward:200,totalMs:10000,interruptions:[{id:'partial',at:engineNow,ms:20000}]})};
 assert.equal(chooseGoBoardSize('Netburners',rows,false,false,engineNow),13);
});

const emptyGo=()=>Array(5).fill('.....');
const firstGo=['X....','.....','.....','.....','.....'];
const secondGo=['XO...','.....','.....','.....','.....'];
test('board continuity follows newest-first history through moves, captures, cheats and passes',()=>{
 const initial=goBoardObservation(emptyGo(),'Netburners',[]).identity;
 const first=goBoardObservation(firstGo,'Netburners',[emptyGo()],initial);assert.equal(first.changed,false);
 const second=goBoardObservation(secondGo,'Netburners',[firstGo,emptyGo()],first.identity);assert.equal(second.changed,false);
 const captured=['O....','.....','.....','.....','.....'];
 const capture=goBoardObservation(captured,'Netburners',[secondGo,firstGo,emptyGo()],second.identity);assert.equal(capture.changed,false);
 assert.equal(goBoardObservation(captured,'Netburners',[secondGo,firstGo,emptyGo()],capture.identity).changed,false);
 const afterCheat=['XXO..','.....','.....','.....','.....'];
 assert.equal(goBoardObservation(afterCheat,'Netburners',[secondGo,firstGo,emptyGo()],initial).changed,false);
});
test('board replacement detects opponent, dimensions, history truncation and unrelated equal-length history',()=>{
 const previous=goBoardObservation(secondGo,'Netburners',[firstGo,emptyGo()]).identity;
 assert.equal(goBoardObservation(emptyGo(),'Tetrads',[],previous).reason,'opponent-replaced');
 assert.equal(goBoardObservation(Array(7).fill('.......'),'Netburners',[],previous).reason,'board-size-replaced');
 assert.equal(goBoardObservation(emptyGo(),'Netburners',[],previous).reason,'history-restarted');
 const unrelated=['....X','.....','.....','.....','.....'];
 assert.equal(goBoardObservation(unrelated,'Netburners',[unrelated,emptyGo()],previous).reason,'board-history-replaced');
 const prior=goBoardObservation(emptyGo(),'Netburners',[]).identity;
 assert.equal(goBoardObservation(['#....',...emptyGo().slice(1)],'Netburners',[],prior).changed,true);
});
test('observation helpers reject malformed data and serialize without external bindings',()=>{
 const standalone=Function('return ('+goBoardObservation.toString()+')')(),initial=standalone(emptyGo(),'Netburners',[]);
 assert.equal(initial.valid,true);assert.equal(standalone(null,'Netburners',[]).valid,false);
 assert.equal(standalone(emptyGo(),'Netburners',[['..']]).valid,false);
 assert.equal(standalone(emptyGo(),'Netburners',[],{historyLength:-1}).valid,false);
 const id=goBoardObservation(firstGo,'Netburners',[emptyGo()]).identity;
 assert.equal(goHistoryMatches(id,'Netburners',[emptyGo()]),true);assert.equal(goHistoryMatches(id,'Tetrads',[emptyGo()]),false);assert.equal(goHistoryMatches(id,'Netburners',[]),false);
 assert.equal(Function('return ('+goHistoryMatches.toString()+')')()(id,'Netburners',[firstGo]),false);
});

test('automated moves, passes and native history-less two-stone cheats remain attributable',()=>{
 const before=goBoardObservation(emptyGo(),'Netburners',[]).identity;
 const action={kind:'ordinary',before,accepted:true,outcome:'move'},ordinary=goBoardObservation(secondGo,'Netburners',[firstGo,emptyGo()],before,action);
 assert.equal(goActionIntervention(before,ordinary,action),null);
 const pass={kind:'pass',before,accepted:true,outcome:'pass'},passing=goBoardObservation(emptyGo(),'Netburners',[],before,pass);
 assert.equal(goActionIntervention(before,passing,pass),null);
 const cheatBefore=goBoardObservation(firstGo,'Netburners',[emptyGo()]).identity,cheat={kind:'cheat',before:cheatBefore,accepted:true,outcome:'move'};
 const cheated=['XXX..','.....','.....','.....','.....'],responded=['XXXO.','.....','.....','.....','.....'];
 const moved=goBoardObservation(responded,'Netburners',[cheated,emptyGo()],cheatBefore,cheat);assert.equal(moved.changed,false);assert.equal(goActionIntervention(cheatBefore,moved,cheat),null);
 const aiPass={...cheat,outcome:'pass'},passed=goBoardObservation(cheated,'Netburners',[emptyGo()],cheatBefore,aiPass);assert.equal(passed.changed,false);assert.equal(goActionIntervention(cheatBefore,passed,aiPass),null);
 const ejection={...cheat,outcome:'gameOver'},ended=goBoardObservation(firstGo,'Netburners',[emptyGo()],cheatBefore,ejection);assert.equal(goActionIntervention(cheatBefore,ended,ejection,false,'None'),null);
});
test('continuous manual progress is excluded without falsely calling it board replacement',()=>{
 const before=goBoardObservation(emptyGo(),'Netburners',[]).identity,manual=goBoardObservation(firstGo,'Netburners',[emptyGo()],before);
 assert.equal(manual.changed,false);assert.equal(goActionIntervention(before,manual), 'untracked-board-progress');
 const unchanged=goBoardObservation(emptyGo(),'Netburners',[],before);assert.equal(goActionIntervention(before,unchanged,null,true),'external-intervention-during-planning');
 assert.equal(goActionIntervention(before,unchanged,null,false,'White'),'external-turn-change');
});
test('extra manual black moves are detected even when the total history count fits an ordinary turn',()=>{
 const before=goBoardObservation(emptyGo(),'Netburners',[]).identity,action={kind:'ordinary',before,accepted:true,outcome:'pass'};
 const manualSecond=['XX...','.....','.....','.....','.....'],observation=goBoardObservation(manualSecond,'Netburners',[firstGo,emptyGo()],before,action);
 assert.equal(observation.changed,false);assert.equal(goActionIntervention(before,observation,action),'unexpected-player-moves');
});
test('extra history and untracked game completion cannot earn an engine reward',()=>{
 const before=goBoardObservation(emptyGo(),'Netburners',[]).identity,action={kind:'ordinary',before,accepted:true,outcome:'move'};
 const third=['XOX..','.....','.....','.....','.....'],fourth=['XOXO.','.....','.....','.....','.....'];
 const changed=goBoardObservation(fourth,'Netburners',[third,secondGo,firstGo,emptyGo()],before,action);
 assert.equal(changed.changed,false);assert.equal(goActionIntervention(before,changed,action),'unexpected-history-progress');
 const normal=goBoardObservation(secondGo,'Netburners',[firstGo,emptyGo()],before,action);assert.equal(goActionIntervention(before,normal,action,false,'None'),'external-game-completion');
 const replacement=goBoardObservation(emptyGo(),'Tetrads',[],before);assert.equal(goActionIntervention(before,replacement,null,true),null);
});

test('an uncertain failed action cannot claim a game that ended without a verified response',()=>{
 const before=goBoardObservation(emptyGo(),'Netburners',[]).identity,observation=goBoardObservation(emptyGo(),'Netburners',[],before),action={kind:'pass',before,accepted:false,uncertain:true};
 assert.equal(goActionIntervention(before,observation,action,false,'None'),'unverified-action-result');
 assert.equal(goActionIntervention(before,observation,action,false,'Black'),null);
});

function revisionFixture(patch={}){const files={'go.js':'controller code','go-policy.js':'common private helper','go-search-policy.js':'private search helper',...patch};return goPolicyRevisions(path=>files[path]);}
test('source revisions change for private movement helpers while search-only changes preserve tactical data',()=>{
 const a=revisionFixture(),b=revisionFixture({'go-search-policy.js':'changed private search helper'}),c=revisionFixture({'go-policy.js':'changed common private helper'}),d=revisionFixture({'go.js':'changed controller pattern'});
 assert.equal(a.common,b.common);assert.notEqual(a.search,b.search);
 for(const changed of [c,d]){assert.notEqual(a.common,changed.common);assert.notEqual(a.search,changed.search);}
 const ca=goEngineConfigurations({},a),cb=goEngineConfigurations({},b);assert.equal(ca.tactical,cb.tactical);assert.notEqual(ca['search-v1'],cb['search-v1']);
 assert.notEqual(goEngineConfigurations({'search-mode':'shadow'},a).tactical,goEngineConfigurations({'search-mode':'shadow'},b).tactical);
});
test('revision normalization preserves line-ending-equivalent profiles and rejects missing source',()=>{
 const a=revisionFixture({'go.js':'one\ntwo\n'}),b=revisionFixture({'go.js':'\uFEFFone\r\ntwo\r\n'});assert.deepEqual(a,b);
 for(const file of ['go.js','go-policy.js','go-search-policy.js'])assert.equal(revisionFixture({[file]:''}),null);
 assert.equal(goPolicyRevisions(()=>{throw Error('not readable');}),null);
 for(const revisions of [null,{}, {common:'bad',search:'bad'}])assert.equal(goEngineConfigurations({},revisions),null);
 assert.deepEqual(revisionFixture(),revisionFixture());
});
test('old implementation profiles cannot promote a changed engine and switch-back reuses matching evidence',()=>{
 const revisions=revisionFixture(),oldConfig=goEngineConfigurations({},revisions),newConfig=goEngineConfigurations({},revisionFixture({'go-search-policy.js':'search changed'}));
 const engines={tactical:engineRows(10,{configuration:oldConfig.tactical}),'search-v1':engineRows(20,{configuration:oldConfig['search-v1']})};
 assert.equal(chooseGoEngine(engines,{...engineOptions,configurations:oldConfig}).engine,'search-v1');
 const changed=chooseGoEngine(engines,{...engineOptions,configurations:newConfig});assert.equal(changed.search.samples,0);assert.equal(changed.tactical.samples,6);assert.equal(changed.engine,'tactical');
 assert.equal(chooseGoEngine(engines,{...engineOptions,configurations:oldConfig}).engine,'search-v1');
 assert.notEqual(oldConfig.tactical,goEngineConfigurations().tactical);
 for(const key of Object.values(oldConfig))assert.ok(key.length<=80);
});


test('revision profiles fit persisted limits with long valid fractional settings',()=>{
 for(const mode of ['auto','off','shadow','play'])for(const chance of [0.0000012345678901234567,Number.MIN_VALUE,.12345678901234567,1])for(const ms of [1.2345678901234567,12.345678901234567,50]){
  const profiles=goEngineConfigurations({'search-mode':mode,'search-ms':ms,'search-nodes':1024,'cheat-chance-threshold':chance},revisionFixture());
  for(const key of Object.values(profiles))assert.ok(key.length<=80,key);
 }
});


function passFixture(board){
 const a=analyzeGoBoard(board),valid=board.map(r=>[...r].map(c=>c==='.')),controlled=board.map(r=>r.replaceAll('.','X')),outcomes=new Map();
 for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)if(valid[x][y])outcomes.set(x+','+y,goMoveOutcome(board,x,y,a));
 return [board,valid,controlled,outcomes,'Netburners',a];
}
test('settled passing recognizes larger vital eyes without filling safe territory',()=>{
 for(const board of [
  ['XXXXX','X...X','XXXXX','X...X','XXXXX'],
  ['XXXXX','X..XX','X..XX','XXXXX','XX.XX']
 ])assert.equal(goSettledPass(...passFixture(board)),true);
});
test('small blocked corridors and large nonvital rooms cannot stand in for a second eye',()=>{
 for(const board of [
  ['#.###','#.###','#XXXX','#X.XX','XXXXX'],
  ['XXXXXXX','X...XXX','X...XXX','X...XXX','XXXXXXX','XX.XXXX','XXXXXXX'],
  ['XXXXX','X...X','XXXXX','XXXXX','XXXXX']
 ])assert.equal(goSettledPass(...passFixture(board)),false);
});
test('vital eyes retain score, territory, captures and turn safeguards',()=>{
 const args=passFixture(['XXXXX','X...X','XXXXX','X...X','XXXXX']);
 for(const state of [{currentPlayer:'Black',blackScore:25,whiteScore:22},{currentPlayer:'White',blackScore:25,whiteScore:1},{currentPlayer:'Black',blackScore:NaN,whiteScore:1}])assert.equal(goSettledPass(...args,state),false);
 const neutral=passFixture(args[0]);neutral[2][1]='X?XXX';assert.equal(goSettledPass(...neutral),false);
 const capture=passFixture(args[0]);capture[3].set('1,1',{captured:1,saved:0});assert.equal(goSettledPass(...capture),false);
 const rescue=passFixture(args[0]);rescue[3].set('1,1',{captured:0,saved:1});assert.equal(goSettledPass(...rescue),false);
 const stale=passFixture(args[0]);stale[5]=analyzeGoBoard(['XXXXX','X...X','XXXXX','XXXXX','XXXXX']);assert.equal(goSettledPass(...stale),true);
});

// Independent copying simulator, intentionally ignoring ko: White gets at least
// as many attack options as in the game. No production life or search helpers.
function eyeAttackMove(board,x,y,color){
 if(board[x]?.[y]!=='.')return null;const b=board.map(r=>r.split(''));b[x][y]=color;const enemy=color==='X'?'O':'X';
 for(const [i,j]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(b[i]?.[j]===enemy){const g=group(b,i,j);if(!g.liberties.size)for(const [a,c]of g.stones)b[a][c]='.';}
 if(!group(b,x,y).liberties.size)return null;return b.map(r=>r.join(''));
}
// Finite safety game: Black may choose any defense, White any legal invasion.
// Passing keeps play alive, so two-pass termination cannot hide a losing attack.
function survivesEyeAttacks(initial){
 const original=[];for(let x=0;x<initial.length;x++)for(let y=0;y<initial.length;y++)if(initial[x][y]==='X')original.push([x,y]);
 const nodes=[],ids=new Map(),key=(b,c)=>c+b.join('/');
 const add=(board,color)=>{const k=key(board,color);if(ids.has(k))return ids.get(k);const id=nodes.length;ids.set(k,id);nodes.push({board,color,next:[],losing:original.some(([x,y])=>board[x][y]!=='X')});return id;};
 // Black has just passed: the opponent must get the first invasion.
 add(initial,'O');
 for(let i=0;i<nodes.length;i++){const node=nodes[i];if(node.losing)continue;const other=node.color==='X'?'O':'X';node.next.push(add(node.board,other));
  for(let x=0;x<initial.length;x++)for(let y=0;y<initial.length;y++){const board=eyeAttackMove(node.board,x,y,node.color);if(board)node.next.push(add(board,other));}
  assert.ok(nodes.length<10000,'fixture state space stays bounded');
 }
 let changed=true;while(changed){changed=false;for(const node of nodes)if(!node.losing&&(node.color==='X'?node.next.every(id=>nodes[id].losing):node.next.some(id=>nodes[id].losing))){node.losing=true;changed=true;}}
 return {safe:!nodes[0].losing,states:nodes.length};
}
test('independent exhaustive safety games verify larger-eye defenses and detect a one-eye loss',()=>{
 for(const board of [
  ['XXXXX','X...X','XXXXX','X...X','XXXXX'],
  ['XXXXX','X..XX','X..XX','XXXXX','XX.XX']
 ]){const result=survivesEyeAttacks(board);assert.equal(result.safe,true);assert.ok(result.states>20);}
 assert.equal(survivesEyeAttacks(['XXXXX','X..XX','XXXXX','XXXXX','XXXXX']).safe,false);
});


test('all accepted two-pocket fixtures survive exhaustive attacks after Black passes first',()=>{
 let verified=0,states=0;
 for(let a=1;a<8;a++)for(let b=1;b<8;b++){
  const row=mask=>'X'+[0,1,2].map(i=>mask&(1<<i)?'.':'X').join('')+'X';
  const board=['XXXXX',row(a),'XXXXX',row(b),'XXXXX'];
  if(!goSettledPass(...passFixture(board)))continue;const result=survivesEyeAttacks(board);
  assert.equal(result.safe,true,board.join('/'));verified++;states+=result.states;
 }
 assert.equal(verified,49);console.log('Vital-eye safety games: '+verified+' fixtures, '+states+' reachable states checked.');
});


const sharedEyeBoard=['X.X##','.X.##','X.X##','#####','#####'];
test('shared vital regions keep mutually supported chains alive without joining them',()=>{
 const args=passFixture(sharedEyeBoard),alive=goAliveChains(sharedEyeBoard,args[5]);assert.equal(args[5].groups.length,5);assert.equal(alive.size,5);
 assert.equal(goSettledPass(...args),true);assert.equal(survivesEyeAttacks(sharedEyeBoard).safe,true);
 assert.deepEqual(sharedEyeBoard,['X.X##','.X.##','X.X##','#####','#####']);
});
test('loss of one shared eye cascades instead of leaving unsupported neighbors alive',()=>{
 const board=['X#X##','.X.##','X.X##','#####','#####'];assert.equal(goAliveChains(board).size,0);assert.equal(goSettledPass(...passFixture(board)),false);
 const mixed=['X#X####','.X.####','X.X####','#######','XXXXXXX','X.X.XXX','XXXXXXX'],a=analyzeGoBoard(mixed),alive=goAliveChains(mixed,a);
 assert.equal(alive.size,1);assert.ok(alive.has(a.at[4*7]));assert.equal(goSettledPass(...passFixture(mixed)),false);
});
test('enemy-boundary regions, a single shared region and nonvital space cannot prove life',()=>{
 for(const board of [
  ['X.X##','.O.##','X.X##','#####','#####'],
  ['X.X##','#####','#####','#####','#####'],
  ['XXXXX','X...X','X...X','X...X','XXXXX']
 ])assert.equal(goAliveChains(board).size,0);
 const stale=analyzeGoBoard(['X#X##','.X.##','X.X##','#####','#####']);assert.equal(goAliveChains(sharedEyeBoard,stale).size,5);
});
test('all accepted blocked 3x3 binary layouts survive independent opponent-first safety games',()=>{
 let accepted=0,shared=0,states=0;
 for(let mask=0;mask<512;mask++){
  const board=Array.from({length:5},(_,x)=>Array.from({length:5},(_,y)=>x<3&&y<3?(mask&(1<<(x*3+y))?'X':'.'):'#').join(''));
  const args=passFixture(board);if(!goSettledPass(...args))continue;
  const result=survivesEyeAttacks(board);assert.equal(result.safe,true,board.join('/'));accepted++;states+=result.states;
  if(args[5].groups.length>1)shared++;
 }
 assert.ok(accepted>10);assert.ok(shared>0);console.log('Shared-eye safety games: '+accepted+' accepted layouts ('+shared+' with multiple chains), '+states+' reachable states checked.');
});


test('batch move outcomes match independent copying simulation across 300 seeded legality snapshots',()=>{
 for(let i=0;i<300;i++){
  const board=randomBoard([5,7,9,13][i%4]),before=[...board],a=analyzeGoBoard(board),valid=board.map(r=>[...r].map(()=>random()<.7)),batch=goMoveOutcomes(board,valid,a);let entries=0;
  for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++){const key=x+','+y;assert.equal(batch.has(key),valid[x][y]);if(valid[x][y]){entries++;assert.deepEqual(batch.get(key),reference(board,x,y));}}
  assert.equal(batch.size,entries);assert.deepEqual(board,before);
 }
});
test('batch validates stale and foreign analysis while retaining strict native legality filtering',()=>{
 const board=['XX.','X.O','..O'],a=analyzeGoBoard(board);board[0]='XO.';const valid=board.map(()=>Array(3).fill(true));
 for(const cached of [a,analyzeGoBoard(['...','...','...']),null]){const batch=goMoveOutcomes(board,valid,cached);for(let x=0;x<3;x++)for(let y=0;y<3;y++)assert.deepEqual(batch.get(x+','+y),reference(board,x,y));}
 const flags=[[1,true,'true'],[false,null,true]],batch=goMoveOutcomes(board,flags,a);assert.deepEqual([...batch.keys()],['0,1','1,2']);assert.equal(batch.get('0,1'),null);
 assert.equal(goMoveOutcomes(board,undefined).size,0);assert.equal(goMoveOutcomes([],[]).size,0);
});
test('batch validates a prepared board signature once instead of once per legal candidate',()=>{
 const board=Array(13).fill('.............'),valid=board.map(()=>Array(13).fill(true));let joins=0;
 Object.defineProperty(board,'join',{value:function(separator){joins++;return Array.prototype.join.call(this,separator);}});const a=analyzeGoBoard(board);joins=0;
 for(let x=0;x<13;x++)for(let y=0;y<13;y++)goMoveOutcome(board,x,y,a);assert.equal(joins,169);joins=0;
 const batch=goMoveOutcomes(board,valid,a);assert.equal(joins,1);assert.equal(batch.size,169);
 joins=0;goMoveOutcome(board,0,0,a);assert.equal(joins,1);
});
goCpuBenchmark('batch evaluator microbenchmark compares complete eager and batch frame preparation',()=>{
 const board=Array(13).fill('.............'),valid=board.map(()=>Array(13).fill(true));
 const eager=()=>{const a=analyzeGoBoard(board),outcomes=new Map();for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])outcomes.set(x+','+y,goMoveOutcome(board,x,y,a));return outcomes;};
 const batch=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(batch(),eager());
 for(let i=0;i<30;i++){eager();batch();}const times={eager:[],batch:[]};let checksum=0;
 for(let round=0;round<7;round++)for(const name of round%2?['batch','eager']:['eager','batch']){const start=performance.now();for(let i=0;i<100;i++)checksum+=(name==='eager'?eager():batch()).size;times[name].push(performance.now()-start);}
 const median=values=>values.sort((a,b)=>a-b)[3],old=median(times.eager),next=median(times.batch);
 console.log('IPvGO batch frame benchmark (100 empty 13x13 snapshots, median of 7): eager='+old.toFixed(2)+'ms batch='+next.toFixed(2)+'ms ratio='+(old/next).toFixed(2)+'x; CPU microbenchmark only.');
 assert.equal(checksum,7*2*100*169);assert.ok(Number.isFinite(old/next));
});


test('cached geometry preserves every corner, edge and interior and does not leak mutable tables',()=>{
 for(const size of [1,3,5,7,9,13]){
  const board=Array(size).fill('.'.repeat(size)),a=analyzeGoBoard(board),valid=board.map(()=>Array(size).fill(true)),batch=goMoveOutcomes(board,valid,a);
  assert.equal(a.neighbors,undefined);
  for(let x=0;x<size;x++)for(let y=0;y<size;y++){
   const expected=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([i,j])=>i>=0&&j>=0&&i<size&&j<size).length;
   assert.deepEqual(batch.get(x+','+y),{captured:0,liberties:expected,size:1,saved:0});
  }
 }
});
test('geometry reuse across different boards retains stale-analysis protection',()=>{
 const board=Array(13).fill('.............'),other=[...board],a=analyzeGoBoard(board),b=analyzeGoBoard(other);assert.notEqual(a.groups,b.groups);assert.notEqual(a.at,b.at);
 board[0]='X............';assert.deepEqual(goMoveOutcome(board,0,1,a),reference(board,0,1));assert.deepEqual(goMoveOutcome(other,0,1,b),reference(other,0,1));
 const result=goMoveOutcome(other,0,1,b);result.liberties=-99;assert.deepEqual(goMoveOutcome(other,0,1,b),reference(other,0,1));
});

// Previous allocation-based evaluator retained solely as a CPU baseline.
function uncachedNeighborOutcome(board,x,y,a){
 const size=a.size,key=x*size+y,neighbors=id=>{const i=Math.floor(id/size),j=id%size;return [i>0?id-size:-1,i+1<size?id+size:-1,j>0?id-1:-1,j+1<size?id+1:-1].filter(k=>k>=0);};
 const near=neighbors(key),friendly=new Set(),enemy=new Set(),liberties=new Set(),own=new Set([key]),removed=new Set();
 for(const k of near){const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}(a.groups[id].color==='X'?friendly:enemy).add(id);}
 let saved=0;for(const id of friendly){const g=a.groups[id];for(const [i,j]of g.stones)own.add(i*size+j);for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 for(const id of enemy){const g=a.groups[id];if(g.liberties.size===1&&g.liberties.has(key))for(const [i,j]of g.stones)removed.add(i*size+j);}
 for(const k of removed)if(neighbors(k).some(n=>own.has(n)))liberties.add(k);liberties.delete(key);
 return {captured:removed.size,liberties:liberties.size,size:own.size,saved:liberties.size>=2?saved:0};
}
goCpuBenchmark('neighbor cache microbenchmark compares complete frame preparation on empty and capture boards',()=>{
 const empty=Array(13).fill('.............'),capture=[...empty];capture[4]='....XXXXX....';for(let i=5;i<8;i++)capture[i]='....XOOOX....';capture[8]='....XX.XX....';
 for(const [name,board]of [['empty',empty],['capture',capture]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));
  const legacy=()=>{const a=analyzeGoBoard(board),signature=board.join('/');assert.equal(a.signature,signature);const result=new Map();for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,uncachedNeighborOutcome(board,x,y,a));return result;};
  const cached=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(cached(),legacy());if(name==='capture')assert.equal(cached().get('8,6').captured,9);
  for(let i=0;i<100;i++){legacy();cached();}const times={legacy:[],cached:[]};let count=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['cached','legacy']:['legacy','cached']){const start=performance.now();for(let i=0;i<1000;i++)count+=(kind==='legacy'?legacy():cached()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],old=median(times.legacy),next=median(times.cached);assert.equal(count,7*2*1000*cached().size);assert.ok(Number.isFinite(old/next));
  console.log('IPvGO neighbor benchmark '+name+' (1000 frames, median of 7): uncached='+old.toFixed(2)+'ms cached='+next.toFixed(2)+'ms ratio='+(old/next).toFixed(2)+'x; CPU only.');
 }
});


function referenceAnalysis(board){
 const size=board.length,at=Array(size*size).fill(-1),groups=[];
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if('XO'.includes(board[x][y])&&at[x*size+y]<0){const g={...group(board,x,y),color:board[x][y]},id=groups.length;groups.push(g);for(const [i,j]of g.stones)at[i*size+j]=id;}
 return {board,signature:board.join('/'),at,groups,size};
}
test('indexed group traversal preserves exact chain order, membership and liberties on 600 seeded boards',()=>{
 for(let i=0;i<600;i++){const board=randomBoard([1,3,5,7,9,13][i%6]),before=[...board];assert.deepEqual(analyzeGoBoard(board),referenceAnalysis(board));assert.deepEqual(board,before);}
});
test('group traversal isolates diagonal chains, walls, loops and full-board groups across resizes',()=>{
 for(const board of [[],['X'],['O'],['#'],['.'],['X.X','.X.','X.X'],['XXX','X.X','XXX'],['X#O','.#.','O#X'],Array(13).fill('XXXXXXXXXXXXX'),Array(5).fill('OOOOO')]){
  assert.deepEqual(analyzeGoBoard(board),referenceAnalysis(board));
  const valid=board.map(r=>[...r].map(c=>c==='.')),batch=goMoveOutcomes(board,valid);for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)if(valid[x][y])assert.deepEqual(batch.get(x+','+y),reference(board,x,y));
 }
 const board=['XXX','X.X','XXX'],old=analyzeGoBoard(board);board[0]='XOX';assert.deepEqual(analyzeGoBoard(board),referenceAnalysis(board));assert.deepEqual(goMoveOutcome(board,1,1,old),reference(board,1,1));
});
goCpuBenchmark('group traversal microbenchmark compares analysis and complete frames with the coordinate baseline',()=>{
 const dense=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['dense',dense],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));assert.deepEqual(analyzeGoBoard(board),referenceAnalysis(board));
  const operations={oldAnalysis:()=>referenceAnalysis(board),newAnalysis:()=>analyzeGoBoard(board),oldFrame:()=>goMoveOutcomes(board,valid,referenceAnalysis(board)),newFrame:()=>goMoveOutcomes(board,valid,analyzeGoBoard(board))};
  assert.deepEqual(operations.newFrame(),operations.oldFrame());for(let i=0;i<50;i++)for(const op of Object.values(operations))op();
  const results={};let checksum=0;
  for(const [label,oldName,newName,frames]of [['analysis','oldAnalysis','newAnalysis',1000],['frame','oldFrame','newFrame',100]]){
   const times={old:[],next:[]};for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<frames;i++){const result=operations[kind==='old'?oldName:newName]();checksum+=label==='analysis'?result.groups.length:result.size;}times[kind].push(performance.now()-start);}
   const median=values=>values.sort((a,b)=>a-b)[3],old=median(times.old),next=median(times.next);assert.ok(Number.isFinite(old/next));results[label]={old,next};
   console.log('IPvGO group traversal '+name+' '+label+' ('+frames+' iterations, median of 7): coordinate='+old.toFixed(2)+'ms indexed='+next.toFixed(2)+'ms ratio='+(old/next).toFixed(2)+'x; CPU only.');
  }assert.ok(checksum>0);
 }
});


test('fused chain IDs match independent analysis on every 3x3 Black White empty layout',()=>{
 for(let mask=0;mask<3**9;mask++){let value=mask;const cells=[];for(let i=0;i<9;i++){cells.push('.XO'[value%3]);value=Math.floor(value/3);}const board=[cells.slice(0,3).join(''),cells.slice(3,6).join(''),cells.slice(6,9).join('')];assert.deepEqual(analyzeGoBoard(board),referenceAnalysis(board));}
});
test('fused chain labels cover stones exactly once and leave every empty or blocked cell unassigned',()=>{
 for(let i=0;i<200;i++){const board=randomBoard([5,7,9,13][i%4]),a=analyzeGoBoard(board),assigned=new Set();
  for(let id=0;id<a.groups.length;id++)for(const [x,y]of a.groups[id].stones){const key=x*a.size+y;assert.equal(assigned.has(key),false);assigned.add(key);assert.equal(a.at[key],id);assert.equal(board[x][y],a.groups[id].color);}
  for(let x=0;x<a.size;x++)for(let y=0;y<a.size;y++)assert.equal(assigned.has(x*a.size+y),'XO'.includes(board[x][y]));
  for(let x=0;x<a.size;x++)for(let y=0;y<a.size;y++)if(!'XO'.includes(board[x][y]))assert.equal(a.at[x*a.size+y],-1);
 }
});

// Previous indexed traversal with a separate visited set and labeling scan.
function twoPassGroup(board,x,y,neighbors) {
 const color=board[x]?.[y],size=board.length,stones=[],seen=new Set(),liberties=new Set(),pending=[x*size+y];
 while(pending.length) {
  const key=pending.pop();
  if(seen.has(key))continue;seen.add(key);stones.push([Math.floor(key/size),key%size]);
  for(let n=key*4;n<key*4+4;n++){
   const next=neighbors[n];if(next<0)continue;
   const cell=board[Math.floor(next/size)][next%size];
   if(cell==='.')liberties.add(next);
   else if(cell===color&&!seen.has(next))pending.push(next);
  }
 }
 return {stones,liberties};
}

const twoPassNeighbors=new Map();
function twoPassAnalysis(board){
 const size=board.length,at=Array(size*size).fill(-1),groups=[];let neighbors=twoPassNeighbors.get(size);
 if(!neighbors){neighbors=new Int32Array(size*size*4);neighbors.fill(-1);for(let key=0;key<size*size;key++){const x=Math.floor(key/size),y=key%size,n=key*4;if(x>0)neighbors[n]=key-size;if(x+1<size)neighbors[n+1]=key+size;if(y>0)neighbors[n+2]=key-1;if(y+1<size)neighbors[n+3]=key+1;}twoPassNeighbors.set(size,neighbors);}
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if('XO'.includes(board[x][y])&&at[x*size+y]<0){const id=groups.length,g={...twoPassGroup(board,x,y,neighbors),color:board[x][y]};groups.push(g);for(const [i,j]of g.stones)at[i*size+j]=id;}
 return {board,signature:board.join('/'),at,groups,size};
}
goCpuBenchmark('fused labeling microbenchmark isolates gains against the previous indexed implementation',()=>{
 const dense=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['dense',dense],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));assert.deepEqual(analyzeGoBoard(board),twoPassAnalysis(board));
  for(const [label,iterations]of [['analysis',1000],['frame',300]]){
   const old=()=>label==='analysis'?twoPassAnalysis(board):goMoveOutcomes(board,valid,twoPassAnalysis(board)),next=()=>label==='analysis'?analyzeGoBoard(board):goMoveOutcomes(board,valid,analyzeGoBoard(board));
   assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
   for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<iterations;i++){const result=(kind==='old'?old():next());checksum+=label==='analysis'?result.groups.length:result.size;}times[kind].push(performance.now()-start);}
   const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),fused=median(times.next);assert.ok(checksum>0);assert.ok(Number.isFinite(prior/fused));
   console.log('IPvGO fused labels '+name+' '+label+' ('+iterations+' iterations, median of 7): twoPass='+prior.toFixed(2)+'ms fused='+fused.toFixed(2)+'ms ratio='+(prior/fused).toFixed(2)+'x; CPU only.');
  }
 }
});


test('chain-size evaluation handles repeated contact, multiple merges and captured interior points',()=>{
 for(const [board,x,y]of [
  [['XXX','X.X','XXX'],1,1],
  [['.X.','X.X','.X.'],1,1],
  [['XOX','O.O','XOX'],1,1],
  [['XXXXX','XOOOX','XOOOX','XOOOX','XX.XX'],4,2]
 ])assert.deepEqual(goMoveOutcome(board,x,y),reference(board,x,y));
 assert.equal(goMoveOutcome(['XXX','X.X','XXX'],1,1).size,9);
 assert.equal(goMoveOutcome(['.X.','X.X','.X.'],1,1).size,5);
 assert.deepEqual(goMoveOutcome(['XXXXX','XOOOX','XOOOX','XOOOX','XX.XX'],4,2),{captured:9,liberties:8,size:16,saved:15});
});
test('chain-ID move evaluation matches copying simulation for every empty point in all 3x3 layouts',()=>{
 let checked=0;for(let mask=0;mask<3**9;mask++){let value=mask;const cells=[];for(let i=0;i<9;i++){cells.push('.XO'[value%3]);value=Math.floor(value/3);}const board=[cells.slice(0,3).join(''),cells.slice(3,6).join(''),cells.slice(6,9).join('')],valid=board.map(r=>[...r].map(c=>c==='.')),a=analyzeGoBoard(board),batch=goMoveOutcomes(board,valid,a);
  for(let x=0;x<3;x++)for(let y=0;y<3;y++)if(valid[x][y]){assert.deepEqual(batch.get(x+','+y),reference(board,x,y));checked++;}
 }assert.equal(checked,59049);
});

// Previous private evaluator: reconstructs the merged friendly-stone set.
function ownSetOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 const friendly=new Set(),enemy=new Set(),liberties=new Set(),own=new Set([key]),removed=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  (a.groups[id].color==='X'?friendly:enemy).add(id);}
 let saved=0;
 for(const id of friendly){const g=a.groups[id];for(const [i,j]of g.stones)own.add(i*size+j);for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 for(const id of enemy){const g=a.groups[id];if(g.liberties.size===1&&g.liberties.has(key))for(const [i,j]of g.stones)removed.add(i*size+j);}
 for(const k of removed)for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&own.has(neighbors[n])){liberties.add(k);break;}
 liberties.delete(key);
 return {captured:removed.size,liberties:liberties.size,size:own.size,saved:liberties.size>=2?saved:0};
}

goCpuBenchmark('own-stone elimination microbenchmark compares complete frames against the previous evaluator',()=>{
 const empty=Array(13).fill('.............'),dense=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join('')),capture=[...empty];capture[4]='....XXXXX....';for(let i=5;i<8;i++)capture[i]='....XOOOX....';capture[8]='....XX.XX....';let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['empty',empty],['dense',dense],['capture',capture],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(13);
  const old=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale baseline');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,ownSetOutcome(board,x,y,a,neighbors));return result;};
  const next=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<500;i++)checksum+=(kind==='old'?old():next()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),ids=median(times.next);assert.equal(checksum,7*2*500*next().size);assert.ok(Number.isFinite(prior/ids));
  console.log('IPvGO own-stone elimination '+name+' (500 frames, median of 7): ownSet='+prior.toFixed(2)+'ms chainIDs='+ids.toFixed(2)+'ms ratio='+(prior/ids).toFixed(2)+'x; CPU only.');
 }
});


test('streamed captures count each enemy chain once and preserve mixed capture outcomes',()=>{
 for(const [board,x,y,captured]of [
  [['OOO','O.O','OOO'],1,1,8],
  [['XOX','O.O','XOX'],1,1,4],
  [['XOX','O.O','X..'],1,1,2],
  [['XXXXX','XOOOX','XOOOX','XOOOX','XX.XX'],4,2,9]
 ]){const actual=goMoveOutcome(board,x,y);assert.deepEqual(actual,reference(board,x,y));assert.equal(actual.captured,captured);}
 assert.deepEqual(goMoveOutcome(['OOO','O.O','OOO'],1,1),{captured:8,liberties:4,size:1,saved:0});
});
function largeCaptureFixture(){const board=Array(13).fill('.............');board[2]='..XXXXXXXXX..';for(let x=3;x<10;x++)board[x]='..XOOOOOOOX..';board[10]='..XXXX.XXXX..';return board;}
test('streamed large captures exclude interior points and do not mutate cached analysis',()=>{
 const board=largeCaptureFixture(),a=analyzeGoBoard(board),before=referenceAnalysis(board),valid=board.map(r=>[...r].map(c=>c==='.'));
 const first=goMoveOutcomes(board,valid,a);assert.deepEqual(first.get('10,6'),reference(board,10,6));assert.equal(first.get('10,6').captured,49);
 assert.deepEqual(a,before);assert.deepEqual(goMoveOutcomes(board,valid,a),first);
});

// Previous private evaluator: stores captured points before checking liberties.
function capturedSetOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 const friendly=new Set(),enemy=new Set(),liberties=new Set(),removed=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  (a.groups[id].color==='X'?friendly:enemy).add(id);}
 let saved=0,ownSize=1;
 for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 for(const id of enemy){const g=a.groups[id];if(g.liberties.size===1&&g.liberties.has(key))for(const [i,j]of g.stones)removed.add(i*size+j);}
 for(const k of removed)for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly.has(a.at[neighbors[n]]))){liberties.add(k);break;}
 liberties.delete(key);
 return {captured:removed.size,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
}

goCpuBenchmark('streamed capture microbenchmark compares complete frames against captured-stone sets',()=>{
 const empty=Array(13).fill('.............'),dense=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['empty',empty],['dense',dense],['largeCapture',largeCaptureFixture()],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(13);
  const old=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale baseline');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,capturedSetOutcome(board,x,y,a,neighbors));return result;};
  const next=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<1000;i++)checksum+=(kind==='old'?old():next()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),stream=median(times.next);assert.equal(checksum,7*2*1000*next().size);assert.ok(Number.isFinite(prior/stream));
  console.log('IPvGO streamed captures '+name+' (1000 frames, median of 7): capturedSet='+prior.toFixed(2)+'ms streamed='+stream.toFixed(2)+'ms ratio='+(prior/stream).toFixed(2)+'x; CPU only.');
 }
});


test('neighbor sets allocate only for friendly and capturable enemy chains while preserving results',async()=>{
 const source=await readFile(new URL('../go-policy.js',import.meta.url),'utf8');let allocations=0;class CountingSet extends Set{constructor(...args){super(...args);allocations++;}}
 const context={Set:CountingSet};vm.runInNewContext(source.replace(/^export /gm,'')+';globalThis.evaluate=evaluateGoMove;globalThis.geometry=goNeighborTable;',context);
 for(const [board,x,y,expected]of [
  [['...','...','...'],1,1,1],
  [['...','.X.','...'],1,0,2],
  [['...','.O.','...'],1,0,1],
  [['...','X.O','...'],1,1,2],
  [['OOO','O.O','OOO'],1,1,2],
  [['XOX','O.O','X..'],1,1,2],
  [['XXX','X.X','XXX'],1,1,2]
 ]){const a=analyzeGoBoard(board),neighbors=context.geometry(board.length);allocations=0;const result=context.evaluate(board,x,y,a,neighbors);assert.equal(allocations,expected,board.join('/'));assert.deepEqual(JSON.parse(JSON.stringify(result)),reference(board,x,y));}
});
test('reusing cached analysis cannot leak lazily created sets between candidate colors',()=>{
 const board=['X...O','.....','.....','.....','O...X'],a=analyzeGoBoard(board),valid=board.map(r=>[...r].map(c=>c==='.'));
 for(let repeat=0;repeat<4;repeat++){const batch=goMoveOutcomes(board,valid,a);for(const [x,y]of [[0,1],[2,2],[0,3],[3,0],[4,3],[1,4]])assert.deepEqual(batch.get(x+','+y),reference(board,x,y));}
 assert.deepEqual(a,referenceAnalysis(board));
});

// Previous private evaluator: always allocates both neighboring-chain sets.
function eagerNeighborOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 const friendly=new Set(),enemy=new Set(),liberties=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  (a.groups[id].color==='X'?friendly:enemy).add(id);}
 let saved=0,ownSize=1,captured=0;
 for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 // Enemy chain IDs are unique, so capture counts need no per-stone deduplication.
 for(const id of enemy){const g=a.groups[id];if(g.liberties.size!==1||!g.liberties.has(key))continue;
  captured+=g.stones.length;
  for(const [i,j]of g.stones){const k=i*size+j;for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly.has(a.at[neighbors[n]]))){liberties.add(k);break;}}
 }
 liberties.delete(key);
 return {captured,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
}

goCpuBenchmark('lazy neighbor allocation microbenchmark compares complete frames against eager sets',()=>{
 const empty=Array(13).fill('.............'),dense=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['empty',empty],['dense',dense],['largeCapture',largeCaptureFixture()],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(13);
  const old=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale baseline');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,eagerNeighborOutcome(board,x,y,a,neighbors));return result;};
  const next=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<1000;i++)checksum+=(kind==='old'?old():next()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),lazy=median(times.next);assert.equal(checksum,7*2*1000*next().size);assert.ok(Number.isFinite(prior/lazy));
  console.log('IPvGO lazy neighbor sets '+name+' (1000 frames, median of 7): eager='+prior.toFixed(2)+'ms lazy='+lazy.toFixed(2)+'ms ratio='+(prior/lazy).toFixed(2)+'x; CPU only.');
 }
});


test('capture eligibility filtering preserves repeated enemy contact, surviving chains and changing candidates',()=>{
 const boards=[['OOO','O.O','OOO'],['XOX','O.O','X..'],['...','.O.','...'],['O.O','...','O.O'],['XXXXX','XOOOX','XOOOX','XOOOX','XX.XX']];
 for(const board of boards){const a=analyzeGoBoard(board),valid=board.map(r=>[...r].map(c=>c==='.')),before=referenceAnalysis(board);
  for(let round=0;round<3;round++){const batch=goMoveOutcomes(board,valid,a);for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)if(valid[x][y])assert.deepEqual(batch.get(x+','+y),reference(board,x,y));}assert.deepEqual(a,before);
 }
});

// Previous private evaluator: tracks every neighboring enemy chain before testing capture.
function unfilteredEnemyOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 let friendly=null,enemy=null;const liberties=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  if(a.groups[id].color==='X')(friendly??=new Set()).add(id);else (enemy??=new Set()).add(id);}
 let saved=0,ownSize=1,captured=0;
 if(friendly)for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 // Enemy chain IDs are unique, so capture counts need no per-stone deduplication.
 if(enemy)for(const id of enemy){const g=a.groups[id];if(g.liberties.size!==1||!g.liberties.has(key))continue;
  captured+=g.stones.length;
  for(const [i,j]of g.stones){const k=i*size+j;for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly?.has(a.at[neighbors[n]]))){liberties.add(k);break;}}
 }
 liberties.delete(key);
 return {captured,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
}

goCpuBenchmark('capture eligibility microbenchmark compares complete frames against unfiltered enemy tracking',()=>{
 const empty=Array(13).fill('.............'),friendly=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join('')),safeEnemies=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'O':'.').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['empty',empty],['friendly',friendly],['safeEnemies',safeEnemies],['largeCapture',largeCaptureFixture()],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(13);
  const old=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale baseline');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,unfilteredEnemyOutcome(board,x,y,a,neighbors));return result;};
  const next=()=>goMoveOutcomes(board,valid,analyzeGoBoard(board));assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<1000;i++)checksum+=(kind==='old'?old():next()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),filtered=median(times.next);assert.equal(checksum,7*2*1000*next().size);assert.ok(Number.isFinite(prior/filtered));
  console.log('IPvGO capture eligibility '+name+' (1000 frames, median of 7): unfiltered='+prior.toFixed(2)+'ms filtered='+filtered.toFixed(2)+'ms ratio='+(prior/filtered).toFixed(2)+'x; CPU only.');
 }
});


test('isolated noncapturing fast path retains blocked, edge and enemy-neighbor outcomes',()=>{
 for(const [board,x,y]of [[['###','#.#','###'],1,1],[['...','...','...'],0,0],[['...','.O.','...'],1,0],[['OOO','O.O','OOO'],1,1]])assert.deepEqual(goMoveOutcome(board,x,y),reference(board,x,y));
});


// Rejected production prototype retained for repeatable correctness/CPU comparison.
function listNeighborOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 let friendly=null,enemy=null;const liberties=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  const g=a.groups[id];
  if(g.color==='X'){friendly??=[];if(!friendly.includes(id))friendly.push(id);}
  else if(g.liberties.size===1&&g.liberties.has(key)){enemy??=[];if(!enemy.includes(id))enemy.push(id);}
 }
 if(!friendly&&!enemy)return {captured:0,liberties:liberties.size,size:1,saved:0};
 let saved=0,ownSize=1,captured=0;
 if(friendly)for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 // Only capturable enemy chains are retained, deduplicated by ID.
 if(enemy)for(const id of enemy){const g=a.groups[id];
  captured+=g.stones.length;
  for(const [i,j]of g.stones){const k=i*size+j;for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly?.includes(a.at[neighbors[n]]))){liberties.add(k);break;}}
 }
 liberties.delete(key);
 return {captured,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
}

test('short-list prototype preserves independent results without changing the production evaluator',()=>{
 for(const board of [['XXX','X.X','XXX'],['OOO','O.O','OOO'],['.X.','X.X','.X.'],['XOX','O.O','XOX'],['XOX','O.O','X..']]){
  const a=analyzeGoBoard(board);twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(board.length);for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)if(board[x][y]==='.')assert.deepEqual(listNeighborOutcome(board,x,y,a,neighbors),reference(board,x,y));
 }
});
// Previous private evaluator: on-demand hashed chain-ID sets.
function hashedNeighborOutcome(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 let friendly=null,enemy=null;const liberties=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  const g=a.groups[id];if(g.color==='X')(friendly??=new Set()).add(id);else if(g.liberties.size===1&&g.liberties.has(key))(enemy??=new Set()).add(id);}
 if(!friendly&&!enemy)return {captured:0,liberties:liberties.size,size:1,saved:0};
 let saved=0,ownSize=1,captured=0;
 if(friendly)for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 // Only capturable enemy chains are retained, deduplicated by ID.
 if(enemy)for(const id of enemy){const g=a.groups[id];
  captured+=g.stones.length;
  for(const [i,j]of g.stones){const k=i*size+j;for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly?.has(a.at[neighbors[n]]))){liberties.add(k);break;}}
 }
 liberties.delete(key);
 return {captured,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
}

goCpuBenchmark('neighbor list microbenchmark compares complete frames against on-demand hashed sets',()=>{
 const empty=Array(13).fill('.............'),friendly=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'.':'X').join('')),safeEnemies=Array.from({length:13},(_,x)=>Array.from({length:13},(_,y)=>x%3===1&&y%3===1?'O':'.').join(''));let state=9327;
 const mixed=Array.from({length:13},()=>Array.from({length:13},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '.XO#'[Math.floor(state/2**32*4)];}).join(''));
 for(const [name,board]of [['empty',empty],['friendly',friendly],['safeEnemies',safeEnemies],['largeCapture',largeCaptureFixture()],['mixed',mixed]]){
  const valid=board.map(r=>[...r].map(c=>c==='.'));twoPassAnalysis(board);const neighbors=twoPassNeighbors.get(13);
  const old=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale baseline');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,hashedNeighborOutcome(board,x,y,a,neighbors));return result;};
  const next=()=>{const a=analyzeGoBoard(board),result=new Map();if(a.signature!==board.join('/'))throw Error('stale prototype');for(let x=0;x<13;x++)for(let y=0;y<13;y++)if(valid[x][y])result.set(x+','+y,listNeighborOutcome(board,x,y,a,neighbors));return result;};assert.deepEqual(next(),old());for(let i=0;i<100;i++){old();next();}const times={old:[],next:[]};let checksum=0;
  for(let round=0;round<7;round++)for(const kind of round%2?['next','old']:['old','next']){const start=performance.now();for(let i=0;i<1000;i++)checksum+=(kind==='old'?old():next()).size;times[kind].push(performance.now()-start);}
  const median=values=>values.sort((a,b)=>a-b)[3],prior=median(times.old),lists=median(times.next);assert.equal(checksum,7*2*1000*next().size);assert.ok(Number.isFinite(prior/lists));
  console.log('IPvGO neighbor lists '+name+' (1000 frames, median of 7): hashed='+prior.toFixed(2)+'ms lists='+lists.toFixed(2)+'ms ratio='+(prior/lists).toFixed(2)+'x; CPU only.');
 }
});
