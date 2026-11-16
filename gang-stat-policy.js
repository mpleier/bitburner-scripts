import {gangFundingETA} from './gang-funding-diagnostics-policy.js';
const trainingNames=['Train Combat','Train Hacking','Train Charisma'];
/** Skill priority can defer the development shopping list, but never an unmet cash reserve.
 *  power-training-always keeps combat training after safe warfare readiness; the
 *  caller suppresses it while an augmentation/recruitment goal is active. */
export function gangStatPriorityAllowed({preparation,funding,members,options={},now=Date.now()}){
 const active=preparation?.active===true||options['power-training-always']===true;
 return preparation?.enabled===true&&preparation.known===true&&active&&members===12&&
  !options['disable-adaptive-growth']&&!options['no-training']&&!options['money-focus']&&!options['reputation-focus']&&
  funding?.known===true&&[funding.at,funding.expiresAt,funding.cash,funding.reserveShortfall,now].every(Number.isFinite)&&
  funding.at<=now&&now-funding.at<=30000&&funding.expiresAt>now&&funding.cash>=0&&funding.reserveShortfall===0;
}
/** Native skill points per game second, not raw XP; a fixed short quote bounds work. */
export function gangStatTaskRate(member,task,project){
 if(!member||!task||typeof project!=='function')return 0;
 const keys=['hack','str','def','dex','agi','cha'];if(keys.some(k=>!Number.isFinite(member[k])||member[k]<1))return 0;
 const next=project(member,task,60);if(keys.some(k=>!Number.isFinite(next[k])||next[k]<1))return 0;
 return keys.reduce((sum,k)=>sum+Math.max(0,next[k]-member[k]),0)/60;
}
/** Retain one efficient cash producer so funded stat training does not idle the whole economy. */
export function gangStatFundingAnchor(rates,protectedNames=[],wantedTolerance=0){
 const blocked=new Set(protectedNames),choices=[];
 for(const [name,rows]of Object.entries(rates)){
  if(blocked.has(name)||!Array.isArray(rows))continue;
  const bestStat=Math.max(0,...rows.map(r=>Number.isFinite(r.stats)?r.stats:0));
  for(const r of rows)if(!r.name.startsWith('Train ')&&r.name!=='Territory Warfare'&&Number.isFinite(r.money)&&r.money>0&&Number.isFinite(r.wanted)&&r.wanted<=Math.max(0,wantedTolerance))choices.push({name,task:r.name,score:r.money/(1+Math.max(0,bestStat-(r.stats||0)))});
 }
 return choices.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)||a.task.localeCompare(b.task))[0]??null;
}
/** Compare native skill points, including gear/ascension XP multipliers, rather than raw XP. */
export function chooseGangStatTraining(member,tasks,seconds,project,fallback='Train Combat'){
 if(!member||!Number.isFinite(seconds)||seconds<=0||typeof project!=='function')return fallback;
 const keys=['hack','str','def','dex','agi','cha'];let best=fallback,gain=-Infinity;
 for(const name of trainingNames){
  if(!tasks?.[name])continue;
  const next=project(member,tasks[name],seconds),value=keys.reduce((sum,k)=>sum+Math.max(0,next[k]-member[k]),0);
  if(Number.isFinite(value)&&(value>gain||value===gain&&name===fallback)){gain=value;best=name;}
 }
 return best;
}

/** Three fixed phases are replayed inside the original burst deadline; never extend it on a switch. */
export function gangTrainingScheduleTask(episode,now=Date.now()){
 if(!episode?.mixedTraining||!Array.isArray(episode.trainingSchedule)||!Number.isFinite(episode.startedAt)||!Number.isFinite(episode.until)||now<episode.startedAt||now>=episode.until)return null;
 const duration=(episode.until-episode.startedAt)/1000,rows=episode.trainingSchedule;
 if(!rows.length||rows.length>3||rows.some((r,i)=>!r||!trainingNames.includes(r.task)||!Number.isFinite(r.until)||r.until<=0||r.until>duration+.001||i>0&&r.until<=rows[i-1].until)||Math.abs(rows.at(-1).until-duration)>.001)return null;
 return rows.find(r=>now<episode.startedAt+r.until*1000)?.task??null;
}

