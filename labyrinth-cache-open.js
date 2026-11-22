/** @param {NS} ns */
export async function main(ns) {
  const host = ns.getHostname();
  const out = {
    at: Date.now(),
    host,
    cachesBefore: ns.ls(host, '.cache'),
    linksBefore: ns.dnet.getStasisLinkedServers(),
    linkLimit: ns.dnet.getStasisLinkLimit(),
    steps: [],
    opened: [],
  };
  const note = (k, v) => { out.steps.push([k, v]); };

  // "Closer stasis link": pin the Labyrinth host itself so it stays reachable.
  if (!out.linksBefore.includes(host)) {
    try {
      const r = await ns.dnet.setStasisLink(true);
      note('setStasisLink', r);
    } catch (e) { note('setStasisLinkErr', String(e)); }
  } else {
    note('setStasisLink', 'already linked');
  }
  out.linksAfter = ns.dnet.getStasisLinkedServers();

  for (const file of out.cachesBefore) {
    try {
      const r = ns.dnet.openCache(file, true);
      out.opened.push({ file, result: r });
    } catch (e) { out.opened.push({ file, error: String(e) }); }
  }
  out.cachesAfter = ns.ls(host, '.cache');
  await ns.write('labyrinth-cache-open-result.json', JSON.stringify(out), 'w');
  ns.tprint('LAB_CACHE_OPEN ' + JSON.stringify(out));
}
