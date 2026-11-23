/** @param {NS} ns */
export async function main(ns) {
  const safe = async (label, fn) => {
    try {
      const v = await fn();
      return typeof v === 'function' ? String(v) : v;
    } catch (e) { return 'ERR ' + String(e); }
  };
  const calls = {
    labreport: () => ns.dnet.labreport(),
    labradar: () => ns.dnet.labradar(),
    depth: () => ns.dnet.getDepth(),
    stasisLinked: () => ns.dnet.getStasisLinkedServers(),
    stasisLimit: () => ns.dnet.getStasisLinkLimit(),
    probe: () => ns.dnet.probe(),
    darknetServerDW: () => ns.dnet.isDarknetServer('darkweb'),
    darknetServerTH3: () => ns.dnet.isDarknetServer('th3_l4byr1nth'),
    detailsTH3: () => ns.dnet.getServerDetails('th3_l4byr1nth'),
  };
  const out = { at: Date.now(), host: ns.getHostname() };
  for (const [k, fn] of Object.entries(calls)) out[k] = await safe(k, fn);
  await ns.write('tasks/labyrinth-state.json', JSON.stringify(out), 'w');
}
