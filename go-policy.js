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
