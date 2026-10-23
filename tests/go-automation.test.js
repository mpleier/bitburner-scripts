import * as replayPolicy from '../go-replay-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../go-policy.js';
import * as opponentPolicy from '../go-opponent-policy.js';
test('Go validates goals, explicit opponents and cheat thresholds',()=>{
 const o={goal:'auto',opponent:'','cheat-chance-threshold':.9};assert.equal(policy.goOptionsError(o),null);
 for(const patch of [{goal:'bad'},{opponent:'bad'},{'cheat-chance-threshold':2},{'cheat-chance-threshold':NaN}])assert.ok(policy.goOptionsError({...o,...patch}));
});
test('both cheat-disable options and Source File levels are honored',()=>{
 assert.equal(policy.goCheatsEnabled({cheats:true},2),true);
 for(const [o,l]of [[{cheats:false},3],[{'disable-cheats':true},3],[{cheats:true},1]])assert.equal(policy.goCheatsEnabled(o,l),false);
});
test('two-move cheats require two distinct legal integer coordinates',()=>{
 const v=[[true,false],[true,true]];assert.equal(policy.validGoPair(v,[0,0,1,1]),true);
 for(const c of [[0,0,0,0],[0,1,1,1],[-1,0,1,1],[0.1,0,1,1],[0,0,1],null])assert.equal(policy.validGoPair(v,c),false);
});
test('move shuffling preserves every coordinate without changing the input list',()=>{
 const m=[[0,0],[1,1],[2,2]],result=policy.shuffleGoMoves(m,()=>0);
 assert.deepEqual(m,[[0,0],[1,1],[2,2]]);assert.equal(new Set(result).size,3);assert.notDeepEqual(result,m);
});
test('achievement Go goals require a live owner, matching node and fresh heartbeat',()=>{
 let g={ownerPid:1,nodeReset:7,expiresAt:200},alive=true;const ns={read:()=>JSON.stringify(g),getResetInfo:()=>({lastNodeReset:7}),isRunning:()=>alive};
 assert.equal(policy.liveGoGoals(ns,100).ownerPid,1);alive=false;assert.equal(policy.liveGoGoals(ns,100),null);
 alive=true;g.nodeReset=8;assert.equal(policy.liveGoGoals(ns,100),null);g.nodeReset=7;assert.equal(policy.liveGoGoals(ns,201),null);
});
test('anticheat attempts can continue past the first turn but are bounded and protect streak goals',()=>{
 assert.equal(policy.attemptGoFailure({goFailure:true},1,true),true);
 assert.equal(policy.attemptGoFailure({goFailure:true},16,true),false);
 assert.equal(policy.attemptGoFailure({goFailure:true,goStreak:true},0,true),false);
 assert.equal(policy.attemptGoFailure({goFailure:true},0,false),false);
});
test('opponent ranking sanitizes numeric strings and malformed native stats',()=>{
 for(const s of [{wins:'10',losses:'2',bonusPercent:'3'},{wins:Infinity,losses:'bad',bonusPercent:NaN}])assert.ok(policy.rankGoOpponents({Netburners:s}).every(v=>Number.isFinite(v.score)));
});
async function controller(ns,overrides={}) {
 const source=await readFile(new URL('../go.js',import.meta.url),'utf8');
 const context={...replayPolicy,registerAutomation(){},automationHeartbeat(){},maintenanceRequested:()=>false,...policy,...opponentPolicy,performance:{now:()=>0},isScriptPaused:()=>false,achievementActionAllowed:()=>true,ns,...overrides};
 const injection=`globalThis.harness={recordGoReplay,playGo,isPattern,preparePatternBoard,setPatternSnapshot,patternBoard:()=>testBoard,setControlled:v=>{contested=v;},initializeGoPolicyRevision,revision:()=>policyRevision,readGoSnapshot,observeGoSnapshot,setIdentity:i=>{boardIdentity=i;},record:()=>gameRecord,session:()=>activeSession,status:()=>goStatus,beginGoSession,checkpointGo,closeGoSession,recoverGoSession,engines:()=>engineBuckets,setEngines:(e)=>{engineBuckets=e;},setRecord:(record,engine)=>{gameRecord=record;goEngine=engine;performanceBuckets=engineBuckets[engine];},timing:()=>({...moveTiming}),start,waitForGoTurn,checkNewGame,getAllValidMoves,go_cheat_playTwoMoves,go_makeMove,go_passTurn,moveSnakeEyes,setRunOnce:value=>{runOnce=value;startedGame=false;},set:(b,v,t,o={goal:'auto',opponent:''})=>{setPatternSnapshot(b);validMove=v;contested=b.map(r=>'?'.repeat(r.length));turn=t;goOptions=o;runOnce=false;}};`;
 await vm.runInNewContext(source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replace('export async function main','async function main').replace('export function autocomplete','function autocomplete').replace('    await start();',injection)+';main(ns)',context);
 return context.harness;
}
const nsMock=()=>({pid:1,getScriptName:()=> 'go.js',read:()=>'',getResetInfo:()=>({currentNode:1,lastNodeReset:7}),isRunning:()=>true,write:async()=>{},clearLog(){},go:{analysis:{getStats:()=>({}),getValidMoves:()=>[[true,true],[true,true]]},resetBoardState(){return ['..','..'];},makeMove:async()=>({type:'move'}),passTurn:async()=>({type:'pass'}),cheat:{playTwoMoves:async()=>({type:'move',x:1,y:1})}}});
test('controller resets the real move cache between games',async()=>{
 const ns=nsMock(),h=await controller(ns);h.set(['..','..'],[[true,false],[false,false]],1);h.getAllValidMoves();
 await h.checkNewGame(ns,{type:'gameOver'});h.set(['..','..'],[[false,false],[false,true]],1);
 assert.equal(JSON.stringify(h.getAllValidMoves()),'[[1,1]]');
});
test('unavailable explicit opponents never fall back to another faction',async()=>{
 const ns=nsMock(),attempts=[];ns.go.resetBoardState=name=>{attempts.push(name);throw Error('locked');};const h=await controller(ns);h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto',opponent:'Daedalus'});
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),/No available/);assert.deepEqual(attempts,['Daedalus']);
});
test('serialized cheat helpers await the opponent result rather than serializing a Promise',async()=>{
 const ns=nsMock(),h=await controller(ns,{getNsDataThroughFile:async(ns,command,file,args)=>{ns.args=args;const json=await new (Object.getPrototypeOf(async function(){}).constructor)('ns',`return JSON.stringify(${command});`)(ns);return JSON.parse(json);}});
 h.set(['..','..'],[[true,true],[true,true]],1);assert.equal((await h.go_cheat_playTwoMoves(ns,0,0,1,1)).type,'move');
});
test('ordinary moves revalidate coordinates and passes respect newly set pauses',async()=>{
 const ns=nsMock(),h=await controller(ns,{getNsDataThroughFile:async()=>{throw Error('unexpected worker');}});ns.go.analysis.getValidMoves=()=>[[false,true],[true,true]];
 await assert.rejects(h.go_makeMove(ns,0,0),/board changed/);
 let stopped=false;const paused=await controller(ns,{isScriptPaused:()=>stopped});stopped=true;await assert.rejects(paused.go_passTurn(ns),e=>typeof e==='symbol');
});


