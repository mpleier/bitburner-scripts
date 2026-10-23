/** A bounded comparison of useful unlocks; a quoted work/donation plan is counted once. */
export function augmentationReputationForecast(augmentations,context,estimate,{reset=true,marginal=false}={}) {
 const empty={gain:0,grossSavingsMs:0,netSavingsMs:0,rebuildPenaltyMs:0,target:null};
 if(!context||typeof estimate!=='function'||!Array.isArray(augmentations)||!Array.isArray(context.targets)||
  !Number.isFinite(context.horizonMs)||context.horizonMs<=0||!Number.isFinite(context.worth)||context.worth<0||
  !Number.isFinite(context.cashRate)||context.cashRate<0||!Number.isFinite(context.factionCashRate)||context.factionCashRate<0)return empty;
 let multiplier=1;for(const a of augmentations){const v=a?.stats?.faction_rep??1;if(!Number.isFinite(v)||v<=0)return empty;multiplier*=v;}
 if(!Number.isFinite(multiplier)||multiplier<=1)return empty;
 const owned=new Set(augmentations.map(a=>a?.name)),rates=context.repRates||{},reputation=context.reputation||{};
 let best=null;
 for(const target of context.targets.slice(0,4)){
  if(!target||typeof target.name!=='string'||owned.has(target.name)||target.useful!==true||!Number.isFinite(target.cost)||target.cost<0||!Array.isArray(target.requirements)||!target.requirements.length||target.requirements.length>32||
   !target.requirements.every(r=>r&&Number.isFinite(r.rep)&&r.rep>=0&&Array.isArray(r.factions)&&Array.isArray(r.providers)&&r.providers.every(p=>p&&typeof p.faction==='string')))continue;
  const delays=new Map();
  const quote=(boost,rebuilding)=>{
   const rep=rebuilding?Object.fromEntries(Object.keys(reputation).map(f=>[f,0])):reputation;
   const req=target.requirements.map(r=>({...r,providers:(r.providers||[]).map(p=>{
    const gap=Math.max(0,r.rep-(rep[p.faction]||0));
    const donation=p.canDonate===true&&Number.isFinite(context.donationUnitCost)&&context.donationUnitCost>0?
     Math.ceil(gap*context.donationUnitCost/boost):null;
    return {faction:p.faction,requiredDonation:donation};
   })}));
   const input={requirements:req,cost:target.cost,worth:rebuilding?0:context.worth,cashRate:context.cashRate,factionCashRate:context.factionCashRate,
    reputation:rep,repRates:Object.fromEntries(Object.entries(rates).map(([f,rate])=>[f,Number.isFinite(rate)&&rate>0?rate*boost:0])),
    passiveFactions:context.passiveFactions||[],plannedDonations:rebuilding?{}:target.plannedDonations||{}};
   const price=plan=>{
    if(!plan||!Number.isFinite(plan.seconds)||plan.seconds<0)return null;
    let delay=0;
    if(rebuilding){
     for(const [f,seconds]of Object.entries(plan.workByFaction||{}))if(seconds>0){const d=context.recoveryDelays?.[f];
      if(Number.isFinite(d?.joinedMs)&&d.joinedMs>=0)delay=Math.max(delay,d.joinedMs);
      if(Number.isFinite(d?.workMs)&&d.workMs>=0)delay=Math.max(delay,d.workMs);
     }
     for(const [f,amount]of Object.entries(plan.donationsByFaction||{}))if(amount>0){const d=context.recoveryDelays?.[f];if(Number.isFinite(d?.joinedMs)&&d.joinedMs>=0)delay=Math.max(delay,d.joinedMs);}
    }
    const allowance=Number.isFinite(context.recoveryAllowanceMs)&&context.recoveryAllowanceMs>=0?context.recoveryAllowanceMs:0;
    const extra=rebuilding?Math.max(0,delay-allowance):0;
    return {ms:plan.seconds*1000+extra,extra,observed:delay};
   };
   const candidates=[price(estimate(input))];
   // Delays may make another funding method faster; keep two bounded alternatives.
   if(rebuilding&&context.recoveryDelays&&Object.keys(context.recoveryDelays).length){
    candidates.push(price(estimate({...input,repRates:{}})));
    candidates.push(price(estimate({...input,requirements:req.map(r=>({...r,providers:r.providers.map(p=>({...p,requiredDonation:null}))}))})));
   }
   const best=candidates.filter(Boolean).sort((a,b)=>a.ms-b.ms)[0];
   if(best)delays.set(boost+':'+rebuilding,best);
   return best?.ms??null;
  };
  const stay=quote(1,false),rebuild=quote(1,reset),boosted=quote(multiplier,reset);
  if(stay===null||rebuild===null||boosted===null||stay>context.horizonMs||boosted>context.horizonMs)continue;
  const gross=Math.min(context.horizonMs,Math.max(0,rebuild-boosted)),net=Math.max(0,stay-boosted),penalty=Math.max(0,rebuild-stay);
  // One useful unlock, never the sum of overlapping prerequisite/faction goals.
  const score=marginal||!reset?gross:net;
  if(!best||score>best.score)best={score,gain:Math.min(.5,net/context.horizonMs),grossSavingsMs:gross,netSavingsMs:net,rebuildPenaltyMs:penalty,
   target:target.name,stayMs:stay,resetWithoutBoostMs:rebuild,resetWithBoostMs:boosted,multiplier,
   factionRecoveryMs:delays.get(multiplier+':'+reset)?.observed??0,extraFactionRecoveryMs:delays.get(multiplier+':'+reset)?.extra??0};
 }
 if(!best)return empty;const {score,...result}=best;return result;
}

/** A purchase planner may reuse only a fresh quote for exactly the current native ownership. */
export function readAugmentationReputationContext(ns,ownership,now=Date.now()) {
 try{const r=ns.getResetInfo(),record=JSON.parse(ns.read('tasks/progression-speed.json')),c=record.reputationPlanningContext;
  return ownership?.complete===true&&typeof ownership.signature==='string'&&ownership.signature.length>0&&c?.schemaVersion===1&&c.nodeReset===r.lastNodeReset&&c.augReset===r.lastAugReset&&c.ownershipSignature===ownership.signature&&
   Number.isFinite(c.horizonMs)&&c.horizonMs>0&&Array.isArray(c.targets)&&
   Number.isFinite(c.at)&&c.at<=now&&now-c.at<=60000?c:null;
 }catch{return null;}
}
