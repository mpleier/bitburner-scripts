import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {updateHackingProcessBudget,hackingProcessInventory,reserveHackingProcess,releaseHackingProcess} from '../hacking-process-policy.js';
import {simulateGoMove,evaluateGoPosition,searchGoMove} from '../go-search-policy.js';
import {goOptionsError,goMoveOutcome,analyzeGoBoard} from '../go-policy.js';
import {hashSpendingDecision,spendHashesWithPolicy} from '../hash-spending-policy.js';

test('worker budget counts processes rather than threads and includes other owners',()=>{
 const inv=hackingProcessInventory({ps:h=>h==='home'?[{filename:'daemon.js',threads:1},{filename:'Remote/hack-target.js',threads:100000,args:['x',0,0,'',0,0,0,7]}]:[{filename:'/Remote/weak-target.js',threads:100000,args:[]}]},['home','remote','remote']);
 assert.deepEqual(inv,{workers:2,total:3,complete:true});
 const b=updateHackingProcessBudget(null,{now:1000,inventory:inv,maxWorkers:4});
 assert.equal(reserveHackingProcess(b,1001),true);assert.equal(reserveHackingProcess(b,1001),true);assert.equal(reserveHackingProcess(b,1001),false);
 releaseHackingProcess(b);assert.equal(reserveHackingProcess(b,1001),true);
});
test('unknown, failed, future and stale process inventories stop new admissions',()=>{
 assert.equal(reserveHackingProcess(null,1000),false);
 const inv=hackingProcessInventory({ps:()=>{throw Error('host gone');}},['home']);assert.equal(inv.complete,false);
 const b=updateHackingProcessBudget(null,{now:1000,inventory:inv});assert.equal(reserveHackingProcess(b,1001),false);
 const fresh=updateHackingProcessBudget(b,{now:2000,inventory:{workers:1,total:2,complete:true}});
 assert.equal(reserveHackingProcess(fresh,1900),false);assert.equal(reserveHackingProcess(fresh,17000),false);
});
test('sustained measured lag reduces the cap; clean samples restore it gradually',()=>{
 let b=null;for(let i=0;i<3;i++)b=updateHackingProcessBudget(b,{now:i*5000,inventory:{workers:100,total:110,complete:true},lagMs:400,maxWorkers:2000});
 assert.equal(b.limit,1500);assert.equal(b.used,100);
 for(let i=0;i<30;i++)b=updateHackingProcessBudget(b,{now:20000+i*5000,inventory:{workers:100,total:110,complete:true},lagMs:0,maxWorkers:2000});
 assert.equal(b.limit,1700);assert.equal(b.used,100);
});
test('process reservations survive until a new inventory and never kill running workers',()=>{
 const b=updateHackingProcessBudget(null,{now:1000,inventory:{workers:10,total:10,complete:true},maxWorkers:10});
 assert.equal(reserveHackingProcess(b,1100),false);assert.equal(b.used,10);
 const next=updateHackingProcessBudget(b,{now:2000,inventory:{workers:7,total:7,complete:true},maxWorkers:10});assert.equal(reserveHackingProcess(next,2000),true);
});
test('pure Go simulation captures before checking suicide and leaves inputs unchanged',()=>{
 const board=['.X.','XOX','...'],copy=[...board],r=simulateGoMove(board,2,1);
 assert.equal(r.captured,1);assert.equal(r.board[1][1],'.');assert.deepEqual(board,copy);
 assert.equal(simulateGoMove(['.OO','O.O','OO.'],1,1,'X'),null);
 assert.equal(simulateGoMove(['XX','XX'],0,0),null);
});
test('Go simulation enforces supplied repetition history for both colors',()=>{
 const board=['...','...','...'],r=simulateGoMove(board,1,1,'O');
 assert.ok(r);assert.equal(simulateGoMove(board,1,1,'O',new Set([r.board.join('/')])),null);
 assert.ok(Number.isFinite(evaluateGoPosition(r.board)));
});
test('bounded search respects native root legality and node/time limits',()=>{
 const board=['.....','..O..','.....','..X..','.....'],valid=board.map(r=>[...r].map(c=>c==='.'));valid[0][0]=false;
 const r=searchGoMove(board,valid,{clock:()=>0,maxMs:5,maxNodes:32});
 assert.ok(r.nodes<=32);assert.ok(r.move);assert.equal(valid[r.move.coords[0]][r.move.coords[1]],true);
 let time=0;const timed=searchGoMove(board,valid,{clock:()=>time++,maxMs:1,maxNodes:1024});assert.equal(timed.move,null);assert.ok(timed.nodes<=1);
 const none=searchGoMove(board,valid.map(r=>r.map(()=>false)),{clock:()=>0});assert.equal(none.move,null);
});
test('search options validate budgets and retain explicit off/shadow/play choices',()=>{
 const base={goal:'auto','cheat-chance-threshold':.9};
 for(const mode of ['auto','off','shadow','play'])assert.equal(goOptionsError({...base,'search-mode':mode,'search-ms':5,'search-nodes':64}),null);
 for(const patch of [{'search-mode':'bad'},{'search-ms':NaN},{'search-ms':0},{'search-ms':51},{'search-nodes':15},{'search-nodes':1025}])assert.ok(goOptionsError({...base,...patch}));
});
function hashFixture(){
 const now=Date.now(),reset={lastAugReset:1,lastNodeReset:2},files={
  '/Temp/analyze-hack.txt':JSON.stringify([{hostname:'target',gainRate:1e6}]),
  '/Temp/analyze-hack-meta.txt':JSON.stringify({at:now,augReset:1,nodeReset:2})};
 const processes=[{pid:7,filename:'daemon.js',args:[]},{pid:8,filename:'Remote/hack-target.js',threads:100,args:['target',0,0,'test',0,0,0,7]}];
 const server={moneyMax:1e9,moneyAvailable:1e9,minDifficulty:10,hackDifficulty:10};
 const ns={pid:9,getResetInfo:()=>reset,ps:h=>h==='home'?processes:[],scan:()=>[],read:f=>files[f]||'',getPlayer:()=>({money:1e12}),getServer:()=>server,getScriptRam:()=>2,weakenAnalyze:()=>.05,
 hacknet:{numHashes:()=>1000,hashCapacity:()=>2000,hashCost:()=>4},
 formulas:{hacking:{hackPercent:s=>.001*(100-s.hackDifficulty),hackChance:()=>1,weakenTime:s=>10000+s.hackDifficulty*1000,growThreads:(s,p,target)=>Math.log(target/s.moneyAvailable)/Math.log(1+.03/s.hackDifficulty)}}};
 return {ns,server,processes};
}
test('hash boosts use native before/after thread and time projections without mutating inputs',()=>{
 const f=hashFixture(),copy={...f.server};
 for(const action of ['Increase Maximum Money','Reduce Minimum Security']){
  const d=hashSpendingDecision(f.ns,action,{target:'target'});assert.equal(d.allowed,true,d.reason);assert.ok(d.serverProjection.relative>0);assert.ok(d.serverProjection.before.grow>0);assert.ok(d.serverProjection.retuneSeconds>0);
  assert.ok(d.serverProjection.paybackSeconds<=1800);
 }
 assert.deepEqual(f.server,copy);
});
test('hash projection rejects absent formulas, XP aliases, foreign allocations and full security reduction',()=>{
 const f=hashFixture(),decide=Function('return ('+hashSpendingDecision.toString()+')')();
 f.ns.formulas=undefined;assert.equal(decide(f.ns,'Increase Maximum Money',{target:'target'}).allowed,false);
 for(const flag of ['-x','--x','--xp-only','--hack-only','-h']){const f=hashFixture();f.processes[0].args=[flag];assert.equal(decide(f.ns,'Increase Maximum Money',{target:'target'}).allowed,false);}
 const foreign=hashFixture();foreign.processes[1].args[7]=99;assert.equal(decide(foreign.ns,'Increase Maximum Money',{target:'target'}).allowed,false);
 const minimum=hashFixture();minimum.server.minDifficulty=1;assert.equal(decide(minimum.ns,'Reduce Minimum Security',{target:'target'}).allowed,false);
});
test('native projection rejects invalid formulas and allows explicit manual decisions',()=>{
 const f=hashFixture();f.ns.formulas.hacking.weakenTime=()=>NaN;
 assert.equal(hashSpendingDecision(f.ns,'Reduce Minimum Security',{target:'target'}).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,'Reduce Minimum Security',{target:'target',automatic:false}).allowed,true);
});
test('controller defaults to bounded measured trials and isolates engine histories',async()=>{
 const s=await readFile(new URL('../go.js',import.meta.url),'utf8');assert.ok(s.includes("['search-mode','auto']"));
 assert.match(s,/restoreGoEngines/);assert.match(s,/engineBuckets\[goEngine\]/);assert.match(s,/engine:goEngine/);assert.match(s,/!achievement\?\.goStreak&&!achievement\?\.goFailure/);
});
test('bounded search benchmark reports proposal cost without asserting gameplay improvements',()=>{
 const board=['.....','..O..','.....','..X..','.....'],valid=board.map(r=>[...r].map(c=>c==='.'));
 let nodes=0,proposals=0;const began=performance.now();for(let i=0;i<25;i++){const r=searchGoMove(board,valid,{maxMs:5,maxNodes:64});nodes+=r.nodes;proposals+=Number(!!r.move);}
 console.log('IPvGO shadow microbenchmark: '+((performance.now()-began)/25).toFixed(2)+' ms/search; '+nodes+' simulated moves; '+proposals+'/25 proposals. No live reward gain measured.');
 assert.ok(nodes<=25*64);
});


