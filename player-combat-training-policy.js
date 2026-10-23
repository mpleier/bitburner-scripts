import {bladeburnerGrowthClock,bladeburnerGrowthCompletions} from './bladeburner-growth-clock-policy.js';
import {playerTrainingStaminaPayoff} from './player-training-stamina-policy.js';
import {combatXpValue} from './combat-growth-policy.js';
/** Quotes use native per-cycle gym formulas and expected crime completion XP. */
export function quotePlayerCombatTraining(ns,context,allowTravel=false){
 const p=context?.player,keys=['hacking','strength','defense','dexterity','agility','charisma'],out=[];
 if(!p?.skills||!p.exp||!p.mults||!ns.fileExists('Formulas.exe','home'))return out;
 for(const name of ['Shoplift','Mug','Homicide'])try{
  const c=ns.singularity.getCrimeStats(name),chance=ns.singularity.getCrimeChance(name);
  if(!Number.isFinite(c.time)||c.time<=0||c.time>5000||!Number.isFinite(chance)||chance<0||chance>1)continue;
  const gains=ns.formulas.work.crimeGains(p,name),xpKeys={hacking:'hackExp',strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp',charisma:'chaExp'};
  const rates=Object.fromEntries(keys.map(k=>[k,gains[xpKeys[k]]*(.25+.75*chance)/(c.time/1000)]));
  if(!Object.values(rates).every(v=>Number.isFinite(v)&&v>=0))continue;
  out.push({kind:'crime',name,time:c.time,city:p.city,costPerSecond:0,rates,score:combatXpValue(rates,context)});
 }catch{}
 try{
  if(ns.fileExists('Formulas.exe','home')){
   const gyms={'Sector-12':ns.enums.LocationName.Sector12PowerhouseGym,Aevum:ns.enums.LocationName.AevumSnapFitnessGym,Volhaven:ns.enums.LocationName.VolhavenMilleniumFitnessGym};
   const cities=allowTravel?Object.keys(gyms).filter(city=>typeof gyms[city]==='string'):gyms[p.city]?[p.city]:[];
   for(const city of cities)for(const [stat,key]of Object.entries({strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp'})){
    const gym=gyms[city],q=ns.formulas.work.gymGains({...p,city},ns.enums.GymType[stat],gym),rates=Object.fromEntries(Object.entries({strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp'}).map(([s,k])=>[s,5*q[k]])),costPerSecond=-5*q.money;
    if(![costPerSecond,...Object.values(rates)].every(v=>Number.isFinite(v)&&v>=0))continue;
    out.push({kind:'gym',name:stat,gym,gymType:ns.enums.GymType[stat],city,fromCity:p.city,travelCost:city===p.city?0:200000,travelMs:city===p.city?0:1000,time:30000,costPerSecond,rates,score:combatXpValue(rates,context)});
   }
  }
 }catch{}
 return out;
}
/** Discount short crime bursts to whole completions; charge lost rank as an explicit opportunity cost. */
export function choosePlayerCombatTraining(quotes,{baselineScore,remainingMs,quotaLeft,money,reserve,rankGap=0,rankRate=null,simulacrum=false,stamina=null,nativeRates=null,parallelNative=false,bonusMs=0}={}){
 if(![baselineScore,remainingMs,quotaLeft,money,reserve].every(Number.isFinite)||baselineScore<=0||remainingMs<1000||quotaLeft<=0||money<0||reserve<0)return null;
 const maxMs=Math.min(30000,remainingMs,quotaLeft*30000);let best=null;
 for(const q of quotes||[]){
  if(!q||!['crime','gym'].includes(q.kind)||!Number.isFinite(q.score)||q.score<=0||!Number.isFinite(q.costPerSecond)||q.costPerSecond<0||!Number.isFinite(q.time)||q.time<=0||q.kind==='crime'&&q.time>5000)continue;
  const travel=q.travelCost??0,travelMs=q.travelMs??0;
  if(![travel,travelMs].every(Number.isFinite)||travel<0||travelMs<0)continue;
  const usable=maxMs-travelMs;
  const durationMs=q.kind==='crime'?Math.floor(usable/q.time)*q.time:Math.floor(usable/1000)*1000;
  if(durationMs<1000||rankGap>0&&(!Number.isFinite(rankRate)||rankRate<=0||rankGap/rankRate*1000<durationMs*5))continue;
  const cost=travel+q.costPerSecond*(durationMs/1000+1),available=Math.max(0,money-reserve);
  if(cost>Math.min(available*.01,available))continue;
  const local=Math.max(0,...(quotes||[]).filter(p=>!p.travelCost&&p.score>0).map(p=>p.score));
  if(travel>0&&q.score*durationMs<=local*maxMs*1.1)continue;
  const bonus=bladeburnerGrowthClock(durationMs/1000,bonusMs);if(!bonus)continue;
  const nativeCompletion=stamina?bladeburnerGrowthCompletions(stamina.time,durationMs/1000,bonus.workSeconds,{progressMs:stamina.progressMs??0}):null;
  if(stamina&&!nativeCompletion)continue;
  const nativeMultiplier=nativeCompletion?.multiplier??bonus.multiplier;
  let baselineGain=baselineScore*durationMs/1000*nativeMultiplier,projectedGain=q.score*durationMs/1000,staminaValue=null;
  if(stamina){staminaValue=playerTrainingStaminaPayoff({...stamina,speed:bonus.multiplier},{nativeRates:Object.fromEntries(Object.entries(nativeRates||{}).map(([k,v])=>[k,v*nativeMultiplier])),rates:q.rates,seconds:durationMs/1000,baselineGain,projectedGain,parallel:parallelNative,nativeCompletions:nativeCompletion.count});if(!staminaValue)continue;({baselineGain,projectedGain}=staminaValue);}
  if(projectedGain<=baselineGain*1.25)continue;
  const candidate={...q,durationMs,cost,baselineGain,projectedGain,bonus,nativeCompletion,stamina:staminaValue?.stamina??null,foregoneRank:simulacrum?0:Number.isFinite(rankRate)&&rankRate>0?rankRate*durationMs/1000:null};
  if(!best||candidate.projectedGain>best.projectedGain)best=candidate;
 }
 return best;
}
