import { getNsDataThroughFile } from './helpers.js';
import { activityRecord } from './activity-coordination.js';
export const transitionFile = 'tasks/progression-transition.json';
export function bitNodeVictory(hacking, required, rooted, blackOpsComplete) {
    if (Number.isFinite(required) && required > 0 && hacking >= required && rooted) return 'hacking';
    return blackOpsComplete === true ? 'bladeburner' : null;
}
export function bitNodeDeparture({ route, nextBn, autoDestroy = true, singularity, sleevesReady = true }) {
    if (!route) return 'not-complete';
    if (!autoDestroy) return 'disabled';
    if (!singularity) return 'manual-exit';
    // Supported BitNodes in the project's Bitburner 3.0.1 source.
    if (!Number.isInteger(nextBn) || nextBn < 1 || nextBn > 15) return 'invalid-next-node';
    if (!sleevesReady) return 'sleeves-pending';
    return 'ready';
}
export const completionHookFile = 'tasks/bitnode-completion-hook.json';
/** Record before launch so restarting autopilot cannot repeat a completed-node hook. */
export async function runCompletionHook(ns, nodeReset, script, args, launch, wait) {
    if (!script) return true;
    let saved;
    try { saved = JSON.parse(ns.read(completionHookFile)); } catch { }
    if (saved?.nodeReset === nodeReset) {
        if (saved.pid && ns.isRunning(saved.pid)) await wait(saved.pid);
        return true;
    }
    await ns.write(completionHookFile, JSON.stringify({ nodeReset, script, args, status: 'claimed', at: Date.now() }), 'w');
    let pid;
    try { pid = launch(script, args); }
    catch (error) { ns.rm(completionHookFile, 'home'); throw error; }
    if (!pid) { ns.rm(completionHookFile, 'home'); return false; }
    await ns.write(completionHookFile, JSON.stringify({ nodeReset, script, args, pid, status: 'started', at: Date.now() }), 'w');
    await wait(pid);
    await ns.write(completionHookFile, JSON.stringify({ nodeReset, script, args, pid, status: 'completed', at: Date.now() }), 'w');
    return true;
}
export function transitionActive(record, processes, now = Date.now()) {
    return processes.some(p => /(^|\/)casino\.js$|(^|\/)ascend\.js$/.test(p.filename)) ||
        !!(record && record.expiresAt > now && processes.some(p => p.pid === record.ownerPid));
}
export async function beginTransition(ns, kind, hasSingularity) {
    await ns.write(transitionFile, JSON.stringify({ kind, ownerPid: ns.pid, expiresAt: Date.now() + 86400000 }), 'w');
    try {
        const activity = activityRecord(ns);
        if (activity) {
            // Augmentation installs wait; casino and completed BitNodes override UI activity.
            if (hasSingularity) {
                endTransition(ns);
                ns.print('Waiting for the current infiltration before ' + kind + '.');
                return false;
            }
            await getNsDataThroughFile(ns,
                'ns.ps("home").some(p => p.pid===ns.args[0] && /(^|\\/)infiltration-manager\\.js$/.test(p.filename)) ? ns.kill(ns.args[0]) : false',
                '/Temp/cancel-infiltration.txt', [activity.ownerPid]);
        }
        if (hasSingularity && await getNsDataThroughFile(ns, "ns.singularity.getCurrentWork()?.type === 'GRAFTING'")) {
            endTransition(ns);
            ns.print('Waiting for the current graft to finish before ' + kind + '.');
            return false;
        }
        return true;
    } catch (error) { endTransition(ns); throw error; }
}
export function endTransition(ns) {
    try { if (JSON.parse(ns.read(transitionFile)).ownerPid === ns.pid) ns.rm(transitionFile, 'home'); } catch { }
}
