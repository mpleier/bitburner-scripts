/** Diagnose why in-game exec of the neighbour probe returns 0 on darknet hosts. */
export async function main(ns) {
  ns.disableLog('ALL');
  const out = [];
  for (const host of ns.dnet.probe()) {
    const entry = { host };
    try {
      const d = ns.dnet.getServerDetails(host) || {};
      entry.hasSession = d.hasSession;
      entry.online = d.isOnline;
      entry.free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
      entry.root = ns.hasRootAccess(host);
      entry.hasScript = ns.fileExists('dw-probe-neighbours.js', host);
      entry.scriptRam = ns.getScriptRam('dw-probe-neighbours.js', host);
      entry.before = ns.ps(host).map((p) => p.filename);
      try { entry.pid = ns.exec('dw-probe-neighbours.js', host, 1, 'ub3r_l4byr1nth'); }
      catch (e) { entry.execError = String(e).slice(0, 160); }
      try { entry.pidTemp = ns.exec('dw-probe-neighbours.js', host, { temporary: true }, 'ub3r_l4byr1nth'); }
      catch (e) { entry.tempError = String(e).slice(0, 160); }
      entry.after = ns.ps(host).map((p) => p.filename);
    } catch (e) { entry.error = String(e).slice(0, 160); }
    out.push(entry);
  }
  await ns.write('tasks/dw-exec-test.json', JSON.stringify(out), 'w');
}
