/** Completion forecasts at current capabilities, not promises about future upgrades. */
export const nodeRouteFile = 'tasks/node-route-plan.json';
const minute = 60000;
const positive = x => Number.isFinite(x) && x > 0;
const finite = x => Number.isFinite(x) && x >= 0;
const unknown = reason => ({etaMs:null,lowerMs:null,upperMs:null,reason,actionable:false});

/** Keep income and dedicated XP observations separate. Reset all evidence after an install. */
export function sampleRouteProgress(previous, sample) {
    let samples = previous?.samples || [], xpModes = previous?.xpModes || {};
    const last = samples.at(-1);
    if (!sample || !finite(sample.at) || !finite(sample.exp) || !positive(sample.hackMult))
        return {samples:[],xpModes:{},sampling:true};
    if (last && (last.augReset !== sample.augReset || last.nodeReset !== sample.nodeReset ||
        last.hackingMultiplier !== sample.hackingMultiplier || Math.abs(last.hackMult/sample.hackMult-1)>.01 || sample.exp < last.exp || sample.at < last.at || sample.at-last.at > 45000)) {
        samples=[]; xpModes={};
    }
    if (samples.at(-1)?.at !== sample.at) samples = [...samples,sample];
    samples = samples.filter(s => sample.at-s.at <= 5*minute);
    // A mode change starts a new segment; otherwise mixed observations understate dedicated XP.
    let start=samples.length-1;
    while(start>0 && samples[start-1].xpMode===sample.xpMode) start--;
    const segment=samples.slice(start), first=segment[0], seconds=(sample.at-first.at)/1000;
    if(seconds>=60 && segment.length>=3) {
        const middle=segment[Math.floor(segment.length/2)], halfSeconds=(sample.at-middle.at)/1000;
        const rate=Math.max(0,(sample.exp-first.exp)/seconds);
        const recent=halfSeconds>0?Math.max(0,(sample.exp-middle.exp)/halfSeconds):rate;
        xpModes={...xpModes,[sample.xpMode]:{at:sample.at,rate,low:Math.min(rate,recent)*.75,high:Math.max(rate,recent)*1.25}};
    }
    const fresh=entry => entry && sample.at-entry.at <= 10*minute;
    xpModes=Object.fromEntries(Object.entries(xpModes).filter(([,v])=>fresh(v)));
    const firstSample=samples[0], elapsed=(sample.at-firstSample.at)/1000;
    const cashRate=elapsed>=60?Math.max(0,(sample.worth-firstSample.worth)/elapsed):0;
    const repRate=elapsed>=60 && finite(sample.rep) && finite(firstSample.rep)?Math.max(0,(sample.rep-firstSample.rep)/elapsed):0;
    return {samples,xpModes,cashRate,repRate,sampling:elapsed<60};
}

export function estimateDaemonRoute(snapshot, observation) {
    const s=snapshot, stages=[];
    if(!s.hasRedPill) {
        if(!s.singularityKnown)return {...unknown('Singularity unavailable; Red Pill requirements cannot be measured'),stages};
        if(s.queuedRedPill)stages.push({name:'Install The Red Pill',etaMs:null});
        else if(!s.daedalus)stages.push({name:'Join Daedalus (augmentation, wealth and stat requirements)',etaMs:null});
        else {
            const gapCash=Math.max(0,s.redPillPrice-s.worth),gapRep=Math.max(0,s.redPillRep-s.rep);
            const cashMs=gapCash===0?0:positive(observation.cashRate)?gapCash/observation.cashRate*1000:null;
            const repMs=gapRep===0?0:positive(observation.repRate)?gapRep/observation.repRate*1000:null;
            stages.push({name:'Buy The Red Pill',cashMs,repMs,etaMs:cashMs!==null&&repMs!==null?Math.max(cashMs,repMs):null});
            stages.push({name:'Install and measure XP after reset',etaMs:null});
        }
        // Pre-install XP multipliers and rates cannot safely predict the post-reset route.
        return {...unknown(stages[0]?.name || 'The Red Pill is not installed'),stages};
    }
    if(!positive(s.wdHack))return {...unknown('Waiting for the native daemon hacking requirement'),stages};
    if(s.hacking>=s.wdHack)return {etaMs:0,lowerMs:0,upperMs:0,actionable:true,phase:'backdoor',reason:'Hacking requirement met; root and departure handled by autopilot',stages};
    const requiredExp=Math.max(0,Math.exp((s.wdHack/s.hackMult+200)/32)-534.6);
    const gap=Math.max(0,requiredExp-s.exp), dedicated=observation.xpModes?.xp;
    const measured=dedicated || observation.xpModes?.income;
    if(!measured || !positive(measured.low) || !positive(measured.high) || !Number.isFinite(requiredExp))
        return {...unknown('Need at least 60 seconds of measured hacking XP'),stages};
    return {etaMs:gap/measured.rate*1000,lowerMs:gap/measured.high*1000,upperMs:gap/measured.low*1000,
        actionable:!!dedicated,phase:'xp',xpGap:gap,xpRate:measured.rate,
        reason:dedicated?'Measured dedicated XP; assumes current multipliers and throughput':'Income-mode XP estimate; awaiting a dedicated XP observation',stages};
}

