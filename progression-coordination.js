import { getNsDataThroughFile } from './helpers.js';
import { activityRecord } from './activity-coordination.js';
export const transitionFile = 'tasks/progression-transition.json';
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