test('board size options reject unsupported values and native board validation catches failed resets',()=>{
 const options={goal:'auto',opponent:'','cheat-chance-threshold':.9};
 for(const size of [5,7,9,13])assert.equal(policy.goOptionsError({...options,'board-size':size}),null);
 for(const size of [0,19,'13',NaN])assert.ok(policy.goOptionsError({...options,'board-size':size}));
 assert.equal(policy.validGoBoard(['X.','.O']),true);
 for(const board of [undefined,[],['...','..'],['??','..']])assert.equal(policy.validGoBoard(board),false);
});
test('invalid cheat probabilities never authorize ordinary cheats',()=>{
 for(const chance of [NaN,Infinity,undefined,-1,1.1,.89])assert.equal(policy.goCheatChanceAllowed(chance,.9),false);
 assert.equal(policy.goCheatChanceAllowed(.9,.9),true);
});
test('runOnce starts a new board when the previous game is already over and stops after that game',async()=>{
 const ns=nsMock(),h=await controller(ns);h.set(['..','..'],[[true,true],[true,true]],1);h.setRunOnce(true);
 await h.checkNewGame(ns,{type:'gameOver'});
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),e=>typeof e==='symbol');
});
test('failed reset results do not publish a successful opponent selection',async()=>{
 const ns=nsMock(),h=await controller(ns);ns.go.resetBoardState=()=>undefined;h.set(['..','..'],[[true,true],[true,true]],1);
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),/No available/);
});


test('Go captures remove stones before counting new liberties and do not mutate the board',()=>{
 const board=['.X.','XOX','...'],before=[...board];
 const result=policy.goMoveOutcome(board,2,1);
 assert.equal(result.captured,1);assert.ok(result.liberties>=2);assert.deepEqual(board,before);
});

test('Go counts a captured chain touching a move on two sides only once',()=>{
 const result=policy.goMoveOutcome(['OOX','O.X','XXX'],1,1);
 assert.equal(result.captured,3);
});

test('Go rescue counts a threatened friendly group once and rejects occupied coordinates',()=>{
 const board=['XXO..','X....','O.O..','.....','.....'];
 const result=policy.goMoveOutcome(board,1,1);assert.equal(result.saved,3);assert.equal(result.size,4);
 assert.equal(policy.goMoveOutcome(['XXOOO','X.OOO','OOOOO','OOOOO','OOOO.'],1,1).liberties,0);
 assert.equal(policy.goMoveOutcome(board,0,0),null);
 assert.equal(policy.goMoveOutcome(board,-1,0),null);
});

test('Go tactical move selection rejects non-capturing self-atari and follows native legality',()=>{
 const board=['..','..'],valid=[[true,true],[false,false]],outcomes=new Map([
  ['0,0',{captured:0,liberties:1,size:4,saved:0}],['0,1',{captured:2,liberties:3,size:1,saved:0}],['1,0',{captured:100,liberties:3,size:1,saved:0}]]);
 assert.deepEqual(policy.goTacticalMove(board,valid,outcomes,()=>0).coords,[0,1]);
});

test('Go pause guard also stops moves during maintenance',async()=>{
 const ns=nsMock(),h=await controller(ns,{maintenanceRequested:()=>true});
 await assert.rejects(h.go_passTurn(ns),e=>typeof e==='symbol');
});


