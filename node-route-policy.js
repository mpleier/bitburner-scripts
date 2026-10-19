import {readXpCapacity,xpCapacityKey} from './xp-capacity-policy.js';
import {bladeburnerStaminaChance} from './bladeburner-policy.js';
import {blackOpMetadata,bladeburnerDifficulty} from './bladeburner-action-data.js';
/** Completion forecasts at current capabilities, not promises about future upgrades. */
export const nodeRouteFile = 'tasks/node-route-plan.json';
const minute = 60000;
const positive = x => Number.isFinite(x) && x > 0;
const finite = x => Number.isFinite(x) && x >= 0;
const unknown = reason => ({etaMs:null,lowerMs:null,upperMs:null,reason,actionable:false});

/** Native skill inverse, including the upward rounding needed at an integer level boundary.
 * Self-contained because the same function is embedded in the read-only snapshot worker. */
export function routeRequiredExperience(skill,multiplier) {
    if(!Number.isSafeInteger(skill)||skill<1||!Number.isFinite(multiplier)||multiplier<=0)return null;
    let value=Math.max(0,Math.exp((skill/multiplier+200)/32)-534.6);
    if(!Number.isFinite(value))return null;
    const level=exp=>Math.max(1,Math.floor(multiplier*(32*Math.log(exp+534.6)-200)));
    let delta=Math.max(Number.MIN_VALUE,Math.abs(value*Number.EPSILON));
    for(let i=0;i<64&&level(value)<skill;i++){value+=delta;delta*=2;}
    return Number.isFinite(value)&&level(value)>=skill?value:null;
}

/** Keep income and dedicated XP observations separate. Reset all evidence after an install. */
export function sampleRouteProgress(previous, sample) {
    let samples=Array.isArray(previous?.samples)?previous.samples:[],xpModes=previous?.xpModes&&typeof previous.xpModes==='object'&&!Array.isArray(previous.xpModes)?previous.xpModes:{};
    if(!samples.every((s,i)=>s&&finite(s.at)&&finite(s.exp)&&positive(s.hackMult)&&(!i||s.at>=samples[i-1].at&&s.augReset===samples[i-1].augReset&&s.nodeReset===samples[i-1].nodeReset))){samples=[];xpModes={};}
    const last = samples.at(-1);
    if (!sample || !finite(sample.at) || !finite(sample.exp) || !positive(sample.hackMult))
        return {samples:[],xpModes:{},sampling:true};
    if (last && (last.augReset !== sample.augReset || last.nodeReset !== sample.nodeReset ||
        last.skillModel!==sample.skillModel||last.xpMultiplier!==sample.xpMultiplier||
        Math.abs(last.hackingMultiplier/sample.hackingMultiplier-1)>.01 || Math.abs(last.hackMult/sample.hackMult-1)>.01 || sample.exp < last.exp || sample.at < last.at || sample.at-last.at > 45000)) {
        samples=[]; xpModes={};
    }
    const capacity=xpCapacityKey(sample);
    if(capacity===null||last&&xpCapacityKey(last)!==capacity)xpModes={};
    if (samples.at(-1)?.at !== sample.at) samples = [...samples,sample];
    samples = samples.filter(s => sample.at-s.at <= 5*minute);
    // A mode change starts a new segment; otherwise mixed observations understate dedicated XP.
    let start=samples.length-1;
    while(start>0 && samples[start-1].xpMode===sample.xpMode&&xpCapacityKey(samples[start-1])===capacity) start--;
    const segment=samples.slice(start), first=segment[0], seconds=(sample.at-first.at)/1000;
    if(capacity!==null&&seconds>=60 && segment.length>=3) {
        const middle=segment[Math.floor(segment.length/2)], halfSeconds=(sample.at-middle.at)/1000;
        const rate=Math.max(0,(sample.exp-first.exp)/seconds);
        const recent=halfSeconds>0?Math.max(0,(sample.exp-middle.exp)/halfSeconds):rate;
        xpModes={...xpModes,[sample.xpMode]:{at:sample.at,capacityKey:capacity,rate,low:Math.min(rate,recent)*.75,high:Math.max(rate,recent)*1.25}};
    }
    const fresh=entry => entry&&Number.isFinite(entry.at)&&entry.at<=sample.at&&sample.at-entry.at<=10*minute&&
        capacity!==null&&(entry.capacityKey??'legacy')===capacity;
    xpModes=Object.fromEntries(Object.entries(xpModes).filter(([,v])=>fresh(v)));
    const firstSample=samples[0], elapsed=(sample.at-firstSample.at)/1000;
    const cashRate=elapsed>=60?Math.max(0,(sample.worth-firstSample.worth)/elapsed):0;
    const repRate=elapsed>=60 && finite(sample.rep) && finite(firstSample.rep)?Math.max(0,(sample.rep-firstSample.rep)/elapsed):0;
    return {samples,xpModes,cashRate,repRate,xpCapacityState:capacity===null?'waiting':'ready',sampling:elapsed<60||sample.xpMode==='xp'&&(capacity===null||seconds<60)};
}

