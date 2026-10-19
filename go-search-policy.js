import {validGoBoard} from './go-policy.js';
const adjacent=(x,y,n)=>[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([i,j])=>i>=0&&j>=0&&i<n&&j<n);
function group(b,x,y){
 const color=b[x][y],stones=[],liberties=new Set(),seen=new Set(),pending=[[x,y]],n=b.length;
 while(pending.length){const [i,j]=pending.pop(),key=i*n+j;if(seen.has(key))continue;seen.add(key);stones.push([i,j]);
  for(const [a,c]of adjacent(i,j,n)){if(b[a][c]==='.')liberties.add(a*n+c);else if(b[a][c]===color&&!seen.has(a*n+c))pending.push([a,c]);}}
 return {stones,liberties};
}
/** Pure capture/suicide/repetition simulation; callers supply native root legality. */
export function simulateGoMove(board,x,y,color='X',forbidden=new Set()) {
 if(!['X','O'].includes(color)||!Number.isInteger(x)||!Number.isInteger(y)||board[x]?.[y]!=='.')return null;
 const b=board.map(r=>r.split('')),enemy=color==='X'?'O':'X';b[x][y]=color;
 let captured=0;
 for(const [a,c]of adjacent(x,y,b.length))if(b[a][c]===enemy){const g=group(b,a,c);if(!g.liberties.size){captured+=g.stones.length;for(const [i,j]of g.stones)b[i][j]='.';}}
 const own=group(b,x,y);if(!own.liberties.size)return null;
 const next=b.map(r=>r.join(''));if(forbidden.has(next.join('/')))return null;
 return {board:next,captured,liberties:own.liberties.size};
}
/** Area score plus a small liberty/atari heuristic, always from Black's perspective. */
export function evaluateGoPosition(board) {
 const n=board.length,seen=new Set();let score=0;
 for(let x=0;x<n;x++)for(let y=0;y<n;y++){
  const key=x*n+y;if(seen.has(key)||board[x][y]==='#')continue;
  if(board[x][y]==='.'){
   const pending=[[x,y]],boundary=new Set();let count=0;
   while(pending.length){const [i,j]=pending.pop(),k=i*n+j;if(seen.has(k))continue;seen.add(k);count++;
    for(const [a,c]of adjacent(i,j,n)){if(board[a][c]==='.'&&!seen.has(a*n+c))pending.push([a,c]);else if('XO'.includes(board[a][c]))boundary.add(board[a][c]);}}
   if(boundary.size===1&&count<=n*n-3)score+=boundary.has('X')?count:-count;
  }else{const g=group(board,x,y),sign=board[x][y]==='X'?1:-1;for(const [i,j]of g.stones)seen.add(i*n+j);
   score+=sign*(g.stones.length+.15*Math.min(6,g.liberties.size)-(g.liberties.size===1?2*g.stones.length:0));}
 }
 return score;
}
/** Bounded two-ply challenger. It neither calls native APIs nor mutates live state. */
export function searchGoMove(board,valid,{maxNodes=64,maxMs=5,history=[],clock=()=>performance.now()}={}) {
 const began=clock(),limit=Math.max(1,Math.min(1024,Math.floor(maxNodes)||64)),deadline=began+Math.max(1,Math.min(50,maxMs||5));
 let nodes=0,stopped=false;const seen=new Set(history.filter(validGoBoard).map(b=>b.join('/')));
 const result=(move=null)=>({move,nodes,elapsedMs:Math.max(0,clock()-began),bounded:stopped,model:'two-ply heuristic search'});
 if(!validGoBoard(board))return result();
 seen.add(board.join('/'));
 const simulate=(b,x,y,color,forbidden)=>{if(nodes>=limit||clock()>=deadline){stopped=true;return null;}nodes++;return simulateGoMove(b,x,y,color,forbidden);};
 const candidates=(b,color,legal=null)=>{
  const n=b.length,moves=[];
  for(let x=0;x<n;x++)for(let y=0;y<n;y++)if(b[x][y]==='.'&&(!legal||legal[x]?.[y]===true)){
   const near=adjacent(x,y,n);let weight=-Math.abs(x-(n-1)/2)*.1-Math.abs(y-(n-1)/2)*.1;
   for(const [i,j]of near)if('XO'.includes(b[i][j]))weight+=b[i][j]===color?.2:1;
   moves.push({x,y,weight});
  }
  return moves.sort((a,b)=>b.weight-a.weight||a.x-b.x||a.y-b.y);
 };
 let best=null,bestScore=-Infinity,evaluated=0;
 for(const root of candidates(board,'X',valid).slice(0,6)){
  const first=simulate(board,root.x,root.y,'X',seen);if(stopped)break;if(!first||first.liberties<2&&!first.captured)continue;
  const forbidden=new Set(seen);forbidden.add(first.board.join('/'));
  let worst=evaluateGoPosition(first.board),replies=0;
  for(const reply of candidates(first.board,'O')){
   const second=simulate(first.board,reply.x,reply.y,'O',forbidden);if(stopped)break;if(!second)continue;
   worst=Math.min(worst,evaluateGoPosition(second.board));if(++replies>=4)break;
  }
  if(stopped)break;evaluated++;
  if(worst>bestScore){bestScore=worst;best={coords:[root.x,root.y],msg:'Bounded search proposal',score:worst};}
 }
 // An incomplete first candidate must never become an authoritative move.
 return result(evaluated>=2?best:null);
}