test('startup publishes status before instance discovery waits',async()=>{
 const ns=nsMock(),writes=[];ns.write=async(path,text)=>writes.push([path,JSON.parse(text)]);
 const h=await controller(ns,{getConfiguration:()=>({}),instanceCount:async()=>{assert.equal(writes[0][1].state,'initializing');return 2;}});
 await h.start();assert.equal(writes[0][1].pid,1);
});
test('resume never waits for an old opponent promise on Black or completed boards',async()=>{
 for(const [player,type]of [['Black','move'],['None','gameOver']]){
  const ns=nsMock();ns.go.getCurrentPlayer=()=>player;ns.go.opponentNextTurn=()=>assert.fail('stale promise must not be used');
  const h=await controller(ns);assert.equal((await h.waitForGoTurn(ns)).type,type);
 }
});
test('resume polls White until ready, maintains heartbeat and remains cancellable',async()=>{
 const ns=nsMock();let player='White',sleeps=0,beats=0;
 ns.go.getCurrentPlayer=()=>player;ns.go.getOpponent=()=> 'Tetrads';
 ns.sleep=async()=>{if(++sleeps===2)player='Black';};
 const h=await controller(ns,{automationHeartbeat:()=>beats++});
 assert.equal((await h.waitForGoTurn(ns)).type,'move');assert.equal(sleeps,2);assert.equal(beats,3);
 let paused=false;player='White';ns.sleep=async()=>{paused=true;};
 const stopped=await controller(ns,{isScriptPaused:()=>paused});
 await assert.rejects(stopped.waitForGoTurn(ns),e=>typeof e==='symbol');
});
test('resume recognizes game completion during an opponent wait and rejects invalid state',async()=>{
 const ns=nsMock();let player='White';ns.go.getCurrentPlayer=()=>player;ns.go.getOpponent=()=> 'Tetrads';ns.sleep=async()=>{player='None';};
 const h=await controller(ns);assert.equal((await h.waitForGoTurn(ns)).type,'gameOver');
 player='unexpected';await assert.rejects(h.waitForGoTurn(ns),/Unknown Go turn state/);
});

 test('ordinary validation and submission run without a worker or asynchronous gap',async()=>{
  const ns=nsMock(),events=[],h=await controller(ns,{getNsDataThroughFile:async()=>{throw Error('unexpected worker');}});
  ns.go.analysis.getValidMoves=()=>{events.push('validate');queueMicrotask(()=>events.push('yield'));return [[true,true],[true,true]];};
  ns.go.makeMove=async(x,y)=>{events.push('submit '+x+','+y);return {type:'move'};};
  assert.equal((await h.go_makeMove(ns,0,0)).type,'move');
  assert.deepEqual(events,['validate','submit 0,0','yield']);
 });

test('ordinary move telemetry separates preparation, validation and native response time',async()=>{
 let clock=10;const ns=nsMock(),h=await controller(ns,{performance:{now:()=>clock}});
 ns.go.analysis.getValidMoves=()=>{clock+=2;return [[true,true],[true,true]];};
 ns.go.makeMove=async()=>{clock+=5;return {type:'move'};};
 await h.go_makeMove(ns,0,0);
 assert.equal(JSON.stringify(h.timing()),JSON.stringify({ordinaryMoves:1,passes:0,earlyPasses:0,cheatAttempts:0,cheatMoves:0,failedActions:0,thinkingMs:12,validationMs:2,nativeWaitMs:5,passWaitMs:0,cheatWaitMs:0}));
});

test('pass and cheat timing includes failed attempts without counting preparation twice',async()=>{
 let clock=10;const ns=nsMock(),h=await controller(ns,{performance:{now:()=>clock},getNsDataThroughFile:async()=>{clock+=7;return null;}});
 ns.go.passTurn=async()=>{clock+=3;return {type:'pass'};};
 await h.go_cheat_playTwoMoves(ns,0,0,1,1);clock+=2;await h.go_passTurn(ns);
 const t=h.timing();assert.equal(t.cheatAttempts,1);assert.equal(t.cheatMoves,0);assert.equal(t.failedActions,1);assert.equal(t.cheatWaitMs,7);assert.equal(t.passes,1);assert.equal(t.passWaitMs,3);assert.equal(t.thinkingMs,12);
 ns.go.passTurn=async()=>{clock+=4;throw Error('native failure');};await assert.rejects(h.go_passTurn(ns),/native failure/);
 assert.equal(h.timing().failedActions,2);assert.equal(h.timing().passWaitMs,7);assert.equal(h.timing().passes,1);
});
test('completed engine trials persist timing and never mix challenger results into tactical history',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),h=await controller(ns);
 h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto','search-mode':'auto'});
 ns.write=async(f,s)=>files.set(f,JSON.parse(s));ns.go.analysis.getStats=()=>({Netburners:{wins:1,losses:0,bonusPercent:1,winStreak:1}});
 ns.go.getGameState=()=>({blackScore:20,komi:1.5});
 h.setEngines({tactical:{},'search-v1':{}});h.setRecord({opponent:'Netburners',size:13,cheats:false,startedAt:now-60000,wins:0,losses:0,bonus:0,winStreak:0,turns:20},'search-v1');
 h.setRunOnce(true);await h.checkNewGame(ns,{type:'gameOver'});
 const saved=files.get('tasks/go-performance.json');assert.equal(saved.version,4);assert.deepEqual(Object.keys(saved.engines.tactical),[]);
 const row=saved.engines['search-v1']['Netburners:13:normal'];assert.equal(row.games,1);assert.equal(row.history[0].timing.passes,0);
});

