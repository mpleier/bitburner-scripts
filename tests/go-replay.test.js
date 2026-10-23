import test from 'node:test';
import assert from 'node:assert/strict';
import {appendGoReplay,validGoReplay,goReplayStratum} from '../go-replay-policy.js';
import {benchmarkGoReplay,replayArguments} from '../scripts/go-replay-benchmark-core.js';
import {goBoardObservation} from '../go-policy.js';
import {renderCommandJob,validateCommand} from '../remote-api-command.js';
const reset={lastNodeReset:1000,lastAugReset:2000};
function snapshot(index=0){const rows=Array.from({length:5},()=>Array(5).fill('.'));rows[Math.floor(index/5)][index%5]='X';const board=rows.map(r=>r.join('')),valid=board.map(r=>[...r].map(c=>c==='.'));valid[4][4]=false;return {board,valid,opponent:'Tetrads',game:{currentPlayer:'Black'},observation:goBoardObservation(board,'Tetrads',[])};}
const corpus=()=>appendGoReplay(null,snapshot(),reset,Date.now()-1000);
test('native replay snapshots preserve legality exclusions and clone native inputs',()=>{
 const s=snapshot(),c=appendGoReplay(null,s,reset,1000000);assert.equal(validGoReplay(c),true);assert.equal(c.samples[0].valid[4][4],false);s.board[0]='OOOOO';s.valid[0][1]=false;assert.equal(c.samples[0].board[0],'X....');assert.equal(c.samples[0].valid[0][1],true);
});
test('replay recording throttles writes, deduplicates states and distinguishes changed native masks',()=>{
 const c=appendGoReplay(null,snapshot(),reset,1000000);assert.equal(appendGoReplay(c,snapshot(1),reset,1000001),c);assert.equal(appendGoReplay(c,snapshot(),reset,1060000),c);
 const s=snapshot();s.valid[0][1]=false;const next=appendGoReplay(c,s,reset,1060000);assert.equal(next.samples.length,2);assert.equal(next.samples[1].valid[0][1],false);
});
test('replay storage is capped at twelve states and starts fresh across resets',()=>{
 let c=null;for(let i=0;i<17;i++)c=appendGoReplay(c,snapshot(i),reset,1000000+i*60000);assert.equal(c.samples.length,12);assert.equal(c.samples[0].at,1300000);assert.ok(JSON.stringify(c).length<60000);
 const next=appendGoReplay(c,snapshot(),{...reset,lastAugReset:3000},3000000);assert.equal(next.samples.length,1);assert.equal(next.augReset,3000);
});
test('invalid, off-turn or incoherent native observations cannot enter the replay corpus',()=>{
 const c=corpus();for(const mutate of [s=>{s.game.currentPlayer='White';},s=>{s.observation.valid=false;},s=>{s.board[0]='.....';},s=>{s.valid[0][0]=true;},s=>{s.valid[1][1]='true';}]){const s=snapshot();mutate(s);assert.equal(appendGoReplay(c,s,reset,Date.now()),c);}
});
test('replay validation rejects malformed, sparse, oversized and out-of-order data',()=>{
 for(const mutate of [c=>{c.samples=[];},c=>{c.source='synthetic';},c=>{c.samples[0].valid[0][0]=true;},c=>{delete c.samples[0].valid[0][1];},c=>{delete c.samples[0].board[1];},c=>{c.samples[0].currentPlayer='None';},c=>{c.samples[0].historyLength=-1;},c=>{c.samples[0].opponent='unknown';},c=>{c.extra='x'.repeat(60001);},c=>{c.samples.push({...c.samples[0],at:c.at-1});}]){const c=corpus();mutate(c);assert.equal(validGoReplay(c),false);}
 assert.equal(Function('return ('+validGoReplay.toString()+')')()(corpus()),true);
});
test('replay benchmark respects native false flags and verifies evaluator equality without mutations',()=>{
 const c=corpus(),before=JSON.stringify(c);let time=0;const result=benchmarkGoReplay(c,{rounds:3,iterations:2,clock:()=>++time});assert.equal(result.samples,1);assert.equal(result.cases[0].legalMoves,23);assert.equal(result.cases[0].excludedEmptyPoints,1);assert.equal(result.cases[0].identical,true);assert.equal(JSON.stringify(c),before);
 const noMoves=corpus();noMoves.samples[0].valid=noMoves.samples[0].valid.map(r=>r.map(()=>false));assert.equal(benchmarkGoReplay(noMoves,{rounds:3,iterations:1}).cases[0].legalMoves,0);
});
test('replay benchmark rejects malformed data, unbounded limits and invalid clocks',()=>{
 assert.throws(()=>benchmarkGoReplay({}),/Invalid native/);for(const options of [{rounds:2},{rounds:11},{iterations:0},{iterations:1001}])assert.throws(()=>benchmarkGoReplay(corpus(),options),/limits/);
 assert.throws(()=>benchmarkGoReplay(corpus(),{clock:()=>NaN}),/clock/);
});
test('replay command arguments accept paths with spaces and reject arbitrary switches',()=>{
 assert.deepEqual(replayArguments(['--input','a b.json','--save','c.json']),{input:'a b.json',save:'c.json'});for(const args of [['--input'],['--delete','x'],['--save','--input'],['--input','a','--input','b']])assert.throws(()=>replayArguments(args));
});
async function query(raw,currentReset=reset){const command={id:'replay-test',method:'automation.goReplay',args:[],expiresAt:Date.now()+60000},source=renderCommandJob(command);let output;const ns={args:['[]','out','replay-test'],read:path=>{assert.equal(path,'tasks/go-replay.json');return raw;},getResetInfo:()=>currentReset,write:async(path,text)=>{output=JSON.parse(text);}};await new (Object.getPrototypeOf(async function(){}).constructor)('ns',source.replace('export async function main','async function main')+';return main(ns);')(ns);return output;}
test('fixed Remote API replay query is read-only and returns ready, waiting or stale state',async()=>{
 const c=corpus();assert.equal((await query(JSON.stringify(c))).result.state,'ready');assert.equal((await query('')).result.state,'waiting');assert.equal((await query(JSON.stringify(c),{...reset,lastAugReset:999})).result.state,'stale');
 assert.throws(()=>validateCommand({id:'bad',method:'automation.goReplay',args:['other-file'],expiresAt:Date.now()+60000}),/no arguments/);
});
test('fixed replay query rejects oversized and malformed stored data',async()=>{assert.equal((await query('x'.repeat(60001))).state,'failed');assert.equal((await query('{}')).state,'failed');});

