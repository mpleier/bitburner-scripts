/** Native-safe hash decisions. Self-contained for serialization into low-RAM helpers. */
export function hashSpendingDecision(ns,action,options={}) {
 const now=Date.now(),read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},reset=ns.getResetInfo();
 const processes=ns.ps('home'),alive=pid=>processes.some(p=>p.pid===pid);
 const hashes=ns.hacknet.numHashes(),capacity=ns.hacknet.hashCapacity(),cashPerHash=250000;
 const result=(allowed,reason,extra={})=>({nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,allowed,reason,budget:allowed?hashes:0,hashes,capacity,cashPerHash,...extra});
 if(options.ownerPid&&!alive(options.ownerPid))return result(false,'Owner exited');
 if(options.script&&ns.read('remote-control/paused/'+options.script+'.txt').trim()==='true')return result(false,'Controller paused');
 const maintenance=read('tasks/automation-maintenance.json');
 if(maintenance?.expiresAt>now&&alive(maintenance.ownerPid))return result(false,'Automation maintenance');
 let cashAllowed=true;
 for(const [file,active]of [['tasks/achievement-profile.json',true],['tasks/achievement-goals.json',false]]){
  const p=read(file);if(p?.nodeReset===reset.lastNodeReset&&(active?p.active:p.expiresAt>now&&alive(p.ownerPid))&&p.deniedActions?.includes('hacknetMoney'))cashAllowed=false;
  if(p?.nodeReset===reset.lastNodeReset&&(active?p.active:p.expiresAt>now&&alive(p.ownerPid))&&
   (p.deniedActions?.includes('hashSpending')||action==='Sell for Money'&&p.deniedActions?.includes('hacknetMoney')))return result(false,'Achievement restriction');
 }
 const raw=read('tasks/node-route-plan.json');
 const route=raw?.at<=now&&now-raw.at<45000&&raw.nodeReset===reset.lastNodeReset&&raw.augReset===reset.lastAugReset&&
  processes.some(p=>p.pid===raw.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js')?raw:null;
 const rank='Exchange for Bladeburner Rank',sp='Exchange for Bladeburner SP';
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
 if(route?.selected==='bladeburner'&&route.routes?.bladeburner?.etaMs!==0){
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
 const plan=read('tasks/spending-plan.json'),saving=plan?.reset===reset.lastAugReset&&plan.epoch<=now&&plan.expiresAt>now&&plan.expiresAt<=now+120000&&processes.some(p=>p.pid===plan.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js')?plan.signals?.augmentationCashTarget:null;
 const cashTarget=cashAllowed?(playerMoney<300000?300000:Number.isFinite(saving?.cost)&&saving.cost>playerMoney?saving.cost:null):null;
 const cashPurchasesNeeded=cashTarget===null?0:Math.ceil((cashTarget-playerMoney)/1000000);
 if(cashPurchasesNeeded>0){preferred='Sell for Money';priorityCost=costOf(preferred)*cashPurchasesNeeded;priorityReason=playerMoney<300000?'Casino bootstrap cash':'Reachable augmentation cash target';}
 const cost=action==='__capacity__'?0:costOf(action);
 const common={preferred,cashTarget,cashPurchasesNeeded,rankHashCost,spHashCost,knownMaximumRank:history?.knownMax?Math.max(rankNow||0,history.maxRank):null,priorityCost:Number.isFinite(priorityCost)?priorityCost:null,priorityReason,rankSpGain,probe,rankNow,rankGap,rankSecondsSaved,rankSpSecondsSaved,spSecondsSaved,rankValuePerHash,spValuePerHash,rankGateReady,
  skillGoal:skillGoal?{name:skillGoal.name||null,state:skillGoal.state,cost:skillGoal.cost??null,shortfall:skillShortfall,naturalFundingSeconds:skillGoalEtaSeconds,fundingPlan:skillFundingPlan}:null,
  valueBasis:skillGoal?'Next useful upgrade funding; future skill-effect ETA unmeasured':spSecondsSaved!==null?'Natural rank/SP replacement time; not a skill-upgrade completion ETA':'Known skill points per hash',
  cost:Number.isFinite(cost)?cost:null,cashEquivalent:Number.isFinite(cost)?cost*cashPerHash:null};
 if(action==='__capacity__')return result(!!preferred&&preferred!=='Sell for Money'&&Number.isFinite(priorityCost)&&priorityCost>capacity,'Capacity only for a useful reserved purchase',common);
 if(!Number.isFinite(cost)||cost<=0)return result(false,'Unavailable hash action',common);
 let budget=hashes;
 if(options.ignoreRoute!==true&&preferred&&preferred!==action&&priorityCost>0){
  budget=Math.max(0,hashes-Math.min(priorityCost,capacity));
 }
 if([rank,sp].includes(action)&&route?.routes?.bladeburner?.etaMs===0&&options.ignoreRoute!==true)return result(false,'All BlackOps completed',common);
 if([rank,sp].includes(action)&&route?.selected==='hacking'&&options.ignoreRoute!==true)return result(false,'World Daemon route selected',common);
 if(options.automatic!==false&&options.ignoreRoute!==true&&[rank,sp].includes(action)&&(skillGoal||[rank,sp].includes(preferred))&&action!==preferred)
  return result(false,'Prefer '+preferred+' for better progression value',{...common,budget:0});
 if(cost>budget)return result(false,'Saving for '+(preferred||action),{...common,budget});
 if(options.automatic!==false&&action!=='Sell for Money'&&![rank,sp].includes(action)){
  const resetPlan=read('tasks/augmentation-reset-plan.json');
  if(resetPlan?.pending&&resetPlan.expiresAt>now&&alive(resetPlan.ownerPid))return result(false,'Augmentation reset pending',common);
  const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0),free=Math.max(0,playerMoney-reserve),cashCost=cost*cashPerHash;
  if(action==='Increase Maximum Money'||action==='Reduce Minimum Security'){
   const analysis=read('/Temp/analyze-hack.txt'),meta=read('/Temp/analyze-hack-meta.txt');
   const daemon=processes.find(p=>p.filename.replace(/^\//,'')==='daemon.js');
   if(!daemon||daemon.args.includes('--xp-only'))return result(false,'No income-mode hacking allocation',common);
   const target=options.target,rate=Array.isArray(analysis)?analysis.find(s=>s.hostname===target)?.gainRate:0;
   if(!(meta?.at<=now&&now-meta.at<300000&&meta.augReset===reset.lastAugReset&&meta.nodeReset===reset.lastNodeReset))return result(false,'Fresh server profitability analysis needed',common);
   // gainRate is dollars per RAM-second. Attribute only RAM actually allocated to the target.
   let ram=0;const visited=new Set(),queue=['home'];
   while(queue.length&&visited.size<1024){const host=queue.shift();if(visited.has(host))continue;visited.add(host);
    try{queue.push(...ns.scan(host).filter(h=>!visited.has(h)));for(const p of ns.ps(host))if(/(?:hack|grow|weak)-target\.js$/.test(p.filename)&&p.args.includes(target))ram+=ns.getScriptRam(p.filename,host)*p.threads;}catch{}
   }
   const server=ns.getServer(target),relative=action==='Increase Maximum Money'?server.moneyMax>=1e13?0:.02:server.minDifficulty>1?Math.min(.02,(server.minDifficulty-1)/server.minDifficulty):0;
   const benefit=Math.max(0,rate||0)*ram*relative,remaining=Math.min(3600,Math.max(0,Number(options.remainingSeconds)||1800));
   if(!(benefit>0&&cashCost/benefit<=remaining))return result(false,'Server boost does not repay before the planning horizon',{...common,estimatedIncomeGain:benefit,paybackSeconds:benefit>0?cashCost/benefit:null});
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
   if(options.corporationUseful!==true||cashCost>free*.01)return result(false,'No near-term corporate milestone worth the cash opportunity cost',common);
  }
 }
 return result(cost<=budget,cost<=budget?'Purchase fits the shared hash budget':'Saving for '+preferred,{...common,budget});
}

/** Recheck immediately before synchronous mutation and record observed rank/SP yields. */
export function spendHashesWithPolicy(ns,action,target,quantity=1,options={},decide=hashSpendingDecision) {
 const decision=decide(ns,action,{...options,target});
 const record={at:Date.now(),pid:options.ownerPid||ns.pid,script:options.script||'hash-worker',action,target:target??null,...decision};
 const finish=(success,spent=0)=>{const receipt={...record,success,spent};ns.write('tasks/hash-spending-'+(options.ownerPid||ns.pid)+'.json',JSON.stringify(receipt),'w');return receipt;};
 if(!decision.allowed||!Number.isSafeInteger(quantity)||quantity<1)return finish(false);
 let cost;try{cost=ns.hacknet.hashCost(action,quantity);}catch{return finish(false);}
 if(!Number.isFinite(cost)||cost>decision.budget||cost>ns.hacknet.numHashes())return finish(false);
 let beforeRank=null,beforeSp=null;
 if(action==='Exchange for Bladeburner Rank'&&typeof options.observeRank==='function')try{const r=options.observeRank();if(Number.isFinite(r?.rank)&&Number.isFinite(r?.points)){beforeRank=r.rank;beforeSp=r.points;}}catch{}
 const before=ns.hacknet.numHashes(),success=ns.hacknet.spendHashes(action,target,quantity);
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
