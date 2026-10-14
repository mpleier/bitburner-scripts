import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../go-policy.js';
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
 const context={registerAutomation(){},automationHeartbeat(){},maintenanceRequested:()=>false,...policy,performance:{now:()=>0},isScriptPaused:()=>false,achievementActionAllowed:()=>true,ns,...overrides};
 const injection=`globalThis.harness={checkNewGame,getAllValidMoves,go_cheat_playTwoMoves,go_makeMove,go_passTurn,moveSnakeEyes,setRunOnce:value=>{runOnce=value;startedGame=false;},set:(b,v,t,o={goal:'auto',opponent:''})=>{board=b;validMove=v;contested=b.map(r=>'?'.repeat(r.length));turn=t;goOptions=o;runOnce=false;}};`;
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
 const ns=nsMock(),h=await controller(ns,{getNsDataThroughFile:async()=>[[false,true],[true,true]]});
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
