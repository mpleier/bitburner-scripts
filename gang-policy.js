export function gangFocus({moneyFocus,reputationFocus,members,factionRep,requiredRep,money,respect,goal}) {
  if(reputationFocus)return 'respect';
  if(moneyFocus)return 'money';
  if(members<12)return 'respect';
  if(goal&&Number.isFinite(goal.rep)&&Number.isFinite(goal.cost)){
    if(factionRep>=goal.rep)return 'money';
    if(money<goal.cost*.5)return 'money';
    return 'respect';
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
export function chooseGangAscensions(results,gang,names,stats,base=1.05,spacing=0.05,limit=1,adaptive=false) {
  if(names.length<12&&gang.respectForNextRecruit>0&&gang.respect>=gang.respectForNextRecruit*0.8)return [];
  const lossBudget=Math.max(0,gang.respect)*(names.length<12?0.1:0.25);
  return names.map((name,index)=>{
    const result=results[name];if(!result)return null;
    const gain=Math.exp(stats.reduce((sum,key)=>sum+Math.log(Math.max(1,Number(result[key])||1)),0)/stats.length);
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
export function purchaseGangEquipment(ns,orders,reserve,budget,claim = () => true, allowed = () => true,detailed=false) {
  let remaining=Math.max(0,budget);
  const bundles=new Map();
  const result=(success,reason,price=0)=>detailed?{success,reason,price}:success;
  return orders.map(order=>{
    if(!allowed(ns))return result(false,'controller-paused');
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
    if(price>remaining)return result(false,'batch-budget',price);
    if(ns.getPlayer().money<price+hold)return result(false,'cash-reserve',price);
    if(!bundle&&!claim(ns,"gang",price))return result(false,'shared-budget',price);
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
   const member=ns.gang.getMemberInformation(name);
  if(stats.some(k=>Math.abs((results[name]?.[k]||0)-(economics.ascension?.[k]||0))>.01||
    Math.abs((member[k]||0)-(economics.member?.[k]||0))>Math.max(1,(economics.member?.[k]||0)*.02)))return null;
 }else if(choose(results,gang,names,stats,base,spacing)[0]?.name!==name)return null;
 ns.gang.setTerritoryWarfare(false);
 const result=ns.gang.ascendMember(name);
 if(result)ns.gang.setMemberTask(name,'Train '+(gang.isHacking?'Hacking':'Combat'));
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

/** Cash returns and progression utility have separate budgets and telemetry. */
export function rankGangEquipment(orders,horizon=900,recruitment=null) {
 const ranked=[];
 for(const order of orders){
  if(!(order.cost>0)||!Number.isFinite(order.cost))continue;
  const cashPaybackSeconds=Number.isFinite(order.moneyGain)&&order.moneyGain>0?order.cost/order.moneyGain:Infinity;
  const valuePaybackSeconds=Number.isFinite(order.objectiveGain)&&order.objectiveGain>0?order.cost/order.objectiveGain:Infinity;
  const r=recruitment;
  const eligible=r&&r.memberCount<12&&r.memberCount>=0&&Number.isFinite(r.respectRate)&&r.respectRate>0&&
   Number.isFinite(r.respectGap)&&r.respectGap>0&&Number.isFinite(r.bootstrapBudget)&&order.cost<=r.bootstrapBudget&&
   Number.isFinite(order.respectGain)&&order.respectGain>0;
  const eta=eligible?r.respectGap/r.respectRate:0;
  const saved=eligible?eta-r.respectGap/(r.respectRate+order.respectGain):0;
  const data={...order,cashPaybackSeconds:Number.isFinite(cashPaybackSeconds)?cashPaybackSeconds:null,
   valuePaybackSeconds:Number.isFinite(valuePaybackSeconds)?valuePaybackSeconds:null,recruitSecondsSaved:saved};
  if(cashPaybackSeconds<=horizon)ranked.push({...data,paybackSeconds:cashPaybackSeconds,reason:'production'});
  else if(saved>=Math.max(20,eta*.02))ranked.push({...data,paybackSeconds:null,reason:'recruitment'});
  else if(r?.allowProgression===true&&order.cost<=r.bootstrapBudget&&(valuePaybackSeconds<=horizon||Number.isFinite(order.relativeObjectiveGain)&&order.relativeObjectiveGain>=.02&&order.objectiveGain>0))
   ranked.push({...data,paybackSeconds:null,reason:'progression'});
 }
 const priority={production:0,recruitment:1,progression:2};
 return ranked.sort((a,b)=>priority[a.reason]-priority[b.reason]||
  (a.reason==='recruitment'?b.recruitSecondsSaved/b.cost-a.recruitSecondsSaved/a.cost:
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
export function gangWantedTolerance(gang,threshold=.01) {
 const penalty=gang.respect/(gang.respect+gang.wantedLevel)-1;
 return penalty < -1.1*threshold&&gang.wantedLevel>=1.1+gang.respect/1000&&gang.respect>200?-.01*gang.wantedLevel:
  penalty < -.9*threshold&&gang.wantedLevel>=1.1+gang.respect/10000?0:Math.max(gang.respectGainRate/1000,gang.wantedLevel/10);
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

/** Forecast the whole crew, including natural work XP and the global wanted penalty.
 * evaluate returns per-second value/money/respect/wanted and a chosen task.
 * Other members retain their feasible assignments while the candidate may change tasks. */
export function forecastGangAscension({members,name,ascended,gang,training,tasks,assignments,evaluate,
 horizonSeconds=900,windows=[20,60,120,200,300],respectLoss=0}) {
 if(!members[name]||!ascended||!training||!Number.isFinite(horizonSeconds)||horizonSeconds<=20||!Number.isFinite(respectLoss)||respectLoss<0)return null;
 const durations=windows.filter(s=>Number.isFinite(s)&&s>0&&s<horizonSeconds);
 const step=Math.max(20,Math.ceil(horizonSeconds/1200)*20);
 const times=[...new Set([0,horizonSeconds,...durations,...Array.from({length:Math.ceil(horizonSeconds/step)},(_,i)=>Math.min(horizonSeconds,(i+1)*step))])].sort((a,b)=>a-b);
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
    next[n]=projectGangMember(m,task,end-at);
    const after=evaluate(next[n],state,before.task);
    if(![before.value,after.value,before.respect,after.respect,before.wanted,after.wanted].every(Number.isFinite))return null;
    const gain=(before.value+after.value)/2;
    value+=gain;if(n===name)candidateValue=gain;
    respect+=(before.respect+after.respect)/2;wanted+=(before.wanted+after.wanted)/2;
    if(task.baseWanted<0)justice++;
   }
   const seconds=end-at,oldRespect=state.respect;
   state.respect+=respect*seconds;
   // Native justice applies a multiplicative wanted reduction once per processing update.
   state.wantedLevel=Math.max(1,(state.wantedLevel+wanted*seconds)*Math.pow(1-justice*.001,seconds/2));
   if(recruitAt===null&&members&&Object.keys(members).length<12&&gang.respectForNextRecruit>0&&state.respect>=gang.respectForNextRecruit)
    recruitAt=at+Math.max(0,gang.respectForNextRecruit-oldRespect)/Math.max(1e-9,respect);
   total+=value*seconds;candidateTotal+=candidateValue*seconds;at=end;crew=next;
   cumulative.push({at,total});
  }
  const finalRates=Object.values(crew).map(m=>evaluate(m,state,m.name===name?null:assignments[m.name]||m.task));
  const respectRate=finalRates.reduce((sum,r)=>sum+r.respect,0);
  const eta=Object.keys(members).length>=12?0:recruitAt??(respectRate>0?horizonSeconds+Math.max(0,gang.respectForNextRecruit-state.respect)/respectRate:Infinity);
  const recruitValue=Math.min(...finalRates.filter(r=>r.value>0).map(r=>r.value));
  return {total,candidateTotal,eta,recruitValue:Number.isFinite(recruitValue)?recruitValue:0,cumulative};
 };
 const baseline=simulate(0,false);if(!baseline)return null;
 let best=null;
 for(const trainingSeconds of durations){
  const after=simulate(trainingSeconds,true);if(!after)continue;
  const recruitDelaySeconds=baseline.eta===Infinity?0:Math.max(0,after.eta-baseline.eta);
  const recruitmentCost=recruitDelaySeconds*baseline.recruitValue;
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
export function forecastGangTraining(member,training,tasks,evaluate,horizon=900,windows=[20,60,120,200,300]) {
 const initial=evaluate(member);
 if(!Number.isFinite(horizon)||horizon<=20||!Number.isFinite(initial.value)||initial.value<0||!training)return {train:false,window:0};
 const durations=windows.filter(s=>Number.isFinite(s)&&s>0&&s<horizon);
 const step=Math.max(20,Math.ceil(horizon/1200)*20);
 const times=[...new Set([0,horizon,...durations,...Array.from({length:Math.ceil(horizon/step)},(_,i)=>Math.min(horizon,(i+1)*step))])].sort((a,b)=>a-b);
 const integrate=(seed,start)=>{
  let current=seed,at=start,total=0;
  for(const end of times){
   if(end<=at)continue;
   const before=evaluate(current);
   current=projectGangMember(current,tasks[before.task],end-at);
   const after=evaluate(current);
   if(!Number.isFinite(before.value)||!Number.isFinite(after.value))return NaN;
   total+=(before.value+after.value)*(end-at)/2;at=end;
  }
  return total;
 };
 const baseline=integrate(member,0);
 if(!Number.isFinite(baseline))return {train:false,window:0};
 let best={train:false,window:0,baseline,production:baseline,gain:0};
 for(const seconds of durations){
  const production=integrate(projectGangMember(member,training,seconds),seconds);
  if(Number.isFinite(production)&&production>best.production&&production>baseline*1.05)
   best={train:true,window:seconds,baseline,production,gain:production-baseline};
 }
 return best;
}

/** Distinguish protected-work deferrals and already-applied assignments from native rejection. */
export function applyGangWorkOrders(ns,orders,allowed,owner) {
 const failed=[];let assigned=0;
 for(const order of orders){
  if(!allowed(ns,owner))return {deferred:true,assigned,failed};
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
  if(order.reason!=='production'&&recruitment+order.cost>bootstrapBudget)continue;
  if(order.type==='Augmentation'?permanent+order.cost>augLimit:temporary+order.cost>equipmentLimit)continue;
  orders.push(order);available-=order.cost;
  if(order.reason!=='production')recruitment+=order.cost;
  if(order.type==='Augmentation')permanent+=order.cost;else temporary+=order.cost;
 }
 return orders;
}

/** An unknown territory phase must never reuse a stale deadline. */
export function gangTerritoryTiming({detected,nextTick,now,ready,finished,padding=200,interval=200}) {
 const known=Number.isFinite(nextTick)&&nextTick>0;
 return {prepare:!!(detected&&known&&!ready&&!finished&&now+interval+padding>=nextTick),
  overdue:!!(detected&&known&&ready&&now>nextTick+5000),
  management:!!(finished&&known&&now>=nextTick)};
}

/** Revalue after each choice. Only search pairs when no affordable single qualifies. */
export function planMarginalGangEquipment({members,equipment,evaluate,horizon=900,recruitment={},budgets,maxPurchases=8,crewAware=false,maxPlanningMs=crewAware?100:Infinity,now=Date.now}) {
 const started=now(),expired=()=>Number.isFinite(maxPlanningMs)&&now()-started>=Math.max(0,maxPlanningMs);
 const crew=Object.fromEntries(Object.entries(members).map(([name,m])=>[name,{...m,upgrades:[...m.upgrades],augmentations:[...m.augmentations]}]));
 const remaining={...budgets},orders=[],limit=Math.min(32,Math.max(0,Math.floor(maxPurchases)));
 let respectRate=recruitment.respectRate||0,firstOpportunity=null;
 const diagnostics={phase:'before-purchases',evaluations:0,skippedEvaluations:0,timeLimited:false,maxPlanningMs:Number.isFinite(maxPlanningMs)?maxPlanningMs:null,missing:0,owned:0,ineligible:0,qualified:0,budgetBlocked:0,bundleEvaluations:0,rejected:[],budgets:{...budgets}};
 const candidatesFor=name=>equipment.filter(e=>!crew[name].upgrades.includes(e.name)&&!crew[name].augmentations.includes(e.name))
  .map(e=>{if(expired()){diagnostics.skippedEvaluations++;diagnostics.timeLimited=true;return null;}diagnostics.evaluations++;const value=evaluate(crew[name],e,crew);return value?{...value,member:name,type:e.type,equipmentName:e.name,cost:e.cost}:null;}).filter(Boolean);
 let candidates=Object.keys(crew).flatMap(candidatesFor);
 for(const m of Object.values(crew))for(const e of equipment)
  diagnostics[m.upgrades.includes(e.name)||m.augmentations.includes(e.name)?'owned':'missing']++;
 diagnostics.ineligible=diagnostics.missing-candidates.length-diagnostics.skippedEvaluations;
 const context=()=>({...recruitment,respectRate,bootstrapBudget:remaining.bootstrapBudget});
 const affordable=c=>allocateGangEquipment([c],remaining).length>0;
 for(let pass=0;orders.length<limit;pass++){
  if(pass>0&&expired()){diagnostics.timeLimited=true;break;}
  const ranked=rankGangEquipment(candidates,horizon,context());
  if(pass===0){
   diagnostics.qualified=ranked.length;diagnostics.budgetBlocked=ranked.filter(c=>!affordable(c)).length;
   const qualified=new Set(ranked.map(c=>JSON.stringify([c.member,c.equipmentName])));
   diagnostics.rejected=candidates.filter(c=>!qualified.has(JSON.stringify([c.member,c.equipmentName])))
    .sort((a,b)=>a.cost-b.cost).slice(0,12).map(c=>({member:c.member,equipmentName:c.equipmentName,cost:c.cost,
     reason:!(c.cost>0)||!Number.isFinite(c.cost)?'invalid-price':!(c.moneyGain>0||c.objectiveGain>0||c.respectGain>0)?'no-projected-gain':'below-return-threshold'}));
   firstOpportunity=ranked.find(affordable)||ranked[0]||null;
  }
  let selected=ranked.find(affordable);
  if(!selected&&limit-orders.length>=2&&!expired()){
   const pairs=[];
   for(const [name,m]of Object.entries(crew))for(const permanent of [true,false]){
    const missing=equipment.filter(e=>(e.type==='Augmentation')===permanent&&!m.upgrades.includes(e.name)&&!m.augmentations.includes(e.name)&&e.cost>0&&Number.isFinite(e.cost))
     .sort((a,b)=>a.cost-b.cost).slice(0,12);
    for(let i=0;i<missing.length&&!expired();i++)for(let j=i+1;j<missing.length&&!expired();j++){
     const items=[missing[i],missing[j]],cost=items[0].cost+items[1].cost,type=permanent?'Augmentation':'Equipment';
     if(cost>remaining.available||cost>(permanent?remaining.augLimit:remaining.equipmentLimit))continue;
     const stats={};for(const e of items)for(const [key,mult]of Object.entries(e.stats))stats[key]=(stats[key]||1)*mult;
     const value=evaluate(m,{type,stats,cost},crew);diagnostics.bundleEvaluations++;
     if(value)pairs.push({...value,member:name,type,cost,items});
    }
   }
   selected=rankGangEquipment(pairs,horizon,context()).find(affordable);
   if(selected&&!orders.length)firstOpportunity=selected;
  }
  if(expired())diagnostics.timeLimited=true;
  if(!selected)break;
  const items=selected.items||[equipment.find(e=>e.name===selected.equipmentName)];
  const bundleId=items.length>1?JSON.stringify([selected.member,pass]):undefined;
  for(const equip of items){
   orders.push({...selected,items:undefined,bundleId,equipmentName:equip.name,type:equip.type,cost:equip.cost});
   const member=crew[selected.member]=projectGangMember(crew[selected.member],null,0,equip.stats);
   member[equip.type==='Augmentation'?'augmentations':'upgrades'].push(equip.name);
  }
  remaining.available-=selected.cost;
  if(selected.type==='Augmentation')remaining.augLimit-=selected.cost;else remaining.equipmentLimit-=selected.cost;
  if(selected.reason!=='production')remaining.bootstrapBudget-=selected.cost;
  respectRate+=Math.max(0,selected.respectGain||0);
  if(orders.length>=limit)break;
  if(expired()){diagnostics.timeLimited=true;break;}
  candidates=crewAware?Object.keys(crew).flatMap(candidatesFor):candidates.filter(c=>c.member!==selected.member).concat(candidatesFor(selected.member));
 }
 return {orders,firstOpportunity,diagnostics:{...diagnostics,planningMs:now()-started,planned:orders.length,plannedCost:orders.reduce((sum,o)=>sum+o.cost,0)}};
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