/** Simulate ordered BlackOps, credit their rank rewards, consume available grinding actions. */
export function estimateBladeburnerRoute(bb, threshold=.99) {
    if(!bb || bb.error)return unknown(bb?.error || 'Bladeburner API unavailable or division not joined');
    if(bb.disabled)return unknown('Bladeburner automation disabled or paused');
    if(!Array.isArray(bb.ops))return unknown('Missing native BlackOp data');
    if(!bb.ops.length)return {etaMs:0,lowerMs:0,upperMs:0,actionable:true,reason:'All BlackOps completed'};
    let rank=bb.rank, work=0, reason=null;
    if(!finite(rank))return unknown('Missing native rank');
    const pools=(bb.actions||[]).filter(a=>positive(a.time)&&a.chance?.[0]>=threshold&&a.count>=1)
        .map(a=>({...a,count:Math.floor(a.count),net:a.chance[0]*a.gain-(1-a.chance[0])*a.loss}))
        .filter(a=>positive(a.net)).sort((a,b)=>b.net/b.time-a.net/a.time);
    const grind=gap=>{
        for(const a of pools) {
            if(gap<=0)break;
            const count=Math.min(a.count,Math.ceil(gap/a.net));
            a.count-=count;rank+=count*a.net;gap-=count*a.net;work+=count*a.time;
        }
        return gap<=0;
    };
    for(const op of bb.ops) {
        const p=op.chance?.[0];
        if(!positive(op.time)||!finite(op.required)||!finite(op.gain)||!finite(op.loss)) {reason='Incomplete native BlackOp data';break;}
        if(!(p>=threshold&&p<=1)) {reason='Improve skills, team or population estimates for '+op.name;break;}
        // Replace expected failed-attempt rank losses before each operation, then credit its reward.
        const loss=op.loss*(1-p)/p;
        if(!grind(Math.max(0,op.required+loss-rank))) {reason='Available safe contracts/operations cannot yet supply the required rank';break;}
        work+=op.time/p;rank+=op.gain-loss;
    }
    if(reason)return {...unknown(reason),next:bb.ops[0]?.name,completedStagesMs:work};
    // Native bonus time is consumed at up to 5x speed. Allow recovery, chaos and recruitment overhead.
    const wall=duration=>Math.max(duration/5,duration-Math.max(0,bb.bonusTime||0));
    return {etaMs:wall(work/.75),lowerMs:wall(work),upperMs:wall(work/.5),actionable:true,
        reason:'Current safe actions, finite action supply and ordered BlackOps; 50–100% active duty range',next:bb.ops[0]?.name};
}

/** Require a 25% advantage across estimate ranges for two minutes before a priority switch. */
export function selectNodeRoute(routes, previous, {now=Date.now(),augReset,nodeReset}={}) {
    const same=previous?.augReset===augReset&&previous?.nodeReset===nodeReset&&previous?.at<=now&&now-previous.at<=45000;
    const prior=same?previous:null;
    const known=r=>r?.actionable===true&&finite(r.lowerMs)&&finite(r.upperMs);
    const wd=routes.hacking,bb=routes.bladeburner;
    let winner=null;
    if(known(wd)&&known(bb)) {
        if(wd.upperMs<bb.lowerMs*.75)winner='hacking';
        else if(bb.upperMs<wd.lowerMs*.75)winner='bladeburner';
    }
    // Discard a committed route as soon as its evidence ceases to be usable.
    let selected=prior?.selected&&known(routes[prior.selected])&&known(routes[prior.selected==='hacking'?'bladeburner':'hacking'])?prior.selected:null;
    const candidate=winner&&winner!==selected?winner:null;
    const candidateSince=candidate===prior?.candidate?prior.candidateSince:now;
    if(candidate&&now-candidateSince>=2*minute)selected=candidate;
    return {at:now,augReset,nodeReset,selected,candidate,candidateSince,reason:selected?'Priority: '+selected+' (stable comparison)':candidate?'Comparing '+candidate+' advantage for two minutes':'No reliable separation; preserve parallel progress',routes};
}

