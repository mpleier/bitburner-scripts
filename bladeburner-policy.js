/** Decisions shared by the controller and its focused checks. */
export function isBlackOp(action) { return /black/i.test(action?.type || ''); }
export function nextSkill(skills, levels, costs, points, weights) {
 let best=null,score=Infinity;
 for(const name of skills) {
  const cost=costs[name];
  if(!(Number.isFinite(cost)&&cost>0&&cost<=points)||name==='Overclock'&&levels[name]>=90)continue;
  const adjusted=cost*(weights[name]||1);
  if(adjusted<score){best=name;score=adjusted;}
 }
 return best;
}
export function raidCities(cities,population,communities,allowHighest=false) {
 const highest=cities.reduce((best,c)=>population[c]>population[best]?c:best,cities[0]);
 return cities.filter(c=>communities[c]>0&&(allowHighest||c!==highest));
}
export function recoveryRequired(hp,stamina,previous,low,high) {
 return {health:hp<0.5||previous.health&&hp<0.9,stamina:stamina<low||previous.stamina&&stamina<high};
}
export function optionsError(o) {
 if(o['black-op-min-success']!==undefined&&(!Number.isFinite(o['black-op-min-success'])||o['black-op-min-success']<.9||o['black-op-min-success']>1))return 'black-op-min-success must be between 0.9 and 1';
 if(o['growth-horizon-seconds']!==undefined&&(!Number.isFinite(o['growth-horizon-seconds'])||o['growth-horizon-seconds']<30||o['growth-horizon-seconds']>900))return 'growth-horizon-seconds must be between 30 and 900';
 if(o['stealth-retirement-reserve']!==undefined&&(!Number.isSafeInteger(o['stealth-retirement-reserve'])||o['stealth-retirement-reserve']<0||o['stealth-retirement-reserve']>1000000))return 'stealth-retirement-reserve must be an integer between 0 and 1000000';
 if(o['team-cap']!==undefined&&(!Number.isInteger(o['team-cap'])||o['team-cap']<0||o['team-cap']>1000))return 'team-cap must be an integer between 0 and 1000';
 if(o['recruitment-budget-minutes']!==undefined&&(!Number.isFinite(o['recruitment-budget-minutes'])||o['recruitment-budget-minutes']<0||o['recruitment-budget-minutes']>60))return 'recruitment-budget-minutes must be between 0 and 60';
 for(const key of ['success-threshold','low-stamina-pct','high-stamina-pct'])if(!Number.isFinite(o[key])||o[key]<0||o[key]>1)return key+' must be between 0 and 1';
 if(o['low-stamina-pct']>=o['high-stamina-pct'])return 'high-stamina-pct must exceed low-stamina-pct';
 for(const key of ['chaos-recovery-threshold','max-chaos','training-limit','reserved-action-count'])if(!Number.isFinite(o[key])||o[key]<0)return key+' must be nonnegative';
 if(o['max-chaos']<o['chaos-recovery-threshold'])return 'max-chaos must be at least chaos-recovery-threshold';
 if(!Number.isFinite(o['update-interval'])||o['update-interval']<100)return 'update-interval must be at least 100 ms';
 return null;
}

/** Operation/BlackOp bonus is (assigned+1)^0.05; size against the conservative lower bound. */
export function requiredBladeburnerTeam(chance,threshold,cap=30){
 if(!Array.isArray(chance)||chance.length<2||!chance.every(Number.isFinite)||!Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isInteger(cap)||cap<0)return null;
 const [low,high]=chance;if(high<low||low<0)return null;if(low>=threshold)return 0;
 if(!(low>0))return null;
 const need=Math.ceil(Math.expm1(20*Math.log(threshold/low)));
 return Number.isFinite(need)&&need<=cap?Math.max(0,need):null;
}
/** Executed in a guarded worker; restore the prior assignment if recruitment cannot help. */
export function prepareBladeburnerTeam(api,name,threshold,cap,required,forecast=null,difficulty=null){
 const type='Black Operations',available=api.getTeamSize(),previous=api.getTeamSize(type,name);
 if(!Number.isInteger(available)||available<0||!Number.isInteger(previous)||previous<0)return {state:'unavailable'};
 let modified=false;
 try{
  // Capped native chances cannot prove that extra recruits overcome a stamina penalty.
  // Recover first when even a displayed 100% chance would fail the post-cost check.
  if(forecast){
   const stamina=api.getStamina(),ceiling=forecast([1,1],stamina,difficulty);
   if(!ceiling)return {state:'unavailable',available,reason:'Post-cost stamina estimate unavailable'};
   if(ceiling[0]<threshold)return {state:'needs-stamina',available,stamina,reason:stamina[0]<stamina[1]*.99?'Recover stamina before sizing the Black Op team':'Increase maximum stamina before sizing the Black Op team'};
  }
  const chanceNow=()=>{const chance=api.getActionEstimatedSuccessChance(type,name);return forecast?forecast(chance,api.getStamina(),difficulty):chance;};
  if(api.setTeamSize(type,name,0)!==0)return {state:'unavailable'};modified=true;
  const baseline=chanceNow(),estimate=required(baseline,threshold,cap);
  const limit=Math.min(available,cap);
  const meets=chance=>Array.isArray(chance)&&Number.isFinite(chance[0])&&chance[0]>=threshold;
  let need=estimate;
  if(meets(baseline))need=0;
  else if(limit>0) {
   if(api.setTeamSize(type,name,limit)!==limit)throw Error('Team assignment rejected');
   if(meets(chanceNow())) {
    let low=0,high=limit;
    // Use actual native estimates to find the smallest available useful squad.
    while(low<high){const mid=low+Math.floor((high-low)/2);if(api.setTeamSize(type,name,mid)!==mid)throw Error('Team assignment rejected');if(meets(chanceNow()))high=mid;else low=mid+1;}
    need=low;
   } else if(estimate!==null&&estimate<=limit)throw Error('Assigned team did not reach the success threshold');
  }
  if(need===null){api.setTeamSize(type,name,previous);modified=false;return {state:'no-useful-team',available,baseline,reason:'Current success estimate cannot reach the target within the team cap'};}
  const assigned=api.setTeamSize(type,name,Math.min(available,need));
  if(assigned!==Math.min(available,need))throw Error('Team assignment rejected');
  const chance=chanceNow();
  if(available>=need&&!meets(chance))throw Error('Assigned team did not reach the success threshold');
  modified=false;
  return {state:available<need?'needs-recruitment':'ready',available,required:need,assigned,baseline,chance,reason:available<need?'More team members can unlock this Black Op':'Required team is ready'};
 }catch(error){if(modified)try{api.setTeamSize(type,name,previous);}catch{}return {state:'unavailable',error:String(error)};}
}

/** Retain recruitment intervals for a real rolling hour, including across restarts. */
export function bladeburnerRecruitmentBudget(saved,nodeReset,now,previousAt=now,recruiting=false,windowMs=3600000){
 windowMs=Number.isFinite(windowMs)&&windowMs>0?windowMs:3600000;
 const cutoff=now-windowMs;
 let intervals=[];
 if(saved?.nodeReset===nodeReset){
  if(Array.isArray(saved.intervals))intervals=saved.intervals.filter(x=>Array.isArray(x)&&x.length===2&&x.every(Number.isFinite)&&x[0]>=0&&x[1]>x[0]&&x[1]<=now).map(x=>[...x]);
  else if(Number.isFinite(saved.windowAt)&&saved.windowAt>=0&&saved.windowAt<=now&&now-saved.windowAt<3600000&&Number.isFinite(saved.spentMs)&&saved.spentMs>0){
   // Legacy records have no timing detail: conservatively retain their usage from migration.
   intervals.push([Math.max(0,now-Math.min(3600000,saved.spentMs)),now]);
  }
 }
 if(recruiting&&Number.isFinite(previousAt)&&previousAt>=0&&previousAt<now)intervals.push([Math.max(previousAt,cutoff),now]);
 intervals=intervals.filter(x=>x[1]>cutoff).map(x=>[Math.max(cutoff,x[0]),x[1]]).sort((a,b)=>a[0]-b[0]);
 const merged=[];
 for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push(interval);}
 return {nodeReset,windowAt:cutoff,intervals:merged,spentMs:merged.reduce((sum,[start,end])=>sum+end-start,0)};
}


