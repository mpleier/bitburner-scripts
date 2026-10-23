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
 if(o['search-mode']!==undefined&&!['auto','off','shadow','play'].includes(o['search-mode']))return 'search-mode must be auto, off, shadow, or play.';
 if(o['search-ms']!==undefined&&(!Number.isFinite(o['search-ms'])||o['search-ms']<1||o['search-ms']>50))return 'search-ms must be between 1 and 50.';
 if(o['search-nodes']!==undefined&&(!Number.isSafeInteger(o['search-nodes'])||o['search-nodes']<16||o['search-nodes']>1024))return 'search-nodes must be an integer between 16 and 1024.';
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
function goGroup(board,x,y,neighbors,at,id) {
 const color=board[x]?.[y],size=board.length,stones=[],liberties=new Set(),pending=[x*size+y];
 while(pending.length) {
  const key=pending.pop();
  if(at[key]>=0)continue;at[key]=id;stones.push([Math.floor(key/size),key%size]);
  for(let n=key*4;n<key*4+4;n++){
   const next=neighbors[n];if(next<0)continue;
   const cell=board[Math.floor(next/size)][next%size];
   if(cell==='.')liberties.add(next);
   else if(cell===color&&at[next]<0)pending.push(next);
  }
 }
 return {stones,liberties};
}
// Private, read-only after construction; no mutable geometry escapes this module.
// Only native sizes persist, keeping the cache bounded at four tables.
const goNeighborTables=new Map();
function goNeighborTable(size){
 if(goNeighborTables.has(size))return goNeighborTables.get(size);
 const table=new Int32Array(size*size*4);table.fill(-1);
 for(let id=0;id<size*size;id++){
  const x=Math.floor(id/size),y=id%size,offset=id*4;
  if(x>0)table[offset]=id-size;if(x+1<size)table[offset+1]=id+size;
  if(y>0)table[offset+2]=id-1;if(y+1<size)table[offset+3]=id+1;
 }
 if([5,7,9,13].includes(size))goNeighborTables.set(size,table);
 return table;
}
/** Reuse connected groups and liberties for every hypothetical move in this immutable snapshot. */
export function analyzeGoBoard(board) {
 const size=board.length,at=Array(size*size).fill(-1),groups=[],neighbors=goNeighborTable(size);
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if('XO'.includes(board[x][y])&&at[x*size+y]<0){
  const id=groups.length,group={...goGroup(board,x,y,neighbors,at,id),color:board[x][y]};
  groups.push(group);
 }
 return {board,signature:board.join('/'),at,groups,size};
}
/** Algebraic capture simulation: no per-candidate board copy or repeated group flood fills. */
export function goMoveOutcome(board,x,y,analysis=null) {
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||board[x]?.[y]!=='.')return null;
 const a=analysis?.board===board&&analysis.signature===board.join('/')?analysis:analyzeGoBoard(board);
 return evaluateGoMove(board,x,y,a,goNeighborTable(a.size));
}
/** Evaluate one native legality snapshot with a single cached-analysis validation. */
export function goMoveOutcomes(board,valid,analysis=null) {
 const a=analysis?.board===board&&analysis.signature===board.join('/')?analysis:analyzeGoBoard(board),outcomes=new Map(),neighbors=goNeighborTable(a.size);
 for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++)if(valid?.[x]?.[y]===true)
  outcomes.set(x+','+y,board[x][y]==='.'?evaluateGoMove(board,x,y,a,neighbors):null);
 return outcomes;
}
// Internal core: callers validate analysis before entering a synchronous batch.
function evaluateGoMove(board,x,y,a,neighbors) {
 const size=a.size,key=x*size+y;
 let friendly=null,enemy=null;const liberties=new Set();
 for(let n=key*4;n<key*4+4;n++){const k=neighbors[n];if(k<0)continue;const id=a.at[k];if(id<0){if(board[Math.floor(k/size)][k%size]==='.')liberties.add(k);continue;}
  const g=a.groups[id];if(g.color==='X')(friendly??=new Set()).add(id);else if(g.liberties.size===1&&g.liberties.has(key))(enemy??=new Set()).add(id);}
 if(!friendly&&!enemy)return {captured:0,liberties:liberties.size,size:1,saved:0};
 let saved=0,ownSize=1,captured=0;
 if(friendly)for(const id of friendly){const g=a.groups[id];ownSize+=g.stones.length;for(const k of g.liberties)if(k!==key)liberties.add(k);if(g.liberties.size===1)saved+=g.stones.length;}
 // Only capturable enemy chains are retained, deduplicated by ID.
 if(enemy)for(const id of enemy){const g=a.groups[id];
  captured+=g.stones.length;
  for(const [i,j]of g.stones){const k=i*size+j;for(let n=k*4;n<k*4+4;n++)if(neighbors[n]>=0&&(neighbors[n]===key||friendly?.has(a.at[neighbors[n]]))){liberties.add(k);break;}}
 }
 liberties.delete(key);
 return {captured,liberties:liberties.size,size:ownSize,saved:liberties.size>=2?saved:0};
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
/** Conservative pass: no neutral regions, only our territory is playable, and every friendly group has two independent vital regions. */
export function goSettledPass(board,valid,controlled,outcomes,opponent,analysis=analyzeGoBoard(board),gameState=null) {
 if(analysis.board!==board||analysis.signature!==board.join('/'))analysis=analyzeGoBoard(board);
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
 const alive=goAliveChains(board,analysis);
 return analysis.groups.every((g,id)=>g.color!=='X'||alive.has(id));
}

/** Conservative shared-eye life analysis. Remove unsupported chains and all
 * regions touching them until stable. A region is vital to a chain only when
 * every empty point is a liberty of that chain; wall corridors do not qualify. */
export function goAliveChains(board,analysis=analyzeGoBoard(board)) {
 if(analysis.board!==board||analysis.signature!==board.join('/'))analysis=analyzeGoBoard(board);
 const size=board.length,seen=new Set(),regions=[],alive=new Set();
 for(let id=0;id<analysis.groups.length;id++)if(analysis.groups[id].color==='X')alive.add(id);
 for(let x=0;x<size;x++)for(let y=0;y<size;y++)if(board[x][y]==='.'&&!seen.has(x*size+y)){
  const pending=[[x,y]],points=[],boundary=new Set();let enemy=false;
  while(pending.length){const [i,j]=pending.pop(),key=i*size+j;if(seen.has(key))continue;seen.add(key);points.push(key);
   for(const [a,b]of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]])if(a>=0&&b>=0&&a<size&&b<size){
    if(board[a][b]==='.')pending.push([a,b]);else if(board[a][b]==='X')boundary.add(analysis.at[a*size+b]);else if(board[a][b]==='O')enemy=true;
   }
  }
  if(!enemy&&boundary.size)regions.push({boundary,vital:new Set([...boundary].filter(id=>points.every(key=>analysis.groups[id].liberties.has(key))))});
 }
 let active=regions,changed=true;
 while(changed){changed=false;
  const counts=new Map([...alive].map(id=>[id,0]));
  for(const region of active)for(const id of region.vital)if(alive.has(id))counts.set(id,counts.get(id)+1);
  for(const id of alive)if(counts.get(id)<2){alive.delete(id);changed=true;}
  if(changed)active=active.filter(region=>[...region.boundary].every(id=>alive.has(id)));
 }
 return alive;
}

