/** Milestone policy. Unknown measurements never justify erasing reputation. */
const positive=x=>Number.isFinite(x)&&x>0;
const nonnegative=x=>Number.isFinite(x)&&x>=0;
export function planRedPill(s, observation={}, {route='hacking',recoveryMs=600000}={}) {
    const base={active:false,stage:'inactive',holdResets:false,reserve:0,reason:'World Daemon is not the selected route'};
    if(route!=='hacking')return base;
    if(s.hasRedPill)return {...base,stage:'installed',holdResets:true,reason:'The Red Pill is installed; preserve hacking progress toward WD'};
    if(s.queuedRedPill)return {...base,active:true,stage:'install',holdResets:true,reason:'The Red Pill is queued; install it before optional upgrades'};
    if(!s.singularityKnown)return {...base,stage:'unknown',reason:'Red Pill APIs unavailable; native requirements must be confirmed'};
    if(!s.daedalus) {
        const ready=positive(s.daedalusAugsRequired)&&s.installedAugs>=s.daedalusAugsRequired&&
            (s.hacking>=2500||s.combatReady);
        return {...base,active:ready,stage:ready?'join':'prepare',holdResets:ready,
            reserve:ready?100e9:0,reason:ready?'Preserve the Daedalus invitation requirements':'Build augmentation count and entry stats before committing to Daedalus'};
    }
    if(s.redPillOffered!==true)return {...base,stage:'unavailable',reason:'Daedalus does not offer The Red Pill in this node'};
    if(!positive(s.redPillRep)||!nonnegative(s.redPillPrice)||!nonnegative(s.rep))
        return {...base,stage:'unknown',reason:'Incomplete native Red Pill requirements'};
    const gap=Math.max(0,s.redPillRep-s.rep),canDonate=nonnegative(s.favor)&&nonnegative(s.favorToDonate)&&s.favor>=s.favorToDonate&&positive(s.repPerDollar);
    const donationCost=canDonate?gap/s.repPerDollar:null;
    const target=s.redPillPrice+(donationCost||0)+1e9;
    const repMs=gap===0?0:positive(observation.repRate)?gap/observation.repRate*1000:null;
    const cashGap=Math.max(0,target-s.worth),cashMs=cashGap===0?0:positive(observation.cashRate)?cashGap/observation.cashRate*1000:null;
    // Only reset for donation access when the complete post-reset bill is funded and a conservative
    // recovery allowance beats measured direct progress by 25%. Already unlocked access never qualifies.
    const postResetBill=positive(s.repPerDollar)?s.redPillRep/s.repPerDollar+s.redPillPrice+1e9:null;
    const favorReset=!canDonate&&positive(s.favorToDonate)&&nonnegative(s.favorGain)&&
        s.favor+s.favorGain>=s.favorToDonate&&positive(postResetBill)&&s.worth>=Math.max(100e9,postResetBill)&&
        positive(repMs)&&recoveryMs<repMs*.75;
    return {...base,active:true,stage:cashGap===0&&(gap===0||canDonate)?'buy':gap===0?'fund':favorReset?'favor-reset':canDonate?'fund-and-work':'reputation',
        holdResets:!favorReset,allowFavorReset:favorReset,requiredRep:s.redPillRep,rep:s.rep,remainingRep:gap,worth:s.worth,
        canDonate,favor:s.favor,favorGain:s.favorGain,favorToDonate:s.favorToDonate,repPerDollar:positive(s.repPerDollar)?s.repPerDollar:null,donationCost,targetCash:target,
        // Existing stockmaster investment uses its explicit zero reserve; discretionary purchases save this target.
        reserve:target,
        repEtaMs:repMs,cashEtaMs:cashMs,postResetBill,
        reason:gap===0?'Red Pill reputation complete; purchase it':favorReset?'A funded donation-access reset beats measured direct work':
            canDonate?'Save the complete donation bill while earning Daedalus reputation':'Earn Daedalus reputation directly; donation access is not yet worth a reset'};
}

/** Rank infiltration choices by effective Daedalus reputation per unit time. */
export function redPillInfiltrationChoices(locations, plan) {
    if(!plan?.active||!['reputation','fund-and-work','fund'].includes(plan.stage))return [];
    const result=[];
    const needed=plan.canDonate?Math.min(plan.remainingRep,Math.max(0,plan.targetCash-plan.worth)*plan.repPerDollar):plan.remainingRep;
    for(const info of locations) {
        if(plan.stage==='fund'){if(positive(info.reward?.sellCash))result.push({...info,reward:{...info.reward,tradeRep:Math.min(Math.max(0,plan.targetCash-plan.worth),info.reward.sellCash)},redPillReward:'money'});continue;}
        if(positive(info.reward?.tradeRep))result.push({...info,reward:{...info.reward,tradeRep:Math.min(needed,info.reward.tradeRep)},redPillReward:'reputation'});
        if(plan.canDonate&&positive(plan.repPerDollar)&&positive(info.reward?.sellCash))
            result.push({...info,reward:{...info.reward,tradeRep:Math.min(needed,info.reward.sellCash*plan.repPerDollar)},redPillReward:'money'});
    }
    return result;
}

/** Serialized native transaction: no partial donation, no basket purchases, no installation. */
export const purchaseRedPillSource = String.raw`function purchaseRedPill(ns,parent,augReset,nodeReset,factionMultiplier,allowed) {
    const result={status:'waiting'},reset=ns.getResetInfo(),name='The Red Pill';
    if(!allowed()||!ns.isRunning(parent)||reset.lastAugReset!==augReset||reset.lastNodeReset!==nodeReset)return {...result,reason:'Protected activity or reset changed'};
    const owned=ns.singularity.getOwnedAugmentations(true);
    if(owned.includes(name))return {status:'queued'};
    const p=ns.getPlayer();
    if(!p.factions.includes('Daedalus')||!ns.singularity.getAugmentationsFromFaction('Daedalus').includes(name))return {...result,reason:'Red Pill faction unavailable'};
    const price=ns.singularity.getAugmentationPrice(name),required=ns.singularity.getAugmentationRepReq(name),gap=Math.max(0,required-ns.singularity.getFactionRep('Daedalus'));
    let donation=0;
    if(gap>0) {
        if(ns.singularity.getFactionFavor('Daedalus')<ns.getFavorToDonate())return {...result,reason:'Need more native reputation'};
        let factor=factionMultiplier;try{factor=ns.getBitNodeMultipliers().FactionWorkRepGain;}catch{}
        const rate=p.mults.faction_rep*factor/1e6;
        if(!(Number.isFinite(rate)&&rate>0))return {...result,reason:'Donation conversion unavailable'};
        donation=Math.ceil(gap/rate)+1;
    }
    if(!Number.isFinite(price)||!Number.isFinite(donation)||ns.getPlayer().money<price+donation+1e9)return {...result,reason:'Complete donation and purchase budget not funded'};
    if(!allowed())return {...result,reason:'Control changed'};
    if(donation>0&&!ns.singularity.donateToFaction('Daedalus',donation))return {...result,reason:'Native donation rejected'};
    if(ns.singularity.getFactionRep('Daedalus')<required)return {...result,reason:'Native reputation still below requirement'};
    if(!allowed())return {...result,reason:'Control changed after donation'};
    return ns.singularity.purchaseAugmentation('Daedalus',name)?{status:'queued',donation,price}:{...result,reason:'Native purchase rejected'};
}
`;
