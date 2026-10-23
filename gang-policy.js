import {chooseGangStatTraining,gangTrainingScheduleTask} from './gang-stat-policy.js';
import {gangPowerFocus,gangPowerBenefit,gangTerritoryProjection,gangTraineePulse} from './gang-power-policy.js';
export function gangFocus({moneyFocus,reputationFocus,members,factionRep,requiredRep,money,respect,goal,purchaseForecast}) {
  if(reputationFocus)return 'respect';
  if(moneyFocus)return 'money';
  if(members<12)return 'respect';
  if(goal&&Number.isFinite(goal.rep)&&Number.isFinite(goal.cost)){
    if(factionRep>=goal.rep)return 'money';
    if(money>=goal.cost)return 'respect';
    if(Number.isFinite(purchaseForecast?.etaSeconds)&&purchaseForecast.etaSeconds>=0&&['money','respect','both money and respect'].includes(purchaseForecast.focus))return purchaseForecast.focus;
    return 'both money and respect';
  }
  if(factionRep>=requiredRep)return 'money';
  return money>1e11||respect<9000?'respect':'both money and respect';
}
export function warfareDecision(gang,others,threshold=0.75) {
  const rivals=Object.entries(others).filter(([name,info])=>name!==gang.faction&&info.territory>0);
  const chances=rivals.map(([name,info])=>({name,chance:gang.power>0?gang.power/(gang.power+Math.max(0,info.power)):0}));
  const minimum=chances.length?Math.min(...chances.map(c=>c.chance)):0;
  return {engage:gang.territory<1-1e-6&&chances.length>0&&minimum>=threshold,minimum,
    average:chances.length?chances.reduce((s,c)=>s+c.chance,0)/chances.length:0};
}
/** Match the live controller's defense protection during active/residual clashes. */
export function gangWarfareMemberEligible(member,maxDefense,clashChance){
 return Number.isFinite(member?.def)&&Number.isFinite(maxDefense)&&Number.isFinite(clashChance)&&member.def>=0&&maxDefense>=0&&clashChance>=0&&clashChance<=1&&
  !(clashChance>0&&(member.def<100||member.def<Math.min(10000,maxDefense*.1)));
}

/** Native power per 20-game-second territory update, for members available for the warfare pulse. */
export function gangWarfarePowerPerTick(members,territory,clashChance=0,locked=[]){
 const crew=Object.values(members),keys=['hack','str','def','dex','agi','cha'];
 if(!Number.isFinite(territory)||territory<0||territory>1||!Number.isFinite(clashChance)||clashChance<0||clashChance>1||
  crew.some(m=>keys.some(k=>!Number.isFinite(m[k])||m[k]<0)))return null;
 const excluded=new Set(locked),maxDefense=Math.max(0,...crew.map(m=>m.def));
 const total=crew.filter(m=>!excluded.has(m.name)&&gangWarfareMemberEligible(m,maxDefense,clashChance))
  .reduce((sum,m)=>sum+keys.reduce((v,k)=>v+m[k],0)/95,0);
 const power=.015*Math.max(.002,territory)*total;return Number.isFinite(power)?power:null;
}

/** Only fresh observations of rivals that still own territory can constrain development. */
export function gangWarfareContext(gang,snapshot,threshold=.75,now=Date.now(),timing=null){
 if(!Number.isFinite(gang?.territory)||gang.territory<0||gang.territory>1)return {active:false,reason:'Unknown territory'};
 if(gang.territory>=1-1e-6)return {active:false,reason:'Territory complete'};
 if(!snapshot||snapshot.faction!==gang.faction||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>45000||
  !Number.isFinite(gang.power)||gang.power<0||!Number.isFinite(gang.territoryClashChance)||gang.territoryClashChance<0||gang.territoryClashChance>1||
  !Number.isFinite(threshold)||threshold<.5||threshold>1)return {active:false,reason:'Fresh warfare observations unavailable'};
 const rows=Object.entries(snapshot.gangs||{});
 if(!rows.length||rows.some(([,r])=>!Number.isFinite(r?.power)||r.power<0||!Number.isFinite(r.territory)||r.territory<0||r.territory>1))return {active:false,reason:'Invalid rival observations'};
 const rivals=rows.filter(([name,r])=>name!==gang.faction&&r.territory>0);
 if(!rivals.length)return {active:false,reason:'No active rivals'};
 const context={active:true,powerPriority:timing?.powerPriority===true,at:snapshot.at,faction:gang.faction,power:gang.power,territory:gang.territory,clashChance:gang.territoryWarfareEngaged?1:gang.territoryClashChance,
  rivalPower:Math.max(...rivals.map(([,r])=>r.power)),threshold,maxChanceDrop:.01,duty:gangWarfareDuty(timing),
  rivals:rivals.map(([name,r])=>{
   const history=(snapshot.powerHistory?.[name]||[]).filter(v=>Number.isFinite(v)&&v>=0).slice(-8).sort((a,b)=>a-b);
   const observed=history.length>=3,median=history.length?history[Math.floor(history.length/2)]:0;
   return {name,territory:r.territory,power:r.power,rate:observed?median/20:0,samples:history.length,
    lowRate:observed?history[0]/20:0,highRate:observed?history.at(-1)/20:0};
  })};
 return {...context,powerFocus:timing?.powerFocusEnabled!==false&&gangPowerFocus(context),traineePulses:true};
}

/** Batch-adjusted productive time displaced by warfare preparation and restoration.
 * Native gains/XP run before power: even an instantaneous successful pulse replaces one batch.
 * Additional normal (2 game seconds) / bonus (5) batches follow the controller timing window. */
export function gangWarfareDuty(timing){
 if(timing?.detected!==true)return null;
 const {paddingMs,intervalMs,restoreMs,periodMs=20000}=timing;
 if(![paddingMs,intervalMs,restoreMs,periodMs].every(Number.isFinite)||paddingMs<0||intervalMs<0||restoreMs<0||periodMs<=0)return null;
 const occupiedMs=paddingMs+intervalMs+restoreMs;
 if(!Number.isFinite(occupiedMs))return null;
 const leadMs=paddingMs+intervalMs/2,tailMs=intervalMs/2+restoreMs;
 const fraction=(speed,batchMs)=>Math.min(1,(1+Math.floor(leadMs*speed/batchMs)+Math.floor(tailMs*speed/batchMs))*batchMs/periodMs);
 return {normalFraction:fraction(1,2000),bonusFraction:fraction(25,5000),
  occupiedMs,periodMs,model:'Batch-adjusted controller timing'};
}

/** Productive fractions retain training and the live defense protection. */
export function gangWarfareWorkFractions(members,warfare,locked=[]){
 const rows=Object.entries(members),maxDefense=Math.max(0,...rows.map(([,m])=>m.def)),lock=new Set(locked);
 const duty=warfare?.active?warfare.duty:null;
 return Object.fromEntries(rows.map(([name,m])=>{
  const eligible=duty&&!lock.has(name)&&gangWarfareMemberEligible(m,maxDefense,warfare.clashChance);
  return [name,{normal:eligible?1-duty.normalFraction:1,bonus:eligible?1-duty.bonusFraction:1}];
 }));
}

/** Productive game seconds per wall second over a bounded equipment horizon. */
export function gangWarfareProductionFactor(fractions,horizon,bonusSeconds=0){
 if(!fractions||![fractions.normal,fractions.bonus,horizon,bonusSeconds].every(Number.isFinite)||
  fractions.normal<0||fractions.normal>1||fractions.bonus<0||fractions.bonus>1||horizon<=0||bonusSeconds<0)return 0;
 const fast=Math.min(horizon,bonusSeconds/24);
 return (fast*25*fractions.bonus+(horizon-fast)*fractions.normal)/horizon;
}

/** Native wanted gain after justice, reconstructed from the observed post-batch level.
 * At the floor the prior level is ambiguous; leave wanted validation unavailable. */
export function gangReportedWantedRate(raw,justice,wantedAfter,cycles){
 if(![raw,justice,wantedAfter].every(Number.isFinite)||justice<0||justice>12||wantedAfter<1)return null;
 if(justice===0)return raw;
 if(wantedAfter<=1||!Number.isFinite(cycles)||cycles<=0)return null;
 const factor=1-justice*.001;
 return raw-wantedAfter*(1/factor-1)/cycles;
}

/** Fixed-plan joint readiness with normal/bonus pulse costs and an explicit bonus boundary.
 * Task rates remain raw per-cycle values for instantaneous wanted safety. */
export function gangPurchasePlanTiming({goal,money,factionRep,respectToRep,otherCashRate=0,workFractions={},bonusSeconds=0},assignments){
 if(!goal||![goal.cost,goal.rep,money,factionRep,respectToRep,otherCashRate,bonusSeconds].every(Number.isFinite)||bonusSeconds<0||goal.cost<0||goal.rep<0||money<0||factionRep<0||respectToRep<=0||otherCashRate<0||!workFractions||!assignments)return null;
 let cashRate=otherCashRate,repRate=0,bonusCashRate=otherCashRate,bonusRepRate=0;
 for(const [name,t]of Object.entries(assignments)){
  const f=workFractions[name]||{normal:1,bonus:1};
  if(!t||![t.money,t.respect,f.normal,f.bonus].every(Number.isFinite)||t.money<0||t.respect<0||f.normal<0||f.normal>1||f.bonus<0||f.bonus>1)return null;
  cashRate+=t.money*5*f.normal;repRate+=t.respect*5*f.normal*respectToRep;
  bonusCashRate+=t.money*125*f.bonus;bonusRepRate+=t.respect*125*f.bonus*respectToRep;
 }
 const fast=bonusSeconds/24;
 const wait=(gap,normal,bonus)=>gap<=0?0:fast>0&&bonus>0&&gap<=fast*bonus?gap/bonus:
  normal>0?fast+Math.max(0,gap-fast*bonus)/normal:Infinity;
 const cashSeconds=wait(Math.max(0,goal.cost-money),cashRate,bonusCashRate),repSeconds=wait(Math.max(0,goal.rep-factionRep),repRate,bonusRepRate);
 return {cashRate,repRate,bonusCashRate,bonusRepRate,cashSeconds,repSeconds,etaSeconds:Math.max(cashSeconds,repSeconds)};
}

/** Earliest common crossing of all linear rival trajectories, in game seconds.
 * An already satisfied but faster-growing rival also places an upper bound on the crossing. */
export function gangWarfareReadyDelay(power,rate,warfare,gameAt=0){
 if(![power,rate,gameAt,warfare?.threshold].every(Number.isFinite)||power<0||rate<0||gameAt<0||warfare.threshold<.5||warfare.threshold>1)return Infinity;
 const rivals=warfare.rivals?.length?warfare.rivals:[{power:warfare.rivalPower,rate:0}];
 let earliest=0,latest=Infinity;
 for(const rival of rivals){
  if(![rival.power,rival.rate].every(Number.isFinite)||rival.power<0||rival.rate<0)return Infinity;
  const enemy=rival.power+rival.rate*gameAt;
  if(warfare.threshold===1){
   if(enemy>0||rival.rate>0)return Infinity;
   if(power===0){if(rate<=0)return Infinity;earliest=Math.max(earliest,Number.EPSILON/rate);}
   continue;
  }
  const factor=warfare.threshold/(1-warfare.threshold),deficit=enemy===0?Number.EPSILON-power:enemy*factor-power;
  const closing=rate-rival.rate*factor;
  if(deficit>0){if(closing<=0)return Infinity;earliest=Math.max(earliest,deficit/closing);}
  else if(closing<0)latest=Math.min(latest,deficit/closing);
 }
 return earliest<=latest?earliest:Infinity;
}

export function chooseGangAscensions(results,gang,names,stats,base=1.05,spacing=0.05,limit=1,adaptive=false) {
  if(names.length<12&&gang.respectForNextRecruit>0&&gang.respect>=gang.respectForNextRecruit*0.8)return [];
  const lossBudget=Math.max(0,gang.respect)*(names.length<12?0.1:0.25);
  return names.map((name,index)=>{
    const result=results[name];if(!result)return null;
    const weights=Array.isArray(stats)?Object.fromEntries(stats.map(k=>[k,1])):stats?.[name]||{};
    const entries=Object.entries(weights).filter(([k,w])=>['hack','str','def','dex','agi','cha'].includes(k)&&Number.isFinite(w)&&w>0);
    if(!entries.length||entries.some(([k])=>result[k]!==undefined&&(!Number.isFinite(result[k])||result[k]<1)))return null;
    const totalWeight=entries.reduce((v,[,w])=>v+w,0);
    const gain=Math.exp(entries.reduce((sum,[key,w])=>sum+w*Math.log(Math.max(1,Number(result[key])||1)),0)/totalWeight);
    const loss=Math.max(0,Number(result.respect)||0);
    return {name,gain,loss,threshold:base+(adaptive?0:(11-index)*spacing)};
  }).filter(item=>item&&item.gain>=item.threshold&&item.loss<=lossBudget)
    .sort((a,b)=>(b.gain-1)/(1+b.loss/Math.max(1,gang.respect))-(a.gain-1)/(1+a.loss/Math.max(1,gang.respect))).slice(0,limit);
}
export function gangTaskTotals(assignments) {
  return Object.values(assignments).reduce((sum,task)=>({wanted:sum.wanted+task.wanted,respect:sum.respect+task.respect,money:sum.money+task.money}),{wanted:0,respect:0,money:0});
}
export function wantedRecoveryOrder(names,assignments,rates,reductionTask,focus) {
  const value=task=>focus==='money'?task.money:focus==='respect'?task.respect:task[focus]??(task.money/1000+task.respect);
  return names.map(name=>{
    const current=rates[name]?.find(task=>task.name===assignments[name]);
    const recovery=rates[name]?.find(task=>task.name===reductionTask);
    if(!current||!recovery||current.wanted<=recovery.wanted)return null;
    return {name,cost:Math.max(0,value(current)-value(recovery))/(current.wanted-recovery.wanted)};
  }).filter(Boolean).sort((a,b)=>a.cost-b.cost).map(item=>item.name);
}
export function purchaseGangEquipment(ns,orders,reserve,budget,claim = () => true, allowed = () => true,detailed=false,ownerPid=null,powerAllowed=()=>false) {
  let remaining=Math.max(0,budget);
  const bundles=new Map();
  let readinessInterrupted=false,guardedOrder=false;
  const quoteInvestment=(order,cost)=>{
    try{
      if(!Number.isSafeInteger(ownerPid)||ownerPid<=0||order.bundleId||order.reason!=='production'||!ns.fileExists('Formulas.exe','home'))return null;
      const member=ns.gang.getMemberInformation(order.member);
      if([...member.upgrades,...member.augmentations].includes(order.equipmentName))return null;
      const gang=ns.gang.getGangInformation(),task=ns.gang.getTaskStats(member.task),stats=ns.gang.getEquipmentStats(order.equipmentName);
      const before={...member},after={...member};
      for(const k of ['hack','str','def','dex','agi','cha']){
        const factor=stats[k]??1,mult=member[k+'_mult'],asc=member[k+'_asc_mult'],exp=member[k+'_exp'];
        if(![factor,mult,asc,exp].every(Number.isFinite)||factor<=0||mult<=0||asc<=0||exp<0)return null;
        before[k]=Math.max(1,Math.floor(mult*asc*(32*Math.log(exp+534.5)-200)));
        after[k]=Math.max(1,Math.floor(mult*factor*asc*(32*Math.log(exp+534.5)-200)));
      }
      const baseline=ns.formulas.gang.moneyGain(gang,before,task),upgraded=ns.formulas.gang.moneyGain(gang,after,task);
      const oldWanted=ns.formulas.gang.wantedLevelGain(gang,before,task),newWanted=ns.formulas.gang.wantedLevelGain(gang,after,task);
      if(![baseline,upgraded,oldWanted,newWanted].every(Number.isFinite)||upgraded<=baseline||newWanted>oldWanted+1e-9)return null;
      const reset=ns.getResetInfo();
      return {kind:'gang-equipment',at:Date.now(),ownerPid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,
        cost,gainPerSecond:(upgraded-baseline)*5,member:order.member,equipment:order.equipmentName};
    }catch{return null;}
  };

  const result=(success,reason,price=0)=>{if(!success&&guardedOrder)readinessInterrupted=true;return detailed?{success,reason,price}:success;};
  return orders.map(order=>{
    guardedOrder=order.readinessGuarded===true;
    if(guardedOrder&&readinessInterrupted)return result(false,'readiness-batch-interrupted');
    if(!allowed(ns))return result(false,'controller-paused');
    if(guardedOrder&&Number.isFinite(order.readinessCashFloor)&&ns.getPlayer().money-Math.max(0,reserve,Number(ns.read('reserve.txt'))||0)<order.readinessCashFloor)return result(false,'readiness-cash-changed');
    if(order.bundleId&&!bundles.has(order.bundleId)){
      const group=orders.filter(o=>o.bundleId===order.bundleId),prices=group.map(o=>ns.gang.getEquipmentCost(o.equipmentName));
      const total=prices.reduce((a,b)=>a+b,0),hold=Math.max(0,reserve,Number(ns.read('reserve.txt'))||0);
      let reason=null;
      if(prices.some(p=>!(p>0)||!Number.isFinite(p)))reason='invalid-price';
      else if(prices.some((p,i)=>p>group[i].cost))reason='price-increased';
      else if(total>remaining)reason='batch-budget';
      else if(ns.getPlayer().money<total+hold)reason='cash-reserve';
      else if(!claim(ns,'gang',total))reason='shared-budget';
      bundles.set(order.bundleId,{reason});
    }
    const bundle=order.bundleId?bundles.get(order.bundleId):null;
    if(bundle?.reason)return result(false,bundle.reason);
    const price=ns.gang.getEquipmentCost(order.equipmentName);
    const hold=Math.max(0,reserve,Number(ns.read('reserve.txt'))||0);
    if(!(price>0)||!Number.isFinite(price))return result(false,'invalid-price');
    if(Number.isFinite(order.cost)&&price>order.cost)return result(false,'price-increased',price);
    if(order.reason==='power'&&!powerAllowed(ns,order))return result(false,'power-quote-changed',price);
    if(order.reason==='cheap'){
      const cash=ns.getPlayer().money-hold,fraction=order.cheapFraction;
      if(!Number.isFinite(cash)||!Number.isFinite(fraction)||fraction<=0||fraction>.01||!(price<cash*fraction))return result(false,'cheap-threshold-changed',price);
    }
    if(order.type!=='Augmentation'&&Number.isFinite(order.lifetimeExpiresAt)){
      const useful=(order.lifetimeExpiresAt-Date.now())/1000;
      const repay=order.reason==='production'?order.cashPaybackSeconds:order.reason==='recruitment'?order.recruitSeconds:order.reason==='power'?order.powerPaybackSeconds:order.valuePaybackSeconds;
      if(!(useful>0)||!Number.isFinite(repay)||repay>useful)return result(false,'equipment-lifetime-changed',price);
    }
    if(price>remaining)return result(false,'batch-budget',price);
    if(ns.getPlayer().money<price+hold)return result(false,'cash-reserve',price);
    if(!bundle&&!claim(ns,"gang",price,quoteInvestment(order,price)))return result(false,'shared-budget',price);
    const success=ns.gang.purchaseEquipment(order.member,order.equipmentName);
    if(success)remaining-=price;
    else if(bundle)bundle.reason='bundle-interrupted';
    return result(success,success?'purchased':'game-rejected',price);
  });
}

