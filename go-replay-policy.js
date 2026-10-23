/** Self-contained for the fixed read-only Remote API query. */
export function validGoReplay(corpus){
 try{
  if(!corpus||corpus.schemaVersion!==1||corpus.source!=='native-go-snapshot'||!Number.isFinite(corpus.nodeReset)||!Number.isFinite(corpus.augReset)||corpus.nodeReset<0||corpus.augReset<0||!Array.isArray(corpus.samples)||!corpus.samples.length||corpus.samples.length>12)return false;
  let prior=-Infinity;
  for(const s of corpus.samples){
   if(!s||!Number.isFinite(s.at)||s.at<0||s.at<prior||!['Netburners','Slum Snakes','The Black Hand','Tetrads','Daedalus','Illuminati','????????????'].includes(s.opponent)||s.currentPlayer!=='Black'||!Number.isSafeInteger(s.historyLength)||s.historyLength<0)return false;
   const n=s.board?.length;if(!Array.isArray(s.board)||![5,7,9,13].includes(n)||!Array.isArray(s.valid)||s.valid.length!==n)return false;
   for(let x=0;x<n;x++){if(typeof s.board[x]!=='string'||s.board[x].length!==n||!/^[XO.#]+$/.test(s.board[x])||!Array.isArray(s.valid[x])||s.valid[x].length!==n)return false;for(let y=0;y<n;y++)if(typeof s.valid[x][y]!=='boolean'||s.valid[x][y]&&s.board[x][y]!=='.')return false;}
   prior=s.at;
  }
  return corpus.at===prior&&JSON.stringify(corpus).length<=60000;
 }catch{return false;}
}
/** Occupancy is a phase proxy, not a reconstruction of move history. */
export function goReplayStratum(sample){
 const cells=sample.board.join(''),playable=[...cells].filter(c=>c!=='#').length,occupied=[...cells].filter(c=>c==='X'||c==='O').length;
 const density=playable?occupied/playable:0;
 return {size:sample.board.length,opponent:sample.opponent,density: density<0.25?'sparse':density<0.65?'developing':'dense'};
}
/** Retain broad coverage, then balanced strata; ties replace the oldest sample. */
function diverseGoReplay(samples){
 if(samples.length<=12)return samples;
 const strata=samples.map(goReplayStratum);
 const score=skip=>{
  const sizes=new Set(),opponents=new Set(),pairs=new Set(),buckets=new Map();
  for(let i=0;i<strata.length;i++)if(i!==skip){const s=strata[i],pair=JSON.stringify([s.size,s.opponent]),key=JSON.stringify([s.size,s.opponent,s.density]);sizes.add(s.size);opponents.add(s.opponent);pairs.add(pair);buckets.set(key,(buckets.get(key)||0)+1);}
  return [sizes.size,opponents.size,pairs.size,buckets.size,-[...buckets.values()].reduce((sum,n)=>sum+n*n,0)];
 };
 let remove=0,best=score(0);
 for(let i=1;i<samples.length;i++){const next=score(i);for(let k=0;k<best.length;k++){if(next[k]===best[k])continue;if(next[k]>best[k]){remove=i;best=next;}break;}}
 return samples.filter((_,i)=>i!==remove);
}
/** Called from an already validated native snapshot; no game actions or APIs. */
export function appendGoReplay(previous,snapshot,reset,now=Date.now()){
 const id=snapshot?.observation?.identity;
 if(!Array.isArray(snapshot?.board)||!Array.isArray(snapshot?.valid))return previous;
 if(!snapshot?.observation?.valid||snapshot.game?.currentPlayer!=='Black'||!id||id.opponent!==snapshot.opponent||id.size!==snapshot.board?.length||id.board!==snapshot.board?.join('/')||!Number.isFinite(now)||now<0)return previous;
 const sample={at:now,opponent:snapshot.opponent,currentPlayer:'Black',historyLength:id.historyLength,board:snapshot.board.slice(),valid:snapshot.valid?.map(row=>Array.isArray(row)?row.slice():row)};
 const fresh={schemaVersion:1,source:'native-go-snapshot',nodeReset:reset?.lastNodeReset,augReset:reset?.lastAugReset,at:now,samples:[sample]};if(!validGoReplay(fresh))return previous;
 const old=validGoReplay(previous)&&previous.nodeReset===fresh.nodeReset&&previous.augReset===fresh.augReset&&previous.at<=now?previous:null;
 if(old&&now-old.at<60000)return previous;
 const signature=s=>JSON.stringify([s.opponent,s.board,s.valid]);
 if(old?.samples.some(s=>signature(s)===signature(sample)))return previous;
 const samples=diverseGoReplay([...(old?.samples||[]),sample]);
 if(!samples.includes(sample))return previous;
 return {...fresh,samples};
}
