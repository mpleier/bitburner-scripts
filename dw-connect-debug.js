export async function main(ns) {
  const entries = JSON.parse(ns.read('tasks/credentials-home.json')).entries || [];
  const hosts = ns.args.length ? ns.args.map(String) : ['7777777', 'smar7_d00rbell'];
  const out = [];
  for (const host of hosts) {
    const hit = entries.find((e) => Array.isArray(e) && e[0] === host);
    const row = { host, hasEntry: !!hit, passwordLen: hit && typeof hit[1] === 'string' ? hit[1].length : 0, third: hit ? typeof hit[2] : null, before: ns.dnet.getServerDetails(host) };
    if (hit) {
      try {
        const r = ns.dnet.connectToSession(host, hit[1]);
        row.connect = typeof r === 'object' && r !== null ? { success: r.success, message: r.message, keys: Object.keys(r) } : { value: String(r) };
      } catch (e) { row.connect = { error: String(e) }; }
      await ns.sleep(100);
      try { row.after = ns.dnet.getServerDetails(host); } catch (e) { row.after = { error: String(e) }; }
      row.hasRoot = ns.hasRootAccess(host);
    }
    out.push(row);
  }
  await ns.write('tasks/dw-connect-debug.json', JSON.stringify({ at: Date.now(), out }), 'w');
  ns.tprint('DW_CONNECT_DEBUG ' + JSON.stringify(out.map((r) => ({ host: r.host, connect: r.connect, hasRoot: r.hasRoot, before: r.before?.hasSession, after: r.after?.hasSession }))));
}
