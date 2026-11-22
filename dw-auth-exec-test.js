/** Check whether an opened Dark Net session allows launching the probe on that host. */
export async function main(ns) {
  ns.disableLog('ALL');
  const out = [];
  const hosts = ns.args[0] ? [ns.args[0]] : ns.dnet.probe();
  for (const host of hosts) {
    const s = ns.getServer(host);
    if (!s.hasAdminRights) continue;
    const entry = { host, hint: s.staticPasswordHint };
    for (const pw of ['', '459', String(s.staticPasswordHint || '').match(/\d+/)?.[0] || '']) {
      try {
        const r = await ns.dnet.authenticate(host, pw);
        entry.auth = { pw, success: r.success === true, message: String(r.message || '').slice(0, 80) };
        if (r.success === true) break;
      } catch (e) { entry.auth = { pw, error: String(e).slice(0, 100) }; }
    }
    entry.hasSession = (ns.dnet.getServerDetails(host) || {}).hasSession === true;
    entry.pid = ns.exec('dw-probe-neighbours.js', host, 1, 'ub3r_l4byr1nth');
    await ns.sleep(300);
    entry.report = ns.fileExists('tasks/dw-adj-report.json', host);
    out.push(entry);
  }
  await ns.write('tasks/dw-auth-exec-test.json', JSON.stringify(out), 'w');
}