/** Preserve actual remaining work when another member's development is evaluated. */
export function gangCommittedTraining(episodes,members,lastReset,now=Date.now()){
 return Object.entries(episodes||{}).flatMap(([name,e])=>{
  if(!members?.[name]||!e||e.resetAt!==(lastReset[name]??0)||!Number.isFinite(e.startedAt)||!Number.isFinite(e.until)||e.startedAt>now||e.until<=now||e.until-e.startedAt>900000||!trainingNames.includes(e.task))return [];
  const window=(e.until-now)/1000;
  const schedule=e.mixedTraining&&gangTrainingScheduleTask(e,now)?e.trainingSchedule.filter(r=>e.startedAt+r.until*1000>now).map(r=>({task:r.task,until:(e.startedAt+r.until*1000-now)/1000})):null;
  return [{name,window,trainingTask:gangTrainingScheduleTask(e,now)||e.task,...(schedule?{trainingSchedule:schedule,mixedTraining:true}: {})}];
 });
}

/** Income is permitted strictly above ninety percent territory; unknown is locked. */
export function gangMoneyAllowed(gang) {
 return Number.isFinite(gang?.territory)&&gang.territory>.9&&gang.territory<=1;
}
export function gangTerritoryDevelopmentFocus(gang,members,desired,options={}) {
 if(gangMoneyAllowed(gang))return desired;
 return members<12||options['no-training']||options['disable-adaptive-growth']||options['reputation-focus']?'respect':'stats';
}
/** Compact territory history: keep roughly one sample per five minutes so a trend spans about an
 *  hour without growing the save. Samples are appended by the controller once per planning pass. */
export function gangTerritoryTrend(samples,now,{maxSamples=12,minGapMs=300000}={}) {
 const empty={samples:[],pointsPerHour:null,spanMs:0,flatMs:null};
 if(!Number.isFinite(now)||!Array.isArray(samples))return empty;
 const valid=samples.filter(s=>s&&Number.isFinite(s.at)&&s.at<=now&&Number.isFinite(s.territory)&&s.territory>=0&&s.territory<=1)
  .sort((a,b)=>a.at-b.at);
 // One sample per bucket keeps the spacing after thinning: the newest value inside each five-minute
 // window wins, so a rise or fall inside the bucket is not lost and the series stays ordered.
 const buckets=new Map();
 for(const sample of valid)buckets.set(Math.floor(sample.at/minGapMs),{at:sample.at,territory:sample.territory});
 const bounded=[...buckets.entries()].sort((a,b)=>a[0]-b[0]).map(([,sample])=>sample).slice(-Math.max(2,Math.floor(maxSamples)));
 if(!bounded.length)return empty;
 const first=bounded[0],last=bounded[bounded.length-1],spanMs=last.at-first.at;
 const pointsPerHour=spanMs>0?(last.territory-first.territory)/(spanMs/3600000):null;
 // Flat time starts at the newest sample that still differs from the current territory.
 let changedAt=bounded[bounded.length-1].at;
 for(const sample of bounded)if(sample.territory!==last.territory)changedAt=sample.at;
 return {samples:bounded,pointsPerHour,spanMs,flatMs:now-changedAt};
}
/** The `gangMoneyAllowed` gate is a hard constant, which is right while territory compounds: income
 *  scales with territory^1.5 and a territory penalty exponent, so ninety percent is worth roughly
 *  fifty times the income at a quarter of the city. It is wrong when that state cannot arrive before
 *  the committed route ends, or when territory has stopped moving inside a full planning window —
 *  then the run forgoes every gang pay-out for a gate it will never reach. Release a bounded money
 *  focus only on those two measured conditions. */
