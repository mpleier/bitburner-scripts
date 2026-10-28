
/** Native probes are synchronous and always restore the live level. Missing APIs preserve caller fallback. */
export function quoteBladeburnerSkillThroughputs(api,actions,data,options={}) {
 const rows=[],allowed=options.allowed||(()=>true),threshold=options.threshold;
 const stamina=api.getStamina(),skills=Object.fromEntries(['Reaper','Evasive System',"Cyber's Edge"].map(n=>[n,api.getSkillLevel(n)]));
 const stats=options.stats,mults=options.mults,agility=stats?.agility*(1+.02*skills.Reaper)*(1+.04*skills['Evasive System']),cyber=1+.02*skills["Cyber's Edge"];
 if(![agility,cyber,stamina?.[1],mults?.bladeburner_stamina_gain].every(Number.isFinite)||agility<=0||cyber<=0||stamina[1]<=0||mults.bladeburner_stamina_gain<=0)return rows;
 const recovery={...options.maintenance,stamina,actions:data,regen:(.0085+stamina[1]/70000)*agility**.17*cyber*mults.bladeburner_stamina_gain,hrc:stamina[1]*.01/60};
 for(const [name,type]of actions.slice(0,16)){
  if(!allowed())break;
  if(!['Contracts','Operations'].includes(type)||!data[name]||!(api.getActionCountRemaining(type,name)>=1))continue;
  const old=api.getActionCurrentLevel(type,name),maximum=typeof api.getActionMaxLevel==='function'?api.getActionMaxLevel(type,name):old;
  try{
   const plan=typeof options.planner==='function'?options.planner(api,[[name,type]],threshold,options.rate,allowed,recovery,options.forecast,48)[name]:null;
   const levels=new Set([old,...(plan?[plan.level,Math.min(maximum,plan.level+1),Math.min(maximum,Math.ceil(plan.level*1.1))]:[])]);
   for(const level of levels){
    if(!allowed())break;
    if(!Number.isSafeInteger(level)||level<1||level>maximum)continue;
    api.setActionLevel(type,name,level);
    const difficulty=data[name].base*data[name].factor**(level-1),raw=api.getActionEstimatedSuccessChance(type,name),chance=options.forecast?options.forecast(raw,stamina,difficulty):raw;
    const metrics={time:api.getActionTime(type,name),gain:api.getActionRankGain(type,name),loss:api.getActionRankLoss(type,name),staminaCost:.285*(difficulty**.28+difficulty/650),staminaRegen:recovery.regen,hrcRegen:recovery.hrc};
    if(recovery.chaosControl&&data[name].chaos)metrics.chaosControl={...recovery.chaosControl,effect:data[name].chaos};
    if(type==='Operations'){metrics.team=api.getTeamSize(type,name);metrics.recruitment=recovery.recruitment;}
    if(chance&&[difficulty,metrics.time,metrics.gain,metrics.loss,chance[0]].every(Number.isFinite)&&difficulty>0&&metrics.time>0&&metrics.gain>0&&metrics.loss>=0&&chance[0]>0&&chance[0]<=1)
     rows.push({name,type,level,difficulty,gain:metrics.gain,loss:metrics.loss,chance:chance[0],isStealth:data[name].isStealth===true,isKill:data[name].isKill===true,metrics});
   }
  }finally{api.setActionLevel(type,name,old);}
 }
 return rows;
}

/** A conservative stock runway: any possible bonus speed uses the fivefold consumption ceiling. */
export function bladeburnerRankRunway(rows,bonusMs=null) {
 const best=rows.filter(r=>r&&typeof r.name==='string'&&[r.supply,r.time,r.duty,r.rate].every(Number.isFinite)&&r.supply>=1&&r.time>0&&r.duty>0&&r.duty<=1&&r.rate>0).sort((a,b)=>b.rate-a.rate)[0];
 if(!best)return null;
 const speed=bonusMs===0?1:5,cycleMs=best.time/best.duty,runwayMs=best.supply*cycleMs/speed;
 return Number.isFinite(runwayMs)?{version:1,action:best.name,supply:best.supply,missionMs:best.time,duty:best.duty,speed,cycleMs,runwayMs}:null;
}
