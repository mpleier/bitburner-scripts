export function sleeveCrimeChance(sleeve, stats, nodeMultiplier = 1) {
  if (!(stats?.difficulty > 0)) return 0;
  const skills = ['hacking','strength','defense','dexterity','agility','charisma'];
  const weighted = skills.reduce((sum,key)=>sum+(Number(stats[key+'_success_weight'])||0)*(Number(sleeve.skills?.[key])||0),0);
  const int = Math.max(0,Number(sleeve.skills?.intelligence)||0);
  const intelligence = 1 + Math.pow(int,0.8)/600;
  return Math.max(0,Math.min(1,(weighted+0.025*int)/975/stats.difficulty*(Number(sleeve.mults?.crime_success)||1)*intelligence*nodeMultiplier));
}
export function bestSleeveCrime(sleeve, crimes, objective = 'money',nodeMultiplier=1) {
  const reward = stats => Math.max(0, Number(stats?.[objective]) || 0);
  return Object.entries(crimes).filter(([,stats])=>stats?.time>0 && reward(stats)>0)
    .sort((a,b)=>sleeveCrimeChance(sleeve,b[1],nodeMultiplier)*reward(b[1])/b[1].time-sleeveCrimeChance(sleeve,a[1],nodeMultiplier)*reward(a[1])/a[1].time)[0]?.[0] || (objective === 'karma' ? 'Homicide' : 'Mug');
}
/** Native reputation expressions; common favor, faction and intelligence multipliers cancel for one faction. */
export function bestFactionWork(sleeve, types,context={}) {
  const s=sleeve.skills||{},stat=k=>Math.max(0,Number(s[k])||0);
  const combat=['strength','defense','dexterity','agility'].reduce((sum,k)=>sum+stat(k),0);
  const hacking=stat('hacking'),intelligence=stat('intelligence'),charisma=stat('charisma');
  const share=Number.isFinite(context.shareBonus)&&context.shareBonus>=1?context.shareBonus:1;
  const darknet=Number(context.sf15Level)>=3;
  const scores={hacking:(hacking+intelligence/3+(darknet?charisma*.1:0))/975*share,
    field:.9*(combat+charisma+(hacking+intelligence+(darknet?charisma*.3:0))*share)/975/5.5,
    security:.9*(combat+(darknet?charisma*.3:0)+(hacking+intelligence)*share)/975/4.5};
  return types.filter(t=>Object.hasOwn(scores,t)).sort((a,b)=>scores[b]-scores[a])[0];
}

