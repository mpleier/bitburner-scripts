/** Conservative estimates for progression; no native actions or promised finish times. */
const minute=60000;
export function progressionSpeed({snapshot,previous,now=Date.now(),augReset,elapsed=0,node=1,firstBn9=false,combat=false,baseDelay=5*minute,homeRam=0,hackingGoal=false,combatRecovery=null,nodeReset=null,combatTarget=null,routeRemainingMs=null,casinoFunding=null}){
 const fallback={earlyInstall:false,delayMs:baseDelay,bottleneck:homeRam<64?'ram':hackingGoal?'hacking':'balanced',reason:'Waiting for fresh augmentation evidence'};
 if(!snapshot||snapshot.augReset!==augReset||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>5*minute)return {...fallback,observation:previous};
 if(!Number.isFinite(snapshot.worth)||snapshot.worth<0)return {...fallback,observation:previous};
 const same=previous?.augReset===augReset&&Number.isFinite(previous.at)&&Number.isFinite(previous.worth)&&previous.at<=snapshot.at;
 const ready=snapshot.ready||[],fingerprint=JSON.stringify(ready.map(a=>a.name).sort());
 const lastGrowthAt=!same||previous.fingerprint!==fingerprint||!Number.isFinite(previous.lastGrowthAt)?snapshot.at:previous.lastGrowthAt;
 const candidate=same?(previous.rateBaseline||previous):null;
 const baseline=candidate&&Number.isFinite(candidate.at)&&Number.isFinite(candidate.worth)&&candidate.at<=snapshot.at&&snapshot.at-candidate.at<=5*minute?candidate:null;
 const dt=baseline?(snapshot.at-baseline.at)/1000:0,measured=dt>=30;
 const current={at:snapshot.at,worth:snapshot.worth,reputation:snapshot.reputation,income:snapshot.income};
 const cashEstimate=stabilizeAugmentationIncome({snapshot,baseline,previous:baseline?previous:null,augReset,measured});
 const cashRate=cashEstimate.rate,factionCashRate=cashEstimate.factionRate;
 const repRates=measured?Object.fromEntries(Object.entries(snapshot.reputation||{}).map(([f,r])=>[f,
  Number.isFinite(r)&&Number.isFinite(baseline.reputation?.[f])?Math.max(0,(r-baseline.reputation[f])/dt):0])):baseline?previous.repRates||{}:{};
 const observation={augReset,...current,fingerprint,lastGrowthAt,cashRate,cashRateDuringFactionWork:factionCashRate,repRates,cashObservation:cashEstimate.state,cashRateBasis:cashEstimate.reason,
  rateBaseline:measured||!baseline?current:{at:baseline.at,worth:baseline.worth,reputation:baseline.reputation,income:baseline.income},
  rateMeasuredAt:measured?snapshot.at:baseline?previous.rateMeasuredAt??null:null};
 const seconds=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 let next=null;const waitCandidates=[];
 for(const target of snapshot.targets||[]){
  if(!Number.isFinite(target.cost)||!Number.isFinite(target.rep))continue;
  const cashGap=Math.max(0,target.cost-snapshot.worth);
  // One faction's reputation satisfies all its assigned prerequisites. Different
  // factions are budgeted sequentially, avoiding an assumption of parallel player work.
  const requirements=target.requirements??[{rep:target.rep,factions:target.factions||[]}],repByFaction=new Map();
  let rep=0;
  if(!Array.isArray(requirements)||!requirements.length)continue;
  for(const requirement of requirements){
   if(!Number.isFinite(requirement.rep)||requirement.rep<0||!Array.isArray(requirement.factions)){rep=Infinity;break;}
   let best=Infinity,provider=null;
   for(const f of requirement.factions){
    const eta=seconds(Math.max(0,requirement.rep-(snapshot.reputation?.[f]||0)),repRates[f]||0);
    if(eta<best){best=eta;provider=f;}
   }
   if(!Number.isFinite(best)){rep=Infinity;break;}
   repByFaction.set(provider,Math.max(repByFaction.get(provider)||0,best));
  }
  if(Number.isFinite(rep))rep=[...repByFaction.values()].reduce((sum,time)=>sum+time,0);
  const workCash=seconds(cashGap,rep>0?factionCashRate:cashRate),workWait=Math.max(workCash,rep);
  const donation=Number.isFinite(target.donationCost)?seconds(Math.max(0,target.cost+target.donationCost-snapshot.worth),cashRate):Infinity;
  const mixed=estimateMixedAugmentationWait({requirements,cost:target.cost,worth:snapshot.worth,cashRate,factionCashRate,
   reputation:snapshot.reputation||{},repRates,plannedDonations:target.plannedDonations||{}});
  const baselineSeconds=Math.min(workWait,donation),useMixed=!!mixed&&mixed.seconds<=baselineSeconds;
  const eta=Math.min(baselineSeconds,mixed?.seconds??Infinity)*1000;
  const funding=useMixed?mixed:null;
  const cashTarget=target.cost+(useMixed?mixed.donationCost:donation<workWait?target.donationCost:0);
  if(!next||eta<next.eta)next={name:target.name,eta,cashTarget,bottleneck:useMixed?(mixed.cashSeconds>=mixed.reputationSeconds?'cash':'reputation'):donation<workWait?'cash':rep>workCash?'reputation':'cash',funding};
  if(typeof target.name==='string'&&Number.isFinite(eta)&&eta>0)waitCandidates.push({name:target.name,eta,stats:target.stats||{},funding,cashTarget});
 }
 const bottleneck=homeRam<64?'ram':hackingGoal?'hacking':next&&Number.isFinite(next.eta)?next.bottleneck:'balanced';
 const channels=combat?{strength:.15,defense:.15,dexterity:.15,agility:.15,strength_exp:.08,defense_exp:.08,dexterity_exp:.08,agility_exp:.08,bladeburner_success_chance:.4,bladeburner_max_stamina:.12,bladeburner_stamina_gain:.12,bladeburner_analysis:.04}:{hacking:.35,hacking_exp:.15,hacking_speed:.2,hacking_money:.15,faction_rep:.15};
 let logGain=0;for(const aug of ready)for(const [key,weight]of Object.entries(channels)){const value=Number(aug.stats?.[key]??1);if(value>0&&Number.isFinite(value))logGain+=weight*Math.log(value);}
 // The wait basket may omit optional NF, but never invent augmentations absent from the install-now basket.
 const waitReady=snapshot.waitReady===undefined?ready:snapshot.waitReady;
 const remaining=new Map();for(const aug of ready){
  if(!remaining.has(aug.name))remaining.set(aug.name,[]);
  remaining.get(aug.name).push(aug);
 }
 const waitBasket=[];
 const waitBasketValid=Array.isArray(waitReady)&&waitReady.every(aug=>{
  if(!aug||!remaining.get(aug.name)?.length)return false;
  waitBasket.push(remaining.get(aug.name).pop());return true;
 });
 let waitLogGain=0;
 if(waitBasketValid)for(const aug of waitBasket)for(const [key,weight]of Object.entries(channels)){
  const value=Number(aug.stats?.[key]??1);if(value>0&&Number.isFinite(value))waitLogGain+=weight*Math.log(value);
 }
 // Discount theoretical multiplier gains: experience and skill are not linear throughput.
 const requiredCount=Number.isSafeInteger(snapshot.requiredCount)&&snapshot.requiredCount>0?snapshot.requiredCount:30;
 const countMilestone=!combat&&Number.isSafeInteger(snapshot.installedCount)&&snapshot.installedCount>=0&&snapshot.installedCount<requiredCount&&snapshot.installedCount+(new Set(ready.filter(a=>a.name!=='NeuroFlux Governor').map(a=>a.name))).size>=requiredCount;
 const countProgress=!combat&&Number.isSafeInteger(snapshot.installedCount)&&snapshot.installedCount>=0&&snapshot.installedCount<requiredCount&&ready.some(a=>a.name!=='NeuroFlux Governor');
 const recoveryValid=combat&&nodeReset!==null&&combatRecovery?.nodeReset===nodeReset&&combatRecovery.augReset===augReset&&
  Number.isFinite(combatRecovery.at)&&combatRecovery.at<=now&&now-combatRecovery.at<=90000;
 const samples=recoveryValid&&Array.isArray(combatRecovery.samples)?combatRecovery.samples.filter(s=>typeof combatTarget==='string'&&s.target===combatTarget&&s.nodeReset===nodeReset&&Number.isFinite(s.finishedAt)&&s.finishedAt<=now&&Number.isFinite(s.durationMs)&&s.durationMs>=0&&s.durationMs<=24*60*minute):[];
 const recoveryBlocked=!!(recoveryValid&&combatRecovery.recovering);
 const casino=casinoFunding?.available===true&&casinoFunding.augReset===augReset&&casinoFunding.nodeReset===nodeReset&&
  Number.isFinite(casinoFunding.at)&&casinoFunding.at<=now&&now-casinoFunding.at<=45000&&
  Number.isFinite(casinoFunding.amount)&&casinoFunding.amount>0&&casinoFunding.amount<=1e10&&
  Number.isFinite(casinoFunding.durationMs)&&casinoFunding.durationMs>=60000&&casinoFunding.durationMs<=5*60*minute?casinoFunding:null;
 const baseWarmup=combat?(samples.length?Math.max(minute,...samples.map(s=>s.durationMs)):20*minute):15*minute;
 const warmup=baseWarmup+(casino?.durationMs||0);
 const recoveryBasis=combat?(samples.length?'Measured time to regain the pre-install safe BlackOp':'Conservative combat recovery fallback'):'Conservative hacking recovery fallback';
 const gain=Math.max(countMilestone ? .5 : 0,Math.max(0,Math.min(2,Math.expm1(logGain)*.5)));
 const economics=snapshot.resetEconomics;
 const economicsKnown=!!economics?.known&&Number.isFinite(economics.replacementCost)&&economics.replacementCost>=0&&
  Number.isFinite(economics.gangLossPerSecond??0)&&(economics.gangLossPerSecond??0)>=0;
 const recoveryCost=economicsKnown?Math.max(0,economics.replacementCost||0)+Math.max(0,economics.gangLossPerSecond||0)*warmup/1000:firstBn9?null:0;
 const casinoCredit=economicsKnown&&casino?Math.min(recoveryCost,casino.amount):0;
 const remainingRecoveryCost=recoveryCost===null?null:Math.max(0,recoveryCost-casinoCredit);
 const rebuildMs=remainingRecoveryCost===0?0:remainingRecoveryCost!==null&&cashRate>0?remainingRecoveryCost/cashRate*1000:Infinity;
 const paybackMs=gain>0?warmup+warmup/gain+rebuildMs:Infinity,plateau=now-lastGrowthAt>=10*minute;
 let waitCandidate=null;const waitOptions=[];
 for(const candidate of waitBasketValid?waitCandidates:[]){
  let extra=0;for(const [key,weight]of Object.entries(channels)){const value=Number(candidate.stats[key]??1);if(value>0&&Number.isFinite(value))extra+=weight*Math.log(value);}
  const combinedGain=Math.max(countMilestone ? .5 : 0,Math.max(0,Math.min(2,Math.expm1(waitLogGain+extra)*.5)));
  const comparison=compareAugmentationInstall({gain,combinedGain,waitMs:candidate.eta,recoveryMs:warmup,rebuildMs,
   horizonMs:Number.isFinite(routeRemainingMs)?Math.min(4*60*minute,routeRemainingMs):4*60*minute});
  if(comparison.worthWaiting&&candidate.eta<=paybackMs*.25)
   waitOptions.push({...comparison,name:candidate.name,at:snapshot.at,etaMs:candidate.eta,funding:candidate.funding,cashTarget:candidate.cashTarget});
  if(comparison.worthWaiting&&candidate.eta<=paybackMs*.25&&(!waitCandidate||comparison.waitWork>waitCandidate.waitWork||
   comparison.waitWork===waitCandidate.waitWork&&candidate.eta<waitCandidate.etaMs))
   waitCandidate={...comparison,name:candidate.name,at:snapshot.at,etaMs:candidate.eta,funding:candidate.funding,cashTarget:candidate.cashTarget};
 }

 const resetPaysBack=economicsKnown&&Number.isFinite(paybackMs)&&paybackMs<=4*60*minute;
 const protectFirstBn9=firstBn9&&!resetPaysBack;
 const earlyInstall=![8].includes(node)&&!protectFirstBn9&&elapsed>=30*minute&&ready.some(a=>a.name!=='NeuroFlux Governor')&&gain>=.2&&paybackMs<=Math.min(4*60*minute,Math.max(60*minute,elapsed))&&plateau;
 const imminent=!!waitCandidate;
 const delayMs=protectFirstBn9||node===8||gain===0?baseDelay:Math.min(baseDelay,30000);
 return {earlyInstall,delayMs,bottleneck,gain,resetPaysBack,waitCandidate,waitOptions:waitOptions.sort((a,b)=>b.waitWork-a.waitWork||a.etaMs-b.etaMs).slice(0,16),countMilestone,countProgress,recoveryBlocked,recoveryMs:warmup,recoveryBasis,resetEconomics:{known:economicsKnown,recoveryCost,remainingRecoveryCost,casinoCredit,casinoDelayMs:casino?.durationMs||0,casinoFunding:casinoFunding||null,rebuildMs:Number.isFinite(rebuildMs)?rebuildMs:null},paybackMs:Number.isFinite(paybackMs)?paybackMs:null,next:next&&{...next,eta:Number.isFinite(next.eta)?next.eta:null},reason:earlyInstall?'Useful augmentation gains outweigh estimated restart recovery':protectFirstBn9?(!economicsKnown?'Preserving first BN9 Hacknet infrastructure; rebuild cost is unknown':gain<.2?'Preserving first BN9 Hacknet infrastructure; available augmentations offer little route improvement':'Preserving first BN9 Hacknet infrastructure; estimated reset payback exceeds four hours'):imminent?'Another augmentation is close; allow a bounded wait':'No measured near-term augmentation improvement',observation};
}

