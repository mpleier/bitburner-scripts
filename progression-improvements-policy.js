/** Decisions driven by recent evidence; no native mutations. */
export function adaptiveHgwTiming(previous,telemetry,{now=Date.now(),baseCycleMs=4000,baseQueueMs=100,targetCount=2}={}) {
 const base=Number.isFinite(baseCycleMs)&&baseCycleMs>0?baseCycleMs:4000;
 const counts=telemetry?.counts,operations=counts?.operations,late=counts?.deadlineOverruns;
 const valid=telemetry&&!telemetry.blocked&&Number.isFinite(telemetry.at)&&telemetry.at<=now&&now-telemetry.at<=15000&&Number.isSafeInteger(operations)&&Number.isSafeInteger(late)&&operations>=0&&late>=0&&late<=operations;
 const same=!!previous&&previous.augReset===telemetry?.augReset&&previous?.nodeReset===telemetry?.nodeReset&&previous.baseCycleMs===base&&previous.at<=now;
 const spacingCounts=Number.isSafeInteger(counts?.spacingSamples)&&Number.isSafeInteger(counts?.spacingRisks)&&counts.spacingSamples>=0&&counts.spacingRisks>=0&&counts.spacingRisks<=counts.spacingSamples;
 let state=same?{...previous}:{augReset:telemetry?.augReset,nodeReset:telemetry?.nodeReset,baseCycleMs:base,multiplier:1,cleanWindows:0,windowAt:now,operations:operations||0,late:late||0,changedAt:0};
 if (!Number.isSafeInteger(state.spacingSamples)) state.spacingSamples = spacingCounts ? counts.spacingSamples : 0;
 if (!Number.isSafeInteger(state.spacingRisks)) state.spacingRisks = spacingCounts ? counts.spacingRisks : 0;
 if(valid&&now-state.windowAt>=30000){
  const n=operations-state.operations,rawBad=late-state.late;
  const samples=spacingCounts?counts.spacingSamples-state.spacingSamples:0;
  const risks=spacingCounts?counts.spacingRisks-state.spacingRisks:0;
  const spacingComplete=n>0&&samples===n&&risks>=0&&risks<=n;
  const bad=spacingComplete?risks:rawBad;
  if(n<0||rawBad<0||bad<0){state.windowAt=now;state.operations=operations;state.late=late;state.spacingSamples=counts?.spacingSamples||0;state.spacingRisks=counts?.spacingRisks||0;}
  // Three confirmed spacing risks are actionable even when slow operations keep traffic sparse.
  else if(n>=20||n>=8&&now-state.windowAt>=120000||spacingComplete&&n>=3&&risks===n){
   const lowTraffic=n<20;
   state.completionsPerSecond=n/Math.max(1,(now-state.windowAt)/1000);
   state.lateFraction=rawBad/n;state.riskFraction=bad/n;state.evidenceMode=spacingComplete?'half-leg-spacing':'deadline-fallback';state.windowOperations=n;
   if(bad>=3&&bad/n>=.05){state.cleanWindows=0;if(now-state.changedAt>=60000){state.multiplier=Math.min(4,state.multiplier*1.5);state.changedAt=now;}}
   else if(bad/n<=.01){state.cleanWindows++;if(state.cleanWindows>=(lowTraffic?2:3)&&now-state.changedAt>=120000){state.multiplier=Math.max(1,state.multiplier/1.25);state.changedAt=now;state.cleanWindows=0;}}
   else state.cleanWindows=0;
   state.windowAt=now;state.operations=operations;state.late=late;state.spacingSamples=counts?.spacingSamples||0;state.spacingRisks=counts?.spacingRisks||0;
  }
 }
 state.at=now;state.cycleMs=Math.ceil(base*state.multiplier);state.queueMs=Math.max(baseQueueMs,Math.ceil(baseQueueMs*state.multiplier));
 state.targetCap=Math.max(1,Math.round(Math.max(1,targetCount)/state.multiplier));
 state.reason=!valid?'Timing evidence unavailable; retaining the current pacing':state.multiplier>1?'Back off after sustained late completions; recover gradually after clean windows':'Normal pacing';
 return state;
}

