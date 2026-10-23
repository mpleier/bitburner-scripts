/** Native Training adds .04 * Cyber's Edge multiplier to the unscaled stamina bonus per completion. */
export function quotePlayerTrainingStamina(context,{stamina,cyber,time,speed=1,bonusMs=0,progressMs=0}={}){
 const p=context?.player,m=context?.metadata,agility=p?.skills?.agility,xp=p?.exp?.agility,aug=p?.mults?.bladeburner_max_stamina??1,effective=context?.effective?.agility??1;
 if(!Array.isArray(stamina)||stamina.length!==2||!stamina.every(Number.isFinite)||stamina[1]<=0||stamina[0]<0||stamina[0]>stamina[1]||!Number.isSafeInteger(cyber)||cyber<0||!Number.isFinite(time)||time<=0||!Number.isFinite(speed)||speed<1||speed>5||!Number.isFinite(bonusMs)||bonusMs<0||!Number.isFinite(aug)||aug<=0||!Number.isFinite(effective)||effective<=0||!Number.isFinite(agility)||agility<=1||!Number.isFinite(xp)||xp<0||!Number.isFinite(m?.baseDifficulty)||m.baseDifficulty<=0||!m.weights||!m.decays)return null;
 const base=32*Math.log(xp+534.6)-200;if(!(base>0))return null;
 let competence=0;
 for(const [stat,weight]of Object.entries(m.weights)){
  if(!Number.isFinite(weight)||weight<0)return null;if(!weight)continue;
  const level=p.skills?.[stat],decay=m.decays[stat],eff=context.effective?.[stat]??1;
  if(![level,decay,eff].every(Number.isFinite)||level<0||decay<0||eff<=0)return null;
  competence+=weight*Math.pow(level*eff,decay);
 }
 const skill=1+.02*cyber,cost=.285*(Math.pow(m.baseDifficulty,.28)+m.baseDifficulty/650);
 if(!Number.isFinite(progressMs)||progressMs<0||progressMs>time)return null;
 const quote={max:stamina[1],cost,competence,capacityPerCompletion:.04*skill*skill*aug,capacityMult:skill*aug,agility,xp,levelMult:agility/base,effective,time,speed,bonusMs,progressMs,staminaSkill:skill,regenMult:p.mults?.bladeburner_stamina_gain??1};
 return competence>0&&Object.values(quote).every(v=>Number.isFinite(v)&&v>=0)?quote:null;
}
/** Compare terminal effective competence at full recovery; capacity already above twice the action cost has no penalty benefit. */
export function playerTrainingStaminaPayoff(quote,{nativeRates,rates,seconds,baselineGain,projectedGain,parallel=false,nativeCompletions=null}={}){
 const q=quote;
 if(!q||!nativeRates||!rates||![seconds,baselineGain,projectedGain,...Object.values(q)].every(Number.isFinite)||seconds<=0||seconds>30||baselineGain<0||projectedGain<0||q.max<=0||q.agility<=1||q.xp<0||q.time<=0||q.cost<=0||q.competence<=0||q.levelMult<=0||q.effective<=0||q.capacityMult<=0||q.capacityPerCompletion<=0||!Number.isFinite(q.speed)||q.speed<1||q.speed>5)return null;
 const capacityFromXp=r=>{
  const rate=r?.agility??0;if(!Number.isFinite(rate)||rate<0)return NaN;if(rate===0)return 0;
  const level=q.levelMult*(32*Math.log(q.xp+rate*seconds+534.6)-200);
  return Math.max(0,Math.pow(Math.max(q.agility,level)*q.effective,.8)-Math.pow(q.agility*q.effective,.8))*q.capacityMult;
 };
 if(nativeCompletions!==null&&(!Number.isSafeInteger(nativeCompletions)||nativeCompletions<0))return null;
 const bonusCapacity=q.capacityPerCompletion*(nativeCompletions??seconds*1000/q.time*q.speed);
 const nativeCapacity=capacityFromXp(nativeRates)+bonusCapacity,externalCapacity=capacityFromXp(rates);
 const penalty=max=>Math.min(1,Math.max(0,2*(1-q.cost/max)));
 const shared=parallel?q.max+nativeCapacity:q.max,startPenalty=penalty(shared),nativeMax=parallel?shared:q.max+nativeCapacity,externalMax=shared+externalCapacity,nativePenalty=penalty(nativeMax),externalPenalty=penalty(externalMax);
 const nativeGain=baselineGain*nativePenalty+(parallel?0:q.competence*(nativePenalty-startPenalty));
 const externalGain=projectedGain*externalPenalty+q.competence*(externalPenalty-startPenalty);
 if(![nativeCapacity,externalCapacity,nativeGain,externalGain].every(Number.isFinite))return null;
 return {baselineGain:nativeGain,projectedGain:externalGain,stamina:{basis:'full-recovery',bonusCapacity,nativeCapacity,externalCapacity,nativeMax,externalMax,startPenalty,nativePenalty,externalPenalty,parallel}};
}
