/** Native, optional, read-only quote. Only free crime XP is credited after releasing a support sleeve. */
export function quoteSupportSleeveGrowth(ns,metadata,effective,xpValue){
 try{
  if(!ns.fileExists('Formulas.exe','home')||typeof xpValue!=='function'||!metadata)return null;
  const reset=ns.getResetInfo(),now=Date.now(),p=ns.getPlayer(),o=JSON.parse(ns.read('tasks/sleeve-xp-observation.json'));
  if(o.nodeReset!==reset.lastNodeReset||o.augReset!==reset.lastAugReset||!Number.isFinite(o.observedAt)||o.observedAt>now||now-o.observedAt>=90000||!Array.isArray(o.samples)||o.samples.length<2||!o.pool||!ns.ps('home').some(q=>q.pid===o.pid&&q.filename.replace(/^\//,'')==='sleeve.js'))return null;
  const keys=['strength','defense','dexterity','agility','hacking','charisma'];if(keys.some(k=>!Number.isFinite(o.pool[k])||o.pool[k]<0))return null;
  const context={metadata,player:p,effective,inferLevels:true},members=[];
  const crimes=Object.values(ns.enums.CrimeType).map(name=>({name,stats:ns.singularity.getCrimeStats(name)}));
  const count=ns.sleeve.getNumSleeves();if(!Number.isInteger(count)||count<0||count>8)return null;
  for(let i=0;i<count;i++){
   const s=ns.sleeve.getSleeve(i);if(s.shock!==0||s.sync!==100||ns.sleeve.getTask(i)?.type!=='SUPPORT')continue;
   let best=null;for(const {name,stats}of crimes){
    if(!(Number.isFinite(stats.time)&&stats.time>0&&stats.time<=120000))continue;
    const chance=ns.formulas.work.crimeSuccessChance(s,name),g=ns.formulas.work.crimeGains(s,name);if(!Number.isFinite(chance)||chance<0||chance>1)continue;
    const rates=Object.fromEntries(Object.entries({strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp',hacking:'hackExp',charisma:'chaExp'}).map(([k,v])=>[k,g[v]*(.25+.75*chance)/(stats.time/1000)]));
    if(Object.values(rates).some(v=>!Number.isFinite(v)||v<0))continue;
    const score=xpValue(rates,context);if(score>0&&score>(best?.score||0))best={index:i,crime:name,score,delaySeconds:stats.time/1000};
   }if(best)members.push(best);
  }
  // Existing sleeve XP is an upper-bound baseline cost; no extra future gym purchases are assumed.
  return {at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,members,releaseOrder:members.map(m=>m.index).sort((a,b)=>b-a),poolScore:xpValue(o.pool,context)};
 }catch{return null;}
}

/** Replace one supporting sleeve at a time, paying both foregone player XP and any rank delay. */
export function planSupportReplacement({plan,quote,ownScore,competence,chance,threshold,rankGap,rankEtaMs,requiredRank,horizonSeconds,budgetMs,estimate,decision,now=Date.now()}={}){
 const no=reason=>({recruit:false,reason});
 if(plan?.state!=='ready'||![plan.available,plan.required,plan.supportingSleeves,plan.teamCap].every(Number.isInteger)||plan.available<0||plan.required<=0||plan.required>plan.teamCap||plan.supportingSleeves<=0||plan.supportingSleeves>plan.available||plan.available!==plan.required)return no('No replaceable support squad');
 if(!quote||!Number.isFinite(quote.at)||quote.at>now||now-quote.at>5000||!Array.isArray(quote.members)||!Number.isFinite(quote.poolScore)||quote.poolScore<0)return no('Support XP quote unavailable');
 if(![ownScore,competence,chance,threshold,rankGap,requiredRank,horizonSeconds,budgetMs].every(Number.isFinite)||ownScore<0||competence<=0||chance<=0||chance>=threshold||threshold>1||rankGap<0||horizonSeconds<=0||horizonSeconds>900||budgetMs<=0)return no('No verified stat bottleneck');
 if(rankGap>0&&(!Number.isFinite(rankEtaMs)||rankEtaMs<=0))return no('Rank opportunity cost unknown');
 const humans=plan.available-plan.supportingSleeves;if(humans>=plan.required)return no('Humans already cover the useful squad');
 const sleeve=quote.members.length===plan.supportingSleeves?quote.members.find(m=>m.index===quote.releaseOrder?.[0]&&Number.isInteger(m.index)&&m.index>=0&&m.index<8&&Number.isFinite(m.score)&&m.score>0):null;
 if(!sleeve||typeof decision!=='function')return no('No productive sleeve replacement');
 const totalTarget=plan.available+1,probe=decision({...plan,state:'needs-recruitment',required:totalTarget},estimate?.chance,estimate?.duration,budgetMs,estimate?.progress,plan.supportingSleeves,estimate?.bonusMs);
 if(!probe?.recruit||!Number.isFinite(probe.expectedMs)||probe.expectedMs<=0)return no(probe?.reason||'Recruitment quote unavailable');
 const seconds=probe.expectedMs/1000,delay=sleeve.delaySeconds??0;
 if(!Number.isFinite(delay)||delay<0||delay>120)return no('Crime payout delay unavailable');
 const remaining=horizonSeconds-seconds-delay,baseline=ownScore+quote.poolScore;
 if(!(baseline>0&&remaining>0))return no('Insufficient development horizon');
 // Half credit for the free sleeve's gradual benefit, and the full loss of player mission XP.
 const lost=ownScore*seconds,gained=.5*sleeve.score*remaining,net=gained-lost;
 const gap=competence*(threshold/chance-1),beforeStats=gap/baseline;
 const initial=quote.poolScore*seconds,afterStats=gap<=initial?gap/quote.poolScore:gap<=initial+baseline*delay?seconds+(gap-initial)/baseline:seconds+delay+(gap-initial-baseline*delay)/(baseline+.5*sleeve.score);
 const before=Math.max(rankGap>0?rankEtaMs/1000:0,beforeStats),after=Math.max(rankGap>0?rankEtaMs/1000+seconds:0,afterStats);
 if(net<=Math.max(1e-9,baseline*horizonSeconds*.05)||!(after+2<before)||before>horizonSeconds||after>horizonSeconds)return no('Recruitment does not repay before readiness or the horizon');
 return {...probe,recruit:true,reason:'Replace sleeve support with one human; free XP repays recruitment',totalTarget,requiredHumans:plan.required,available:plan.available,supporting:plan.supportingSleeves,sleeve:sleeve.index,expectedMs:probe.expectedMs,baselineSeconds:before,projectedSeconds:after,secondsSaved:before-after,netGain:net,requiredRank,threshold};
}

/** Self-contained native guard for optional replacement recruitment. Never postpone a ready Black Op. */
export function supportReplacementStartAllowed(ns,q){
 try{
 if(!q||!q.recruit||![q.requiredRank,q.threshold,q.expectedMs,q.secondsSaved].every(Number.isFinite)||q.requiredRank<0||q.threshold<=0||q.threshold>1||!Number.isInteger(q.requiredHumans)||q.requiredHumans<1||!Number.isFinite(q.at)||q.at>Date.now()||Date.now()-q.at>5000||!ns.isRunning(q.ownerPid))return false;
 const r=ns.getResetInfo(),b=ns.bladeburner;if(q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset||!Number.isInteger(q.totalTarget)||q.totalTarget!==q.available+1||!(q.secondsSaved>2)||!(q.expectedMs>0))return false;
 const route=JSON.parse(ns.read('tasks/node-route-plan.json'));if(route.selected!=='bladeburner'||route.nodeReset!==r.lastNodeReset||route.augReset!==r.lastAugReset||!Number.isFinite(route.at)||route.at>Date.now()||Date.now()-route.at>=45000||!ns.isRunning(route.ownerPid))return false;
 const supporting=Array.from({length:ns.sleeve.getNumSleeves()},(_,i)=>ns.sleeve.getTask(i)).filter(t=>t?.type==='SUPPORT').length;
 if(!Number.isInteger(q.sleeve)||q.sleeve<0||q.sleeve>=8||ns.sleeve.getTask(q.sleeve)?.type!=='SUPPORT'||b.getTeamSize()!==q.available||supporting!==q.supporting||b.getTeamSize()-supporting>=q.requiredHumans||!(b.getActionCountRemaining('Black Operations',q.target)>0))return false;
 if(q.evaluationTarget){
  if(typeof q.evaluationTarget!=='string'||q.evaluationTarget===q.target||!(b.getActionCountRemaining('Black Operations',q.evaluationTarget)>0)||b.getRank()>=q.requiredRank&&b.getActionEstimatedSuccessChance('Black Operations',q.target)[0]>=q.threshold)return false;
 }else if(b.getActionEstimatedSuccessChance('Black Operations',q.target)[0]>=q.threshold)return false;
 return true;
 }catch{return false;}
}

/** Synchronous lookahead restores the following Black Op's assignment before any engine tick. */
export function quoteNextSupportTarget(ns,current,next,team,cap,requiredRank,threshold,forecast,allowed){
 if(typeof next!=='string'||!next||next===current||!Number.isInteger(team)||team<1||!Number.isInteger(cap)||team>cap||typeof allowed!=='function'||!allowed())return null;
 const b=ns.bladeburner,type='Black Operations';let original=null;
 try{
  if(/black/i.test(b.getCurrentAction()?.type||'')||team>b.getTeamSize()||b.getRank()>=requiredRank&&b.getActionEstimatedSuccessChance(type,current)[0]>=threshold||!(b.getActionCountRemaining(type,next)>0))return null;
  original=b.getTeamSize(type,next);if(!Number.isInteger(original)||original<0)return null;
  if(b.setTeamSize(type,next,team)!==team)return null;
  const stamina=b.getStamina(),raw=b.getActionEstimatedSuccessChance(type,next),reaper=1+.02*b.getSkillLevel('Reaper'),evasive=1+.04*b.getSkillLevel('Evasive System');
  const chance=forecast(raw,stamina),ceiling=forecast([1,1],stamina);if(!ceiling||ceiling[0]<threshold||!allowed()||!Array.isArray(chance)||chance.length!==2||!chance.every(p=>Number.isFinite(p)&&p>=0&&p<=1)||chance[0]>chance[1]||chance[1]>=threshold)return null;
  return {target:next,chance,effective:{strength:reaper,defense:reaper,dexterity:reaper*evasive,agility:reaper*evasive},hyperdrive:b.getSkillLevel('Hyperdrive')};
 }catch{return null;}finally{if(original!==null)try{const restore=Math.min(original,b.getTeamSize());if(b.setTeamSize(type,next,restore)!==restore)return null;}catch{return null;}}
}

/** Released sleeves retain a bounded, owned XP purpose after the recruitment action finishes. */
export function readSupportInvestment(ns,plan,now=Date.now()){
 try{
  const q=JSON.parse(ns.read('tasks/bladeburner-support-investment.json')),r=ns.getResetInfo(),route=JSON.parse(ns.read('tasks/node-route-plan.json'));
  if(!plan||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset||!Number.isFinite(q.at)||q.at>now||!Number.isFinite(q.expiresAt)||q.expiresAt<=now||q.expiresAt-q.at>900000||!ns.ps('home').some(p=>p.pid===q.ownerPid&&p.filename.replace(/^\//,'')==='bladeburner.js')||route.selected!=='bladeburner'||route.nodeReset!==r.lastNodeReset||route.augReset!==r.lastAugReset||!Number.isFinite(route.at)||route.at>now||now-route.at>=45000||!ns.isRunning(route.ownerPid))return null;
  if(typeof q.currentTarget!=='string'||!q.currentTarget||typeof q.target!=='string'||!q.target||![q.currentTarget,q.target].includes(plan.target)||!Array.isArray(q.chance)||q.chance.length!==2||!q.chance.every(p=>Number.isFinite(p)&&p>=0&&p<=1)||q.chance[0]>q.chance[1]||!Number.isFinite(q.threshold)||q.threshold<=0||q.threshold>1)return null;
  const chance=plan.target===q.target?plan.chance:q.chance;if(!Array.isArray(chance)||chance.length!==2||!chance.every(p=>Number.isFinite(p)&&p>=0&&p<=1)||chance[0]>chance[1]||chance[1]>=q.threshold)return null;
  const workers=Array.isArray(q.workers)?q.workers.filter(i=>Number.isInteger(i)&&i>=0&&i<8):[];if(workers.length!==1)return null;
  return {...plan,target:q.target,chance,rankReady:true,preparingStats:false,supportInvestment:true,investmentWorkers:workers};
 }catch{return null;}
}