/** Preserve measured backoff through hot reloads; never resurrect another reset's counters. */
export function restoreHgwTiming(saved, telemetry, now = Date.now()) {
 if (!saved || saved.augReset !== telemetry?.augReset || saved.nodeReset !== telemetry?.nodeReset ||
     !Number.isFinite(saved.at) || saved.at > now || now - saved.at > 120000 ||
     !Number.isFinite(saved.multiplier) || saved.multiplier < 1 || saved.multiplier > 4 ||
     !Number.isFinite(saved.baseCycleMs) || saved.baseCycleMs <= 0 ||
     !Number.isFinite(saved.windowAt) || saved.windowAt > now || saved.windowAt < 0 ||
     !Number.isFinite(saved.changedAt) || saved.changedAt > now || saved.changedAt < 0 ||
     !Number.isSafeInteger(saved.cleanWindows) || saved.cleanWindows < 0 || saved.cleanWindows > 3 ||
     !Number.isSafeInteger(saved.operations) || saved.operations < 0 || saved.operations > telemetry?.counts?.operations ||
     !Number.isSafeInteger(saved.late) || saved.late < 0 || saved.late > saved.operations || saved.late > telemetry?.counts?.deadlineOverruns) return null;
 return { ...saved };
}

/** A queued augmentation alone is not a scheduled reset. */
export function graftResetBlocked(plan,reset,processes,now=Date.now()) {
 return !!(plan?.pending&&Number.isFinite(plan.expiresAt)&&plan.expiresAt>now&&plan.expiresAt<=now+180000&&
  (plan.augReset===undefined||plan.augReset===reset.lastAugReset)&&
  processes.some(p=>p.pid===plan.ownerPid&&String(p.filename||'').replace(/^\//,'')==='autopilot.js'));
}

/** Exclude archived corporation data without deleting useful history. */
export function currentCorporationStatus(record,reset,processes,now=Date.now()) {
 if(!record||!Number.isFinite(record.at)||record.at>now||now-record.at>120000||record.at<Math.max(reset.lastNodeReset||0,reset.lastAugReset||0))return null;
 if(record.nodeReset!==undefined&&record.nodeReset!==reset.lastNodeReset||record.augReset!==undefined&&record.augReset!==reset.lastAugReset)return null;
 return processes.some(p=>p.pid===record.pid&&String(p.filename||'').replace(/^\//,'')==='corporation-manager.js')?record:null;
}

/** Reserve a reachable, useful augmentation bill; far-away targets do not freeze spending. */
export function augmentationSavingsTarget(snapshot,reset,money,route,now=Date.now()) {
 if(!snapshot||snapshot.augReset!==reset.lastAugReset||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>300000||!(money>0))return null;
 const useful=stats=>route==='bladeburner'?['strength','defense','dexterity','agility','strength_exp','defense_exp','dexterity_exp','agility_exp','bladeburner_success_chance','bladeburner_max_stamina','bladeburner_stamina_gain'].some(k=>Number(stats?.[k])>=1.05):
  ['hacking','hacking_exp','hacking_speed','faction_rep'].some(k=>Number(stats?.[k])>=1.05);
 return (snapshot.targets||[]).filter(t=>Number.isFinite(t.directCost)&&t.directCost>money*.25&&t.directCost<=money*3&&
  t.factions?.some(f=>Number(snapshot.reputation?.[f])>=t.rep)&&
  (['The Red Pill',"The Blade's Simulacrum"].includes(t.name)||useful(t.stats)))
  .sort((a,b)=>Number(!['The Red Pill',"The Blade's Simulacrum"].includes(a.name))-Number(!['The Red Pill',"The Blade's Simulacrum"].includes(b.name))||a.directCost-b.directCost)
  .map(t=>({name:t.name,cost:t.directCost}))[0]||null;
}

/** Shared hash reserve, recalculated immediately before every native purchase. */
export function routeHashBudget(action,{route,priorityActive=false,priorityActions=null,costs={},hashes=0,capacity=0,overflowBuffer=1,rankSpGain=0}={}) {
 if(!(hashes>0))return 0;
 if(route?.selected!=='bladeburner'||!priorityActive)return hashes;
 const rank='Exchange for Bladeburner Rank',sp='Exchange for Bladeburner SP';
 const need=route.development?.nextBlackOp;
 const preferred=need&&need.rankGap<=0?(rankSpGain>0&&costs[rank]/rankSpGain<=costs[sp]/10?rank:sp):costs[sp]>0&&costs[rank]>0&&costs[sp]*2<costs[rank]?sp:rank;
 const selected=Array.isArray(priorityActions)&&!priorityActions.includes(preferred)?priorityActions.find(name=>[rank,sp].includes(name)):preferred;
 const cost=costs[selected];if(!Number.isFinite(cost)||cost<=0)return hashes;
 if(action===selected)return hashes;
 // If the priority cannot fit in capacity yet, permit only imminent overflow; capacity management can expand it.
 const hold=Math.min(cost,Math.max(0,capacity-Math.max(1,overflowBuffer)));
 return Math.max(0,hashes-hold);
}
