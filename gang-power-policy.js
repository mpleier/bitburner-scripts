/** Larger power investments require a material, reachable warfare-readiness improvement. */
export function gangPowerSpendingFraction({powerPriority=false,beforeSeconds,afterSeconds,horizon,clashChance=0}={}){
 return powerPriority===true&&clashChance===0&&[beforeSeconds,afterSeconds,horizon].every(Number.isFinite)&&
  horizon>0&&beforeSeconds>0&&afterSeconds>=0&&afterSeconds<=horizon&&
  beforeSeconds-afterSeconds>=Math.max(20,beforeSeconds*.05) ? .05 : .01;
}

/** Balanced mode targets safe clashes; explicit power priority continues through conquest. */
export function gangPowerFocus(w){
 if(!w?.active||!w.duty||!Number.isFinite(w.power)||w.power<0||!Number.isFinite(w.threshold)||w.threshold<.5||w.threshold>=1||!w.rivals?.length)return false;
 const strongest=[...w.rivals].sort((a,b)=>b.power-a.power)[0];
 return Number.isFinite(strongest.power)&&strongest.power>0&&(w.powerPriority===true||strongest.samples>=3&&w.power/(w.power+strongest.power)<w.threshold);
}

/** A completed fixed-territory power payback can justify bounded foregone output (50% in explicit priority mode; 10% otherwise).
 * Resource milestone and warfare safety gates are enforced separately by the caller. */
export function gangPowerBenefit(after,before,w,horizon){
 const none={powerPriority:w?.powerPriority===true,powerObjective:false,powerSecondsSaved:0,powerGain:0,powerPaybackSeconds:null};
 if(w?.powerFocus!==true||!after||!before||!Number.isFinite(horizon)||horizon<=0)return none;
 const a=after.power??after.projectedPower,b=before.power??before.projectedPower;
 const ar=after.powerReady??after.warfareReadySeconds,br=before.powerReady??before.warfareReadySeconds;
 const production=after.total??after.production,baseline=before.total??before.production;
 if(![a,b,production,baseline].every(Number.isFinite)||a<=b||baseline<0||production<baseline*(w.powerPriority===true?.5:.9))return none;
 const gain=a-b,margin=Math.max(.001,Math.max(0,b-w.power)*.05);
 const measured=w.rivals?.every(r=>r.samples>=3);
 const saved=(w.powerPriority!==true||measured)&&Number.isFinite(ar)&&ar<=horizon?(Number.isFinite(br)?Math.max(0,br-ar):horizon):0;
 const paid=after.cumulative?.find((p,i)=>Number.isFinite(p.power)&&p.power>(before.cumulative?.[i]?.power??Infinity)+margin&&after.cumulative.slice(i).every((q,j)=>q.power>(before.cumulative?.[i+j]?.power??Infinity)+margin))?.at;
 if(!Number.isFinite(paid)||paid>horizon||gain<margin||saved<Math.max(2,Number.isFinite(br)?br*.02:2)&&gain<Math.max(.01,Math.max(0,b-w.power)*.1))return none;
 return {powerPriority:w.powerPriority===true,powerObjective:true,powerSecondsSaved:saved,powerGain:gain,powerPaybackSeconds:paid};
}

/** Conditional expected path. Fixed-territory evidence remains the authorization baseline.
 * Opponent trajectories retain observed power growth; NPC-vs-NPC territory changes are unknown. */
export function gangTerritoryProjection(w,cumulative,bonusSeconds=0){
 if(!w?.active||!Number.isFinite(w.territory)||w.territory<=0||w.territory>=1||!Number.isFinite(w.power)||!w.rivals?.length||
  w.rivals.some(r=>![r.power,r.rate,r.territory].every(Number.isFinite)||r.power<=0||r.rate<0||r.territory<=0)||!Array.isArray(cumulative))return null;
 let power=w.power,territory=w.territory,at=0,fixedPower=w.power,ticks=0;
 const rivals=w.rivals.map(r=>({...r})),game=t=>t+Math.min(Math.max(0,bonusSeconds),24*t);
 for(const point of cumulative){
  if(![point.at,point.power].every(Number.isFinite)||point.at<at)return null;
  const seconds=game(point.at)-game(at),baseGain=Math.max(0,point.power-fixedPower),steps=Math.max(1,Math.ceil(seconds/20));
  if(ticks+steps>1800)return {model:'Expected territory; observed rival power',limited:true,power,territory};
  for(let i=0;i<steps;i++){
   const dt=seconds/steps,t=game(at)+dt*(i+1),opponents=rivals.filter(r=>r.territory>0);
   power+=baseGain/steps*Math.max(.002,territory)/Math.max(.002,w.territory);
   if(opponents.length&&opponents.every(r=>power/(power+r.power+r.rate*t)>=w.threshold)){
    let change=0,losses=0;
    for(const rival of opponents){
     const other=rival.power+rival.rate*t,chance=power/(power+other),encounters=2/opponents.length*dt/20;
     const win=Math.min(rival.territory,.0001*Math.max(1,1+Math.log(power/other)/Math.log(50)))*chance*encounters;
     const lose=Math.min(territory,.0001*Math.max(1,1+Math.log(other/power)/Math.log(50)))*(1-chance)*encounters;
     change+=win-lose;rival.territory=Math.max(0,rival.territory-win+lose);losses+=(1-chance)*encounters;
    }
    territory=Math.max(0,Math.min(1,territory+change));power*=Math.pow(1/1.008,losses);
   }
   ticks++;
  }
  fixedPower=point.power;at=point.at;
 }
 return {model:'Expected territory; observed rival power',power,territory,ticks,limited:false};
}

