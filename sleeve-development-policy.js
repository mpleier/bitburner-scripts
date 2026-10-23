import {combatXpValue} from './combat-growth-policy.js';
import { sleeveCrimeChance } from './sleeve-policy.js';

/** Native failed crimes still award one quarter XP; shock and sync apply to transferred XP. */
export function sleeveCombatCrime(sleeve, crimes, nodeMultiplier = 1, context = null) {
  let best = null;const choices=[];
  for (const [name, stats] of Object.entries(crimes)) {
    if (!(stats.time > 0) || !Number.isFinite(stats.time)) continue;
    const chance = sleeveCrimeChance(sleeve, stats, nodeMultiplier);
    const targeted = context?.metadata?.weights && context?.metadata?.decays && context?.player?.exp && context?.player?.skills;
    const statsToScore = targeted ? ['hacking','strength','defense','dexterity','agility','charisma','intelligence'] : ['strength','defense','dexterity','agility'];
    const rates=Object.fromEntries(statsToScore.map(stat=>[stat,Math.max(0,Number(stats[stat+'_exp'])||0)*(stat==='intelligence'?1:Math.max(0,Number(sleeve.mults?.[stat+'_exp']??1)||0))]));
    const exp=targeted?combatXpValue(rates,context):Object.values(rates).reduce((sum,n)=>sum+n,0);
    const rate = exp * Math.max(0,Number(context?.crimeExpMultiplier??1)) * (.25 + .75 * chance) / (stats.time / 1000) *
      Math.max(0, 1 - (Number(sleeve.shock) || 0) / 100) * Math.max(0, Math.min(100, Number(sleeve.sync) || 0)) / 100;
    const intelligenceXpPerSecond=Math.max(0,Number(stats.intelligence_exp)||0)*Math.max(0,Number(context?.crimeExpMultiplier??1))*(.25+.75*chance)/(stats.time/1000)*
      Math.max(0,1-(Number(sleeve.shock)||0)/100)*Math.max(0,Math.min(100,Number(sleeve.sync)||0))/100;
    if(Number.isFinite(rate)&&rate>0){
      const candidate={name,rate,intelligenceXpPerSecond,metric:targeted?'estimated-competence-per-second':'combat-xp-per-second'};
      if(!targeted)choices.push(candidate);
      if(rate>(best?.rate||0))best=candidate;
    }
  }
  if(best&&Number(context?.player?.skills?.intelligence??sleeve.skills?.intelligence)>0&&choices.length)
    return choices.filter(c=>c.rate>=best.rate*.99).sort((a,b)=>b.intelligenceXpPerSecond-a.intelligenceXpPerSecond||b.rate-a.rate)[0];
  return best;
}

