/** Test nested exec from darkweb to a directly-connected neighbour. */
export async function main(ns) {
  const host = ns.args[0];
  const out = { host, steps: [] };
  const log = (s) => out.steps.push(s);
  const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
  log('free=' + free + ' root=' + ns.hasRootAccess(host));
  try { log('auth=' + JSON.stringify(await ns.dnet.authenticate(host, ''))); } catch (e) { log('authErr=' + e); }
  log('ramConnector=' + ns.getScriptRam('darknet-labyrinth-connector.js', host));
  log('ramProbe=' + ns.getScriptRam('dw-probe-neighbours.js', host));
  try { log('pidProbe=' + ns.exec('dw-probe-neighbours.js', host, 1, 'ub3r_l4byr1nth')); }
  catch (e) { log('probeErr=' + e); }
  try { log('pidConnector0=' + ns.exec('darknet-labyrinth-connector.js', host, 1)); }
  catch (e) { log('c0Err=' + e); }
  try { log('pidConnectorJson=' + ns.exec('darknet-labyrinth-connector.js', host, 1, JSON.stringify({ target: 'ub3r_l4byr1nth', depth: 2 }))); }
  catch (e) { log('cjErr=' + e); }
  log('ps=' + JSON.stringify(ns.ps(host).map((p) => p.filename)));
  await ns.write('tasks/dw-nested-test.json', JSON.stringify(out), 'w');
  await ns.scp('tasks/dw-nested-test.json', 'home', 'darkweb');
}
