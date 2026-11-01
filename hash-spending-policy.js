/** Native-safe hash decisions. Self-contained for serialization into low-RAM helpers. */
export function hashSpendingDecision(ns,action,options={}) {
 const now=Date.now(),read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},reset=ns.getResetInfo();
 const processes=ns.ps('home'),alive=pid=>processes.some(p=>p.pid===pid);
 const hashes=ns.hacknet.numHashes(),capacity=ns.hacknet.hashCapacity(),cashPerHash=250000;
 const result=(allowed,reason,extra={})=>({nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,allowed,reason,budget:allowed?hashes:0,hashes,capacity,cashPerHash,...extra});
 if(options.ownerPid&&!alive(options.ownerPid))return result(false,'Owner exited');
 if(options.script&&ns.read('remote-control/paused/'+options.script+'.txt').trim()==='true')return result(false,'Controller paused');
 const maintenance=read('tasks/automation-maintenance.json');
 if(maintenance?.expiresAt>now&&alive(maintenance.ownerPid)){
  const independent=['gangs.js','stockmaster.js','go.js','health-manager.js','stats.js','infiltration-manager.js'];
  if(['Exchange for Bladeburner Rank','Exchange for Bladeburner SP'].includes(action))independent.push('corporation-manager.js');
  if(!Array.isArray(maintenance.scripts)||!maintenance.scripts.length||!maintenance.scripts.every(s=>typeof s==='string'&&independent.includes(s.replace(/^\//,''))))return result(false,'Automation maintenance');
 }
 let cashAllowed=true,corporationAllowed=true;
 for(const [file,active]of [['tasks/achievement-profile.json',true],['tasks/achievement-goals.json',false]]){
  const p=read(file);if(p?.nodeReset===reset.lastNodeReset&&(active?p.active:p.expiresAt>now&&alive(p.ownerPid))&&p.deniedActions?.includes('hacknetMoney'))cashAllowed=false;
  if(p?.nodeReset===reset.lastNodeReset&&(active?p.active:p.expiresAt>now&&alive(p.ownerPid))&&p.deniedActions?.includes('corporation'))corporationAllowed=false;
  if(p?.nodeReset===reset.lastNodeReset&&(active?p.active:p.expiresAt>now&&alive(p.ownerPid))&&
   (p.deniedActions?.includes('hashSpending')||action==='Sell for Money'&&p.deniedActions?.includes('hacknetMoney')))return result(false,'Achievement restriction');
 }
 const raw=read('tasks/node-route-plan.json');
 const route=raw?.at<=now&&now-raw.at<45000&&raw.nodeReset===reset.lastNodeReset&&raw.augReset===reset.lastAugReset&&
  processes.some(p=>p.pid===raw.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js')?raw:null;
 const rank='Exchange for Bladeburner Rank',sp='Exchange for Bladeburner SP';
 // A temporary route probe must not authorize rank/SP or corporate spending for the probed route.
 const committedRoute=route?.committed==='hacking'||route?.committed==='bladeburner'?route.committed:route?.selected;
 const costOf=(name,quantity=1)=>{try{return ns.hacknet.hashCost(name,quantity);}catch{return Infinity;}};
 let rankHashCost=null,spHashCost=null;
 let preferred=null,priorityCost=0,priorityReason='No route reserve',rankSpGain=0,probe=false,rankNow=null;
 let rankGap=null,rankSecondsSaved=null,rankSpSecondsSaved=null,spSecondsSaved=null,rankValuePerHash=null,spValuePerHash=null,rankGateReady=false;
 let skillGoal=null,skillShortfall=null,skillGoalEtaSeconds=null,skillFundingPlan=null;
 const goalRecord=read('tasks/hash-skill-goal.json');
 const goalFresh=goalRecord?.schemaVersion===1&&Number.isFinite(goalRecord.at)&&goalRecord.at<=now&&now-goalRecord.at<45000&&
  goalRecord.nodeReset===reset.lastNodeReset&&goalRecord.augReset===reset.lastAugReset&&
  processes.some(p=>p.pid===goalRecord.ownerPid&&p.filename.replace(/^\//,'')==='bladeburner.js');
 if(goalFresh&&goalRecord.state==='no-useful-upgrade'&&Number.isFinite(goalRecord.points)&&goalRecord.points>=0){skillGoal=goalRecord;skillShortfall=0;}
 if(goalFresh&&goalRecord.state==='target'&&typeof goalRecord.name==='string'&&goalRecord.name&&
  Number.isFinite(goalRecord.cost)&&goalRecord.cost>0&&Number.isFinite(goalRecord.level)&&goalRecord.level>=0&&
  Number.isFinite(goalRecord.points)&&goalRecord.points>=0){skillGoal=goalRecord;skillShortfall=Math.max(0,goalRecord.cost-goalRecord.points);}

 const saved=read('tasks/hash-rank-history.json');
 const history=saved?.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset?saved:null;
 if(committedRoute==='bladeburner'&&route.routes?.bladeburner?.etaMs!==0){
  try{
   let bb=typeof options.observeRank==='function'?options.observeRank():null;
   if(!bb){const r=read('tasks/hash-bladeburner-state.json');if(r?.at<=now&&now-r.at<45000&&r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&alive(r.ownerPid))bb=r;}
   if(bb||route.development?.entry?.joined===true){
    rankNow=Number.isFinite(bb?.rank)?bb.rank:null;
    if(skillGoal?.state==='target'&&Number.isFinite(bb?.points)&&bb.points>=0)skillShortfall=Math.max(0,skillGoal.cost-bb.points);
    const rc=costOf(rank),sc=costOf(sp);rankHashCost=Number.isFinite(rc)?rc:null;spHashCost=Number.isFinite(sc)?sc:null;
    const next=route.development?.nextBlackOp;
    const gap=Number.isFinite(next?.requiredRank)&&Number.isFinite(rankNow)?Math.max(0,next.requiredRank-rankNow):
     Number.isFinite(next?.rankGap)?Math.max(0,next.rankGap):0;
    rankGap=gap;
    if(Number.isFinite(rankNow)&&history?.knownMax&&Number.isFinite(history.maxRank)&&history.maxRank>=0)
     rankSpGain=Math.max(0,Math.floor((rankNow+100)/3)-Math.floor(Math.max(rankNow,history.maxRank)/3));
    const rate=route.development?.rankRate;
    const skillRate=Number.isFinite(rate)&&rate>0&&Number.isFinite(rankNow)&&history?.knownMax&&Number.isFinite(history.maxRank)&&history.maxRank>=0&&rankNow>=history.maxRank?rate/3:null;
    rankSecondsSaved=Number.isFinite(rate)&&rate>0&&gap>0?Math.min(100,gap)/rate:null;
    const usefulRankSp=skillShortfall===null?rankSpGain:Math.min(rankSpGain,skillShortfall);
    const usefulDirectSp=skillShortfall===null?10:Math.min(10,skillShortfall);
    rankSpSecondsSaved=skillRate>0?usefulRankSp/skillRate:null;
    spSecondsSaved=skillRate>0?usefulDirectSp/skillRate:null;
    skillGoalEtaSeconds=skillRate>0&&skillShortfall!==null?skillShortfall/skillRate:null;
    // Natural rank work also generates SP: use the larger time saving, never add overlapping savings.
    const rankValue=skillRate>0?Math.max(rankSecondsSaved||0,rankSpSecondsSaved||0):usefulRankSp;
    const spValue=spSecondsSaved??usefulDirectSp;
    rankValuePerHash=Number.isFinite(rc)&&rc>0?rankValue/rc:null;
    spValuePerHash=Number.isFinite(sc)&&sc>0?spValue/sc:null;
    rankGateReady=gap>0&&gap<=100&&next?.safe===true&&next.staminaBlocked!==true;
    probe=skillShortfall!==0&&!history?.probed&&!history?.knownMax&&rc>0&&rc<=sc/2;
    preferred=Number.isFinite(rc)&&rc>0&&(rankGateReady||probe||rankValuePerHash>0&&
     (spValuePerHash===null||rankValuePerHash>=spValuePerHash))?rank:usefulDirectSp>0&&Number.isFinite(sc)&&sc>0?sp:null;
    priorityCost=preferred?costOf(preferred):0;
    priorityReason=preferred===null?'No useful priced Bladeburner reward':rankGateReady&&preferred===rank?'Unlock the next safe BlackOp':
     probe&&preferred===rank?'Bounded rank-yield observation':skillRate>0?'Better rank/SP replacement time per hash':
     preferred===rank?'Cheaper known rank-derived skill points':'Direct skill points have the better known return';
    // Native bulk quotes include every price increase. Enumerate count pairs, not purchase sequences:
    // each reward has its own escalating price, so interleaving does not change the total quote.
    if(skillGoal?.state==='target'&&skillShortfall>0&&!rankGateReady&&!probe){
     const rankKnown=Number.isFinite(rankNow)&&history?.knownMax&&Number.isFinite(history.maxRank)&&history.maxRank>=0;
     const highWater=rankKnown?Math.max(rankNow,history.maxRank):0;
     const requiredRanks=rankKnown?Math.ceil((Math.max(0,highWater-rankNow)+3*skillShortfall)/100):0;
     const limit=Math.min(256,requiredRanks);
     const rankFits=rc>0&&Number.isFinite(rc)&&(rc<=capacity||!(sc<=capacity));
     const spFits=sc>0&&Number.isFinite(sc)&&(sc<=capacity||!(rc<=capacity));
     let best=null;
     for(let ranks=0;ranks<=limit;ranks++){
      if(ranks&&!rankFits)continue;
      const points=ranks&&rankKnown?Math.max(0,Math.floor((rankNow+100*ranks)/3)-Math.floor(highWater/3)):0;
      const skills=Math.max(0,Math.ceil((skillShortfall-points)/10));
      if(skills>4096||skills&&!spFits)continue;
      const rankCost=ranks?costOf(rank,ranks):0,skillCost=skills?costOf(sp,skills):0,total=rankCost+skillCost;
      if(!Number.isFinite(total)||total<=0||rankCost<0||skillCost<0||ranks&&rankCost<=0||skills&&skillCost<=0)continue;
      const excess=points+10*skills-skillShortfall;
      if(!best||total<best.totalHashes||total===best.totalHashes&&(excess<best.excessPoints||
       excess===best.excessPoints&&ranks+skills<best.rankPurchases+best.spPurchases))
       best={rankPurchases:ranks,spPurchases:skills,totalHashes:total,creditedPoints:points+10*skills,excessPoints:excess,completeSearch:requiredRanks<=256};
     }
     if(best){
      skillFundingPlan=best;
      // Recheck the full combination after each single native purchase or change in live SP.
      preferred=best.rankPurchases&&(!best.spPurchases||rc<=sc)?rank:sp;
      priorityCost=costOf(preferred);
      priorityReason=(best.completeSearch?'Lowest quoted upgrade funding cost':'Bounded upgrade funding comparison')+
       ': '+best.rankPurchases+' rank + '+best.spPurchases+' SP purchases for '+best.totalHashes+' hashes';
     }
    }
    if(skillGoal&&preferred&&!rankGateReady&&!probe)priorityReason+='; next upgrade '+(skillGoal.name||'none')+' needs '+skillShortfall+' SP';
   }
  }catch{preferred=null;priorityCost=0;}
 }
 const playerMoney=ns.getPlayer().money;
 const plan=read('tasks/spending-plan.json'),planFresh=plan?.reset===reset.lastAugReset&&Number.isFinite(plan.epoch)&&plan.epoch<=now&&plan.expiresAt>now&&plan.expiresAt<=now+120000&&processes.some(p=>p.pid===plan.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js');
 const saving=planFresh?plan.signals?.augmentationCashTarget:null;
 // Corporation creation is low priority in the spending plan; hashes are no longer liquidated for it.
 const cashGoal=Number.isFinite(saving?.cost)&&saving.cost>playerMoney?{name:saving.name||'Augmentation',source:'augmentation',cost:saving.cost}:null;
 const cashTarget=cashAllowed?(playerMoney<300000?300000:cashGoal?.cost??null):null;
 const cashPurchasesNeeded=cashTarget===null?0:Math.ceil((cashTarget-playerMoney)/1000000);
 if(cashPurchasesNeeded>0){preferred='Sell for Money';priorityCost=costOf(preferred)*cashPurchasesNeeded;priorityReason=playerMoney<300000?'Casino bootstrap cash':'Reachable augmentation cash target';}
 const corporate=read('tasks/corporation-hash-goal.json'),milestone=corporate?.milestone;
 const corporateFresh=[1,2].includes(corporate?.schemaVersion)&&corporationAllowed&&corporate.priority===true&&ns.read('remote-control/paused/corporation-manager.js.txt').trim()!=='true'&&corporate.nodeReset===reset.lastNodeReset&&corporate.augReset===reset.lastAugReset&&Number.isFinite(corporate.at)&&corporate.at<=now&&now-corporate.at<45000&&
  processes.some(p=>p.pid===corporate.ownerPid&&p.filename.replace(/^\//,'')==='corporation-manager.js');
 const corporateAction=milestone?.action,corporateReward=corporateAction==='Sell for Corporation Funds'?1e9:corporateAction==='Exchange for Corporation Research'?1000:0;
 const corporateCost=corporateReward?costOf(corporateAction):Infinity,unreserved=Math.max(0,playerMoney-Math.max(0,Number(ns.read('reserve.txt'))||0));
 const corporatePurchases=corporateReward&&Number.isFinite(milestone?.gap)?Math.ceil(milestone.gap/corporateReward):0;
 const corporateMaxPurchases=milestone?.staged===true?32:16;
 const corporateTotal=corporatePurchases>=1&&corporatePurchases<=corporateMaxPurchases?costOf(corporateAction,corporatePurchases):Infinity;
 const corporateKey=milestone?JSON.stringify([corporateAction,milestone.label,corporateAction==='Sell for Corporation Funds'&&Number.isFinite(milestone.target)?milestone.target:null]):null;
 const corporateLedger=read('tasks/corporation-hash-budget.json');
 const corporateEntries=corporateLedger?.schemaVersion===1&&corporateLedger.nodeReset===reset.lastNodeReset?corporateLedger.entries||{}:{};
 const corporateUsed=corporateEntries[corporateKey]||{purchases:0,spent:0};
 const corporateLimit=milestone?.staged===true?20000:5000;
 const corporateRemaining=Number.isSafeInteger(corporateUsed.purchases)&&corporateUsed.purchases>=0&&Number.isFinite(corporateUsed.spent)&&corporateUsed.spent>=0&&
  (corporateEntries[corporateKey]||Object.keys(corporateEntries).length<128)&&corporatePurchases<=corporateMaxPurchases-corporateUsed.purchases&&corporateTotal<=corporateLimit-corporateUsed.spent;
 const corporateShape=corporate?.schemaVersion===1?corporatePurchases===1:milestone?.purchases===corporatePurchases&&Number.isFinite(milestone.totalHashes)&&milestone.totalHashes>0&&milestone.totalHashes<=corporateLimit;
 const corporatePriority=corporateFresh&&corporateShape&&corporateRemaining&&corporateReward>0&&milestone.reward===corporateReward&&Number.isFinite(milestone.gap)&&milestone.gap>0&&corporatePurchases<=corporateMaxPurchases&&Number.isFinite(corporateCost)&&corporateCost>0&&Number.isFinite(corporateTotal)&&corporateTotal>0&&corporateTotal<=corporateLimit&&corporateTotal<=hashes&&corporateTotal*cashPerHash<=unreserved*.05;
 if(corporatePriority&&!cashPurchasesNeeded&&!rankGateReady&&route?.routes?.[committedRoute]?.etaMs!==0){preferred=corporateAction;priorityCost=corporateTotal;priorityReason='Fund bounded corporation milestone: '+milestone.label;}
 const cost=action==='__capacity__'?0:costOf(action);
 const common={preferred,cashGoal:cashAllowed?cashGoal:null,cashTarget,cashPurchasesNeeded,rankHashCost,spHashCost,knownMaximumRank:history?.knownMax?Math.max(rankNow||0,history.maxRank):null,priorityCost:Number.isFinite(priorityCost)?priorityCost:null,priorityReason,rankSpGain,probe,rankNow,rankGap,rankSecondsSaved,rankSpSecondsSaved,spSecondsSaved,rankValuePerHash,spValuePerHash,rankGateReady,
  skillGoal:skillGoal?{name:skillGoal.name||null,state:skillGoal.state,cost:skillGoal.cost??null,shortfall:skillShortfall,naturalFundingSeconds:skillGoalEtaSeconds,fundingPlan:skillFundingPlan}:null,
  corporateMilestone:corporatePriority?{key:corporateKey,label:milestone.label,purchases:corporatePurchases,totalHashes:corporateTotal,gap:milestone.gap}:null,
  valueBasis:skillGoal?'Next useful upgrade funding; future skill-effect ETA unmeasured':spSecondsSaved!==null?'Natural rank/SP replacement time; not a skill-upgrade completion ETA':'Known skill points per hash',
  cost:Number.isFinite(cost)?cost:null,cashEquivalent:Number.isFinite(cost)?cost*cashPerHash:null};
 if(action==='__capacity__')return result(!!preferred&&preferred!=='Sell for Money'&&Number.isFinite(priorityCost)&&priorityCost>capacity,'Capacity only for a useful reserved purchase',common);
 if(!Number.isFinite(cost)||cost<=0)return result(false,'Unavailable hash action',common);
 const corporateReserve=milestone?.staged===true&&corporateFresh&&Number.isFinite(corporateTotal)?corporateTotal:0;
 if(corporateReserve>0&&!['Sell for Corporation Funds','Exchange for Corporation Research'].includes(action)&&hashes<corporateReserve+cost)
  return result(false,'Reserving hashes for staged corporation funding',{...common,budget:0});
 let budget=hashes;
 if(options.ignoreRoute!==true&&preferred&&preferred!==action&&priorityCost>0){
  budget=Math.max(0,hashes-Math.min(priorityCost,capacity));
 }
 if([rank,sp].includes(action)&&route?.routes?.bladeburner?.etaMs===0&&options.ignoreRoute!==true)return result(false,'All BlackOps completed',common);
 if([rank,sp].includes(action)&&committedRoute==='hacking'&&options.ignoreRoute!==true)return result(false,'World Daemon route selected',common);
 if(options.automatic!==false&&options.ignoreRoute!==true&&[rank,sp].includes(action)&&(skillGoal||[rank,sp].includes(preferred))&&action!==preferred)
  return result(false,'Prefer '+preferred+' for better progression value',{...common,budget:0});
 if(cost>budget)return result(false,'Saving for '+(preferred||action),{...common,budget});
 if(options.automatic!==false&&action!=='Sell for Money'&&![rank,sp].includes(action)){
  const resetPlan=read('tasks/augmentation-reset-plan.json');
  if(!['Sell for Corporation Funds','Exchange for Corporation Research'].includes(action)&&resetPlan?.pending&&resetPlan.expiresAt>now&&alive(resetPlan.ownerPid))return result(false,'Augmentation reset pending',common);
  const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0),free=Math.max(0,playerMoney-reserve),cashCost=cost*cashPerHash;
  if(action==='Increase Maximum Money'||action==='Reduce Minimum Security'){
   const analysis=read('/Temp/analyze-hack.txt'),meta=read('/Temp/analyze-hack-meta.txt');
   const daemon=processes.find(p=>p.filename.replace(/^\//,'')==='daemon.js');
   if(!daemon||daemon.args.some(a=>['--xp-only','-x','--x','--hack-only','-h'].includes(a)))return result(false,'No ordinary income-mode hacking allocation',common);
   const target=options.target,rate=Array.isArray(analysis)?analysis.find(s=>s.hostname===target)?.gainRate:0;
   if(!(meta?.at<=now&&now-meta.at<300000&&meta.augReset===reset.lastAugReset&&meta.nodeReset===reset.lastNodeReset))return result(false,'Fresh server profitability analysis needed',common);
   // Attribute only currently owned workers; remote inventory errors invalidate the quote.
   let ram=0,inventoryComplete=true;const visited=new Set(),queue=['home'];
   while(queue.length&&visited.size<1024){const host=queue.shift();if(visited.has(host))continue;visited.add(host);
    try{queue.push(...ns.scan(host).filter(h=>!visited.has(h)));for(const p of ns.ps(host)){
     const weak=/weak-target\.js$/.test(p.filename),owner=p.args?.[weak?6:7];
     if(/manualhack-target\.js$/.test(p.filename)&&p.args?.[0]===target&&owner===daemon.pid)inventoryComplete=false;
     if(/^\/?Remote\/(?:hack|grow|weak)-target\.js$/.test(p.filename)&&p.args?.[0]===target&&owner===daemon.pid&&Number.isFinite(p.threads)&&p.threads>0)ram+=ns.getScriptRam(p.filename,host)*p.threads;
    }}catch{inventoryComplete=false;}
   }
   if(queue.length||!inventoryComplete||!(ram>0&&Number.isFinite(rate)&&rate>0))return result(false,'Complete owned income allocation needed',common);
   let projection;
   try{
    const server=ns.getServer(target),player=ns.getPlayer(),f=ns.formulas.hacking,potency=ns.weakenAnalyze(1,1);
    if(!(Number.isFinite(server.moneyMax)&&server.moneyMax>0&&Number.isFinite(server.minDifficulty)&&server.minDifficulty>=1&&potency>0))throw Error('Invalid native inputs');
    const upgraded={...server};
    if(action==='Increase Maximum Money')upgraded.moneyMax=Math.min(1e13,server.moneyMax*1.02);
    else upgraded.minDifficulty=Math.max(1,server.minDifficulty*.98);
    if(upgraded.moneyMax<server.moneyMax||upgraded.moneyMax===server.moneyMax&&upgraded.minDifficulty===server.minDifficulty)return result(false,'Server boost has no conservatively valued effect',common);
    // Same bounded batch model before and after: rounded threads, minimum security, one core.
    const quote=s=>{
     const base={...s,hackDifficulty:s.minDifficulty,moneyAvailable:s.moneyMax};
     const percent=f.hackPercent(base,player),chance=f.hackChance(base,player),time=f.weakenTime(base,player)/1000;
     if(!(Number.isFinite(percent)&&percent>0&&Number.isFinite(chance)&&chance>0&&chance<=1&&Number.isFinite(time)&&time>0))throw Error('No viable native batch');
     let best=null;
     for(const fraction of [.01,.025,.05,.1,.2,.4,.6,.75]){
      const hack=Math.max(1,Math.floor(fraction/percent)),stolen=hack*percent;if(stolen>=.99)continue;
      const grow=Math.ceil(f.growThreads({...base,moneyAvailable:s.moneyMax*(1-stolen)},player,s.moneyMax,1));
      if(!Number.isSafeInteger(grow)||grow<0)continue;
      const weak1=Math.ceil(hack*.002/potency),weak2=Math.ceil(grow*.004/potency);
      const batchRam=hack*1.7+(grow+weak1+weak2)*1.75;
      const income=s.moneyMax*stolen*chance/(batchRam*time);
      if(Number.isFinite(income)&&income>0&&(!best||income>best.income))best={income,hack,grow,weak1,weak2,batchRam,time};
     }
     if(!best)throw Error('No finite native batch');return best;
    };
    const before=quote(server),after=quote(upgraded),relative=Math.max(0,after.income/before.income-1);
    // Calibrate absolute throughput only; an observational ratio is not a measured causal upgrade gain.
    const observation=read('tasks/hacking-income.json'),sample=observation?.targets?.[target];
    const savedPacing=read('tasks/hgw-pacing.json');
    const pacing=savedPacing?.pid===daemon.pid&&savedPacing.at<=now&&now-savedPacing.at<15000?
     [savedPacing.cycleMs,savedPacing.queueMs,savedPacing.targetCap]:null;
    const signature=JSON.stringify([server.moneyMax,server.minDifficulty,player.skills,player.mults,daemon.args,pacing]);
    const context=JSON.stringify([player.skills,player.mults,daemon.args,pacing]);
    const qualified=observation?.version===1&&observation.ownerPid===daemon.pid&&observation.nodeReset===reset.lastNodeReset&&observation.augReset===reset.lastAugReset&&
     observation.at<=now&&now-observation.at<15000&&sample?.signature===signature&&sample.measuredAt<=now&&now-sample.measuredAt<600000&&
     sample.durationSeconds>=120&&sample.completions>=30&&sample.risks===0&&Number.isFinite(sample.incomePerRamSecond)&&sample.incomePerRamSecond>=0&&
     Number.isFinite(sample.ram)&&sample.ram>0&&Math.abs(sample.ram/ram-1)<=.05;
    const calibration=qualified?Math.min(1,sample.incomePerRamSecond/rate):1;
    const benefit=rate*ram*relative*calibration,retuneSeconds=Math.max(before.time,after.time);
    const remaining=options.remainingSeconds===undefined?1800:Math.min(3600,Math.max(0,Number(options.remainingSeconds)));
    const payback=benefit>0?cashCost/benefit+retuneSeconds:null;
    projection={basis:'Native formulas; fixed allocated RAM; one-core rounded batches; one-cycle retuning allowance',relative,estimatedIncomeGain:benefit,paybackSeconds:payback,retuneSeconds,allocatedRam:ram,before,after,calibration:{factor:calibration,context,basis:qualified?'Observed income per RAM-second; downward adjustment only':'Uncalibrated native estimate',observation:qualified?{at:sample.measuredAt,durationSeconds:sample.durationSeconds,completions:sample.completions,incomePerRamSecond:sample.incomePerRamSecond}:null}};
    if(!(Number.isFinite(payback)&&payback<=remaining))return result(false,'Server boost does not repay before the planning horizon',{...common,serverProjection:projection});
   }catch{return result(false,'Native hacking formulas unavailable or invalid; server boost deferred',common);}
   common.serverProjection=projection;
  }else if(action==='Improve Gym Training'||action==='Improve Studying'){
   const mult=action==='Improve Studying'?ns.hacknet.getStudyMult():ns.hacknet.getTrainingMult();
   const seconds=Math.max(0,Number(options.trainingSeconds)||0),savedSeconds=seconds*.2/(mult+.2);
   if(seconds<60||savedSeconds<20||cashCost>free*.01)return result(false,'Training benefit is too small for its cash opportunity cost',{...common,trainingSecondsSaved:savedSeconds});
  }else if(action==='Generate Coding Contract'){
   const validation=read('tasks/contract-validation.json');
   if(!Object.values(validation?.types||{}).some(t=>t.state==='passed'))return result(false,'No verified contract solvers',common);
   const visited=new Set(),queue=['home'];let backlog=0;
   while(queue.length&&visited.size<1024){const host=queue.shift();if(visited.has(host))continue;visited.add(host);try{backlog+=ns.ls(host,'.cct').length;queue.push(...ns.scan(host).filter(h=>!visited.has(h)));}catch{}}
   if(backlog>0||cashCost>free*.001)return result(false,'Solve existing contracts or retain cash first',{...common,contractBacklog:backlog});
  }else if(action==='Sell for Corporation Funds'||action==='Exchange for Corporation Research'){
   if(corporate?.schemaVersion===2&&!corporatePriority)return result(false,'Corporate milestone is stale, unaffordable, or exceeds its bounded quote',common);
   if(options.corporationUseful!==true||cashCost>free*(corporatePriority&&corporateAction===action ? .05 : .01))return result(false,'No near-term corporate milestone worth the cash opportunity cost',common);
  }
 }
 return result(cost<=budget,cost<=budget?'Purchase fits the shared hash budget':'Saving for '+preferred,{...common,budget});
}

/** Recheck immediately before synchronous mutation and record observed rank/SP yields. */
export function spendHashesWithPolicy(ns,action,target,quantity=1,options={},decide=hashSpendingDecision) {
 const decision=decide(ns,action,{...options,target});
 const record={at:Date.now(),pid:options.ownerPid||ns.pid,script:options.script||'hash-worker',action,target:target??null,quantity,...decision};
 const finish=(success,spent=0)=>{
  const receipt={...record,success,spent};
  // Native reads and writes are synchronous: no await separates the successful
  // mutation and this bounded journal update, including across competing owners.
  if(success)try{
   if(record.corporateMilestone&&['Sell for Corporation Funds','Exchange for Corporation Research'].includes(action)){
    let saved;try{saved=JSON.parse(ns.read('tasks/corporation-hash-budget.json'));}catch{}
    const entries=saved?.schemaVersion===1&&saved.nodeReset===record.nodeReset?saved.entries||{}:{};
    const key=record.corporateMilestone.key,used=entries[key]||{purchases:0,spent:0};
    entries[key]={purchases:used.purchases+quantity,spent:used.spent+spent,at:record.at};
    ns.write('tasks/corporation-hash-budget.json',JSON.stringify({schemaVersion:1,nodeReset:record.nodeReset,entries}),'w');
   }
   let old;try{old=JSON.parse(ns.read('tasks/hash-purchases.json'));}catch{}
   if(old?.schemaVersion!==1||old.nodeReset!==record.nodeReset||!Number.isFinite(old.spent)||!Number.isSafeInteger(old.purchases)||!Array.isArray(old.recent))old=null;
   const totals=old?.totals||{},prior=totals[action]||{purchases:0,spent:0};
   const event={id:(old?.sequence||0)+1,at:record.at,pid:record.pid,script:record.script,action,target:record.target,quantity,spent,nodeReset:record.nodeReset,augReset:record.augReset,goal:record.cashGoal??record.corporateMilestone??null,
    ...(record.effect?{effect:record.effect}:{})};
   totals[action]={purchases:prior.purchases+quantity,spent:prior.spent+spent,lastAt:record.at};
   ns.write('tasks/hash-purchases.json',JSON.stringify({schemaVersion:1,nodeReset:record.nodeReset,startedAt:old?.startedAt||record.at,at:record.at,
    sequence:event.id,purchases:(old?.purchases||0)+quantity,spent:(old?.spent||0)+spent,totals,recent:[...(old?.recent||[]),event].slice(-64)}),'w');
  }catch(error){receipt.monitorError=String(error);ns.print?.('Hash purchase succeeded; monitor write failed: '+String(error));}
  try{ns.write('tasks/hash-spending-'+(options.ownerPid||ns.pid)+'.json',JSON.stringify(receipt),'w');}catch(error){receipt.monitorError=String(error);}
  return receipt;
 };
 if(!decision.allowed||!Number.isSafeInteger(quantity)||quantity<1)return finish(false);
 if(options.automatic!==false&&quantity!==1&&['Increase Maximum Money','Reduce Minimum Security'].includes(action))return finish(false); // Requote each scaling server upgrade.
 if(options.automatic!==false&&quantity!==1&&['Sell for Corporation Funds','Exchange for Corporation Research'].includes(action))return finish(false);
 let cost;try{cost=ns.hacknet.hashCost(action,quantity);}catch{return finish(false);}
 if(!Number.isFinite(cost)||cost>decision.budget||cost>ns.hacknet.numHashes())return finish(false);
 let beforeRank=null,beforeSp=null;
 if(action==='Exchange for Bladeburner Rank'&&typeof options.observeRank==='function')try{const r=options.observeRank();if(Number.isFinite(r?.rank)&&Number.isFinite(r?.points)){beforeRank=r.rank;beforeSp=r.points;}}catch{}
 let corporateBefore;try{if(typeof options.observeCorporation==='function')corporateBefore=options.observeCorporation();}catch{}
 const beforeMoney=ns.getPlayer().money,before=ns.hacknet.numHashes(),success=ns.hacknet.spendHashes(action,target,quantity);
 if(success)try{
  if(action==='Sell for Money')record.effect={playerMoney:ns.getPlayer().money-beforeMoney};
  if(corporateBefore&&typeof options.observeCorporation==='function'){
   const after=options.observeCorporation();
   record.effect={corporationFunds:after.funds-corporateBefore.funds,research:Object.fromEntries(Object.entries(after.research||{}).slice(0,32).map(([name,points])=>[name,points-(corporateBefore.research?.[name]??points)]))};
  }
 }catch{ /* Observability must never replay a successful native purchase. */ }
 if(success&&decision.serverProjection)try{
  // Journal observed baseline and native target change without replaying successful purchases on write failures.
  const r=ns.getResetInfo(),server=ns.getServer(target);let old;
  try{old=JSON.parse(ns.read('tasks/hash-server-upgrades.json'));}catch{}
  const entries=old?.nodeReset===r.lastNodeReset&&old.augReset===r.lastAugReset&&Array.isArray(old.entries)?old.entries:[];
  ns.write('tasks/hash-server-upgrades.json',JSON.stringify({nodeReset:r.lastNodeReset,augReset:r.lastAugReset,entries:[...entries,
   {at:Date.now(),action,target,quantity,moneyMax:server.moneyMax,minDifficulty:server.minDifficulty,projection:decision.serverProjection}].slice(-32)}),'w');
 }catch{}
 if(success&&beforeRank!==null)try{
  const r=ns.getResetInfo(),observation=options.observeRank(),rank=observation.rank,gain=observation.points-beforeSp;
  record.observedSpGain=gain;record.observedRankGain=rank-beforeRank;
  let old;try{old=JSON.parse(ns.read('tasks/hash-rank-history.json'));}catch{}
  if(old?.nodeReset!==r.lastNodeReset||old.augReset!==r.lastAugReset)old=null;
  // A zero yield above our recorded high-water mark disproves that mark; stop speculative SP credit.
  const knownMax=gain>0||old?.knownMax===true&&rank<=old.maxRank;
  ns.write('tasks/hash-rank-history.json',JSON.stringify({at:Date.now(),nodeReset:r.lastNodeReset,augReset:r.lastAugReset,probed:true,knownMax,
   maxRank:knownMax?Math.max(rank,old?.maxRank||0):null,lastRank:rank,observedSpGain:gain,observedRankGain:rank-beforeRank}),'w');
 }catch{}
 return finish(success,success?Math.max(0,before-ns.hacknet.numHashes()):0);
}

/** Match requested capabilities, not a filename alone. */
export function hasBladeburnerHashWorker(processes) {
 return processes.some(p=>p.filename.replace(/^\//,'')==='spend-hacknet-hashes.js'&&
  ['Exchange for Bladeburner Rank','Exchange for Bladeburner SP'].every(action=>p.args.some(a=>String(a).replaceAll('_',' ')===action)));
}

/** Bounded read-only diagnostics for both the API and existing dashboard readers. */
export function collectHashSpendingStatus(ns,now=Date.now()){
 try{
  const reset=ns.getResetInfo(),pids=new Set(ns.ps('home').map(p=>p.pid));
  return ns.ls('home','tasks/hash-').filter(f=>(f.startsWith('tasks/hash-spending-')||f.startsWith('tasks/hash-worker-status-'))&&f.endsWith('.json'))
   .map(f=>{try{return JSON.parse(ns.read(f));}catch{return null;}})
   .filter(s=>s&&s.at<=now&&now-s.at<120000&&s.nodeReset===reset.lastNodeReset&&s.augReset===reset.lastAugReset&&pids.has(s.pid))
   .sort((a,b)=>b.at-a.at).slice(0,24);
 }catch{return [];}
}

/** Successful native purchases survive blocked attempts, restarts and augmentation installs. */
export function readHashPurchaseMonitor(ns,now=Date.now()){
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}},reset=ns.getResetInfo(),journal=read('tasks/hash-purchases.json');
 const valid=journal?.schemaVersion===1&&journal.nodeReset===reset.lastNodeReset&&journal.at<=now&&Array.isArray(journal.recent);
 let processes=[],files=[],hashes=null,capacity=null;
 try{processes=ns.ps('home');files=ns.ls('home','tasks/hash-');}catch{}
 try{hashes=ns.hacknet.numHashes();capacity=ns.hacknet.hashCapacity();}catch{}
 const live=new Set(processes.map(p=>p.pid));
 const workers=files.filter(f=>/^tasks\/hash-(?:spending|worker-status)-[^/]+\.json$/.test(f))
  .map(read).filter(r=>r&&r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&r.at<=now&&now-r.at<120000&&live.has(r.pid))
  .sort((a,b)=>b.at-a.at).slice(0,12).map(r=>({at:r.at,pid:r.pid,action:r.action||r.actions?.join(', '),state:r.state,success:r.success,
   reason:r.reason||r.decision?.reason,preferred:r.preferred??r.decision?.preferred,cashGoal:r.cashGoal??r.decision?.cashGoal??null}));
 const goal=read('tasks/corporation-hash-goal.json');
 const freshGoal=goal?.nodeReset===reset.lastNodeReset&&goal.augReset===reset.lastAugReset&&goal.at<=now&&now-goal.at<45000&&live.has(goal.ownerPid);
 return {schemaVersion:1,at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,state:valid?'recording':'waiting for first observed purchase',
  startedAt:valid?journal.startedAt:null,lastPurchaseAt:valid?journal.at:null,sequence:valid?journal.sequence:0,purchases:valid?journal.purchases:0,
  spent:valid?journal.spent:0,totals:valid?journal.totals:{},recent:valid?journal.recent.slice(-32):[],
  hashes,capacity,corporateMilestone:freshGoal?goal.milestone:null,workers};
}

/** Fund fresh urgent cash demand before discretionary spending, even below hash capacity. */
export function fundHashCashGoal(ns,options={},limit=10000,decide=hashSpendingDecision,spend=spendHashesWithPolicy) {
 if(options.automatic===false||options.ignoreRoute===true||!Number.isSafeInteger(limit)||limit<1)return null;
 const action='Sell for Money',decision=decide(ns,action,options);
 if(!decision.allowed||decision.preferred!==action||!(decision.cashPurchasesNeeded>0))return null;
 const cost=ns.hacknet.hashCost(action);
 const quantity=Math.min(limit,decision.cashPurchasesNeeded,Math.floor(Math.min(decision.budget,ns.hacknet.numHashes())/cost));
 if(!Number.isSafeInteger(quantity)||quantity<1)return null;
 return {...spend(ns,action,undefined,quantity,options,decide),quantity};
}