/** Observe actual recovery of the same previously safe BlackOp after an install. */
export function observeCombatRecovery(saved,{reset,route,now=Date.now()}={}) {
 if(!reset||!Number.isFinite(now)||!Number.isFinite(reset.lastAugReset)||!Number.isFinite(reset.lastNodeReset))return null;
 const sameNode=saved?.nodeReset===reset.lastNodeReset&&Number.isFinite(saved.at)&&saved.at<=now;
 const routeFresh=route?.nodeReset===reset.lastNodeReset&&route.augReset===reset.lastAugReset&&
  Number.isFinite(route.at)&&route.at<=now&&now-route.at<=45000;
 const fresh=routeFresh&&route.selected==='bladeburner';
 const next=fresh?route.development?.nextBlackOp:null;
 const old=sameNode?saved:null;
 const samples=Array.isArray(old?.samples)?old.samples.filter(s=>s.nodeReset===reset.lastNodeReset&&Number.isFinite(s.augReset)&&s.augReset<=reset.lastAugReset&&Number.isFinite(s.durationMs)&&s.durationMs>=0&&
  s.durationMs<=24*60*minute&&Number.isFinite(s.finishedAt)&&s.finishedAt<=now).slice(-8):[];
 let state={nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,samples,recovering:false,target:null,baselineSafe:false};
 const sameAug=old?.augReset===reset.lastAugReset;
 if(sameAug)state={...old,...state,recovering:!!old.recovering,target:old.target,baselineSafe:!!old.baselineSafe};
 else if(old&&old.augReset<reset.lastAugReset&&old.baselineSafe&&typeof old.target==='string'&&
  old.at<=reset.lastAugReset&&reset.lastAugReset-old.at<=90000)
  state={...state,recovering:true,recoveryTarget:old.target,startedAt:reset.lastAugReset};
 if(state.recovering&&old&&sameAug&&now-old.at>90000){state.recovering=false;state.reason='Recovery measurement interrupted';}
 if(state.recovering&&routeFresh&&route.selected!=='bladeburner'){state.recovering=false;state.reason='Selected route changed; discard incomparable recovery';}
 if(state.recovering&&fresh&&next?.name!==state.recoveryTarget){state.recovering=false;state.reason='BlackOp target changed; discard incomparable recovery';}
 if(state.recovering&&next?.name===state.recoveryTarget&&next.safe===true){
  const durationMs=Math.max(0,now-state.startedAt);
  if(Number.isFinite(durationMs)&&durationMs<=24*60*minute)state.samples=[...samples,{nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,target:state.recoveryTarget,durationMs,finishedAt:now}].slice(-8);
  state.recovering=false;state.reason='Pre-install BlackOp safety recovered';
 }
 if(next&&typeof next.name==='string'){
  state.baselineSafe=next.safe===true||(state.target===next.name&&state.baselineSafe);
  state.target=next.name;
 }
 return state;
}

