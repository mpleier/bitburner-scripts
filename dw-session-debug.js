export async function main(ns) {
  ns.disableLog('ALL');
  const host = ns.args[0] || 'darkweb';
  const creds = JSON.parse(ns.read('tasks/credentials-home.json')).entries || [];
  const pw = (creds.find((e) => e[0] === host) || [])[1];
  const before = {
    hasRoot: ns.hasRootAccess(host),
    details: ns.dnet.getServerDetails(host),
    hasPw: !!pw,
  };
  let connect = null;
  if (pw) {
    try { connect = ns.dnet.connectToSession(host, pw); } catch (e) { connect = { error: String(e) }; }
  }
  let auth = null;
  if (pw && (!connect || connect.success !== true)) {
    try { auth = await ns.dnet.authenticate(host, pw); } catch (e) { auth = { error: String(e) }; }
  }
  await ns.sleep(100);
  const after = { hasRoot: ns.hasRootAccess(host), details: ns.dnet.getServerDetails(host) };
  const pid = ns.exec('dw-probe-neighbours.js', host, 1, 'ub3r_l4byr1nth');
  await ns.write('tasks/dw-session-debug.json', JSON.stringify({ at: Date.now(), host, before, connect, auth, after, pid }), 'w');
  ns.tprint('SESSION_DEBUG pid=' + pid + ' root=' + after.hasRoot);
}
