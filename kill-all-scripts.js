import { scanAllServers } from './helpers.js';

/** Stop controllers before draining workers. Script files are always preserved.
 * @param {NS} ns */
export async function main(ns) {
    // Home controllers must stop before the first await, even when launched remotely.
    const hosts = [...new Set(['home', ...scanAllServers(ns), ns.getHostname()])];
    const pending = () => {
        const processes = [];
        for (const host of hosts) {
            try {
                for (const process of ns.ps(host))
                    if (process.pid !== ns.pid) processes.push({ host, pid: process.pid });
            } catch { /* A cloud server may disappear during shutdown. */ }
        }
        return processes;
    };
    // Recheck every host: delayed exits and late workers cannot escape an earlier sweep.
    for (let attempt = 0; attempt < 100; attempt++) {
        const processes = pending();
        if (!processes.length) return;
        for (const { pid } of processes) {
            try { ns.kill(pid); } catch { /* Report survivors after bounded retries. */ }
        }
        await ns.sleep(50);
    }
    const remaining = pending();
    if (remaining.length)
        ns.tprint('WARNING: Shutdown incomplete after 5 seconds: ' + remaining.map(p => p.host + ':' + p.pid).join(', '));
}