/** Count heuristics request installs; require economic payback or a verified milestone. */
export function augmentationResetDecision({requested=false,adaptive=true,speed,priority=false,favor=false,countUnlock=false,campaign=false,bn8Quick=false,remainingMs=null,waitWindow=null,now=Date.now(),augReset=null,nodeReset=null}={}) {
 if(!requested)return {allowed:false,reason:'Augmentation threshold not reached'};
 if(!adaptive)return {allowed:true,reason:'Adaptive reset economics explicitly disabled'};
 if(priority||favor||countUnlock||campaign||bn8Quick)return {allowed:true,reason:'Verified augmentation progression milestone'};
 if(speed?.recoveryBlocked)return {allowed:false,reason:'Still rebuilding pre-install Bladeburner safety'};
 if(speed?.resetPaysBack!==true||!Number.isFinite(speed.paybackMs)||speed.paybackMs<0||speed.paybackMs>4*60*minute)
  return {allowed:false,reason:'Available augmentation gains do not repay the estimated rebuild within four hours'};
 if(Number.isFinite(remainingMs)&&remainingMs>=0&&speed.paybackMs>=remainingMs*.75)
  return {allowed:false,reason:'The selected BitNode route is expected to finish before an install repays its rebuild'};
 const choices=(Array.isArray(speed.waitOptions)?speed.waitOptions:[speed.waitCandidate]).filter(candidate=>
  candidate?.worthWaiting===true&&typeof candidate.name==='string'&&Number.isFinite(candidate.at)&&candidate.at<=now&&now-candidate.at<=120000&&
  Number.isFinite(candidate.etaMs)&&candidate.etaMs>0&&candidate.etaMs<=Math.min(15*minute,speed.paybackMs*.25));
 if(choices.length&&Number.isFinite(augReset)&&Number.isFinite(nodeReset)){
  const validWindow=waitWindow?.schemaVersion===1&&waitWindow.augReset===augReset&&waitWindow.nodeReset===nodeReset&&
   Number.isFinite(waitWindow.startedAt)&&waitWindow.startedAt>=augReset&&waitWindow.startedAt<=now&&Number.isFinite(waitWindow.expiresAt)&&
   waitWindow.expiresAt>waitWindow.startedAt&&waitWindow.expiresAt-waitWindow.startedAt<=15*minute;
  const window=validWindow?waitWindow:{schemaVersion:1,augReset,nodeReset,startedAt:now,expiresAt:now+15*minute};
  // All targets share this deadline. Switching targets or reloading cannot extend the wait.
  const candidate=choices.find(c=>c.etaMs<=window.expiresAt-now);
  if(candidate)return {allowed:false,reason:'Waiting for '+candidate.name+': bundling it yields more progress after rebuild',
    waitWindow:window,waitPlan:{...candidate,deadline:window.expiresAt}};
 }
 return {allowed:true,reason:'Augmentation gains repay the estimated rebuild'};
}

