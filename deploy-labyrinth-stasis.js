/** @param {NS} ns */
export async function main(ns) {
  const report = { at: Date.now(), host: ns.getHostname(), probe: ns.dnet.probe(), targets: [] };
  let creds = [];
  try { creds = JSON.parse(ns.read('tasks/credentials-home.json')).entries || []; } catch (e) { report.error = 'creds: ' + String(e); }
  const passwordFor = (host) => (creds.find((e) => e[0] === host) || [])[1];
  const targets = ['th3_l4byr1nth', 'm3rc1l3ss_l4byr1nth', 'cru3l_l4byr1nth'].filter((h) => report.probe.includes(h));
  report.adjacent = targets;
  report.targets = [];
  for (const host of targets) {
    const entry = { host, connected: report.probe.includes(host), session: false, copied: false, pid: 0, error: '' };
    try {
      const password = passwordFor(host);
      if (!password) throw new Error('no saved password');
      entry.session = ns.dnet.connectToSession(host, password);
      entry.copied = await ns.scp(['darknet-stasis-link.js'], host, ns.getHostname());
    } catch (e) { entry.error += String(e) + '; '; }
    try {
      if (entry.copied) entry.pid = ns.exec('darknet-stasis-link.js', host, 1);
    } catch (e) { entry.error += String(e) + '; '; }
    report.targets.push(entry);
  }
  // keep only detailed entries
  report.targets = report.targets.filter((t) => typeof t === 'object');
  await ns.write('stasis-deploy.txt', JSON.stringify(report), 'w');
}
