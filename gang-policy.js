export function gangFocus({moneyFocus,reputationFocus,members,factionRep,requiredRep,money,respect}) {
  if(reputationFocus)return 'respect';
  if(moneyFocus)return 'money';
  if(members<12)return 'respect';
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
export function chooseGangAscensions(results,gang,names,stats,base=1.05,spacing=0.05) {
  if(names.length<12&&gang.respectForNextRecruit>0&&gang.respect>=gang.respectForNextRecruit*0.8)return [];
  const lossBudget=Math.max(0,gang.respect)*(names.length<12?0.1:0.25);
  return names.map((name,index)=>{
    const result=results[name];if(!result)return null;
    const gain=Math.exp(stats.reduce((sum,key)=>sum+Math.log(Math.max(1,Number(result[key])||1)),0)/stats.length);
    const loss=Math.max(0,Number(result.respect)||0);
    return {name,gain,loss,threshold:base+(11-index)*spacing};
  }).filter(item=>item&&item.gain>=item.threshold&&item.loss<=lossBudget)
    .sort((a,b)=>(b.gain-1)/(1+b.loss/Math.max(1,gang.respect))-(a.gain-1)/(1+a.loss/Math.max(1,gang.respect))).slice(0,1);
}
export function gangTaskTotals(assignments) {
  return Object.values(assignments).reduce((sum,task)=>({wanted:sum.wanted+task.wanted,respect:sum.respect+task.respect,money:sum.money+task.money}),{wanted:0,respect:0,money:0});
}
export function wantedRecoveryOrder(names,assignments,rates,reductionTask,focus) {
  const value=task=>focus==='money'?task.money:focus==='respect'?task.respect:task.money/1000+task.respect;
  return names.map(name=>{
    const current=rates[name]?.find(task=>task.name===assignments[name]);
    const recovery=rates[name]?.find(task=>task.name===reductionTask);
    if(!current||!recovery||current.wanted<=recovery.wanted)return null;
    return {name,cost:Math.max(0,value(current)-value(recovery))/(current.wanted-recovery.wanted)};
  }).filter(Boolean).sort((a,b)=>a.cost-b.cost).map(item=>item.name);
}
export function purchaseGangEquipment(ns,orders,reserve,budget,claim = () => true, allowed = () => true) {
  let remaining=Math.max(0,budget);
  return orders.map(order=>{
    if(!allowed(ns))return false;
    const price=ns.gang.getEquipmentCost(order.equipmentName);
    const hold=Math.max(0,reserve,Number(ns.read('reserve.txt'))||0);
    if(!(price>0)||!Number.isFinite(price)||price>remaining||ns.getPlayer().money<price+hold)return false;
    if(!claim(ns,"gang",price))return false;
    const success=ns.gang.purchaseEquipment(order.member,order.equipmentName);
    if(success)remaining-=price;
    return success;
  });
}

/** Self-contained so pending helpers cannot mutate a paused or exited controller. */
export function gangMutationAllowed(ns,ownerPid=null) {
 if(ownerPid!==null&&!ns.isRunning(ownerPid))return false;
 if(ns.read('remote-control/paused/gangs.js.txt').trim()==='true')return false;
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
export function nextWantedDowngrade(assignments,rates,locked=[]) {
 const lock=new Set(locked);let best=null;
 for(const [name,current]of Object.entries(assignments)) {
  if(lock.has(name))continue;
  const next=rates[name]?.find(t=>Number.isFinite(t.wanted)&&t.wanted<current.wanted);
  if(next&&(!best||current.wanted>assignments[best.name].wanted))best={name,task:next};
 }
 return best;
}
export function betterGangPlan(wanted,gain,previousWanted,previousGain,tolerance) {
 const feasible=wanted<=tolerance,previousFeasible=previousWanted<=tolerance;
 if(feasible!==previousFeasible)return feasible;
 return feasible?gain>previousGain:wanted<previousWanted||wanted===previousWanted&&gain>previousGain;
}
