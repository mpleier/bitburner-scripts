export function sleeveCrimeChance(sleeve, stats, nodeMultiplier = 1) {
  if (!(stats?.difficulty > 0)) return 0;
  const skills = ['hacking','strength','defense','dexterity','agility','charisma'];
  const weighted = skills.reduce((sum,key)=>sum+(Number(stats[key+'_success_weight'])||0)*(Number(sleeve.skills?.[key])||0),0);
  const int = Math.max(0,Number(sleeve.skills?.intelligence)||0);
  const intelligence = 1 + Math.pow(int,0.8)/600;
  return Math.max(0,Math.min(1,(weighted+0.025*int)/975/stats.difficulty*(Number(sleeve.mults?.crime_success)||1)*intelligence*nodeMultiplier));
}
export function bestSleeveCrime(sleeve, crimes, objective = 'money') {
  const reward = stats => Math.max(0, Number(stats?.[objective]) || 0);
  return Object.entries(crimes).filter(([,stats])=>stats?.time>0 && reward(stats)>0)
    .sort((a,b)=>sleeveCrimeChance(sleeve,b[1])*reward(b[1])/b[1].time-sleeveCrimeChance(sleeve,a[1])*reward(a[1])/a[1].time)[0]?.[0] || (objective === 'karma' ? 'Homicide' : 'Mug');
}
export function bestFactionWork(sleeve, types) {
  const s=sleeve.skills||{}, combat=['strength','defense','dexterity','agility'].reduce((sum,k)=>sum+(Number(s[k])||0),0);
  const scores={hacking:Number(s.hacking)||0,field:((Number(s.hacking)||0)+(Number(s.charisma)||0)+combat)/6,security:combat/4};
  return [...types].sort((a,b)=>(scores[b]||0)-(scores[a]||0))[0];
}
export function sleeveRepAssignments(sleeves, targets, work, followIndex, bladeburner, actualTasks = [], followTarget = null) {
  const assignments={},used=new Set();
  const ready=i=>sleeves[i]?.shock===0 && sleeves[i]?.sync>=100;
  const assign=(i,target)=>{
    if(!target || used.has(target.type+':'+target.name))return;
    const workType=target.type==='FACTION'?bestFactionWork(sleeves[i],target.workTypes||[]):null;
    if(target.type==='FACTION'&&!workType)return;
    assignments[i]={...target,workType};used.add(target.type+':'+target.name);
  };
  const eligible=i=>ready(i)&&!(bladeburner&&i>=1&&i<=3);
  const allTargets=followTarget ? [followTarget,...targets.filter(t=>t.type!==followTarget.type||t.name!==followTarget.name)] : targets;
  const desiredFollow=allTargets.find(t=>t.type===work?.type&&t.name===(work.factionName||work.companyName));
  const followOccupied=desiredFollow && actualTasks.some((t,i)=>i!==followIndex&&eligible(i)&&t?.type===desiredFollow.type&&(t.factionName||t.companyName)===desiredFollow.name);
  // Retain existing owners so two sleeves cannot deadlock while swapping employers.
  for(let i=0;i<sleeves.length;i++)if(eligible(i)) {
    if(i===followIndex&&desiredFollow&&!followOccupied)continue;
    const actual=actualTasks[i];
    const name=actual?.factionName||actual?.companyName;
    assign(i,allTargets.find(t=>t.type===actual?.type&&t.name===name));
  }
  if(eligible(followIndex)&&!assignments[followIndex]&&['FACTION','COMPANY'].includes(work?.type))
    assign(followIndex,allTargets.find(t=>t.type===work.type&&t.name===(work.factionName||work.companyName)));
  for(let i=0;i<sleeves.length;i++)if(ready(i)&&!assignments[i]&&!(bladeburner&&i>=1&&i<=3))
    for(const target of targets)if(!used.has(target.type+':'+target.name)){assign(i,target);if(assignments[i])break;}
  return assignments;
}
export function purchaseSleeveAugBatch(ns,index,names,budget,reserve,claim = () => true,allowed = () => true,diagnostics=false) {
  let spent=0;const purchased=[],skipped=[];
  const receipt=()=>diagnostics?{spent,purchased,skipped}:{spent,purchased};
  const skip=(name,reason)=>skipped.push({name,reason});
  if (!Number.isFinite(budget) || budget <= 0) return receipt();
  reserve = Math.max(0, Number(reserve) || 0);
  if(ns.sleeve.getSleeve(index).shock>0){skip(null,'shock recovery required');return receipt();}
  for(const name of names){
    if(!allowed()){skip(name,'control paused or maintenance active');break;}
    if(ns.sleeve.getSleeve(index).shock>0){skip(name,'shock recovery required');break;}
    const item=ns.sleeve.getSleevePurchasableAugs(index).find(aug=>aug.name===name);
    const currentReserve=Math.max(0,reserve,Number(ns.read('reserve.txt'))||0);
    if(!item){skip(name,'augmentation no longer offered');continue;}
    if(!(item.cost>0)||!Number.isFinite(item.cost)){skip(name,'invalid price');continue;}
    if(item.cost>budget-spent){skip(name,'batch budget exhausted');continue;}
    if(ns.getPlayer().money<item.cost+currentReserve){skip(name,'cash reserve');continue;}
    if(!claim(ns,'sleeves',item.cost)){skip(name,'shared spending allowance or cash-spending restriction');continue;}
    if(ns.sleeve.purchaseSleeveAug(index,name)){spent+=item.cost;purchased.push(name);}
    else skip(name,'native purchase rejected');
  }
  return receipt();
}

