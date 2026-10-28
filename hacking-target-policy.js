import {forecastCoreBatches,forecastCorePreparation} from './hacking-core-policy.js';
/** Keep the incumbent and compare both high-return and quick-start alternatives.
 * Input order is the daemon's income ranking; no extra network scans are needed. */
export function selectHackingTargetCandidates(eligible,current,duration,confirming=null) {
 const rows=eligible.map((server,index)=>{
  let time=Infinity,ready=false;
  try { const value=duration(server);if(Number.isFinite(value)&&value>0)time=value;ready=server.isPrepped()===true; } catch {}
  return {server,index,time,ready};
 });
 const chosen=[],seen=new Set();
 const add=row=>{if(row&&!seen.has(row.server.name)&&chosen.length<9){seen.add(row.server.name);chosen.push(row.server);}};
 add(rows.find(r=>r.server.name===current));
 add(rows.find(r=>r.server.name===confirming));
 const quick=[...rows].filter(r=>Number.isFinite(r.time)).sort((a,b)=>a.time*(a.ready?1:3)-b.time*(b.ready?1:3)||a.index-b.index);
 // Quote quick-start servers early, before the shared placement deadline expires.
 quick.slice(0,3).forEach(add);
 rows.slice(0,3).forEach(add);
 rows.filter(r=>r.ready).slice(0,2).forEach(add);
 quick.forEach(add);rows.forEach(add);
 return chosen;
}
/** Native-formula quote at minimum security, bounded by resident batch RAM and pacing.
 * It is a conservative model, not a prediction of scheduler/runtime stalls. */
export function quoteHackingTarget(server,player,formulas,settings){
 try{
  const planningNow=settings.now??Date.now,planningUntil=settings.planningUntil??planningNow()+20;
  const planningBudget=()=>Math.min(10,Math.max(0,planningUntil-planningNow()));
  if(!Number.isFinite(planningUntil)||planningBudget()<=0)return null;
  const {ram,largestHostRam,cycleMs,queueMs,maxBatches,weakenPower,padding,costs,incomeMultiplier,workerLimit}=settings;
  if(![ram,cycleMs,maxBatches,weakenPower,padding,costs.hack,costs.grow,costs.weak,workerLimit].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(queueMs)||queueMs<0||!Number.isFinite(incomeMultiplier)||incomeMultiplier<0||!(server.moneyMax>0))return null;
  if(!Array.isArray(settings.hosts)&&!(Number.isFinite(largestHostRam)&&largestHostRam>0))return null;
  const prepped={...server,hackDifficulty:server.minDifficulty,moneyAvailable:server.moneyMax};
  const chance=formulas.hackChance(prepped,player),perThread=formulas.hackPercent(prepped,player),weakMs=formulas.weakenTime(prepped,player);
  if(![chance,perThread,weakMs].every(n=>Number.isFinite(n)&&n>0)||chance>1||perThread>=1)return null;
  const optimize=settings.optimizeFractions===true;
  const cap=Number.isFinite(settings.maxFraction)&&settings.maxFraction>0?Math.min(.98,settings.maxFraction):.75;
  const desiredFractions=optimize?[settings.fraction??.0625,.125,.25,.5,.75].map(f=>Math.min(cap,f)):[settings.fraction??.0625];
  const targetUntil=optimize?Math.min(planningUntil,planningNow()+2):planningUntil;
  const seenThreads=new Set();let fractionsTested=0;
  let best=null;
  for(const desired of desiredFractions){
   if(planningNow()>=targetUntil||planningBudget()<=0)break;
   const hack=Math.max(1,Math.floor(desired/perThread)),fraction=hack*perThread;if(!(fraction>0&&fraction<.99))continue;
   if(optimize&&fraction>cap||seenThreads.has(hack))continue;
   seenThreads.add(hack);fractionsTested++;
   const grow=Math.max(1,Math.ceil(formulas.growThreads({...prepped,moneyAvailable:server.moneyMax*(1-fraction)},player,server.moneyMax,1)*padding));
   const w1=Math.max(1,Math.ceil(hack*.002/weakenPower*padding)),w2=Math.max(1,Math.ceil(grow*.004/weakenPower*padding));
   const batchRam=hack*costs.hack+grow*costs.grow+(w1+w2)*costs.weak;
   if(!Number.isFinite(batchRam))continue;
   const paced=Math.min(Math.floor(maxBatches),Math.max(1,Math.floor(weakMs/cycleMs)-1));
   const placement=Array.isArray(settings.hosts)?forecastCoreBatches(settings.hosts,[{tool:'hack',threads:hack,cost:costs.hack},{tool:'grow',threads:grow,cost:costs.grow},{tool:'weak',threads:w1,cost:costs.weak},{tool:'weak',threads:w2,cost:costs.weak}],{maxBatches:paced,workerLimit,logGrowth:settings.logGrowth,maxPlanningMs:Math.min(planningBudget(),Math.max(.1,targetUntil-planningNow())),now:planningNow}):null;
   if(Array.isArray(settings.hosts)&&!placement)continue;
   if(!placement&&(hack*costs.hack>largestHostRam||grow*costs.grow>largestHostRam))continue;
   const cycles=placement?placement.cycles:Math.min(paced,Math.floor(ram/batchRam),Math.floor(workerLimit/4));if(cycles<1)continue;
   const waveMs=weakMs+cycles*cycleMs+queueMs,rate=server.moneyMax*fraction*chance*incomeMultiplier*cycles/(waveMs/1000);
   if(Number.isFinite(rate)&&rate>0&&(!best||rate>best.projectedRate))best={name:server.hostname,projectedRate:rate,batchRam:placement?placement.ram/cycles:batchRam,residentRam:placement?placement.ram:batchRam*cycles,cycles,fraction,chance,firstReceiptMs:weakMs+queueMs,weakMs,placement:placement&&{workers:placement.workers,cycles:placement.cycles,limited:placement.limited},model:placement?'Native formulas, host-specific resident placement; stalls excluded':'Native formulas, one-core growth, resident batches; fragmentation and stalls excluded'};
  }
  if(!best)return null;
  const ready=server.hackDifficulty<=server.minDifficulty/0.99&&server.moneyAvailable>=server.moneyMax*.99;
  let prepMs=0,prepRamSeconds=0,preparation=null;
  if(!ready){
   const secThreads=Math.max(0,Math.ceil((server.hackDifficulty-server.minDifficulty)/weakenPower));
   const growThreads=server.moneyAvailable>=server.moneyMax*.99?0:Math.max(0,Math.ceil(formulas.growThreads({...prepped,moneyAvailable:Math.max(0,server.moneyAvailable)},player,server.moneyMax,1)));
   const weakThreads=Math.ceil(growThreads*.004/weakenPower),currentWeak=formulas.weakenTime(server,player),currentGrow=formulas.growTime(server,player);
   if(![secThreads,growThreads,weakThreads,currentWeak,currentGrow].every(n=>Number.isFinite(n)&&n>=0))return null;
   const secWaves=Math.ceil(secThreads*costs.weak/ram),growthWaves=Math.ceil((growThreads*costs.grow+weakThreads*costs.weak)/ram);
   prepMs=secWaves*(currentWeak+queueMs)+growthWaves*(currentGrow+currentWeak+queueMs);
   prepRamSeconds=(secThreads+weakThreads)*costs.weak*currentWeak/1000+growThreads*costs.grow*currentGrow/1000;
   if(Array.isArray(settings.hosts)){
    preparation=forecastCorePreparation(settings.hosts,{securityThreads:secThreads,growThreads,costs,weakenPower,weakMs:currentWeak,growMs:currentGrow,queueMs,workerLimit,logGrowth:settings.logGrowth,maxPlanningMs:planningBudget(),now:planningNow});
    if(!preparation)return null;
    prepMs=preparation.durationMs;prepRamSeconds=preparation.ramSeconds;
   }
  }
  return {...best,ready,prepMs,prepRamSeconds,preparation,fractionsTested,fractionSearch:optimize?'Bounded native placement comparison; not an exhaustive optimum':'Current fraction only'};
 }catch{return null;}
}

