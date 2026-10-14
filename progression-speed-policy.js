/** Conservative estimates for progression; no native actions or promised finish times. */
const minute=60000;
export function progressionSpeed({snapshot,previous,now=Date.now(),augReset,elapsed=0,node=1,firstBn9=false,combat=false,baseDelay=5*minute,homeRam=0,hackingGoal=false}){
 const fallback={earlyInstall:false,delayMs:baseDelay,bottleneck:homeRam<64?'ram':hackingGoal?'hacking':'balanced',reason:'Waiting for fresh augmentation evidence'};
 if(!snapshot||snapshot.augReset!==augReset||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>5*minute)return {...fallback,observation:previous};
 const same=previous?.augReset===augReset&&Number.isFinite(previous.at)&&Number.isFinite(previous.worth)&&previous.at<=snapshot.at,dt=same?(snapshot.at-previous.at)/1000:0;
 const ready=snapshot.ready||[],fingerprint=JSON.stringify(ready.map(a=>a.name).sort());
 const lastGrowthAt=!same||previous.fingerprint!==fingerprint?snapshot.at:previous.lastGrowthAt;
 const cashRate=dt>=30?Math.max(0,(snapshot.worth-previous.worth)/dt):same?previous.cashRate||0:0;
 const repRates=dt>=30?Object.fromEntries(Object.entries(snapshot.reputation||{}).map(([f,r])=>[f,Math.max(0,(r-(previous.reputation?.[f]??r))/dt)])):same?previous.repRates||{}:{};
 const observation={augReset,at:snapshot.at,worth:snapshot.worth,reputation:snapshot.reputation,fingerprint,lastGrowthAt,cashRate,repRates};
 const seconds=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 let next=null;
 for(const target of snapshot.targets||[]){
  if(!Number.isFinite(target.cost)||!Number.isFinite(target.rep))continue;
  const cash=seconds(Math.max(0,target.cost-snapshot.worth),cashRate);
  const rep=Math.min(...(target.factions||[]).map(f=>seconds(Math.max(0,target.rep-(snapshot.reputation?.[f]||0)),repRates[f]||0)));
  const donation=Number.isFinite(target.donationCost)?seconds(Math.max(0,target.cost+target.donationCost-snapshot.worth),cashRate):Infinity;
  const eta=Math.min(Math.max(cash,rep),donation)*1000;
  if(!next||eta<next.eta)next={name:target.name,eta,bottleneck:donation<Math.max(cash,rep)?'cash':rep>cash?'reputation':'cash'};
 }
 const bottleneck=homeRam<64?'ram':hackingGoal?'hacking':next&&Number.isFinite(next.eta)?next.bottleneck:'balanced';
 const channels=combat?{strength:.15,defense:.15,dexterity:.15,agility:.15,bladeburner_success_chance:.4}:{hacking:.35,hacking_exp:.15,hacking_speed:.2,hacking_money:.15,faction_rep:.15};
 let logGain=0;for(const aug of ready)for(const [key,weight]of Object.entries(channels)){const value=Number(aug.stats?.[key]??1);if(value>0&&Number.isFinite(value))logGain+=weight*Math.log(value);}
 // Discount theoretical multiplier gains: experience and skill are not linear throughput.
 const gain=Math.max(0,Math.min(2,Math.expm1(logGain)*.5)),warmup=combat?20*minute:15*minute;
 const paybackMs=gain>0?warmup/gain:Infinity,plateau=now-lastGrowthAt>=10*minute;
 const earlyInstall=![8].includes(node)&&!firstBn9&&elapsed>=30*minute&&ready.some(a=>a.name!=='NeuroFlux Governor')&&gain>=.2&&paybackMs<=Math.min(4*60*minute,Math.max(60*minute,elapsed))&&plateau&&(!next||next.eta>Math.max(3*minute,paybackMs));
 const imminent=next&&Number.isFinite(next.eta)&&next.eta>0&&next.eta<=baseDelay;
 const delayMs=firstBn9||node===8||gain===0?baseDelay:imminent?Math.min(baseDelay,Math.max(15000,next.eta)):Math.min(baseDelay,30000);
 return {earlyInstall,delayMs,bottleneck,gain,paybackMs:Number.isFinite(paybackMs)?paybackMs:null,next:next&&{...next,eta:Number.isFinite(next.eta)?next.eta:null},reason:earlyInstall?'Useful augmentation gains outweigh estimated restart recovery':imminent?'Another augmentation is close; allow a bounded wait':'No measured near-term augmentation improvement',observation};
}
