import { sleeveCrimeChance } from './sleeve-policy.js';

/** Native failed crimes still award one quarter XP; shock and sync apply to transferred XP. */
export function sleeveCombatCrime(sleeve, crimes, nodeMultiplier = 1, context = null) {
  let best = null;
  for (const [name, stats] of Object.entries(crimes)) {
    if (!(stats.time > 0) || !Number.isFinite(stats.time)) continue;
    const chance = sleeveCrimeChance(sleeve, stats, nodeMultiplier);
    const targeted = context?.metadata?.weights && context?.metadata?.decays && context?.player?.exp && context?.player?.skills;
    const statsToScore = targeted ? ['hacking','strength','defense','dexterity','agility','charisma'] : ['strength','defense','dexterity','agility'];
    const sensitivity = stat => {
      if (!targeted) return 1;
      const weight=context.metadata.weights[stat],decay=context.metadata.decays[stat],xp=context.player.exp[stat],skill=context.player.skills[stat];
      const levelMult=Number(context.player.mults?.[stat]??1)*Number(context.levelMultipliers?.[stat]??1);
      if (![weight,decay,xp,skill,levelMult].every(Number.isFinite) || weight<=0 || decay<=0 || xp<0 || skill<=0 || levelMult<=0) return 0;
      return weight*decay*Math.pow(skill,decay-1)*32*levelMult/(xp+534.6);
    };
    const exp = statsToScore.reduce((sum, stat) =>
      sum + Math.max(0, Number(stats[stat + '_exp']) || 0) * Math.max(0, Number(sleeve.mults?.[stat + '_exp'] ?? 1) || 0)*sensitivity(stat), 0);
    const rate = exp * Math.max(0,Number(context?.crimeExpMultiplier??1)) * (.25 + .75 * chance) / (stats.time / 1000) *
      Math.max(0, 1 - (Number(sleeve.shock) || 0) / 100) * Math.max(0, Math.min(100, Number(sleeve.sync) || 0)) / 100;
    if (Number.isFinite(rate) && rate > (best?.rate || 0)) best = { name, rate, metric: targeted ? 'estimated-competence-per-second' : 'combat-xp-per-second' };
  }
  return best;
}