/** Keep bounded recent measurements so old bonuses and machine speed do not dominate forever. */
export function recordGoPerformance(buckets,game,stats,now=Date.now(),finalState=null) {
 const current=stats?.[game?.opponent];if(!game||!current||game.measurementExcluded)return buckets;
 const elapsed=now-game.startedAt,wins=Number(current.wins)-game.wins,losses=Number(current.losses)-game.losses;
 if(![5,7,9,13].includes(game.size)||!Number.isFinite(elapsed)||elapsed<1000||elapsed>1800000||wins+losses!==1||![0,1].includes(wins)||![0,1].includes(losses))return buckets;
 const bonus=Math.max(0,Number(current.bonusPercent)-game.bonus);if(!Number.isFinite(bonus))return buckets;
 const configuration=typeof game.configuration==='string'&&game.configuration.length<=80?game.configuration:null;
 const key=game.opponent+':'+game.size+':'+(game.cheats?'cheats':'normal')+(configuration?'|'+configuration:'');
 const reward=losses===1&&bonus===0?0:finalState?goNodePowerReward(finalState.blackScore,finalState.komi,game.size,Number(current.winStreak),Number(game.winStreak)):null;
 const timing=game.timing&&Object.values(game.timing).every(v=>Number.isFinite(v)&&v>=0)?{...game.timing}:null;
 const old=buckets[key],history=[...(Array.isArray(old?.history)?old.history.filter(g=>g&&Number.isFinite(g.ms)&&g.ms>0&&[0,1].includes(g.win)&&Number.isFinite(g.bonus)&&g.bonus>=0).map(g=>g.win===0&&g.bonus===0?{...g,reward:0}:g):[]),{...(typeof game.id==='string'?{id:game.id}:{}),ms:elapsed,win:wins,bonus,reward,turns:game.turns||0,at:now,...(timing?{timing}:{}),logGain:Math.log1p(bonus/(100+Math.max(0,Number(game.bonus)||0)))}].slice(-20);
 return trimGoProfiles({...buckets,[key]:{opponent:game.opponent,size:game.size,cheats:!!game.cheats,...(configuration?{configuration}:{}),completed:(Number.isSafeInteger(old?.completed)&&old.completed>=0?old.completed:0)+1,games:history.length,wins:history.reduce((s,g)=>s+g.win,0),
  rewardVersion:2,totalReward:history.every(g=>Number.isFinite(g.reward)&&g.reward>=0)?history.reduce((s,g)=>s+g.reward,0):null,totalMs:history.reduce((s,g)=>s+g.ms,0),totalBonus:history.reduce((s,g)=>s+g.bonus,0),...(Array.isArray(old?.interruptions)?{interruptions:old.interruptions}:{}),history,at:now}},configuration);
}