export function sleeveDevelopmentActive(record, reset, processes, now = Date.now()) {
  return !!((record?.chanceBlocked === true || record?.preparingStats === true) && typeof record.target === 'string' &&
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

/** Short-lived advisory quote cache. Budget/horizon rounding is conservative;
 * actual purchases still require the buyer's fresh native quote and reserve checks. */
export function sleeveRecoveryForecast(input,{cache=null,scope=null,now=Date.now(),stats=null,searches=null}={}){
 if(!(cache instanceof Map)||!Number.isFinite(now)||input.workForecast)return planSleeveAugPurchase({...input,includeAlternatives:true});
 // Forecast-only buckets discard less than 1% of cash and less than five seconds.
 const quantum=input.budget>0?Math.max(.01,10**Math.floor(Math.log10(input.budget)-2)):1;
 const budget=Math.floor(input.budget/quantum)*quantum;
 const horizon=input.horizon>=5?Math.floor(input.horizon/5)*5:input.horizon;
 const player=input.context?.player;
 const context=input.context?{...input.context,player:player?{skills:player.skills,exp:player.exp,mults:player.mults}:player}:null;
 const sleeve=input.sleeve;
 const key=JSON.stringify([scope,budget,horizon,input.minBatch,input.nodeMultiplier,input.objective,input.manual,
  {skills:sleeve?.skills,exp:sleeve?.exp,mults:sleeve?.mults,sync:sleeve?.sync},input.offers,input.crimes,context],
  (key,value)=>typeof value==='number'&&!Number.isFinite(value)?String(value):value);
 const copy=q=>({...q,names:[...q.names],...(q.search?{search:{...q.search}}:{}),
  ...(q.alternatives?{alternatives:q.alternatives.map(a=>({...a,names:[...a.names]}))}:{})});
 const saved=cache.get(key);
 if(saved&&saved.at<=now&&now-saved.at<10000){if(stats)stats.hits=(stats.hits||0)+1;return copy(saved.value);}
 const frontiers=searches instanceof Map?searches:null;
 if(frontiers)for(const [k,v]of frontiers)if(!v||v.at>now||now-v.at>=10000)frontiers.delete(k);
 let pending=frontiers?.get(key);
 if(typeof input.canEvaluate==='function'&&!input.canEvaluate()){
  if(stats)stats.deferred=(stats.deferred||0)+1;
  return pending?.value?{...copy(pending.value),search:{...pending.value.search,timeLimited:true}}:{names:[],cost:0,search:{timeLimited:true}};
 }
 if(stats)stats.misses=(stats.misses||0)+1;
 if(pending&&stats)stats.resumed=(stats.resumed||0)+1;
 pending=pending||{at:now,state:{},value:null};
 const value=planSleeveAugPurchase({...input,budget,horizon,context,
  sleeve:{skills:sleeve?.skills,exp:sleeve?.exp,mults:sleeve?.mults,sync:sleeve?.sync,shock:0},resumeState:pending.state,includeAlternatives:true});
 if(value.search?.timeLimited){
  if(frontiers){pending.value=value;frontiers.delete(key);while(frontiers.size>=16)frontiers.delete(frontiers.keys().next().value);frontiers.set(key,pending);}
  return copy(value);
 }
 frontiers?.delete(key);
 for(const [k,v]of cache)if(!v||v.at>now||now-v.at>=10000)cache.delete(k);
 cache.delete(key);while(cache.size>=64)cache.delete(cache.keys().next().value);
 cache.set(key,{at:now,value});return copy(value);
}

/** Requote every unallocated sleeve after each award against the remaining cash. */
export function sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,budget,nodeMultiplier=1,context=null,horizon=900,options={}) {
 if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(horizon)||horizon<=0)return {};
 const clock=typeof options.clock==='function'?options.clock:Date.now,started=clock();
 const allowance=Number.isFinite(options.maxPlanningMs)?Math.max(0,options.maxPlanningMs):Infinity;
 const deadline=started+allowance,canEvaluate=()=>clock()<deadline;
 let timeLimited=false;
 const pending=[];
 for(let i=0;i<sleeves.length;i++){
  const sleeve=sleeves[i],rate=observation?.sleeves?.[i]?.rate;
  if(!(sleeve.shock>0&&Number.isFinite(rate)&&rate>0))continue;
  const recoverySeconds=Math.max(sleeve.shock/rate,Math.max(0,options.cooldowns?.[i]||0)),remaining=Math.max(0,horizon-recoverySeconds);
  if(remaining>0)pending.push({index:i,sleeve:{...sleeve,shock:0},recoverySeconds,horizon:remaining});
 }
 const cursor=Number.isSafeInteger(options.state?.cursor)&&options.state.cursor>=0?options.state.cursor%sleeves.length:0;
 pending.sort((a,b)=>(a.index-cursor+sleeves.length)%sleeves.length-(b.index-cursor+sleeves.length)%sleeves.length);
 const plan={},bundleGroups=new Map();let remaining=budget;
 const now=Number.isFinite(options.now)?options.now:Date.now();
 while(pending.length&&remaining>0){
  const candidates=[];
  for(const p of pending){
   const quote=sleeveRecoveryForecast({sleeve:p.sleeve,offers:offers?.[p.index]||[],budget:remaining,crimes,
    objective:'xp',nodeMultiplier,context,horizon:p.horizon,minBatch:options.minBatch??1,canEvaluate},
    {cache:options.cache,scope:options.cacheScope,now,stats:options.cacheStats,searches:options.searches});
   if(quote.search?.timeLimited&&!timeLimited){
    timeLimited=true;if(options.state)options.state.cursor=(p.index+1)%sleeves.length;
   }
   const choices=(quote.alternatives||[]).concat(quote.names.length?[quote]:[]).map(a=>({index:p.index,
    cost:a.cost,names:a.names,output:a.output,recoverySeconds:p.recoverySeconds,extra:a.gain,resetXp:true,search:quote.search}));
   if(!bundleGroups.has(p.index))bundleGroups.set(p.index,[]);
   const known=bundleGroups.get(p.index);
   for(const a of choices)if(a.names?.length&&a.extra>0&&a.cost>0&&a.cost<=remaining&&
    !known.some(b=>b.cost===a.cost&&b.extra===a.extra&&b.names.slice().sort().join('\u0000')===a.names.slice().sort().join('\u0000')))known.push(a);
   if(quote.names.length&&quote.gain>0&&quote.cost>0&&quote.cost<=remaining)candidates.push({index:p.index,
    cost:quote.cost,names:quote.names,output:quote.output,recoverySeconds:p.recoverySeconds,extra:quote.gain,resetXp:true,search:quote.search});
  }
  candidates.sort((a,b)=>b.extra/b.cost-a.extra/a.cost||a.recoverySeconds-b.recoverySeconds||a.index-b.index);
  const best=candidates[0];if(!best)break;
  plan[best.index]=best;remaining-=best.cost;pending.splice(pending.findIndex(p=>p.index===best.index),1);
 }
 const joint=selectSleeveAugBundles([...bundleGroups].map(([index,choices])=>({index,choices})),budget,{canEvaluate});
 const greedyGain=Object.values(plan).reduce((n,p)=>n+p.extra,0),greedyCost=Object.values(plan).reduce((n,p)=>n+p.cost,0);
 const useJoint=joint.gain>greedyGain||joint.gain===greedyGain&&joint.cost<greedyCost;
 if(options.cacheStats){options.cacheStats.timeLimited=timeLimited||joint.timeLimited;options.cacheStats.planningMs=Math.max(0,clock()-started);
  options.cacheStats.allocation={greedyGain,jointGain:joint.gain,selected:useJoint?'joint':'greedy',states:joint.states,limited:joint.timeLimited};}
 return useJoint?joint.plan:plan;
}

