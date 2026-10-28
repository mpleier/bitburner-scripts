const trainingNames=['Train Combat','Train Hacking','Train Charisma'];
/** Skill priority can defer the development shopping list, but never an unmet cash reserve. */
export function gangStatPriorityAllowed({preparation,funding,members,options={},now=Date.now()}){
 return preparation?.enabled===true&&preparation.known===true&&preparation.active===true&&members===12&&
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
