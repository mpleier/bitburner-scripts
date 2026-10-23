import {validGoReplay,goReplayStratum} from '../go-replay-policy.js';
import {analyzeGoBoard,goMoveOutcome,goMoveOutcomes} from '../go-policy.js';
export function replayArguments(args){
 const result={};for(let i=0;i<args.length;i++){const key=args[i];if(!['--input','--save'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||result[key.slice(2)])throw Error('Use --input <corpus.json> and/or --save <corpus.json>');result[key.slice(2)]=args[++i];}return result;
}
export function benchmarkGoReplay(corpus,{rounds=5,iterations=100,clock=()=>performance.now()}={}){
 if(!validGoReplay(corpus))throw Error('Invalid native Go replay corpus');
 if(!Number.isSafeInteger(rounds)||rounds<3||rounds>9||rounds%2!==1||!Number.isSafeInteger(iterations)||iterations<1||iterations>1000)throw Error('Invalid replay benchmark limits');
 const cases=[];
 for(const sample of corpus.samples){
  const baseline=()=>{const a=analyzeGoBoard(sample.board),result=new Map();for(let x=0;x<sample.board.length;x++)for(let y=0;y<sample.board.length;y++)if(sample.valid[x][y])result.set(x+','+y,goMoveOutcome(sample.board,x,y,a));return result;};
  const batch=()=>goMoveOutcomes(sample.board,sample.valid,analyzeGoBoard(sample.board));
  const expected=baseline();if(JSON.stringify([...expected])!==JSON.stringify([...batch()]))throw Error('Replay evaluator mismatch');
  for(let i=0;i<10;i++){baseline();batch();}const times={baseline:[],batch:[]};
  for(let round=0;round<rounds;round++)for(const kind of round%2?['batch','baseline']:['baseline','batch']){const start=clock();for(let i=0;i<iterations;i++)(kind==='baseline'?baseline:batch)();const elapsed=clock()-start;if(!Number.isFinite(elapsed)||elapsed<0)throw Error('Invalid benchmark clock');times[kind].push(elapsed);}
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)],baselineMs=median(times.baseline),batchMs=median(times.batch),emptyPoints=sample.board.join('').split('').filter(c=>c==='.').length;
  cases.push({at:sample.at,density:goReplayStratum(sample).density,opponent:sample.opponent,size:sample.board.length,legalMoves:expected.size,excludedEmptyPoints:emptyPoints-expected.size,identical:true,baselineMs,batchMs,ratio:batchMs>0?baselineMs/batchMs:null});
 }
 return {schemaVersion:1,source:corpus.source,samples:cases.length,coverage:{sizes:[...new Set(cases.map(c=>c.size))].sort((a,b)=>a-b),opponents:[...new Set(cases.map(c=>c.opponent))],densities:[...new Set(cases.map(c=>c.density))]},rounds,iterations,cases};
}