/** Self-contained so pending helpers cannot mutate a paused or exited controller. */
export function gangMutationAllowed(ns,ownerPid=null) {
 if(ownerPid!==null&&!ns.isRunning(ownerPid))return false;
 if(ns.read('remote-control/paused/gangs.js.txt').trim()==='true')return false;
 try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return false;}catch{}
 try{const p=JSON.parse(ns.read('tasks/achievement-profile.json'));if(p.active&&p.nodeReset===ns.getResetInfo().lastNodeReset&&p.deniedActions?.includes('gang'))return false;}catch{}
 return true;
}
export function gangOptionsError(o) {
 for(const k of ['training-percentage','equipment-budget','augmentations-budget'])if(o[k]!==null&&(!Number.isFinite(o[k])||o[k]<0||o[k]>1))return k+' must be between 0 and 1.';
 if(!Number.isFinite(o['warfare-win-chance'])||o['warfare-win-chance']<0.5||o['warfare-win-chance']>1)return 'warfare-win-chance must be between 0.5 and 1.';
 for(const k of ['min-training-ticks','ascend-multi-threshold-spacing','reserve'])if(o[k]!==null&&(!Number.isFinite(o[k])||o[k]<0))return k+' must be nonnegative.';
 if(!Number.isFinite(o['ascend-multi-threshold'])||o['ascend-multi-threshold']<=1)return 'ascend-multi-threshold must exceed 1.';
 if(o['money-focus']&&o['reputation-focus'])return 'Choose either money-focus or reputation-focus.';
 return null;
}
export function gangTrainingRequired(lastReset,now,ticks,tickTime=20000) {
 return Number.isFinite(lastReset)&&now-lastReset<ticks*tickTime;
}
/** Only strict wanted reductions can advance recovery; mandatory training stays intact. */
export function nextWantedDowngrade(assignments,rates,locked=[],focus='respect') {
 const lock=new Set(locked);let best=null;
 const value=task=>Math.max(0,Number(task[focus])||0);
 for(const [name,current]of Object.entries(assignments)) {
  if(lock.has(name))continue;
  for(const next of rates[name]||[]) {
   if(!Number.isFinite(next.wanted)||next.wanted>=current.wanted)continue;
   const reduction=current.wanted-next.wanted;
   const cost=Math.max(0,value(current)-value(next))/reduction;
   if(!best||cost<best.cost||cost===best.cost&&reduction>best.reduction)best={name,task:next,cost,reduction};
  }
 }
 return best?{name:best.name,task:best.task}:null;
}
/** Keep the prior recovery path as a candidate: cost ratios alone can overshoot a small deficit. */
export function largestWantedDowngrade(assignments,rates,locked=[]) {
 const lock=new Set(locked);let best=null;
 for(const [name,current]of Object.entries(assignments)) {
  if(lock.has(name))continue;
  const next=rates[name]?.find(task=>Number.isFinite(task.wanted)&&task.wanted<current.wanted);
  if(next&&(!best||current.wanted>assignments[best.name].wanted))best={name,task:next};
 }
 return best;
}
/** Use spare wanted capacity after recovery, without undoing mandatory training. */
export function improveGangPlan(assignments,rates,focus,tolerance,locked=[]) {
 const plan={...assignments},lock=new Set(locked);
 let wanted=gangTaskTotals(plan).wanted;
 if(wanted>tolerance)return plan;
 // Each accepted change strictly increases the objective; the bound also limits CPU work.
 const limit=Object.values(rates).reduce((sum,tasks)=>sum+tasks.length,0);
 for(let step=0;step<limit;step++) {
  let best=null;
  for(const [name,current]of Object.entries(plan)) {
   if(lock.has(name))continue;
   for(const task of rates[name]||[]) {
    const gain=(Number(task[focus])||0)-(Number(current[focus])||0);
    const nextWanted=wanted+task.wanted-current.wanted;
    if(gain>0&&Number.isFinite(nextWanted)&&nextWanted<=tolerance&&(!best||gain>best.gain))best={name,task,gain,wanted:nextWanted};
   }
  }
  if(!best)break;
  plan[best.name]=best.task;wanted=best.wanted;
 }
 return plan;
}
export function betterGangPlan(wanted,gain,previousWanted,previousGain,tolerance) {
 const feasible=wanted<=tolerance,previousFeasible=previousWanted<=tolerance;
 if(feasible!==previousFeasible)return feasible;
 return feasible?gain>previousGain:wanted<previousWanted||wanted===previousWanted&&gain>previousGain;
}

/** Recheck the candidate against fresh respect, then remove combat exposure before resetting stats. */
export function ascendGangMemberSafely(ns,name,stats,base,spacing,choose,allowed,economics=null){
 if(!allowed(ns))return null;
 const names=ns.gang.getMemberNames(),gang=ns.gang.getGangInformation();
 const results=Object.fromEntries(names.map(n=>[n,ns.gang.getAscensionResult(n)]));
 if(economics){
  if(economics.restoreEquipment===true)return null; // No post-reset purchases are guaranteed.
  if(!(economics.expiresAt>Date.now())||economics.name!==name||!Number.isFinite(economics.paybackSeconds)||economics.paybackSeconds>economics.horizonSeconds)return null;
  if(!choose(results,gang,names,stats,base,spacing,12,economics.adaptive===true).some(c=>c.name===name))return null;
  if(economics.crewNames&&(names.length!==economics.crewNames.length||names.some(n=>!economics.crewNames.includes(n))))return null;
   if(economics.gang&&['respect','wantedLevel'].some(k=>Math.abs(gang[k]-economics.gang[k])>Math.max(1,Math.abs(economics.gang[k])*.02)))return null;
   if(Number.isFinite(economics.respectLoss)&&Math.abs((results[name]?.respect||0)-economics.respectLoss)>Math.max(1,economics.respectLoss*.02))return null;
   if(economics.warfare?.active){
    const w=economics.warfare,others=ns.gang.getAllGangInformation();
    if(![gang.power,gang.territory,gang.territoryClashChance].every(Number.isFinite)||
     Math.abs((gang.territoryWarfareEngaged?1:gang.territoryClashChance)-w.clashChance)>.01||gang.faction!==w.faction||Math.abs(gang.power-w.power)>Math.max(1e-6,w.power*.02)||Math.abs(gang.territory-w.territory)>.001)return null;
    const rivals=Object.entries(others).filter(([other,r])=>other!==gang.faction&&r.territory>0);
    if(rivals.some(([,r])=>!Number.isFinite(r.power)||r.power>w.rivalPower+Math.max(1e-6,w.rivalPower*.02)))return null;
   }
   if(economics.crewSnapshot)for(const [other,snapshot]of Object.entries(economics.crewSnapshot)){
    if(!names.includes(other))return null;
    const live=ns.gang.getMemberInformation(other);
    if(live.task!==snapshot.task||['upgrades','augmentations'].some(key=>JSON.stringify([...(live[key]||[])].sort())!==JSON.stringify([...(snapshot[key]||[])].sort())))return null;
    if(['hack','str','def','dex','agi','cha'].some(key=>!Number.isFinite(live[key])||Math.abs(live[key]-snapshot[key])>Math.max(1,Math.abs(snapshot[key])*.02)))return null;
   }
   if(Number.isFinite(economics.cashAtQuote)&&ns.getServerMoneyAvailable('home')<economics.cashAtQuote-1)return null;
   const member=ns.gang.getMemberInformation(name);
  if((Array.isArray(stats)?stats:Object.keys(stats?.[name]||{})).some(k=>Math.abs((results[name]?.[k]||0)-(economics.ascension?.[k]||0))>.01||
    Math.abs((member[k]||0)-(economics.member?.[k]||0))>Math.max(1,(economics.member?.[k]||0)*.02)))return null;
 }else if(choose(results,gang,names,stats,base,spacing)[0]?.name!==name)return null;
 const trainingTask=economics?.trainingTask||'Train '+(gang.isHacking?'Hacking':'Combat');
 if(!['Train Combat','Train Hacking','Train Charisma'].includes(trainingTask))return null;
 ns.gang.setTerritoryWarfare(false);
 const result=ns.gang.ascendMember(name);
 if(result)ns.gang.setMemberTask(name,trainingTask);
 return result;
}
export function restoreGangTraining(saved,reset,names,now=Date.now()){
 if(saved?.nodeReset!==reset.lastNodeReset||saved?.augReset!==reset.lastAugReset)return {};
 return Object.fromEntries(names.filter(name=>Number.isFinite(saved.members?.[name])&&saved.members[name]>=0&&saved.members[name]<=now).map(name=>[name,saved.members[name]]));
}
/** Safe cleanup during maintenance and exit; leave ordinary assignments alone. */
export function suspendGangWarfare(ns,assignments){
 try{ns.gang.setTerritoryWarfare(false);}catch{}
 for(const [name,task]of Object.entries(assignments))try{if(task!=='Territory Warfare'&&ns.gang.getMemberInformation(name).task==='Territory Warfare')ns.gang.setMemberTask(name,task);}catch{}
}


/** Source: 25 cycles per 200 ms update while stored cycles remain.
 * bonusSeconds is the excess stored time above the ordinary two-second batch. */
export function gangGameSeconds(wallSeconds,bonusSeconds=0){
 const wall=Number.isFinite(wallSeconds)?Math.max(0,wallSeconds):0;
 const bonus=Number.isFinite(bonusSeconds)?Math.max(0,bonusSeconds):0;
 return wall+Math.min(bonus,24*wall);
}
export function gangWallSeconds(gameSeconds,bonusSeconds=0){
 const game=Number.isFinite(gameSeconds)?Math.max(0,gameSeconds):0;
 const bonus=Number.isFinite(bonusSeconds)?Math.max(0,bonusSeconds):0;
 return game<=bonus*25/24?game/25:game-bonus;
}

/** Native gang skill and experience projection (five cycles per second). */
export function projectGangMember(member,task,seconds=0,upgrade={}) {
 const next={...member};
 for(const k of ['hack','str','def','dex','agi','cha']){
  const mult=Math.max(1,Number(member[k+'_mult'])||1)*(Number(upgrade[k])||1);
  const asc=Math.max(1,Number(member[k+'_asc_mult'])||1);
  const exp=Math.max(0,Number(member[k+'_exp'])||0)+Math.max(0,seconds)*5*Math.pow(Math.max(0,Number(task?.difficulty)||0),.9)*
   Math.max(0,Number(task?.[k+'Weight'])||0)/1500*((mult-1)/4+1)*asc;
  next[k+'_mult']=mult;next[k+'_exp']=exp;
  next[k]=Math.max(1,Math.floor(mult*asc*(32*Math.log(exp+534.5)-200)));
 }
 return next;
}

/** Keep a brief settling period; beyond it train only when incremental gains repay lost work. */
export function gangTrainingDecision({elapsed=Infinity,maximum=200000,current=0,trained=0,working=0,window=20,horizon=300,allowExtended=true}) {
 if(elapsed<2000)return true;
 if(elapsed>=maximum&&!allowExtended)return false;
 if(!(current>0))return elapsed<maximum||Number.isFinite(trained)&&Number.isFinite(working)&&trained>working&&trained>0;
 if(!Number.isFinite(trained)||!Number.isFinite(working)||!Number.isFinite(window)||window<=0||!Number.isFinite(horizon)||horizon<=window)return false;
 return (trained-working)*Math.max(0,horizon-window)>current*window*1.05;
}

export function gangAscensionEconomics({before,after,trainingSeconds,replacementCost=0,moneyPerSecond=0,horizonSeconds=900}) {
 if(!(after>before)||!(after>0))return null;
 const production=before*trainingSeconds/(after-before);
 const equipment=replacementCost>0?(moneyPerSecond>0?replacementCost/moneyPerSecond:Infinity):0;
 const paybackSeconds=trainingSeconds+production+equipment;
 return Number.isFinite(paybackSeconds)&&paybackSeconds<=horizonSeconds?{paybackSeconds,horizonSeconds}:null;
}

/** Unknown ascension timing leaves the ordinary horizon intact; augmentations survive it. */
export function gangEquipmentLifetime(type,horizon,ascensionSeconds=null){
 if(!Number.isFinite(horizon)||horizon<0)return null;
 if(type==='Augmentation'||ascensionSeconds===null||ascensionSeconds===undefined)return horizon;
 return Number.isFinite(ascensionSeconds)&&ascensionSeconds>=0?Math.min(horizon,ascensionSeconds):null;
}

/** Cash returns and progression utility have separate budgets and telemetry. */
export function rankGangEquipment(orders,horizon=900,recruitment=null) {
 const ranked=[];
 for(const order of orders){
  if(!(order.cost>0)||!Number.isFinite(order.cost))continue;
  const useful=gangEquipmentLifetime(order.type,horizon,order.lifetimeSeconds);if(useful===null||useful<=0)continue;
  const cashPaybackSeconds=Number.isFinite(order.moneyGain)&&order.moneyGain>0?order.cost/order.moneyGain:Infinity;
  const valuePaybackSeconds=Number.isFinite(order.objectiveGain)&&order.objectiveGain>0?order.cost/order.objectiveGain:Infinity;
  const r=recruitment;
  const eligible=r&&r.memberCount<12&&r.memberCount>=0&&Number.isFinite(r.respectRate)&&r.respectRate>0&&
   Number.isFinite(r.respectGap)&&r.respectGap>0&&Number.isFinite(r.bootstrapBudget)&&order.cost<=r.bootstrapBudget&&
   Number.isFinite(order.respectGain)&&order.respectGain>0;
  const eta=eligible?r.respectGap/r.respectRate:0;
  const recruitAt=eligible?r.respectGap/(r.respectRate+order.respectGain):Infinity;
  const bounded=order.type!=='Augmentation'&&Number.isFinite(order.lifetimeSeconds);
  const saved=eligible&&(!bounded||recruitAt<=order.lifetimeSeconds)?eta-recruitAt:0;
  const data={...order,usefulSeconds:useful,recruitSeconds:Number.isFinite(recruitAt)?recruitAt:null,cashPaybackSeconds:Number.isFinite(cashPaybackSeconds)?cashPaybackSeconds:null,
   valuePaybackSeconds:Number.isFinite(valuePaybackSeconds)?valuePaybackSeconds:null,recruitSecondsSaved:saved};
  if(order.powerObjective===true&&Number.isFinite(order.powerGainPerTick)&&order.powerGainPerTick>0&&Number.isFinite(order.powerPaybackSeconds)&&order.powerPaybackSeconds<=useful&&order.cost<=Math.max(0,recruitment?.bootstrapBudget||0)&&!order.items)ranked.push({...data,paybackSeconds:order.powerPaybackSeconds,reason:'power'});
  else if(cashPaybackSeconds<=useful)ranked.push({...data,paybackSeconds:cashPaybackSeconds,reason:'production'});
  else if(saved>=Math.max(20,eta*.02))ranked.push({...data,paybackSeconds:null,reason:'recruitment'});
  else if(r?.allowProgression===true&&order.cost<=r.bootstrapBudget&&(valuePaybackSeconds<=useful||!bounded&&Number.isFinite(order.relativeObjectiveGain)&&order.relativeObjectiveGain>=.02&&order.objectiveGain>0))
   ranked.push({...data,paybackSeconds:null,reason:'progression'});
 }
 const priority={power:-1,production:0,recruitment:1,progression:2};
 return ranked.sort((a,b)=>priority[a.reason]-priority[b.reason]||
  (a.reason==='power'?b.powerGainPerTick/b.cost-a.powerGainPerTick/a.cost:a.reason==='recruitment'?b.recruitSecondsSaved/b.cost-a.recruitSecondsSaved/a.cost:
   a.reason==='production'?a.cashPaybackSeconds-b.cashPaybackSeconds:a.valuePaybackSeconds-b.valuePaybackSeconds)||(a.type==='Augmentation'?0:1)-(b.type==='Augmentation'?0:1)||a.cost-b.cost);
}

/** Both the planner and forecasts express their objective in the same units. */
export function gangObjectiveValue(rate,focus,weight=1000) {
 const money=Number(rate.money)||0,respect=Number(rate.respect)||0;
 return focus==='money'?money:focus==='respect'?respect:money/Math.max(1,Number(weight)||1000)+respect;
}
export function gangObjectiveWeight(goal) {
 return Number.isFinite(goal?.cost)&&goal.cost>0&&Number.isFinite(goal?.rep)&&goal.rep>0?Math.max(1,goal.cost/(goal.rep*75)):1000;
}
/** Smooth raw wanted budget targeting a small margin below the requested penalty.
 * Respect/wanted rates are per native game cycle; correct the ratio error over 120 game seconds.
 * Raw neutrality permits justice to recover wanted without demanding its percentage reduction twice. */
export function gangWantedTolerance(gang,threshold=.01) {
 const {respect,wantedLevel:wanted,respectGainRate:gain}=gang||{};
 if(![respect,wanted,gain,threshold].every(Number.isFinite)||respect<1||wanted<1||threshold<=0||threshold>=1)return 0;
 const growth=Math.max(0,gain),ratio=threshold*.9/(1-threshold*.9);
 if(respect<=200)return Math.max(growth/1000,wanted/10);
 const target=Math.max(1,respect*ratio),correction=(target-wanted)/600;
 return Math.max(0,Math.min(Math.max(growth*ratio,wanted/10),growth*ratio+correction));
}

export function gangTrainingTaskName(assigned,isHacking=false){
 return ['Train Combat','Train Hacking','Train Charisma'].includes(assigned)?assigned:'Train '+(isHacking?'Hacking':'Combat');
}

/** Restore only warfare assignments; never interrupt members already working or training. Self-contained. */
export function restoreGangProductiveTasks(ns,assignments,allowed,owner) {
 let restored=0;const failed=[];
 if(!allowed(ns,owner))return {deferred:true,restored,failed};
 const names=ns.gang.getMemberNames(),training='Train '+(ns.gang.getGangInformation().isHacking?'Hacking':'Combat');
 for(const name of names){
  if(!allowed(ns,owner))return {deferred:true,restored,failed};
  if(ns.gang.getMemberInformation(name).task!=='Territory Warfare')continue;
  const task=assignments[name]&&assignments[name]!=='Territory Warfare'?assignments[name]:training;
  if(ns.gang.setMemberTask(name,task)||ns.gang.getMemberInformation(name).task===task)restored++;
  else failed.push(name);
 }
 return {deferred:false,restored,failed};
}

/** Shared sampling makes training comparisons fair, including a finite bonus-time tail.
 * Automatic short windows respect the controller's minimum two-second recovery hold.
 * Explicit caller windows stay authoritative. Extra accelerated samples are bounded. */
export function gangDevelopmentTimeline(horizon,windows=null,bonusSeconds=0){
 if(!Number.isFinite(horizon)||horizon<=0)return {durations:[],times:[]};
 const ordinary=[20,60,120,200,300],bonus=Number.isFinite(bonusSeconds)?Math.max(0,bonusSeconds):0;
 const requested=windows??(bonus>0?[...ordinary.map(s=>Math.max(2,gangWallSeconds(s,bonus))),...ordinary]:ordinary);
 const durations=[...new Set(requested.filter(s=>Number.isFinite(s)&&s>0&&s<horizon))].sort((a,b)=>a-b);
 const step=Math.max(20,Math.ceil(horizon/1200)*20),fastEnd=Math.min(horizon,bonus/24),fastStep=Math.max(2,fastEnd/60);
 const fast=bonus>0?Array.from({length:Math.ceil(fastEnd/fastStep)},(_,i)=>Math.min(fastEnd,(i+1)*fastStep)):[];
 const times=[...new Set([0,horizon,...durations,...fast,...Array.from({length:Math.ceil(horizon/step)},(_,i)=>Math.min(horizon,(i+1)*step))])].sort((a,b)=>a-b);
 return {durations,times};
}

/** Forecast the whole crew, including natural work XP and the global wanted penalty.
 * evaluate returns per-second value/money/respect/wanted and a chosen task.
 * Other members retain their feasible assignments while the candidate may change tasks. */