export function chooseGoBoardSize(opponent,buckets={},cheats=false,explore=true,now=Date.now()) {
 const validRows=Object.values(buckets).filter(r=>r&&r.opponent===opponent&&r.cheats===cheats&&[5,7,9,13].includes(r.size)&&Number.isFinite(r.games)&&r.games>0&&Number.isFinite(r.wins)&&r.wins>=0&&r.wins<=r.games&&Number.isFinite(r.totalMs)&&r.totalMs>0);
 const games=validRows.reduce((s,r)=>s+(Number.isSafeInteger(r.completed)&&r.completed>=r.games?r.completed:r.games),0);
 // Compare a bounded two-hour window; refresh alternatives every thirty minutes.
 // Three trials spaced eight games apart must have time to accumulate evidence.
 const rows=validRows.map(r=>{
  if(!Array.isArray(r.history))return Number.isFinite(r.at)&&(r.at>now||now-r.at>7200000)?{...r,games:0}:r;
  const h=r.history.filter(g=>g&&Number.isFinite(g.at)&&g.at<=now&&now-g.at<=7200000&&Number.isFinite(g.ms)&&g.ms>=1000&&g.ms<=1800000&&[0,1].includes(g.win)&&Number.isFinite(g.bonus)&&g.bonus>=0).slice(-20);
  return {...r,history:h,games:h.length,wins:h.reduce((s,g)=>s+g.win,0),totalMs:h.reduce((s,g)=>s+g.ms,0),totalBonus:h.reduce((s,g)=>s+g.bonus,0),
   totalReward:h.length&&h.every(g=>Number.isFinite(g.reward)&&g.reward>=0)?h.reduce((s,g)=>s+g.reward,0):null,at:h.length?Math.max(...h.map(g=>g.at)):0};
 }).map(r=>({...r,interruptedMs:goInterruptedMs([r],now)}));
 const baseline=rows.find(r=>r.size===13);
 if(!baseline||baseline.games<3)return 13;
 const order=opponent==='Illuminati'?[5,7,9]:[7,9,5];
 if(explore&&games%8===3){
  const missing=order.find(n=>(rows.find(r=>r.size===n)?.games||0)<3);if(missing)return missing;
  const stale=order.map(size=>rows.find(r=>r.size===size)).filter(r=>r&&Number.isFinite(r.at)&&now-r.at>=1800000).sort((a,b)=>a.at-b.at||order.indexOf(a.size)-order.indexOf(b.size));
  if(stale.length)return stale[0].size;
 }
 // Losses already reduce realized reward per minute. A second win-rate penalty
 // discarded profitable boards (including 75%-win boards) and double-counted losses.
 const reliable=rows.filter(r=>r.games>=3&&r.totalMs>0&&(r.wins>0||Array.isArray(r.history)&&r.history.length===r.games&&r.rewardVersion===2&&Number.isFinite(r.totalReward)&&r.totalReward>0)&&Number.isFinite(r.totalBonus)&&r.totalBonus>0);
 const useRewards=reliable.length>0&&reliable.every(r=>r.rewardVersion===2&&Number.isFinite(r.totalReward)&&r.totalReward>=0);
 const rate=r=>(useRewards?r.totalReward:r.totalBonus)/(r.totalMs+(r.interruptedMs||0));
 reliable.sort((a,b)=>rate(b)-rate(a)||a.size-b.size);
 return reliable[0]?.size||13;
}


