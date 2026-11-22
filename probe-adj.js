/** Report this host's Dark Net neighbours (including Labyrinth adjacency). */
export async function main(ns) {
  const target = ns.args[0] || 'th3_l4byr1nth';
  const self = ns.getHostname();
  let neighbours = [];
  let err = '';
  try { neighbours = ns.dnet.probe(); } catch (e) { err = String(e); }
  const out = {
    at: Date.now(), host: self, target, neighbours,
    adjacent: neighbours.includes(target),
    details: (() => { try { return ns.dnet.getServerDetails(target); } catch { return null; } })(),
    err,
  };
  const file = 'tasks/adj-' + self + '.json';
  await ns.write(file, JSON.stringify(out), 'w');
  ns.tprint('ADJ_REPORT ' + self + ' ' + JSON.stringify({ n: neighbours.length, adjacent: out.adjacent }));
}