/** Conservative expected net rank per second, using the lower success estimate. */
export function bladeburnerRankRate(chance,metrics,timing=null) {
 if(!Array.isArray(chance)||!Number.isFinite(chance[0])||!metrics||!Number.isFinite(metrics.time)||metrics.time<=0||!Number.isFinite(metrics.gain)||metrics.gain<0||!Number.isFinite(metrics.loss)||metrics.loss<0)return null;
 const probability=Math.max(0,Math.min(1,chance[0]));
 let replacementMs=0,chaosMs=0,cleanupCandidate=null;
 if(metrics.team!==undefined){
  if(!Number.isSafeInteger(metrics.team)||metrics.team<0)return null;
  if(metrics.team>0){
   const r=metrics.recruitment;
   if(!r||!Number.isFinite(r.chance)||r.chance<=0||!Number.isFinite(r.time)||r.time<=0)return 0;
   const casualties=(probability*Math.ceil(metrics.team/2)+(1-probability)*metrics.team)/2;
   replacementMs=casualties*r.time/Math.min(1,r.chance);
  }
 }
 const control=metrics.chaosControl;
 if(control){
  const effect=control.effect;
  if(!effect||![control.threshold,control.charisma,control.time,effect.success,effect.always,effect.positivePercent].every(Number.isFinite)||control.threshold<=0||control.charisma<0||control.time<=0||effect.success<0||effect.always<0||effect.positivePercent<0)return null;
  // Price maintenance near the configured chaos ceiling. Random changes reserve
  // their positive part; negative random outcomes do not promise free cleanup.
  const anchor=Math.max(1,control.threshold*.9);
  const added=Math.max(0,probability*effect.success+effect.always+anchor*effect.positivePercent-.0001*(metrics.time+replacementMs)/1000);
  if(added>0){
   const fraction=Math.min(1,(Math.pow(control.charisma,.045)+control.charisma/1000)/100);
   const sleeves=Number.isFinite(control.sleeveLogRate)&&control.sleeveLogRate>0?control.sleeveLogRate:0;
   const demand=fraction>=1?Math.min(1,added/anchor):Math.log1p(added/anchor);
   const pending=Math.max(0,demand-sleeves*(metrics.time+replacementMs));
   const playerRate=fraction>=1?1/control.time:fraction>0?-Math.log1p(-fraction)/control.time:0;
   chaosMs=pending>0?(playerRate+sleeves>0?pending/(playerRate+sleeves):Infinity):0;
   const q=control.cleanup;
   if(pending>0&&q&&q.team===0&&[q.time,q.gain,q.loss,q.chance,q.rawChance,q.count,q.staminaCost,q.stamina?.[0],q.stamina?.[1],q.threshold,metrics.staminaCost,metrics.staminaRegen,metrics.hrcRegen].every(Number.isFinite)&&q.time>0&&q.gain>0&&q.loss>=0&&q.chance>=q.threshold&&q.chance>.99&&q.chance<=1&&q.rawChance>0&&q.rawChance<=1&&q.threshold>0&&q.threshold<=1&&q.count>=1&&q.staminaCost>=0&&q.stamina[0]>=0&&q.stamina[1]>0&&metrics.staminaCost>=0&&metrics.staminaRegen>=0&&metrics.hrcRegen>=0){
    // Native Stealth Retirement always removes 1--3%; use the guaranteed 1%.
    const cycles=pending/(-Math.log1p(-.01)+sleeves*q.time);
    const needed=Math.ceil(cycles),before=Math.min(1,q.stamina[0]/(.5*q.stamina[1]));
    const after=Math.min(1,Math.max(0,q.stamina[0]-metrics.staminaCost-needed*q.staminaCost)/(.5*q.stamina[1]));
    const finalChance=before>0?q.rawChance*Math.min(1,after/before):0;
    // Fractional cycles amortize the estimate; stock/stamina cover whole attempts.
    if(needed<=Math.floor(q.count)&&finalChance>=q.threshold&&finalChance>.99)
     cleanupCandidate={time:cycles*q.time,rank:cycles*(q.chance*q.gain-(1-q.chance)*q.loss),stamina:cycles*q.staminaCost};
   }
  }
 }
 const score=(maintenanceMs,extraRank=0,extraStamina=0)=>{
  if(!Number.isFinite(maintenanceMs)||maintenanceMs<0)return 0;
  let recoveryMs=0;
  if([metrics.staminaCost,metrics.staminaRegen,metrics.hrcRegen].every(Number.isFinite)&&metrics.staminaCost>=0&&metrics.staminaRegen>=0&&metrics.hrcRegen>=0){
   // Passive regeneration continues through both kinds of cleanup. Combat
   // cleanup also consumes stamina, unlike Diplomacy or Recruitment.
   const deficit=Math.max(0,metrics.staminaCost+extraStamina-metrics.staminaRegen*(metrics.time+replacementMs+maintenanceMs)/1000);
   const recoveryRate=metrics.staminaRegen+metrics.hrcRegen;
   if(deficit>0&&recoveryRate<=0)return 0;
   if(deficit>0)recoveryMs=1000*deficit/recoveryRate;
  }
  const totalMs=metrics.time+replacementMs+maintenanceMs+recoveryMs;
  const rate=(probability*metrics.gain-(1-probability)*metrics.loss+extraRank)*1000/totalMs;
  if(timing&&Number.isFinite(rate)&&(!Number.isFinite(timing.rate)||rate>timing.rate)){timing.rate=rate;timing.duty=metrics.time/totalMs;timing.regeneration=[metrics.staminaCost,metrics.staminaRegen,metrics.hrcRegen].every(Number.isFinite)?{combatMs:metrics.time,otherMs:replacementMs+maintenanceMs,recoveryMs,cost:metrics.staminaCost+extraStamina,passive:metrics.staminaRegen,hrc:metrics.hrcRegen}:null;}
  return rate;
 };
 const diplomacy=score(chaosMs);
 return cleanupCandidate?Math.max(diplomacy,score(cleanupCandidate.time,cleanupCandidate.rank,cleanupCandidate.stamina)):diplomacy;
}
/** Black Ops retain progression priority; missing metrics retain the existing action order. */
export function rankBladeburnerActions(names,chances,metrics,nextBlackOp,rate) {
 const result=[...names];
 if(!result.every(name=>rate(chances[name],metrics[name])!==null))return result;
 return result.sort((a,b)=>a===b?0:a===nextBlackOp?-1:b===nextBlackOp?1:rate(chances[b],metrics[b])-rate(chances[a],metrics[a]));
}
/** Self-contained for one guarded worker instead of several workers per skill level. */
export function spendBladeburnerSkills(api,names,weights,choose,allowed,context=null,quoteContext=null) {
 const purchased=[],bundleCache=new Map();
 for(let purchases=0;purchases<100;purchases++) {
  if(!allowed())break;
  const points=api.getSkillPoints();if(!(points>0))break;
  const levels=Object.fromEntries(names.map(name=>[name,api.getSkillLevel(name)]));
  const costs=Object.fromEntries(names.map(name=>[name,api.getSkillUpgradeCost(name)]));
  const ctx=quoteContext?quoteContext(api,names,context,bundleCache):context?context():null;
  const choice=choose(names,levels,costs,points,weights,ctx);if(!choice)break;
  const name=typeof choice==='string'?choice:choice.name,count=typeof choice==='string'?1:choice.count;
  if(!names.includes(name)||!Number.isSafeInteger(count)||count<1||count>90||count>1&&(name!=='Overclock'||levels[name]+count>90))break;
  const price=count===1?costs[name]:api.getSkillUpgradeCost(name,count);
  if(!Number.isFinite(price)||price<=0||price>api.getSkillPoints()||!allowed()||!api.upgradeSkill(name,count))break;
  for(let i=0;i<count;i++)purchased.push(name);
  // Native max stamina updates on the next engine tick, not during this synchronous batch.
  if(["Cyber's Edge","Reaper","Evasive System"].includes(name))break;
 }
 return purchased;
}