/** Native node-power award; comparable across board sizes even as percentage bonuses diminish. */
export function goNodePowerReward(score,komi,size,streak,priorStreak) {
 if(!Number.isFinite(score)||score<0||!Number.isFinite(komi)||!Number.isFinite(streak)||!Number.isFinite(priorStreak))return null;
 const difficulty=size===5&&komi===7.5?8:(komi+.5)*.25;
 const wins=streak<0?.5:priorStreak<0&&streak>0?1+.5*Math.min(-priorStreak,8):1+.25*Math.min(streak,8);
 return score*difficulty*wins;
}

/** Duration-weighted reward rate with an approximate Student-t uncertainty band.
 * This is a finite-window decision heuristic, not a sequential confidence guarantee.
 * Residuals use reward - rate*time, rather than averaging per-game rates. */
export function goEngineEvidence(history=[]) {
 const h=(Array.isArray(history)?history:[]).filter(g=>g&&Number.isFinite(g.at)&&Number.isFinite(g.ms)&&g.ms>=1000&&g.ms<=1800000&&Number.isFinite(g.reward)&&g.reward>=0);
 const unique=[...new Map(h.map(g=>[g.at,g])).values()].sort((a,b)=>a.at-b.at).slice(-20),n=unique.length;
 const time=unique.reduce((s,g)=>s+g.ms,0),reward=unique.reduce((s,g)=>s+g.reward,0),rate=reward/time;
 const unknown={samples:0,rate:null,lower:null,upper:null,standardError:null,effectiveSamples:0,elapsedMs:0,lastAt:unique.at(-1)?.at||0,model:'ratio-delta-t-approximation'};
 if(!n||![time,reward,rate].every(Number.isFinite)||!(time>0))return unknown;
 const effectiveSamples=1/unique.reduce((s,g)=>s+(g.ms/time)**2,0);
 if(n<2)return {...unknown,samples:n,rate,effectiveSamples,elapsedMs:time};
 const variance=unique.reduce((s,g)=>s+(g.reward-rate*g.ms)**2,0),standardError=Math.sqrt(n/(n-1)*variance)/time;
 const critical=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093][n-1];
 const width=critical*standardError;
 if(![effectiveSamples,standardError,width].every(Number.isFinite))return unknown;
 return {...unknown,samples:n,rate,effectiveSamples,elapsedMs:time,standardError,lower:Math.max(0,rate-width),upper:rate+width};
}

/** Trials use one in eight native completions, separate from board/opponent trial slots. */
export function chooseGoEngine(engines={},options={}) {
 const {opponent,size,cheats=false,now=Date.now(),completed=0,protectStreak=false,trial=false,mode='auto',configurations=null}=options;
 if(protectStreak)return {engine:'tactical',reason:'protected-streak',trial:false};
 if(mode!=='auto')return {engine:mode==='play'?'search-v1':'tactical',reason:'explicit-mode',trial:false};
 if(trial)return {engine:'tactical',reason:'isolated-board-opponent-trial',trial:false};
 const measure=engine=>{
  const rows=Object.values(engines[engine]||{}).filter(r=>r&&r.opponent===opponent&&r.size===size&&r.cheats===cheats&&r.rewardVersion===2&&(!configurations||r.configuration===configurations[engine]));
  const h=rows.flatMap(r=>Array.isArray(r.history)?r.history:[]).filter(g=>g&&Number.isFinite(g.at)&&g.at<=now&&now-g.at<=7200000&&Number.isFinite(g.bonus)&&g.bonus>=0&&[0,1].includes(g.win));
  const evidence=goEngineEvidence(h),interruptedMs=goInterruptedMs(rows,now),scale=evidence.elapsedMs>0?evidence.elapsedMs/(evidence.elapsedMs+interruptedMs):1;
  return {...evidence,interruptedMs,rate:evidence.rate===null?null:evidence.rate*scale,lower:evidence.lower===null?null:evidence.lower*scale,upper:evidence.upper===null?null:evidence.upper*scale,standardError:evidence.standardError===null?null:evidence.standardError*scale};
 };
 const tactical=measure('tactical'),search=measure('search-v1');
 if(tactical.samples<3)return {engine:'tactical',reason:'requires-matching-baseline',trial:false,tactical,search};
 const enough=tactical.samples>=6&&search.samples>=6&&tactical.effectiveSamples>=3&&search.effectiveSamples>=3;
 const preferSearch=enough&&search.rate>tactical.rate*1.15&&search.lower>tactical.upper;
 const slot=Number.isSafeInteger(completed)&&completed>=0&&completed%8===7;
 // Promotion must not starve its reference player of fresh measurements.
 if(slot&&preferSearch&&now-tactical.lastAt>=1800000)
  return {engine:'tactical',reason:'bounded-baseline-refresh',trial:true,tactical,search};
 const uncertain=search.samples<20&&Number.isFinite(search.upper)&&search.upper>tactical.lower*1.15;
 if(slot&&!preferSearch&&(search.samples<6||uncertain||now-search.lastAt>=1800000))
  return {engine:'search-v1',reason:'bounded-challenger-trial',trial:true,tactical,search};
 const reason=preferSearch?'confidence-supported-throughput-gain':search.samples>=6&&search.rate>tactical.rate*1.15?'uncertain-throughput-gain':'tactical-baseline';
 return {engine:preferSearch?'search-v1':'tactical',reason,trial:false,tactical,search};
}

