const trainingNames=['Train Combat','Train Hacking','Train Charisma'];
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