test('Go capture simulation agrees with the independent algebraic evaluator on seeded boards',()=>{
 let seed=73;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<150;i++){
  const board=Array.from({length:5},()=>Array.from({length:5},()=>'.XO#'[Math.floor(random()*4)]).join('')),analysis=analyzeGoBoard(board);
  for(let x=0;x<5;x++)for(let y=0;y<5;y++)if(board[x][y]==='.'){
   const expected=goMoveOutcome(board,x,y,analysis),actual=simulateGoMove(board,x,y);
   if(expected.liberties===0)assert.equal(actual,null);else{assert.equal(actual.captured,expected.captured);assert.equal(actual.liberties,expected.liberties);}
   const swapped=board.map(r=>r.replace(/[XO]/g,c=>c==='X'?'O':'X'));
   const white=simulateGoMove(swapped,x,y,'O');assert.equal(white?.captured,actual?.captured);assert.equal(white?.liberties,actual?.liberties);
  }
 }
});
test('zero or invalid investment horizons defer server boosts and bulk automatic upgrades require requoting',()=>{
 const f=hashFixture();for(const horizon of [0,NaN,-1])assert.equal(hashSpendingDecision(f.ns,'Increase Maximum Money',{target:'target',remainingSeconds:horizon}).allowed,false);
 let purchases=0;f.ns.write=()=>{};f.ns.hacknet.spendHashes=()=>{purchases++;return true;};
 assert.equal(spendHashesWithPolicy(f.ns,'Increase Maximum Money','target',2).success,false);assert.equal(purchases,0);
 assert.equal(spendHashesWithPolicy(f.ns,'Increase Maximum Money','target',2,{automatic:false}).success,true);assert.equal(purchases,1);
});
test('global process inventory skips unrooted hosts but includes rooted Hacknet hosts',()=>{
 const r=hackingProcessInventory({hasRootAccess:h=>h!=='locked',ps:h=>{if(h==='locked')assert.fail('no workers possible without root');return h==='hacknet-server-0'?[{filename:'Remote/grow-target.js'}]:[];}},['home','locked','hacknet-server-0']);
 assert.deepEqual(r,{workers:1,total:1,complete:true});
});
