/** Write this host's Dark Net neighbours to a fixed report file for the connector BFS. */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = ns.args[0] || 'th3_l4byr1nth';
  const report = 'tasks/dw-adj-report.json';
  let neighbours = [];
  let err = '';
  try { neighbours = ns.dnet.probe(); } catch (e) { err = String(e); }
  const out = {
    at: Date.now(),
    host: ns.getHostname(),
    target,
    neighbours,
    adjacent: neighbours.includes(target),
    err,
  };
  await ns.write(report, JSON.stringify(out), 'w');
}