/** Compare productive work over one common horizon. The numbers are relative work units, not completion ETAs. */
export function compareAugmentationInstall({gain,combinedGain,waitMs,recoveryMs,rebuildMs=0,horizonMs=4*60*minute}={}) {
 const invalid={worthWaiting:false};
 if(![gain,combinedGain,waitMs,recoveryMs,rebuildMs,horizonMs].every(Number.isFinite)||gain<0||combinedGain<gain||
  waitMs<=0||waitMs>15*minute||recoveryMs<0||rebuildMs<0||horizonMs<=0||horizonMs>4*60*minute)return invalid;
 const downtime=recoveryMs+rebuildMs;
 if(waitMs+downtime>=horizonMs)return invalid;
 const installWork=Math.max(0,horizonMs-downtime)*(1+gain);
 const waitWork=waitMs+(horizonMs-waitMs-downtime)*(1+combinedGain);
 const improvement=installWork>0?(waitWork-installWork)/installWork:0;
 return {worthWaiting:combinedGain-gain>=.05&&improvement>=.05,gain,combinedGain,etaMs:waitMs,recoveryMs,rebuildMs,horizonMs,
  installWork,waitWork,improvement};
}


/** Remove only needs that cannot affect any remaining bill as earned rep increases.
 * Different quote slopes remain distinct unless domination is provable. */