export function sleeveDevelopmentActive(record, reset, processes, now = Date.now()) {
  return !!(record?.chanceBlocked === true && typeof record.target === 'string' &&
    record.nodeReset === reset.lastNodeReset && record.augReset === reset.lastAugReset &&
    Number.isFinite(record.at) && record.at <= now && now - record.at < 30000 &&
    processes.some(p => p.pid === record.pid && p.filename.replace(/^\//, '') === 'bladeburner.js'));
}

/** Borrow at most one moderately shocked sleeve; keep the others recovering toward augmentation access. */
export function sleeveCombatWorker(sleeves, crimes, tasks = [], nodeMultiplier = 1, context = null) {
  const candidates = sleeves.map((s, index) => ({ index, shock: s.shock, sync: s.sync,
    ...sleeveCombatCrime(s, crimes, nodeMultiplier, context) })).filter(s => s.shock > 0 && s.shock <= 50 && s.sync >= 100 && s.rate > 0);
  candidates.sort((a,b) => b.rate - a.rate || a.index - b.index);
  const best = candidates[0];
  if (!best) return null;
  // Native crime XP is paid at completion. Preserve invested work even when another crime becomes optimal.
  for (const candidate of candidates) {
    const task = tasks[candidate.index];
    if (task?.type !== 'CRIME' || !Number.isFinite(task.cyclesWorked) || !Number.isFinite(task.cyclesNeeded) ||
        task.cyclesWorked <= 0 || task.cyclesNeeded <= 0 || task.cyclesWorked > task.cyclesNeeded || !crimes[task.crimeType]) continue;
    const current = sleeveCombatCrime(sleeves[candidate.index], { [task.crimeType]: crimes[task.crimeType] }, nodeMultiplier, context);
    if (current?.rate > 0) return { ...candidate, ...current, completingCrime: true };
  }
  return candidates.find(s => tasks[s.index]?.type === 'CRIME'  && tasks[s.index]?.crimeType === s.name && s.rate >= best.rate * .95) || best;
}

/** Observe recovery instead of assuming a game speed or a fixed shock decay constant. */
export function sleeveRecoveryObservation(previous,sleeves,tasks,now,reset,pid) {
 const valid=previous?.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.pid===pid&&now>previous.at&&now-previous.at<=60000;
 const seconds=valid?(now-previous.at)/1000:0;
 return {at:now,pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,sleeves:sleeves.map((s,i)=>{
  const old=valid?previous.sleeves?.[i]:null;
  const recovering=tasks[i]?.type==='RECOVERY';
  const measured=old?.recovering&&recovering&&seconds>0?(old.shock-s.shock)/seconds:0;
  const measuredAt=measured>0?now:old?.measuredAt;
  const rate=measured>0?measured:old?.rate>0&&Number.isFinite(measuredAt)&&now-measuredAt<=300000?old.rate:null;
  return {shock:s.shock,recovering,rate,measuredAt:rate>0?measuredAt:null};
 })};
}

/** Compare immediate combat output with recovery-first output over a bounded horizon.
 * Preserve the sleeve nearest augmentation access. Unknown recovery speed retains the one-worker fallback. */
export function sleeveCombatWorkers(sleeves,crimes,tasks=[],nodeMultiplier=1,context=null,observation=null,horizonSeconds=900,augmentationPlan={},completionHolds={}) {
 const fallback=sleeveCombatWorker(sleeves,crimes,tasks,nodeMultiplier,context);
 if(!fallback)return [];
 if(!(Number.isFinite(horizonSeconds)&&horizonSeconds>0))return [fallback];
 const candidates=sleeves.map((s,index)=>({index,shock:s.shock,sync:s.sync,...sleeveCombatCrime(s,crimes,nodeMultiplier,context)}))
  .filter(s=>s.shock>0&&s.shock<=50&&s.sync>=100&&s.rate>0);
 const nearest=candidates.slice().sort((a,b)=>a.shock-b.shock||a.index-b.index)[0]?.index;
 const workers=[];
 for(const candidate of candidates){
  const measured=observation?.sleeves?.[candidate.index]?.rate;
  const task=tasks[candidate.index];
  const invested=task?.type==='CRIME'&&Number.isFinite(task.cyclesWorked)&&Number.isFinite(task.cyclesNeeded)&&task.cyclesWorked>0&&task.cyclesNeeded>0&&task.cyclesWorked<=task.cyclesNeeded&&!!crimes[task.crimeType];
  const finishPending=()=>{
   if(!invested){delete completionHolds[candidate.index];return false;}
   const previous=completionHolds[candidate.index];
   const completed=previous?.crimeType===task.crimeType&&(
    Number.isFinite(previous.tasksCompleted)&&Number.isFinite(task.tasksCompleted)&&previous.tasksCompleted!==task.tasksCompleted||
    Number.isFinite(previous.cyclesWorked)&&task.cyclesWorked<previous.cyclesWorked);
   if(completed){delete completionHolds[candidate.index];return false;}
   completionHolds[candidate.index]={crimeType:task.crimeType,tasksCompleted:task.tasksCompleted,cyclesWorked:task.cyclesWorked};return true;
  };
  const single=()=>sleeveCombatWorker(sleeves.map((s,i)=>i===candidate.index?s:{...s,shock:100}),crimes,tasks,nodeMultiplier,context);
  if(!(Number.isFinite(measured)&&measured>0)||candidate.index===nearest){
   if(finishPending())workers.push({...single(),finishingBeforeRecovery:true});
   continue;
  }
  const recoverySeconds=candidate.shock/measured;
  const immediate=candidate.rate*horizonSeconds;
  const recovered=Math.max(candidate.rate/(1-candidate.shock/100)*Math.max(0,horizonSeconds-recoverySeconds),augmentationPlan[candidate.index]?.output||0);
  if(immediate<=recovered*1.1){if(finishPending())workers.push({...single(),finishingBeforeRecovery:true});continue;}
  // Use the existing single-worker selector to preserve a crime already nearing completion.
  delete completionHolds[candidate.index];
  workers.push({...single(),recoverySeconds,immediateOutput:immediate,recoveryFirstOutput:recovered});
 }
 return workers.length?workers:observation?.sleeves?.some(s=>s.rate>0)?[]:[fallback];
}

/** Conservative post-install XP projection: native sleeve installation erases its accumulated XP. */
export function sleeveAugmentedOutput(sleeve,stats,crimes,seconds,nodeMultiplier=1,context=null,resetXp=true,objective='xp') {
 const clone={...sleeve,shock:0,skills:{...sleeve.skills},exp:{...sleeve.exp},mults:{...sleeve.mults}};
 const keys=['hacking','strength','defense','dexterity','agility','charisma'];
 for(const key of Object.keys(stats))if(Number.isFinite(stats[key])&&stats[key]>0)clone.mults[key]=(clone.mults[key]??1)*stats[key];
 for(const key of keys){if(resetXp){clone.exp[key]=0;clone.skills[key]=Math.max(1,Math.floor((32*Math.log(534.6)-200)*(clone.mults[key]??1)*(context?.levelMultipliers?.[key]??1)));}else clone.exp[key]=Math.max(0,clone.exp[key]||0);}
 let total=0,left=Math.min(900,Math.max(0,seconds));
 while(left>0){
  const choices=Object.fromEntries(Object.entries(crimes).filter(([,c])=>c&&Number.isFinite(c.time)&&c.time>0&&c.time<=left*1000));
  let best;
  if(objective==='xp')best=sleeveCombatCrime(clone,choices,nodeMultiplier,context);
  else for(const [name,c]of Object.entries(choices)){
   const amount=Math.max(0,c[objective]||0)*(objective==='money'?(clone.mults.crime_money??1)*(context?.crimeMoneyMultiplier??1):1)*Math.max(0,Math.min(1,(clone.sync??100)/100));
   const rate=sleeveCrimeChance(clone,c,nodeMultiplier)*amount/(c.time/1000);
   if(rate>(best?.rate||0))best={name,rate};
  }
  if(!best)break;
  const crime=choices[best.name],step=Math.min(left,Math.max(30,crime.time/1000)),incomingSeconds=Math.max(0,Math.min(step,(context?.externalXpSeconds??0)-(Math.min(900,Math.max(0,seconds))-left)));
  const paid=Math.floor(step/(crime.time/1000))*(crime.time/1000),chance=sleeveCrimeChance(clone,crime,nodeMultiplier);
  total+=best.rate*paid;
  for(const key of keys){
   clone.exp[key]+=Math.max(0,Number(context?.externalXpPerSecond?.[key])||0)*incomingSeconds+Math.max(0,crime[key+'_exp']||0)*(clone.mults[key+'_exp']??1)*(.25+.75*chance)*paid/(crime.time/1000)*Math.max(0,context?.crimeExpMultiplier??1);
   clone.skills[key]=Math.max(1,Math.floor((32*Math.log(clone.exp[key]+534.6)-200)*(clone.mults[key]??1)*(context?.levelMultipliers?.[key]??1)));
  }
  left-=step;
 }
 return total;
}

/** Allocate one shared affordable augmentation budget, never the same cash once per sleeve. */
export function sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,budget,nodeMultiplier=1,context=null,horizon=900,options={}) {
 if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(horizon)||horizon<=0)return {};
 const candidates=[];
 for(let i=0;i<sleeves.length;i++){
  const sleeve=sleeves[i],rate=observation?.sleeves?.[i]?.rate;
  if(!(sleeve.shock>0&&rate>0))continue;
  const recoverySeconds=Math.max(sleeve.shock/rate,Math.max(0,options.cooldowns?.[i]||0)),remaining=Math.max(0,horizon-recoverySeconds);
  if(remaining<=0)continue;
  const sorted=(offers?.[i]||[]).filter(a=>typeof a.name==='string'&&Number.isFinite(a.cost)&&a.cost>0).slice().sort((a,b)=>a.cost-b.cost);
  let cost=0;const batch=[];
  for(const aug of sorted){if(cost+aug.cost>budget)break;cost+=aug.cost;batch.push(aug);}
  if(!batch.length||batch.length<Math.min(options.minBatch??1,Math.max(1,sorted.length-1)))continue;
  // Unknown stats disable the projected purchase benefit rather than inventing multiplier gains.
  if(batch.some(a=>!a.stats))continue;
  const stats={};for(const aug of batch)for(const [key,mult]of Object.entries(aug.stats))if(Number.isFinite(mult)&&mult>0)stats[key]=(stats[key]??1)*mult;
  const output=sleeveAugmentedOutput(sleeve,stats,crimes,remaining,nodeMultiplier,context);
  const base=sleeveCombatCrime({...sleeve,shock:0},crimes,nodeMultiplier,context)?.rate||0;
  const extra=output-base*remaining;
  if(extra>0)candidates.push({index:i,cost,names:batch.map(a=>a.name),output,recoverySeconds,extra,resetXp:true});
 }
 candidates.sort((a,b)=>b.extra/b.cost-a.extra/a.cost||a.recoverySeconds-b.recoverySeconds);
 const plan={};let remaining=budget;
 for(const candidate of candidates)if(candidate.cost<=remaining){plan[candidate.index]=candidate;remaining-=candidate.cost;}
 return plan;
}

/** Price an actual batch against doing the same work without erasing existing sleeve XP. */
export function planSleeveAugPurchase({sleeve,offers,budget,crimes={},objective='xp',context=null,nodeMultiplier=1,horizon=900,minBatch=1,manual=false,workForecast=null}) {
 const invalid={names:[],cost:0,reason:'No affordable beneficial augmentation batch'};
 if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(horizon)||horizon<=0)return invalid;
 horizon=Math.min(900,horizon);
 const available=(offers||[]).filter(a=>typeof a.name==='string'&&Number.isFinite(a.cost)&&a.cost>0).slice().sort((a,b)=>a.cost-b.cost);
 const minimum=Math.min(minBatch,Math.max(1,available.length-1));
 if(manual){let cost=0;const names=[];for(const a of available){if(cost+a.cost>budget)break;cost+=a.cost;names.push(a.name);}return names.length>=minimum?{names,cost,reason:'Explicit budget-only purchases'}:invalid;}
 if(!sleeve||!workForecast&&(!['xp','money','karma'].includes(objective)||!Object.keys(crimes).length))return {...invalid,reason:'Task benefit is not measurable; preserving sleeve skills'};
 const relevant=a=>a.stats&&Object.entries(a.stats).some(([key,value])=>Number.isFinite(value)&&value>1&&(
  !!workForecast&&['faction_rep','company_rep','work_money','bladeburner_analysis'].includes(key)||objective==='money'&&key==='crime_money'||!workForecast&&key==='crime_success'||['hacking','strength','defense','dexterity','agility','charisma'].includes(key)||(objective==='xp'||!!workForecast)&&key.endsWith('_exp')));
 const useful=available.filter(relevant),batches=[];let cost=0,batch=[];
 for(const a of useful){if(cost+a.cost>budget)continue;cost+=a.cost;batch.push(a);}
 if(batch.length>=minimum)batches.push(batch);
 const promise=a=>Object.values(a.stats).reduce((sum,m)=>sum+(Number.isFinite(m)&&m>1?Math.log(m):0),0)/a.cost;
 if(minimum===1)for(const a of useful.filter(a=>a.cost<=budget).slice().sort((a,b)=>promise(b)-promise(a)||a.cost-b.cost).slice(0,8))batches.push([a]);
 const project=workForecast||((s,stats,seconds,reset)=>sleeveAugmentedOutput(s,stats,crimes,seconds,nodeMultiplier,context,reset,objective));
 const baseline=project(sleeve,{},horizon,false);
 if(!Number.isFinite(baseline)||baseline<0)return {...invalid,reason:'Work baseline is unavailable; preserving sleeve skills'};
 let best=null;
 for(const selected of batches){
  const stats={};for(const a of selected)for(const [key,m]of Object.entries(a.stats))if(Number.isFinite(m)&&m>0)stats[key]=(stats[key]??1)*m;
  const output=project(sleeve,stats,horizon,true),cost=selected.reduce((n,a)=>n+a.cost,0),gain=output-baseline;
  if(!Number.isFinite(output)||!(output>0&&gain>Math.max(1e-12,baseline*.1))||objective==='money'&&gain<cost)continue;
  if(!best||gain/cost>best.gain/best.cost)best={names:selected.map(a=>a.name),cost,baseline,output,gain,objective,horizon,reason:objective==='money'?'Additional income repays the batch within the forecast horizon':'Projected progression gain exceeds sleeve skill rebuilding within the forecast horizon'};
 }
 return best||{...invalid,baseline,reason:'Batch does not repay sleeve skill rebuilding within fifteen minutes'};
}
