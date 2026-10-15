export const goOpponents=['Netburners','Slum Snakes','The Black Hand','Tetrads','Daedalus','Illuminati','????????????'];
export function rankGoOpponents(stats={},goal='auto',node=1) {
 const priorities={hacknet:{Netburners:5},crime:{'Slum Snakes':5},combat:{Tetrads:5},reputation:{Daedalus:5},
  money:{'The Black Hand':5},speed:{Illuminati:5},hacking:{'????????????':5}};
 if(goal==='auto')goal=({2:'crime',6:'combat',7:'combat',8:'reputation',9:'hacknet',10:'reputation',14:'hacking'})[node]||'money';
 const weights=priorities[goal];if(!weights)throw new Error('Unknown Go goal: '+goal);
 return goOpponents.map(name=>{const s=stats[name]||{},wins=Number.isFinite(Number(s.wins))?Math.max(0,Number(s.wins)):0,losses=Number.isFinite(Number(s.losses))?Math.max(0,Number(s.losses)):0,games=wins+losses;
  const success=(wins+2)/(games+4),exploration=1/Math.sqrt(games+1),bonus=Number.isFinite(Number(s.bonusPercent))?Math.max(0,Number(s.bonusPercent)):0;
  return {name,score:(weights[name]||1)*(success+0.15*exploration)/(1+bonus/100),success,games,goal};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
}

export function goOptionsError(o) {
 try{rankGoOpponents({},o.goal);}catch{return 'Unknown Go goal: '+o.goal;}
 if(o['board-size']!==undefined&&![5,7,9,13].includes(o['board-size']))return 'board-size must be 5, 7, 9, or 13.';
 if(o.opponent&&!goOpponents.includes(o.opponent))return 'Unknown Go opponent: '+o.opponent;
 if(!Number.isFinite(o['cheat-chance-threshold'])||o['cheat-chance-threshold']<0||o['cheat-chance-threshold']>1)return 'cheat-chance-threshold must be between 0 and 1.';
 return null;
}
export function goCheatsEnabled(o,level) {return o.cheats!==false&&!o['disable-cheats']&&Number(level)>=2;}
export function validGoPair(valid,coords) {
 if(!Array.isArray(coords)||coords.length!==4||!coords.every(Number.isInteger))return false;
 const [x,y,a,b]=coords;
 return (x!==a||y!==b)&&valid[x]?.[y]===true&&valid[a]?.[b]===true;
}
export function shuffleGoMoves(moves,random=Math.random) {
 const result=moves.slice();
 for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
 return result;
}
export function liveGoGoals(ns,now=Date.now()) {
 try{const g=JSON.parse(ns.read('tasks/achievement-goals.json'));return g.expiresAt>now&&g.nodeReset===ns.getResetInfo().lastNodeReset&&ns.isRunning(g.ownerPid)?g:null;}catch{return null;}
}
export function attemptGoFailure(goal,attempts,enabled) {return !!(enabled&&goal?.goFailure&&!goal.goStreak&&attempts<16);}

export function goCheatChanceAllowed(chance,threshold){return Number.isFinite(chance)&&chance>=0&&chance<=1&&chance>=threshold;}
export function validGoBoard(board){return Array.isArray(board)&&board.length>0&&board.every(row=>typeof row==='string'&&row.length===board.length&&/^[XO.#]+$/.test(row));}


/** Orthogonal chain traversal; liberties and stones are counted once per connected group. */
function goGroup(board,x,y) {
 const color=board[x]?.[y],size=board.length,stones=[],seen=new Set(),liberties=new Set(),pending=[[x,y]];
 while(pending.length) {
  const [a,b]=pending.pop(),key=a*size+b;
  if(seen.has(key))continue;seen.add(key);stones.push([a,b]);
  for(const [c,d]of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]) {
   if(c<0||d<0||c>=size||d>=size)continue;
   if(board[c][d]==='.')liberties.add(c*size+d);
   else if(board[c][d]===color&&!seen.has(c*size+d))pending.push([c,d]);
  }
 }
 return {stones,liberties};
}
/** Simulate captures before counting the new group's liberties. Native legal moves still enforce ko. */
export function goMoveOutcome(board,x,y) {
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||board[x]?.[y]!=='.')return null;
 const next=board.map(row=>row.split('')),size=board.length;
 const neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>a>=0&&b>=0&&a<size&&b<size);
 const savedStones=new Set();
 for(const [a,b]of neighbors)if(board[a][b]==='X') {
  const group=goGroup(board,a,b);
  if(group.liberties.size===1)for(const [c,d]of group.stones)savedStones.add(c*size+d);
 }
 next[x][y]='X';let captured=0;
 for(const [a,b]of neighbors)if(next[a][b]==='O') {
  const group=goGroup(next,a,b);
  if(group.liberties.size===0){captured+=group.stones.length;for(const [c,d]of group.stones)next[c][d]='.';}
 }
 const own=goGroup(next,x,y),liberties=own.liberties.size;
 return {captured,liberties,size:own.stones.length,saved:liberties>=2?savedStones.size:0};
}
export function goTacticalMove(board,valid,outcomes,random=Math.random) {
 let bestScore=0,best=[];
 for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++) {
  if(valid[x]?.[y]!==true)continue;
  const move=outcomes.get(x+','+y);
  if(!move||move.liberties===0||move.liberties===1&&move.captured<move.size)continue;
  const score=move.saved*120+move.captured*100;
  if(score>bestScore){bestScore=score;best=[[x,y]];}else if(score===bestScore&&score>0)best.push([x,y]);
 }
 if(!best.length)return null;
 const coords=best[Math.floor(random()*best.length)],outcome=outcomes.get(coords.join(','));
 return {coords,msg:'Tactical move: capture '+outcome.captured+', protect '+outcome.saved};
}