/** One trainee pulse is useful only if its immediate power exceeds a conservative XP loss budget. */
export function gangTraineePulse(member,task,warfare,horizon,bonusSeconds,project){
 if(!warfare?.active||warfare.clashChance!==0||!warfare.duty||!task?.name?.startsWith('Train ')||!Number.isFinite(horizon)||horizon<=0||typeof project!=='function')return false;
 const keys=['hack','str','def','dex','agi','cha'];if(keys.some(k=>!Number.isFinite(member?.[k])||member[k]<0))return false;
 const fast=bonusSeconds>0,batch=fast?5:2,fraction=fast?warfare.duty.bonusFraction:warfare.duty.normalFraction;
 if(!Number.isFinite(fraction)||fraction<0||fraction>1)return false;
 const window=horizon,game=window+Math.min(Math.max(0,bonusSeconds),window*24);
 const total=keys.reduce((v,k)=>v+member[k],0),full=project(member,task,batch),missed=project(member,null,0);
 if(!full||!missed)return false;
 const loss=keys.reduce((v,k)=>{const before=missed[k+'_exp'],after=full[k+'_exp'],mult=missed[k+'_mult'],asc=missed[k+'_asc_mult']??1;
  if(![before,after,mult,asc].every(Number.isFinite)||after<before)return Infinity;
  return v+Math.max(0,Math.ceil(mult*asc*32*Math.log((after+534.5)/(before+534.5))-1e-12));},0);
 // Assume an entire missed training batch per pulse; warfare XP only makes the real cost smaller.
 const pulses=Math.max(1,Math.ceil(game/20));
 return total>loss*pulses*1.25&&fraction<=.5;
}

/** Fresh native validation for purchases justified by power instead of cash return. Self-contained. */
export function gangPowerPurchaseAllowed(ns,order){
 const q=order.powerQuote,now=Date.now();
 if(!q||!Number.isFinite(q.horizon)||q.horizon<=0||!Number.isFinite(q.power)||!Number.isFinite(q.territory)||!Number.isFinite(q.rivalPower)||q.rivalPower<=0||!Number.isFinite(q.at)||q.at>now||now-q.at>5000||!Number.isFinite(q.threshold)||q.threshold<.5||q.threshold>=1||
  !Number.isFinite(order.powerPaybackSeconds)||order.powerPaybackSeconds<0||order.powerPaybackSeconds>q.horizon)return false;
 const g=ns.gang.getGangInformation(),reset=ns.getResetInfo();
 if(q.nodeReset!==reset.lastNodeReset||q.augReset!==reset.lastAugReset||q.at<reset.lastAugReset||g.faction!==q.faction||Math.abs(g.territory-q.territory)>.001||
  !Number.isFinite(g.power)||Math.abs(g.power-q.power)>Math.max(1,g.power*.02))return false;
 const rivals=Object.entries(ns.gang.getAllGangInformation()).filter(([name,r])=>name!==g.faction&&r.territory>0);
 if(!rivals.length||q.powerPriority!==true&&rivals.every(([,r])=>g.power/(g.power+r.power)>=q.threshold)||rivals.some(([,r])=>!Number.isFinite(r.power)||r.power>q.rivalPower*1.02))return false;
 const cash=ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0,Number(q.reserve)||0);
 const larger=order.cost>cash*.01;
 if(!Number.isFinite(cash)||cash<=0||!Number.isFinite(order.cost)||order.cost<=0||order.cost>cash*.05)return false;
 if(larger){
  const e=q.largerPurchase;
  if(q.powerPriority!==true||g.territoryWarfareEngaged===true||g.territoryClashChance!==0||!e||
   ![e.beforeSeconds,e.afterSeconds,e.powerGainPerTick].every(Number.isFinite)||e.beforeSeconds<=0||e.afterSeconds<0||e.afterSeconds>q.horizon||
   e.beforeSeconds-e.afterSeconds<Math.max(20,e.beforeSeconds*.05)||e.powerGainPerTick<=0||q.trainingTask)return false;
 }
 const m=ns.gang.getMemberInformation(order.member),stats=ns.gang.getEquipmentStats(order.equipmentName);
 if([...m.upgrades,...m.augmentations].includes(order.equipmentName))return false;
 let gain=0,xpGain=0;const task=q.trainingTask&&['Train Combat','Train Hacking','Train Charisma'].includes(q.trainingTask)&&m.task===q.trainingTask?ns.gang.getTaskStats(q.trainingTask):null;
 for(const k of ['hack','str','def','dex','agi','cha']){
  const mult=m[k+'_mult'],asc=m[k+'_asc_mult'],exp=m[k+'_exp'],factor=stats[k]??1;
  if(![mult,asc,exp,factor].every(Number.isFinite)||mult<1||asc<1||exp<0||factor<1)return false;
  const skill=f=>Math.max(1,Math.floor(mult*asc*f*(32*Math.log(exp+534.5)-200)));
  gain+=skill(factor)-skill(1);
  if(task)xpGain+=Math.max(0,Number(task[k+'Weight'])||0)*Math.pow(Math.max(0,Number(task.difficulty)||0),.9)*(mult*(factor-1)/4)*asc;
 }
 if(larger){
  // Reprice the candidate's immediate power gain from current native stats. Do not
  // use future training or defense-eligibility changes to justify a larger bill.
  const nativeGain=.015*Math.max(.002,g.territory)*gain/95;
  if(!(nativeGain>0)||q.largerPurchase.powerGainPerTick>nativeGain*1.02)return false;
 }
 return gain>0||xpGain>0;
}

/** Equal contribution per skill point, weighted by the member's current six-stat power contribution. */
export function gangPowerAscensionWeights(members,fallback,active){
 if(!active)return fallback;
 return Object.fromEntries(Object.entries(members).map(([name,m])=>[name,Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,Math.max(1,Number(m[k])||1)]))]));
}
