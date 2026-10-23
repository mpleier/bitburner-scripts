/** Fluid forecast with one engine tick of backlog held back; no bonus is spent twice on recovery. */
export function bladeburnerGrowthClock(seconds,bonusMs=0){
 if(!Number.isFinite(seconds)||seconds<=0||seconds>30||!Number.isFinite(bonusMs)||bonusMs<0)return null;
 const extraSeconds=Math.min(4*seconds,Math.max(0,bonusMs/1000-1));
 return {seconds,workSeconds:seconds+extraSeconds,multiplier:1+extraSeconds/seconds,consumedMs:extraSeconds*1000,remainingMs:Math.max(0,bonusMs-extraSeconds*1000),basis:'fluid-reserve-one-tick'};
}
/** Whole amortized cycles, capped at one reward per engine tick. Unknown mission progress stays zero. */
export function bladeburnerGrowthCompletions(time,seconds,workSeconds,{duty=1,progressMs=0,maxCompletions=null}={}){
 if(![time,seconds,workSeconds,duty,progressMs].every(Number.isFinite)||time<=0||seconds<=0||seconds>30||workSeconds<seconds||workSeconds>5*seconds||duty<=0||duty>1||progressMs<0||progressMs>time)return null;
 if(maxCompletions!==null&&(!Number.isSafeInteger(maxCompletions)||maxCompletions<0))return null;
 const cycleMs=time/duty,budgetMs=workSeconds*1000+progressMs;
 const count=Math.min(maxCompletions??Infinity,Math.floor(seconds),Math.floor((budgetMs+1e-8)/cycleMs));
 return {count,cycleMs,progressMs,maxCompletions,multiplier:count*cycleMs/(seconds*1000),basis:'whole-amortized-cycles'};
}
/** General Training has no city/level/team variant; discard all partial progress on optional API failure. */
export function readBladeburnerTrainingProgress(api,time){
 try{
  const a=api.getCurrentAction();if(a?.type!=='General'||a.name!=='Training')return 0;
  const progress=api.getActionCurrentTime();return Number.isFinite(time)&&time>0&&Number.isFinite(progress)&&progress>=0&&progress<=time?progress:0;
 }catch{return 0;}
}
/** Capture only repeatable missions; partial optional API data cannot authorize progress reuse. */
export function readBladeburnerMissionProgress(api,now=Date.now()){
 try{
  const a=api.getCurrentAction(),type=['Contract','Contracts'].includes(a?.type)?'Contracts':['Operation','Operations'].includes(a?.type)?'Operations':null;
  if(!type||typeof a.name!=='string'||!a.name)return null;
  return {at:now,type,name:a.name,city:api.getCity(),level:api.getActionCurrentLevel(type,a.name),team:type==='Operations'?api.getTeamSize(type,a.name):0,autoLevel:api.getActionAutolevel(type,a.name),time:api.getActionTime(type,a.name),progressMs:api.getActionCurrentTime()};
 }catch{return null;}
}
/** Reuse only an unchanged, non-restarting configuration in the final parent decision. */
export function bladeburnerMissionProgress(snapshot,candidate,now=Date.now()){
 const s=snapshot,c=candidate;
 if(!s||!c||!Number.isFinite(now)||!Number.isFinite(s.at)||s.at>now||now-s.at>5000||!['Contracts','Operations'].includes(s.type)||s.type!==c.type||typeof s.name!=='string'||!s.name||s.name!==c.name||typeof s.city!=='string'||!s.city||s.city!==c.city||s.autoLevel!==false||c.restart!==false)return 0;
 if(!Number.isSafeInteger(s.level)||s.level<1||s.level!==c.level||!Number.isSafeInteger(s.team)||s.team<0||s.team!==c.team||s.type==='Contracts'&&s.team!==0||!Number.isFinite(s.time)||s.time<=0||!Number.isFinite(c.time)||Math.abs(s.time-c.time)>1e-6||!Number.isFinite(s.progressMs)||s.progressMs<0||s.progressMs>s.time)return 0;
 return s.progressMs;
}
/** One-pass marginal regeneration estimate: only reprice the explicitly measured recovery component. */
export function forecastBladeburnerGrowthDuty(quote,choice,seconds,multiplier=1){
 const q=quote,r=choice?.recovery,unchanged={factor:1,basis:'existing-duty'};
 if(choice?.kind!=='mission'||!r||![r.combatMs,r.otherMs,r.recoveryMs,r.cost,r.passive,r.hrc].every(Number.isFinite)||r.combatMs<=0||r.otherMs<0||r.recoveryMs<0||r.cost<0||r.passive<0||r.hrc<0||!q||![q.agility,q.xp,q.levelMult,q.effective,q.max,q.capacityMult,q.staminaSkill,q.regenMult,seconds,multiplier].every(Number.isFinite)||q.agility<=1||q.xp<0||q.levelMult<=0||q.effective<=0||q.max<=0||q.capacityMult<=0||q.staminaSkill<=0||q.regenMult<0||seconds<=0||seconds>30||multiplier<1||multiplier>5)return unchanged;
 const base=r.combatMs+r.otherMs,startingDeficit=Math.max(0,r.cost-r.passive*base/1000),startingRecovery=startingDeficit>0?1000*startingDeficit/(r.passive+r.hrc):0;
 if(!Number.isFinite(startingRecovery)||Math.abs(startingRecovery-r.recoveryMs)>1e-6*Math.max(1,r.recoveryMs)||!Number.isFinite(choice.duty)||Math.abs(choice.duty-r.combatMs/(base+r.recoveryMs))>1e-6)return unchanged;
 const rate=choice.rates?.agility??0;if(!Number.isFinite(rate)||rate<0)return unchanged;
 const level=Math.max(q.agility,q.levelMult*(32*Math.log(q.xp+rate*seconds*multiplier+534.6)-200)),before=q.agility*q.effective,after=level*q.effective;
 const endMax=q.max+Math.max(0,after**.8-before**.8)*q.capacityMult;
 const regen=(maximum,agility)=>(.0085+maximum/70000)*agility**.17*q.staminaSkill*q.regenMult;
 const startRegen=regen(q.max,before),endRegen=regen(endMax,after);
 // Credit relative improvement over the already priced native rates; never substitute a larger unverified starting rate.
 const passive=r.passive*(startRegen>0?(1+endRegen/startRegen)/2:1),hrc=r.hrc*(1+endMax/q.max)/2;
 const baseMs=r.combatMs+r.otherMs,deficit=Math.max(0,r.cost-passive*baseMs/1000);
 const recoveryMs=deficit>0?(passive+hrc>0?1000*deficit/(passive+hrc):Infinity):0;
 const oldTotal=baseMs+r.recoveryMs,newTotal=baseMs+recoveryMs;
 if(![endMax,startRegen,endRegen,passive,hrc,recoveryMs,newTotal,choice.duty].every(Number.isFinite)||choice.duty<=0||choice.duty>1||newTotal<=0)return unchanged;
 const factor=Math.max(1,Math.min(oldTotal/newTotal,1/choice.duty));
 return {factor,basis:'one-pass-midpoint',startRegen,endRegen,endMax,originalRecoveryMs:r.recoveryMs,recoveryMs,otherMs:r.otherMs};
}