/** Read native bundle prices; unavailable APIs retain single-level selection. */
export function bladeburnerSkillContext(api,names,context,cache=null){
 const ctx=typeof context==='function'?context():context;
 if(!ctx||!names.includes('Overclock')||!(ctx.throughputs?.length||ctx.throughput))return ctx;
 try{
  const level=api.getSkillLevel('Overclock');
  if(!Number.isSafeInteger(level)||level<0||level>=90)return ctx;
  const key=level+':'+api.getSkillUpgradeCost('Overclock');
  if(cache?.has(key))return {...ctx,overclockBundles:cache.get(key)};
  const overclockBundles=[];
  for(let count=2;count<=90-level;count++){
   const cost=api.getSkillUpgradeCost('Overclock',count);
   if(Number.isFinite(cost)&&cost>0)overclockBundles.push({count,cost});
  }
  if(cache?.set)cache.set(key,overclockBundles);
  return {...ctx,overclockBundles};
 }catch{return ctx;}
}


/** Recruitment is worthwhile only when the estimated shortfall fits the remaining wall-time budget. */
export function bladeburnerRecruitmentDecision(plan,chance,duration,remainingMs,progress=0,supportingSleeves=null,bonusMs=0) {
 if(plan?.state!=='needs-recruitment')return {recruit:false,reason:plan?.state==='ready'?'Required team is ready':'No useful recruitment target'};
 if(!Number.isInteger(plan.required)||plan.required<0||plan.required>1000||!Number.isInteger(plan.available)||plan.available<0)return {recruit:false,reason:'Recruitment target unavailable'};
 const missing=Math.max(0,plan.required-plan.available),low=Array.isArray(chance)?chance[0]:NaN;
 if(!Number.isFinite(low)||low<=0||!Number.isFinite(duration)||duration<=0||!Number.isFinite(remainingMs))return {recruit:false,reason:'Recruitment estimate unavailable'};
 if(!Number.isFinite(missing))return {recruit:false,reason:'Recruitment target unavailable'};
 if(!missing)return {recruit:false,reason:'Required team is ready'};
 const probability=Math.min(1,low);
 // The observed chance may already be capped at 100%; scaling it downward stays conservative.
 // Without sleeve data, assume no human recruits yet: this gives the steepest possible decline.
 const humans=Number.isInteger(supportingSleeves)&&supportingSleeves>=0&&supportingSleeves<=plan.available?plan.available-supportingSleeves:0;
 let expectedWorkMs=0;
 for(let added=0;added<missing;added++)expectedWorkMs+=duration/Math.min(1,probability*(humans+1)/(humans+added+1));
 const completedMs=Number.isFinite(progress)?Math.max(0,Math.min(duration,progress)):0;
 expectedWorkMs=Math.max(0,expectedWorkMs-completedMs);
 // Only credit accelerated work when the whole forecast is covered by stored bonus time.
 const speed=Number.isFinite(bonusMs)&&bonusMs>=expectedWorkMs+duration?5:1;
 const expectedMs=expectedWorkMs/speed;
 if(remainingMs<(duration-completedMs)/speed||expectedMs>remainingMs)return {recruit:false,expectedMs,reason:'Expected recruitment time exceeds the remaining hourly budget'};
 return {recruit:true,expectedMs,reason:'Recruiting '+missing+' team members for the pending Black Op'};
}


/** Synchronous probes restore the live level before the engine can process another tick. */
export function planBladeburnerLevels(api,actions,threshold,rate,allowed,recovery=null,forecast=null,probeLimit=128) {
 const plans={};
 if(!Number.isSafeInteger(probeLimit)||probeLimit<1||probeLimit>128)return plans;
 for(const [name,type]of actions) {
  if(!allowed())break;
  if(!['Contracts','Operations'].includes(type))continue;
  const currentLevel=api.getActionCurrentLevel(type,name),maximum=api.getActionMaxLevel(type,name),autoLevel=api.getActionAutolevel(type,name);
  if(!Number.isSafeInteger(currentLevel)||!Number.isSafeInteger(maximum)||currentLevel<1||maximum<currentLevel)continue;
  const cache=new Map();
  const probe=level=>{
   if(cache.has(level))return cache.get(level);
   if(cache.size>=probeLimit||!allowed())return null;
   api.setActionLevel(type,name,level);
   let chance=api.getActionEstimatedSuccessChance(type,name);
   const metrics={level,time:api.getActionTime(type,name),gain:api.getActionRankGain(type,name),loss:api.getActionRankLoss(type,name)};
   const data=recovery?.actions?.[name];
   if(data&&[data.base,data.factor,recovery.regen,recovery.hrc].every(Number.isFinite)&&data.base>0&&data.factor>=1&&recovery.regen>=0&&recovery.hrc>=0){
    const difficulty=data.base*Math.pow(data.factor,level-1);
    if(forecast)chance=forecast(chance,recovery.stamina,difficulty);
    Object.assign(metrics,{nativeTime:metrics.time,staminaCost:.285*(Math.pow(difficulty,.28)+difficulty/650),staminaRegen:recovery.regen,hrcRegen:recovery.hrc});
   }
   if(recovery?.chaosControl&&data?.chaos)metrics.chaosControl={...recovery.chaosControl,effect:data.chaos};
   if(recovery?.maintenance&&type==='Operations'){
    try{metrics.team=api.getTeamSize(type,name);}catch{metrics.team=null;}
    metrics.recruitment=recovery.recruitment;
   }
   const score=rate(chance,metrics),result=score!==null&&chance?.[0]>=threshold?{level,chance,metrics,score}:null;
   cache.set(level,result);return result;
  };
  try {
   if(!probe(1))continue;
   let lower=1,upper=maximum;
   // Success falls as difficulty rises. At most 53 comparisons cover safe JS integer levels.
   for(let step=0;lower<upper&&step<53;step++) {
    const mid=lower+Math.ceil((upper-lower)/2);
    if(probe(mid))lower=mid;else upper=mid-1;
   }
   const candidates=new Set([1,lower,Math.min(currentLevel,lower)]);
   if(lower<=64)for(let level=1;level<=lower;level++)candidates.add(level);
   else {
    for(let i=1;i<=16;i++){candidates.add(Math.max(1,Math.round(lower*i/16)));candidates.add(Math.max(1,Math.round(lower**(i/16))));}
    for(let offset=1;offset<=4;offset++)candidates.add(lower-offset);
   }
   let best=null;
   for(const level of candidates)probe(level);
   // Explore the rightmost level before promising native duration jumps.
   // Every probe shares the existing hard budget and is restored in finally.
   const durations=new Set();
   const seeds=[...cache.values()].filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,8);
   for(const seed of seeds){
    if(durations.has(seed.metrics.time)||cache.size>=probeLimit||!allowed())continue;
    durations.add(seed.metrics.time);
    let lo=1,hi=seed.level;
    if(!(cache.get(1)?.metrics.time<seed.metrics.time))continue;
    while(lo<hi&&cache.size<probeLimit&&allowed()){
     const mid=lo+Math.ceil((hi-lo)/2),q=probe(mid);if(!q)break;
     if(q.metrics.time<seed.metrics.time)lo=mid;else hi=mid-1;
    }
    if(lo===hi){probe(lo);if(lo<lower)probe(lo+1);}
   }
   for(const candidate of cache.values())if(candidate&&(!best||candidate.score>best.score||candidate.score===best.score&&candidate.level<best.level))best=candidate;
   if(best){
    const result={...best,currentLevel,autoLevel,maxSafeLevel:lower,probes:cache.size};
    if(recovery?.retainGrowthVariants){
     const safe=[...cache.values()].filter(q=>q&&Number.isFinite(q.score)&&q.score>0);
     const fastest=[...safe].sort((a,b)=>a.metrics.time-b.metrics.time||a.level-b.level)[0],highest=[...safe].sort((a,b)=>b.level-a.level)[0];
     result.variants=[best,fastest,highest].filter((q,i,all)=>q&&Number.isFinite(q.score)&&q.score>0&&Number.isFinite(q.metrics?.time)&&q.metrics.time>0&&all.findIndex(v=>v?.level===q.level)===i).map(q=>({...q}));
    }
    plans[name]=result;
   }
  } finally { api.setActionLevel(type,name,currentLevel); }
 }
 return plans;
}