export function pruneAugmentationDonationNeeds(needs,earnedRep) {
 const linear=need=>Number.isFinite(need.baseline)&&need.rep>need.baseline;
 if(!needs.length)return needs;
 if(needs.length===1){
  const need=needs[0];
  return need.amount<=0||linear(need)&&Number.isFinite(earnedRep)&&earnedRep>=need.rep?[]:needs;
 }
 const relevant=needs.filter(need=>need.amount>0&&!(linear(need)&&Number.isFinite(earnedRep)&&earnedRep>=need.rep));
 const distinct=relevant.filter((need,index)=>!relevant.slice(0,index).some(other=>
  other.rep===need.rep&&other.baseline===need.baseline&&other.amount===need.amount));
 return distinct.filter(need=>!distinct.some(other=>{
  if(other===need||other.baseline!==need.baseline||!linear(other)||!linear(need)||other.rep<need.rep)return false;
  if(other.rep===need.rep)return other.amount>need.amount;
  // Larger rep target and no smaller cost per rep dominate over all future work.
  const left=other.amount*(need.rep-need.baseline),right=need.amount*(other.rep-other.baseline);
  if(Number.isSafeInteger(left)&&Number.isSafeInteger(right))return left>=right;
  const otherSlope=other.amount/(other.rep-other.baseline),slope=need.amount/(need.rep-need.baseline);
  return Number.isFinite(otherSlope)&&Number.isFinite(slope)&&otherSlope>=slope*(1+1e-12);
 }));
}

/** Repeated augmentations can require the same reputation access. Process it once,
 * ignoring faction/provider order while preserving distinct donation eligibility and quotes. */
export function deduplicateAugmentationRequirements(requirements) {
 if(!Array.isArray(requirements))return null;
 const seen=new Set(),unique=[];
 for(const requirement of requirements){
  if(!Number.isFinite(requirement?.rep)||requirement.rep<0||!Array.isArray(requirement.factions)||!requirement.factions.length||
   requirement.factions.some(f=>typeof f!=='string'||!f)||
   requirement.providers!==undefined&&!Array.isArray(requirement.providers))return null;
  const factions=[...new Set(requirement.factions)].sort();
  const providers=[...new Set((requirement.providers||[]).filter(p=>
   typeof p?.faction==='string'&&factions.includes(p.faction)&&Number.isFinite(p.requiredDonation)&&p.requiredDonation>=0)
   .map(p=>JSON.stringify([p.faction,p.requiredDonation])))].sort();
  const key=JSON.stringify([requirement.rep,factions,providers]);
  if(!seen.has(key)){seen.add(key);unique.push(requirement);}
 }
 return unique;
}

/** Bounded search across work, donation and work-then-donate choices. Every retained state
 * is a feasible conservative estimate; pruning may miss a faster plan, never invent one.
 * Different factions' measured work times are summed. Cash may accrue during work. */