function diverseSnapshot(size,opponent,occupied,offset=0){
 const cells=Array(size*size).fill('.');for(let i=0;i<occupied;i++)cells[(i+offset)%cells.length]='X';
 const board=Array.from({length:size},(_,x)=>cells.slice(x*size,(x+1)*size).join(''));
 return {board,valid:board.map(row=>[...row].map(c=>c==='.')),opponent,game:{currentPlayer:'Black'},observation:goBoardObservation(board,opponent,[])};
}
test('density strata exclude blocked cells and handle empty blocked boards',()=>{
 for(const [board,density] of [[['X###','####','####','####'],'dense'],[['.###','####','####','####'],'sparse'],[['X.##','####','####','####'],'developing'],[['####','####','####','####'],'sparse']])assert.equal(goReplayStratum({board,opponent:'Tetrads'}).density,density);
});
test('full replay corpus preserves rare size, opponent and density while rotating redundant states',()=>{
 let c=null,t=1000000;
 const add=s=>{c=appendGoReplay(c,s,reset,t);t+=60000;};
 add(diverseSnapshot(7,'Daedalus',40));add(diverseSnapshot(5,'Tetrads',10));
 for(let i=0;i<10;i++)add(snapshot(i));
 const before=JSON.stringify(c);add(snapshot(20));assert.equal(c.samples.length,12);assert.equal(c.samples[0].board.length,7);assert.equal(goReplayStratum(c.samples[1]).density,'developing');assert.equal(validGoReplay(c),true);assert.notEqual(JSON.stringify(c),before);
 assert.ok(!c.samples.some(s=>s.board.join('/')===snapshot(0).board.join('/')));
});
test('new strata displace crowded samples without mutating the old corpus',()=>{
 let c=null;for(let i=0;i<12;i++)c=appendGoReplay(c,snapshot(i),reset,1000000+i*60000);
 const before=JSON.stringify(c),next=appendGoReplay(c,diverseSnapshot(9,'Netburners',60),reset,2000000);
 assert.equal(JSON.stringify(c),before);assert.equal(next.samples.length,12);assert.equal(next.samples.at(-1).board.length,9);assert.equal(validGoReplay(next),true);
 const result=benchmarkGoReplay(next,{rounds:3,iterations:1});assert.deepEqual(result.coverage.sizes,[5,9]);assert.deepEqual(result.coverage.opponents,['Tetrads','Netburners']);assert.deepEqual(result.coverage.densities,['sparse','dense']);
});