test('actual controller schedules a matching challenger trial and preserves explicit board size',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),h=await controller(ns);
 const baseline={configuration:policy.goEngineConfigurations().tactical,opponent:'Netburners',size:13,cheats:false,rewardVersion:2,games:3,wins:3,completed:8,totalMs:3000,totalBonus:3,totalReward:30,history:Array.from({length:3},(_,i)=>({at:now-i*1000,ms:1000,win:1,bonus:1,reward:10}))};
 h.setEngines({tactical:{a:baseline},'search-v1':{}});h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto',opponent:'Netburners','search-mode':'auto','adaptive-boards':false,'board-size':13});
 ns.write=async(f,s)=>files.set(f,JSON.parse(s));ns.go.analysis.getStats=()=>({Netburners:{wins:7,losses:0}});
 ns.go.resetBoardState=()=>Array(13).fill('.'.repeat(13));await h.checkNewGame(ns,{type:'gameOver'});
 const status=files.get('tasks/go-status.json');assert.equal(status.engine,'search-v1');assert.equal(status.enginePlan.trial,true);assert.equal(status.boardSize,13);
});

test('actual controller rejects another search budget and restores the matching profile on switch-back',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),h=await controller(ns),config=policy.goEngineConfigurations();
 const row=(configuration,reward)=>({opponent:'Netburners',size:13,cheats:false,configuration,rewardVersion:2,games:6,wins:6,completed:8,totalMs:6000,totalBonus:6,totalReward:reward*6,history:Array.from({length:6},(_,i)=>({at:now-i*1000,ms:1000,win:1,bonus:1,reward}))});
 h.setEngines({tactical:{a:row(config.tactical,10)},'search-v1':{b:row(config['search-v1'],20)}});
 ns.write=async(f,s)=>files.set(f,JSON.parse(s));ns.go.analysis.getStats=()=>({Netburners:{wins:8,losses:0}});ns.go.resetBoardState=()=>Array(13).fill('.'.repeat(13));
 const options={goal:'auto',opponent:'Netburners','search-mode':'auto','adaptive-boards':false,'board-size':13,'search-ms':10};
 h.set(['..','..'],[[true,true],[true,true]],1,options);await h.checkNewGame(ns,{type:'gameOver'});
 let status=files.get('tasks/go-status.json');assert.equal(status.engine,'tactical');assert.equal(status.enginePlan.search.samples,0);assert.equal(status.enginePlan.tactical.samples,6);
 h.set(['..','..'],[[true,true],[true,true]],1,{...options,'search-ms':5});await h.checkNewGame(ns,{type:'gameOver'});
 status=files.get('tasks/go-status.json');assert.equal(status.engine,'search-v1');assert.equal(status.configuration,config['search-v1']);
});

test('actual controller reports excluded achievement attempts without changing engine evidence',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),h=await controller(ns);
 h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto','search-mode':'auto'});h.setEngines({tactical:{},'search-v1':{}});
 h.setRecord({opponent:'Netburners',size:13,cheats:false,startedAt:now-60000,wins:0,losses:0,bonus:0,measurementExcluded:'achievement-failure-attempt'},'tactical');
 ns.write=async(f,s)=>files.set(f,JSON.parse(s));ns.go.analysis.getStats=()=>({Netburners:{wins:1,losses:0,bonusPercent:1}});
 await h.checkNewGame(ns,{type:'gameOver'});
 assert.deepEqual(Object.keys(files.get('tasks/go-performance.json').engines.tactical),[]);
 const last=files.get('tasks/go-status.json').lastMeasurement;assert.equal(last.accepted,false);assert.equal(last.excludedReason,'achievement-failure-attempt');
});

test('controller recovery persists observed cost before closing and survives repeated recovery',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),reset={currentNode:7,lastNodeReset:1,lastAugReset:2};ns.getResetInfo=()=>reset;
 const session={schemaVersion:1,state:'active',id:'recover',nodeReset:1,augReset:2,engine:'tactical',at:now-1000,record:{opponent:'Netburners',size:13,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:now-6000}};
 files.set('tasks/go-session.json',JSON.stringify(session));ns.read=f=>files.get(f)||'';ns.write=async(f,s)=>files.set(f,s);
 const h=await controller(ns);await h.recoverGoSession();const saved=JSON.parse(files.get('tasks/go-performance.json'));
 const row=Object.values(saved.engines.tactical)[0];assert.equal(row.games,0);assert.equal(row.interruptions[0].ms,5000);assert.equal(JSON.parse(files.get('tasks/go-session.json')).state,'closed');
 files.set('tasks/go-session.json',JSON.stringify(session));await h.recoverGoSession();assert.equal(Object.values(h.engines().tactical)[0].interruptions.length,1);
});
test('resumed partial completion records cost but never credits its native victory',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map();ns.getResetInfo=()=>({lastNodeReset:1,lastAugReset:2,currentNode:7});ns.write=async(f,s)=>files.set(f,JSON.parse(s));
 const h=await controller(ns);h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto',opponent:'Netburners','search-mode':'auto'});
 await h.beginGoSession({opponent:'Netburners',size:13,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:now-5000,partial:true});
 ns.go.analysis.getStats=()=>({Netburners:{wins:100,losses:0,bonusPercent:100}});await h.checkNewGame(ns,{type:'gameOver'});
 const row=Object.values(files.get('tasks/go-performance.json').engines.tactical)[0];assert.equal(row.games,0);assert.equal(row.totalReward,0);assert.ok(row.interruptions[0].ms>=5000);
 const last=files.get('tasks/go-status.json').lastMeasurement;assert.equal(last.accepted,false);assert.equal(last.excludedReason,'resumed-partial-game');
});