/** Commit a selected level only at action start, restoring settings if the start fails. */
export function startBladeburnerPlannedAction(api,type,name,plan,threshold,rankRequired,teamRequired,allowed,forecast=null,difficulty=null,report=null) {
 const deny=reason=>{if(report)report(reason);return false;};
 if(!allowed())return deny('protected-work');
 let previous,restore=false;
 try {
  if(plan&&['Contracts','Operations'].includes(type)) {
   if(!Number.isSafeInteger(plan.level)||plan.level<1||plan.level>api.getActionMaxLevel(type,name))return deny('invalid-level');
   previous={level:api.getActionCurrentLevel(type,name),auto:api.getActionAutolevel(type,name),team:type==='Operations'&&plan.team!==undefined?api.getTeamSize(type,name):null};restore=true;
   if(type==='Operations'&&plan.team!==undefined){
    if(!Number.isInteger(plan.team)||plan.team<0||plan.team>Math.max(0,api.getTeamSize()-teamRequired))return deny('team-reserved');
    if(api.setTeamSize(type,name,plan.team)!==plan.team)return deny('team-assignment-changed');
   }
   api.setActionAutolevel(type,name,false);api.setActionLevel(type,name,plan.level);
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return deny('chance-changed');
  }
  if(type==='Black Operations') {
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(api.getRank()<rankRequired)return deny('rank-not-ready');
   if(!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return deny('chance-changed');
  }
  if(forecast&&['Contracts','Operations','Black Operations'].includes(type)){
   const data=difficulty?.[name];
   if(!data||![data.base,data.factor].every(Number.isFinite)||data.base<=0||data.factor<1)return deny('stamina-forecast-unavailable');
   const level=type==='Black Operations'?1:api.getActionCurrentLevel(type,name);
   const projected=forecast(api.getActionEstimatedSuccessChance(type,name),api.getStamina(),data.base*Math.pow(data.factor,level-1));
   if(!projected||projected[0]<threshold)return deny('stamina-changed');
  }
  if(name==='Recruitment'&&api.getTeamSize()>=teamRequired)return deny('team-target-met');
  if(!allowed())return deny('protected-work');
  const success=!!api.startAction(type,name);
  if(success)restore=false;
  if(report)report(success?'started':'rejected-by-game');
  return success;
 } finally {
  if(restore){try{api.setActionLevel(type,name,previous.level);}finally{try{api.setActionAutolevel(type,name,previous.auto);}finally{if(previous.team!==null)api.setTeamSize(type,name,Math.min(previous.team,api.getTeamSize()));}}}
 }
}


/** A queued augmentation is not active. Unknown Singularity state must not cancel player work. */
export function bladeburnerWorkAllowed(api,ignoreBusy=false) {
 if(ignoreBusy)return true;
 try {
  const work=api.getCurrentWork();
  if(!work?.type)return true;
  return api.getOwnedAugmentations(false).includes("The Blade's Simulacrum");
 }catch{return false;}
}

/** Compare small expendable human squads, charging native expected casualties as replacement time.
 * Keep all support sleeves and the pending Black Op reserve out of the casualty exposure. */
export function planBladeburnerTeams(api,actions,threshold,rate,allowed,planner,reserve=0,cap=30,supportingSleeves=null,recovery=null,forecast=null) {
 const plans={};
 const total=api.getTeamSize();
 const spare=Number.isInteger(supportingSleeves)&&supportingSleeves>=0&&supportingSleeves<=total&&Number.isInteger(reserve)&&reserve>=0?
  Math.max(0,total-supportingSleeves-reserve):0;
 let replacementMs=Infinity;
 try{const chance=api.getActionEstimatedSuccessChance('General','Recruitment')[0],time=api.getActionTime('General','Recruitment');
  // Replacement becomes harder as the team grows; the present chance is conservative for replacing casualties.
  if(Number.isFinite(chance)&&chance>0&&Number.isFinite(time)&&time>0)replacementMs=time/Math.min(1,chance);
 }catch{}
 for(const [name,type]of actions) {
  if(!allowed())break;
  if(type!=='Operations'){Object.assign(plans,planner(api,[[name,type]],threshold,rate,allowed,recovery,forecast));continue;}
  const previous=api.getTeamSize(type,name);
  try {
   if(api.setTeamSize(type,name,0)!==0)continue;
   const baseline=planner(api,[[name,type]],threshold,rate,allowed,recovery,forecast)[name];
   let best=baseline?{...baseline,team:0,currentTeam:previous,expectedCasualties:0}:null;
   // Bound the search and worst-case losses; never spend the Black Op squad on repeatable operations.
   const limit=Math.min(30,spare,cap),teams=[...new Set([1,2,3,4,6,8,12,16,24,limit,previous])].filter(team=>Number.isSafeInteger(team)&&team>0&&team<=limit);
   for(const team of teams) {
    if(!Number.isFinite(replacementMs)||!allowed())break;
    if(api.setTeamSize(type,name,team)!==team)break;
    const candidate=planner(api,[[name,type]],threshold,rate,allowed,recovery,forecast)[name];if(!candidate)continue;
    const probability=Math.max(0,Math.min(1,candidate.chance[0]));
    const casualties=(probability*Math.ceil(team/2)+(1-probability)*team)/2;
    // Maintenance-aware level scores already charge their probed assignment.
    const metrics=recovery?.maintenance?candidate.metrics:{...candidate.metrics,nativeTime:candidate.metrics.time,time:candidate.metrics.time+casualties*replacementMs};
    const score=rate(candidate.chance,metrics);
    if(!(score>0)||baseline&&score<=baseline.score*1.1)continue;
    if(!best||score>best.score)best={...candidate,metrics,score,team,currentTeam:previous,expectedCasualties:casualties};
   }
   if(best)plans[name]=best;
  } finally {api.setTeamSize(type,name,previous);}
 }
 return plans;
}

/** Preparing a squad must not displace productive rank work before the Black Op gate. */
export function bladeburnerRecruitmentTiming(decision,rankGap,preparingTeam,rankRate) {
 if(!(rankGap>0))return decision;
 if(rankRate>0)return {...decision,recruit:false,reason:'Preparing sleeves; earning the remaining '+rankGap.toFixed(1)+' rank before human recruitment'};
 if(!preparingTeam||!Number.isFinite(decision.expectedMs)||decision.expectedMs>120000)return {...decision,recruit:false,reason:'Waiting for rank before human recruitment'};
 return decision;
}

/** Native skill multipliers have diminishing marginal benefit. Bank points rather than buying unrelated skills. */
export function nextBladeburnerProgressSkill(names,levels,costs,points,weights,context,legacy,rankRate=null) {
 const rankReady=context?.target&&Number.isFinite(context.rank)&&Number.isFinite(context.requiredRank)&&context.rank>=context.requiredRank;
 const preparing=!!context?.target&&Number.isFinite(context.rank)&&context.rank>0&&Number.isFinite(context.requiredRank)&&context.requiredRank>0&&context.rank>=.9*context.requiredRank;
 const stamina=context?.stamina,difficulty=context?.metadata?.baseDifficulty;
 if((rankReady||preparing)&&Array.isArray(stamina)&&stamina.length===2&&stamina.every(Number.isFinite)&&stamina[0]>=0&&stamina[1]>0&&Number.isFinite(difficulty)&&difficulty>0&&Number.isFinite(context.threshold)&&context.threshold>0&&context.threshold<=1){
  const cost=.285*(Math.pow(difficulty,.28)+difficulty/650);
  const fullChanceCeiling=Math.min(1,Math.max(0,stamina[1]-cost)/(.5*stamina[1]));
  if(fullChanceCeiling<context.threshold){
   const gap=cost/(1-context.threshold/2)-stamina[1];
   const cyber=levels["Cyber's Edge"],reaper=levels.Reaper,evasive=levels['Evasive System'];
   const agility=context.skills?.agility,mult=context.maxStaminaMultiplier;
   const agilityKnown=[cyber,reaper,evasive,agility,mult].every(Number.isFinite)&&cyber>=0&&reaper>=0&&evasive>=0&&agility>0&&mult>0;
   const effective=agilityKnown?agility*(1+.02*reaper)*(1+.04*evasive):null;
   let best=null,bestValue=0;
   for(const name of ["Cyber's Edge",'Reaper','Evasive System']){
    const price=costs[name],level=levels[name];
    if(!names.includes(name)||!Number.isFinite(price)||price<=0||!Number.isFinite(level)||level<0)continue;
    let gain=0;
    if(name==="Cyber's Edge")gain=stamina[1]*.02/(1+.02*level);
    else if(agilityKnown){
     const step=name==='Reaper'?.02:.04;
     const after=effective*(1+step/(1+step*level));
     // Existing training stamina is retained; only the agility-derived term changes.
     gain=(Math.pow(after,.8)-Math.pow(effective,.8))*(1+.02*cyber)*mult;
    }
    const value=Math.min(gap,gain)/price;
    if(Number.isFinite(value)&&value>bestValue){best=name;bestValue=value;}
   }
   if(best)return costs[best]<=points?best:null;
  }
 }
 const blocked=(rankReady||preparing)&&
  Array.isArray(context.chance)&&context.chance.length>=2&&context.chance.every(Number.isFinite)&&context.chance[0]>=0&&context.chance[1]>=context.chance[0]&&context.chance[0]<context.threshold;
 if(!blocked){
  // Compare sustained rank throughput across available combat actions. Unknown
  // context retains the existing selector; no hypothetical upgrades are bought.
  const stats=context?.skills,mults=context?.mults;
  const quoted=Array.isArray(context?.throughputs)?context.throughputs:[context?.throughput];
  const actions=quoted.filter(a=>a&&['Contracts','Operations'].includes(a.type)&&[a.difficulty,a.gain,a.loss,a.chance].every(Number.isFinite)&&a.difficulty>0&&a.gain>0&&a.loss>=0&&a.chance>0&&a.chance<=1);
  if(actions.length&&[stats?.agility,stats?.dexterity,stamina?.[1],mults?.bladeburner_stamina_gain,context?.threshold].every(Number.isFinite)&&context.threshold>0&&context.threshold<=1&&stats.agility>0&&stats.dexterity>0&&stamina[1]>0&&mults.bladeburner_stamina_gain>0){
   const score=(upgrade,a,count=1)=>{
    const level=name=>(levels[name]||0)+(upgrade===name?count:0);
    const reaper=1+.02*level('Reaper'),evasive=1+.04*level('Evasive System'),cyber=1+.02*level("Cyber's Edge");
    const agility=stats.agility*reaper*evasive,dexterity=stats.dexterity*reaper*evasive;
    const oldAgility=stats.agility*(1+.02*(levels.Reaper||0))*(1+.04*(levels['Evasive System']||0));
    const oldCyber=1+.02*(levels["Cyber's Edge"]||0);
    let maximum=stamina[1]*cyber/oldCyber;
    if(['Reaper','Evasive System'].includes(upgrade)&&Number.isFinite(context.maxStaminaMultiplier)&&context.maxStaminaMultiplier>0)
     maximum+=(agility**.8-oldAgility**.8)*cyber*context.maxStaminaMultiplier;
    const regen=(.0085+maximum/70000)*agility**.17*cyber*mults.bladeburner_stamina_gain;
    const cost=.285*(a.difficulty**.28+a.difficulty/650);
    const statFactor=.5*(agility**.04+dexterity**.035+agility/10000+dexterity/10000);
    const seconds=Math.ceil(Math.max(1,a.difficulty/10*(1-.01*level('Overclock'))/statFactor));
    const recovery=Math.max(0,cost-regen*seconds)/(regen+maximum*.01/60);
    let chance=a.chance;
    const bonus=upgrade==="Blade's Intuition"?3:upgrade==='Digital Observer'&&a.type==='Operations'?4:upgrade==='Tracer'&&a.type==='Contracts'?4:upgrade==='Cloak'&&a.isStealth===true?5.5:upgrade==='Short-Circuit'&&a.isKill===true?5.5:0;
    if(bonus)chance=Math.min(1,chance*(1+bonus/(100+bonus*(levels[upgrade]||0))));
    // A newly unlocked action competes only after reaching the safety threshold.
    if(chance<context.threshold)return 0;
    if(typeof rankRate==='function'&&a.metrics){
     const oldDexterity=stats.dexterity*(1+.02*(levels.Reaper||0))*(1+.04*(levels['Evasive System']||0));
     const oldFactor=.5*(oldAgility**.04+oldDexterity**.035+oldAgility/10000+oldDexterity/10000);
     const oldSeconds=Math.ceil(Math.max(1,a.difficulty/10*(1-.01*(levels.Overclock||0))/oldFactor));
     const metrics={...a.metrics,time:a.metrics.time*seconds/oldSeconds,staminaCost:cost,staminaRegen:regen,hrcRegen:maximum*.01/60};
     const value=rankRate([chance,chance],metrics);return Number.isFinite(value)?Math.max(0,value):0;
    }
    return Math.max(0,(chance*a.gain-(1-chance)*a.loss)/(seconds+recovery));
   };
   const bestRate=(upgrade,count=1)=>Math.max(0,...actions.map(a=>score(upgrade,a,count)));
   const baseline=bestRate(null);let best=null,value=0;
   for(const name of names){
    if(!['Overclock','Reaper','Evasive System',"Cyber's Edge","Blade's Intuition",'Digital Observer','Tracer','Cloak','Short-Circuit'].includes(name)||name==='Overclock'&&levels[name]>=90||!Number.isFinite(levels[name])||levels[name]<0||!Number.isFinite(costs[name])||costs[name]<=0||costs[name]>points)continue;
    const gain=(bestRate(name)-baseline)/costs[name];
    if(Number.isFinite(gain)&&gain>value){best=name;value=gain;}
   }
   if(names.includes('Overclock')&&Number.isSafeInteger(levels.Overclock))for(const bundle of context.overclockBundles||[]){
    if(!Number.isSafeInteger(bundle?.count)||bundle.count<2||levels.Overclock+bundle.count>90||!Number.isFinite(bundle.cost)||bundle.cost<=0||bundle.cost>points)continue;
    const gain=(bestRate('Overclock',bundle.count)-baseline)/bundle.cost;
    if(Number.isFinite(gain)&&gain>value){best={name:'Overclock',count:bundle.count,cost:bundle.cost};value=gain;}
   }
   // At the native duration floor, save points for a useful future upgrade.
   return best;
  }
  return legacy(names,levels,costs,points,weights);
 }
 const bonuses={"Blade's Intuition":3,'Digital Observer':4,Reaper:2,'Evasive System':4};
 if(context.metadata?.isKill)bonuses['Short-Circuit']=5.5;
 if(context.metadata?.isStealth)bonuses.Cloak=5.5;
 // Above, stamina upgrades compete by useful max-stamina gain per point; otherwise compare competence.
 // Competence is a weighted sum of effective skills raised to each operation's decay exponent.
 const competence=(upgrade=null)=>{
  if(!context.skills||!context.metadata?.weights||!context.metadata?.decays)return null;
  let value=0;
  for(const [stat,weight]of Object.entries(context.metadata.weights)){
   const decay=context.metadata.decays[stat],raw=context.skills[stat];
   if(!Number.isFinite(weight)||weight<0||!Number.isFinite(decay)||decay<0||!Number.isFinite(raw)||raw<0)return null;
   let effective=raw;
   if(['strength','defense','dexterity','agility'].includes(stat))effective*=1+.02*((levels.Reaper||0)+(upgrade==='Reaper'?1:0));
   if(['dexterity','agility'].includes(stat))effective*=1+.04*((levels['Evasive System']||0)+(upgrade==='Evasive System'?1:0));
   value+=weight*effective**decay;
  }
  return value>0&&Number.isFinite(value)?value:null;
 };
 const baseline=competence();
 let best=null,score=0,immediate=null,immediateScore=0;
 const chanceGap=context.chance[0]>0?Math.max(0,context.threshold/context.chance[0]-1):null;
 for(const name of names){
  const cost=costs[name],bonus=bonuses[name],level=levels[name];
  if(!(cost>0&&cost<=points&&Number.isFinite(cost)&&bonus>0&&Number.isFinite(level)&&level>=0))continue;
  const combat=name==='Reaper'||name==='Evasive System',improved=combat&&baseline?competence(name):null;
  const gain=improved!==null?improved/baseline-1:(bonus/(100+bonus*level))*(name==='Evasive System'?.5:1);
  const marginal=(chanceGap===null?gain:Math.min(gain,chanceGap))/cost;
  if(rankReady&&chanceGap!==null&&gain>=chanceGap&&marginal>immediateScore){immediate=name;immediateScore=marginal;}
  if(marginal>score){best=name;score=marginal;}
 }
 // An upgrade which opens the Black Op now takes priority over delayed XP growth.
 if(immediate)return immediate;
 const g=context.growth,hd=levels.Hyperdrive,price=costs.Hyperdrive;
 const horizon=context.growthHorizonSeconds??300;
 if(rankReady&&baseline&&chanceGap>0&&names.includes('Hyperdrive')&&Number.isSafeInteger(hd)&&hd>=0&&Number.isFinite(price)&&price>0&&price<=points&&
  g?.known===true&&g.target===context.target&&g.hyperdrive===hd&&g.effective?.strength===1+.02*(levels.Reaper||0)&&
  g.effective?.dexterity===(1+.02*(levels.Reaper||0))*(1+.04*(levels['Evasive System']||0))&&
  Number.isFinite(horizon)&&horizon>=30&&horizon<=900&&context.exp){
  let before=0,after=0,valid=true;
  const activeSeconds=Number.isFinite(g.supplySeconds)&&g.supplySeconds>0?Math.min(horizon,g.supplySeconds):0;
  const ratio=.1/(1+.1*hd);
  for(const [stat,weight]of Object.entries(context.metadata.weights)){
   if(!weight)continue;
   const decay=context.metadata.decays[stat],xp=context.exp[stat],skill=context.skills[stat],own=g.rates?.[stat]??0,pool=g.pool?.[stat]??0;
   const base=Number.isFinite(xp)?32*Math.log(xp+534.6)-200:NaN;
   if(![decay,xp,skill,own,pool,base].every(Number.isFinite)||decay<0||xp<0||skill<=1||own<0||pool<0||base<=0){valid=false;break;}
   // The observed pool includes the player's contribution. Do not add it twice.
   const total=Math.max(own,pool),mult=skill/base;
   const effective=['strength','defense','dexterity','agility'].includes(stat)?(1+.02*(levels.Reaper||0))*(['dexterity','agility'].includes(stat)?1+.04*(levels['Evasive System']||0):1):1;
   const level=extra=>Math.max(1,mult*(32*Math.log(xp+total*horizon+extra*activeSeconds+534.6)-200));
   before+=weight*(level(0)*effective)**decay;after+=weight*(level(own*ratio)*effective)**decay;
  }
  // Half credit prices growth which arrives gradually, rather than an immediate success bonus.
  const value=valid&&before>0?.5*Math.min(chanceGap,Math.max(0,after/before-1))/price:0;
  if(Number.isFinite(value)&&value>score)return 'Hyperdrive';
 }
 return best;
}
/** Training is bounded to two minutes per rolling ten minutes; analysis remains useful after its cap. */
export function bladeburnerDevelopmentAction({rank,requiredRank,chance,threshold=.99,remainingMs=0,enabled=true,trainingEnabled=true,allowBeforeRank=false}={}) {
 if(!enabled||!Number.isFinite(rank)||!Number.isFinite(requiredRank)||rank<0||requiredRank<0||rank<requiredRank&&!allowBeforeRank||!Array.isArray(chance)||chance.length<2||!chance.every(Number.isFinite)||chance[0]<0||chance[1]<chance[0]||chance[0]>=threshold)return null;
 if(chance[1]>=threshold&&chance[1]-chance[0]>.01)return 'Field Analysis';
 return trainingEnabled&&Number.isFinite(remainingMs)&&remainingMs>=30000?'Training':null;
}

/** Count observed training once; carry totals across controller reloads without charging offline gaps. */
export function bladeburnerTrainingProgress(saved,reset,now,pid,training) {
 const valid=saved?.nodeReset===reset.lastNodeReset&&saved?.augReset===reset.lastAugReset&&Number.isFinite(saved.at)&&saved.at<=now;
 const total=valid&&Number.isFinite(saved.trainingTotal)?Math.max(0,saved.trainingTotal):0;
 const elapsed=valid&&saved.pid===pid&&saved.training&&training?Math.max(0,now-saved.at):0;
 return {trainingTotal:total+elapsed/30000,elapsedMs:elapsed};
}

/** Reuse synchronous probes briefly; invalidation inputs are collected from the live API. */
export function bladeburnerPlanCacheValid(cache,key,now,ttl=10000) {
 return !!(cache&&cache.key===key&&Number.isFinite(now)&&Number.isFinite(cache.at)&&now>=cache.at&&now-cache.at<ttl);
}

/** Success counters detect bonus-time completions even if replenishment hides the count decrease. */
export function bladeburnerActionCompleted(previous,current) {
 if(!previous||!current||previous.name!==current.name||previous.type!==current.type)return false;
 return Number.isFinite(previous.successes)&&Number.isFinite(current.successes)&&current.successes>previous.successes||
  Number.isFinite(previous.progress)&&Number.isFinite(current.progress)&&current.progress<previous.progress;
}

/** Lower-bound chance after native stamina deduction; ignore future regeneration conservatively.
 * Capped native chance hides surplus competence, so this deliberately never increases the estimate. */
export function bladeburnerStaminaChance(chance,stamina,difficulty) {
 if(!Array.isArray(chance)||chance.length!==2||!chance.every(Number.isFinite)||chance[0]<0||chance[1]<chance[0]||chance[1]>1||!Array.isArray(stamina)||!stamina.every(Number.isFinite)||stamina.length!==2||stamina[0]<0||stamina[1]<=0||!Number.isFinite(difficulty)||difficulty<=0)return null;
 const cost=.285*(Math.pow(difficulty,.28)+difficulty/650);
 const before=Math.min(1,stamina[0]/(.5*stamina[1]));
 const after=Math.min(1,Math.max(0,stamina[0]-cost)/(.5*stamina[1]));
 const ratio=before>0?Math.min(1,after/before):0;
 return chance.map(p=>p*ratio);
}

/** Uncertainty on another mission cannot hide reliable rank work. Fractional stock cannot start work. */
export function bladeburnerActionCandidates(names,counts,chances,threshold=.99) {
 const known=names.filter(name=>Number.isFinite(counts[name])&&counts[name]>=1&&Array.isArray(chances[name])&&chances[name].length===2&&chances[name].every(Number.isFinite)&&chances[name][0]>=0&&chances[name][1]>=chances[name][0]&&chances[name][1]<=1);
 return {reliable:known.filter(name=>chances[name][0]>=threshold),uncertain:known.filter(name=>chances[name][0]<threshold&&chances[name][1]>=threshold)};
}

/** Non-mutating next upgrade quote using the same progression selector as the purchase worker. */
export function bladeburnerSkillGoal(api,names,weights,choose,context=null,quoteContext=null) {
 try {
 const points=api.getSkillPoints();
 if(!Number.isFinite(points)||points<0)return {state:'unavailable'};
 const levels=Object.fromEntries(names.map(name=>[name,api.getSkillLevel(name)]));
 const costs=Object.fromEntries(names.map(name=>[name,api.getSkillUpgradeCost(name)]));
 const choice=choose(names,levels,costs,Infinity,weights,quoteContext?quoteContext(api,names,context):context?context():null);
 if(!choice)return {state:'no-useful-upgrade',points};
 const name=typeof choice==='string'?choice:choice.name,count=typeof choice==='string'?1:choice.count;
 if(!Number.isSafeInteger(count)||count<1||count>90||count>1&&(name!=='Overclock'||levels[name]+count>90))return {state:'unavailable'};
 if(!names.includes(name)||!Number.isFinite(costs[name])||costs[name]<=0||!Number.isFinite(levels[name])||levels[name]<0)
  return {state:'unavailable'};
 const cost=count===1?costs[name]:api.getSkillUpgradeCost(name,count);
 if(!Number.isFinite(cost)||cost<=0)return {state:'unavailable'};
 return {state:'target',name,...(count>1?{count}:{}),level:levels[name],points,cost,shortfall:Math.max(0,cost-points)};
 }catch(error){return {state:'unavailable',reason:String(error).slice(0,200)};}
}

/** Recover enough for a useful combat cycle, including the post-cost success roll. */
export function bladeburnerRecoveryTarget(stamina,actions,threshold=.99,fallback=.6) {
 if(!Array.isArray(stamina)||stamina.length!==2||!stamina.every(Number.isFinite)||stamina[0]<0||stamina[1]<=0||!Number.isFinite(threshold)||threshold<=0||threshold>1)return fallback;
 const maximum=stamina[1],penalty=Math.min(1,stamina[0]/(.5*maximum));
 if(!(penalty>0))return fallback;
 let best=null;
 for(const a of actions){
  if(!a||![a.chance,a.cost,a.time,a.gain,a.loss].every(Number.isFinite)||a.chance<0||a.chance>1||a.cost<0||a.time<=0||a.gain<=0||a.loss<0)continue;
  const recovered=Math.min(1,a.chance/penalty);
  if(recovered*Math.min(1,Math.max(0,maximum-a.cost)/(.5*maximum))<threshold)continue;
  const rate=(recovered*a.gain-(1-recovered)*a.loss)/a.time;
  if(!best||rate>best.rate)best={rate,cost:a.cost};
 }
 return best?Math.min(1,Math.max(fallback,.5+best.cost/maximum+Math.min(.1,best.cost/maximum))):fallback;
}

/** Compare native city estimates without allowing an engine tick in the temporary city. */
export function probeBladeburnerCities(api,cities,actions,threshold,allowed,difficulty,rate,forecast,recovery,planner=null,maintenanceReader=null,scoreFactory=null,cityScorer=null) {
 if(!Array.isArray(cities)||!cities.length||cities.length>6||cities.some(c=>typeof c!=='string')||!Array.isArray(actions)||!Number.isFinite(threshold)||threshold<0||threshold>1||!allowed())return null;
 const original=api.getCity(),rows=[];
 try {
  for(const city of cities){
   if(!allowed())return null;
   if(api.getCity()!==city&&api.switchCity(city)!==true)throw Error('City probe rejected');
   let localRecovery=recovery;
   if(recovery?.maintenance){
    if(maintenanceReader)localRecovery={...recovery,...maintenanceReader()};
    else {
     let recruitment=null;
     try{recruitment={chance:api.getActionEstimatedSuccessChance('General','Recruitment')[0],time:api.getActionTime('General','Recruitment')};}catch{}
     // Without a fresh reader, never reuse a city-specific combat cleanup quote.
     localRecovery={...recovery,recruitment,chaosControl:recovery.chaosControl?{...recovery.chaosControl,cleanup:null}:null};
    }
   }
   let best=null;const candidates=[];
   for(const [name,type] of actions){
    if(!allowed())return null;
    const data=difficulty[name];
    if(!data||!['Contracts','Operations'].includes(type)||!(api.getActionCountRemaining(type,name)>=1))continue;
    const actionRate=scoreFactory?scoreFactory(name,type,localRecovery):rate;
    if(typeof actionRate!=='function')continue;
    if(planner){
     // The planner restores levels in its own finally before the city can change.
     const plan=planner(api,[[name,type]],threshold,actionRate,allowed,{...localRecovery,actions:difficulty,retainGrowthVariants:!!cityScorer},forecast,96)[name];
     if(!allowed())return null;
     if(plan&&Number.isFinite(plan.score)&&plan.score>0){
      if(cityScorer)for(const q of plan.variants||[plan])candidates.push({name,type,level:q.level,score:q.score,chance:q.chance,metrics:q.metrics});
      if(!best||plan.score>best.score)best={score:plan.score,action:name,level:plan.level};
     }
     continue;
    }
    const level=api.getActionCurrentLevel(type,name);
    if(!Number.isSafeInteger(level)||level<1)continue;
    const value=data.base*Math.pow(data.factor,level-1);
    const chance=forecast(api.getActionEstimatedSuccessChance(type,name),recovery.stamina,value);
    if(!chance||!Number.isFinite(chance[0])||chance[0]<threshold)continue;
    const time=api.getActionTime(type,name);
    const metrics={level,time,nativeTime:time,gain:api.getActionRankGain(type,name),loss:api.getActionRankLoss(type,name),staminaCost:.285*(Math.pow(value,.28)+value/650),staminaRegen:recovery.regen,hrcRegen:recovery.hrc};
    if(localRecovery?.chaosControl&&data.chaos)metrics.chaosControl={...localRecovery.chaosControl,effect:data.chaos};
    if(localRecovery?.maintenance&&type==='Operations'){
     try{metrics.team=api.getTeamSize(type,name);}catch{metrics.team=null;}
     metrics.recruitment=localRecovery.recruitment;
    }
    const score=actionRate(chance,metrics);
    if(Number.isFinite(score)&&score>0){
     if(cityScorer)candidates.push({name,type,level,score,chance,metrics});
     if(!best||score>best.score)best={score,action:name,level};
    }
   }
   if(typeof cityScorer==='function'){
    if(!allowed())return null;
    const combined=cityScorer(candidates,city);
    if(!allowed())return null;
    if(combined&&Number.isFinite(combined.score)&&combined.score>0&&combined.score>(best?.score||0)&&candidates.some(c=>c.name===combined.action&&c.level===combined.level))best=combined;
   }
   rows.push({city,score:best?.score||0,action:best?.action||null,level:best?.level||null,...(best?.fallback?{fallback:best.fallback,fallbackPairs:best.fallbackPairs}: {})});
  }
  return rows;
 } finally {
  if(api.getCity()!==original&&api.switchCity(original)!==true)throw Error('Could not restore the original Bladeburner city');
 }
}

/** Stay put unless another city has a meaningful positive throughput advantage. */
export function chooseBladeburnerCity(rows,current,margin=.03) {
 if(!Array.isArray(rows)||!rows.length||!Number.isFinite(margin)||margin<0||rows.some(r=>!r||typeof r.city!=='string'||!Number.isFinite(r.score)||r.score<0))return null;
 let best=rows.find(r=>r.city===current)||rows[0];
 for(const row of rows)if(row.score>best.score)best=row;
 if(!(best.score>0))return null;
 const here=rows.find(r=>r.city===current);
 return here&&best.score<=here.score*(1+margin)?here:best;
}

/** Read-only native maintenance quotes. Missing APIs preserve explicit unknowns. */
export function readBladeburnerMaintenance(api,charisma,threshold=50,options={}){
 let chaosControl=null,recruitment=null;
 try{const time=api.getActionTime('General','Diplomacy');if(Number.isFinite(time)&&time>0&&Number.isFinite(charisma)&&charisma>=0&&Number.isFinite(threshold)&&threshold>0)chaosControl={time,charisma,threshold};}catch{}
 try{recruitment={chance:api.getActionEstimatedSuccessChance('General','Recruitment')[0],time:api.getActionTime('General','Recruitment')};}catch{}
 if(chaosControl){
  let sleeveLogRate=0;
  try{
   // Ignore sleeve acceleration. Reduce credit while player bonus time can
   // accelerate Bladeburner fivefold; unknown relative speed earns no credit.
   const bonus=api.getBonusTime();if(!Number.isFinite(bonus)||bonus<0)throw Error('Unknown Bladeburner speed');
   const speed=bonus>=1000?5:1,count=options.sleeves.getNumSleeves();
   if(!Number.isInteger(count)||count<0||count>8)throw Error('Unknown sleeve count');
   for(let i=0;i<count;i++){
    const task=options.sleeves.getTask(i),s=options.sleeves.getSleeve(i);
    if(task?.type!=='BLADEBURNER'||task.actionName!=='Diplomacy'||task.actionType!=='General'||s.shock!==0||s.sync<100||!Number.isFinite(s.sync)||!Number.isFinite(s.skills?.charisma)||s.skills.charisma<=0||!Number.isFinite(task.cyclesNeeded)||task.cyclesNeeded<=0||task.cyclesNeeded*200<chaosControl.time)continue;
    const fraction=Math.min(.99,(Math.pow(s.skills.charisma,.045)+s.skills.charisma/1000)/100);
    sleeveLogRate+=-Math.log1p(-fraction)/(task.cyclesNeeded*200*speed);
   }
  }catch{sleeveLogRate=0;}
  chaosControl.sleeveLogRate=sleeveLogRate;
  try{
   const name='Stealth Retirement Operation',type='Operations',data=options.difficulty?.[name],success=options.success;
   const count=api.getActionCountRemaining(type,name),level=api.getActionCurrentLevel(type,name),team=api.getTeamSize(type,name);
   if(!data||!Number.isSafeInteger(level)||level<1||!Number.isFinite(count)||count<1||team!==0||!Number.isFinite(success)||success<=0||success>1||typeof options.forecast!=='function')throw Error('No safe solo cleanup quote');
   const value=data.base*Math.pow(data.factor,level-1),stamina=api.getStamina(),raw=api.getActionEstimatedSuccessChance(type,name),chance=options.forecast(raw,stamina,value);
   const time=api.getActionTime(type,name),gain=api.getActionRankGain(type,name),loss=api.getActionRankLoss(type,name),staminaCost=.285*(Math.pow(value,.28)+value/650);
   if(!chance||chance[0]<success||chance[0]<=.99||![time,gain,loss,staminaCost].every(Number.isFinite)||time<=0||gain<=0||loss<0||staminaCost<0)throw Error('Cleanup unavailable');
   chaosControl.cleanup={team:0,count,time,gain,loss,chance:chance[0],rawChance:raw[0],staminaCost,stamina,threshold:success};
  }catch{chaosControl.cleanup=null;}
 }
 return {maintenance:true,chaosControl,recruitment};
}

/** Only whole missions above the configured floor can fund ordinary rank work. */
export function bladeburnerSurplusAvailable(count,reserve,guardReady=false){
 return guardReady===true&&Number.isFinite(count)&&count>=0&&Number.isSafeInteger(reserve)&&reserve>=0&&reserve<=1000000&&Math.floor(count)>reserve;
}

/** A small parent-owned worker protects native auto-repeat while the planner awaits other workers. */
export async function bladeburnerStockGuard(ns,ownerPid,nodeReset,augReset,intentFile,readyFile){
 const name='Stealth Retirement Operation',type='Operations';
 let ownedFarm=false;
 const stop=()=>{if(ownedFarm&&ns.bladeburner.getCurrentAction()?.name===name)ns.bladeburner.stopBladeburnerAction();};
 try{
  const reset=ns.getResetInfo();
  if(reset.lastNodeReset!==nodeReset||reset.lastAugReset!==augReset||!ns.isRunning(ownerPid))return;
  if(typeof ns.bladeburner.nextUpdate!=='function')throw Error('Native update notifications unavailable');
  await ns.write(readyFile,JSON.stringify({ownerPid,pid:ns.pid,nodeReset,augReset}),'w');
  while(true){
   const current=ns.getResetInfo();
   if(current.lastNodeReset!==nodeReset||current.lastAugReset!==augReset)return;
   let intent;try{intent=JSON.parse(ns.read(intentFile));}catch{}
   // A replacement controller owns its own lease. Do not stop its actions.
   if(intent&&intent.ownerPid!==ownerPid)return;
   if(!ns.isRunning(ownerPid)){stop();return;}
   const now=Date.now(),valid=intent&&intent.nodeReset===nodeReset&&intent.augReset===augReset&&Number.isFinite(intent.at)&&intent.at<=now&&Number.isFinite(intent.expiresAt)&&intent.expiresAt>now&&intent.expiresAt-now<=30000&&Number.isSafeInteger(intent.reserve)&&intent.reserve>=0&&intent.reserve<=1000000;
   if(!valid){if(ownedFarm){stop();return;}}
   else if(intent.mode==='cleanup'){ownedFarm=false;}
   else if(intent.mode==='farm'){
    ownedFarm=true;
    const action=ns.bladeburner.getCurrentAction();
    if(action?.type===type&&action.name===name){
     const count=ns.bladeburner.getActionCountRemaining(type,name);
     if(!Number.isFinite(count)||Math.floor(count)<=intent.reserve){stop();return;}
    }
   }else if(ownedFarm){stop();ownedFarm=false;}
   await ns.bladeburner.nextUpdate();
  }
 }catch(error){
  try{stop();}catch{}
  ns.print('Stealth Retirement reserve guard unavailable: '+String(error));
 }finally{try{const ready=JSON.parse(ns.read(readyFile));if(ready.pid===ns.pid&&ready.ownerPid===ownerPid&&ready.nodeReset===nodeReset&&ready.augReset===augReset)ns.rm(readyFile,'home');}catch{}}
}