export function gangIncomeEscape({territory,trend,routeRemainingMs=null,now=Date.now()}={}) {
 if(!Number.isFinite(territory))return {allowed:false,reason:'Territory unknown'};
 if(territory>.9)return {allowed:false,reason:'Income already unlocked'};
 const flatMs=Number.isFinite(trend?.flatMs)?trend.flatMs:null;
 if(flatMs!==null&&flatMs>=1800000)return {allowed:true,reason:'Territory flat for '+(flatMs/60000).toFixed(0)+' minutes',flatMinutes:flatMs/60000};
 if(!(Number.isFinite(trend?.spanMs)&&trend.spanMs>=600000))return {allowed:false,reason:'Territory trend is too short'};
 const rate=trend.pointsPerHour;
 if(!(Number.isFinite(rate)&&rate>0))return {allowed:true,reason:'Territory is not growing',pointsPerHour:rate??null};
 if(!(Number.isFinite(routeRemainingMs)&&routeRemainingMs>0))return {allowed:false,reason:'Route horizon unknown',pointsPerHour:rate};
 const projectedMs=(0.9-territory)/(rate/3600000);
 if(projectedMs>routeRemainingMs)return {allowed:true,reason:'The 90% gate is beyond the remaining route horizon',projectedHours:projectedMs/3600000,pointsPerHour:rate};
 return {allowed:false,reason:'The 90% gate is reachable inside the route horizon',projectedHours:projectedMs/3600000,pointsPerHour:rate};
}

/** Keep a reputation producer available for recruitment and ascension continuity.
 * Money is deliberately excluded from this ranking. */
export function gangStatReputationAnchor(rates,protectedNames=[],wantedTolerance=0){
 const blocked=new Set(protectedNames),choices=[];
 for(const [name,rows]of Object.entries(rates)){
  if(blocked.has(name)||!Array.isArray(rows))continue;
  const bestStat=Math.max(0,...rows.map(r=>Number.isFinite(r.stats)?r.stats:0));
  for(const r of rows)if(!r.name.startsWith('Train ')&&r.name!=='Territory Warfare'&&Number.isFinite(r.respect)&&r.respect>0&&Number.isFinite(r.wanted)&&r.wanted<=Math.max(0,wantedTolerance))choices.push({name,task:r.name,score:r.respect/(1+Math.max(0,bestStat-(r.stats||0)))});
 }
 return choices.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)||a.task.localeCompare(b.task))[0]??null;
}

/** Reserve at most two optional trainees for respect and wanted recovery.
 * Rates use native gang cycles. Prefer clearing the existing penalty over
 * roughly 120 game seconds; accept slower recovery if one reducer cannot do so. */
export function gangStatSupportCrew(rates,gang,protectedNames=[],wantedTolerance=0,threshold=.01){
 const blocked=new Set(protectedNames),members=Object.entries(rates).filter(([n,rows])=>!blocked.has(n)&&Array.isArray(rows));
 const respect=gang?.respect,wanted=gang?.wantedLevel;
 const recovering=Number.isFinite(respect)&&Number.isFinite(wanted)&&wanted>1&&wanted/(Math.max(0,respect)+wanted)>threshold;
 const target=recovering?-Math.max(1e-9,(wanted-Math.max(1,respect*threshold/(1-threshold)))/600):Math.max(0,wantedTolerance);
 const loss=(rows,r)=>Math.max(0,Math.max(0,...rows.map(t=>Number.isFinite(t.stats)?t.stats:0))-(r.stats||0));
 const valid=r=>typeof r.name==='string'&&Number.isFinite(r.wanted)&&Number.isFinite(r.respect);
 const candidates=[],reducers=[];
 for(const [name,rows]of members){
  for(const row of rows.filter(valid)){
   if(row.wanted<0)reducers.push({name,row,cost:loss(rows,row)});
   if(row.respect<=0||row.name.startsWith('Train ')||row.name==='Territory Warfare')continue;
   if(!recovering&&row.wanted<=target)candidates.push({assignments:{[name]:row.name},respect:row.respect,wanted:row.wanted,cost:loss(rows,row)});
   for(const [other,otherRows]of members){
    if(other===name)continue;
    for(const justice of otherRows.filter(r=>valid(r)&&r.wanted<0)){
     const net=row.wanted+justice.wanted;
     if(recovering?net>=0:net>target)continue;
     candidates.push({assignments:{[name]:row.name,[other]:justice.name},respect:row.respect+justice.respect,wanted:net,cost:loss(rows,row)+loss(otherRows,justice)});
    }
   }
  }
 }
 candidates.sort((a,b)=>Number(b.wanted<=target)-Number(a.wanted<=target)||b.respect/(1+b.cost)-a.respect/(1+a.cost)||a.wanted-b.wanted||JSON.stringify(a.assignments).localeCompare(JSON.stringify(b.assignments)));
 let best=candidates[0];
 if(!best&&recovering){
  reducers.sort((a,b)=>-b.row.wanted/(1+b.cost)-(-a.row.wanted/(1+a.cost))||a.name.localeCompare(b.name));
  const r=reducers[0];if(r)best={assignments:{[r.name]:r.row.name},respect:r.row.respect,wanted:r.row.wanted,cost:r.cost};
 }
 return best?{...best,recovering,target}:null;
}