/** Preserve old tactical/search records during migration, never across reset boundaries. */
export function restoreGoEngines(saved,reset){
 const engines={tactical:{},'search-v1':{}};
 if(!saved||saved.nodeReset!==reset?.lastNodeReset||saved.augReset!==reset?.lastAugReset)return engines;
 const valid=b=>b&&typeof b==='object'&&!Array.isArray(b);
 if([3,4].includes(saved.version)&&valid(saved.engines)){
  for(const engine of ['tactical','search-v1'])if(valid(saved.engines[engine]))engines[engine]=saved.engines[engine];
 }else if(saved.version===2&&['tactical','search-v1'].includes(saved.engine||'tactical')&&valid(saved.buckets))engines[saved.engine||'tactical']=saved.buckets;
 return engines;
}

/** Versioned policy identity. Search budgets affect search, while shadow budgets
 * also affect tactical elapsed time. Explicit off and auto share tactical play. */
export function goEngineConfigurations(options={},revisions=undefined){
 const ms=options['search-ms']??5,nodes=options['search-nodes']??64,chance=options['cheat-chance-threshold']??.9,mode=options['search-mode']??'auto';
 if(!Number.isFinite(ms)||ms<1||ms>50||!Number.isSafeInteger(nodes)||nodes<16||nodes>1024||!Number.isFinite(chance)||chance<0||chance>1||!['auto','off','shadow','play'].includes(mode))return null;
 if(revisions===null||revisions!==undefined&&(!/^[0-9a-f]{16}$/.test(revisions?.common)||!/^[0-9a-f]{16}$/.test(revisions?.search)))return null;
 const settings=':e'+Number(options['early-pass']!==false)+':a'+Number(!!options['allow-self-atari'])+':c'+chance;
 const tactical=(revisions?'p2:'+(mode==='shadow'?revisions.search:revisions.common):'p1')+settings;
 const search=(revisions?'p2:'+revisions.search:'p1')+settings;
 return {tactical:tactical+(mode==='shadow'?(revisions?':h':':shadow')+ms+','+nodes:(revisions?':t':':tactical')),'search-v1':search+(revisions?':s':':search')+ms+','+nodes};
}

/** Untagged historical rows remain archived but never represent an arbitrary budget. */
export function goProfileBuckets(buckets,configuration){
 if(typeof configuration!=='string')return {};
 return Object.fromEntries(Object.entries(buckets||{}).filter(([,r])=>r&&r.configuration===configuration));
}

/** Bound archived configurations per engine, retaining the current profile first. */
export function trimGoProfiles(buckets,currentConfiguration=null){
 const entries=Object.entries(buckets||{}).filter(([,r])=>r&&typeof r==='object'),latest=new Map();
 for(const [,r]of entries){const key=r.configuration||null,at=Number.isFinite(r.at)?r.at:0;latest.set(key,Math.max(at,latest.get(key)||0));}
 const keep=[...latest].sort((a,b)=>Number(b[0]===currentConfiguration)-Number(a[0]===currentConfiguration)||b[1]-a[1]).slice(0,4).map(([key])=>key);
 return Object.fromEntries(entries.filter(([,r])=>keep.includes(r.configuration||null)));
}