export function forecastGangAscension({members,name,ascended,gang,training,tasks,assignments,evaluate,
 horizonSeconds=900,windows=null,respectLoss=0,bonusSeconds=0}) {
 if(!members[name]||!ascended||!training||!Number.isFinite(horizonSeconds)||horizonSeconds<=(Number.isFinite(bonusSeconds)&&bonusSeconds>0?2:20)||!Number.isFinite(respectLoss)||respectLoss<0)return null;
 const {durations,times}=gangDevelopmentTimeline(horizonSeconds,windows,bonusSeconds);
 const simulate=(delay,reset)=>{
  let crew=Object.fromEntries(Object.entries(members).map(([n,m])=>[n,reset&&n===name?projectGangMember(ascended,null,0):{...m}]));
  let state={...gang,respect:Math.max(1,gang.respect-(reset?respectLoss:0))},total=0,candidateTotal=0,at=0,recruitAt=null;
  const cumulative=[];
  for(const end of times){
   if(end<=at)continue;
   let respect=0,wanted=0,justice=0,value=0,candidateValue=0;
   const next={};
   for(const [n,m] of Object.entries(crew)){
    const forced=reset&&n===name&&at<delay?training.name:n===name?null:assignments[n]||m.task;
    const before=evaluate(m,state,forced),task=tasks[before.task];
    if(!task)return null;
    next[n]=projectGangMember(m,task,gangGameSeconds(end,bonusSeconds)-gangGameSeconds(at,bonusSeconds));
    const after=evaluate(next[n],state,before.task);
    if(![before.value,after.value,before.respect,after.respect,before.wanted,after.wanted].every(Number.isFinite))return null;
    const gain=(before.value+after.value)/2;
    value+=gain;if(n===name)candidateValue=gain;
    respect+=(before.respect+after.respect)/2;wanted+=(before.wanted+after.wanted)/2;
    if(task.baseWanted<0)justice++;
   }
   const seconds=gangGameSeconds(end,bonusSeconds)-gangGameSeconds(at,bonusSeconds),oldRespect=state.respect;
   state.respect+=respect*seconds;
   // Native justice applies a multiplicative wanted reduction once per processing update.
   state.wantedLevel=Math.max(1,(state.wantedLevel+wanted*seconds)*Math.pow(1-justice*.001,seconds/2));
   if(recruitAt===null&&members&&Object.keys(members).length<12&&gang.respectForNextRecruit>0&&state.respect>=gang.respectForNextRecruit)
    recruitAt=gangWallSeconds(gangGameSeconds(at,bonusSeconds)+Math.max(0,gang.respectForNextRecruit-oldRespect)/Math.max(1e-9,respect),bonusSeconds);
   total+=value*seconds;candidateTotal+=candidateValue*seconds;at=end;crew=next;
   cumulative.push({at,total});
  }
  const finalRates=Object.values(crew).map(m=>evaluate(m,state,m.name===name?null:assignments[m.name]||m.task));
  const respectRate=finalRates.reduce((sum,r)=>sum+r.respect,0);
  const eta=Object.keys(members).length>=12?0:recruitAt??(respectRate>0?gangWallSeconds(gangGameSeconds(horizonSeconds,bonusSeconds)+Math.max(0,gang.respectForNextRecruit-state.respect)/respectRate,bonusSeconds):Infinity);
  const recruitValue=Math.min(...finalRates.filter(r=>r.value>0).map(r=>r.value));
  return {total,candidateTotal,eta,recruitValue:Number.isFinite(recruitValue)?recruitValue:0,cumulative};
 };
 const baseline=simulate(0,false);if(!baseline)return null;
 let best=null;
 for(const trainingSeconds of durations){
  const after=simulate(trainingSeconds,true);if(!after)continue;
  const recruitDelaySeconds=baseline.eta===Infinity?0:Math.max(0,after.eta-baseline.eta);
  const recruitmentCost=recruitDelaySeconds>0&&!Number.isFinite(after.eta)?Infinity:(recruitDelaySeconds>0?gangGameSeconds(after.eta,bonusSeconds)-gangGameSeconds(baseline.eta,bonusSeconds):0)*baseline.recruitValue;
  const netGain=after.total-baseline.total-recruitmentCost;
  if(!Number.isFinite(netGain)||netGain<=Math.max(1e-9,baseline.candidateTotal*.05))continue;
  const paid=after.cumulative.find((v,i)=>v.at>=trainingSeconds&&v.total-baseline.cumulative[i].total>recruitmentCost);
  if(!paid)continue;
  const plan={trainingSeconds,paybackSeconds:paid.at,horizonSeconds,netGain,baseline:baseline.total,production:after.total,recruitDelaySeconds,recruitmentCost};
  if(!best||plan.netGain>best.netGain)best=plan;
 }
 return best;
}

/** Compare training against continued work on a shared bounded timeline, including task unlocks.
 * Identical XP paths cannot create fictitious training gains through different sampling intervals. */
export function forecastGangTraining(member,training,tasks,evaluate,horizon=900,windows=null,bonusSeconds=0,milestones=null) {
 const initial=evaluate(member);
 if(!Number.isFinite(horizon)||horizon<=(Number.isFinite(bonusSeconds)&&bonusSeconds>0?2:20)||!Number.isFinite(initial.value)||initial.value<0||!training)return {train:false,window:0};
 const {durations,times}=gangDevelopmentTimeline(horizon,windows,bonusSeconds);
 // Other crew production stays at the current productive rate. These are estimates, not reset deadlines.
 const goals=(milestones?.goals||[]).filter(g=>Number.isFinite(g.amount)&&g.amount>0&&['money','respect'].includes(g.resource));
 const integrate=(delay)=>{
  let current=member,at=0,total=0;
  const earned={money:0,respect:0},eta={},lastRates={money:0,respect:0};
  for(const end of times){
   if(end<=at)continue;
   const before=at<delay?{value:0,task:null}:evaluate(current);
   const seconds=gangGameSeconds(end,bonusSeconds)-gangGameSeconds(at,bonusSeconds);
   current=projectGangMember(current,at<delay?training:tasks[before.task],seconds);
   const after=at<delay?{value:0}:evaluate(current);
   if(!Number.isFinite(before.value)||!Number.isFinite(after.value))return null;
   total+=(before.value+after.value)*seconds/2;
   for(const resource of ['money','respect']){
    const own=((Number(before[resource])||0)+(Number(after[resource])||0))/2;
    const rate=Math.max(0,own+(Number(milestones?.other?.[resource])||0));
    lastRates[resource]=rate;
    const wallRate=resource==='money'?Math.max(0,Number(milestones?.otherCashRate)||0):0;
    const produced=rate*seconds+wallRate*(end-at);
    for(const goal of goals.filter(g=>g.resource===resource)){
     if(eta[goal.name]===undefined&&earned[resource]+produced>=goal.amount&&produced>0)
      eta[goal.name]=at+(end-at)*(goal.amount-earned[resource])/produced;
    }
    earned[resource]+=produced;
   }
   at=end;
  }
  for(const goal of goals)if(eta[goal.name]===undefined){
   const remaining=goal.amount-earned[goal.resource];
   const rate=lastRates[goal.resource],wallRate=goal.resource==='money'?Math.max(0,Number(milestones?.otherCashRate)||0):0;
   const fastTime=Math.max(0,bonusSeconds-horizon*24)/24,fastRate=rate*25+wallRate,normalRate=rate+wallRate;
   eta[goal.name]=fastRate>0&&remaining<=fastTime*fastRate?horizon+remaining/fastRate:
    normalRate>0?horizon+fastTime+Math.max(0,remaining-fastTime*fastRate)/normalRate:Infinity;
  }
  return {total,eta};
 };
 const baseline=integrate(0);
 if(!baseline)return {train:false,window:0};
 let best={train:false,window:0,baseline:baseline.total,production:baseline.total,gain:0,baselineMilestones:baseline.eta};
 let milestoneRejected=false;
 for(const seconds of durations){
  const candidate=integrate(seconds);
  if(!candidate)continue;
  const groups=[...new Set(goals.map(goal=>goal.group||goal.name))];
  const safe=groups.every(group=>{
   const names=goals.filter(goal=>(goal.group||goal.name)===group).map(goal=>goal.name);
   const before=Math.max(...names.map(name=>baseline.eta[name])),after=Math.max(...names.map(name=>candidate.eta[name]));
   return !Number.isFinite(before)||after<=before+2;
  });
  if(!safe&&candidate.total>baseline.total*1.05)milestoneRejected=true;
  if(safe&&candidate.total>best.production&&candidate.total>baseline.total*1.05)
   best={train:true,window:seconds,baseline:baseline.total,production:candidate.total,gain:candidate.total-baseline.total,
    baselineMilestones:baseline.eta,trainingMilestones:candidate.eta};
 }
 return {...best,milestoneBlocked:!best.train&&milestoneRejected};
}

/** Constant-rate approximation of native wanted batches: additive gain, then justice.
 * Normal batches cover two game seconds, bonus batches five. Clamp at the native floor. */
export function projectGangWanted(wanted,rate,justice,seconds,batchSeconds=2){
 if(![wanted,rate,justice,seconds,batchSeconds].every(Number.isFinite)||wanted<1||justice<0||justice>12||seconds<0||batchSeconds<=0)return null;
 if(seconds===0)return wanted;
 if(wanted===1&&rate<0)return 1;
 const factor=1-justice*.001,power=Math.pow(factor,seconds/batchSeconds);
 const projected=justice===0?wanted+rate*seconds:power*wanted+factor*rate*batchSeconds*(1-power)/(1-factor);
 return Math.max(1,projected);
}

/** Rank ascension thresholds by the productive task the improved member could pursue. */
export function gangAscensionTaskWeights(members,results,tasks,evaluate,fallback=['str','def','dex','agi']){
 const output={};
 for(const [name,member]of Object.entries(members)){
  const result=results[name];if(!result)continue;
  const potential={...member};
  for(const key of ['hack','str','def','dex','agi','cha'])potential[key+'_asc_mult']=Math.max(1,Number(member[key+'_asc_mult'])||1)*Math.max(1,Number(result[key])||1);
  const projected=projectGangMember(potential,null,0);let chosen=null,score=-Infinity;
  for(const [name,task]of Object.entries(tasks)){
   if(name.startsWith('Train ')||name==='Territory Warfare'||name==='Unassigned'||task.baseWanted<0)continue;
   const value=evaluate(projected,name)?.value;
   if(Number.isFinite(value)&&value>score){score=value;chosen=task;}
  }
  const weights=Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,chosen?.[k+'Weight']||0]).filter(([,w])=>Number.isFinite(w)&&w>0));
  output[name]=Object.keys(weights).length?weights:Object.fromEntries(fallback.map(k=>[k,1]));
 }
 return output;
}

/** A completed witness can reject a purchase, never approve a partial search. */
export function gangDevelopmentDominated(equipment,free,{cost,costWeight,powerEnabled=false}={}){
 if(![cost,costWeight,equipment?.total,free?.total,equipment?.money,free?.money,equipment?.respectEarned,free?.respectEarned].every(Number.isFinite)||cost<0||costWeight<0)return false;
 const penalty=cost*costWeight,margin=Math.max(1e-9,Math.abs(free.total)*.001);
 if(free.total<=equipment.total-penalty+margin||free.money<equipment.money-cost||free.respectEarned<equipment.respectEarned)return false;
 if(!Array.isArray(equipment.cumulative)||!equipment.cumulative.length||!Array.isArray(free.cumulative)||free.cumulative.length!==equipment.cumulative.length)return false;
 if(Object.entries(equipment.eta||{}).some(([name,time])=>!(typeof time==='number'&&!Number.isNaN(time))||!(typeof free.eta?.[name]==='number'&&!Number.isNaN(free.eta[name]))||free.eta[name]>time))return false;
 if(powerEnabled&&(![equipment.power,free.power].every(Number.isFinite)||free.power<equipment.power||(free.powerReady??Infinity)>(equipment.powerReady??Infinity)))return false;
 return equipment.cumulative.every((p,i)=>{const q=free.cumulative[i];return [p.at,q?.at,p.total,q?.total].every(Number.isFinite)&&p.at===q.at&&q.total+penalty>=p.total&&(!powerEnabled||[p.power,q.power].every(Number.isFinite)&&q.power>=p.power);});
}