export function estimateMixedAugmentationWait({requirements,cost,worth,cashRate,factionCashRate=cashRate,reputation={},repRates={},plannedDonations={}}={}) {
 if(!Array.isArray(requirements)||!requirements.length||!requirements.some(r=>Array.isArray(r?.providers)&&r.providers.length)||
  !reputation||!repRates||!plannedDonations||typeof plannedDonations!=='object'||
  ![cost,worth,cashRate,factionCashRate].every(Number.isFinite)||cost<0||worth<0||cashRate<0||factionCashRate<0||
  Object.values(plannedDonations).some(value=>!Number.isFinite(value)||value<0))return null;
 factionCashRate=Math.min(cashRate,factionCashRate);
 const uniqueRequirements=deduplicateAugmentationRequirements(requirements);
 if(!uniqueRequirements)return null;
 // Reputation from any offering faction already satisfies the requirement. Cash
 // for augmentations and previously planned donations remains in the basket cost.
 const outstandingRequirements=uniqueRequirements.filter(requirement=>!requirement.factions.some(faction=>
  Number.isFinite(reputation[faction])&&reputation[faction]>=0&&reputation[faction]>=requirement.rep));
 // Planned donations buy shared reputation, not consumable credits. They can cover
 // several augmentations from the same faction; their cash stays in the base cost.
 const pendingRequirements=outstandingRequirements.filter(requirement=>!(requirement.providers||[]).some(provider=>
  typeof provider?.faction==='string'&&requirement.factions.includes(provider.faction)&&
  Number.isFinite(provider.requiredDonation)&&provider.requiredDonation>=0&&
  Number.isFinite(plannedDonations[provider.faction])&&plannedDonations[provider.faction]>=provider.requiredDonation));
 const seconds=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 const searchStats={evaluated:0,merged:0,removedNeeds:0,deduplicatedRequirements:requirements.length-uniqueRequirements.length,satisfiedRequirements:uniqueRequirements.length-outstandingRequirements.length,donationCoveredRequirements:outstandingRequirements.length-pendingRequirements.length};
 const summarize=state=>{
  // Preserve the original quote and rep gap. Later work can lower every earlier
  // requirement from this faction; donations buy the maximum remaining gap once.
  const donations=new Map(),obligations=new Map(),work=state.work,goals=state.goals;
  for(const [faction,time]of work)if(time===0&&goals.get(faction)<=reputation[faction]){
   work.delete(faction);goals.delete(faction);
  }
  for(const [faction,original]of state.obligations){
   const needs=pruneAugmentationDonationNeeds(original,goals.get(faction)??reputation[faction]);
   searchStats.removedNeeds+=original.length-needs.length;
   if(!needs.length)continue;
   obligations.set(faction,needs);
   let amount=0;
   for(const need of needs){
    const remaining=Number.isFinite(need.baseline)&&need.rep>need.baseline
     ?Math.ceil(need.amount*Math.max(0,Math.min(1,(need.rep-Math.max(need.baseline,goals.get(faction)??need.baseline))/(need.rep-need.baseline))))
     :need.amount;
    amount=Math.max(amount,remaining);
   }
   donations.set(faction,amount);
  }
  const donationCost=[...donations].reduce((sum,[f,value])=>sum+Math.max(0,value-(plannedDonations[f]??0)),0);
  const reputationSeconds=[...work.values()].reduce((sum,value)=>sum+value,0);
  const cashSeconds=seconds(Math.max(0,cost+donationCost-worth),reputationSeconds>0?factionCashRate:cashRate);
  return {...state,work,goals,obligations,donations,donationCost,reputationSeconds,cashSeconds,seconds:Math.max(cashSeconds,reputationSeconds)};
 };
 let states=[summarize({work:new Map(),goals:new Map(),obligations:new Map()})],searchLimited=false;
 for(const requirement of pendingRequirements){
  if(!Number.isFinite(requirement?.rep)||requirement.rep<0||!Array.isArray(requirement.factions)||!requirement.factions.length||
   requirement.providers!==undefined&&!Array.isArray(requirement.providers))return null;
  const choices=[],partials=[];
  for(const faction of new Set(requirement.factions)){
   if(typeof faction!=='string')continue;
   const current=reputation[faction],rate=repRates[faction];
   if(Number.isFinite(current)&&current>=0){
    const wait=seconds(Math.max(0,requirement.rep-current),Number.isFinite(rate)&&rate>0?rate:0);
    if(Number.isFinite(wait))choices.push({faction,work:wait,goal:requirement.rep});
   }
  }
  for(const provider of requirement.providers||[]){
   if(typeof provider?.faction!=='string'||!requirement.factions.includes(provider.faction)||!Number.isFinite(provider.requiredDonation)||provider.requiredDonation<0)continue;
   const faction=provider.faction;
   const current=reputation[faction],rate=repRates[faction],gap=requirement.rep-current;
   choices.push({faction,donation:provider.requiredDonation,donationRep:requirement.rep,donationBaseline:Number.isFinite(current)&&current>=0?current:null});
   if(Number.isFinite(current)&&current>=0&&Number.isFinite(rate)&&rate>0&&Number.isFinite(gap)&&gap>0&&provider.requiredDonation>0){
    // Native donations round up. Dividing that quote by the gap gives a conservative
    // cost per rep without assuming an unavailable formula or understating rounding.
    const duration=gap/rate;
    if(Number.isFinite(duration)&&duration>0)partials.push({faction,current,rate,duration,fullDonation:provider.requiredDonation});
   }
  }
  if(!choices.length)return null;
  const unique=new Map();
  for(const state of states){
   const options=choices.slice();
   for(const partial of partials){
    const {faction,current,rate,duration,fullDonation}=partial;
    const credit=plannedDonations[faction]??0,priorDonation=state.donations.get(faction)||0;
    const priorWork=state.work.get(faction)||0,otherWork=state.reputationSeconds-priorWork;
    const otherDonation=state.donationCost-Math.max(0,priorDonation-credit);
    const reductionPerSecond=fullDonation/duration;
    // Work/cash intersection plus sharing breakpoints. A few interior candidates
    // preserve alternatives for later requirements in the bounded search.
    const balance=(cost+otherDonation+fullDonation-credit-worth-factionCashRate*otherWork)/(factionCashRate+reductionPerSecond);
    const boundedBalance=Math.max(0,Math.min(duration,balance));
    const roundedBalance=duration*(1-Math.floor(fullDonation*(1-boundedBalance/duration))/fullDonation);
    const times=new Set([duration*.25,duration*.5,duration*.75,priorWork,
     duration*(1-Math.max(credit,priorDonation)/fullDonation),balance,roundedBalance]);
    for(const raw of times){
     const time=Math.max(0,Math.min(duration,raw));
     if(!Number.isFinite(time)||time<=0||time>=duration)continue;
     const donation=Math.ceil(fullDonation*(1-time/duration));
     const goal=current+rate*time;
     if(Number.isFinite(donation)&&Number.isFinite(goal))
      options.push({faction,work:time,goal,donation:fullDonation,donationRep:requirement.rep,donationBaseline:current});
    }
   }
   for(const choice of options){
    const work=new Map(state.work),goals=new Map(state.goals),obligations=new Map(state.obligations);
    if(choice.work!==undefined){
     work.set(choice.faction,Math.max(work.get(choice.faction)||0,choice.work));
     goals.set(choice.faction,Math.max(goals.get(choice.faction)||0,choice.goal));
    }
    if(choice.donation!==undefined){
     const needs=obligations.get(choice.faction)||[];
     const need={rep:choice.donationRep,baseline:choice.donationBaseline,amount:choice.donation};
     if(!needs.some(n=>n.rep===need.rep&&n.baseline===need.baseline&&n.amount===need.amount))
      obligations.set(choice.faction,[...needs,need]);
    }
    searchStats.evaluated++;
    const candidate=summarize({work,goals,obligations});
    // Keep quote identities in the key: equal bills today can shrink differently
    // after later work. Infinite cash waits can also become funded by that work.
    const key=JSON.stringify([[...candidate.work].sort(),[...candidate.goals].sort(),[...candidate.obligations].sort().map(([f,needs])=>
     [f,needs.map(n=>[n.rep,n.baseline,n.amount]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2])])]);
    if(!unique.has(key))unique.set(key,candidate);else searchStats.merged++;
   }
  }
  const candidates=[...unique.values()].sort((a,b)=>a.seconds-b.seconds||a.donationCost-b.donationCost||a.reputationSeconds-b.reputationSeconds);
  if(candidates.length>64)searchLimited=true;
  states=candidates.slice(0,64);
  if(!states.length)return null;
 }
 const best=states.find(state=>Number.isFinite(state.seconds));
 if(!best)return null;
 return {seconds:best.seconds,donationCost:best.donationCost,reputationSeconds:best.reputationSeconds,cashSeconds:best.cashSeconds,
  workByFaction:Object.fromEntries(best.work),workTargets:Object.fromEntries(best.goals),donationsByFaction:Object.fromEntries(best.donations),cashRateDuringWork:factionCashRate,searchLimited,searchStats};
}


