import {homeRamReserve} from './home-ram-policy.js';
/** Short-lived UI ownership. Casino and BitNode transitions take priority. */
export const activityFile = 'tasks/activity-lock.json';
export const ramReserveFile = 'tasks/automation-ram-reserve.json';
const supportFile = script => 'tasks/activity-support-' + script.split('/').pop() + '.json';
export async function markActivitySupport(ns) {
  await ns.write(supportFile(ns.getScriptName()), JSON.stringify({ pid: ns.pid, version: 1 }), 'w');
}
export function compatibleFocusWorkers(ns, processes) {
  return processes.filter(process => /(^|\/)(work-for-factions|bladeburner|grafting-manager)\.js$/.test(process.filename))
    .every(process => {
      try { const support = JSON.parse(ns.read(supportFile(process.filename))); return support.pid === process.pid && support.version === 1; }
      catch { return false; }
    });
}
export function activityRecord(ns) {
  try {
    const record = JSON.parse(ns.read(activityFile));
    return record.expiresAt > Date.now() && ns.isRunning(record.ownerPid) ? record : null;
  } catch { return null; }
}
export function activityBusy(ns, ownerPid = ns.pid) {
  const record = activityRecord(ns);
  return !!record && record.ownerPid !== ownerPid;
}
export async function claimActivity(ns, kind, reserveRam = null) {
  if (activityBusy(ns)) return false;
  const previous = activityRecord(ns);
  const ram = Math.max(0, Number(reserveRam ?? previous?.reserveRam) || 0);
  await ns.write(activityFile, JSON.stringify({ kind, ownerPid: ns.pid, expiresAt: Date.now() + 15000, reserveRam: ram }), 'w');
  return activityRecord(ns)?.ownerPid === ns.pid;
}
export function releaseActivity(ns) {
  try { if (JSON.parse(ns.read(activityFile)).ownerPid === ns.pid) ns.rm(activityFile, 'home'); } catch { }
}
export function pendingRam(ns, now = Date.now()) {
  let ram = 0;
  try {
    const record = JSON.parse(ns.read(ramReserveFile));
    if (record.expiresAt > now && ns.isRunning(record.ownerPid)) ram = Math.max(0, Number(record.ram) || 0);
  } catch { }
  const activity = activityRecord(ns);
  return homeRamReserve(ns)+Math.max(ram, activity?.reserveRam > 0 ? activity.reserveRam + 8 : 0);
}
/** Fresh check for RAM-dodged actions; no import is needed in their generated script. */
export const activityGuard = '(() => { try { const r=JSON.parse(ns.read("tasks/activity-lock.json")); return r.expiresAt>Date.now() && ns.isRunning(r.ownerPid); } catch { return false; } })()';
