/**
 * One-shot cache opener: opens every .cache file on the server it runs on, then
 * exits. openCache only works on the current server, and costs 2 GB, so the
 * scout starts this whenever a cache file appears (they are left behind when a
 * server's blocked RAM is freed, or dropped by phishing) instead of keeping
 * that cost in the scout itself.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const self = ns.getHostname();
  for (const file of ns.ls(self, ".cache")) {
    try {
      const result = ns.dnet.openCache(file, true);
      if (result?.success) await ns.write('tasks/dnet-last-cache.json', JSON.stringify({at:Date.now()}), 'w');
      ns.tprint(`${self}: opened ${file}: ${JSON.stringify(result)}`);
    } catch (error) {
      ns.tprint(`${self}: could not open ${file}: ${String(error)}`);
    }
  }
}
