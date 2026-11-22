/** @param {NS} ns */
export async function main(ns) {
  const target = 'th3_l4byr1nth';
  const visited = new Set();
  const queue = ['home'];
  while (queue.length) {
    const h = queue.shift();
    if (visited.has(h)) continue;
    visited.add(h);
    for (const n of ns.scan(h)) if (!visited.has(n)) queue.push(n);
  }
  const hosts = [...visited].filter((h) => ns.hasRootAccess(h));
  const found = [];
  for (const h of hosts) {
    if (ns.getServerMaxRam(h) < 10) continue;
    let probe;
    try { probe = ns.dnet.probe(h); } catch { continue; }
    if (Array.isArray(probe) && probe.includes(target)) found.push({ host: h, max: ns.getServerMaxRam(h), free: ns.getServerMaxRam(h) - ns.getServerUsedRam(h), probe });
  }
  await ns.write('tasks/dnet-adjacent-hosts.json', JSON.stringify({ at: Date.now(), target, found }), 'w');
}
