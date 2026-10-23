import {goOpponents,chooseGoBoardSize,rankGoOpponents,goInterruptedMs} from './go-policy.js';

const minute=60000;
const goalOpponent={hacknet:'Netburners',crime:'Slum Snakes',money:'The Black Hand',combat:'Tetrads',reputation:'Daedalus',speed:'Illuminati',hacking:'????????????'};

/** Only live, current-reset planner evidence may override the BitNode fallback. */
export function goProgressionContext(ns,sourceFileLevel=0,now=Date.now()) {
 const reset=ns.getResetInfo();
 let bottleneck=null,source='BitNode fallback',factions=[];
 try {
  const p=JSON.parse(ns.read('tasks/spending-plan.json'));
  if(p.reset===reset.lastAugReset&&Number.isFinite(p.epoch)&&p.epoch<=now&&now-p.epoch<=minute&&p.expiresAt>now&&ns.isRunning(p.ownerPid)) {
   bottleneck=p.signals?.bottleneck;source='autopilot spending plan';
  }
 }catch{}
 if(!bottleneck||bottleneck==='balanced')try {
  const p=JSON.parse(ns.read('tasks/progression-speed.json'));
  if(p.augReset===reset.lastAugReset&&Number.isFinite(p.at)&&p.at<=now&&now-p.at<=2*minute) {
   bottleneck=p.bottleneck;source='progression estimate';
  }
 }catch{}
 try{factions=ns.getPlayer().factions||[];}catch{}
 return {bottleneck,source,factions,sourceFileLevel,now};
}

/** Measurements are matched to the board and cheat mode used for established play; board trials are identified separately.
 * Log multiplier gain includes diminishing returns and losses; do not multiply it by win rate again.
 * Legacy untimed samples remain available to the board policy but cannot masquerade as fresh trials.
 */
function recentResults(opponent,size,buckets,cheats,now) {
 const rows=Object.values(buckets).filter(r=>r&&r.opponent===opponent&&r.size===size&&r.cheats===cheats);
 const samples=rows.flatMap(r=>Array.isArray(r.history)?r.history:[]).filter(g=>
  g&&Number.isFinite(g.at)&&g.at<=now&&now-g.at<=30*minute&&Number.isFinite(g.ms)&&g.ms>=1000&&g.ms<=30*minute&&
  [0,1].includes(g.win)&&Number.isFinite(g.bonus)&&g.bonus>=0&&Number.isFinite(g.logGain)&&g.logGain>=0).sort((a,b)=>a.at-b.at).slice(-20);
 const totalMs=samples.reduce((s,g)=>s+g.ms,0)+goInterruptedMs(rows,now,30*minute);
 return {samples:samples.length,success:(samples.reduce((s,g)=>s+g.win,0)+2)/(samples.length+4),
  bonusPerMinute:totalMs?samples.reduce((s,g)=>s+g.bonus,0)/totalMs*minute:null,
  logGainPerMinute:totalMs?samples.reduce((s,g)=>s+g.logGain,0)/totalMs*minute:null,
  measuredAt:samples.at(-1)?.at||0};
}