export function sleeveTaskMatches(actual, command, args) {
  if(!actual)return false;
  if(command.includes('setToShockRecovery'))return actual.type==='RECOVERY';
  if(command.includes('setToSynchronize'))return actual.type==='SYNCHRO';
  if(command.includes('setToCommitCrime'))return actual.type==='CRIME'&&actual.crimeType===args[1];
  if(command.includes('setToFactionWork'))return actual.type==='FACTION'&&actual.factionName===args[1]&&actual.factionWorkType===args[2];
  if(command.includes('setToCompanyWork'))return actual.type==='COMPANY'&&actual.companyName===args[1];
  if(command.includes('setToBladeburnerAction')) {
    if(args[1]==='Infiltrate Synthoids')return actual.type==='INFILTRATE';
    if(args[1]==='Support main sleeve')return actual.type==='SUPPORT';
    if(args[1]==='Take on contracts')return actual.type==='BLADEBURNER'&&actual.actionType==='Contracts'&&actual.actionName===args[2];
    return actual.type==='BLADEBURNER'&&actual.actionType==='General'&&actual.actionName===args[1];
  }
  if(command.includes('setToGymWorkout'))return actual.type==='CLASS'&&actual.location===args[1]&&String(actual.classType).toLowerCase().includes(String(args[2]).toLowerCase());
  if(command.includes('setToUniversityCourse'))return actual.type==='CLASS'&&actual.location===args[1]&&actual.classType===args[2];
  return false;
}
export function maximumSleeves(reset) {
  const sf=typeof reset.ownedSF?.get==='function'?reset.ownedSF.get(10):reset.ownedSF?.[10];
  return 5 + Math.min(3, Math.max(0, Math.floor(Number(sf) || 0)) + (reset.currentNode === 10 ? 1 : 0));
}

/** Explicit reserves may increase, but never reduce, the shared wallet reserve. */
export function sleeveReserves(options, globalReserve) {
  const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const reserve = Math.max(finite(globalReserve), finite(options.reserve));
  return {reserve, trainingReserve:Math.max(reserve,finite(options['training-reserve']))};
}


export function sleeveControlAllowed(ns,parent,script) {
 if(!ns.isRunning(parent)||ns.read('remote-control/paused/'+script+'.txt').trim()==='true')return false;
 try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return false;}catch{}
 return true;
}
export function sleeveOptionsError(o) {
 for(const name of ['min-shock-recovery'])if(!Number.isFinite(o[name])||o[name]<0||o[name]>100)return name+' must be between 0 and 100';
 for(const name of ['shock-recovery','homicide-chance-threshold','aug-budget'])if(!Number.isFinite(o[name])||o[name]<0||o[name]>1)return name+' must be between 0 and 1';
 for(const name of ['buy-cooldown','training-cap-seconds','failed-bladeburner-contract-cooldown','train-to-strength','train-to-defense','train-to-dexterity','train-to-agility','study-to-hacking','study-to-charisma'])if(!Number.isFinite(o[name])||o[name]<0)return name+' must be finite and nonnegative';
 for(const name of ['reserve','training-reserve'])if(o[name]!=null&&(!Number.isFinite(o[name])||o[name]<0))return name+' must be finite and nonnegative';
 if(!Number.isSafeInteger(o['min-aug-batch'])||o['min-aug-batch']<1)return 'min-aug-batch must be a positive integer';
 return null;
}


/** Match the allocator's current epoch and reset rules before planning a batch. */
export function sleeveAugSpendingBudget(ns,requested) {
 const budget=Math.max(0,Number(requested)||0);
 let plan;try{plan=JSON.parse(ns.read('tasks/spending-plan.json'));}catch{return budget;}
 if(!plan||!Number.isFinite(plan.expiresAt)||!plan.allowances||plan.expiresAt<=Date.now()||!ns.isRunning(plan.ownerPid)||plan.reset!==ns.getResetInfo().lastAugReset)return budget;
 let usage;try{usage=JSON.parse(ns.read('tasks/spending-usage.json'));}catch{}
 const used=usage?.epoch===plan.epoch?Math.max(0,Number(usage.spent?.sleeves)||0):0;
 return Math.min(budget,Math.max(0,(Number(plan.allowances.sleeves)||0)-used));
}
