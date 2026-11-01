/**
 * Persistent Dark Net cache watcher.
 *
 * Runs on one Dark Net host, re-reads the live neighbour list every cycle, and
 * opens caches on itself or any directly connected neighbour. Dark Net edges
 * change, so a neighbour that was unreachable last cycle is retried
 * automatically without restarting the watcher.
 *
 * The manager deploys this to every host it can reach. It is intentionally
 * small and has no project imports, so 16 GB servers can afford it.
 */
const cacheFile = 'darknet-cache.js';
const watcherFile = 'darknet-cache-watch.js';
const contextFile = 'tasks/dnet-cache-context.json';
const rewardFile = host => 'tasks/dnet-cache-rewards-' + encodeURIComponent(host) + '.json';
const paused = () => false;

export async function main(ns) {
  ns.disableLog('ALL');
  const self = ns.getHostname();
  let lastNeighbours = '', lastSummary = '';
  const nextAttempt = new Map();
  const nextSpread = new Map();

  const cacheDependencies = [cacheFile, 'darknet-reward-policy.js', contextFile];
  const spreadDependencies = [watcherFile, cacheFile, 'darknet-reward-policy.js', contextFile];
  const passwords = new Map();
  let lastPasswordLoad = 0;

  const loadPasswords = async () => {
    if (Date.now() - lastPasswordLoad < 10_000) return;
    lastPasswordLoad = Date.now();
    const bundle = 'tasks/credentials-home.json';
    try {
      if (self !== 'home' && !ns.fileExists(bundle, self)) await ns.scp(bundle, self, 'home');
      const data = JSON.parse(ns.read(bundle));
      if (data?.schema === 1 && Array.isArray(data.entries)) {
        for (const row of data.entries) if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') passwords.set(row[0], row[1]);
      }
    } catch { }
    for (const line of ns.read('darknet-passwords.txt').split(/\r?\n/)) {
      const text = line.trim(), split = text.indexOf('=');
      if (text && !text.startsWith('#') && split > 0) passwords.set(text.slice(0, split).trim(), text.slice(split + 1).trim());
    }
  };

  const session = async (host) => {
    if (host === self) return true;
    try {
      if (ns.dnet.getServerDetails(host).hasSession === true) return true;
      const password = passwords.get(host);
      if (typeof password !== 'string') return false;
      if (ns.dnet.connectToSession(host, password).success === true) return true;
      // The watcher is directly connected to each neighbour; authenticate grants
      // this PID a session even if connectToSession has no previous session.
      try { return (await ns.dnet.authenticate(host, password)).success === true; } catch { return false; }
    } catch {
      return false;
    }
  };

  const copy = async (host, files) => {
    const source = files.every(file => ns.fileExists(file, self)) ? self : 'home';
    if (!files.every(file => ns.fileExists(file, source))) return false;
    return ns.scp(files, host, source);
  };

  const deploy = async (host) => copy(host, cacheDependencies);

  const open = async (host, caches) => {
    if (!caches.length) return false;
    if (ns.ps(host).some(process => process.filename === cacheFile)) return true;
    const now = Date.now();
    if ((nextAttempt.get(host) || 0) > now) return false;
    try {
      if (!await session(host)) {
        nextAttempt.set(host, now + 10_000);
        return false;
      }
      if (!ns.fileExists(cacheFile, host) && !await deploy(host)) return false;
      const ram = ns.getScriptRam(cacheFile, host);
      const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
      if (!(ram > 0) || free < ram) {
        nextAttempt.set(host, now + 10_000);
        return false;
      }
      if (!ns.exec(cacheFile, host, 1)) {
        nextAttempt.set(host, now + 10_000);
        return false;
      }
      ns.print(`${host}: opened ${caches.length} cache file(s).`);
      await ns.sleep(50);
      try {
        const receipt = rewardFile(host);
        if (ns.fileExists(receipt, host)) await ns.scp(receipt, 'home', host);
      } catch { }
      return true;
    } catch {
      nextAttempt.set(host, now + 30_000);
      return false;
    }
  };

  const spread = async (host) => {
    if (host === self) return;
    const now = Date.now();
    if ((nextSpread.get(host) || 0) > now) return;
    try {
      if (ns.ps(host).some(process => process.filename === watcherFile)) return;
      if (!await session(host)) {
        nextSpread.set(host, now + 20_000);
        return;
      }
      const ram = ns.getScriptRam(watcherFile, host);
      const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
      if (!(ram > 0) || free < ram) {
        nextSpread.set(host, now + 20_000);
        return;
      }
      if (!await copy(host, spreadDependencies)) {
        nextSpread.set(host, now + 20_000);
        return;
      }
      if (ns.exec(watcherFile, host, 1)) ns.print(`${host}: watcher propagated via ${self}.`);
      else nextSpread.set(host, now + 20_000);
    } catch {
      nextSpread.set(host, now + 20_000);
    }
  };

  await loadPasswords();
  while (!paused()) {
    let nextDelay = 15_000;
    try {
      await loadPasswords();
      const ownCaches = ns.ls(self, '.cache');
      await open(self, ownCaches);

      let neighbours = [];
      try { neighbours = ns.dnet.probe().filter(host => host !== self); } catch { }
      const signature = neighbours.slice().sort().join('|');
      if (signature !== lastNeighbours) {
        if (lastNeighbours) ns.print(`${self}: connection set changed (${neighbours.length} neighbour(s)).`);
        lastNeighbours = signature;
      }

      let pending = ownCaches.length;
      const scan = async host => {
        try {
          const caches = ns.ls(host, '.cache');
          if (caches.length) {
            pending += caches.length;
            await open(host, caches);
          }
          await spread(host);
        } catch { /* the edge may have changed while we were scanning it */ }
      };
      // Open neighbours in small parallel batches; one slow authentication must
      // not hold up every other cache on the edge.
      for (let i = 0; i < neighbours.length; i += 4)
        await Promise.all(neighbours.slice(i, i + 4).map(scan));

      const summary = `${self}: ${ownCaches.length} local cache(s), ${pending - ownCaches.length} neighbour cache(s), ${neighbours.length} connection(s).`;
      if (summary !== lastSummary) {
        lastSummary = summary;
        ns.print(summary);
      }
      nextDelay = pending > 0 ? 3_000 : neighbours.length ? 8_000 : 15_000;
    } catch (error) {
      ns.print(`${self}: watcher retry: ${String(error)}`);
      nextDelay = 5_000;
    }
    await ns.sleep(nextDelay);
  }
}

