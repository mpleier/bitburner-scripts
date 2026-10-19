export const goOpponents=['Netburners','Slum Snakes','The Black Hand','Tetrads','Daedalus','Illuminati','????????????'];
export function rankGoOpponents(stats={},goal='auto',node=1,performance={}) {
 const priorities={hacknet:{Netburners:5},crime:{'Slum Snakes':5},combat:{Tetrads:5},reputation:{Daedalus:5},
  money:{'The Black Hand':5},speed:{Illuminati:5},hacking:{'????????????':5}};
 if(goal==='auto')goal=({2:'crime',6:'combat',7:'combat',8:'reputation',9:'hacknet',10:'reputation',14:'hacking'})[node]||'money';
 const measured=Object.fromEntries(goOpponents.map(name=>{const rows=Object.values(performance).filter(r=>r&&r.opponent===name&&Number.isFinite(r.games)&&r.games>=3&&Number.isFinite(r.totalMs)&&r.totalMs>0&&Number.isFinite(r.totalBonus)&&r.totalBonus>=0);
  return [name,rows.reduce((sum,r)=>sum+r.totalBonus,0)/Math.max(1,rows.reduce((sum,r)=>sum+r.totalMs,0))*60000];}));
 const rates=Object.values(measured).filter(r=>Number.isFinite(r)&&r>0).sort((a,b)=>a-b),baseline=rates[Math.floor(rates.length/2)]||1;
 const weights=priorities[goal];if(!weights)throw new Error('Unknown Go goal: '+goal);
 return goOpponents.map(name=>{const s=stats[name]||{},wins=Number.isFinite(Number(s.wins))?Math.max(0,Number(s.wins)):0,losses=Number.isFinite(Number(s.losses))?Math.max(0,Number(s.losses)):0,games=wins+losses;
  const success=(wins+2)/(games+4),exploration=1/Math.sqrt(games+1),bonus=Number.isFinite(Number(s.bonusPercent))?Math.max(0,Number(s.bonusPercent)):0;
  const throughput=measured[name]>0?Math.max(.5,Math.min(2,measured[name]/baseline)):1;
  return {name,score:(weights[name]||1)*(success+0.15*exploration)/(1+bonus/100)*throughput,success,games,goal,bonusPerMinute:measured[name]||null};
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
/** Reuse connected groups and liberties for every hypothetical move in this immutable snapshot. */
export function analyzeGoBoard(board) {
 const size=board.length,at=Array(size*size).fill(-1),groups=[];
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if('XO'.includes(board[x][y])&&at[x*size+y]<0){
  const group={...goGroup(board,x,y),color:board[x][y]},id=groups.length;
  groups.push(group);for(const [a,b]of group.stones)at[a*size+b]=id;
 }
 return {board,signature:board.join('/'),at,groups,size};
}
/** Algebraic capture simulation: no per-candidate board copy or repeated group flood fills. */
export function goMoveOutcome(board,x,y,analysis=null) {
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||board[x]?.[y]!=='.')return null;
 const a=analysis?.board===board&&analysis.signature===board.join('/')?analysis:analyzeGoBoard(board),size=a.size,key=x*size+y;
 const neighbors=id=>{const i=Math.floor(id/size),j=id%size;return [i>0?id-size:-1,i+1<size?id+size:-1,j>0?id-1:-1,j+1<size?id+1:-1].filter(k=>k>=0);};
 const near=neighbors(key),friendly=new Set(),enemy=new Set(),liberties=new Set(),own=new Set([key]),removed=new Set();
 for(const k of near){const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  (a.groups[id].color==='X'?friendly:enemy).add(id);}
 let saved=0;
 for(const id of friendly){const g=a.groups[id];for(const [i,j]of g.stones)own.add(i*size+j);for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 for(const id of enemy){const g=a.groups[id];if(g.liberties.size===1&&g.liberties.has(key))for(const [i,j]of g.stones)removed.add(i*size+j);}
 for(const k of removed)if(neighbors(k).some(n=>own.has(n)))liberties.add(k);
 liberties.delete(key);
 return {captured:removed.size,liberties:liberties.size,size:own.size,saved:liberties.size>=2?saved:0};
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


const goKomi={'Netburners':1.5,'Slum Snakes':3.5,'The Black Hand':3.5,Tetrads:5.5,Daedalus:5.5,Illuminati:7.5,'????????????':9.5};
/** Conservative pass: no neutral regions, only our secure territory is playable, every friendly group has two small eyes. */
export function goSettledPass(board,valid,controlled,outcomes,opponent,analysis=analyzeGoBoard(board),gameState=null) {
 if(!Number.isFinite(goKomi[opponent])||!analysis.groups.some(g=>g.color==='X'))return false;
 let black=0,white=goKomi[opponent];
 for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++){
  const cell=board[x][y];if(cell==='X')black++;else if(cell==='O')white++;
  else if(cell==='.'){
   if(controlled[x]?.[y]==='X')black++;else if(controlled[x]?.[y]==='O')white++;else return false;
   const o=outcomes.get(x+','+y);
   if(valid[x]?.[y]&&(controlled[x]?.[y]!=='X'||!o||o.captured||o.saved))return false;
  }
 }
 if(gameState){if(gameState.currentPlayer!=='Black'||!Number.isFinite(gameState.blackScore)||!Number.isFinite(gameState.whiteScore)||gameState.blackScore-gameState.whiteScore<4)return false;}
 else if(black-white<4)return false;
 const size=board.length,seen=new Set(),eyes=new Map();
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if(board[x][y]==='.'&&!seen.has(x*size+y)){
  const pending=[[x,y]],region=[],boundary=new Set();let unsafe=false;
  while(pending.length){const [i,j]=pending.pop(),key=i*size+j;if(seen.has(key))continue;seen.add(key);region.push(key);
   for(const [a,b]of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]])if(a>=0&&b>=0&&a<size&&b<size){
    if(board[a][b]==='.')pending.push([a,b]);else if(board[a][b]==='X')boundary.add(analysis.at[a*size+b]);else if(board[a][b]==='O')unsafe=true;
   }
  }
  if(!unsafe&&region.length<=2&&boundary.size===1){const id=[...boundary][0];eyes.set(id,(eyes.get(id)||0)+1);}
 }
 return analysis.groups.every((g,id)=>g.color!=='X'||(eyes.get(id)||0)>=2);
}

/** Keep bounded recent measurements so old bonuses and machine speed do not dominate forever. */
export function recordGoPerformance(buckets,game,stats,now=Date.now(),finalState=null) {
 const current=stats?.[game?.opponent];if(!game||!current)return buckets;
 const elapsed=now-game.startedAt,wins=Number(current.wins)-game.wins,losses=Number(current.losses)-game.losses;
 if(![5,7,9,13].includes(game.size)||!Number.isFinite(elapsed)||elapsed<1000||elapsed>1800000||wins+losses!==1||![0,1].includes(wins)||![0,1].includes(losses))return buckets;
 const bonus=Math.max(0,Number(current.bonusPercent)-game.bonus);if(!Number.isFinite(bonus))return buckets;
 const key=game.opponent+':'+game.size+':'+(game.cheats?'cheats':'normal');
 const reward=losses===1&&bonus===0?0:finalState?goNodePowerReward(finalState.blackScore,finalState.komi,game.size,Number(current.winStreak),Number(game.winStreak)):null;
 const old=buckets[key],history=[...(Array.isArray(old?.history)?old.history.filter(g=>g&&Number.isFinite(g.ms)&&g.ms>0&&[0,1].includes(g.win)&&Number.isFinite(g.bonus)&&g.bonus>=0).map(g=>g.win===0&&g.bonus===0?{...g,reward:0}:g):[]),{ms:elapsed,win:wins,bonus,reward,turns:game.turns||0,at:now,logGain:Math.log1p(bonus/(100+Math.max(0,Number(game.bonus)||0)))}].slice(-20);
 return {...buckets,[key]:{opponent:game.opponent,size:game.size,cheats:!!game.cheats,completed:(Number.isSafeInteger(old?.completed)&&old.completed>=0?old.completed:0)+1,games:history.length,wins:history.reduce((s,g)=>s+g.win,0),
  rewardVersion:2,totalReward:history.every(g=>Number.isFinite(g.reward)&&g.reward>=0)?history.reduce((s,g)=>s+g.reward,0):null,totalMs:history.reduce((s,g)=>s+g.ms,0),totalBonus:history.reduce((s,g)=>s+g.bonus,0),history,at:now}};
}

export function chooseGoBoardSize(opponent,buckets={},cheats=false,explore=true) {
 const rows=Object.values(buckets).filter(r=>r&&r.opponent===opponent&&r.cheats===cheats&&[5,7,9,13].includes(r.size)&&Number.isFinite(r.games)&&r.games>0&&Number.isFinite(r.wins)&&r.wins>=0&&r.wins<=r.games&&Number.isFinite(r.totalMs)&&r.totalMs>0);
 const baseline=rows.find(r=>r.size===13),games=rows.reduce((s,r)=>s+(Number.isSafeInteger(r.completed)&&r.completed>=r.games?r.completed:r.games),0);
 if(!baseline||baseline.games<3)return 13;
 // Sample an alternate at most once per eight completed games; protect established winning play.
 const order=opponent==='Illuminati'?[5,7,9]:[7,9,5];
 if(explore&&games%8===3){const size=order.find(n=>(rows.find(r=>r.size===n)?.games||0)<3);if(size)return size;}
 const reliable=rows.filter(r=>r.games>=3&&r.wins/r.games>=.8&&Number.isFinite(r.totalBonus)&&r.totalBonus>0);
 // Compare all candidates in the same units. Legacy rewards may include failed cheats.
 const useRewards=reliable.length>0&&reliable.every(r=>r.rewardVersion===2&&Number.isFinite(r.totalReward)&&r.totalReward>=0);
 const rate=r=>(useRewards?r.totalReward:r.totalBonus)/r.totalMs;
 reliable.sort((a,b)=>rate(b)*(b.wins+2)/(b.games+4)-rate(a)*(a.wins+2)/(a.games+4));
 return reliable[0]?.size||13;
}


/** Native node-power award; comparable across board sizes even as percentage bonuses diminish. */
export function goNodePowerReward(score,komi,size,streak,priorStreak) {
 if(!Number.isFinite(score)||score<0||!Number.isFinite(komi)||!Number.isFinite(streak)||!Number.isFinite(priorStreak))return null;
 const difficulty=size===5&&komi===7.5?8:(komi+.5)*.25;
 const wins=streak<0?.5:priorStreak<0&&streak>0?1+.5*Math.min(-priorStreak,8):1+.25*Math.min(streak,8);
 return score*difficulty*wins;
}
