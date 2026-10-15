/** The casino seed is cash: $200k travel plus $100k available for play. */
export const casinoSeedMoney = 300000;

/** Serialized into one small worker; no persistent crime manager is needed. */
export const earnCasinoSeedSource = String.raw`function earnCasinoSeed(ns, ownerPid, target) {
    if (!ns.isRunning(ownerPid) || ns.read('remote-control/paused/autopilot.js.txt').trim() === 'true')
        return { state: 'waiting', reason: 'Autopilot stopped or paused' };
    for (const path of ['tasks/activity-lock.json', 'tasks/progression-transition.json', 'tasks/automation-maintenance.json']) {
        try {
            const record = JSON.parse(ns.read(path));
            if (record.ownerPid !== ownerPid && record.expiresAt > Date.now() && ns.isRunning(record.ownerPid))
                return { state: 'waiting', reason: 'Another activity is in progress' };
        } catch { }
    }
    if (ns.getPlayer().money >= target) return { state: 'ready' };
    const work = ns.singularity.getCurrentWork();
    if (['GRAFTING', 'CREATE_PROGRAM'].includes(work?.type))
        return { state: 'waiting', reason: 'Finishing ' + work.type.toLowerCase() };
    if (work?.type && work.type !== 'CRIME') ns.singularity.stopAction();
    // Never restart a repeating crime mid-cycle: that would discard its progress.
    if (work?.type === 'CRIME') return { state: 'earning', crime: work.crimeType };
    const names = ['Shoplift', 'Rob Store', 'Mug', 'Larceny', 'Deal Drugs', 'Bond Forgery', 'Traffick Arms', 'Homicide'];
    const choices = names.map(name => {
        const stats = ns.singularity.getCrimeStats(name), chance = ns.singularity.getCrimeChance(name);
        return { name, time: stats.time, rate: stats.money * chance / stats.time };
    }).filter(item => item.time > 0 && item.time <= 6000 && Number.isFinite(item.rate) && item.rate > 0)
        .sort((a, b) => b.rate - a.rate);
    const crime = choices[0]?.name || 'Shoplift';
    const duration = ns.singularity.commitCrime(crime, true);
    return duration > 0 ? { state: 'earning', crime, duration } : { state: 'waiting', reason: 'Crime could not start' };
}`;
