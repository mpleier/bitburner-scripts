/** Readiness is observed separately from rank: jumps favor waiting, falling chances reset evidence. */
export function observeBbStatReadiness(previous,{target,nodeReset,augReset,city,chance,threshold,at,rankEtaMs}){
 const scope=JSON.stringify([target,nodeReset,augReset,city]);
 const valid=typeof target==='string'&&target&&[nodeReset,augReset,at,threshold].every(Number.isFinite)&&Array.isArray(chance)&&chance.length===2&&chance.every(p=>Number.isFinite(p)&&p>=0&&p<=1)&&chance[0]<=chance[1]&&chance[1]-chance[0]<=.01;
 if(!valid)return {scope,samples:[],statEtaMs:null,statStalled:false};
 let samples=previous?.scope===scope&&Array.isArray(previous.samples)?previous.samples.filter(s=>Number.isFinite(s.at)&&s.at<=at&&at-s.at<=180000&&Number.isFinite(s.p)&&s.p>=0&&s.p<=1):[];
 if(samples.length&&(at-samples.at(-1).at>45000||chance[0]<samples.at(-1).p-.001))samples=[];
 if(!samples.length||at>samples.at(-1).at)samples.push({at,p:chance[0]});samples=samples.slice(-90);
 const known=samples.length>=3&&at-samples[0].at>=30000;
 let rate=0;for(let i=1;i<samples.length;i++)if(samples[i].at>samples[i-1].at)rate=Math.max(rate,(samples[i].p-samples[i-1].p)/(samples[i].at-samples[i-1].at));
 const statEtaMs=known&&rate>0?Math.max(0,threshold-chance[0])/rate:null,statStalled=known&&rate===0&&chance[1]<threshold;
 const preparingStats=chance[1]<threshold&&Number.isFinite(rankEtaMs)&&rankEtaMs>0&&rankEtaMs<=900000&&(statStalled||Number.isFinite(statEtaMs)&&statEtaMs>rankEtaMs);
 return {scope,samples,statEtaMs,statStalled,preparingStats:!!preparingStats};
}

/** Mission XP/rank continues with installed Simulacrum; compare only incremental conditioning. */
export function chooseParallelCombatTraining(quotes,{simulacrum=false,remainingMs,quotaLeft,money,reserve,localCity}={}){
 if(!simulacrum||![remainingMs,quotaLeft,money,reserve].every(Number.isFinite)||remainingMs<1000||quotaLeft<=0||money<0||reserve<0)return null;
 const maxMs=Math.min(30000,remainingMs,quotaLeft*30000),available=Math.max(0,money-reserve);let best=null;
 const local=Math.max(0,...(quotes||[]).filter(q=>!q.travelCost&&q.score>0).map(q=>q.score));
 for(const q of quotes||[]){
  if(!q||!['crime','gym'].includes(q.kind)||![q.score,q.time,q.costPerSecond].every(Number.isFinite)||q.score<=0||q.time<=0||q.costPerSecond<0||q.kind==='crime'&&q.time>5000)continue;
  const travel=q.travelCost??0,travelMs=q.travelMs??0;if(![travel,travelMs].every(Number.isFinite)||travel<0||travelMs<0||travel>0&&q.city===localCity)continue;
  const usable=maxMs-travelMs,durationMs=q.kind==='crime'?Math.floor(usable/q.time)*q.time:Math.floor(usable/1000)*1000;
  const cost=travel+q.costPerSecond*(durationMs/1000+1),gain=q.score*durationMs/1000;
  if(durationMs<1000||cost>available*.01||travel>0&&gain<=local*maxMs/1000*1.1)continue;
  if(!best||gain>best.projectedGain)best={...q,durationMs,cost,projectedGain:gain,baselineGain:0,foregoneRank:0,parallelMission:true};
 }
 return best;
}

