import { stormRequestFile, stormResultFile, stormReadiness } from './darknet-storm-policy.js';
/** One shot on the server holding the seed; no expensive API added to low-RAM scouts. */
export async function main(ns) {
  ns.disableLog('ALL');
  let request, outcome = { success: false, reason: 'Dispatch deferred by safety checks' };
  try {
    if (!(await ns.scp(stormRequestFile, ns.getHostname(), 'home'))) return;
    request = JSON.parse(ns.read(stormRequestFile));
    const now = Date.now(), host = ns.getHostname();
    if (typeof request.id !== 'string' || !request.id || !Number.isFinite(request.at) || now < request.at || now - request.at > 30000 || request.host !== host ||
        request.reset !== ns.getResetInfo().lastNodeReset) return;
    const decision = stormReadiness(request.reports, request.roots, now);
    if (!decision.ready || decision.seedHost !== host || decision.signature !== request.signature) return;
    // Recheck all surveyed hosts immediately before consuming the seed.
    // New caches, contracts, restarts, or maintenance cancel this dispatch.
    // ns.read is local: retrieve current home controls immediately before the native call.
    // Missing files mean no control flag; a failed copy or malformed maintenance record defers safely.
    for (const file of ['tasks/automation-maintenance.json', 'remote-control/paused/darknet-manager.js.txt']) {
      if (!ns.fileExists(file, 'home')) continue;
      if (!(await ns.scp(file, host, 'home'))) { outcome.reason = 'Home control sync failed'; return; }
      const text = ns.read(file);
      if (file.endsWith('.txt')) {
        if (text.trim() === 'true') { outcome.reason = 'Dark Net manager paused'; return; }
      } else {
        const maintenance = JSON.parse(text || '{}');
        if (maintenance.expiresAt > Date.now() && ns.isRunning(maintenance.ownerPid)) {
          outcome.reason = 'Automation maintenance'; return;
        }
      }
    }
    const surveyed = new Set(JSON.parse(request.signature).map(row => row[0]));
    for (const report of request.reports.filter(report => surveyed.has(report.host))) {
      if (!ns.ps(report.host).some(p => p.pid === report.pid && p.filename === 'darknet-node.js') ||
          ns.ps(report.host).some(p => ['darknet-cache.js','darknet-stasis.js','darknet-migrate.js'].includes(p.filename)) ||
          ns.ls(report.host).some(file => /\.(cache|cct)$/.test(file))) return;
    }
    const files = ns.ls(host), info = ns.dnet.getServerDetails(host);
    const expected = request.reports.find(report => report.host === host);
    const neighbours = ns.dnet.probe().filter(name => name !== host).sort();
    if (!files.includes('STORM_SEED.exe') || files.some(file => /\.(cache|cct)$/.test(file)) || info.blockedRam !== 0 ||
        JSON.stringify(neighbours) !== JSON.stringify([...expected.neighbours].sort()) ||
        ns.ps(host).some(p => ['darknet-cache.js','darknet-stasis.js','darknet-migrate.js'].includes(p.filename))) return;
    if (Date.now() - request.at > 30000 || request.reset !== ns.getResetInfo().lastNodeReset) return;
    const result = ns.dnet.unleashStormSeed();
    outcome = { success: result?.success === true, reason: result?.message || String(result?.code || 'Webstorm triggered') };
    ns.print(`StormSeed: ${result.success ? 'webstorm triggered; scouts will rebuild exploration' : result.message || result.code}`);
  } catch (error) {
    outcome.reason = String(error);
    ns.print(`StormSeed deferred: ${String(error)}`);
  } finally {
    if (typeof request?.id === 'string' && request.host === ns.getHostname()) {
      const receipt = { id: request.id, host: request.host, reset: request.reset, at: Date.now(), ...outcome };
      try {
        await ns.write(stormResultFile, JSON.stringify(receipt), 'w');
        for (let attempt = 0; attempt < 3; attempt++) {
          if (await ns.scp(stormResultFile, 'home', ns.getHostname())) break;
          await ns.sleep(50);
        }
      } catch { /* Missing receipt permits a short retry, never an assumed successful storm. */ }
    }
  }
}