/** Time to recover full incumbent income forgone during drain, prep and first income. */
export function targetSwitchEconomics(current,candidate,horizonMs){
 if(!current||!candidate||![current.projectedRate,candidate.projectedRate,horizonMs].every(n=>Number.isFinite(n)&&n>0)||![current.weakMs,candidate.prepMs,candidate.firstReceiptMs].every(n=>Number.isFinite(n)&&n>=0))return null;
 const drainMs=Number.isFinite(current.drain?.drainMs)&&current.drain.drainMs>=0?current.drain.drainMs:current.weakMs;
 const drainBasis=current.drain?.basis||'full-weaken-fallback';
 const delta=candidate.projectedRate-current.projectedRate,overheadMs=drainMs+candidate.prepMs+candidate.firstReceiptMs;
 if(!(delta>0))return {eligible:false,reason:'No projected income advantage',paybackMs:null,overheadMs,drainMs,drainBasis};
 const lostIncome=current.projectedRate*overheadMs/1000,paybackMs=overheadMs+lostIncome/delta*1000,netGain=(horizonMs-overheadMs)/1000*delta-lostIncome;
 return {eligible:candidate.projectedRate>=current.projectedRate*1.25&&paybackMs<=horizonMs*.5&&netGain>0,reason:candidate.projectedRate<current.projectedRate*1.25?'Less than 25% projected advantage':paybackMs>horizonMs*.5?'Switch does not repay within half the planning horizon':'Conservative preparation and lost-income costs repay',overheadMs,drainMs,drainBasis,lostIncome,paybackMs,netGain};
}