/** Bounded trials learn useful alternatives without replacing explicit choices or achievement policy. */
export function planGoOpponents(stats={},options={},node=1,buckets={},context={}) {
 const now=Number.isFinite(context.now)?context.now:Date.now(),cheats=!!context.cheats;
 const fallback=rankGoOpponents({},options.goal||'auto',node)[0].goal;
 const adaptive=!options.goal||options.goal==='auto';
 const mapping={hacking:'hacking',reputation:'reputation',combat:'combat',crime:'crime',cash:node===9?'hacknet':'money',ram:node===9?'hacknet':'money'};
 const goal=adaptive?(mapping[context.bottleneck]||fallback):options.goal;
 const weights=Object.fromEntries(goOpponents.map(name=>[name,1]));
 weights[goalOpponent[goal]]=5;
 if(adaptive&&mapping[context.bottleneck]) {
  // Retain the node's economic baseline while pursuing the current bottleneck.
  weights[goalOpponent[fallback]]=Math.max(weights[goalOpponent[fallback]],2);
  if(goal==='hacking')weights.Illuminati=4;
  if(goal==='money')weights.Illuminati=3;
 }
 // BN8 disables ordinary hacking income. Crime chance is not a crime-money or gang-income boost.
 if(adaptive&&node===8)weights['The Black Hand']=0;
 const cap=[100000,200000,300000,400000][Math.min(3,Math.max(0,Math.floor(Number(context.sourceFileLevel)||0)))];
 const fixed=options['adaptive-boards']===false||context.boardSizeExplicit||context.protectStreak;
 let ranked=goOpponents.map(name=>{
  const size=fixed?(options['board-size']??13):chooseGoBoardSize(name,buckets,cheats,false,now);
  const recent=recentResults(name,size,buckets,cheats,now),s=stats[name]||{};
  const wins=Number.isFinite(Number(s.wins))?Math.max(0,Number(s.wins)):0;
  const losses=Number.isFinite(Number(s.losses))?Math.max(0,Number(s.losses)):0;
  const bonus=Number.isFinite(Number(s.bonusPercent))?Math.max(0,Number(s.bonusPercent)):0;
  const remainingFavorRep=Array.isArray(context.factions)&&context.factions.includes(name)&&Number.isFinite(Number(s.rep??0))?
   Math.max(0,cap-Math.max(0,Number(s.rep??0))):0;
  return {name,size,goal,weight:weights[name],games:wins+losses,prior:(wins+2)/(wins+losses+4)/(1+bonus/100),
   remainingFavorRep,favorWeight:remainingFavorRep/cap*(goal==='reputation'?.25:.1),...recent};
 });
 const rates=ranked.filter(r=>r.weight>0&&r.samples>=3&&r.logGainPerMinute>0).map(r=>r.logGainPerMinute).sort((a,b)=>a-b);
 const baseline=rates[Math.floor(rates.length/2)];
 for(const r of ranked) {
  const reliable=r.samples>=3;
  // Conservative priors for unmeasured opponents; trials provide evidence before promoting them.
  const throughput=reliable?Math.max(0,Math.min(3,r.logGainPerMinute/(baseline||1))):r.prior;
  r.score=r.weight*throughput*(1+r.favorWeight*r.success);
  r.measured=reliable;r.trial=false;delete r.prior;
 }
 ranked.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const unavailable=context.unavailable||[];
 ranked=ranked.filter(r=>!unavailable.includes(r.name));
 // Require a material improvement before abandoning an established opponent.
 const incumbent=ranked.find(r=>r.name===context.currentOpponent);
 if(incumbent&&ranked[0]!==incumbent&&incumbent.score>0&&incumbent.samples>=3&&ranked[0].score<incumbent.score*1.15)
  ranked=[incumbent,...ranked.filter(r=>r!==incumbent)];
 const finish=(rows,source)=>({goal,source,trial:!!rows[0]?.trial,ranked:rows.map(r=>{
  const size=fixed||r.trial?r.size:chooseGoBoardSize(r.name,buckets,cheats,true,now);
  return {...r,comparisonSize:r.size,size,boardTrial:size!==r.size};
 })});
 if(options.opponent)return finish(ranked.filter(r=>r.name===options.opponent),'explicit opponent');
 if(context.protectStreak) {
  ranked.sort((a,b)=>Number(b.name==='Illuminati')-Number(a.name==='Illuminati'));
  return finish(ranked,'achievement streak');
 }
 const completed=goOpponents.reduce((sum,name)=>{
  const s=stats[name]||{};
  return sum+['wins','losses'].reduce((n,key)=>n+(Number.isSafeInteger(Number(s[key]))&&Number(s[key])>=0?Number(s[key]):0),0);
 },0);
 // One opponent trial per eight completed native games, independent of capped recent histories.
 // Board trials stay with the existing board policy; opponent trials use its established board.
 if(completed%8===3) {
  const candidates=ranked.filter(r=>r.weight>=2&&r.name!==ranked[0]?.name).map(r=>{
   const size=fixed?r.size:chooseGoBoardSize(r.name,buckets,cheats,false,now);
   return {...r,size,...recentResults(r.name,size,buckets,cheats,now)};
  }).filter(r=>r.samples<3).sort((a,b)=>a.samples-b.samples||b.weight-a.weight||a.measuredAt-b.measuredAt||a.name.localeCompare(b.name));
  const trial=candidates[0];
  if(trial){trial.trial=true;ranked=[trial,...ranked.filter(r=>r.name!==trial.name)];}
 }
 return finish(ranked,adaptive?(mapping[context.bottleneck]?context.source||'progression bottleneck':'BitNode fallback'):'explicit goal');
}