/** Native-valued locked crimes suggest windows; hints never authorize tasks or spending. */
export function gangCrimeTrainingHints({member,tasks,gang,evaluate,project,horizonSeconds,bonusSeconds=0}={}){
 if(!member||!tasks||typeof evaluate!=='function'||typeof project!=='function'||!Number.isFinite(horizonSeconds)||horizonSeconds<=40||!Number.isFinite(bonusSeconds)||bonusSeconds<0)return [];
 try{
  const crimes=[...new Map(Object.values(tasks).filter(t=>t&&typeof t.name==='string'&&!t.name.startsWith('Train ')&&t.name!=='Territory Warfare'&&((Number.isFinite(t.baseMoney)&&t.baseMoney>0)||(Number.isFinite(t.baseRespect)&&t.baseRespect>0))).map(t=>[t.name,t])).values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(0,64);
  const durations=[20,60,120,200,300].filter(s=>s<=horizonSeconds/2),last=durations.at(-1);if(!last)return [];
  const names=['Train Combat','Train Hacking','Train Charisma'].filter(name=>tasks[name]);
  const projected=names.map(name=>project(member,tasks[name],last+Math.min(bonusSeconds,last*24)));
  const rows=crimes.map(crime=>({crime,current:evaluate(member,gang,crime.name)?.value}));
  let baselineValue=Math.max(0,...rows.map(r=>Number.isFinite(r.current)?r.current:0));
  try{const current=evaluate(member,gang)?.value;if(Number.isFinite(current)&&current>=0)baselineValue=current;}catch{}
  // A single member changes the shared gang objective. These ranking estimates
  // are hints only; the full crew forecast still prices wanted and warfare effects.
  const locked=rows.filter(r=>Number.isFinite(r.current)&&r.current<=0).map(r=>{
   let potential=0;for(const future of projected){const v=evaluate(future,gang,r.crime.name)?.value;if(Number.isFinite(v)&&v>potential)potential=v;}
   const gain=potential*(horizonSeconds-durations[0])-baselineValue*horizonSeconds;
   return {...r,potential,rankingGain:gain};
  }).filter(r=>Number.isFinite(r.rankingGain)&&r.rankingGain>0).sort((a,b)=>b.rankingGain-a.rankingGain||b.potential-a.potential||a.crime.name.localeCompare(b.crime.name)).slice(0,16);
  const hints=[];
  for(const name of names){let best=null;
   for(const duration of durations){
    const next=project(member,tasks[name],duration+Math.min(bonusSeconds,duration*24));
    for(const row of locked){
     const value=evaluate(next,gang,row.crime.name)?.value,gain=value*(horizonSeconds-duration)-baselineValue*horizonSeconds;
     if(Number.isFinite(value)&&value>0&&Number.isFinite(gain)&&gain>0&&(!best||gain>best.estimatedGain||gain===best.estimatedGain&&(duration<best.duration||duration===best.duration&&row.crime.name.localeCompare(best.crime)<0)))
      best={task:name,duration,crime:row.crime.name,projectedValue:value,baselineValue,estimatedGain:gain,rankingGain:row.rankingGain};
    }
   }
   if(best)hints.push(best);
  }
  return hints;
 }catch{return [];}
}

/** Fixed planned training is shared by both equipment trajectories; wanted and warfare are replanned. */
export function forecastGangEquipmentDevelopment(options){
 const result=forecastGangCrewTraining({...options,names:[options.name],allowJointTraining:false,growthFirst:false,ascensions:options.alternativeAscension?{[options.name]:options.alternativeAscension}:null,compareTrainingOnly:false,referenceTraining:[],
  trainingOptions:['Train Combat','Train Hacking','Train Charisma'],equipmentDevelopment:{name:options.name,stats:options.stats,training:options.plannedTraining||[],compareFreeTraining:options.compareFreeTraining===true,extendedWindows:options.extendedWindows===true,alternateTrainingTasks:options.alternateTrainingTasks===true,earlyReject:options.earlyReject===true,crimeGuidedWindows:options.crimeGuidedWindows===true,cost:options.cost,costWeight:options.costWeight,trainingPermitted:options.trainingPermitted!==false}});
 return result.equipmentForecast?{...result.equipmentForecast,diagnostics:result.diagnostics}:options.returnIncomplete===true?{verified:false,diagnostics:result.diagnostics}:null;
}

/** Source ascension points = max(exp - 1000, 0); multiplier = max(sqrt(points/2000), 1).
 * Keep only the supplied retained augmentation multipliers; temporary equipment is discarded. */
export function projectFutureGangAscension(member,retained){
 if(!member||!retained||!Number.isFinite(member.earnedRespect)||member.earnedRespect<0)return null;
 const next={...retained,earnedRespect:0,upgrades:[]},multipliers={},result={respect:member.earnedRespect};
 for(const key of ['hack','str','def','dex','agi','cha']){
  const points=member[key+'_asc_points'],exp=member[key+'_exp'],mult=retained[key+'_mult'];
  if(![points,exp,mult].every(Number.isFinite)||points<0||exp<0||mult<1)return null;
  const after=points+Math.max(exp-1000,0);
  if(!Number.isFinite(after))return null;
  next[key+'_asc_points']=after;next[key+'_exp']=0;
  next[key+'_asc_mult']=Math.max(Math.sqrt(after/2000),1);multipliers[key]=next[key+'_asc_mult'];
  const current=member[key+'_asc_mult'];if(!Number.isFinite(current)||current<1)return null;
  result[key]=next[key+'_asc_mult']/current;
 }
 return {member:projectGangMember(next,null,0),respectLoss:member.earnedRespect,multipliers,result};
}

/** Whole-crew training forecast. Replan feasible tasks as skills and wanted change.
 * One shared baseline, bounded simulations and a rotating candidate order limit controller work.
 * Authorization uses fixed territory, purchases and crew size. A bounded expected-territory scenario ranks already-qualified power plans. Resource ETAs are estimates. */
export function forecastGangCrewTraining({members,gang,training,tasks,assignments={},fixedTasks={},evaluate,names=null,
 recoveryUntil={},recoveryTasks={},committedTraining=[],mixedTraining=false,repeatAscensions=false,trainingOptions=null,allowJointTraining=false,activeTraining=[],growthFirst=false,prioritizeWeakTraining=false,compareTrainingOnly=false,referenceTraining=[],developmentCycles=false,wantedPreparation=false,recruitmentSprint=false,equipmentDevelopment=null,horizonSeconds=900,windows=null,bonusSeconds=0,goals=[],otherCashRate=0,ascensions=null,waitWindows=[],ascensionEligible=null,warfare=null,
 maxPlanningMs=Infinity,maxSimulations=60,valuationOffset=0,now=Date.now,retainBaseline=false}={}){
 const started=now(),crewNames=Object.keys(members||{}),forecasts={},waitingForecasts={},waitChecks={};
 const diagnostics={model:'whole-crew',simulations:0,evaluations:0,timeLimited:false,simulationLimited:false,baselineReady:false};
 const candidates=(names||crewNames).filter(name=>crewNames.includes(name)&&!fixedTasks?.[name]);
 for(const name of candidates)forecasts[name]={train:false,window:0,reason:'No completed crew forecast'};
 let baselineTrajectory=null;
 let jointPlan=null,equipmentForecast=null,wantedPrepMember=null;const trainingAlternatives={},alternativeTrajectories=new Map(),selectedTrajectories=new Map(),preparationOnly=new Map();
 let cursor=Number.isFinite(valuationOffset)?Math.floor(valuationOffset):0;
 const compact=f=>{if(!f)return f;const {cumulative,total,power,powerReady,...rest}=f;return rest;};
 const result=()=>({... (retainBaseline?{baselineTrajectory}:{}),forecasts:Object.fromEntries(Object.entries(forecasts).map(([n,f])=>[n,compact(f)])),waitingForecasts:Object.fromEntries(Object.entries(waitingForecasts).map(([n,f])=>[n,compact(f)])),waitChecks,...(allowJointTraining?{jointPlan:compact(jointPlan)}:{}),...(compareTrainingOnly?{trainingAlternatives}:{}),...(equipmentDevelopment?{equipmentForecast}:{}),diagnostics:{...diagnostics,elapsedMs:Math.max(0,now()-started)},nextOffset:cursor});
 if(!fixedTasks||typeof fixedTasks!=='object'||Array.isArray(fixedTasks)||Object.entries(fixedTasks).some(([name,task])=>crewNames.includes(name)&&!tasks?.[task]))return result();
 if(!crewNames.length||crewNames.length>12||!training||!tasks?.[training.name]||typeof evaluate!=='function'||
  !Number.isFinite(horizonSeconds)||horizonSeconds<=(bonusSeconds>0?2:20)||
  ![gang?.respect,gang?.wantedLevel,otherCashRate].every(Number.isFinite)||gang.respect<1||gang.wantedLevel<1||otherCashRate<0)return result();
 if(!Array.isArray(committedTraining)||committedTraining.some(p=>!p)||!Array.isArray(referenceTraining)||referenceTraining.some(p=>!p)||equipmentDevelopment&&(!Array.isArray(equipmentDevelopment.training)||equipmentDevelopment.training.some(p=>!p)))return result();
 const powerEnabled=warfare?.active===true;
 diagnostics.warfare=powerEnabled?(warfare.rivals?.some(r=>r.samples>=3)?'Observed rival growth, fixed territory':'Observed rivals, fixed territory'):'Not constrained';
 diagnostics.rivalGrowth=powerEnabled?warfare.rivals||[]:[];
 if(powerEnabled&&(![warfare.power,warfare.rivalPower,warfare.threshold,warfare.territory,warfare.clashChance].every(Number.isFinite)||warfare.power<0||warfare.rivalPower<0||warfare.threshold<.5||warfare.threshold>1))return result();
 const duty=powerEnabled?warfare.duty:null,warfareTask=tasks['Territory Warfare'];
 if(duty&&(!warfareTask||![duty.normalFraction,duty.bonusFraction].every(f=>Number.isFinite(f)&&f>=0&&f<=1)))return result();
 diagnostics.warfareDuty=duty||null;
 const statKeys=['hack','str','def','dex','agi','cha'],blendedTasks=new Map();
 const projectionTask=(taskName,fraction)=>{
  const task=tasks[taskName];if(fraction===1)return task;if(fraction===0)return warfareTask;
  let variants=blendedTasks.get(taskName);if(!variants){variants=new Map();blendedTasks.set(taskName,variants);}
  if(!variants.has(fraction)){
   const work=Math.pow(Math.max(0,Number(task.difficulty)||0),.9),pulse=Math.pow(Math.max(0,Number(warfareTask.difficulty)||0),.9);
   variants.set(fraction,{difficulty:1,...Object.fromEntries(statKeys.map(k=>[k+'Weight',
    Math.max(0,Number(task[k+'Weight'])||0)*work*fraction+Math.max(0,Number(warfareTask[k+'Weight'])||0)*pulse*(1-fraction)]))});
  }
  return variants.get(fraction);
 };
 const rivalAt=seconds=>Math.max(...(warfare?.rivals?.length?warfare.rivals:[{power:warfare?.rivalPower??0,rate:0}]).map(r=>r.power+r.rate*seconds));
 const expired=()=>Number.isFinite(maxPlanningMs)&&now()-started>=Math.max(0,maxPlanningMs);
 const longer=growthFirst&&!ascensions&&windows===null?[600,900].filter(t=>t<=horizonSeconds/2):[];
 const timeline=gangDevelopmentTimeline(horizonSeconds,windows===null&&longer.length?[...gangDevelopmentTimeline(horizonSeconds,null,bonusSeconds).durations,...longer]:windows,bonusSeconds);
 const waits=[...new Set((Array.isArray(waitWindows)?waitWindows:[]).filter(seconds=>Number.isFinite(seconds)&&seconds>=20&&seconds<=120&&seconds<horizonSeconds))].sort((a,b)=>a-b);
 const choices=[...new Set((Array.isArray(trainingOptions)?trainingOptions.filter(t=>['Train Combat','Train Hacking','Train Charisma'].includes(t)):[training.name]).filter(t=>tasks[t]))];
 if(!choices.length)return result();diagnostics.trainingTasks=choices;
 const active=allowJointTraining&&Array.isArray(activeTraining)?activeTraining.filter(p=>candidates.includes(p.name)&&Number.isFinite(p.window)&&p.window>0&&p.window<=(growthFirst?900:300)&&choices.includes(p.trainingTask)):[];
 const durations=[...new Set([...timeline.durations,...active.map(p=>p.window)])].sort((a,b)=>a-b);
 const pairs=durations.flatMap(seconds=>candidates.flatMap(name=>[0,...(ascensions?.[name]&&projectFutureGangAscension(members[name],ascensions[name].member)?waits:[])].filter(wait=>wait+seconds<horizonSeconds).flatMap(wait=>choices.filter(task=>!active.some(p=>p.name===name)||active.some(p=>p.name===name&&p.window===seconds&&p.trainingTask===task)).flatMap(trainingTask=>[{name,seconds,wait,trainingTask,preTraining:false,preWanted:false,sequence:active.find(p=>p.name===name)?.trainingSchedule},...(developmentCycles&&wait>0?[{name,seconds,wait,trainingTask,preTraining:true,preWanted:false}]:[]),...(wantedPreparation&&wait>0&&tasks['Vigilante Justice']?[{name,seconds,wait,trainingTask,preTraining:false,preWanted:true}]:[])]))));
 if(mixedTraining&&choices.length>1)for(const seconds of durations)for(const name of candidates)if(!active.some(p=>p.name===name))pairs.push({name,seconds,wait:0,trainingTask:training.name,preTraining:false,preWanted:false,mixed:true});
 if(!pairs.length&&!equipmentDevelopment)return result();
 if(repeatAscensions&&ascensions)for(const pair of [...pairs])if(!pair.wait&&!pair.sequence){
  const repeatAt=Math.max(60,pair.seconds*2);
  if(repeatAt+pair.seconds<horizonSeconds&&projectFutureGangAscension(members[pair.name],ascensions[pair.name]?.member))pairs.push({...pair,repeatAt});
 }
 cursor=pairs.length?(cursor%pairs.length+pairs.length)%pairs.length:0;
 const times=[...new Set([...timeline.times,...pairs.flatMap(pair=>[pair.wait,pair.wait+pair.seconds,...(pair.mixed?[pair.seconds/3,pair.seconds*2/3]:[])]),...committedTraining.flatMap(p=>[p.window,...(p.trainingSchedule||[]).map(r=>r.until)]),...[...active,...referenceTraining,...(equipmentDevelopment?.training||[])].flatMap(p=>[p.window,...(p.trainingSchedule||[]).map(r=>r.until)]).filter(t=>Number.isFinite(t)&&t>0&&t<horizonSeconds),...pairs.filter(p=>p.repeatAt).flatMap(p=>[p.repeatAt,p.repeatAt+p.seconds,...(p.mixed?[p.repeatAt+p.seconds/3,p.repeatAt+p.seconds*2/3]:[])]),...Object.values(recoveryUntil).filter(t=>Number.isFinite(t)&&t>0&&t<horizonSeconds),
  ...[bonusSeconds/24].filter(t=>t>0&&t<horizonSeconds)])].filter(t=>Number.isFinite(t)&&t>=0&&t<=horizonSeconds).sort((a,b)=>a-b);
 const targets=goals.filter(g=>Number.isFinite(g.amount)&&g.amount>0&&['money','respect'].includes(g.resource));
 const groups=[...new Set(targets.map(goal=>goal.group||goal.name))].map(group=>targets.filter(g=>(g.group||g.name)===group).map(g=>g.name));
 const catalogue=Object.keys(tasks).filter(name=>!name.startsWith('Train ')&&name!=='Territory Warfare');
 if(!catalogue.includes(training.name))catalogue.push(training.name);
 const simulate=(name,delay,wait=0,trainingTask=training.name,batch=[],withoutReset=false,preTraining=false,purchase=null,preWanted=false,mixed=false,repeatAt=null,sequence=null,firstOnly=false)=>{
  if(expired()){diagnostics.timeLimited=true;return null;}
  if(preWanted&&!wantedPrepMember)return null;
  diagnostics.simulations++;
  const reset=!withoutReset&&name&&ascensions?.[name];let respectLoss=reset&&!wait?reset.respectLoss:0,applied=!reset||wait===0,projectedReset=reset;
  if(reset&&(!reset.member||!Number.isFinite(reset.respectLoss)||reset.respectLoss<0))return null;
  const committed=committedTraining.filter(p=>p.name!==name&&!batch.some(b=>b.name===p.name));
  const workBatch=[...committed,...batch],schedules={},phaseTasks={};
  let crew=Object.fromEntries(crewNames.map(n=>[n,reset&&applied&&n===name?projectGangMember(reset.member,null,0):purchase?.name===n?projectGangMember(members[n],null,0,purchase.stats):{...members[n]}]));
  let state={...gang,respect:Math.max(1,gang.respect-respectLoss)},assigned={...assignments},at=0,total=0;
  let respectDeducted=Math.min(respectLoss,gang.respect-1),futureRespectLoss=0,ascensionCount=reset&&applied?1:0,secondApplied=false;
  if(reset&&repeatAt){const first=projectFutureGangAscension(members[name],reset.member);if(!first)return null;crew[name]=first.member;}
  const goalAmount=goal=>goal.amount+(goal.gangRespect?respectDeducted:0);
  const memberTotals=Object.fromEntries(crewNames.map(n=>[n,0]));
  const earned={money:0,respect:0},eta={},cumulative=[];
  let power=powerEnabled?warfare.power:0,powerReady=powerEnabled&&gangWarfareReadyDelay(power,0,warfare)===0?0:null,lastPowerRate=0;
  let lastNormalRates={money:0,respect:0},lastBonusRates=lastNormalRates,warfareMemberGameSeconds=0;
  const experience=Object.fromEntries(statKeys.map(k=>[k,0]));
  const rate=(member,task,fraction=1)=>{
   diagnostics.evaluations++;
   const value=evaluate(member,state,task);
   return value&&[value.value,value.money,value.respect,value.wanted].every(Number.isFinite)&&value.value>=0&&value.money>=0&&value.respect>=0?
    {...value,value:value.value*fraction,money:value.money*fraction,respect:value.respect*fraction,wanted:value.wanted*fraction,rawMoney:value.money,rawRespect:value.respect,name:task,task}:null;
  };
  for(const end of times){
   if(end<=at)continue;
   if(expired()){diagnostics.timeLimited=true;return null;}
   if(reset&&!applied&&at>=wait){
    projectedReset=projectFutureGangAscension(crew[name],reset.member);if(!projectedReset)return null;
    if(typeof ascensionEligible==='function'&&!ascensionEligible(crew[name],state,projectedReset))return {ineligible:true};
    respectLoss=projectedReset.respectLoss;respectDeducted=Math.min(respectLoss,Math.max(0,state.respect-1));
    state.respect=Math.max(1,state.respect-respectLoss);crew[name]=projectedReset.member;applied=true;ascensionCount++;
   }
   if(reset&&repeatAt&&!secondApplied&&at>=repeatAt&&!firstOnly){
    const second=projectFutureGangAscension(crew[name],reset.member);if(!second)return null;
    if(typeof ascensionEligible==='function'&&!ascensionEligible(crew[name],state,second))return {ineligible:true};
    futureRespectLoss=second.respectLoss;respectDeducted+=Math.min(futureRespectLoss,Math.max(0,state.respect-1));
    state.respect=Math.max(1,state.respect-futureRespectLoss);crew[name]=second.member;secondApplied=true;ascensionCount++;
   }
   const secondTraining=repeatAt&&at>=repeatAt&&at<repeatAt+delay;
   const locks=crewNames.filter(n=>fixedTasks[n]||preWanted&&n===wantedPrepMember&&at<wait||n===name&&(preTraining&&at<wait||(at>=wait&&at<wait+delay||secondTraining))||workBatch.some(p=>p.name===n&&at<p.window)||at<(recoveryUntil[n]||0));
   const trainingFor=n=>{
    const plan=workBatch.find(p=>p.name===n&&at<p.window),isCandidate=n===name&&(at>=wait&&at<wait+delay||secondTraining);
    const source=plan||isCandidate&&{window:delay,trainingTask,mixedTraining:mixed,trainingSchedule:sequence};
    if(!source)return recoveryTasks[n]||training.name;
    const relative=plan?at:at-(secondTraining?repeatAt:wait);
    if(source.trainingSchedule?.length){schedules[n]=source.trainingSchedule;return source.trainingSchedule.find(r=>relative<r.until)?.task||source.trainingTask;}
    if(!source.mixedTraining)return source.trainingTask;
    const phase=Math.min(2,Math.floor(relative/(source.window/3))),key=n+':'+(plan?'batch':secondTraining?repeatAt:wait)+':'+phase;
    if(!phaseTasks[key])phaseTasks[key]=chooseGangStatTraining(crew[n],tasks,Math.min(30,gangGameSeconds(Math.max(.001,source.window/3),Math.max(0,bonusSeconds-at*24))),projectGangMember,source.trainingTask);
    const rows=secondTraining?[]:schedules[n]||[];if(!rows.some(r=>r.until===(phase+1)*source.window/3))rows.push({until:(phase+1)*source.window/3,task:phaseTasks[key]});if(!secondTraining)schedules[n]=rows;
    return phaseTasks[key];
   };
   const maxDefense=Math.max(...crewNames.map(n=>crew[n].def));
   const pulse=Object.fromEntries(locks.map(n=>{
    const taskName=fixedTasks[n]||trainingFor(n);
    return [n,warfare?.traineePulses===true&&!fixedTasks[n]&&!ascensions?.[n]&&!(at<(recoveryUntil[n]||0))&&!(preWanted&&n===wantedPrepMember&&at<wait)&&
     gangTraineePulse(crew[n],tasks[taskName],warfare,Math.max(0,horizonSeconds-at),Math.max(0,bonusSeconds-at*24),projectGangMember)];
   }));
   const powerLocks=locks.filter(n=>!pulse[n]);
   const fractions=Object.fromEntries(crewNames.map(n=>{
    const eligible=!!duty&&!powerLocks.includes(n)&&gangWarfareMemberEligible(crew[n],maxDefense,warfare.clashChance);
    return [n,eligible?[1-duty.normalFraction,1-duty.bonusFraction]:[1,1]];
   }));
   const fractionFor=(n,bonus)=>fractions[n][bonus?1:0];
   const fast=at<bonusSeconds/24;
   const rates={};
   for(const n of crewNames){
    const forced=fixedTasks[n]||(preWanted&&n===wantedPrepMember&&at<wait?'Vigilante Justice':n===name&&preTraining&&at<wait?trainingTask:trainingFor(n));
    const available=locks.includes(n)?[forced]:catalogue;
    const fraction=fractionFor(n,fast);rates[n]=available.map(task=>rate(crew[n],task,fraction));
    if(rates[n].some(r=>!r))return null;
    if(locks.includes(n))assigned[n]=forced;
   }
   const plan=planGangWantedCrew(rates,assigned,gangWantedTolerance(state)*5,'value',locks);
   if(!plan)return null;
   const seconds=gangGameSeconds(end,bonusSeconds)-gangGameSeconds(at,bonusSeconds);
   const next={},average={money:0,respect:0,wanted:0,value:0},normalRates={money:0,respect:0},bonusRates={money:0,respect:0};let justice=0;
   for(const n of crewNames){
    const before=plan.assignments[n],task=tasks[before.name],fraction=fractionFor(n,fast);assigned[n]=before.name;
    next[n]=projectGangMember(crew[n],projectionTask(before.name,fraction),seconds);
    if(!name){
     warfareMemberGameSeconds+=seconds*(1-fraction);
     for(const key of statKeys)experience[key]+=Math.max(0,(next[n][key+'_exp']||0)-(crew[n][key+'_exp']||0));
    }
    const after=rate(next[n],before.name,fraction);if(!after)return null;
    for(const key of ['money','respect','wanted','value'])average[key]+=(before[key]+after[key])/2;
    memberTotals[n]+=(before.value+after.value)*seconds/2;
    next[n].earnedRespect=(Number(crew[n].earnedRespect)||0)+(before.respect+after.respect)*seconds/2;
    if(task.baseWanted<0)justice+=fraction;
    // Keep separate terminal rates: bonus exhaustion changes both time speed and pulse duty.
    if(end===horizonSeconds)for(const key of ['money','respect']){
     const raw=key==='money'?(before.rawMoney+after.rawMoney)/2:(before.rawRespect+after.rawRespect)/2;
     normalRates[key]+=raw*fractionFor(n,false);bonusRates[key]+=raw*fractionFor(n,true);
    }
   }
   if(powerEnabled){
    const before=gangWarfarePowerPerTick(crew,warfare.territory,warfare.clashChance,powerLocks);
    const after=gangWarfarePowerPerTick(next,warfare.territory,warfare.clashChance,powerLocks);
    if(before===null||after===null)return null;
    lastPowerRate=(before+after)/40;
    const previousPower=power;power+=lastPowerRate*seconds;if(!Number.isFinite(power))return null;
    const crossing=gangWarfareReadyDelay(previousPower,lastPowerRate,warfare,gangGameSeconds(at,bonusSeconds));
    if(powerReady===null&&Number.isFinite(crossing)&&crossing<=seconds)
     powerReady=gangWallSeconds(gangGameSeconds(at,bonusSeconds)+crossing,bonusSeconds);
   }
   for(const resource of ['money','respect']){
    const produced=average[resource]*seconds+(resource==='money'?otherCashRate*(end-at):0);
    for(const goal of targets.filter(g=>g.resource===resource))if(eta[goal.name]===undefined&&produced>0&&earned[resource]+produced>=goalAmount(goal))
     eta[goal.name]=at+(end-at)*(goalAmount(goal)-earned[resource])/produced;
    earned[resource]+=produced;
   }
   state.respect+=average.respect*seconds;
   state.wantedLevel=projectGangWanted(state.wantedLevel,average.wanted,justice,seconds,at<bonusSeconds/24?5:2);
   state.respectGainRate=average.respect/5;
   if(!Number.isFinite(state.respect)||!Number.isFinite(state.wantedLevel))return null;
   total+=average.value*seconds;lastNormalRates=normalRates;lastBonusRates=bonusRates;at=end;crew=next;cumulative.push({at,total,power});
  }
  for(const goal of targets)if(eta[goal.name]===undefined){
   const remaining=goalAmount(goal)-earned[goal.resource],wallRate=goal.resource==='money'?otherCashRate:0;
   const fastTime=Math.max(0,bonusSeconds-horizonSeconds*24)/24,fastRate=lastBonusRates[goal.resource]*25+wallRate,normalRate=lastNormalRates[goal.resource]+wallRate;
   eta[goal.name]=fastRate>0&&remaining<=fastTime*fastRate?horizonSeconds+remaining/fastRate:
    normalRate>0?horizonSeconds+fastTime+Math.max(0,remaining-fastTime*fastRate)/normalRate:Infinity;
  }
  if(powerEnabled&&powerReady===null){
   const elapsed=gangGameSeconds(horizonSeconds,bonusSeconds),crossing=gangWarfareReadyDelay(power,lastPowerRate,warfare,elapsed);
   powerReady=Number.isFinite(crossing)?gangWallSeconds(elapsed+crossing,bonusSeconds):Infinity;
  }
  return {trainingSchedules:schedules,total,money:earned.money,respectEarned:earned.respect,memberTotals,eta,cumulative,power,powerReady,lastPowerRate,warfareMemberGameSeconds,experience,wantedLevel:state.wantedLevel,respect:state.respect,respectLoss,futureRespectLoss,ascensionCount,multipliers:projectedReset?.multipliers};
 };
 // Require a material crew-wide gain, scaled to the candidate's baseline production.
 const validBatch=batch=>Array.isArray(batch)&&new Set(batch.map(p=>p?.name)).size===batch.length&&batch.every(p=>p&&crewNames.includes(p.name)&&Number.isFinite(p.window)&&p.window>0&&p.window<=900&&choices.includes(p.trainingTask)&&(!p.trainingSchedule||gangTrainingScheduleTask({mixedTraining:true,startedAt:0,until:p.window*1000,trainingSchedule:p.trainingSchedule},0)!==null));
 if(!validBatch(committedTraining)||!validBatch(referenceTraining)||equipmentDevelopment&&(!crewNames.includes(equipmentDevelopment.name)||!validBatch(equipmentDevelopment.training)||!equipmentDevelopment.stats||Object.entries(equipmentDevelopment.stats).some(([k,m])=>!statKeys.includes(k)||!Number.isFinite(m)||m<1)))return result();
 const baseline=simulate(null,0,0,training.name,equipmentDevelopment?.training||[]);if(!baseline)return result();if(retainBaseline)baselineTrajectory=baseline;diagnostics.baselineReady=true;diagnostics.baselineWarfareMemberGameSeconds=baseline.warfareMemberGameSeconds;diagnostics.baselineExperience=baseline.experience;
 for(const name of candidates)forecasts[name]={train:false,window:0,baseline:baseline.total,production:baseline.total,gain:0,
  power:baseline.power,powerReady:baseline.powerReady,total:baseline.total,cumulative:baseline.cumulative,baselineMilestones:baseline.eta,baselineWanted:baseline.wantedLevel,baselinePower:powerEnabled?baseline.power:null,baselineWarfareReadySeconds:powerEnabled?baseline.powerReady:null,reason:'Continue productive work',model:'whole-crew'};
 const powerBenefit=(after,reference=baseline)=>gangPowerBenefit(after,reference,warfare,horizonSeconds);
 const powerBetter=(after,reference=baseline)=>powerBenefit(after,reference).powerObjective===true;
 const scenarioCache=new WeakMap();
 const scenario=after=>{if(!after||typeof after!=='object')return null;if(!scenarioCache.has(after))scenarioCache.set(after,gangTerritoryProjection(warfare,after.cumulative,bonusSeconds));return scenarioCache.get(after);};
 diagnostics.powerFocus=warfare?.powerFocus===true;diagnostics.territoryBaseline=warfare?.powerFocus?scenario(baseline):null;
 const safetyFor=(after,reference=baseline)=>{
  const goalsSafe=groups.every(names=>{const a=Math.max(...names.map(n=>reference.eta[n])),b=Math.max(...names.map(n=>after.eta[n]));return !Number.isFinite(a)||b<=a+2;});
  let warfareSafe=true,maxChanceDrop=0,readinessDelay=0;
  if(powerEnabled){
   const chance=(power,at)=>power>0?power/(power+rivalAt(gangGameSeconds(at,bonusSeconds))):0;
   for(let i=0;i<after.cumulative.length;i++){
    const beforeChance=chance(reference.cumulative[i].power,after.cumulative[i].at),afterChance=chance(after.cumulative[i].power,after.cumulative[i].at);
    if(beforeChance>=warfare.threshold-.05)maxChanceDrop=Math.max(maxChanceDrop,beforeChance-afterChance);
   }
   readinessDelay=Number.isFinite(reference.powerReady)?Math.max(0,after.powerReady-reference.powerReady):0;
   const allowedDelay=gangWallSeconds(20,Math.max(0,bonusSeconds-(Number.isFinite(reference.powerReady)?reference.powerReady:0)*24));
   warfareSafe=maxChanceDrop<=(warfare.maxChanceDrop??.01)&&
    (!Number.isFinite(reference.powerReady)||reference.powerReady>horizonSeconds||readinessDelay<=allowedDelay+1e-9);
  }
  const safe=goalsSafe&&warfareSafe;
  return {safe,goalsSafe,warfareSafe,maxChanceDrop,readinessDelay};
 };
 if(equipmentDevelopment){
  const after=simulate(null,0,0,training.name,equipmentDevelopment.training,false,false,equipmentDevelopment);
  if(after&&safetyFor(after).safe){
   const seconds=horizonSeconds;
   equipmentForecast={verified:true,...powerBenefit(after),baselinePower:baseline.power,projectedPower:after.power,baseline:baseline.total,production:after.total,moneyGain:(after.money-baseline.money)/seconds,respectGain:(after.respectEarned-baseline.respectEarned)/seconds,objectiveGain:(after.total-baseline.total)/seconds,horizonSeconds};
   if(equipmentDevelopment.compareFreeTraining){
    if(![equipmentDevelopment.cost,equipmentDevelopment.costWeight].every(Number.isFinite)||equipmentDevelopment.cost<0||equipmentDevelopment.costWeight<0){equipmentForecast=null;return result();}
    let best=baseline,bestWindow=0,bestKind="continued-development",bestTask=null,checks=0;
    const durations=equipmentDevelopment.trainingPermitted&&!fixedTasks[equipmentDevelopment.name]?(equipmentDevelopment.extendedWindows?[20,60,120,200,300]:[20,60,120]).filter(s=>s<horizonSeconds&&(s<=120||s<=horizonSeconds/2)):[];
    const hints=equipmentDevelopment.crimeGuidedWindows&&equipmentDevelopment.trainingPermitted&&!fixedTasks[equipmentDevelopment.name]?gangCrimeTrainingHints({member:members[equipmentDevelopment.name],tasks,gang,evaluate,project:projectGangMember,horizonSeconds,bonusSeconds}):[];
    const prefer=(task,windows,replace=true)=>{
     const hint=hints.find(h=>h.task===task);if(!hint)return windows;
     const rest=windows.filter(s=>s!==hint.duration);return [hint.duration,...rest].slice(0,replace?windows.length:windows.length+(windows.includes(hint.duration)?0:1));
    };
    const otherTasks=equipmentDevelopment.alternateTrainingTasks?choices.filter(name=>name!==training.name):[];
    const trainingTrials=[...prefer(training.name,durations).map(duration=>({duration,task:training.name})),
     ...(equipmentDevelopment.trainingPermitted&&!fixedTasks[equipmentDevelopment.name]?otherTasks.flatMap(task=>prefer(task,[60,120].filter(s=>s<horizonSeconds),true).map(duration=>({duration,task}))):[])];
    const rejectEarly=(free,kind,task,duration)=>{
     if(!equipmentDevelopment.earlyReject||!safetyFor(free).safe||!gangDevelopmentDominated(after,free,{cost:equipmentDevelopment.cost,costWeight:equipmentDevelopment.costWeight,powerEnabled}))return false;
     equipmentForecast={...equipmentForecast,comparison:{allowed:false,earlyRejected:true,checks,freeDevelopment:kind,freeTrainingTask:task,freeTrainingSeconds:duration,freeProduction:free.total,equipmentProduction:after.total,cashPenalty:equipmentDevelopment.cost*equipmentDevelopment.costWeight,netGain:after.total-equipmentDevelopment.cost*equipmentDevelopment.costWeight-free.total,reason:'Completed free development dominates this equipment bill',crimeHints:hints}};return true;
    };
    if(rejectEarly(baseline,'continued-development',null,0))return result();
    for(const {duration,task} of trainingTrials){
     if(expired()||diagnostics.simulations>=maxSimulations){diagnostics.alternativeIncomplete=true;equipmentForecast=null;return result();}
     const free=simulate(equipmentDevelopment.name,duration,0,task,equipmentDevelopment.training,true);
     if(!free){diagnostics.alternativeIncomplete=true;equipmentForecast=null;return result();}checks++;
     if(rejectEarly(free,'training',task,duration))return result();
     if(safetyFor(free).safe&&(free.total>best.total||powerBetter(free,best))){best=free;bestWindow=duration;bestKind="training";bestTask=task;}
    }
    const recoveryDurations=(equipmentDevelopment.extendedWindows?[60,120,200,300]:[60,120]).filter(s=>s<horizonSeconds&&(s<=120||s<=horizonSeconds/2));
    const recoveryTrials=ascensions?.[equipmentDevelopment.name]?[...recoveryDurations.map(duration=>({duration,task:training.name})),...otherTasks.flatMap(task=>120<horizonSeconds?[{duration:120,task}]:[])]:[];
    for(const {duration,task} of recoveryTrials){
     if(expired()||diagnostics.simulations>=maxSimulations){diagnostics.alternativeIncomplete=true;equipmentForecast=null;return result();}
     const free=simulate(equipmentDevelopment.name,duration,0,task,equipmentDevelopment.training.filter(p=>p.name!==equipmentDevelopment.name));
     if(!free){diagnostics.alternativeIncomplete=true;equipmentForecast=null;return result();}checks++;
     if(rejectEarly(free,'ascension-and-recovery',task,duration))return result();
     if(safetyFor(free).safe&&(free.total>best.total||powerBetter(free,best))){best=free;bestWindow=duration;bestKind="ascension-and-recovery";bestTask=task;}
    }
    const penalty=equipmentDevelopment.cost*equipmentDevelopment.costWeight,net=after.total-penalty-best.total;
    const margin=Math.max(1e-9,Math.abs(best.total)*.001),powerWins=powerBetter(after,best);
    const allowed=safetyFor(after,best).safe&&(net>margin||powerWins);
    equipmentForecast={...equipmentForecast,comparison:{allowed,checks,crimeHints:hints,freeDevelopment:bestKind,freeTrainingTask:bestTask,freeTrainingSeconds:bestWindow,freeProduction:best.total,equipmentProduction:after.total,cashPenalty:penalty,netGain:net,powerWins,reason:allowed?'Equipment improves the retained development plan':'Free development is preferable to this equipment bill'}};
   }
  }
  return result();
 }
 if(wantedPreparation&&tasks['Vigilante Justice'])wantedPrepMember=crewNames.filter(n=>!fixedTasks[n]&&!(recoveryUntil[n]>0)&&evaluate(members[n],gang,'Vigilante Justice')?.wanted<0)
  .sort((a,b)=>baseline.memberTotals[a]-baseline.memberTotals[b]||a.localeCompare(b))[0]||null;
 const reference=referenceTraining.length?simulate(null,0,0,training.name,referenceTraining):null;
 if(referenceTraining.length&&!reference){diagnostics.referenceIncomplete=true;return result();}
 diagnostics.trainingReference=reference?{production:reference.total,members:referenceTraining.length}:null;
 const sprintGoal=recruitmentSprint&&!ascensions?targets.find(g=>g.name==='recruit'&&g.resource==='respect'):null;
 const etaOf=x=>x?.eta?.[sprintGoal?.name]??x?.trainingMilestones?.[sprintGoal?.name]??Infinity;
 const sprintSaved=x=>sprintGoal&&etaOf(x)<=horizonSeconds?Math.max(0,etaOf(baseline)-etaOf(x)):0;
 const sprintBetter=x=>sprintGoal&&sprintSaved(x)>=Math.max(2,Number.isFinite(etaOf(baseline))?etaOf(baseline)*.02:2);
 const betterDevelopment=(a,b)=>{
  if(warfare?.powerPriority===true){
   const av=powerBetter(a),bv=powerBetter(b);
   if(av!==bv)return av;
   if(av&&bv){const ap=a.power??a.projectedPower,bp=b.power??b.projectedPower;if(Number.isFinite(ap)&&Number.isFinite(bp)&&Math.abs(ap-bp)>Math.max(.001,Math.max(0,bp-warfare.power)*.01))return ap>bp;}
  }
  if(powerBetter(a)&&powerBetter(b)){
   const ar=a.powerReady??a.warfareReadySeconds,br=b.powerReady??b.warfareReadySeconds;
   if(Number.isFinite(ar)&&Number.isFinite(br)&&Math.abs(ar-br)>2)return ar<br;
   const ap=scenario(a),bp=scenario(b);
   if(ap&&!ap.limited&&bp&&!bp.limited&&Math.abs(ap.power-bp.power)>Math.max(.001,bp.power*.01))return ap.power>bp.power;
  }
  if(powerBetter(a,b))return true;if(powerBetter(b,a))return false;
  if(sprintBetter(a)||sprintBetter(b)){
   if(sprintBetter(a)!==sprintBetter(b))return !!sprintBetter(a);
   if(Math.abs(etaOf(a)-etaOf(b))>2)return etaOf(a)<etaOf(b);
  }
  return (a?.total??a?.production??baseline.total)>(b?.total??b?.production??baseline.total);
 };
 const sprintData=after=>sprintGoal?{recruitmentSecondsSaved:Number.isFinite(sprintSaved(after))?sprintSaved(after):horizonSeconds,recruitmentETA:Number.isFinite(etaOf(after))?etaOf(after):null}:{};
 diagnostics.recruitmentSprint=!!sprintGoal;
 const developmentObjective=!!sprintGoal||warfare?.powerFocus===true;
 const rotated=[...pairs.slice(cursor),...pairs.slice(0,cursor)];
 // Give a low-contributing member a few completed comparisons before the rotating search.
 // This changes evaluation order only; crew payback, milestones and warfare still decide training.
 const weak=prioritizeWeakTraining&&!ascensions?candidates.filter(n=>Number.isFinite(baseline.memberTotals[n])&&baseline.memberTotals[n]>=0)
  .sort((a,b)=>baseline.memberTotals[a]-baseline.memberTotals[b]||a.localeCompare(b))[0]:null;
 const leader=Math.max(0,...Object.values(baseline.memberTotals).filter(Number.isFinite));
 const weakPairs=weak&&baseline.memberTotals[weak]<leader*.25?pairs.filter(p=>p.name===weak&&!p.wait&&!p.mixed&&!p.preTraining&&!p.preWanted&&p.trainingTask===training.name).slice(0,3):[];
 diagnostics.weakTrainingPriority=weakPairs.length?weak:null;
 const ordered=[...weakPairs,...rotated.filter(p=>!weakPairs.includes(p))];
 const limit=Math.min(120,Math.max(0,Number.isFinite(maxSimulations)?Math.floor(maxSimulations):60));
 const jointAllowed=allowJointTraining&&!ascensions&&crewNames.length>=3,candidateTrials=new Map();
 const activeGroup=active.length>=2&&(growthFirst||active.length===2);
 const jointReserve=growthFirst?Math.min(16,crewNames.length*2):6;
 let jointChecks=0;
 const considerJoint=batch=>{
  if(!jointAllowed||(growthFirst?(batch.length<2||batch.length>=crewNames.length):batch.length!==2)||new Set(batch.map(p=>p.name)).size!==batch.length||diagnostics.simulations-1>=limit||expired())return;
  const after=simulate(null,0,0,training.name,batch);jointChecks++;if(!after)return;
  const safety=safetyFor(after),gain=after.total-baseline.total;
  const margin=Math.max(1e-9,batch.reduce((v,p)=>v+baseline.memberTotals[p.name],0)*.05);
  if(!safety.safe||gain<=margin&&!sprintBetter(after)&&!powerBetter(after)||jointPlan&&(developmentObjective?!betterDevelopment(after,jointPlan):after.total<=jointPlan.production+(growthFirst?margin:0)))return;
  jointPlan={verified:true,...powerBenefit(after),territoryProjection:scenario(after),...sprintData(after),members:batch.map(p=>({...p,trainingSchedule:after.trainingSchedules[p.name]||p.trainingSchedule,trainingTask:after.trainingSchedules[p.name]?.[0]?.task||p.trainingTask})),gain,baseline:baseline.total,production:after.total,
   baselineMilestones:baseline.eta,trainingMilestones:after.eta,power:after.power,powerReady:after.powerReady,total:after.total,cumulative:after.cumulative,baselinePower:baseline.power,projectedPower:after.power,
   warfareReadinessDelay:safety.readinessDelay,maxWarfareChanceDrop:safety.maxChanceDrop};
 };
 if(activeGroup)considerJoint(active);
 for(const {name,seconds,wait,trainingTask,preTraining,preWanted,mixed,repeatAt,sequence} of ordered){
  if(jointAllowed&&!activeGroup&&(diagnostics.simulations-1>=Math.max(1,limit-jointReserve)||Number.isFinite(maxPlanningMs)&&now()-started>=maxPlanningMs*.65))break;
  if(diagnostics.simulations-1>=limit){diagnostics.simulationLimited=true;break;}
  if(expired()){diagnostics.timeLimited=true;break;}
  const after=simulate(name,seconds,wait,trainingTask,[],false,preTraining,null,preWanted,mixed,repeatAt,sequence);cursor=(pairs.findIndex(pair=>pair.name===name&&pair.seconds===seconds&&pair.wait===wait&&pair.trainingTask===trainingTask&&pair.preTraining===preTraining&&pair.preWanted===preWanted&&!!pair.mixed===!!mixed&&pair.repeatAt===repeatAt)+1)%pairs.length;
  if(!after)continue;
  const markWait=()=>{if(wait>0)waitChecks[name]=(waitChecks[name]||0)+1;};
  if(after.ineligible){markWait();continue;}
  if(!compareTrainingOnly)markWait();
  if(compareTrainingOnly&&ascensions?.[name]){
   const originalSafety=safetyFor(after);
   if(reference&&(after.total<=reference.total+Math.max(1e-9,baseline.memberTotals[name]*.05)&&!powerBetter(after,reference)||!safetyFor(after,reference).safe)){forecasts[name].trainingReferenceBlocked=true;markWait();continue;}
   if(!originalSafety.safe){
    markWait();
    if(!forecasts[name].train&&after.total-baseline.total>Math.max(1e-9,baseline.memberTotals[name]*.05)){
     forecasts[name].milestoneBlocked=!originalSafety.goalsSafe;forecasts[name].warfareBlocked=!originalSafety.warfareSafe;
     if(!originalSafety.warfareSafe)forecasts[name].rejectedWarfare={projectedPower:after.power,readinessDelay:originalSafety.readinessDelay,maxChanceDrop:originalSafety.maxChanceDrop};
    }
    continue;
   }
   if(diagnostics.simulations-1>=limit){diagnostics.simulationLimited=true;continue;}
   const alternative=simulate(name,seconds,wait,trainingTask,[],true,preTraining,null,preWanted,mixed,repeatAt,sequence);
   if(!alternative)continue;
   if(preWanted){
    let only=preparationOnly.get(wait);
    if(!only){
     if(diagnostics.simulations-1>=limit){diagnostics.simulationLimited=true;continue;}
     only=simulate(null,0,wait,trainingTask,[],true,false,null,true);if(!only)continue;preparationOnly.set(wait,only);
    }
    if(safetyFor(only).safe&&(!alternativeTrajectories.has(name)||only.total>alternativeTrajectories.get(name).total)){
     alternativeTrajectories.set(name,only);trainingAlternatives[name]={production:only.total,window:0,waitSeconds:wait,kind:'wanted reduction without ascension',milestones:only.eta};
    }
    if(after.total<=only.total+Math.max(1e-9,baseline.memberTotals[name]*.05)&&!powerBetter(after,only)||!safetyFor(after,only).safe){markWait();continue;}
   }
   markWait();
   if(safetyFor(alternative).safe&&(!alternativeTrajectories.has(name)||betterDevelopment(alternative,alternativeTrajectories.get(name)))){
    alternativeTrajectories.set(name,alternative);trainingAlternatives[name]={production:alternative.total,window:seconds,waitSeconds:wait,trainingTask,preTraining,milestones:alternative.eta};
   }
   // A completed matched comparison is required, even if training alone fails a baseline safeguard.
   if(after.total<=alternative.total+Math.max(1e-9,baseline.memberTotals[name]*.05)&&!powerBetter(after,alternative)||!safetyFor(after,alternative).safe){
    if(!forecasts[name].train){forecasts[name].trainingAlternativeBlocked=true;forecasts[name].reason='Training without ascension is preferable';}continue;
   }
  }
  if(repeatAt){
   // The first reset must beat doing only the first reset, as well as waiting
   // until the second reset. Nothing schedules the hypothetical second reset.
   if(diagnostics.simulations-1+2>limit){diagnostics.simulationLimited=true;continue;}
   const one=simulate(name,seconds,0,trainingTask,[],false,false,null,false,mixed,repeatAt,sequence,true);
   const later=simulate(name,seconds,repeatAt,trainingTask,[{name,window:seconds,trainingTask,mixedTraining:mixed}],false,false,null,false,mixed);
   if(!one||!later||one.ineligible||later.ineligible)continue;
   diagnostics.twoCycleComparisons=(diagnostics.twoCycleComparisons||0)+1;
   if([one,later].some(other=>!safetyFor(after,other).safe||after.total<=other.total+Math.max(1e-9,baseline.memberTotals[name]*.05)&&!powerBetter(after,other)))continue;
  }
  if(jointAllowed&&!wait&&(!candidateTrials.has(name)||(developmentObjective?betterDevelopment(after,candidateTrials.get(name)):after.total>candidateTrials.get(name).production)))candidateTrials.set(name,{name,window:seconds,mixedTraining:!!mixed||!!sequence,trainingSchedule:after.trainingSchedules[name],trainingTask:after.trainingSchedules[name]?.[0]?.task||trainingTask,production:after.total,total:after.total,power:after.power,powerReady:after.powerReady,cumulative:after.cumulative,trainingMilestones:after.eta});
  const destination=wait>0?waitingForecasts:forecasts;
  const before=destination[name]||{...forecasts[name],train:false,window:0,gain:0},gain=after.total-baseline.total;
  const {safe,goalsSafe,warfareSafe,maxChanceDrop,readinessDelay}=safetyFor(after);
  // Keep a scale-independent margin above simulation noise.
  const margin=Math.max(1e-9,baseline.memberTotals[name]*.05);
  if(!safe&&gain>margin&&!before.train){before.milestoneBlocked=!goalsSafe;before.warfareBlocked=!warfareSafe;if(!warfareSafe)before.rejectedWarfare={projectedPower:after.power,readinessDelay,maxChanceDrop};}
  if(safe&&(gain>margin||sprintBetter(after)||powerBetter(after))&&(developmentObjective?betterDevelopment(after,before):gain>before.gain)){
   const paid=after.cumulative.find((point,i)=>point.at>=wait+seconds&&point.total>baseline.cumulative[i].total);
   if(!paid&&!sprintBetter(after)&&!powerBetter(after))continue;
   selectedTrajectories.set((wait>0?'wait:':'now:')+name,after);
   destination[name]={...before,...powerBenefit(after),territoryProjection:scenario(after),...sprintData(after),train:true,trainingAlternativeBlocked:false,window:seconds,mixedTraining:!!mixed||!!sequence,trainingSchedule:after.trainingSchedules[name],waitSeconds:wait,trainingTask:after.trainingSchedules[name]?.[0]?.task||trainingTask,preTrainingSeconds:preTraining?wait:0,preWantedSeconds:preWanted?wait:0,preparationMember:preWanted?wantedPrepMember:null,respectLoss:after.respectLoss,ascensionCount:after.ascensionCount,futureRespectLoss:after.futureRespectLoss,secondAscensionSeconds:repeatAt??null,projectedMultipliers:after.multipliers,production:after.total,gain,milestoneBlocked:false,warfareBlocked:false,
    power:after.power,powerReady:after.powerReady,total:after.total,cumulative:after.cumulative,projectedPower:powerEnabled?after.power:null,warfareReadySeconds:powerEnabled?after.powerReady:null,warfareReadinessDelay:readinessDelay,maxWarfareChanceDrop:maxChanceDrop,
    trainingMilestones:after.eta,trainingWanted:after.wantedLevel,paybackSeconds:paid?.at??powerBenefit(after).powerPaybackSeconds??null,reason:powerBetter(after)?'Verified power payback advances warfare development':'Whole-crew development gains exceed continued work'};
  }
 }
 if(compareTrainingOnly){
  for(const [prefix,destination]of [['now:',forecasts],['wait:',waitingForecasts]])for(const [name,forecast]of Object.entries(destination)){
   const alternative=alternativeTrajectories.get(name),selected=selectedTrajectories.get(prefix+name);
   if(forecast.train&&alternative&&(forecast.production<=alternative.total+Math.max(1e-9,baseline.memberTotals[name]*.05)&&!powerBetter(selected,alternative)||!safetyFor(selected,alternative).safe)){
    forecast.train=false;forecast.reason='Training without ascension is preferable';forecast.trainingAlternativeBlocked=true;
   }
   if(forecast.train){
    const bestAlternative=[baseline,alternative,reference].filter(Boolean).sort((a,b)=>betterDevelopment(a,b)?-1:betterDevelopment(b,a)?1:0)[0];
    const paid=selected.cumulative.find((point,i)=>point.at>=forecast.waitSeconds+forecast.window&&point.total>bestAlternative.cumulative[i].total);
    if(!paid&&!powerBetter(selected,bestAlternative)){forecast.train=false;forecast.reason='No completed payback against training alone';continue;}
    forecast.opportunityBaseline=bestAlternative.total;forecast.incrementalGain=forecast.production-bestAlternative.total;forecast.incrementalPaybackSeconds=paid?.at??powerBenefit(selected,bestAlternative).powerPaybackSeconds;
   }
  }
  diagnostics.trainingComparisons=Object.keys(trainingAlternatives).length;
 }
 if(jointAllowed&&!activeGroup){
  const shortlist=[...candidateTrials.values()].sort((a,b)=>developmentObjective?(betterDevelopment(a,b)?-1:betterDevelopment(b,a)?1:0):b.production-a.production).slice(0,growthFirst?crewNames.length-1:4);
  if(growthFirst){
   const item=p=>({name:p.name,window:p.window,trainingTask:p.trainingTask,mixedTraining:p.mixedTraining,trainingSchedule:p.trainingSchedule});
   const ceiling=jointChecks+jointReserve;
   // Seed alternatives can retain a valuable producer that individual ranking would train.
   for(const [a,b]of [[0,1],[0,2],[1,2],[0,3]])if(shortlist[b]&&jointChecks<ceiling)considerJoint([shortlist[a],shortlist[b]].map(item));
   let fallback=shortlist.slice(0,2).map(item);
   for(const candidate of shortlist){
    if(jointChecks>=ceiling||expired())break;
    const root=jointPlan?.members||fallback;if(root.some(p=>p.name===candidate.name))continue;
    const batch=[...root,item(candidate)];if(batch.length>=crewNames.length)continue;
    considerJoint(batch);fallback=batch;
   }
   if(jointPlan)for(const candidate of shortlist){
    if(jointChecks>=ceiling||expired())break;
    if(jointPlan.members.some(p=>p.name===candidate.name))continue;
    for(let i=0;i<jointPlan.members.length&&jointChecks<ceiling;i++){
     const batch=jointPlan.members.map((p,j)=>j===i?item(candidate):p);considerJoint(batch);
    }
   }
  }else for(let i=0;i<shortlist.length;i++)for(let j=i+1;j<shortlist.length;j++)if(jointChecks<6){
   const batch=[shortlist[i],shortlist[j]].map(({name,window,trainingTask})=>({name,window,trainingTask}));considerJoint(batch);
  }
 }
 if(jointPlan){
  const singles=Object.values(forecasts).filter(f=>f.train),bestSingle=Math.max(baseline.total,...singles.map(f=>f.production));
  const margin=Math.max(1e-9,jointPlan.members.reduce((v,p)=>v+baseline.memberTotals[p.name],0)*.05);
  if(developmentObjective?singles.some(f=>!betterDevelopment(jointPlan,f)):jointPlan.production<=bestSingle+margin)jointPlan=null;
 }
 if(allowJointTraining){diagnostics.jointEvaluations=jointChecks;diagnostics.jointCandidates=candidateTrials.size;if(growthFirst){diagnostics.trainingPolicy='growth-first';diagnostics.selectedGroupSize=jointPlan?.members.length||0;diagnostics.maxTrainingSeconds=900;}}

 return result();
}

/** Ascensions share the bounded crew simulator, including task replanning and joint purchase timing. */
export function forecastGangCrewAscensions(options){
 const result=forecastGangCrewTraining({...options,compareTrainingOnly:true}),plans=[],deferred=[];
 for(const [name,forecast]of Object.entries(result.forecasts))if(options.ascensions?.[name]){
  const waiting=result.waitingForecasts[name],canCompare=Array.isArray(options.waitWindows)&&options.waitWindows.some(t=>Number.isFinite(t)&&t>=20&&t<=120&&
    gangDevelopmentTimeline(options.horizonSeconds??900,options.windows,options.bonusSeconds).durations.some(seconds=>t+seconds<(options.horizonSeconds??900)))&&
   projectFutureGangAscension(options.members[name],options.ascensions[name].member);
  if(canCompare&&!result.waitChecks[name]){deferred.push({name,reason:'Wait comparison incomplete'});continue;}
  // A material advantage is required to defer an otherwise worthwhile immediate reset.
  if(waiting?.train&&(!forecast.train||(waiting.powerObjective||forecast.powerObjective?(waiting.powerSecondsSaved||0)>(forecast.powerSecondsSaved||0)+2||(waiting.powerGain||0)>(forecast.powerGain||0)*1.05&&(waiting.powerSecondsSaved||0)>=(forecast.powerSecondsSaved||0):waiting.gain>forecast.gain*1.05))){
   deferred.push({name,reason:waiting.preWantedSeconds?'Wanted reduction before ascension produces more crew value':waiting.preTrainingSeconds?'Training before ascension produces more crew value':'Working before ascension produces more crew value',preWantedSeconds:waiting.preWantedSeconds||0,preparationMember:waiting.preparationMember,preTrainingSeconds:waiting.preTrainingSeconds||0,production:waiting.production,baseline:waiting.baseline,waitSeconds:waiting.waitSeconds,trainingSeconds:waiting.window,trainingTask:waiting.trainingTask,
    immediateGain:forecast.gain,waitingGain:waiting.gain,paybackSeconds:waiting.paybackSeconds,
    projectedMultipliers:waiting.projectedMultipliers,respectLoss:waiting.respectLoss,ascensionMilestones:waiting.trainingMilestones});continue;
  }
  if(!forecast.train)continue;
  const {baselineMilestones,trainingMilestones}=forecast;
  plans.push({name,mixedTraining:forecast.mixedTraining,trainingSchedule:forecast.trainingSchedule,ascensionCount:forecast.ascensionCount,futureRespectLoss:forecast.futureRespectLoss,secondAscensionSeconds:forecast.secondAscensionSeconds,trainingTask:forecast.trainingTask,trainingSeconds:forecast.window,paybackSeconds:forecast.incrementalPaybackSeconds??forecast.paybackSeconds,horizonSeconds:options.horizonSeconds??900,
   netGain:forecast.incrementalGain??forecast.gain,baseline:forecast.baseline,opportunityBaseline:forecast.opportunityBaseline,production:forecast.production,baselineMilestones,ascensionMilestones:trainingMilestones,
   baselineWanted:forecast.baselineWanted,ascensionWanted:forecast.trainingWanted,powerPriority:forecast.powerPriority,powerObjective:forecast.powerObjective,powerSecondsSaved:forecast.powerSecondsSaved,powerGain:forecast.powerGain,powerPaybackSeconds:forecast.powerPaybackSeconds,territoryProjection:forecast.territoryProjection,baselinePower:forecast.baselinePower,projectedPower:forecast.projectedPower,
   warfareReadySeconds:forecast.warfareReadySeconds,warfareReadinessDelay:forecast.warfareReadinessDelay,maxWarfareChanceDrop:forecast.maxWarfareChanceDrop});
 }
 plans.sort((a,b)=>Number(b.powerObjective===true)-Number(a.powerObjective===true)||(a.powerPriority&&b.powerPriority?(b.powerGain||0)-(a.powerGain||0):0)||(b.powerSecondsSaved||0)-(a.powerSecondsSaved||0)||a.paybackSeconds-b.paybackSeconds||b.netGain-a.netGain||a.name.localeCompare(b.name));
 return {...result,plans,deferred};
}

export function restoreGangWantedPreparation(saved,reset,names,lastReset={},now=Date.now()){
 const p=saved?.wantedPreparation;
 if(!Number.isFinite(now)||saved?.nodeReset!==reset.lastNodeReset||saved?.augReset!==reset.lastAugReset||!p||p.task!=='Vigilante Justice'||!names.includes(p.member)||!names.includes(p.target))return null;
 if(![p.resetAt,p.startedAt,p.until].every(Number.isFinite)||p.resetAt<0||p.resetAt>p.startedAt||p.resetAt!==(lastReset[p.member]??0)||p.startedAt>now||p.startedAt<0||p.until<=now||p.until-p.startedAt<=0||p.until-p.startedAt>120000)return null;
 return {...p};
}

/** Balanced mode serializes recovery; power mode relies on the committed crew forecast. */
export function gangAscensionAvailability({name,members,values,lastReset={},episodes={},recoveries={},now=Date.now(),maximumMs=200000,allowConcurrent=false}){
 for(const [other,member]of Object.entries(members)){
  if(allowConcurrent&&other===name&&(now-(lastReset[name]??0)<2000||recoveries[name]?.until>now))return {allowed:false,reason:'Candidate recovery in progress'};
  if(allowConcurrent)continue;
  if(recoveries[other]?.until>now&&recoveries[other].resetAt===lastReset[other])return {allowed:false,reason:'Ascension recovery in progress',member:other};
  if(episodes[other]?.until>now)return {allowed:false,reason:'Training burst in progress',member:other};
  const elapsed=now-(lastReset[other]??0);
  if(other!==name&&elapsed>=0&&elapsed<maximumMs&&(elapsed<2000||member.task?.startsWith('Train ')&&!(values[other]?.value>0)))
   return {allowed:false,reason:'Another member is recovering',member:other};
 }
 const otherProductive=Object.entries(values).some(([other,value])=>other!==name&&value.value>0&&(!allowConcurrent||!members[other]?.task?.startsWith('Train ')&&!(episodes[other]?.until>now)&&!(recoveries[other]?.until>now))&&
  !(members[other]?.task?.startsWith('Train ')&&now-(lastReset[other]??0)<2000));
 return otherProductive?{allowed:true}:{allowed:false,reason:'Preserve the remaining productive member'};
}

/** Preserve training deadlines across controller reloads, scoped to this augmentation and node. */
export function restoreGangTrainingBursts(saved,reset,names,now=Date.now()) {
 if(!saved||saved.nodeReset!==reset.lastNodeReset||saved.augReset!==reset.lastAugReset)return {};
 return Object.fromEntries(names.filter(name=>{
  const e=saved.episodes?.[name];
  return e&&(!e.task||['Train Combat','Train Hacking','Train Charisma'].includes(e.task))&&[e.resetAt,e.startedAt,e.until,e.workUntil].every(Number.isFinite)&&e.resetAt>=0&&e.resetAt<=now&&
   e.startedAt<=now&&e.until>e.startedAt&&e.until-e.startedAt<=(e.growthFirst===true?900000:300000)&&e.workUntil>=e.until&&e.workUntil>now&&e.workUntil<=now+(e.growthFirst===true?900000:600000);
 }).map(name=>[name,{...saved.episodes[name]}]));
}

/** One optional trainee, or a jointly verified pair; completed bursts must return to work before retraining.
 * Recovery training is exempt so newly recruited/ascended members can regain useful skills. */
export function planGangTrainingBursts(rows,previous={},now=Date.now(),jointPlan=null,policy={}) {
 if(policy.growthFirst===true)return planGangGrowthTraining(rows,previous,now,jointPlan);
 const episodes={},plans={},reasons={};
 const productive=rows.filter(row=>!row.mandatory&&row.value>0).length;
 for(const row of rows){
  const old=previous[row.name];
  if(old&&old.resetAt===row.resetAt&&Number.isFinite(old.until)&&Number.isFinite(old.workUntil))episodes[row.name]={...old};
  plans[row.name]=!!row.mandatory;
  reasons[row.name]=row.mandatory?'Recovery training':'Continue productive work';
 }
 const pair=jointPlan?.verified===true&&Number.isFinite(jointPlan.gain)&&jointPlan.gain>0&&Array.isArray(jointPlan.members)&&jointPlan.members.length===2?jointPlan.members:null;
 const running=rows.filter(row=>episodes[row.name]?.until>now&&!row.mandatory);
 const validPair=pair&&new Set(pair.map(p=>p.name)).size===2&&pair.every(p=>{
  const row=rows.find(r=>r.name===p.name),old=episodes[p.name];
  return row&&Number.isFinite(row.resetAt)&&row.resetAt>=0&&!row.mandatory&&row.permitted&&!row.urgent&&Number.isFinite(p.window)&&p.window>0&&p.window<=300&&
   ['Train Combat','Train Hacking','Train Charisma'].includes(p.trainingTask)&&(!old||old.workUntil<=now||old.jointId&&old.until>now&&old.task===p.trainingTask&&old.until-now<=p.window*1000+1);
 })&&productive-pair.filter(p=>rows.find(r=>r.name===p.name)?.value>0).length>=1&&
  running.every(row=>pair.some(p=>p.name===row.name)&&episodes[row.name].jointId)&&new Set(running.map(row=>episodes[row.name].jointId)).size<=1;
 if(validPair){
  const jointId=running.length?episodes[running[0].name].jointId:pair.map(p=>p.name).sort().join('|')+':'+now;
  for(const p of pair){const row=rows.find(r=>r.name===p.name),old=episodes[p.name];
   if(!old||old.until<=now)episodes[p.name]={resetAt:row.resetAt,startedAt:now,until:now+p.window*1000,workUntil:now+p.window*2000,task:p.trainingTask,jointId};
   plans[p.name]=true;reasons[p.name]='Joint forecast improves crew production';
  }
  return {plans,episodes,reasons};
 }
 if(running.length>1&&running.some(row=>episodes[row.name].jointId))for(const row of running){episodes[row.name].until=now;reasons[row.name]='Joint training no longer verified';}
 let occupied=false;
 for(const row of rows){
  const old=episodes[row.name];
  if(!old||old.until<=now)continue;
  if(row.mandatory||!row.permitted||row.urgent||row.forecast?.milestoneBlocked||row.forecast?.warfareBlocked||occupied||row.value>0&&productive<2){
   old.until=now;reasons[row.name]='Return to productive work';continue;
  }
  plans[row.name]=true;occupied=true;reasons[row.name]='Finish bounded training burst';
 }
 const ranked=rows.filter(row=>!plans[row.name]&&row.permitted&&!row.urgent&&row.forecast?.train&&
   Number.isFinite(row.forecast.window)&&row.forecast.window>0&&
   (!episodes[row.name]||episodes[row.name].workUntil<=now)&&!(row.value>0&&productive<2))
  .sort((a,b)=>b.forecast.gain/Math.max(1,b.forecast.window)-a.forecast.gain/Math.max(1,a.forecast.window)||a.name.localeCompare(b.name));
 if(!occupied&&ranked.length){
  const row=ranked[0],duration=row.forecast.window*1000;
  episodes[row.name]={resetAt:row.resetAt,startedAt:now,until:now+duration,workUntil:now+duration*2,...(row.forecast.trainingTask?{task:row.forecast.trainingTask}:{})};
  plans[row.name]=true;reasons[row.name]='Start bounded training burst';
 }
 for(const row of rows)if(!plans[row.name]){
  if(row.forecast?.warfareBlocked)reasons[row.name]='Preserve warfare readiness';
  else if(row.forecast?.milestoneBlocked)reasons[row.name]='Preserve recruitment or augmentation timing';
  else if(episodes[row.name]?.workUntil>now)reasons[row.name]='Productive interval after training';
  else if(row.forecast?.train)reasons[row.name]='Preserve crew production';
 }
 return {plans,episodes,reasons};
}

/** Fresh crew forecasts replace the fixed work cooldown; unchanged active deadlines remain bounded. */
export function planGangGrowthTraining(rows,previous={},now=Date.now(),jointPlan=null){
 const episodes={},plans={},reasons={};
 for(const row of rows){
  const old=previous[row.name];
  if(old&&old.resetAt===row.resetAt&&[old.until,old.workUntil].every(Number.isFinite))episodes[row.name]={...old};
  plans[row.name]=!!row.mandatory;reasons[row.name]=row.mandatory?'Recovery training':'Continue productive work';
 }
 const permitted=p=>{const row=rows.find(r=>r.name===p.name);return row&&!row.mandatory&&row.permitted&&!row.urgent&&Number.isFinite(row.resetAt)&&row.resetAt>=0&&Number.isFinite(p.window)&&p.window>0&&p.window<=900&&['Train Combat','Train Hacking','Train Charisma'].includes(p.trainingTask);};
 const running=rows.filter(row=>!row.mandatory&&episodes[row.name]?.until>now);
 const proposed=jointPlan?.verified===true&&Number.isFinite(jointPlan.gain)&&(jointPlan.gain>0||Number.isFinite(jointPlan.recruitmentSecondsSaved)&&jointPlan.recruitmentSecondsSaved>0||jointPlan.powerObjective===true&&jointPlan.powerPaybackSeconds>0)&&Array.isArray(jointPlan.members)?jointPlan.members:null;
 const group=proposed&&proposed.length>=2&&proposed.length<rows.length&&new Set(proposed.map(p=>p.name)).size===proposed.length&&proposed.every(permitted)&&
  rows.some(row=>!row.mandatory&&row.value>0&&!proposed.some(p=>p.name===row.name))&&
  running.every(row=>proposed.some(p=>p.name===row.name))&&proposed.every(p=>{
   const old=episodes[p.name];return !old||old.until<=now||old.task===p.trainingTask&&old.until-now<=p.window*1000+1;
  })?proposed:null;
 const assign=(p,jointId)=>{
  const row=rows.find(r=>r.name===p.name),old=episodes[p.name];
  if(!old||old.until<=now)episodes[p.name]={resetAt:row.resetAt,startedAt:now,until:now+p.window*1000,workUntil:now+p.window*1000,task:p.trainingTask,growthFirst:true,...(p.mixedTraining?{mixedTraining:true,trainingSchedule:p.trainingSchedule}:{}),...(jointId?{jointId}:{})};
  plans[p.name]=true;reasons[p.name]=jointId?'Verified group growth training':'Verified growth training';
 };
 if(group){
  const jointId=running.length?episodes[running[0].name].jointId||group.map(p=>p.name).sort().join('|')+':'+now:group.map(p=>p.name).sort().join('|')+':'+now;
  for(const p of group)assign(p,jointId);
  return {plans,episodes,reasons};
 }
 // A failed or incomplete group forecast releases all optional members before choosing a safe single.
 for(const row of running){episodes[row.name].until=now;episodes[row.name].workUntil=now;}
 const ranked=rows.filter(row=>!row.mandatory&&row.forecast?.train&&Number.isFinite(row.forecast.gain)&&(row.forecast.gain>0||Number.isFinite(row.forecast.recruitmentSecondsSaved)&&row.forecast.recruitmentSecondsSaved>0||row.forecast.powerObjective===true&&row.forecast.powerPaybackSeconds>0)&&!row.forecast.milestoneBlocked&&!row.forecast.warfareBlocked&&
  permitted({name:row.name,window:row.forecast.window,trainingTask:row.forecast.trainingTask})&&rows.some(other=>other.name!==row.name&&!other.mandatory&&other.value>0))
  .sort((a,b)=>Number(b.forecast.powerObjective===true)-Number(a.forecast.powerObjective===true)||(a.forecast.powerPriority&&b.forecast.powerPriority?(b.forecast.powerGain||0)-(a.forecast.powerGain||0):0)||(a.forecast.powerObjective&&b.forecast.powerObjective?(a.forecast.warfareReadySeconds??Infinity)-(b.forecast.warfareReadySeconds??Infinity):0)||(a.forecast.recruitmentETA??Infinity)-(b.forecast.recruitmentETA??Infinity)||b.forecast.gain/Math.max(1,b.forecast.window)-a.forecast.gain/Math.max(1,a.forecast.window)||a.name.localeCompare(b.name));
 if(ranked.length){
  const row=ranked[0],old=previous[row.name];
  if(old&&old.resetAt===row.resetAt&&old.until>now&&old.task===row.forecast.trainingTask&&old.until-now<=row.forecast.window*1000+1)episodes[row.name]={...old};
  assign({name:row.name,window:row.forecast.window,trainingTask:row.forecast.trainingTask,mixedTraining:row.forecast.mixedTraining,trainingSchedule:row.forecast.trainingSchedule});
 }
 for(const row of rows)if(!plans[row.name]){
  if(row.forecast?.warfareBlocked)reasons[row.name]='Preserve warfare readiness';
  else if(row.forecast?.milestoneBlocked)reasons[row.name]='Preserve recruitment or augmentation timing';
 }
 return {plans,episodes,reasons};
}

/** Distinguish protected-work deferrals and already-applied assignments from native rejection. */
export function applyGangWorkOrders(ns,orders,allowed,owner) {
 const failed=[];let assigned=0;
 for(const order of orders){
  if(!allowed(ns,owner))return {deferred:true,assigned,failed};
  if(order.trainingPulse){const gang=ns.gang.getGangInformation();if(gang.territoryWarfareEngaged||gang.territoryClashChance!==0)return {deferred:true,assigned,failed};}
  if(ns.gang.getMemberInformation(order.name).task===order.task){assigned++;continue;}
  if(ns.gang.setMemberTask(order.name,order.task)||ns.gang.getMemberInformation(order.name).task===order.task)assigned++;
  else failed.push(order);
 }
 return {deferred:false,assigned,failed};
}

/** Allocate a whole batch; the recruitment exception has one shared cap, not a cap per item. */
export function allocateGangEquipment(ranked,{available,equipmentLimit,augLimit,bootstrapBudget}) {
 const orders=[];let temporary=0,permanent=0,recruitment=0;
 for(const order of ranked){
  if(!Number.isFinite(order.cost)||order.cost<=0||order.cost>available)continue;
  if(order.reason!=='production'&&order.reason!=='cheap'&&recruitment+order.cost>bootstrapBudget)continue;
  if(order.type==='Augmentation'?permanent+order.cost>augLimit:temporary+order.cost>equipmentLimit)continue;
  orders.push(order);available-=order.cost;
  if(order.reason!=='production'&&order.reason!=='cheap')recruitment+=order.cost;
  if(order.type==='Augmentation')permanent+=order.cost;else temporary+=order.cost;
 }
 return orders;
}

/** Rival changes confirm the native territory clock even if player power is flat. */
export function gangTerritorySample(previous,gangs,faction,at,bonusMs=0){
 const rows=Object.entries(gangs||{}).sort(([a],[b])=>a.localeCompare(b));
 if(!Number.isFinite(at)||!rows.length||rows.some(([,g])=>!Number.isFinite(g?.power)||g.power<0||!Number.isFinite(g?.territory)||g.territory<0||g.territory>1))
  return {...(previous||{}),changed:false};
 const signature=JSON.stringify(rows.map(([n,g])=>[n,g.power,g.territory]));
 const same=previous?.faction===faction&&Number.isFinite(previous.at)&&previous.at<at;
 const changed=!!(same&&previous.signature!==signature);
 const fresh=same&&at-previous.at<=30000;
 let tickAt=fresh?previous.tickAt:undefined,tickBonusMs=fresh?previous.tickBonusMs:undefined;
 let powerHistory=fresh?Object.fromEntries(Object.entries(previous.powerHistory||{}).map(([name,values])=>[name,[...values]])):{};
 if(changed){
  // Polling must not count identical snapshots as zero-growth ticks. Discard missed/partial ticks.
  const expected=gangTerritoryDeadline(tickAt,tickBonusMs)-tickAt,elapsed=at-tickAt;
  const valid=Number.isFinite(expected)&&elapsed>=expected*.5&&elapsed<=expected*1.5;
  if(!valid)powerHistory={};
  for(const [name,g]of rows){
   if(name===faction)continue;
   const before=previous?.gangs?.[name];
   if(valid&&before&&before.territory>0&&g.territory>0&&Math.abs(before.territory-g.territory)<=.001){
    const delta=g.power-before.power;
    // Clash losses invalidate a growth sample; never extrapolate them as perpetual decay.
    if(delta>=0)powerHistory[name]=[...(powerHistory[name]||[]),delta].slice(-8);
    else powerHistory[name]=[];
   }else powerHistory[name]=[];
  }
  tickAt=at;tickBonusMs=bonusMs;
 }
 return {signature,faction,at,gangs:Object.fromEntries(rows.map(([name,g])=>[name,{power:g.power,territory:g.territory}])),changed,tickAt,tickBonusMs,powerHistory};
}
export function gangTerritoryDeadline(at,bonusMs=0,periodMs=20000){
 if(!Number.isFinite(at)||!Number.isFinite(periodMs)||periodMs<=0)return null;
 const bonus=Number.isFinite(bonusMs)?Math.max(0,bonusMs/1000-2):0;
 return at+gangWallSeconds(periodMs/1000,bonus)*1000;
}

/** An unknown territory phase must never reuse a stale deadline. */
export function gangTerritoryTiming({detected,nextTick,now,ready,finished,padding=200,interval=200}) {
 const known=Number.isFinite(nextTick)&&nextTick>0;
 return {prepare:!!(detected&&known&&!ready&&!finished&&now+interval+padding>=nextTick),
  overdue:!!(detected&&known&&ready&&now>nextTick+5000),
  management:!!(finished&&known&&now>=nextTick)};
}

/** Revalue after each choice; rank bounded same-category bundles alongside singles. */
export function gangEquipmentCandidateKey(candidate){
 return JSON.stringify([candidate.member,(candidate.items?.map(e=>e.name)||[candidate.equipmentName]).slice().sort()]);
}
/** Rotate only material slots; preserve cheap candidates and recompute every forecast. */
export function rotateGangMaterialCandidates(candidates,cursor,cash){
 if(!Number.isFinite(cash)||cash<=0)return candidates;
 const seen=new Set(),unique=candidates.filter(c=>{
  if(!(c.cost>cash*.01))return true;const key=gangEquipmentCandidateKey(c);if(seen.has(key))return false;seen.add(key);return true;
 });
 const material=unique.filter(c=>c.cost>cash*.01).slice().sort((a,b)=>gangEquipmentCandidateKey(a).localeCompare(gangEquipmentCandidateKey(b)));
 if(!material.length)return candidates;
 let offset=typeof cursor==='string'?material.findIndex(c=>gangEquipmentCandidateKey(c).localeCompare(cursor)>0):0;if(offset<0)offset=0;
 const ordered=[...material.slice(offset),...material.slice(0,offset)];let i=0;
 return unique.map(c=>c.cost>cash*.01?ordered[i++]:c);
}

export function planMarginalGangEquipment({members,equipment,evaluate,horizon=900,recruitment={},budgets,maxPurchases=8,crewAware=false,maxPlanningMs=crewAware?100:Infinity,now=Date.now,purchaseGuard=null,maxPurchaseChecks=8,maxBundleEvaluations=128,valuationOffset=0,valuationItems={},cheapCash=null,cheapEligibility=null,equipmentLifetime=null,powerFocus=false,purchaseCursor=null,materialCash=null}) {
 const started=now(),expired=()=>Number.isFinite(maxPlanningMs)&&now()-started>=Math.max(0,maxPlanningMs);
 const evaluationExpired=()=>expired()||typeof purchaseGuard==='function'&&Number.isFinite(maxPlanningMs)&&now()-started>=maxPlanningMs*.65;
 const bundleLimit=Math.min(1024,Math.max(0,Number.isFinite(maxBundleEvaluations)?Math.floor(maxBundleEvaluations):0));
 const bundleExpired=()=>expired()||typeof purchaseGuard==='function'&&Number.isFinite(maxPlanningMs)&&now()-started>=maxPlanningMs*.85;
 const crew=Object.fromEntries(Object.entries(members).map(([name,m])=>[name,{...m,upgrades:[...m.upgrades],augmentations:[...m.augmentations]}]));
 const remaining={...budgets},orders=[],limit=Math.min(32,Math.max(0,Math.floor(maxPurchases)));
 let respectRate=recruitment.respectRate||0,firstOpportunity=null;
 const diagnostics={phase:'before-purchases',evaluations:0,returnForecasts:0,cheapFastTracked:0,cheapEligibilityRejected:0,deferredForecasts:0,evaluationsByMember:{},valuationPasses:0,skippedEvaluations:0,timeLimited:false,maxPlanningMs:Number.isFinite(maxPlanningMs)?maxPlanningMs:null,missing:0,owned:0,ineligible:0,qualified:0,budgetBlocked:0,cheapQualified:0,cheapPlanned:0,bundleEvaluations:0,bundleEvaluationsByMember:{},bundleQualified:0,bundleSearchLimited:false,purchaseChecks:0,purchaseBlocked:0,purchaseReadiness:[],rejected:[],budgets:{...budgets}};
 let nextPurchaseCursor=typeof purchaseCursor==='string'?purchaseCursor:null;
 const crewNames=Object.keys(crew);
 let valuationCursor=crewNames.length&&Number.isFinite(valuationOffset)?((Math.floor(valuationOffset)%crewNames.length)+crewNames.length)%crewNames.length:0;
 // Cursor names survive changes in catalogue order and ownership; only positions
 // are reused. Every returned value is recomputed from the current projected crew.
 const savedItems=valuationItems&&typeof valuationItems==='object'&&!Array.isArray(valuationItems)?valuationItems:{};
 const itemCursors=new Map(crewNames.map(name=>[name,typeof savedItems[name]==='string'&&equipment.some(e=>e.name===savedItems[name])?savedItems[name]:equipment[0]?.name??null]));
 const collectCandidates=names=>{
  diagnostics.valuationPasses++;
  const requested=new Set(names),rotation=[...crewNames.slice(valuationCursor),...crewNames.slice(0,valuationCursor)].filter(n=>requested.has(n));
  const queues=rotation.map(name=>{
   const start=Math.max(0,equipment.findIndex(e=>e.name===itemCursors.get(name)));
   const ordered=[...equipment.slice(start),...equipment.slice(0,start)];
   return {name,next:0,items:ordered.filter(e=>!crew[name].upgrades.includes(e.name)&&!crew[name].augmentations.includes(e.name))};
  });
  let pending=queues.reduce((sum,q)=>sum+q.items.length,0);const result=[];
  while(pending>0)for(const queue of queues){
   if(queue.next>=queue.items.length)continue;
   if(evaluationExpired()){diagnostics.skippedEvaluations+=pending;diagnostics.timeLimited=true;return result;}
   const name=queue.name,e=queue.items[queue.next++];pending--;
   diagnostics.evaluations++;diagnostics.evaluationsByMember[name]=(diagnostics.evaluationsByMember[name]||0)+1;
   valuationCursor=(crewNames.indexOf(name)+1)%crewNames.length;
   itemCursors.set(name,equipment[(equipment.indexOf(e)+1)%equipment.length]?.name??null);
   const cash=Number.isFinite(cheapCash)&&cheapCash>=0?Math.max(0,cheapCash-(budgets.available-remaining.available)):null;
   let lifetimeSeconds=null;
   if(typeof equipmentLifetime==='function'){
    try{lifetimeSeconds=equipmentLifetime(crew[name],e,crew);}catch{lifetimeSeconds=NaN;}
    if(lifetimeSeconds!==null&&(!Number.isFinite(lifetimeSeconds)||lifetimeSeconds<0)){diagnostics.ineligible++;continue;}
   }
   const expiring=e.type!=='Augmentation'&&Number.isFinite(lifetimeSeconds);
   let value;
   if(!powerFocus&&!expiring&&typeof cheapEligibility==='function'&&gangCheapEquipment(e.cost,cash)){
    let allowed=false;try{allowed=cheapEligibility(crew[name],e,crew)===true;}catch{}
    if(!allowed){diagnostics.cheapEligibilityRejected++;continue;}
    diagnostics.cheapFastTracked++;
    value={cheapOnly:true,moneyGain:0,objectiveGain:0,respectGain:0,relativeObjectiveGain:0};
   }else{diagnostics.returnForecasts++;value=evaluate(crew[name],e,crew);}
   if(value)result.push({...value,...(lifetimeSeconds===null?{}:{lifetimeSeconds}),member:name,type:e.type,equipmentName:e.name,cost:e.cost});
  }
  return result;
 };
 let candidates=collectCandidates(crewNames);
 for(const m of Object.values(crew))for(const e of equipment)
  diagnostics[m.upgrades.includes(e.name)||m.augmentations.includes(e.name)?'owned':'missing']++;
 diagnostics.ineligible=diagnostics.missing-candidates.length-diagnostics.skippedEvaluations;
 const context=()=>({...recruitment,respectRate,bootstrapBudget:remaining.bootstrapBudget});
 const affordable=c=>allocateGangEquipment([c],remaining).length>0;
 const purchaseCheckLimit=Math.min(32,Math.max(0,Number.isFinite(maxPurchaseChecks)?Math.floor(maxPurchaseChecks):0));
 const choose=ranked=>{
  for(const candidate of rotateGangMaterialCandidates(ranked,nextPurchaseCursor,materialCash)){
   if(!affordable(candidate))continue;
   if(typeof purchaseGuard!=='function')return candidate;
   if(expired()){diagnostics.timeLimited=true;return null;}
   if(diagnostics.purchaseChecks>=purchaseCheckLimit){diagnostics.purchaseCheckLimited=true;return null;}
   diagnostics.purchaseChecks++;
   let quote;
   try{quote=purchaseGuard(candidate,crew,budgets.available-remaining.available,{remainingMs:Number.isFinite(maxPlanningMs)?Math.max(0,maxPlanningMs-(now()-started)):Infinity});}catch{quote={allowed:false,reason:'readiness-quote-failed'};}
   if(Number.isFinite(materialCash)&&candidate.cost>materialCash*.01&&quote?.deferredRotation!==true)nextPurchaseCursor=gangEquipmentCandidateKey(candidate);
   const accepted=quote?.allowed===true;
   diagnostics.purchaseReadiness.push({member:candidate.member,equipmentName:candidate.equipmentName||candidate.items?.map(e=>e.name).join(' + '),cost:candidate.cost,
    allowed:accepted,reason:quote?.reason||'invalid-readiness-quote',beforeSeconds:quote?.beforeSeconds??null,afterSeconds:quote?.afterSeconds??null});
   if(accepted)return {...candidate,readinessGuarded:true,readinessCashFloor:quote.cashFloor};
   diagnostics.purchaseBlocked++;
  }
  return null;
 };
 for(let pass=0;orders.length<limit;pass++){
  if(pass>0&&expired()){diagnostics.timeLimited=true;break;}
  const cashLeft=Number.isFinite(cheapCash)&&cheapCash>=0?Math.max(0,cheapCash-(budgets.available-remaining.available)):null;
  // A shrinking threshold can turn a deferred cheap item into a larger investment.
  // Such an item must obtain a current forecast before it can enter ROI ranking.
  candidates=candidates.flatMap(c=>{
   if(!c.cheapOnly||gangCheapEquipment(c.cost,cashLeft))return [c];
   if(evaluationExpired()){diagnostics.deferredForecasts++;diagnostics.timeLimited=true;return [];}
   const equip=equipment.find(e=>e.name===c.equipmentName);if(!equip)return [];
   diagnostics.returnForecasts++;const value=evaluate(crew[c.member],equip,crew);
   return value?[{...value,member:c.member,type:equip.type,equipmentName:equip.name,cost:equip.cost}]:[];
  });
  const cheap=Number.isFinite(cashLeft)?candidates.filter(c=>(c.type==='Augmentation'||!Number.isFinite(c.lifetimeSeconds))&&gangCheapEquipment(c.cost,cashLeft)).map(c=>({...c,reason:'cheap',cheapFraction:.01,
   paybackSeconds:null,cashPaybackSeconds:null,valuePaybackSeconds:null})).sort((a,b)=>a.cost-b.cost):[];
  const cheapKeys=new Set(cheap.map(c=>JSON.stringify([c.member,c.equipmentName])));
  const ranked=rankGangEquipment(candidates,horizon,context());
  const hasAffordableCheap=cheap.some(affordable);
  if(pass===0)diagnostics.cheapQualified=cheap.length;
  if(pass===0){
   const initial=[...cheap,...ranked.filter(c=>!cheapKeys.has(JSON.stringify([c.member,c.equipmentName])))];
   diagnostics.qualified=initial.length;diagnostics.budgetBlocked=initial.filter(c=>!affordable(c)).length;
   const qualified=new Set(initial.map(c=>JSON.stringify([c.member,c.equipmentName])));
   diagnostics.rejected=candidates.filter(c=>!qualified.has(JSON.stringify([c.member,c.equipmentName])))
    .sort((a,b)=>a.cost-b.cost).slice(0,12).map(c=>({member:c.member,equipmentName:c.equipmentName,cost:c.cost,
     reason:!(c.cost>0)||!Number.isFinite(c.cost)?'invalid-price':!(c.moneyGain>0||c.objectiveGain>0||c.respectGain>0)?'no-projected-gain':'below-return-threshold'}));
   firstOpportunity=ranked.find(affordable)||ranked[0]||null;
  }
  const pairs=[];
  if(!hasAffordableCheap&&limit-orders.length>=2&&!bundleExpired()&&diagnostics.bundleEvaluations<bundleLimit){
   const groups=[];
   for(const [name,m]of Object.entries(crew))for(const permanent of [true,false]){
    const shortlist=gangEquipmentShortlist(equipment.filter(e=>(e.type==='Augmentation')===permanent&&!m.upgrades.includes(e.name)&&!m.augmentations.includes(e.name)),
     candidates.filter(c=>c.member===name),{available:remaining.available,categoryLimit:permanent?remaining.augLimit:remaining.equipmentLimit});
    const missing=shortlist.items,benefits=new Set(shortlist.benefitNames),queues=[[],[],[]];
    for(let i=0;i<missing.length;i++)for(let j=i+1;j<missing.length;j++){
     const a=benefits.has(missing[i].name),b=benefits.has(missing[j].name);
     queues[a!==b?0:a?1:2].push([missing[i],missing[j]]);
    }
    const options=[];
    // Mix cheap/benefit pairs, benefit/benefit pairs, and cheap/cheap pairs so
    // worthwhile expensive combinations are tested before a short budget ends.
    for(let pair=0;pair<66;pair++)for(const queue of queues)if(queue[pair])options.push(queue[pair]);
    if(options.length)groups.push({name,m,permanent,options});
   }
   // Give every member/category a turn before spending another pair evaluation
   // on the first member. Large inventories cannot monopolize the shared cap.
   bundleSearch: for(let pair=0;pair<66;pair++)for(const {name,m,permanent,options}of groups){
     const items=options[pair];if(!items)continue;
     if(bundleExpired()||diagnostics.bundleEvaluations>=bundleLimit){diagnostics.bundleSearchLimited=true;break bundleSearch;}
     const cost=items[0].cost+items[1].cost,type=permanent?'Augmentation':'Equipment';
     if(cost>remaining.available||cost>(permanent?remaining.augLimit:remaining.equipmentLimit))continue;
     const stats={};for(const e of items)for(const [key,mult]of Object.entries(e.stats))stats[key]=(stats[key]||1)*mult;
     diagnostics.returnForecasts++;const value=evaluate(m,{type,stats,cost},crew);diagnostics.bundleEvaluations++;
     diagnostics.bundleEvaluationsByMember[name]=(diagnostics.bundleEvaluationsByMember[name]||0)+1;
     if(value)pairs.push({...value,member:name,type,cost,items});
   }
  }else if(!hasAffordableCheap&&limit-orders.length>=2)diagnostics.bundleSearchLimited=true;
  const rankedPairs=rankGangEquipment(pairs,horizon,context());
  diagnostics.bundleQualified+=rankedPairs.length;
  // Use one queue so an inferior single does not consume guard checks before
  // a better bundle, and a blocked bundle can fall back to an eligible single.
  const powerFirst=ranked.filter(c=>c.reason==='power');
  const alternatives=[...powerFirst,...cheap,...rankGangEquipment([...ranked,...rankedPairs],horizon,context())
   .filter(c=>c.items||!cheapKeys.has(JSON.stringify([c.member,c.equipmentName])))];
  const selected=choose(alternatives);
  if(pass===0&&(selected||typeof purchaseGuard==='function'))firstOpportunity=selected||null;
  if(expired())diagnostics.timeLimited=true;
  if(!selected)break;
  const items=selected.items||[equipment.find(e=>e.name===selected.equipmentName)];
  const bundleId=items.length>1?JSON.stringify([selected.member,pass]):undefined;
  let bundleSpent=0;
  for(const equip of items){
   orders.push({...selected,items:undefined,bundleId,equipmentName:equip.name,type:equip.type,cost:equip.cost,readinessCashFloor:Number.isFinite(selected.readinessCashFloor)?selected.readinessCashFloor-bundleSpent:undefined});
   bundleSpent+=equip.cost;
   const member=crew[selected.member]=projectGangMember(crew[selected.member],null,0,equip.stats);
   member[equip.type==='Augmentation'?'augmentations':'upgrades'].push(equip.name);
  }
  remaining.available-=selected.cost;
  if(selected.type==='Augmentation')remaining.augLimit-=selected.cost;else remaining.equipmentLimit-=selected.cost;
  if(selected.reason!=='production'&&selected.reason!=='cheap')remaining.bootstrapBudget-=selected.cost;
  if(selected.reason==='cheap')diagnostics.cheapPlanned+=items.length;
  respectRate+=Math.max(0,selected.respectGain||0);
  if(orders.length>=limit)break;
  if(expired()){diagnostics.timeLimited=true;break;}
  candidates=crewAware?collectCandidates(crewNames):candidates.filter(c=>c.member!==selected.member).concat(collectCandidates([selected.member]));
 }
 return {orders,firstOpportunity,diagnostics:{...diagnostics,nextPurchaseCursor,nextValuationOffset:valuationCursor,nextValuationItems:Object.fromEntries(itemCursors),planningMs:now()-started,planned:orders.length,plannedCost:orders.reduce((sum,o)=>sum+o.cost,0)}};
}

/** Deterministic whole-crew allocation; a stronger member may free another from wanted reduction. */
export function planGangWantedCrew(rates,assignments,tolerance,focus='value',locked=[]) {
 const names=Object.keys(rates),lock=new Set(locked);
 if(!Number.isFinite(tolerance)||names.some(n=>!rates[n]?.length))return null;
 const sorted=Object.fromEntries(names.map(n=>[n,rates[n].slice().sort((a,b)=>(b[focus]||0)-(a[focus]||0))]));
 const current=Object.fromEntries(names.map(n=>[n,sorted[n].find(t=>t.name===assignments[n])||sorted[n][0]]));
 const best=Object.fromEntries(names.map(n=>[n,lock.has(n)?current[n]:sorted[n][0]]));
 const maximum=gangTaskTotals(best),maximumValue=Object.values(best).reduce((sum,t)=>sum+(t[focus]||0),0);
 // If every independent maximum already fits, no constrained search can improve it.
 if(maximum.wanted<=tolerance&&[maximumValue,maximum.money,maximum.respect,maximum.wanted].every(Number.isFinite))return {...maximum,value:maximumValue,assignments:best};
 let result=null;
 for(const seed of [current,best])for(const downgrade of [nextWantedDowngrade,largestWantedDowngrade]){
  let plan={...seed},totals=gangTaskTotals(plan);
  for(let i=0;totals.wanted>tolerance&&i<names.length*32;i++){
   const change=downgrade(plan,sorted,locked,focus);if(!change)break;
   plan[change.name]=change.task;totals=gangTaskTotals(plan);
  }
  if(totals.wanted>tolerance)continue;
  plan=improveGangPlan(plan,sorted,focus,tolerance,locked);totals=gangTaskTotals(plan);
  const value=Object.values(plan).reduce((sum,t)=>sum+(t[focus]||0),0);
  if(!Number.isFinite(value)||![totals.money,totals.respect,totals.wanted].every(Number.isFinite))continue;
  if(!result||value>result.value)result={...totals,value,assignments:plan};
 }
 return result;
}

/** Keep diagnostics without moving the timestamp of their underlying observations. */
export function gangMaintenanceStatus(saved,pid,reset,now=Date.now()) {
 const dataAt=saved?.dataAt===undefined?saved?.at:saved.dataAt;
 const valid=saved?.pid===pid&&saved.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset&&
  saved.info&&Number.isFinite(dataAt)&&dataAt>0&&dataAt<=now;
 return {...(valid?saved:{}),at:now,pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,status:'maintenance',dataAt:valid?dataAt:null};
}

/** Bounded planning window. A queued augmentation by itself never predicts a reset. */
export function gangPlanningHorizon({baseSeconds=900,adaptive=true,remainingMs=null,recruitSeconds=null,installSeconds=null,resetPending=false,development=false,powerPriority=false,developmentAgeSeconds=null,memberCount=0}={}){
 const base=Number.isFinite(baseSeconds)&&baseSeconds>0?baseSeconds:900;
 if(resetPending)return {seconds:0,reason:'Augmentation reset pending'};
 const cap=development?10800:3600;
 let seconds=base,reason='Configured growth window';
 if(adaptive){
  if(development&&powerPriority&&Number.isFinite(developmentAgeSeconds)&&developmentAgeSeconds>=600&&memberCount>=6){seconds=Math.max(seconds,Math.min(cap,developmentAgeSeconds>=3600&&memberCount>=12?3600:1800));reason='Established gang and power priority support longer stat development';}
  if(Number.isFinite(remainingMs)&&remainingMs>base*2000){seconds=Math.max(seconds,Math.min(cap,remainingMs/4000));reason='Long remaining route permits compounding growth';}
  if(Number.isFinite(recruitSeconds)&&recruitSeconds>0){seconds=Math.max(seconds,Math.min(cap,recruitSeconds*2));if(seconds>base)reason='Recruitment milestone supports longer payback';}
 }
 // Keep a 20% buffer before known route completion or the selected install wait.
 for(const [bound,label]of [[Number.isFinite(remainingMs)?remainingMs/1000:null,'Route completion'],[installSeconds,'Selected augmentation install wait']]){
  if(Number.isFinite(bound)&&bound>=0&&bound*.8<seconds){seconds=Math.max(0,bound*.8);reason=label+' limits growth payback';}
 }
 return {seconds,reason};
}

/** Compare bounded, wanted-safe crew plans by joint augmentation readiness.
 * Rates are per game cycle; money and faction reputation accrue in parallel. */
export function gangPurchaseFocus({goal,money,factionRep,respectToRep,rates,assignments={},locked=[],tolerance=0,otherCashRate=0,previous=null,workFractions={},bonusSeconds=0}={}) {
 if(!goal||![goal.cost,goal.rep,money,factionRep,respectToRep,tolerance,otherCashRate,bonusSeconds].every(Number.isFinite)||
  goal.cost<0||goal.rep<0||money<0||factionRep<0||respectToRep<=0||otherCashRate<0||bonusSeconds<0||!rates||typeof rates!=='object')return null;
 const names=Object.keys(rates);
 if(!names.length||names.length>12||names.some(n=>!Array.isArray(rates[n])||!rates[n].length||rates[n].length>64||rates[n].some(t=>
  !t||typeof t.name!=='string'||![t.money,t.respect,t.wanted].every(Number.isFinite)||t.money<0||t.respect<0)))return null;
 // A protected training assignment must exist in the supplied native task catalogue.
 if(!workFractions||locked.some(n=>!names.includes(n)||!rates[n].some(t=>t.name===assignments[n])))return null;
 const cashGap=Math.max(0,goal.cost-money),repGap=Math.max(0,goal.rep-factionRep);
 const base=Math.max(1,cashGap/Math.max(1,repGap/respectToRep));
 const candidates=[{focus:'money',weight:base},{focus:'respect',weight:base},
  ...[.25,1,4].map(scale=>({focus:'both money and respect',weight:Math.max(1,base*scale)}))];
 if(previous&&['money','respect','both money and respect'].includes(previous.focus)&&Number.isFinite(previous.weight)&&previous.weight>=1)
  candidates.push({focus:previous.focus,weight:previous.weight,incumbent:true});
 const timingContext={goal,money,factionRep,respectToRep,otherCashRate,workFractions,bonusSeconds},quotes=[];
 const timing=plan=>gangPurchasePlanTiming(timingContext,plan.assignments);
 for(const candidate of candidates){
  const scored=Object.fromEntries(names.map(n=>[n,rates[n].map(t=>({...t,value:gangObjectiveValue(t,candidate.focus,candidate.weight)*(workFractions[n]?.normal??1)}))]));
  let plan=planGangWantedCrew(scored,assignments,tolerance,'value',locked);
  if(!plan||plan.wanted>tolerance)continue;
  // A discrete balanced task can beat both extreme tasks even when no linear
  // weighting would select it. Refine balanced plans directly by joint readiness.
  if(candidate.focus==='both money and respect'){
   const lock=new Set(locked),eta=p=>timing(p)?.etaSeconds??Infinity;
   for(let step=0;step<Math.min(24,names.length*2);step++){
    let best=null,bestEta=eta(plan);
    for(const name of names)if(!lock.has(name))for(const task of scored[name]){
     const old=plan.assignments[name],trial={money:plan.money+task.money-old.money,respect:plan.respect+task.respect-old.respect,wanted:plan.wanted+task.wanted-old.wanted,assignments:{...plan.assignments,[name]:task}};
     if(trial.wanted>tolerance)continue;
     const wait=eta(trial);
     if(wait<bestEta){bestEta=wait;best={...trial,assignments:{...plan.assignments,[name]:task}};}
    }
    if(!best)break;plan=best;
   }
  }
  const ready=timing(plan);if(!ready)continue;
  quotes.push({...candidate,...ready,wanted:plan.wanted,assignments:plan.assignments});
 }
 // Two-stage quotes use the same feasible crew plans. A switch includes a full
 // normal territory-cycle allowance with zero production; no sub-cycle switches
 // are credited. During bonus time only fixed plans are compared; a staged
 // bonus-boundary optimizer is not modeled. Only the first stage is applied now.
 const fixed=quotes.slice(),key=plan=>JSON.stringify(Object.entries(plan.assignments).map(([n,t])=>[n,t.name]).sort());
 for(const first of bonusSeconds>0?[]:fixed)for(const second of fixed){
  if(first===second||key(first)===key(second))continue;
  const staged=gangTwoStageWait({cashGap,repGap,first,second});
  if(!staged||staged.etaSeconds>=Math.min(first.etaSeconds,second.etaSeconds))continue;
  const stageKey=key(first)+'>'+key(second);
  quotes.push({...first,...staged,incumbent:previous?.stageKey===stageKey,stageKey,
   secondFocus:second.focus,secondWeight:second.weight,
   stages:[{focus:first.focus,seconds:staged.firstSeconds,tasks:JSON.parse(key(first))},
    {focus:second.focus,seconds:staged.secondSeconds,tasks:JSON.parse(key(second))}]});
 }
 for(let i=quotes.length-1;i>=0;i--)if(!Number.isFinite(quotes[i].etaSeconds))quotes.splice(i,1);
 quotes.sort((a,b)=>a.etaSeconds-b.etaSeconds||Number(b.incumbent===true)-Number(a.incumbent===true)||
  Number(b.focus===previous?.focus)-Number(a.focus===previous?.focus));
 if(!quotes.length)return null;
 const incumbent=quotes.find(q=>q.incumbent),best=quotes[0];
 // Reprice the incumbent with current members/rates; a stale saved ETA is never reused.
 const chosen=incumbent&&best.etaSeconds>=incumbent.etaSeconds*.95?incumbent:best;
 return {...chosen,reason:chosen.stages?'Staged cash and reputation production':cashGap===0?'Cash ready; unlock reputation':repGap===0?'Reputation ready; fund purchase':
  chosen.repSeconds>chosen.cashSeconds?'Reputation limits purchase':'Cash limits purchase',
  candidates:quotes.map(({assignments,stages,...q})=>q)};
}


/** Minimum continuous two-resource wait for a specified order of two rate plans.
 * Evaluate piecewise-linear breakpoints, then charge a conservative switch delay. */
export function gangTwoStageWait({cashGap,repGap,first,second,minFirstSeconds=20,switchDelaySeconds=20}={}) {
 if(!first||!second||![cashGap,repGap,first.cashRate,first.repRate,second.cashRate,second.repRate,minFirstSeconds,switchDelaySeconds].every(Number.isFinite)||
  cashGap<0||repGap<0||[first.cashRate,first.repRate,second.cashRate,second.repRate].some(r=>r<0)||minFirstSeconds<20||switchDelaySeconds<20)return null;
 const seconds=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 const a=first.cashRate,b=first.repRate,c=second.cashRate,d=second.repRate;
 const points=[minFirstSeconds,seconds(cashGap,a),seconds(repGap,b)];
 const determinant=a*d-b*c;
 if(determinant!==0)points.push((cashGap*d-repGap*c)/determinant);
 let best=null;
 for(const t of points){
  if(!Number.isFinite(t)||t<minFirstSeconds)continue;
  const cashRemaining=a>0&&t>=cashGap/a?0:Math.max(0,cashGap-a*t);
  const repRemaining=b>0&&t>=repGap/b?0:Math.max(0,repGap-b*t);
  const secondSeconds=Math.max(seconds(cashRemaining,c),seconds(repRemaining,d));
  if(!Number.isFinite(secondSeconds)||secondSeconds<=0)continue;
  const etaSeconds=t+switchDelaySeconds+secondSeconds;
  if(!Number.isFinite(etaSeconds))continue;
  if(!best||etaSeconds<best.etaSeconds)best={etaSeconds,firstSeconds:t,secondSeconds,switchDelaySeconds,
   cashSeconds:etaSeconds,repSeconds:etaSeconds};
 }
 return best;
}


/** Adaptive caps allow stronger reinvestment; explicit user percentages still win. */
export function gangEquipmentBudgets({money,sharedAllowance,equipmentFraction=null,augmentationFraction=null,moneyFocus=false}={}) {
 if(![money,sharedAllowance].every(Number.isFinite)||money<0||sharedAllowance<0||[equipmentFraction,augmentationFraction].some(f=>f!==null&&(!Number.isFinite(f)||f<0||f>1)))
  return {available:0,equipmentLimit:0,augLimit:0,bootstrapBudget:0};
 return {available:Math.min(sharedAllowance,money*.5),equipmentLimit:money*(equipmentFraction??.2),augLimit:money*(augmentationFraction??.5),
  bootstrapBudget:moneyFocus||(equipmentFraction===0&&augmentationFraction===0)?0:Math.min(money*.05,sharedAllowance)};
}

/** Price the next useful augmentation with and without equipment, including
 * earlier approved purchases in this batch. Rates use the gang planner's cycles. */
export function gangEquipmentReadiness({context,beforeRates,afterRates,afterWorkFractions,cost,spent=0,horizon=900}={}) {
 if(!context||![cost,spent,horizon,context.money].every(Number.isFinite)||cost<0||spent<0||horizon<0||context.money<0)
  return {allowed:false,reason:'invalid-readiness-input'};
 const money=context.money-spent;
 if(money<cost)return {allowed:false,reason:'insufficient-spendable-cash'};
 const before=gangPurchaseFocus({...context,money,rates:beforeRates,previous:null});
 if(!before)return {allowed:true,reason:'no-reachable-augmentation-quote',cashFloor:money};
 if(before.etaSeconds>horizon)return {allowed:true,reason:'outside-purchase-horizon',beforeSeconds:before.etaSeconds,cashFloor:money};
 const after=gangPurchaseFocus({...context,money:money-cost,rates:afterRates,workFractions:afterWorkFractions??context.workFractions,previous:null});
 if(!after)return {allowed:false,reason:'purchase-makes-augmentation-unreachable',beforeSeconds:before.etaSeconds};
 const allowed=after.etaSeconds<=before.etaSeconds;
 return {allowed,reason:allowed?'preserves-augmentation-readiness':'delays-augmentation',beforeSeconds:before.etaSeconds,afterSeconds:after.etaSeconds,cashFloor:money};
}


/** Keep inexpensive exploration alongside diverse projected production benefits.
 * Only pairs whose individual prices can fit with a missing partner are explored. */
export function gangEquipmentShortlist(items,candidates,{available,categoryLimit,limit=12}={}) {
 const empty={items:[],benefitNames:[]};
 if(!Array.isArray(items)||!Array.isArray(candidates)||![available,categoryLimit,limit].every(Number.isFinite)||available<0||categoryLimit<0)return empty;
 limit=Math.max(0,Math.min(12,Math.floor(limit)));if(limit<2)return empty;
 const budget=Math.min(available,categoryLimit),unique=new Map();
 for(const item of items)if(item&&typeof item.name==='string'&&Number.isFinite(item.cost)&&item.cost>0&&!unique.has(item.name))unique.set(item.name,item);
 const sorted=[...unique.values()].sort((a,b)=>a.cost-b.cost||a.name.localeCompare(b.name));
 if(sorted.length<2||sorted[0].cost+sorted[1].cost>budget)return empty;
 const eligible=sorted.filter(item=>item.cost+(item===sorted[0]?sorted[1].cost:sorted[0].cost)<=budget);
 const values=new Map(candidates.filter(c=>c&&typeof c.equipmentName==='string').map(c=>[c.equipmentName,c]));
 const chosen=eligible.slice(0,Math.min(6,Math.ceil(limit/2))),seen=new Set(chosen.map(e=>e.name)),benefitNames=[];
 const channels=[['moneyGain',true],['objectiveGain',true],['respectGain',true],['moneyGain',false],['objectiveGain',false],['respectGain',false]];
 const lists=channels.map(([key,perDollar])=>eligible.map(item=>({item,score:values.get(item.name)?.[key]}))
  .filter(x=>Number.isFinite(x.score)&&x.score>0).map(x=>({...x,score:perDollar?x.score/x.item.cost:x.score})).filter(x=>Number.isFinite(x.score)&&x.score>0)
  .sort((a,b)=>b.score-a.score||a.item.cost-b.item.cost||a.item.name.localeCompare(b.item.name)));
 while(chosen.length<limit){
  let added=false;
  for(const list of lists){
   const next=list.find(x=>!seen.has(x.item.name));if(!next)continue;
   chosen.push(next.item);seen.add(next.item.name);benefitNames.push(next.item.name);added=true;
   if(chosen.length>=limit)break;
  }
  if(!added)break;
 }
 for(const item of eligible)if(chosen.length<limit&&!seen.has(item.name)){chosen.push(item);seen.add(item.name);}
 return {items:chosen,benefitNames};
}


/** Cheap catch-up equipment is tested per member, against shrinking unreserved cash. */
export function gangCheapEquipment(cost,cash) {
 return Number.isFinite(cost)&&cost>0&&Number.isFinite(cash)&&cash>0&&cost<cash*.01;
}

/** Timing history changes search effort only; no financial approvals survive a pass. */
export function gangComparisonBudget(history,now=Date.now()){
 const rows=Array.isArray(history)?history.filter(r=>r&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=60000&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0&&r.elapsedMs<=100&&Number.isFinite(r.budgetMs)&&r.budgetMs>0&&r.budgetMs<=50&&typeof r.incomplete==='boolean').slice(-8):[];
 const timeouts=rows.slice(-3).filter(r=>r.incomplete&&r.elapsedMs>=r.budgetMs*.8).length;
 return {candidateLimit:timeouts>=2?1:3,perComparisonMs:timeouts>=2?50:25,reason:timeouts>=2?'Concentrate the existing planning time after repeated expensive incomplete comparisons':'Normal comparison slots',history:rows};
}
export function recordGangComparisonTiming(history,row,now=Date.now()){
 return gangComparisonBudget([...(Array.isArray(history)?history:[]),row],now).history;
}