export function sleeveRepAssignments(sleeves, targets, work, followIndex, bladeburner, actualTasks = [], followTarget = null, prioritizeCritical = false,repContext={}) {
  const assignments={},used=new Set();
  const ready=i=>sleeves[i]?.shock===0 && sleeves[i]?.sync>=100;
  const assign=(i,target)=>{
    if(!target || used.has(target.type+':'+target.name))return;
    const workType=target.type==='FACTION'?bestFactionWork(sleeves[i],target.workTypes||[],repContext):null;
    if(target.type==='FACTION'&&!workType)return;
    assignments[i]={...target,workType};used.add(target.type+':'+target.name);
  };
  const eligible=i=>ready(i)&&!(bladeburner&&i>=1&&i<=3);
  const allTargets=followTarget ? [followTarget,...targets.filter(t=>t.type!==followTarget.type||t.name!==followTarget.name)] : targets;
  const desiredFollow=allTargets.find(t=>t.type===work?.type&&t.name===(work.factionName||work.companyName));
  const followOccupied=desiredFollow && actualTasks.some((t,i)=>i!==followIndex&&eligible(i)&&t?.type===desiredFollow.type&&(t.factionName||t.companyName)===desiredFollow.name);
  // A WD milestone (notably Red Pill reputation) must get a sleeve even when other jobs occupy all sleeves.
  if(prioritizeCritical)for(const target of targets.filter(t=>t.priority===0)) {
    let index=sleeves.findIndex((s,i)=>eligible(i)&&!assignments[i]&&actualTasks[i]?.type===target.type&&(actualTasks[i]?.factionName||actualTasks[i]?.companyName)===target.name);
    if(index<0)index=sleeves.findIndex((s,i)=>eligible(i)&&!assignments[i]);
    if(index>=0)assign(index,target);
  }
  // Retain existing owners so two sleeves cannot deadlock while swapping employers.
  for(let i=0;i<sleeves.length;i++)if(eligible(i)) {
    if(assignments[i]||i===followIndex&&desiredFollow&&!followOccupied)continue;
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
export function purchaseSleeveAugBatch(ns,index,names,budget,reserve,claim = () => true,allowed = () => true,diagnostics=false,requireWholeBatch=false) {
  let spent=0;const purchased=[],skipped=[];
  const receipt=()=>diagnostics?{spent,purchased,skipped}:{spent,purchased};
  const skip=(name,reason)=>skipped.push({name,reason});
  if (!Number.isFinite(budget) || budget <= 0) return receipt();
  reserve = Math.max(0, Number(reserve) || 0);
  if(ns.sleeve.getSleeve(index).shock>0){skip(null,'shock recovery required');return receipt();}
  if(requireWholeBatch){
    if(!allowed()){skip(null,'control paused or maintenance active');return receipt();}
    const offered=ns.sleeve.getSleevePurchasableAugs(index),unique=new Set(names);let total=0;
    if(unique.size!==names.length||!names.length){skip(null,'invalid batch');return receipt();}
    for(const name of names){const item=offered.find(a=>a.name===name);if(!item||!Number.isFinite(item.cost)||item.cost<=0){skip(name,'complete batch no longer offered');return receipt();}total+=item.cost;}
    if(total>budget){skip(null,'batch budget exhausted');return receipt();}
    if(ns.getPlayer().money<total+Math.max(reserve,Number(ns.read('reserve.txt'))||0)){skip(null,'cash reserve');return receipt();}
    if(!claim(ns,'sleeves',total)){skip(null,'shared spending allowance or cash-spending restriction');return receipt();}
  }
  for(const name of names){
    if(!allowed()){skip(name,'control paused or maintenance active');break;}
    if(ns.sleeve.getSleeve(index).shock>0){skip(name,'shock recovery required');break;}
    const item=ns.sleeve.getSleevePurchasableAugs(index).find(aug=>aug.name===name);
    const currentReserve=Math.max(0,reserve,Number(ns.read('reserve.txt'))||0);
    if(!item){skip(name,'augmentation no longer offered');continue;}
    if(!(item.cost>0)||!Number.isFinite(item.cost)){skip(name,'invalid price');continue;}
    if(item.cost>budget-spent){skip(name,'batch budget exhausted');continue;}
    if(ns.getPlayer().money<item.cost+currentReserve){skip(name,'cash reserve');continue;}
    if(!requireWholeBatch&&!claim(ns,'sleeves',item.cost)){skip(name,'shared spending allowance or cash-spending restriction');continue;}
    if(ns.sleeve.purchaseSleeveAug(index,name)){spent+=item.cost;purchased.push(name);}
    else {skip(name,'native purchase rejected');if(requireWholeBatch)break;}
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


/** Keep support stable and add only enough healthy sleeves to cover a live Black Op shortfall. */
export function sleeveBladeburnerSupport(sleeves,actualTasks,plan) {
 const ready=i=>sleeves[i]?.shock===0&&sleeves[i]?.sync>=100;
 const existing=sleeves.map((_,i)=>i).filter(i=>actualTasks[i]?.type==='SUPPORT');
 if(plan?.state==='protected-black-op')return existing.filter(ready);
 if(!['needs-recruitment','ready'].includes(plan?.state)||!Number.isInteger(plan.required)||!Number.isInteger(plan.available)||plan.required<0||plan.available<0)return [];
 const humans=Math.max(0,plan.available-existing.length),needed=Math.max(0,plan.required-humans);
 const cost=i=>['FACTION','COMPANY'].includes(actualTasks[i]?.type)?2:actualTasks[i]?.type==='BLADEBURNER'&&actualTasks[i]?.actionType==='Contracts'?1:0;
 const available=sleeves.map((_,i)=>i).filter(i=>ready(i)&&!existing.includes(i)).sort((a,b)=>cost(a)-cost(b)||a-b);
 const eligible=[...existing.filter(ready),...available];
 return eligible.slice(0,needed);
}

/** Opening milestones take precedence over paid training and optional reputation work. */
export function sleeveStartupPlan({sleeves=[],tasks=[],crimes={},money=0,casinoPending=true,
  gangAvailable=false,inGang=false,karma=0,intelligence=0,previousWorkers=[],enabled=true,nodeMultiplier=1}) {
  const assignments={},result={stage:'normal',urgent:false,assignments,workers:[]};
  if(!enabled)return result;
  const rate=(s,objective)=>{
    const name=bestSleeveCrime(s,crimes,objective,nodeMultiplier),stats=crimes[name];
    return stats?.time>0?sleeveCrimeChance(s,stats,nodeMultiplier)*Math.max(0,Number(stats[objective])||0)/(stats.time/1000):0;
  };
  if(casinoPending&&money<300000){
    result.stage='casino-seed';result.urgent=true;
    for(let i=0;i<sleeves.length;i++)assignments[i]='money';
    result.workers=sleeves.map((_,i)=>i);return result;
  }
  if(gangAvailable&&!inGang&&karma>-54000){
    result.stage='gang-karma';result.urgent=true;
    const full=sleeves.map(s=>rate(s,'karma'));
    const rates=sleeves.map((s,i)=>full[i]*Math.max(0,Math.min(100,Number(s.sync)||0))/100);
    const remaining=Math.max(0,54000+karma);
    // Enumerate at most 256 subsets for the native maximum of eight sleeves.
    // Cost = gang ETA plus mean extra recovery time caused by postponing recovery.
    const evaluate=workers=>{
      const total=workers.reduce((sum,i)=>sum+rates[i],0);
      if(!(total>0))return {workers,eta:Infinity,score:Infinity};
      const eta=remaining/total;
      const debt=workers.reduce((sum,i)=>{
        const s=sleeves[i],int=Math.max(0,Number(s.skills?.intelligence)||0);
        const bonus=1+.75*Math.pow(int,.8)/600;
        const shock=Math.max(0,Number(s.shock)||0),passive=.0005*bonus,recovery=.0015*bonus;
        return sum+(Math.max(0,shock-passive*eta)-Math.max(0,shock-recovery*eta))/recovery;
      },0)/Math.max(1,sleeves.length);
      return {workers,eta,score:eta+debt};
    };
    const mandatory=sleeves.map((s,i)=>i).filter(i=>sleeves[i].shock===0&&sleeves[i].sync>=100&&rates[i]>0);
    let best=evaluate([]);
    for(let mask=1;mask<(1<<Math.min(8,sleeves.length));mask++){
      const candidate=evaluate([...new Set([...mandatory,...sleeves.map((_,i)=>i).filter(i=>mask&(1<<i))])]);
      if(candidate.score<best.score)best=candidate;
    }
    const prior=evaluate([...new Set([...mandatory,...previousWorkers.filter(i=>Number.isInteger(i)&&i>=0&&i<sleeves.length)])]);
    if(Number.isFinite(prior.score)&&prior.score<=best.score*1.02)best=prior;
    let workers=best.workers;
    if(!workers.length&&sleeves.length){
      const index=full.indexOf(Math.max(...full));workers=[index];
    }
    result.workers=workers;result.etaSeconds=Number.isFinite(best.eta)?best.eta:null;
    let synchronize=null;
    for(let i=0;i<sleeves.length;i++){
      const sleeve=sleeves[i];
      if(!workers.includes(i)){assignments[i]=sleeve.shock>0?'recovery':sleeve.sync<100?'sync':'karma';continue;}
      const sync=Math.max(0,Math.min(100,Number(sleeve.sync)||0));
      const int=Math.max(0,Number(sleeve.skills?.intelligence)||intelligence||0);
      const syncPerSecond=.001*(1+.5*Math.pow(int,.8)/600);
      const syncSeconds=(100-sync)/syncPerSecond;
      const other=workers.reduce((sum,j)=>sum+(j===i?0:rates[j]),0);
      const current=other+rates[i];
      const leftAfterSync=Math.max(0,remaining-other*syncSeconds);
      const after=other+full[i];
      const syncEta=other>0&&remaining<=other*syncSeconds?remaining/other:syncSeconds+(after>0?leftAfterSync/after:Infinity);
      const worthSync=sync<100&&full[i]>0&&(current<=0||syncEta<remaining/current*.95);
      assignments[i]='karma';
      if(worthSync&&(!synchronize||syncEta<synchronize.eta))synchronize={index:i,eta:syncEta};
    }
    // Synchronize at most one productive worker at a time; the others keep earning the modeled karma.
    if(synchronize){assignments[synchronize.index]='sync';result.etaSeconds=Number.isFinite(synchronize.eta)?synchronize.eta:null;}
    return result;
  }
  // Outside urgent milestones, remove shock for augmentation access and restore useful XP/rep output.
  for(let i=0;i<sleeves.length;i++){
    if(sleeves[i].shock>0)assignments[i]='recovery';
    else if(sleeves[i].sync<100)assignments[i]='sync';
  }
  if(Object.keys(assignments).length)result.stage='conditioning';
  return result;
}

/** Assign only useful analysis/diplomacy; healthy spare sleeves develop the blocked Black Op. */
export function sleeveBladeburnerTasks(sleeves,tasks,plan,support=[],combatEnabled=true) {
 const assignments={};
 if(!plan||!Number.isFinite(plan.chaos)||!Number.isFinite(plan.threshold)||plan.threshold<=0||plan.threshold>1)return assignments;
 const eligible=sleeves.map((s,i)=>i).filter(i=>sleeves[i].shock===0&&sleeves[i].sync>=100&&!support.includes(i)&&!['FACTION','COMPANY'].includes(tasks[i]?.type));
 const take=(action)=>{
  const index=eligible.find(i=>tasks[i]?.type==='BLADEBURNER'&&tasks[i]?.actionName===action)??eligible[0];
  if(index===undefined)return;
  eligible.splice(eligible.indexOf(index),1);assignments[index]=action;
 };
 const chaosWorkers=plan.chaos>50?Math.min(eligible.length,Math.ceil((plan.chaos-50)/25)):0;
 for(let n=0;n<chaosWorkers;n++)take('Diplomacy');
 const chance=plan.chance,known=Array.isArray(chance)&&chance.length===2&&chance.every(Number.isFinite)&&chance[0]>=0&&chance[1]>=chance[0]&&chance[1]<=1;
 const blocked=plan.rankReady&&known&&chance[0]<plan.threshold;
 const uncertain=blocked&&chance[1]>=plan.threshold&&chance[1]-chance[0]>.01;
 if(uncertain)take('Field Analysis');
 const lowCounts=Object.values(plan.counts||{}).some(n=>Number.isFinite(n)&&n<20);
 if(lowCounts||!blocked||uncertain)take('Infiltrate Synthoids');
 for(const i of eligible)assignments[i]=blocked&&!uncertain&&combatEnabled?'combat-xp':'Infiltrate Synthoids';
 return assignments;
}