/** Only live, current-reset autopilot plans may change another manager's behaviour. */
export function readNodeRoutePlan(ns, now=Date.now()) {
    try {
        const p=JSON.parse(ns.read('tasks/node-route-plan.json')),r=ns.getResetInfo();
        if(!Number.isFinite(p.at)||p.at>now||now-p.at>45000||p.augReset!==r.lastAugReset||p.nodeReset!==r.lastNodeReset)return null;
        if(!ns.ps('home').some(s=>s.pid===p.ownerPid&&s.filename.replace(/^\//,'')==='autopilot.js'))return null;
        return p;
    }catch{return null;}
}

/** Read-only snapshot, also serialized into the RAM-dodging native worker. */
export function nodeRouteSnapshotSource(canSingularity, canBladeburner) {
    return String.raw`(() => {
    const p=ns.getPlayer(),r=ns.getResetInfo(),owned=r.ownedAugs;
    const names=typeof owned?.keys==='function'?[...owned.keys()]:Object.keys(owned||{});
    const s={at:Date.now(),augReset:r.lastAugReset,nodeReset:r.lastNodeReset,exp:p.exp.hacking,hacking:p.skills.hacking,
        hackMult:p.mults.hacking,hackingMultiplier:p.mults.hacking,hasRedPill:names.includes('The Red Pill'),simulacrum:names.includes("The Blade's Simulacrum"),
        worth:p.money,rep:null,wdHack:null,singularityKnown:false};
    try{s.hackMult*=ns.getBitNodeMultipliers().HackingLevelMultiplier;}
    catch{const base=32*Math.log(p.exp.hacking+534.6)-200;s.hackMult=base>0?(p.skills.hacking+.5)/base:null;}
    try{if(ns.serverExists('w0r1d_d43m0n'))s.wdHack=ns.getServerRequiredHackingLevel('w0r1d_d43m0n');}catch{}
    const daemon=ns.ps('home').find(p=>p.filename.replace(/^\//,'')==='daemon.js');
    s.xpMode=daemon?.args.includes('--xp-only')?'xp':daemon?'income':'off';
${canSingularity?`    try {
        s.queuedRedPill=ns.singularity.getOwnedAugmentations(true).includes('The Red Pill');
        s.work=ns.singularity.getCurrentWork();
        s.daedalus=p.factions.includes('Daedalus');
        s.rep=s.daedalus?ns.singularity.getFactionRep('Daedalus'):null;
        s.redPillPrice=ns.singularity.getAugmentationPrice('The Red Pill');
        s.redPillRep=ns.singularity.getAugmentationRepReq('The Red Pill');
        s.singularityKnown=true;
    }catch{}
`:''}
${canBladeburner?`    try {
        if(ns.bladeburner.inBladeburner()) {
            const action=(type,name)=>({name,time:ns.bladeburner.getActionTime(type,name),chance:ns.bladeburner.getActionEstimatedSuccessChance(type,name),
                gain:ns.bladeburner.getActionRankGain(type,name),loss:ns.bladeburner.getActionRankLoss(type,name),count:ns.bladeburner.getActionCountRemaining(type,name)});
            s.bb={rank:ns.bladeburner.getRank(),action:ns.bladeburner.getCurrentAction(),bonusTime:ns.bladeburner.getBonusTime(),
                ops:ns.bladeburner.getBlackOpNames().filter(n=>ns.bladeburner.getActionCountRemaining('Black Operations',n)>0)
                    .map(n=>({...action('Black Operations',n),required:ns.bladeburner.getBlackOpRank(n)})),
                actions:[...ns.bladeburner.getContractNames().map(n=>action('Contracts',n)),...ns.bladeburner.getOperationNames().map(n=>action('Operations',n))]};
        }
    }catch(error){s.bb={error:String(error)};}
`:''}
    return s;
})()`;
}
