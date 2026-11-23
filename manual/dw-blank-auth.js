/** Determine which auth call opens a blank-password darknet session. */
export async function main(ns) {
  ns.disableLog('ALL');
  const out = [];
  for (const host of ns.dnet.probe()) {
    const d = ns.dnet.getServerDetails(host) || {};
    if (d.passwordLength !== 0) continue;
    const entry = { host, model: d.modelId, format: d.passwordFormat, blank: d.passwordHint };
    for (const pw of ['', '0', '0000']) {
      try { const r = ns.dnet.connectToSession(host, pw); entry['connect:' + pw.length] = !!(r && r.success); }
      catch (e) { entry['connect:' + pw.length] = String(e).slice(0, 60); }
    }
    for (const pw of ['', '0', '0000']) {
      try { const r = await ns.dnet.authenticate(host, pw); entry['auth:' + pw.length] = !!(r && r.success); }
      catch (e) { entry['auth:' + pw.length] = String(e).slice(0, 60); }
    }
    out.push(entry);
  }
  await ns.write('tasks/dw-blank-auth.json', JSON.stringify(out), 'w');
}