/** Only checkpoint-confirmed active segments count; duplicate IDs cannot add cost twice. */
export function goInterruptedMs(rows=[],now=Date.now(),windowMs=7200000){
 const entries=(Array.isArray(rows)?rows:[]).flatMap(r=>Array.isArray(r?.interruptions)?r.interruptions:[]).filter(g=>g&&typeof g.id==='string'&&g.id.length>0&&Number.isFinite(g.at)&&g.at<=now&&now-g.at<=windowMs&&Number.isFinite(g.ms)&&g.ms>0&&g.ms<=1800000);
 return [...new Map(entries.map(g=>[g.id,g])).values()].reduce((sum,g)=>sum+g.ms,0);
}

/** Recovery records no win, loss, reward, or completed sample. Completed receipts
 * make recovery idempotent even if shutdown occurs after saving a result. */
export function recordGoInterruptedTime(buckets,session,reset,now=Date.now(),reason='controller-restarted'){
 const g=session?.record;
 if(!Number.isFinite(reset?.lastNodeReset)||!Number.isFinite(reset?.lastAugReset)||session?.schemaVersion!==1||session.state!=='active'||session.nodeReset!==reset?.lastNodeReset||session.augReset!==reset?.lastAugReset||
  !['tactical','search-v1'].includes(session.engine)||typeof session.id!=='string'||!session.id.length||session.id.length>160||!g||g.measurementExcluded||
  typeof g.opponent!=='string'||!goOpponents.includes(g.opponent)||![5,7,9,13].includes(g.size)||typeof g.cheats!=='boolean'||typeof g.configuration!=='string'||!g.configuration.length||g.configuration.length>80)return buckets;
 const ms=session.at-g.startedAt;
 if(![now,session.at,g.startedAt,ms].every(Number.isFinite)||session.at>now||now-session.at>7200000||ms<=0||ms>1800000)return buckets;
 const key=g.opponent+':'+g.size+':'+(g.cheats?'cheats':'normal')+'|'+g.configuration,old=buckets[key];
 if([...(Array.isArray(old?.history)?old.history:[]),...(Array.isArray(old?.interruptions)?old.interruptions:[])].some(row=>row?.id===session.id))return buckets;
 const interruptions=[...(Array.isArray(old?.interruptions)?old.interruptions:[]),{id:session.id,ms,at:session.at,reason}].filter(row=>row&&Number.isFinite(row.at)&&row.at<=now&&now-row.at<=7200000).sort((a,b)=>a.at-b.at).slice(-20);
 return trimGoProfiles({...buckets,[key]:{opponent:g.opponent,size:g.size,cheats:g.cheats,configuration:g.configuration,rewardVersion:2,completed:0,games:0,wins:0,totalReward:0,totalMs:0,totalBonus:0,history:[],...old,interruptions,at:Math.max(Number(old?.at)||0,session.at)}},g.configuration);
}

/** Self-contained native newest-first history continuity check for snapshot workers.
 * Passes preserve the board/history; captures may reduce stones but preserve ancestry. */
