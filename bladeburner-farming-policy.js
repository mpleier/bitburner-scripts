/** Injury constants from official Bitburner v3.0.1 Contracts/Operations data. */
export function farmingDamage(name,difficulty){
 const base={Tracking:.5,'Bounty Hunter':1,Retirement:1,Investigation:0,'Undercover Operation':2,'Sting Operation':2.5,'Stealth Retirement Operation':10,Assassination:5};
 if(!Object.hasOwn(base,name)||!Number.isFinite(difficulty)||difficulty<=0)return null;
 return Math.ceil(base[name]*(Math.pow(difficulty,.28)+difficulty/650)*1.1);
}
/** Conservative probability, net rank, duty costs, HP recovery and cash replacement. Raids are excluded. */
export function chooseBladeburnerFarm(names,chances,metrics,context,rate,hospitalCost,damageQuote=farmingDamage){
 const safe=context?.threshold,floor=context?.floor;
 if(!Number.isFinite(safe)||safe<=0||safe>1||!Number.isFinite(floor)||floor<.9||floor>safe)return null;
 let baseline=Number.isFinite(context.baselineRate)&&context.baselineRate>0?context.baselineRate:0;
 for(const name of names){if(chances[name]?.[0]>=safe){const r=rate(chances[name],metrics[name]);if(Number.isFinite(r)&&r>baseline)baseline=r;}}
 let best=null;
 for(const name of names){
  const m=metrics[name],c=chances[name],p=c?.[0];
  if(name==='Raid'||!Array.isArray(c)||!Number.isFinite(p)||p<floor||p>=safe||!Number.isFinite(c[1])||c[1]<p||c[1]>1||!m||!Number.isSafeInteger(m.level)||m.level<1||!(Number.isFinite(m.count)&&m.count>=1))continue;
  const hp=context.hp;if(![hp?.current,hp?.max,context.money,context.reserve,context.hrcTime,m.difficulty].every(Number.isFinite)||hp.max<=0||hp.current<hp.max*.9||hp.current>hp.max||context.money<context.reserve||context.hrcTime<=0)continue;
  const damage=damageQuote(name,m.difficulty),bill=damage===null?null:hospitalCost(context.money,hp,damage);
  if(bill===null||bill>Math.max(0,context.money-context.reserve)||bill>0&&!(Number.isFinite(context.cashRate)&&context.cashRate>0))continue;
  const timing={},raw=rate(c,m,timing),net=p*m.gain-(1-p)*m.loss;
  if(!(raw>0&&net>0&&timing.duty>0))continue;
  // Price nonfatal healing even where a high damage roll could hospitalize.
  const healing=(1-p)*Math.min(damage,Math.max(0,hp.max-1))/2*context.hrcTime;
  const cash=(1-p)*(bill>0?bill/context.cashRate*1000:0);
  const score=net*1000/(m.time/timing.duty+healing+cash);
  if(!(Number.isFinite(score)&&score>baseline*1.15&&score>0&&(!best||score>best.score)))continue;
  best={name,level:m.level,score,baseline,threshold:floor,damage,bill,healingMs:healing,cashRecoveryMs:cash,cashRate:bill>0?context.cashRate:null};
 }
 return best;
}
/** Revalidate the lower probability, fixed level, health and cash reserve at dispatch. */
export function bladeburnerFarmStartAllowed(ticket,live,hospitalCost,damageQuote){
 if(!ticket||!live||!['Contracts','Operations'].includes(live.type)||live.name!==ticket.name||live.name==='Raid'||live.ownerPid!==ticket.ownerPid||live.nodeReset!==ticket.nodeReset||live.augReset!==ticket.augReset||!Number.isFinite(ticket.at)||ticket.at>live.at||live.at-ticket.at>15000||!Number.isFinite(ticket.threshold)||ticket.threshold<.9||ticket.threshold>1||live.level!==ticket.level||!Array.isArray(live.chance)||!(live.chance[0]>=ticket.threshold)||!(live.hp?.current>=live.hp.max*.9))return false;
 const damage=damageQuote(live.name,live.difficulty),bill=damage===null?null:hospitalCost(live.money,live.hp,damage);
 return Number.isFinite(damage)&&damage<=ticket.damage&&Number.isFinite(bill)&&Number.isFinite(live.reserve)&&live.reserve>=0&&Number.isFinite(ticket.bill)&&bill<=ticket.bill&&bill<=Math.max(0,live.money-live.reserve)&&(!bill||Number.isFinite(ticket.cashRate)&&ticket.cashRate>0);
}