/** Source counters exclude stock valuations and non-repeatable reward categories.
 * A short, bounded lower-median history limits spikes; the newest low interval wins. */
export function stabilizeAugmentationIncome({snapshot,baseline,previous,augReset,measured=false}) {
 const sourced=Object.hasOwn(snapshot,'income'),mode=sourced?'sources-v1':'legacy-worth-v1',now=snapshot.at;
 const empty={schemaVersion:1,augReset,mode,at:now,samples:[]};
 const keys=['hacking','hacknet','gang','sleeves','work','crime','corporation','bladeburner'];
 const validIncome=(income,at)=>income&&Number.isFinite(income.at)&&income.at<=at&&at-income.at<=30000&&
  income.sources&&keys.every(key=>Number.isFinite(income.sources[key]));
 const validPrevious=previous?.cashObservation?.schemaVersion===1&&previous.cashObservation.augReset===augReset&&
  previous.cashObservation.mode===mode&&Number.isFinite(previous.cashObservation.at)&&
  previous.cashObservation.at<=now&&now-previous.cashObservation.at<=5*minute;
 const saved=validPrevious?previous.cashObservation:empty;
 let samples=Array.isArray(saved.samples)?saved.samples.filter(sample=>Number.isFinite(sample.at)&&sample.at<=now&&
  now-sample.at<=5*minute&&Number.isFinite(sample.rate)&&sample.rate>=0).slice(-5):[];
 if(sourced&&!validIncome(snapshot.income,now))
  return {rate:0,factionRate:0,state:empty,reason:'Recurring income counters unavailable'};
 const estimate=field=>{
  const valid=samples.filter(sample=>Number.isFinite(sample[field])&&sample[field]>=0);
  if(!valid.length||sourced&&valid.length<2||!Number.isFinite(samples.at(-1)?.[field]))return 0;
  const rates=valid.map(sample=>sample[field]).sort((a,b)=>a-b);
  return Math.min(samples.at(-1)[field],rates[Math.floor((rates.length-1)/2)]);
 };
 const result=reason=>{
  const rate=estimate('rate'),factionRate=sourced?Math.min(rate,estimate('factionRate')):rate;
  return {rate,factionRate,state:{...empty,samples},reason};
 };
 if(!baseline||!measured)return result(samples.length?'Retaining recent income evidence':'Waiting for income evidence');
 let duration=(now-baseline.at)/1000,raw,factionRaw;
 if(sourced){
  if(!validIncome(baseline.income,baseline.at))
   return {rate:0,factionRate:0,state:empty,reason:'Waiting for comparable recurring income counters'};
  duration=(snapshot.income.at-baseline.income.at)/1000;
  if(!(duration>=20&&duration<=300))return {rate:0,factionRate:0,state:empty,reason:'Income counter interval is not comparable'};
  const rateFor=channels=>channels.reduce((sum,key)=>sum+Math.max(0,snapshot.income.sources[key]-baseline.income.sources[key]),0)/duration;
  raw=rateFor(keys);
  factionRaw=rateFor(keys.filter(key=>key!=='work'&&key!=='crime'));
 }else raw=factionRaw=Math.max(0,(snapshot.worth-baseline.worth)/duration);
 if(!Number.isFinite(raw)||raw<0||!Number.isFinite(factionRaw)||factionRaw<0)return {rate:0,factionRate:0,state:empty,reason:'Invalid income evidence'};
 if(!samples.length||samples.at(-1).at<now)samples=[...samples,{at:now,rate:raw,factionRate:factionRaw}].slice(-5);
 return result(sourced?(samples.length<2?'Waiting for confirmed recurring income':'Stable recurring income'):'Smoothed legacy net-worth fallback');
}

