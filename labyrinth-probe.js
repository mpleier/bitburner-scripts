/** @param {NS} ns */
export async function main(ns) {
  const hosts = ['th3_l4byr1nth', 'm3rc1l3ss_l4byr1nth', 'cru3l_l4byr1nth'];
  const out = { at: Date.now(), hosts: {}, probeDW: ns.dnet.probe(), creds: [], reports: {} };
  try {
    const c = JSON.parse(ns.read('tasks/credentials-home.json'));
    out.creds = (c.entries || []).filter((e) => /l4byr/i.test(e[0] || ''));
  } catch (e) { out.credErr = String(e); }
  for (const h of hosts) {
    const entry = {};
    try { entry.root = ns.hasRootAccess(h); } catch (e) { entry.rootErr = String(e); }
    try { entry.details = ns.dnet.getServerDetails(h); } catch (e) { entry.detailsErr = String(e); }
    try { entry.caches = ns.ls(h, '.cache'); } catch (e) { entry.cachesErr = String(e); }
    try {
      const f = 'tasks/dnet-navigator-' + JSON.stringify(['home', h]) + '.json';
      const r = JSON.parse(ns.read(f));
      entry.report = { at: r.at, phase: r.phase, coords: r.coords, moves: r.moves, error: r.error, stalls: r.stalls };
    } catch (e) { entry.reportErr = String(e); }
    out.hosts[h] = entry;
  }
  await ns.write('tasks/labyrinth-probe.json', JSON.stringify(out), 'w');
}