/** No purchases or process kills. Confirmation and cooldown avoid target churn. */
export function planHackingTargets(previous,{now,ownerPid,reset,current,candidates,horizonMs=1800000,enabled=true}){
 const same=previous?.ownerPid===ownerPid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&Number.isFinite(previous.at)&&previous.at<=now&&now-previous.at<15000;
 const horizon=Number.isFinite(horizonMs)&&horizonMs>0?Math.min(1800000,horizonMs):1800000;
 const rows=(Array.isArray(candidates)?candidates:[]).filter(q=>q&&typeof q.name==='string'&&Number.isFinite(q.projectedRate)&&q.projectedRate>0).slice(0,9);
 const incumbent=rows.find(q=>q.name===(same?previous.preferred:current))||rows.find(q=>q.name===current);
 const result={schemaVersion:1,at:now,ownerPid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,horizonMs:horizon,enforced:false,preferred:incumbent?.name||current||null,decision:'observe',reason:'Waiting for comparable native target quotes',quotes:rows,comparisons:[],lastSwitchAt:same?previous.lastSwitchAt??0:0};
 if(!enabled||!incumbent){result.reason=!enabled?'Target planner inactive for this mode or incomplete capacity evidence':result.reason;return result;}
 result.enforced=true;result.decision='hold';
 result.comparisons=rows.filter(q=>q.name!==incumbent.name).map(q=>({name:q.name,...targetSwitchEconomics(incumbent,q,horizon)})).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.netGain??-Infinity)-(a.netGain??-Infinity)||a.name.localeCompare(b.name));
 let winner=result.comparisons.find(q=>q.eligible);if(!winner){result.reason='No alternative repays the conservative switch cost';return result;}
 // Keep a still-profitable candidate through small quote fluctuations. A material
 // improvement, missing quote, or failed payback test starts fresh confirmation.
 const confirming=same&&result.comparisons.find(q=>q.name===previous.candidate&&q.eligible);
 if(confirming&&winner.netGain<=confirming.netGain*1.2)winner=confirming;
 result.candidate=winner.name;result.candidateSince=same&&previous.candidate===winner.name&&Number.isFinite(previous.candidateSince)&&previous.candidateSince<=now?previous.candidateSince:now;
 if(result.lastSwitchAt>0&&now-result.lastSwitchAt<180000){result.reason='Three-minute switch cooldown';return result;}
 if(now-result.candidateSince<60000){result.reason='Confirming the same candidate for sixty seconds';return result;}
 result.preferred=winner.name;result.decision='switch';result.reason=winner.reason;result.lastSwitchAt=now;return result;
}

/** Gross hack receipts only. Do not infer observed income from wallet or stocks. */
export function sampleHackingRevenue(previous,telemetry,ownerPid,reset,now){
 const rows=telemetry?.income&&Object.values(telemetry.income).filter(r=>r?.owner===ownerPid)||[];
 const fresh=telemetry?.ownerPid===ownerPid&&telemetry.nodeReset===reset.lastNodeReset&&telemetry.augReset===reset.lastAugReset&&!telemetry.blocked&&Number.isFinite(telemetry.at)&&telemetry.at<=now&&now-telemetry.at<15000;
 if(!fresh||!rows.length||rows.some(r=>![r.money,r.completions].every(n=>Number.isFinite(n)&&n>=0)))return {state:'waiting',reason:'Waiting for fresh owner-scoped hack receipts'};
 const money=rows.reduce((sum,r)=>sum+r.money,0),completions=rows.reduce((sum,r)=>sum+r.completions,0),key=JSON.stringify(rows.map(r=>r.target).sort());
 const same=previous?.ownerPid===ownerPid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.key===key&&previous.at<=now&&now-previous.at<15000&&previous.money<=money&&previous.completions<=completions;
 const start=same&&previous.start&&[previous.start.at,previous.start.money,previous.start.completions].every(Number.isFinite)&&previous.start.at<=now&&now-previous.start.at<=300000?previous.start:{at:now,money,completions},seconds=(now-start.at)/1000,count=completions-start.completions;
 const ready=seconds>=60&&count>=2;
 return {state:ready?'measured':'sampling',at:now,ownerPid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,key,money,completions,start,seconds,receipts:count,observedRate:ready?(money-start.money)/seconds:null,basis:'Gross hack receipts across owned targets; window includes startup, idle gaps and timing losses'};
}

/** A live pending install blocks new target investment; a queued augmentation alone does not. */
export function hackingPlanningHorizon({route,install,reset,now,isRunning}){
 const alive=pid=>{try{return Number.isSafeInteger(pid)&&pid>0&&isRunning(pid);}catch{return false;}};
 if(install?.pending===true&&Number.isFinite(install.expiresAt)&&install.expiresAt>now&&install.expiresAt<=now+180000&&install.augReset===reset.lastAugReset&&alive(install.ownerPid))return {horizonMs:1,reason:'Pending augmentation install; retain the current target'};
 const eta=route?.routes?.[route.selected]?.lowerMs;
 if(route?.nodeReset===reset.lastNodeReset&&route.augReset===reset.lastAugReset&&Number.isFinite(route.at)&&route.at<=now&&now-route.at<45000&&alive(route.ownerPid)&&Number.isFinite(eta)&&eta>=0)return {horizonMs:Math.max(1,Math.min(1800000,eta)),reason:'Fresh route ETA caps the target investment horizon'};
 return {horizonMs:1800000,reason:'Thirty-minute conservative default; completion time unknown'};
}