test('manual opponent replacement charges only the old checkpoint and starts a fresh partial segment',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map();ns.getResetInfo=()=>({lastNodeReset:1,lastAugReset:2,currentNode:7});ns.write=async(f,s)=>files.set(f,JSON.parse(s));
 const h=await controller(ns);h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto','search-mode':'auto'});
 const record={opponent:'Netburners',size:5,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:now-6000};
 h.setRecord(record,'tactical');await h.beginGoSession(record);const saved=files.get('tasks/go-session.json'),oldId=saved.id;
 const board=Array(7).fill('.......'),observation=policy.goBoardObservation(board,'Tetrads',[],policy.goBoardObservation(Array(5).fill('.....'),'Netburners',[]).identity);
 assert.equal(await h.observeGoSnapshot({board,observation}),true);
 const row=Object.values(h.engines().tactical)[0];assert.equal(row.games,0);assert.equal(row.interruptions[0].ms,saved.at-record.startedAt);
 assert.equal(h.record(),null);assert.equal(h.session().record.partial,true);assert.equal(h.session().record.opponent,'Tetrads');assert.notEqual(h.session().id,oldId);
 assert.equal(h.status().lastMeasurement.accepted,false);assert.equal(h.status().lastInterruption.reason,'opponent-replaced');
});
test('pre-submission guards reject a changed game before ordinary moves and passes',async()=>{
 const ns=nsMock(),h=await controller(ns),empty=Array(5).fill('.....');let submitted=0;
 h.setIdentity(policy.goBoardObservation(['X....',...empty.slice(1)],'Netburners',[empty]).identity);
 ns.go.getOpponent=()=> 'Netburners';ns.go.getMoveHistory=()=>[];ns.go.getCurrentPlayer=()=> 'Black';
 ns.go.makeMove=async()=>{submitted++;};ns.go.passTurn=async()=>{submitted++;};
 for(const action of [()=>h.go_makeMove(ns,0,0),()=>h.go_passTurn(ns)])await assert.rejects(action,e=>typeof e==='symbol');assert.equal(submitted,0);
});
test('stale game-over replies cannot reset a newly selected live board',async()=>{
 const ns=nsMock(),h=await controller(ns);let resets=0;ns.go.getCurrentPlayer=()=> 'Black';ns.go.resetBoardState=()=>{resets++;};
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),e=>typeof e==='symbol');assert.equal(resets,0);
});
test('snapshot worker returns compact continuity metadata without transferring move history',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....');ns.go.getBoardState=()=>empty;ns.go.getOpponent=()=> 'Netburners';ns.go.getMoveHistory=()=>[];ns.go.getGameState=()=>({currentPlayer:'Black'});
 ns.go.analysis.getControlledEmptyNodes=()=>empty;ns.go.analysis.getLiberties=()=>[];ns.go.analysis.getChains=()=>[];
 const h=await controller(ns,{getNsDataThroughFile:async(ns,code,file,args)=>{ns.args=args;return Function('ns','return ('+code+')')(ns);}});
 const snapshot=await h.readGoSnapshot();assert.equal(snapshot.observation.valid,true);assert.equal(snapshot.observation.identity.historyLength,0);assert.equal(snapshot.history,undefined);
});
test('cheat worker rechecks history after parent validation and refuses a replaced board',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....');let history=[empty],submissions=0;ns.go.getOpponent=()=> 'Netburners';ns.go.getMoveHistory=()=>history;ns.go.getCurrentPlayer=()=> 'Black';ns.go.cheat.playTwoMoves=async()=>{submissions++;return {type:'move'};};
 const h=await controller(ns,{getNsDataThroughFile:async(ns,code,file,args)=>{history=[];ns.args=args;return new (Object.getPrototypeOf(async function(){}).constructor)('ns','return '+code)(ns);}});
 h.setIdentity(policy.goBoardObservation(['X....',...empty.slice(1)],'Netburners',history).identity);
 await assert.rejects(h.go_cheat_playTwoMoves(ns,0,0,1,1),e=>typeof e==='symbol');assert.equal(submissions,0);
});

