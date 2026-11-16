import {staleOwnerFiles, staleResultFiles, staleTempCaches} from './leak-cleanup-policy.js';
/** One-shot removal of state files whose owner exited, dead command receipts, and stale
 *  Temp caches. Run it before a save, or when the save has grown large: every save
 *  re-serializes these files, so the backlog is felt as multi-second game-loop stalls.
 *  Options: --dry-run, --keep-remote-credentials, --purge-home-archives */
export async function main(ns) {
    ns.disableLog('ALL');
    const flags = new Set(ns.args.filter(arg => typeof arg === 'string' && arg.startsWith('--')));
    const dryRun = flags.has('--dry-run');
    const keepRemoteCredentials = flags.has('--keep-remote-credentials');
    const purgeHomeArchives = flags.has('--purge-home-archives');
    const now = Date.now();
    const receipt = {at: now, dryRun, removed: {}, failed: 0};
    const remove = async (name, server = 'home', bucket = 'files') => {
        receipt.removed[bucket] = (receipt.removed[bucket] || 0) + 1;
        if (dryRun) return;
        if (ns.rm(name, server)) return;
        receipt.removed[bucket]--;
        receipt.failed++;
    };
    const metadata = names => names.map(name => {
        let mtime;
        try { mtime = ns.getFileMetadata(name)?.mtime; } catch { }
        return {name, mtime};
    });

    const home = ns.ls('home') || [];
    const running = new Set(ns.ps('home').map(p => p.pid));
    for (const name of staleOwnerFiles(home, running, 100000)) await remove(name, 'home', 'ownerFiles');
    for (const name of staleResultFiles(metadata(home.filter(name => name.startsWith('remote-control/results/'))), now, {keepMs: 600000, max: 100000})) await remove(name, 'home', 'commandResults');
    for (const name of staleTempCaches(metadata(home.filter(name => name.startsWith('Temp/'))), now, {keepMs: 3600000, max: 100000})) await remove(name, 'home', 'tempCaches');
    if (purgeHomeArchives)
        for (const name of home.filter(name => /^tasks\/credential-archive-.*\.json$/.test(name))) await remove(name, 'home', 'homeArchives');

    // Each darknet host keeps its own copy of the shared credential bundle plus its legacy
    // archive. Idle hosts only need them when darknet work resumes there, so drop the copies
    // that are pure duplication; the bundle is re-copied on demand.
    if (!keepRemoteCredentials) {
        const seen = new Set(['home']), queue = ['home'];
        while (queue.length) {
            const host = queue.shift();
            let neighbours = [];
            try { neighbours = ns.scan(host); } catch { }
            for (const neighbour of neighbours) if (!seen.has(neighbour)) { seen.add(neighbour); queue.push(neighbour); }
        }
        for (const host of seen) {
            if (host === 'home') continue;
            let processes = [];
            try { processes = ns.ps(host); } catch { continue; }
            if (processes.length) continue;
            for (const name of ns.ls(host, 'tasks/') || []) {
                if (name !== 'tasks/credentials-home.json' && !/^tasks\/credential-archive-.*\.json$/.test(name)) continue;
                await remove(name, host, 'remoteCredentials');
            }
        }
        receipt.scannedHosts = seen.size;
    }

    receipt.ok = receipt.failed === 0;
    await ns.write('tasks/leak-cleanup-receipt.json', JSON.stringify(receipt), 'w');
    ns.print((dryRun ? 'Would remove ' : 'Removed ') + JSON.stringify(receipt.removed));
    if (dryRun) ns.tprint('Dry run: ' + JSON.stringify(receipt.removed));
}
