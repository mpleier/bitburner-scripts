/** Short-lived workers write one state file per PID. Nothing deletes those files when the
 *  worker exits, so they accumulate forever in the save. Every save re-serializes the whole
 *  save (including when "save game on file save" is enabled), so the backlog turns into
 *  multi-second game-loop stalls. These helpers stay pure so callers can bound the work. */
const ownerPatterns = [
    /^tasks\/runtime\/(\d+)\.json$/,
    /^tasks\/hash-spending-(\d+)\.json$/,
    /^tasks\/hash-worker-status-(\d+)\.json$/,
    /^tasks\/hgw-drain-(\d+)\.json$/,
    /^tasks\/augmentation-purchase-result-(\d+)\.json$/,
    /^tasks\/xp-capacity-(\d+)\.json$/,
    /^tasks\/bladeburner-external-training-(\d+)\.json$/,
];
// Temp/<command>.result-<pid>.txt receipts are deliberately absent from ownerPatterns. A
// getNsDataThroughFile worker writes its receipt and exits in the same tick, so "owner PID is
// gone" is the *normal* state of a live, about-to-be-read receipt. Pruning those by liveness
// deletes data out from under a waiting caller, which surfaces as
// "Temporary query <pid> ended without a result". They are reclaimed by age (staleReceipts).
const receiptPattern = /^Temp\/(?:[^/]+\/)*[^/]+\.result-(\d+)\.txt$/;
// Dark Net state is per-HOST, not per-PID: `tasks/dnet-cache-rewards-<hostname>.json` belongs to a
// server that outlives the worker that wrote it, and darknet hostnames are arbitrary strings, so a
// numeric-suffix rule matched 1 of 10,429 files. These are reclaimed by age instead; the singleton
// control files (summary, context, goals, storm/frontier/deployment state) are never eligible.
const darknetStatePattern = /^tasks\/dnet-(?!cache-rewards-summary\.json|cache-context\.json|charisma-goal\.json|storm-request\.json|storm-state\.json|storm-result\.json|frontier\.json|deployment\.json)[^/]+\.json$/;
const resultPrefix = 'remote-control/results/';

/** PID that owns the file, or null. Receipt files are excluded: see receiptPattern. */
export function pidOwner(name) {
    if (typeof name !== 'string' || !name) return null;
    for (const pattern of ownerPatterns) {
        const match = pattern.exec(name);
        if (match) return Number(match[match.length - 1]);
    }
    return null;
}

/** Files whose owning PID is no longer running. Never touches files without an owner PID. */
export function staleOwnerFiles(names, running, max = 200) {
    const limit = Number.isSafeInteger(max) && max > 0 ? max : 200;
    const live = running instanceof Set ? running : new Set(running || []);
    const stale = [];
    for (const name of names || []) {
        const pid = pidOwner(name);
        if (pid === null || pid <= 0 || live.has(pid)) continue;
        stale.push(name);
        if (stale.length >= limit) break;
    }
    return stale;
}

/** Result receipts older than keepMs. A queued command expires within a minute, so anything
 *  past the retention window is dead weight; a missing mtime is treated as stale. */
export function staleResultFiles(entries, now, { keepMs = 600000, max = 200 } = {}) {
    if (!Number.isFinite(now)) return [];
    const limit = Number.isSafeInteger(max) && max > 0 ? max : 200;
    const retention = Number.isFinite(keepMs) && keepMs >= 0 ? keepMs : 600000;
    const stale = [];
    for (const entry of entries || []) {
        const name = entry?.name;
        if (typeof name !== 'string' || !name.startsWith(resultPrefix)) continue;
        const mtime = entry.mtime;
        if (Number.isFinite(mtime) && now - mtime <= retention) continue;
        stale.push(name);
        if (stale.length >= limit) break;
    }
    return stale;
}

/** Temp query receipts whose caller never read them (killed mid-query, or crashed). Age is the
 *  only safe signal here: the receiving caller reads within milliseconds of the write, so any
 *  receipt older than the retention window has no reader left. An unknown mtime is left alone —
 *  deleting a live receipt makes the caller throw "ended without a result". */
export function staleReceipts(entries, now, { keepMs = 600000, max = 50 } = {}) {
    if (!Number.isFinite(now)) return [];
    const limit = Number.isSafeInteger(max) && max > 0 ? max : 50;
    const retention = Number.isFinite(keepMs) && keepMs >= 0 ? keepMs : 600000;
    const stale = [];
    for (const entry of entries || []) {
        const name = entry?.name;
        if (typeof name !== 'string' || !receiptPattern.test(name)) continue;
        const mtime = entry.mtime;
        if (!Number.isFinite(mtime) || now - mtime <= retention) continue;
        stale.push(name);
        if (stale.length >= limit) break;
    }
    return stale;
}

/** Per-host Dark Net reports older than the retention window. A live host rewrites its survey,
 *  solver and cache receipts every cycle, so anything this old belongs to a server that no longer
 *  exists (storms and resets regenerate the network). A missing mtime is left alone. */
export function staleDarknetState(entries, now, { keepMs = 21600000, max = 500 } = {}) {
    if (!Number.isFinite(now)) return [];
    const limit = Number.isSafeInteger(max) && max > 0 ? max : 500;
    const retention = Number.isFinite(keepMs) && keepMs >= 0 ? keepMs : 21600000;
    const stale = [];
    for (const entry of entries || []) {
        const name = entry?.name;
        if (typeof name !== 'string' || !darknetStatePattern.test(name)) continue;
        const mtime = entry.mtime;
        if (!Number.isFinite(mtime) || now - mtime <= retention) continue;
        stale.push(name);
        if (stale.length >= limit) break;
    }
    return stale;
}

/** Old Temp caches are regenerated on demand; only plain .txt caches are eligible. */
export function staleTempCaches(entries, now, { keepMs = 3600000, max = 200 } = {}) {
    if (!Number.isFinite(now)) return [];
    const limit = Number.isSafeInteger(max) && max > 0 ? max : 200;
    const retention = Number.isFinite(keepMs) && keepMs >= 0 ? keepMs : 3600000;
    const stale = [];
    for (const entry of entries || []) {
        const name = entry?.name;
        if (typeof name !== 'string' || !name.startsWith('Temp/') || !name.endsWith('.txt')) continue;
        const mtime = entry.mtime;
        if (Number.isFinite(mtime) && now - mtime <= retention) continue;
        stale.push(name);
        if (stale.length >= limit) break;
    }
    return stale;
}
