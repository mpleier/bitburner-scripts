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
 const [low,high]=chance;if(low>=threshold)return 0;
 if(!(low>0)||high<low)return null;
 const need=Math.ceil(Math.expm1(20*Math.log(threshold/low)));
 return Number.isFinite(need)&&need<=cap?Math.max(0,need):null;
}
/** Executed in a guarded worker; restore the prior assignment if recruitment cannot help. */
export function prepareBladeburnerTeam(api,name,threshold,cap,required){
 const type='Black Operations',available=api.getTeamSize(),previous=api.getTeamSize(type,name);
 if(!Number.isInteger(available)||available<0||!Number.isInteger(previous)||previous<0)return {state:'unavailable'};
 let modified=false;
 try{
  if(api.setTeamSize(type,name,0)!==0)return {state:'unavailable'};modified=true;
  const baseline=api.getActionEstimatedSuccessChance(type,name),estimate=required(baseline,threshold,cap);
  const limit=Math.min(available,cap);
  const meets=chance=>Array.isArray(chance)&&Number.isFinite(chance[0])&&chance[0]>=threshold;
  let need=estimate;
  if(meets(baseline))need=0;
  else if(limit>0) {
   if(api.setTeamSize(type,name,limit)!==limit)throw Error('Team assignment rejected');
   if(meets(api.getActionEstimatedSuccessChance(type,name))) {
    let low=0,high=limit;
    // Use actual native estimates to find the smallest available useful squad.
    while(low<high){const mid=low+Math.floor((high-low)/2);if(api.setTeamSize(type,name,mid)!==mid)throw Error('Team assignment rejected');if(meets(api.getActionEstimatedSuccessChance(type,name)))high=mid;else low=mid+1;}
    need=low;
   } else if(estimate!==null&&estimate<=limit)throw Error('Assigned team did not reach the success threshold');
  }
  if(need===null){api.setTeamSize(type,name,previous);modified=false;return {state:'no-useful-team',available,baseline,reason:'Current success estimate cannot reach the target within the team cap'};}
  const assigned=api.setTeamSize(type,name,Math.min(available,need));
  if(assigned!==Math.min(available,need))throw Error('Team assignment rejected');
  const chance=api.getActionEstimatedSuccessChance(type,name);
  if(available>=need&&!meets(chance))throw Error('Assigned team did not reach the success threshold');
  modified=false;
  return {state:available<need?'needs-recruitment':'ready',available,required:need,assigned,baseline,reason:available<need?'More team members can unlock this Black Op':'Required team is ready'};
 }catch(error){if(modified)try{api.setTeamSize(type,name,previous);}catch{}return {state:'unavailable',error:String(error)};}
}

/** Retain recruitment intervals for a real rolling hour, including across restarts. */
export function bladeburnerRecruitmentBudget(saved,nodeReset,now,previousAt=now,recruiting=false){
 const cutoff=now-3600000;
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
 return (probability*metrics.gain-(1-probability)*metrics.loss)*1000/metrics.time;
}
/** Black Ops retain progression priority; missing metrics retain the existing action order. */
export function rankBladeburnerActions(names,chances,metrics,nextBlackOp,rate) {
 const result=[...names];
 if(!result.every(name=>rate(chances[name],metrics[name])!==null))return result;
 return result.sort((a,b)=>a===b?0:a===nextBlackOp?-1:b===nextBlackOp?1:rate(chances[b],metrics[b])-rate(chances[a],metrics[a]));
}
/** Self-contained for one guarded worker instead of several workers per skill level. */
export function spendBladeburnerSkills(api,names,weights,choose,allowed) {
 const purchased=[];
 for(let purchases=0;purchases<100;purchases++) {
  if(!allowed())break;
  const points=api.getSkillPoints();if(!(points>0))break;
  const levels=Object.fromEntries(names.map(name=>[name,api.getSkillLevel(name)]));
  const costs=Object.fromEntries(names.map(name=>[name,api.getSkillUpgradeCost(name)]));
  const name=choose(names,levels,costs,points,weights);if(!name)break;
  if(!allowed()||!api.upgradeSkill(name))break;
  purchased.push(name);
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
export function planBladeburnerLevels(api,actions,threshold,rate,allowed) {
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
   const chance=api.getActionEstimatedSuccessChance(type,name);
   const metrics={time:api.getActionTime(type,name),gain:api.getActionRankGain(type,name),loss:api.getActionRankLoss(type,name)};
   const score=rate(chance,metrics),result=score!==null&&chance[0]>=threshold?{level,chance,metrics,score}:null;
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
export function startBladeburnerPlannedAction(api,type,name,plan,threshold,rankRequired,teamRequired,allowed) {
 if(!allowed())return false;
 let previous,restore=false;
 try {
  if(plan&&['Contracts','Operations'].includes(type)) {
   if(!Number.isSafeInteger(plan.level)||plan.level<1||plan.level>api.getActionMaxLevel(type,name))return false;
   previous={level:api.getActionCurrentLevel(type,name),auto:api.getActionAutolevel(type,name)};restore=true;
   api.setActionAutolevel(type,name,false);api.setActionLevel(type,name,plan.level);
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return false;
  }
  if(type==='Black Operations') {
   const chance=api.getActionEstimatedSuccessChance(type,name);
   if(api.getRank()<rankRequired||!Array.isArray(chance)||!Number.isFinite(chance[0])||chance[0]<threshold)return false;
  }
  if(name==='Recruitment'&&api.getTeamSize()>=teamRequired)return false;
  if(!allowed())return false;
  const success=!!api.startAction(type,name);
  if(success)restore=false;
  return success;
 } finally {
  if(restore){try{api.setActionLevel(type,name,previous.level);}finally{api.setActionAutolevel(type,name,previous.auto);}}
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