/** At most one bundle per sleeve; maximize total incremental output under one wallet.
 * This bounded Pareto search is advisory. The caller retains its greedy baseline. */
export function selectSleeveAugBundles(groups,budget,{maxStates=128,canEvaluate=null}={}){
 const empty={plan:{},cost:0,gain:0,states:1,timeLimited:false};
 if(!Number.isFinite(budget)||budget<=0)return empty;
 const width=Number.isFinite(maxStates)?Math.max(2,Math.min(128,Math.floor(maxStates))):128;
 let states=[{cost:0,gain:0,picks:[]}],timeLimited=false,peak=1;const used=new Set();
 for(const group of (groups||[]).slice(0,32)){
  if(!Number.isSafeInteger(group?.index)||group.index<0||used.has(group.index))continue;used.add(group.index);
  const choices=(group.choices||[]).filter(a=>Number.isFinite(a?.cost)&&a.cost>0&&a.cost<=budget&&
   Number.isFinite(a.extra)&&a.extra>0&&Array.isArray(a.names)&&a.names.length>0&&a.names.every(n=>typeof n==='string')&&new Set(a.names).size===a.names.length)
   .sort((a,b)=>b.extra-a.extra||a.cost-b.cost).slice(0,128);
  const expanded=states.slice();
  outer:for(const state of states)for(const choice of choices){
   if(typeof canEvaluate==='function'&&!canEvaluate()){timeLimited=true;break outer;}
   if(state.cost+choice.cost<=budget&&Number.isFinite(state.gain+choice.extra))expanded.push({cost:state.cost+choice.cost,gain:state.gain+choice.extra,picks:[...state.picks,{...choice,index:group.index}]});
  }
  expanded.sort((a,b)=>a.cost-b.cost||b.gain-a.gain);
  let highest=-Infinity;const frontier=[];
  for(const state of expanded)if(state.gain>highest){frontier.push(state);highest=state.gain;}
  if(frontier.length>width){
   const best=frontier.reduce((a,b)=>b.gain>a.gain?b:a),efficient=frontier.reduce((a,b)=>b.gain/Math.max(1e-12,b.cost)>a.gain/Math.max(1e-12,a.cost)?b:a);
   const selected=new Set([frontier[0],best,efficient]);
   for(let i=1;i<width-1&&selected.size<width;i++)selected.add(frontier[Math.floor(i*(frontier.length-1)/(width-1))]);
   for(const state of frontier){if(selected.size>=width)break;selected.add(state);}
   states=[...selected].slice(0,width);
  }else states=frontier;
  peak=Math.max(peak,states.length);if(timeLimited)break;
 }
 const best=states.reduce((a,b)=>b.gain>a.gain||b.gain===a.gain&&b.cost<a.cost?b:a);
 return {plan:Object.fromEntries(best.picks.map(a=>[a.index,{...a,names:[...a.names]}])),cost:best.cost,gain:best.gain,states:peak,timeLimited};
}