/** A stock upgrade can postpone an otherwise approved install only for a short, funded window.
 * History survives reloads; changed prices, routes or income cannot extend an existing deadline. */
export function augmentationFourSigmaWait({route,reset,now=Date.now(),worth,cost,threshold=.9,
 stock,stockPid,income,window=null,paybackMs=null,remainingMs=null}={}) {
 const no=reason=>({wait:false,reason,window});
 if(route!=='hacking')return no('The selected route does not need a 4S installation delay');
 if(!reset||![reset.lastNodeReset,reset.lastAugReset,now].every(Number.isFinite)||now<reset.lastAugReset)return no('Reset timing unavailable');
 if(!Number.isFinite(worth)||worth<0||!Number.isFinite(cost)||cost<=0||!Number.isFinite(threshold)||threshold<0||threshold>1)return no('4S quote unavailable');
 if(worth/cost<threshold)return no('Below the configured 4S proximity threshold');
 if(!Number.isSafeInteger(stockPid)||stockPid<=0||stock?.pid!==stockPid||stock.nodeReset!==reset.lastNodeReset||stock.augReset!==reset.lastAugReset||
  !Number.isFinite(stock.at)||stock.at>now||now-stock.at>60000||stock.fourSigmaFunding?.enabled!==true)return no('No live enabled stock controller quote');
 const fraction=stock.fourSigmaFunding.budgetFraction,reserve=stock.reserve;
 if(!Number.isFinite(fraction)||fraction<=0||fraction>1||!Number.isFinite(reserve)||reserve<0)return no('Stock purchase budget cannot fund 4S');
 const target=(cost+reserve)/fraction;
 if(!Number.isFinite(target))return no('Stock funding target unavailable');
 const gap=Math.max(0,target-worth);
 let rate=0;
 const evidence=income?.cashObservation,samples=Array.isArray(evidence?.samples)?evidence.samples.slice(-2):[];
 if(income?.augReset===reset.lastAugReset&&Number.isFinite(income.at)&&income.at<=now&&now-income.at<=120000&&
  evidence?.schemaVersion===1&&evidence.augReset===reset.lastAugReset&&evidence.mode==='sources-v1'&&samples.length===2&&
  samples.every(s=>s&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=300000&&Number.isFinite(s.rate)&&s.rate>=0)&&samples[0].at<samples[1].at&&
  now-samples[1].at<=120000&&Number.isFinite(income.cashRate)&&income.cashRate>0)
  rate=Math.min(income.cashRate,...samples.map(s=>s.rate));
 const etaMs=gap===0?0:rate>0?gap/rate*1000:Infinity;
 const limit=Math.min(15*minute,Number.isFinite(paybackMs)?Math.max(0,paybackMs)*.25:15*minute,
  Number.isFinite(remainingMs)&&remainingMs>=0?remainingMs*.1:15*minute);
 if(!Number.isFinite(etaMs)||etaMs>limit||limit<=0)return no('4S funding would delay a useful install too long');
 const same=window?.schemaVersion===1&&window.nodeReset===reset.lastNodeReset&&window.augReset===reset.lastAugReset;
 if(same&&(!Number.isFinite(window.startedAt)||window.startedAt<reset.lastAugReset||window.startedAt>now||!Number.isFinite(window.expiresAt)||
  window.expiresAt<=window.startedAt||window.expiresAt-window.startedAt>15*minute))return no('Invalid saved 4S deadline; proceeding with install');
 const next=same?window:{schemaVersion:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,startedAt:now,expiresAt:now+limit};
 const deadline=Math.min(next.expiresAt,next.startedAt+limit);
 if(now>=deadline||now+etaMs>deadline)return {wait:false,reason:'The bounded 4S wait has expired or cannot fund in time',window:{...next,expiresAt:deadline}};
 return {wait:true,reason:'4S funding is near enough to wait briefly',window:{...next,expiresAt:deadline},etaMs,target,deadline};
}
