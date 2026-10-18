/** Cash for travel and betting. */
export const casinoSeedMoney = 300000;

/** Minimize expected time to the remaining cash target, including whole crime payouts. */
export function chooseCasinoSeedCrime(choices, remaining) {
 return choices.filter(c=>c.money>0&&c.time>0&&c.chance>0&&Number.isFinite(c.money+c.time+c.chance))
  .map(c=>({...c,eta:Math.ceil(Math.max(1,remaining)/c.money)*c.time/Math.min(1,c.chance)}))
  .sort((a,b)=>a.eta-b.eta||a.time-b.time)[0]?.name||null;
}

/** Detached worker: awaiting a native crime boundary never blocks autopilot. */
export const earnCasinoSeedSource = String.raw`async function earnCasinoSeed(ns, ownerPid, target, choose) {
    const allowed=()=>{
        if(!ns.isRunning(ownerPid)||ns.read('remote-control/paused/autopilot.js.txt').trim()==='true'||
            ns.read('remote-control/paused/casino.js.txt').trim()==='true')return false;
        for(const path of ['tasks/activity-lock.json','tasks/progression-transition.json','tasks/automation-maintenance.json'])try{
            const r=JSON.parse(ns.read(path));
            if(r.ownerPid!==ownerPid&&r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return false;
        }catch{}
        return true;
    };
    if(!allowed())return {state:'waiting',reason:'Another activity owns control, or automation is paused'};
    if(ns.getPlayer().money>=target)return {state:'ready'};
    let work=ns.singularity.getCurrentWork();
    if(['GRAFTING','CREATE_PROGRAM'].includes(work?.type))return {state:'waiting',reason:'Finishing '+work.type.toLowerCase()};
    const select=()=>choose(['Shoplift','Rob Store','Mug','Larceny','Deal Drugs','Bond Forgery','Traffick Arms','Homicide'].map(name=>{
        const stats=ns.singularity.getCrimeStats(name);
        return {name,time:stats.time,money:stats.money,chance:ns.singularity.getCrimeChance(name)};
    }),target-ns.getPlayer().money);
    let crime=select();
    if(!crime)return {state:'waiting',reason:'No profitable crime is available'};
    if(work?.type==='CRIME') {
        if(work.crimeType===crime)return {state:'earning',crime};
        // The native promise resolves at completion. A competing action also resolves it: recheck identity.
        if(typeof work.nextCompletion?.then!=='function')return {state:'earning',crime:work.crimeType,reason:'Waiting for a supported crime boundary'};
        await work.nextCompletion;
        if(!allowed())return {state:'waiting',reason:'Control changed while awaiting crime completion'};
        if(ns.getPlayer().money>=target)return {state:'ready'};
        const current=ns.singularity.getCurrentWork();
        if(current?.type!=='CRIME'||current.crimeType!==work.crimeType)return {state:'waiting',reason:'Player activity changed'};
        work=current;crime=select();
        if(!crime)return {state:'waiting',reason:'No profitable crime is available'};
        if(work.crimeType===crime)return {state:'earning',crime};
    }
    if(!allowed())return {state:'waiting',reason:'Control changed'};
    const duration=ns.singularity.commitCrime(crime,true);
    return duration>0?{state:'earning',crime,duration}:{state:'waiting',reason:'Crime could not start'};
}`;

/** Small one-shot sleeve assignment: no Singularity calls and no persistent sleeve manager. */
export const seedSleevesSource = String.raw`function seedSleeves(ns,ownerPid,target,chance,allowed,nodeMultiplier=1) {
    const permitted=()=>ns.isRunning(ownerPid)&&ns.read('remote-control/paused/autopilot.js.txt').trim()!=='true'&&
        ns.read('remote-control/paused/casino.js.txt').trim()!=='true'&&ns.read('remote-control/paused/sleeve.js.txt').trim()!=='true'&&
        allowed(ns,'sleeve')&&!ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='sleeve.js');
    if(!permitted()||ns.getPlayer().money>=target)return {assigned:0};
    for(const file of ['tasks/activity-lock.json','tasks/automation-maintenance.json','tasks/progression-transition.json'])try{
        const r=JSON.parse(ns.read(file));if(r.ownerPid!==ownerPid&&r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return {assigned:0};
    }catch{}
    try{
        let config=JSON.parse(ns.read('sleeve.js.config.txt')||'{}');if(Array.isArray(config))config=Object.fromEntries(config);
        if(!config||typeof config!=='object'||config['disable-adaptive-startup']||config.crime||
          config['min-shock-recovery']!=null&&config['min-shock-recovery']!==0||
          config['shock-recovery']!=null&&config['shock-recovery']!==.05)return {assigned:0,reason:'Explicit sleeve settings'};
    }catch{return {assigned:0,reason:'Invalid sleeve configuration'};}
    // Apply the node success multiplier before the probability cap; it can change crime rankings.
    const crimes={Shoplift:{time:2000,money:15000,difficulty:.05,dexterity_success_weight:1,agility_success_weight:1},
        Mug:{time:4000,money:36000,difficulty:.2,strength_success_weight:1.5,defense_success_weight:.5,dexterity_success_weight:1.5,agility_success_weight:.5},
        Homicide:{time:3000,money:45000,difficulty:1,strength_success_weight:2,defense_success_weight:2,dexterity_success_weight:.5,agility_success_weight:.5}};
    let assigned=0;
    for(let i=0;i<ns.sleeve.getNumSleeves();i++){
        if(!permitted()||ns.getPlayer().money>=target)break;
        const sleeve=ns.sleeve.getSleeve(i);
        const crime=Object.entries(crimes).sort((a,b)=>chance(sleeve,b[1],nodeMultiplier)*b[1].money/b[1].time-chance(sleeve,a[1],nodeMultiplier)*a[1].money/a[1].time)[0][0];
        const task=ns.sleeve.getTask(i);
        if(task?.type==='CRIME'&&task.crimeType===crime)continue;
        // Preserve cycles already in progress; a later call may reconsider at the boundary.
        if(task?.type==='CRIME'&&task.cyclesWorked>0)continue;
        if(ns.sleeve.setToCommitCrime(i,crime))assigned++;
    }
    return {assigned};
}`;

/** Serialized upgrade worker; cash, shared budget and challenge protections are checked per purchase. */
export const essentialHomeRamSource = String.raw`function essentialHomeRam(ns,ownerPid,target,claim,allowed) {
    let budget=Math.max(0,ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0))*.5;
    let upgrades=0;
    while(ns.getServerMaxRam('home')<target){
        if(!ns.isRunning(ownerPid)||ns.read('remote-control/paused/autopilot.js.txt').trim()==='true'||
            ns.read('remote-control/paused/Tasks/ram-manager.js.txt').trim()==='true'||!allowed(ns,'homeRam')||!allowed(ns,'cashSpending'))break;
        try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))break;}catch{}
        const cost=ns.singularity.getUpgradeHomeRamCost();
        if(!(cost>0)||!Number.isFinite(cost)||cost>budget)break;
        if(!claim(ns,'home',cost))break;
        if(!ns.singularity.upgradeHomeRam())break;
        budget-=cost;upgrades++;
    }
    return {upgrades,ram:ns.getServerMaxRam('home')};
}`;