/** Native mutation rechecks the complete session cost and refuses to discard an invested crime. */
export function startSleeveCombatGym(ns,index,q,reserve){
 if(!q||!['strength','defense','dexterity','agility'].includes(q.stat)||typeof q.city!=='string'||typeof q.gym!=='string'||![q.cost,reserve].every(Number.isFinite)||q.cost<0||reserve<0)return false;
 const s=ns.sleeve.getSleeve(index),t=ns.sleeve.getTask(index),credit=q.completionCredit,now=Date.now();
 const completed=credit&&t?.type==='CRIME'&&Number.isFinite(credit.at)&&credit.at<=now&&now-credit.at<=2000&&credit.crimeType===t?.crimeType&&Number.isFinite(credit.tasksCompleted)&&credit.tasksCompleted>=1&&t?.tasksCompleted>=credit.tasksCompleted;
 if(s.shock!==0||s.sync!==100||t?.type==='CRIME'&&t.cyclesWorked>0&&t.cyclesWorked<t.cyclesNeeded&&!completed)return false;
 const travel=s.city===q.city?0:200000,total=travel+q.cost*31,cash=ns.getPlayer().money-Math.max(reserve,Number(ns.read('reserve.txt'))||0);
 if(!Number.isFinite(cash)||total>cash||travel&&total>cash*.01||travel&&s.city!==q.fromCity)return false;
 if(travel&&!ns.sleeve.travel(index,q.city))return false;
 return ns.sleeve.setToGymWorkout(index,q.gym,q.gymType);
}

/** Count only bounded, live, native-confirmed gym commitments; no assumed 15-minute sessions. */
export function committedSleeveGymSeconds(ns,plan,now=Date.now()){
 const r=ns.getResetInfo();if(!plan||plan.nodeReset!==r.lastNodeReset||plan.augReset!==r.lastAugReset||!ns.isRunning(plan.ownerPid)||!Number.isFinite(plan.at)||plan.at>now||now-plan.at>3000)return 0;
 let seconds=0;for(const [key,q]of Object.entries(plan.commitments||{}).slice(0,8)){
  const i=Number(key);if(!Number.isInteger(i)||i<0||i>=8||!q||!Number.isFinite(q.until)||q.until<=now||q.until>now+30000)continue;
  const s=ns.sleeve.getSleeve(i),t=ns.sleeve.getTask(i);
  if(s.shock===0&&s.sync===100&&t?.type==='CLASS'&&t.location===q.gym&&t.classType===q.gymType)seconds+=(q.until-now)/1000;
 }
 // Legacy train-to targets also retain upgrades, using native XP/time remaining.
 for(const [key,q]of Object.entries(plan.targets||{}).slice(0,8))try{
  const i=Number(key);if(!Number.isInteger(i)||i<0||i>=8||plan.commitments?.[key]?.until>now||!q||!['strength','defense','dexterity','agility'].includes(q.stat)||!Number.isFinite(q.target)||q.target<=1)continue;
  const s=ns.sleeve.getSleeve(i),t=ns.sleeve.getTask(i),xp=s.exp?.[q.stat],level=s.skills?.[q.stat];
  if(s.shock!==0||s.sync!==100||t?.type!=='CLASS'||t.location!==q.gym||t.classType!==q.gymType||![xp,level].every(Number.isFinite)||xp<0||level<=1||level>=q.target||!ns.fileExists('Formulas.exe','home'))continue;
  const base=32*Math.log(xp+534.6)-200;if(!(base>0))continue;
  const mult=(level+.5)/base,needed=Math.exp((q.target/mult+200)/32)-534.6-xp,g=ns.formulas.work.gymGains(s,q.gymType,q.gym),keyExp={strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp'}[q.stat],rate=5*g[keyExp];
  if(Number.isFinite(needed)&&needed>0&&Number.isFinite(rate)&&rate>0)seconds+=Math.min(30,needed/rate);
 }catch{}
 try{
  const p=JSON.parse(ns.read('tasks/player-gym-plan.json')),w=ns.singularity.getCurrentWork();
  if(p.nodeReset===r.lastNodeReset&&p.augReset===r.lastAugReset&&ns.isRunning(p.ownerPid)&&ns.isRunning(p.parent)&&Number.isFinite(p.until)&&p.until>now&&p.until<=now+30000&&w?.type==='CLASS'&&w.location===p.gym&&w.classType===p.gymType)seconds+=(p.until-now)/1000;
 }catch{}
 return seconds;
}