export function goBoardObservation(board,opponent,history,previous=null,action=null){
 const valid=b=>Array.isArray(b)&&b.length>0&&b.every(row=>typeof row==='string'&&row.length===b.length&&/^[XO.#]+$/.test(row));
 if(!valid(board)||typeof opponent!=='string'||!Array.isArray(history)||!history.every(h=>valid(h)&&h.length===board.length))return {valid:false,changed:false,reason:'invalid-board-observation'};
 const signature=b=>b.join('/'),identity={opponent,size:board.length,board:signature(board),historyLength:history.length,head:history.length?signature(history[0]):null,tail:history.length?signature(history[history.length-1]):null};
 if(!previous)return {valid:true,changed:false,reason:'baseline',identity};
 if(!Number.isInteger(previous.historyLength)||previous.historyLength<0||typeof previous.board!=='string')return {valid:false,changed:false,reason:'invalid-prior-observation'};
 const ownCheat=action?.accepted===true&&action.kind==='cheat'&&action.before?.board===previous.board&&action.before?.historyLength===previous.historyLength&&action.before?.head===previous.head;
 let reason=null;
 if(previous.opponent!==opponent)reason='opponent-replaced';
 else if(previous.size!==board.length)reason='board-size-replaced';
 else if(history.length<previous.historyLength)reason='history-restarted';
 else {
  const added=history.length-previous.historyLength;
  if(added===0){if(!ownCheat&&identity.board!==previous.board||identity.head!==previous.head||identity.tail!==previous.tail)reason='board-history-replaced';}
  else if(!ownCheat&&signature(history[added-1])!==previous.board||previous.historyLength>0&&signature(history[added])!==previous.head||previous.tail!==null&&identity.tail!==previous.tail)reason='board-history-replaced';
 }
 let progress=null;
 if(reason===null){
  let blackPlacements=0,whitePlacements=0;const added=history.length-previous.historyLength;
  for(let i=0;i<added;i++){const before=history[i],after=i===0?board:history[i-1];for(let x=0;x<board.length;x++)for(let y=0;y<board.length;y++){if(before[x][y]!=='X'&&after[x][y]==='X')blackPlacements++;if(before[x][y]!=='O'&&after[x][y]==='O')whitePlacements++;}}
  progress={blackPlacements,whitePlacements};
 }
 return {valid:true,changed:reason!==null,reason:reason||'continuous',identity,progress};
}

/** Cheap final guard: any history mutation since the planning snapshot invalidates it. */
export function goHistoryMatches(identity,opponent,history){
 if(!identity)return true;
 if(opponent!==identity.opponent||!Array.isArray(history)||history.length!==identity.historyLength)return false;
 const signature=b=>Array.isArray(b)&&b.every(r=>typeof r==='string')?b.join('/'):null;
 return (history.length?signature(history[0]):null)===identity.head&&(history.length?signature(history[history.length-1]):null)===identity.tail;
}

/** Detect attributable outside progress without claiming every human move is observable.
 * Native cheating mutates two stones directly: only the AI adds history (zero or one). */
export function goActionIntervention(previous,observation,action=null,invalidated=false,currentPlayer='Black'){
 if(!previous||!observation?.valid||observation.changed)return null;
 if(invalidated)return 'external-intervention-during-planning';
 const next=observation.identity,added=next.historyLength-previous.historyLength,changed=next.board!==previous.board;
 if(!action?.accepted){
  if(added>0||changed||action?.uncertain&&currentPlayer!=='Black')return action?.uncertain?'unverified-action-result':'untracked-board-progress';
  if(!action&&currentPlayer!=='Black')return 'external-turn-change';
  return null;
 }
 if(action.before?.board!==previous.board||action.before?.historyLength!==previous.historyLength||action.before?.head!==previous.head)return 'unmatched-action-receipt';
 const max={ordinary:2,pass:1,cheat:1}[action.kind];
 if(max===undefined||added>max||added<(action.kind==='ordinary'?1:0))return 'unexpected-history-progress';
 if(observation.progress&&(observation.progress.blackPlacements!==(action.kind==='ordinary'?1:0)||observation.progress.whitePlacements>1))return 'unexpected-player-moves';
 const before=previous.board,after=next.board;let newBlack=0;for(let i=0;i<after.length;i++)if(after[i]==='X'&&before[i]!=='X')newBlack++;
 if(newBlack>(action.kind==='ordinary'?1:action.kind==='cheat'?2:0))return 'unexpected-player-moves';
 if(action.outcome!=='gameOver'&&currentPlayer==='None')return 'external-game-completion';
 if(action.outcome==='gameOver'&&currentPlayer!=='None')return 'unexpected-live-board';
 return null;
}

/** Startup source revision for the controller and its native movement policies.
 * Normalize line endings/BOM only; any other source change conservatively versions evidence.
 * This compact dual hash is a provenance label, not a security checksum. */
export function goPolicyRevisions(read){
 try{
  const source=path=>{const text=read(path);if(typeof text!=='string'||!text.trim())throw new Error('Missing policy source');return text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');};
  const hash=text=>{let a=2166136261,b=0x9e3779b9;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b^code,0x5bd1e995);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');};
  const controller=source('go.js'),policy=source('go-policy.js'),searchPolicy=source('go-search-policy.js');
  const common=hash(JSON.stringify([['go.js',controller],['go-policy.js',policy]]));
  return {schemaVersion:1,common,search:hash(JSON.stringify([common,['go-search-policy.js',searchPolicy]])),files:['go.js','go-policy.js','go-search-policy.js']};
 }catch{return null;}
}