/** Price an actual batch against doing the same work without erasing existing sleeve XP. */
export function planSleeveAugPurchase({sleeve,offers,budget,crimes={},objective='xp',context=null,nodeMultiplier=1,horizon=900,minBatch=1,manual=false,workForecast=null,canEvaluate=null,resumeState=null,includeAlternatives=false}) {
 const invalid={names:[],cost:0,reason:'No affordable beneficial augmentation batch'};
 // Keep evaluated bundles and the best result across cooperative time slices.
 // Replaying the small beam uses memoized outputs; expensive projections are not repeated.
 const state=resumeState&&typeof resumeState==='object'?resumeState:null;
 if(state){
  const fingerprint=JSON.stringify([budget,horizon,minBatch,manual,objective,nodeMultiplier,
   {skills:sleeve?.skills,exp:sleeve?.exp,mults:sleeve?.mults,sync:sleeve?.sync,shock:sleeve?.shock},offers,crimes,context],
   (k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
  if(state.version!==2||state.fingerprint!==fingerprint||state.forecast!==workForecast||(!(state.seen instanceof Map)||!(state.outputs instanceof Map)))
   Object.assign(state,{version:2,fingerprint,forecast:workForecast,hasBaseline:false,best:null,evaluations:0,seen:new Map(),outputs:new Map(),projections:0,projectionHits:0,done:false});
 }
 let timeLimited=false;
 const hasTime=()=>{if(typeof canEvaluate==='function'&&!canEvaluate()){timeLimited=true;return false;}return true;};
 if(!hasTime())return {...invalid,search:{timeLimited:true}};
 if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(horizon)||horizon<=0)return invalid;
 horizon=Math.min(900,horizon);
 const available=(offers||[]).filter(a=>typeof a.name==='string'&&Number.isFinite(a.cost)&&a.cost>0).filter((a,i,all)=>all.findIndex(b=>b.name===a.name)===i).slice().sort((a,b)=>a.cost-b.cost||a.name.localeCompare(b.name));
 const minimum=Math.min(minBatch,Math.max(1,available.length-1));
 if(manual){let cost=0;const names=[];for(const a of available){if(cost+a.cost>budget)break;cost+=a.cost;names.push(a.name);}return names.length>=minimum?{names,cost,reason:'Explicit budget-only purchases'}:invalid;}
 if(!sleeve||!workForecast&&(!['xp','money','karma'].includes(objective)||!Object.keys(crimes).length))return {...invalid,reason:'Task benefit is not measurable; preserving sleeve skills'};
 const relevant=a=>a.stats&&Object.values(a.stats).every(v=>Number.isFinite(v)&&v>0)&&Object.entries(a.stats).some(([key,value])=>Number.isFinite(value)&&value>1&&(
  !!workForecast&&['faction_rep','company_rep','work_money','bladeburner_analysis'].includes(key)||objective==='money'&&key==='crime_money'||!workForecast&&key==='crime_success'||['hacking','strength','defense','dexterity','agility','charisma'].includes(key)||(objective==='xp'||!!workForecast)&&key.endsWith('_exp')));
 const useful=available.filter(relevant),batches=[];let cost=0,batch=[];
 for(const a of useful){if(cost+a.cost>budget)continue;cost+=a.cost;batch.push(a);}
 if(batch.length>=minimum)batches.push(batch);
 const promise=a=>Object.values(a.stats).reduce((sum,m)=>sum+(Number.isFinite(m)&&m>1?Math.log(m):0),0)/a.cost;
 if(minimum===1)for(const a of useful.filter(a=>a.cost<=budget).slice().sort((a,b)=>promise(b)-promise(a)||a.cost-b.cost).slice(0,8))batches.push([a]);
 const project=workForecast||((s,stats,seconds,reset)=>sleeveAugmentedOutput(s,stats,crimes,seconds,nodeMultiplier,context,reset,objective));
 const baseline=state?.hasBaseline?state.baseline:project(sleeve,{},horizon,false);
 if(!Number.isFinite(baseline)||baseline<0)return {...invalid,reason:'Work baseline is unavailable; preserving sleeve skills'};
 if(state){state.baseline=baseline;state.hasBaseline=true;}
 let best=state?.best||null,evaluations=state?.evaluations||0;const searchLimit=workForecast?64:128,seen=state?.seen||new Map();
 const outputs=state?.outputs||new Map();let projections=state?.projections||0,projectionHits=state?.projectionHits||0;
 const evaluate=selected=>{
  const key=selected.map(a=>a.name).sort().join('\u0000');if(seen.has(key))return seen.get(key);if(evaluations>=searchLimit)return null;
  const stats={};for(const a of selected)for(const [k,m]of Object.entries(a.stats))if(Number.isFinite(m)&&m>0)stats[k]=(stats[k]??1)*m;
  if(!Object.values(stats).every(m=>Number.isFinite(m)&&m>0)){evaluations++;seen.set(key,null);return null;}
  const effect=JSON.stringify(Object.entries(stats).sort(([a],[b])=>a.localeCompare(b)));
  if(!outputs.has(effect)&&!hasTime())return null;
  evaluations++;let output;
  if(outputs.has(effect)){output=outputs.get(effect);projectionHits++;}
  else{output=project(sleeve,stats,horizon,true);outputs.set(effect,output);projections++;}
  const cost=selected.reduce((n,a)=>n+a.cost,0),gain=output-baseline;
  if(!Number.isFinite(output)||cost<=0){seen.set(key,null);return null;}
  const candidate={selected,cost,gain,output};seen.set(key,candidate);
  if(selected.length>=minimum&&output>0&&gain>Math.max(1e-12,baseline*.1)&&!(objective==='money'&&gain<cost)&&
   (!best||gain/cost>best.gain/best.cost||gain/cost===best.gain/best.cost&&cost<best.cost))
   best={names:selected.map(a=>a.name),cost,baseline,output,gain,objective,horizon,reason:objective==='money'?'Additional income repays the batch within the forecast horizon':'Projected progression gain exceeds sleeve skill rebuilding within the forecast horizon'};
  return candidate;
 };
 for(const batch of batches){evaluate(batch);if(timeLimited)break;}
 // Mix cheap offers and high multiplier-per-dollar offers, preserving combinatorial synergies.
 const promising=useful.filter(a=>a.cost<=budget).slice().sort((a,b)=>promise(b)-promise(a)||a.cost-b.cost).slice(0,12);
 const cheap=useful.filter(a=>a.cost<=budget).slice(0,12),pool=[];
 for(let i=0;i<12;i++)for(const a of [promising[i],cheap[i]])if(a&&!pool.some(b=>b.name===a.name))pool.push(a);
 // Reserve early evaluations for pairs of promising offers before beam expansion
 // can consume the bound on a long catalogue of cheap offers.
 for(let i=0;i<Math.min(6,promising.length)&&!timeLimited;i++)for(let j=i+1;j<Math.min(6,promising.length)&&!timeLimited;j++)
  if(promising[i].cost+promising[j].cost<=budget)evaluate([promising[i],promising[j]]);
 let beam=[{selected:[],cost:0,gain:0,output:baseline}];
 for(const aug of pool){
  if(timeLimited)break;
  const expanded=beam.slice();for(const state of beam){if(state.cost+aug.cost>budget)continue;const next=evaluate([...state.selected,aug]);if(next)expanded.push(next);}
  expanded.sort((a,b)=>b.output-a.output||a.cost-b.cost);
  const efficient=expanded.slice().sort((a,b)=>(b.gain/Math.max(1,b.cost))-(a.gain/Math.max(1,a.cost))||a.cost-b.cost);
  beam=[...expanded.slice(0,4),...efficient.slice(0,4),{selected:[],cost:0,gain:0,output:baseline}].filter((a,i,all)=>all.findIndex(b=>b.selected.map(x=>x.name).join('\u0000')===a.selected.map(x=>x.name).join('\u0000'))===i);
  if(evaluations>=searchLimit||timeLimited)break;
 }
 if(state){state.best=best;state.evaluations=evaluations;state.projections=projections;state.projectionHits=projectionHits;state.done=!timeLimited;}
 let alternatives;
 if(includeAlternatives){
  const eligible=[...seen.values()].filter(c=>c&&c.selected.length>=minimum&&c.output>0&&c.gain>Math.max(1e-12,baseline*.1)&&!(objective==='money'&&c.gain<c.cost))
   .sort((a,b)=>a.cost-b.cost||b.gain-a.gain);
  let high=-Infinity;const frontier=[];
  for(const c of eligible)if(c.gain>high){frontier.push(c);high=c.gain;}
  const chosen=new Set();
  if(best){const same=frontier.find(c=>c.cost===best.cost&&c.gain===best.gain);if(same)chosen.add(same);}
  if(frontier.length){chosen.add(frontier[0]);chosen.add(frontier[frontier.length-1]);}
  const slots=Math.max(0,12-chosen.size);
  for(let i=1;i<=slots;i++)if(frontier.length)chosen.add(frontier[Math.floor(i*(frontier.length-1)/(slots+1))]);
  for(const c of frontier){if(chosen.size>=Math.min(12,frontier.length))break;chosen.add(c);}
  alternatives=[...chosen].sort((a,b)=>a.cost-b.cost).map(c=>({names:c.selected.map(a=>a.name),cost:c.cost,baseline,output:c.output,gain:c.gain,objective,horizon}));
 }
 if(best)return {...best,names:[...best.names],...(alternatives?{alternatives}:{}),search:{evaluations,projections,projectionHits,limit:searchLimit,pool:pool.length,exhaustive:false,timeLimited,budgetExhausted:evaluations>=searchLimit}};
 return best||{...invalid,baseline,...(timeLimited?{search:{timeLimited:true,evaluations,limit:searchLimit}}:{}),reason:timeLimited?'Planning time allowance exhausted; forecast deferred':'Batch does not repay sleeve skill rebuilding within fifteen minutes'};
}