/** Compare one optional worker against actual assignments and a reviewed cash-only gap. */
export function gangEarlyFundingAnchor(rates,funding,protectedNames=[],now=Date.now(),assignments={},timing={}){
 const q=funding?.early;
 if(!funding?.known||q?.reviewed!==true||![funding.at,funding.expiresAt,q.cash,q.target,funding.externalCashRate,now].every(Number.isFinite)||funding.at>now||now-funding.at>30000||funding.expiresAt<=now||Math.min(q.cash,q.target,funding.externalCashRate)<0)return null;
 const gap=q.target-q.cash;if(gap<=0||q.blocker==='shared-budget')return null;
 const entries=Object.entries(rates||{});if(entries.length<4)return null;
 const current={};
 for(const [name,rows]of entries){const r=rows.find(r=>r.name===assignments[name]);if(!r||!['money','respect','wanted'].every(k=>Number.isFinite(r[k]))||r.money<0||r.respect<0)return null;current[name]=r;}
 const totalRespect=Object.values(current).reduce((n,r)=>n+r.respect,0);
 const fractions=n=>timing.fractions?.[n]??{normal:1,bonus:1};
 const income=kind=>entries.reduce((sum,[n])=>sum+current[n].money*5*fractions(n)[kind],0);
 const normal=income('normal'),bonus=income('bonus'),pool=timing.bonusSeconds??0;
 const before=gangFundingETA(gap,normal,bonus,funding.externalCashRate,pool);if(before<=120)return null;
 const blocked=new Set(protectedNames),choices=[];
 for(const [name,rows]of entries){
  if(blocked.has(name))continue;
  const base=current[name];
  for(const r of rows){
   const loss=Math.max(0,base.respect-r.respect),gain=(r.money-base.money)*5,statLoss=Math.max(0,(base.stats||0)-(r.stats||0));
   if(typeof r.name!=='string'||r.name.startsWith('Train ')||r.name==='Territory Warfare'||!['money','respect','wanted'].every(k=>Number.isFinite(r[k]))||r.respect<0||gain<=0||r.wanted>Math.min(0,base.wanted)||loss>totalRespect*.25)continue;
   const f=fractions(name),after=gangFundingETA(gap,normal+gain*f.normal,bonus+gain*f.bonus,funding.externalCashRate,pool),saved=before-after;
   if(after>900||saved<Math.max(20,Number.isFinite(before)?before*.05:20))continue;
   choices.push({name,task:r.name,gap,incomeGain:gain,beforeSeconds:Number.isFinite(before)?before:null,afterSeconds:after,respectLoss:loss,statLoss,score:(Number.isFinite(before)?Math.min(900,saved):900-after)/(1+loss+statLoss)});
  }
 }
 return choices.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)||a.task.localeCompare(b.task))[0]??null;
}