test('a new board opened during the awaited final snapshot is preserved',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....');let player='None',resets=0;
 ns.getResetInfo=()=>({lastNodeReset:1,lastAugReset:2,currentNode:7});ns.go.getCurrentPlayer=()=>player;ns.go.resetBoardState=()=>{resets++;};
 const previous=policy.goBoardObservation(empty,'Netburners',[]).identity,newBoard=Array(7).fill('.......');
 const h=await controller(ns,{getNsDataThroughFile:async()=>{player='Black';return {board:newBoard,game:{currentPlayer:'Black'},observation:policy.goBoardObservation(newBoard,'Tetrads',[],previous)};}});
 h.set(empty,empty.map(()=>Array(5).fill(true)),1,{goal:'auto','search-mode':'auto'});h.setIdentity(previous);
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),e=>typeof e==='symbol');assert.equal(resets,0);assert.equal(h.session().record.opponent,'Tetrads');
});
test('a board opened during result persistence is not overwritten by the next automatic reset',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....');let player='None',resets=0;ns.go.getCurrentPlayer=()=>player;
 ns.go.resetBoardState=()=>{resets++;return empty;};ns.go.analysis.getStats=()=>({Netburners:{wins:1,losses:0,bonusPercent:1,winStreak:1}});ns.go.getGameState=()=>({blackScore:20,komi:1.5});
 ns.write=async(file)=>{if(file==='tasks/go-performance.json')player='Black';};
 const h=await controller(ns,{getNsDataThroughFile:async()=>({board:empty,game:{currentPlayer:'None'},observation:policy.goBoardObservation(empty,'Netburners',[])})});
 h.set(empty,empty.map(()=>Array(5).fill(true)),1,{goal:'auto',opponent:'Netburners','search-mode':'auto'});
 h.setRecord({opponent:'Netburners',size:5,cheats:false,startedAt:Date.now()-5000,wins:0,losses:0,bonus:0,winStreak:0},'tactical');
 await assert.rejects(h.checkNewGame(ns,{type:'gameOver'}),e=>typeof e==='symbol');assert.equal(resets,0);assert.equal(h.status().lastMeasurement,undefined);
});
test('size changes with an empty history still block stale ordinary moves and passes',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....'),h=await controller(ns);let submissions=0;
 h.setIdentity(policy.goBoardObservation(empty,'Netburners',[]).identity);ns.go.getMoveHistory=()=>[];ns.go.getOpponent=()=> 'Netburners';ns.go.getCurrentPlayer=()=> 'Black';ns.go.analysis.getValidMoves=()=>Array.from({length:7},()=>Array(7).fill(true));
 ns.go.makeMove=async()=>{submissions++;};ns.go.passTurn=async()=>{submissions++;};
 await assert.rejects(h.go_makeMove(ns,0,0),e=>typeof e==='symbol');await assert.rejects(h.go_passTurn(ns),e=>typeof e==='symbol');assert.equal(submissions,0);
});

test('same-game manual progress is persisted as excluded and cannot credit a completed victory',async()=>{
 const now=Date.now(),ns=nsMock(),files=new Map(),empty=Array(5).fill('.....'),first=['X....',...empty.slice(1)];ns.getResetInfo=()=>({currentNode:7,lastNodeReset:1,lastAugReset:2});ns.write=async(f,s)=>files.set(f,JSON.parse(s));
 const h=await controller(ns);h.set(empty,empty.map(()=>Array(5).fill(true)),1,{goal:'auto','search-mode':'auto'});
 const record={opponent:'Netburners',size:5,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:now-5000,wins:0,losses:0,bonus:0,winStreak:0};
 h.setRecord(record,'tactical');await h.beginGoSession(record);const before=policy.goBoardObservation(empty,'Netburners',[]).identity;h.setIdentity(before);
 await h.observeGoSnapshot({board:first,game:{currentPlayer:'Black'},observation:policy.goBoardObservation(first,'Netburners',[empty],before)});
 assert.equal(h.record().measurementExcluded,'untracked-board-progress');assert.equal(files.get('tasks/go-session.json').record.measurementExcluded,'untracked-board-progress');
 ns.go.analysis.getStats=()=>({Netburners:{wins:1,losses:0,bonusPercent:1,winStreak:1}});await h.checkNewGame(ns,{type:'gameOver'});
 assert.deepEqual(Object.keys(files.get('tasks/go-performance.json').engines.tactical),[]);assert.equal(files.get('tasks/go-status.json').lastMeasurement.accepted,false);
});
test('legitimate automated ordinary progress retains a clean measurement',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....'),first=['X....',...empty.slice(1)],second=['XO...',...empty.slice(1)];
 ns.getResetInfo=()=>({currentNode:7,lastNodeReset:1,lastAugReset:2});const h=await controller(ns);
 h.set(empty,empty.map(()=>Array(5).fill(true)),1,{goal:'auto','search-mode':'auto'});const before=policy.goBoardObservation(empty,'Netburners',[]).identity;
 const record={opponent:'Netburners',size:5,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:Date.now(),wins:0,losses:0,bonus:0};h.setRecord(record,'tactical');await h.beginGoSession(record);h.setIdentity(before);
 ns.go.getOpponent=()=> 'Netburners';ns.go.getCurrentPlayer=()=> 'Black';ns.go.getMoveHistory=()=>[];ns.go.analysis.getValidMoves=()=>Array.from({length:5},()=>Array(5).fill(true));
 await h.go_makeMove(ns,0,0);const action={kind:'ordinary',before,accepted:true,outcome:'move'};
 await h.observeGoSnapshot({board:second,game:{currentPlayer:'Black'},observation:policy.goBoardObservation(second,'Netburners',[first,empty],before,action)});
 assert.equal(h.record().measurementExcluded,undefined);
});

