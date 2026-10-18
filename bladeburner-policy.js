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
export function bladeburnerRankRate(chance,metrics) {
 if(!Array.isArray(chance)||!Number.isFinite(chance[0])||!metrics||!Number.isFinite(metrics.time)||metrics.time<=0||!Number.isFinite(metrics.gain)||metrics.gain<0||!Number.isFinite(metrics.loss)||metrics.loss<0)return null;
 const probability=Math.max(0,Math.min(1,chance[0]));
 let recoveryMs=0;
 if([metrics.staminaCost,metrics.staminaRegen,metrics.hrcRegen].every(Number.isFinite)&&metrics.staminaCost>=0&&metrics.staminaRegen>=0&&metrics.hrcRegen>=0){
  const deficit=Math.max(0,metrics.staminaCost-metrics.staminaRegen*(metrics.nativeTime??metrics.time)/1000);
  const recoveryRate=metrics.staminaRegen+metrics.hrcRegen;
  if(deficit>0&&recoveryRate<=0)return 0;
  if(deficit>0)recoveryMs=1000*deficit/recoveryRate;
 }
 return (probability*metrics.gain-(1-probability)*metrics.loss)*1000/(metrics.time+recoveryMs);
}
/** Black Ops retain progression priority; missing metrics retain the existing action order. */
export function rankBladeburnerActions(names,chances,metrics,nextBlackOp,rate) {
 const result=[...names];
 if(!result.every(name=>rate(chances[name],metrics[name])!==null))return result;
 return result.sort((a,b)=>a===b?0:a===nextBlackOp?-1:b===nextBlackOp?1:rate(chances[b],metrics[b])-rate(chances[a],metrics[a]));
}
/** Self-contained for one guarded worker instead of several workers per skill level. */
export function spendBladeburnerSkills(api,names,weights,choose,allowed,context=null) {
 const purchased=[];
 for(let purchases=0;purchases<100;purchases++) {
  if(!allowed())break;
  const points=api.getSkillPoints();if(!(points>0))break;
  const levels=Object.fromEntries(names.map(name=>[name,api.getSkillLevel(name)]));
  const costs=Object.fromEntries(names.map(name=>[name,api.getSkillUpgradeCost(name)]));
  const name=choose(names,levels,costs,points,weights,context?context():null);if(!name)break;
  if(!allowed()||!api.upgradeSkill(name))break;
  purchased.push(name);
  // Native max stamina updates on the next engine tick, not during this synchronous batch.
  if(["Cyber's Edge","Reaper","Evasive Systems"].includes(name))break;
 }
 return purchased;
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
export function planBladeburnerLevels(api,actions,threshold,rate,allowed,recovery=null,forecast=null) {
 const plans={};
 for(const [name,type]of actions) {
  if(!allowed())break;
  if(!['Contracts','Operations'].includes(type))continue;
  const currentLevel=api.getActionCurrentLevel(type,name),maximum=api.getActionMaxLevel(type,name),autoLevel=api.getActionAutolevel(type,name);
  if(!Number.isSafeInteger(currentLevel)||!Number.isSafeInteger(maximum)||currentLevel<1||maximum<currentLevel)continue;
  const cache=new Map();
  const probe=level=>{
   if(cache.has(level))return cache.get(level);
   if(!allowed())return null;
   api.setActionLevel(type,name,level);
   let chance=api.getActionEstimatedSuccessChance(type,name);
   const metrics={time:api.getActionTime(type,name),gain:api.getActionRankGain(type,name),loss:api.getActionRankLoss(type,name)};
   const data=recovery?.actions?.[name];
   if(data&&[data.base,data.factor,recovery.regen,recovery.hrc].every(Number.isFinite)&&data.base>0&&data.factor>=1&&recovery.regen>=0&&recovery.hrc>=0){
    const difficulty=data.base*Math.pow(data.factor,level-1);
    if(forecast)chance=forecast(chance,recovery.stamina,difficulty);
    Object.assign(metrics,{nativeTime:metrics.time,staminaCost:.285*(Math.pow(difficulty,.28)+difficulty/650),staminaRegen:recovery.regen,hrcRegen:recovery.hrc});
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
   for(const level of candidates){const candidate=probe(level);if(candidate&&(!best||candidate.score>best.score||candidate.score===best.score&&candidate.level<best.level))best=candidate;}
   if(best)plans[name]={...best,currentLevel,autoLevel,maxSafeLevel:lower,probes:cache.size};
  } finally { api.setActionLevel(type,name,currentLevel); }
 }
 return plans;
}

/** Commit a selected level only at action start, restoring settings if the start fails. */
export function startBladeburnerPlannedAction(api,type,name,plan,threshold,rankRequired,teamRequired,allowed,forecast=null,difficulty=null) {
 if(!allowed())return false;
 let previous,restore=false;
 try {
  if(plan&&['Contracts','Operations'].includes(type)) {
   if(!Number.isSafeInteger(plan.level)||plan.level<1||plan.level>api.getActionMaxLevel(type,name))return false;
   previous={level:api.getActionCurrentLevel(type,name),auto:api.getActionAutolevel(type,name),team:type==='Operations'&&plan.team!==undefined?api.getTeamSize(type,name):null};restore=true;
   if(type==='Operations'&&plan.team!==undefined){
    if(!Number.isInteger(plan.team)||plan.team<0||plan.team>Math.max(0,api.getTeamSize()-teamRequired))return false;
    if(api.setTeamSize(type,name,plan.team)!==plan.team)return false;
   }
   api.setActionAutolevel(type,name,false);api.setActionLevel(type,name,plan.level);
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return false;
  }
  if(type==='Black Operations') {
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(api.getRank()<rankRequired||!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return false;
  }
  if(forecast&&['Contracts','Operations','Black Operations'].includes(type)){
   const data=difficulty?.[name];
   if(!data||![data.base,data.factor].every(Number.isFinite)||data.base<=0||data.factor<1)return false;
   const level=type==='Black Operations'?1:api.getActionCurrentLevel(type,name);
   const projected=forecast(api.getActionEstimatedSuccessChance(type,name),api.getStamina(),data.base*Math.pow(data.factor,level-1));
   if(!projected||projected[0]<threshold)return false;
  }
  if(name==='Recruitment'&&api.getTeamSize()>=teamRequired)return false;
  if(!allowed())return false;
  const success=!!api.startAction(type,name);
  if(success)restore=false;
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
   for(let team=1;team<=Math.min(3,spare,cap)&&Number.isFinite(replacementMs)&&allowed();team++) {
    if(api.setTeamSize(type,name,team)!==team)break;
    const candidate=planner(api,[[name,type]],threshold,rate,allowed,recovery,forecast)[name];if(!candidate)continue;
    const probability=Math.max(0,Math.min(1,candidate.chance[0]));
    const casualties=(probability*Math.ceil(team/2)+(1-probability)*team)/2;
    const metrics={...candidate.metrics,nativeTime:candidate.metrics.time,time:candidate.metrics.time+casualties*replacementMs};
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
export function nextBladeburnerProgressSkill(names,levels,costs,points,weights,context,legacy) {
 const rankReady=context?.target&&Number.isFinite(context.rank)&&Number.isFinite(context.requiredRank)&&context.rank>=context.requiredRank;
 const stamina=context?.stamina,difficulty=context?.metadata?.baseDifficulty;
 if(rankReady&&Array.isArray(stamina)&&stamina.length===2&&stamina.every(Number.isFinite)&&stamina[0]>=0&&stamina[1]>0&&Number.isFinite(difficulty)&&difficulty>0&&Number.isFinite(context.threshold)&&context.threshold>0&&context.threshold<=1){
  const cost=.285*(Math.pow(difficulty,.28)+difficulty/650);
  const fullChanceCeiling=Math.min(1,Math.max(0,stamina[1]-cost)/(.5*stamina[1]));
  if(fullChanceCeiling<context.threshold){
   const gap=cost/(1-context.threshold/2)-stamina[1];
   const cyber=levels["Cyber's Edge"],reaper=levels.Reaper,evasive=levels['Evasive Systems'];
   const agility=context.skills?.agility,mult=context.maxStaminaMultiplier;
   const agilityKnown=[cyber,reaper,evasive,agility,mult].every(Number.isFinite)&&cyber>=0&&reaper>=0&&evasive>=0&&agility>0&&mult>0;
   const effective=agilityKnown?agility*(1+.02*reaper)*(1+.04*evasive):null;
   let best=null,bestValue=0;
   for(const name of ["Cyber's Edge",'Reaper','Evasive Systems']){
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
 const blocked=context?.target&&Number.isFinite(context.rank)&&Number.isFinite(context.requiredRank)&&context.rank>=context.requiredRank&&
  Array.isArray(context.chance)&&context.chance.length>=2&&context.chance.every(Number.isFinite)&&context.chance[0]>=0&&context.chance[1]>=context.chance[0]&&context.chance[0]<context.threshold;
 if(!blocked)return legacy(names,levels,costs,points,weights);
 const bonuses={"Blade's Intuition":3,'Digital Observer':4,Reaper:2,'Evasive Systems':4};
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
   if(['dexterity','agility'].includes(stat))effective*=1+.04*((levels['Evasive Systems']||0)+(upgrade==='Evasive Systems'?1:0));
   value+=weight*effective**decay;
  }
  return value>0&&Number.isFinite(value)?value:null;
 };
 const baseline=competence();
 let best=null,score=0;
 for(const name of names){
  const cost=costs[name],bonus=bonuses[name],level=levels[name];
  if(!(cost>0&&cost<=points&&Number.isFinite(cost)&&bonus>0&&Number.isFinite(level)&&level>=0))continue;
  const combat=name==='Reaper'||name==='Evasive Systems',improved=combat&&baseline?competence(name):null;
  const gain=improved!==null?improved/baseline-1:(bonus/(100+bonus*level))*(name==='Evasive Systems'?.5:1);
  const marginal=gain/cost;
  if(marginal>score){best=name;score=marginal;}
 }
 return best;
}
/** Training is bounded to two minutes per rolling ten minutes; analysis remains useful after its cap. */
export function bladeburnerDevelopmentAction({rank,requiredRank,chance,threshold=.99,remainingMs=0,enabled=true,trainingEnabled=true}={}) {
 if(!enabled||!Number.isFinite(rank)||!Number.isFinite(requiredRank)||rank<requiredRank||!Array.isArray(chance)||chance.length<2||!chance.every(Number.isFinite)||chance[0]<0||chance[1]<chance[0]||chance[0]>=threshold)return null;
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
export function bladeburnerSkillGoal(api,names,weights,choose,context=null) {
 try {
 const points=api.getSkillPoints();
 if(!Number.isFinite(points)||points<0)return {state:'unavailable'};
 const levels=Object.fromEntries(names.map(name=>[name,api.getSkillLevel(name)]));
 const costs=Object.fromEntries(names.map(name=>[name,api.getSkillUpgradeCost(name)]));
 const name=choose(names,levels,costs,Infinity,weights,context?context():null);
 if(!name)return {state:'no-useful-upgrade',points};
 if(!names.includes(name)||!Number.isFinite(costs[name])||costs[name]<=0||!Number.isFinite(levels[name])||levels[name]<0)
  return {state:'unavailable'};
 return {state:'target',name,level:levels[name],points,cost:costs[name],shortfall:Math.max(0,costs[name]-points)};
 }catch(error){return {state:'unavailable',reason:String(error).slice(0,200)};}
}