export function estimateDaemonRoute(snapshot, observation={}) {
    const s=snapshot, stages=[];
    if(!s.hasRedPill) {
        if(!s.singularityKnown)return {...unknown('Singularity unavailable; Red Pill requirements cannot be measured'),stages};
        if(s.queuedRedPill)stages.push({name:'Install The Red Pill',etaMs:null});
        else if(!s.daedalus){
            stages.push({name:'Installed augmentation requirement',current:s.installedAugs,target:s.daedalusAugsRequired,etaMs:null});
            stages.push({name:'Daedalus wealth requirement',gapCash:Math.max(0,100e9-s.worth),etaMs:s.worth>=100e9?0:positive(observation.cashRate)?(100e9-s.worth)/observation.cashRate*1000:null});
            stages.push({name:'Daedalus entry stats',hacking:s.hacking,targetHack:2500,combatReady:s.combatReady,etaMs:s.hacking>=2500||s.combatReady?0:null});
            stages.push({name:'Acquire and install The Red Pill, then measure post-reset XP',etaMs:null});
        }
        else {
            const gapCash=Math.max(0,s.redPillPrice-s.worth),gapRep=Math.max(0,s.redPillRep-s.rep);
            const cashMs=gapCash===0?0:positive(observation.cashRate)?gapCash/observation.cashRate*1000:null;
            const repMs=gapRep===0?0:positive(observation.repRate)?gapRep/observation.repRate*1000:null;
            stages.push({name:'Buy The Red Pill',cashMs,repMs,etaMs:cashMs!==null&&repMs!==null?Math.max(cashMs,repMs):null});
            stages.push({name:'Install and measure XP after reset',etaMs:null});
        }
        // Pre-install XP multipliers and rates cannot safely predict the post-reset route.
        return {...unknown(!s.daedalus&&!s.queuedRedPill?'Join Daedalus or acquire The Red Pill through another unlocked source':stages[0]?.name || 'The Red Pill is not installed'),stages,phase:'prerequisites',partial:true};
    }
    if(!positive(s.wdHack))return {...unknown('Waiting for the native daemon hacking requirement'),stages};
    if(s.hacking>=s.wdHack)return {etaMs:0,lowerMs:0,upperMs:0,actionable:true,phase:'backdoor',reason:'Hacking requirement met; root and departure handled by autopilot',stages};
    const requiredExp=routeRequiredExperience(s.wdHack,s.hackMult);
    if(requiredExp===null)return {...unknown('Effective hacking multiplier or required experience unavailable'),stages};
    const gap=Math.max(0,requiredExp-s.exp), dedicated=observation.xpModes?.xp;
    const measured=dedicated || observation.xpModes?.income;
    const capacity=xpCapacityKey(s);
    if(capacity===null||(s.xpCapacity!==undefined&&measured?.capacityKey!==capacity))
        return {...unknown('Hacking capacity changed or is unavailable; measuring fresh XP'),stages};
    if(finite(s.at)&&(!Number.isFinite(measured?.at)||measured.at>s.at||s.at-measured.at>10*minute))
        return {...unknown('Need fresh measured hacking XP'),stages};
    if(!measured || !positive(measured.rate) || !positive(s.hackMult) || !finite(s.exp) || !positive(measured.low) || !positive(measured.high) || measured.low>measured.rate || measured.rate>measured.high || !Number.isFinite(requiredExp))
        return {...unknown('Need at least 60 seconds of measured hacking XP'),stages};
    if(gap===0)return {...unknown('Hacking level and XP snapshot disagree; waiting for a fresh sample'),stages};
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
    let rank=bb.rank, work=0, recoveryWork=0, reason=null;
    const recoveryKnown=finite(bb.recovery?.regen)&&finite(bb.recovery?.hrc);
    const recoveryFor=action=>{
        if(!recoveryKnown)return 0;
        if(!finite(action.staminaCost))return null;
        const deficit=Math.max(0,action.staminaCost-bb.recovery.regen*action.time/1000),rate=bb.recovery.regen+bb.recovery.hrc;
        return deficit===0?0:positive(rate)?1000*deficit/rate:null;
    };
    if(!finite(rank))return unknown('Missing native rank');
    const pools=(bb.actions||[]).filter(a=>positive(a.time)&&a.chance?.[0]>=threshold&&a.chance[0]<=1&&finite(a.gain)&&finite(a.loss)&&finite(a.count)&&a.count>=1)
        .map(a=>({...a,nativeTime:a.time,recoveryMs:recoveryFor(a),count:Math.floor(a.count),net:a.chance[0]*a.gain-(1-a.chance[0])*a.loss}))
        .filter(a=>a.recoveryMs!==null).map(a=>({...a,time:a.nativeTime+a.recoveryMs}))
        .filter(a=>positive(a.net)).sort((a,b)=>b.net/b.time-a.net/a.time);
    const grind=gap=>{
        for(const a of pools) {
            if(gap<=0)break;
            const count=Math.min(a.count,Math.ceil(gap/a.net));
            a.count-=count;rank+=count*a.net;gap-=count*a.net;work+=count*a.time;recoveryWork+=count*a.recoveryMs;
        }
        return gap<=0;
    };
    for(const [index,op] of bb.ops.entries()) {
        const p=op.chance?.[0];
        if(!positive(op.time)||!finite(op.required)||!finite(op.gain)||!finite(op.loss)) {reason='Incomplete native BlackOp data';break;}
        if(!(p>=threshold&&p<=1)) {reason=op.rawChance?.[0]>=threshold?'Recover stamina or increase maximum stamina for '+op.name:'Improve skills, team or population estimates for '+op.name;break;}
        // Replace expected failed-attempt rank losses before each operation, then credit its reward.
        const loss=op.loss*(1-p)/p;
        if(!grind(Math.max(0,op.required+loss-rank))) {reason='Available safe contracts/operations cannot yet supply the required rank';break;}
        const recoveryMs=recoveryFor(op);
        if(recoveryMs===null){reason='Stamina recovery data unavailable for '+op.name;break;}
        // Failures require another attempt. Recovery after the final success cannot help completion.
        const repeats=index===bb.ops.length-1?(1-p)/p:1/p;
        const overhead=recoveryMs*repeats;
        work+=op.time/p+overhead;recoveryWork+=overhead;rank+=op.gain-loss;
    }
    if(reason)return {...unknown(reason),next:bb.ops[0]?.name,blocked:reason,partial:true,completedStagesMs:work,recoveryMs:recoveryKnown?recoveryWork:null,recoveryModel:recoveryKnown?'amortized-native':'duty-range',rankAfterStages:rank};
    // Native bonus time is consumed at up to 5x speed. Allow recovery, chaos and recruitment overhead.
    const wall=duration=>Math.max(duration/5,duration-Math.max(0,bb.bonusTime||0));
    return {etaMs:wall(work/.75),lowerMs:wall(work),upperMs:wall(work/.5),actionable:true,
        reason:'Current safe actions, finite supply and ordered BlackOps; '+(recoveryKnown?'native recovery costs plus chaos/recruitment allowance':'recovery unknown; 50–100% active duty range'),recoveryMs:recoveryKnown?recoveryWork:null,recoveryModel:recoveryKnown?'amortized-native':'duty-range',staminaRecovery:recoveryKnown?{regen:bb.recovery.regen,hrc:bb.recovery.hrc}:null,next:bb.ops[0]?.name};
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
export function nodeRouteSnapshotSource(canSingularity, canBladeburner, multipliers={}) {
    const suppliedHacking=Number.isFinite(multipliers.HackingLevelMultiplier)&&multipliers.HackingLevelMultiplier>=0;
    return String.raw`(() => {
    const p=ns.getPlayer(),r=ns.getResetInfo(),owned=r.ownedAugs;
    const requiredExperience=(${routeRequiredExperience.toString()});
    const names=typeof owned?.keys==='function'?[...owned.keys()]:Object.keys(owned||{});
    const combat=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>{
        const quoted=(${JSON.stringify({strength:multipliers.StrengthLevelMultiplier,defense:multipliers.DefenseLevelMultiplier,dexterity:multipliers.DexterityLevelMultiplier,agility:multipliers.AgilityLevelMultiplier})})[k];
        const nodeMult=quoted===undefined?1:Number.isFinite(quoted)&&quoted>=0?quoted:null;
        const mult=nodeMult===null?null:p.mults[k]*nodeMult;
        return [k,{level:p.skills[k],exp:p.exp[k],mult,requiredExp:requiredExperience(100,mult)}];
    }));
    const s={combat,at:Date.now(),augReset:r.lastAugReset,nodeReset:r.lastNodeReset,exp:p.exp.hacking,hacking:p.skills.hacking,
        skillModel:'bn-effective-v2',xpMultiplier:p.mults.hacking_exp,hackMult:p.mults.hacking,hackingMultiplier:p.mults.hacking,hasRedPill:names.includes('The Red Pill'),simulacrum:names.includes("The Blade's Simulacrum"),
        money:p.money,worth:p.money,rep:null,wdHack:null,singularityKnown:false,node:r.currentNode,installedAugs:names.length,
        combatReady:['strength','defense','dexterity','agility'].every(k=>p.skills[k]>=1500),
        daedalusAugsRequired:${JSON.stringify(multipliers.DaedalusAugsRequirement??null)},
        repPerDollar:p.mults.faction_rep*${JSON.stringify(multipliers.FactionWorkRepGain??0)}/1e6};
${suppliedHacking?`    s.hackMult*=${JSON.stringify(multipliers.HackingLevelMultiplier)};s.hackMultBasis='bitnode-supplied';`:`    try{
        const factor=ns.getBitNodeMultipliers().HackingLevelMultiplier;
        if(!Number.isFinite(factor)||factor<0)throw Error('Invalid native hacking multiplier');
        s.hackMult*=factor;s.hackMultBasis='bitnode-native';
    }catch{
        const base=32*Math.log(p.exp.hacking+534.6)-200;
        s.hackMult=p.skills.hacking>1&&Number.isFinite(base)&&base>0?p.skills.hacking/base*(1-4*Number.EPSILON):null;
        s.hackMultBasis=s.hackMult===null?'unavailable':'skill-lower-bound';
    }`}
    try{if(ns.serverExists('w0r1d_d43m0n'))s.wdHack=ns.getServerRequiredHackingLevel('w0r1d_d43m0n');}catch{}
    const daemon=ns.ps('home').find(p=>p.filename.replace(/^\//,'')==='daemon.js');
    s.xpMode=daemon?.args.includes('--xp-only')||daemon?.args.includes('-x')||daemon?.args.includes('--x')?'xp':daemon?'income':'off';
    s.xpCapacity=(${readXpCapacity.toString()})(ns,daemon,r,s.at);
${canSingularity?`    try {
        s.queuedRedPill=ns.singularity.getOwnedAugmentations(true).includes('The Red Pill');
        s.work=ns.singularity.getCurrentWork();
        s.daedalus=p.factions.includes('Daedalus');
        s.rep=s.daedalus?ns.singularity.getFactionRep('Daedalus'):null;
        s.redPillPrice=ns.singularity.getAugmentationPrice('The Red Pill');
        s.redPillRep=ns.singularity.getAugmentationRepReq('The Red Pill');
        s.redPillOffered=ns.singularity.getAugmentationsFromFaction('Daedalus').includes('The Red Pill');
        s.favorToDonate=ns.getFavorToDonate();
        s.favor=s.daedalus?ns.singularity.getFactionFavor('Daedalus'):0;
        s.favorGain=s.daedalus?ns.singularity.getFactionFavorGain('Daedalus'):0;
        s.singularityKnown=true;
    }catch{}
`:''}
${canBladeburner?`    try {
        if(ns.bladeburner.inBladeburner()) {
            const stamina=ns.bladeburner.getStamina(),forecast=(${bladeburnerStaminaChance.toString()});
            const difficulties=${JSON.stringify({...bladeburnerDifficulty,...Object.fromEntries(Object.entries(blackOpMetadata).map(([name,data])=>[name,{base:data.baseDifficulty,factor:1}]))})};
            let recovery=null;
            try{
                const b=ns.bladeburner,reaper=b.getSkillLevel('Reaper'),evasive=b.getSkillLevel('Evasive Systems'),cyber=b.getSkillLevel("Cyber's Edge");
                const effective=p.skills.agility*(1+.02*reaper)*(1+.04*evasive);
                const regen=(.0085+stamina[1]/70000)*Math.pow(effective,.17)*(1+.02*cyber)*p.mults.bladeburner_stamina_gain;
                const hrc=stamina[1]*.01/60;
                if(Number.isFinite(regen)&&regen>=0&&Number.isFinite(hrc)&&hrc>=0)recovery={regen,hrc};
            }catch{}
            const action=(type,name)=>{
                const rawChance=ns.bladeburner.getActionEstimatedSuccessChance(type,name),data=difficulties[name];
                const level=type==='Black Operations'?1:ns.bladeburner.getActionCurrentLevel(type,name);
                const difficulty=data?data.base*Math.pow(data.factor,level-1):NaN;
                const chance=forecast(rawChance,stamina,difficulty)||[0,0];
                const penalty=Math.min(1,stamina[0]/(.5*stamina[1]));
                const recoveredRaw=penalty>0?rawChance.map(p=>Math.min(1,p/penalty)):null;
                const capabilityChance=recoveredRaw?forecast(recoveredRaw,[stamina[1],stamina[1]],difficulty):null;
                return {name,time:ns.bladeburner.getActionTime(type,name),chance,rawChance,capabilityChance,staminaCost:Number.isFinite(difficulty)&&difficulty>0?.285*(Math.pow(difficulty,.28)+difficulty/650):null,
                    gain:ns.bladeburner.getActionRankGain(type,name),loss:ns.bladeburner.getActionRankLoss(type,name),count:ns.bladeburner.getActionCountRemaining(type,name)};
            };
            s.bb={joined:true,stamina,recovery,chanceModel:"post-cost-v1",city:ns.bladeburner.getCity(),rank:ns.bladeburner.getRank(),action:ns.bladeburner.getCurrentAction(),bonusTime:ns.bladeburner.getBonusTime(),
                ops:ns.bladeburner.getBlackOpNames().filter(n=>ns.bladeburner.getActionCountRemaining('Black Operations',n)>0)
                    .map(n=>({...action('Black Operations',n),required:ns.bladeburner.getBlackOpRank(n)})),
                actions:[...ns.bladeburner.getContractNames().map(n=>action('Contracts',n)),...ns.bladeburner.getOperationNames().map(n=>action('Operations',n))]};
        }
    }catch(error){s.bb={error:String(error)};}
`:''}
    return s;
})()`;
}