test('a planning-time manual pass remains excluded even when history and board return unchanged',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....'),files=new Map();let player='White';ns.getResetInfo=()=>({currentNode:7,lastNodeReset:1,lastAugReset:2});ns.write=async(f,s)=>files.set(f,JSON.parse(s));
 const h=await controller(ns);h.set(empty,empty.map(()=>Array(5).fill(true)),1,{goal:'auto','search-mode':'auto'});
 const before=policy.goBoardObservation(empty,'Netburners',[]).identity,record={opponent:'Netburners',size:5,cheats:false,configuration:policy.goEngineConfigurations().tactical,startedAt:Date.now()};
 h.setRecord(record,'tactical');await h.beginGoSession(record);h.setIdentity(before);ns.go.getOpponent=()=> 'Netburners';ns.go.getMoveHistory=()=>[];ns.go.getCurrentPlayer=()=>player;ns.go.analysis.getValidMoves=()=>Array.from({length:5},()=>Array(5).fill(true));
 await assert.rejects(h.go_makeMove(ns,0,0),e=>typeof e==='symbol');player='Black';
 await h.observeGoSnapshot({board:empty,game:{currentPlayer:'Black'},observation:policy.goBoardObservation(empty,'Netburners',[],before)});
 assert.equal(h.record().measurementExcluded,'external-intervention-during-planning');assert.equal(files.get('tasks/go-session.json').record.measurementExcluded,'external-intervention-during-planning');
});
test('native two-stone cheat receipts retain the same clean controller session',async()=>{
 const ns=nsMock(),empty=Array(5).fill('.....'),first=['X....',...empty.slice(1)],cheated=['XXX..',...empty.slice(1)],responded=['XXXO.',...empty.slice(1)];
 ns.getResetInfo=()=>({currentNode:7,lastNodeReset:1,lastAugReset:2});const h=await controller(ns,{getNsDataThroughFile:async()=>({type:'move'})});
 h.set(first,empty.map(()=>Array(5).fill(true)),1,{goal:'auto','search-mode':'auto'});const before=policy.goBoardObservation(first,'Netburners',[empty]).identity;
 const record={opponent:'Netburners',size:5,cheats:true,configuration:policy.goEngineConfigurations()['search-v1'],startedAt:Date.now()};h.setRecord(record,'search-v1');await h.beginGoSession(record);const id=h.session().id;h.setIdentity(before);
 ns.go.getOpponent=()=> 'Netburners';ns.go.getCurrentPlayer=()=> 'Black';ns.go.getMoveHistory=()=>[empty];await h.go_cheat_playTwoMoves(ns,0,1,0,2);
 const action={kind:'cheat',before,accepted:true,outcome:'move'};await h.observeGoSnapshot({board:responded,game:{currentPlayer:'Black'},observation:policy.goBoardObservation(responded,'Netburners',[cheated,empty],before,action)});
 assert.equal(h.record().measurementExcluded,undefined);assert.equal(h.session().id,id);assert.equal(h.record().partial,undefined);
});

test('controller source revision is computed once and remains frozen until restart',async()=>{
 const ns=nsMock();let reads=0,source='first';ns.read=path=>{if(['go.js','go-policy.js','go-search-policy.js'].includes(path)){reads++;return source+path;}return '';};
 const h=await controller(ns);h.initializeGoPolicyRevision();const first=JSON.stringify(h.revision());assert.equal(reads,3);
 source='second';h.initializeGoPolicyRevision();assert.equal(reads,3);assert.equal(JSON.stringify(h.revision()),first);
 const restarted=await controller(ns);restarted.initializeGoPolicyRevision();assert.notEqual(JSON.stringify(restarted.revision()),first);
});
test('missing policy source permits play but excludes learning instead of borrowing legacy evidence',async()=>{
 const ns=nsMock(),files=new Map(),h=await controller(ns);ns.write=async(f,s)=>files.set(f,JSON.parse(s));h.initializeGoPolicyRevision();assert.equal(h.revision(),null);
 h.set(['..','..'],[[true,true],[true,true]],1,{goal:'auto',opponent:'Netburners','search-mode':'auto'});
 await h.checkNewGame(ns,{type:'gameOver'});const status=files.get('tasks/go-status.json');assert.equal(status.engine,'tactical');assert.equal(status.enginePlan.reason,'policy-revision-unavailable');assert.equal(h.record().measurementExcluded,'policy-revision-unavailable');
});


test('early-pass telemetry counts accepted policy passes independently of ordinary and failed passes',async()=>{
 const ns=nsMock(),h=await controller(ns);await h.go_passTurn(ns);assert.equal(h.timing().passes,1);assert.equal(h.timing().earlyPasses,0);
 await h.go_passTurn(ns,true);assert.equal(h.timing().passes,2);assert.equal(h.timing().earlyPasses,1);
 ns.go.passTurn=async()=>null;await h.go_passTurn(ns,true);assert.equal(h.timing().earlyPasses,1);
 ns.go.passTurn=async()=>{throw Error('native rejection');};await assert.rejects(h.go_passTurn(ns,true),/native rejection/);assert.equal(h.timing().earlyPasses,1);
 assert.equal(h.timing().failedActions,2);assert.equal(h.timing().passes,2);
});


