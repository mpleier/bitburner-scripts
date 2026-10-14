/** Short-lived UI ownership. Casino and BitNode transitions take priority. */
export const activityFile = 'tasks/activity-lock.json';
export const ramReserveFile = 'tasks/automation-ram-reserve.json';
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
export async function claimActivity(ns, kind) {
  if (activityBusy(ns)) return false;
  await ns.write(activityFile, JSON.stringify({ kind, ownerPid: ns.pid, expiresAt: Date.now() + 15000 }), 'w');
  return activityRecord(ns)?.ownerPid === ns.pid;
}
export function releaseActivity(ns) {
  try { if (JSON.parse(ns.read(activityFile)).ownerPid === ns.pid) ns.rm(activityFile, 'home'); } catch { }
}
export function pendingRam(ns, now = Date.now()) {
  try {
    const record = JSON.parse(ns.read(ramReserveFile));
    return record.expiresAt > now && ns.isRunning(record.ownerPid) ? Math.max(0, Number(record.ram) || 0) : 0;
  } catch { return 0; }
}
/** Fresh check for RAM-dodged actions; no import is needed in their generated script. */
export const activityGuard = '(() => { try { const r=JSON.parse(ns.read("tasks/activity-lock.json")); return r.expiresAt>Date.now() && ns.isRunning(r.ownerPid); } catch { return false; } })()';