function eagerPatternBoard(board){const wall='W'.repeat(board.length+2),padded=[];padded.push(wall);for(const row of board)padded.push('W'+row+'W');padded.push(wall);return padded;}
test('pattern padding builds on demand, reuses a snapshot and invalidates equal-size or reused arrays',async()=>{
 const h=await controller(nsMock()),board=['X..','.#.','..O'];h.set(board,board.map(()=>Array(3).fill(true)),1);
 assert.equal(h.patternBoard().length,0);const first=h.preparePatternBoard();assert.deepEqual(Array.from(first),eagerPatternBoard(board));
 assert.equal(h.preparePatternBoard(),first);h.isPattern(0,1,['?X?','???','???']);assert.equal(h.patternBoard(),first);
 board[0]='O..';h.setPatternSnapshot(board);const next=h.preparePatternBoard();assert.notEqual(next,first);assert.deepEqual(Array.from(next),eagerPatternBoard(board));
 h.setPatternSnapshot(['.....','.....','..#..','.....','.....']);assert.equal(h.preparePatternBoard().length,7);
});
test('lazy pattern matching agrees with eager padding across seeded boards and pattern tokens',async()=>{
 const lazy=await controller(nsMock()),eager=await controller(nsMock());let seed=7241,checks=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<48;i++){
  const n=[5,7,9,13][i%4],board=Array.from({length:n},()=>Array.from({length:n},()=>'.XO#'[Math.floor(random()*4)]).join('')),valid=board.map(r=>[...r].map(c=>c==='.'));
  const controlled=board.map(()=>Array.from({length:n},()=>'?XO'[Math.floor(random()*3)]).join(''));
  for(const h of [lazy,eager]){h.set(board,valid,i);h.setControlled(controlled);}eager.preparePatternBoard();
  assert.deepEqual(Array.from(eager.patternBoard()),eagerPatternBoard(board));
  for(let j=0;j<16;j++){
   const x=Math.floor(random()*n),y=Math.floor(random()*n),pattern=Array.from({length:3},()=>Array.from({length:3},()=>'*XOxo?.WBbA'[Math.floor(random()*11)]).join(''));
   assert.equal(lazy.isPattern(x,y,pattern),eager.isPattern(x,y,pattern));checks++;
  }
 }
 assert.equal(checks,768);
});
test('turns resolved by early pass, tactical, search or opening moves never prepare pattern padding',async()=>{
 for(const kind of ['early','tactical','search','opening']){
  const board=kind==='early'?['XXXXX','X.X.X','XXXXX','XXXXX','XXXXX']:Array(5).fill('.....'),valid=board.map(r=>[...r].map(c=>c==='.'));
  let batches=0;
  const ns=nsMock(),stop=Error('stop after native submission'),overrides={goTacticalMove:()=>kind==='tactical'?{coords:[2,2],msg:'test tactical'}:null,searchGoMove:()=>({move:{coords:[2,2],msg:'test search'},nodes:2,elapsedMs:1,bounded:false})};
  overrides.goMoveOutcomes=(...args)=>{batches++;return policy.goMoveOutcomes(...args);};
  ns.printf=()=>{};ns.print=()=>{};ns.go.getOpponent=()=> 'Netburners';ns.go.getCurrentPlayer=()=> 'Black';ns.go.getMoveHistory=()=>[];ns.go.analysis.getValidMoves=()=>valid;
  ns.go.makeMove=ns.go.passTurn=async()=>{throw stop;};
  overrides.getNsDataThroughFile=async(_ns,source)=>source==='ns.go.getBoardState()'?board:{board,opponent:'Netburners',observation:policy.goBoardObservation(board,'Netburners',[]),contested:board.map(r=>r.replaceAll('.','X')),valid,liberties:board.map(()=>Array(5).fill(4)),chains:board.map(()=>Array(5).fill(1)),game:{currentPlayer:'Black',blackScore:25,whiteScore:1}};
  const h=await controller(ns,overrides);h.set(board,valid,1,{goal:'auto','search-mode':kind==='search'?'play':'off','early-pass':kind==='early'});
  await assert.rejects(h.playGo(ns),error=>error===stop,kind);assert.equal(h.patternBoard().length,0,kind);assert.equal(batches,1,kind);
 }
});
test('mixed synthetic workload avoids padding on three quarters of snapshots',async()=>{
 const h=await controller(nsMock()),board=Array(13).fill('.............');let builds=0;
 for(let i=0;i<400;i++){h.setPatternSnapshot(board);if(i%4===0){const previous=h.patternBoard();h.preparePatternBoard();if(h.patternBoard()!==previous)builds++;h.preparePatternBoard();}}
 assert.equal(builds,100);console.log('Pattern preparation workload: 100 builds versus 400 eager builds (75% fewer); not a gameplay throughput benchmark.');
});


test('native replay writer is optional, rate limited and cannot halt gameplay on write failure',async()=>{
 const ns=nsMock(),board=Array(5).fill('.....'),valid=board.map(()=>Array(5).fill(true)),snapshot={board,valid,opponent:'Netburners',game:{currentPlayer:'Black'},observation:policy.goBoardObservation(board,'Netburners',[])};let reads=0,writes=0;ns.getResetInfo=()=>({lastNodeReset:1,lastAugReset:2});ns.read=()=>{reads++;return '';};ns.write=async()=>{writes++;};
 const h=await controller(ns);h.set(board,valid,1,{goal:'auto','benchmark-samples':false});await h.recordGoReplay(snapshot);assert.equal(reads,0);assert.equal(writes,0);h.set(board,valid,1,{goal:'auto'});await h.recordGoReplay(snapshot);await h.recordGoReplay(snapshot);assert.equal(reads,1);assert.equal(writes,1);assert.equal(h.status().replay.samples,1);
 const failed=await controller({...ns,write:async()=>{throw Error('disk unavailable');}});await failed.recordGoReplay(snapshot);assert.match(failed.status().replay.error,/disk unavailable/);
});
