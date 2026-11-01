const cacheContextFile = 'tasks/dnet-cache-context.json';
const cacheRewardFile = host => 'tasks/dnet-cache-rewards-' + encodeURIComponent(host) + '.json';
function readPasswords(ns, self) {
  const passwords = new Map();
  const readBundle = file => {
    try {
      const data = JSON.parse(ns.read(file));
      if (data?.schema !== 1 || !Array.isArray(data.entries)) return;
      for (const row of data.entries) if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') passwords.set(row[0], row[1]);
    } catch { }
  };
  readBundle('tasks/credentials-home.json');
  for (const file of ns.ls(self, 'tasks/credentials-report-')) readBundle(file);
  for (const line of ns.read('darknet-passwords.txt').split(/\r?\n/)) {
    const text = line.trim(), split = text.indexOf('=');
    if (text && !text.startsWith('#') && split > 0) passwords.set(text.slice(0, split).trim(), text.slice(split + 1).trim());
  }
  return passwords;
}
/**
 * One-shot sweep for Dark Net reward caches on every host we can currently see.
 *
 * Run from home:  run get-darknet-caches.js
 * Optional:       --dry-run   list caches and access status without opening
 *
 * The cache opener must run on the host that owns the .cache file. This script
 * establishes a session where it has credentials, copies the opener there, and
 * reports hosts that still need a scout/backdoor/stasis link.
 */
export async function main(ns) {
  // Keep cache-sweep diagnostics visible; this script is user-run, not a daemon.
  const dryRun = ns.args.includes('--dry-run');
  const self = ns.getHostname();
  const cacheFile = 'darknet-cache.js';
  const dependencies = [cacheFile, 'darknet-reward-policy.js', cacheContextFile];
  const passwords = readPasswords(ns, self);
  const explicitHosts = [], explicitPasswords = new Map();
  for (const arg of ns.args) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--host=') && arg.length > 7) explicitHosts.push(arg.slice(7));
    if (arg.startsWith('--password=')) {
      const value = arg.slice(11), split = value.indexOf('=');
      if (split > 0 && split < value.length - 1) explicitPasswords.set(value.slice(0, split), value.slice(split + 1));
    }
  }

  const hosts = new Set();
  try { for (const host of ns.dnet.probe()) hosts.add(host); } catch { }
  for (const host of passwords.keys()) hosts.add(host);
  for (const host of explicitHosts) hosts.add(host);
  for (const [host, password] of explicitPasswords) passwords.set(host, password);

  for (const file of ns.ls(self, 'tasks/dnet-')) {
    try {
      const record = JSON.parse(ns.read(file));
      if (typeof record.host === 'string') hosts.add(record.host);
      if (typeof record.target === 'string') hosts.add(record.target);
    } catch { }
  }

  let found = 0, opened = 0, inaccessible = 0;
  for (const host of [...hosts].sort()) {
    let caches = [];
    try { caches = ns.ls(host, '.cache'); } catch { continue; }
    if (!caches.length) continue;
    found += caches.length;
    ns.print(`${host}: ${caches.length} cache file(s): ${caches.join(', ')}`);
    if (dryRun) continue;

    try {
      const details = ns.dnet.getServerDetails(host);
      if (details.hasSession !== true) {
        const password = passwords.get(host);
        if (typeof password !== 'string') {
          ns.print(`${host}: no session or saved password; cannot open caches.`);
          inaccessible++;
          continue;
        }
        const session = ns.dnet.connectToSession(host, password);
        if (session?.success !== true) {
          ns.print(`${host}: session rejected (${session?.code ?? 'unknown'}); cannot open caches.`);
          inaccessible++;
          continue;
        }
      }

      if (ns.ps(host).some(p => p.filename === cacheFile)) {
        ns.print(`${host}: cache opener already running.`);
        continue;
      }
      if (!await ns.scp(dependencies, host, self)) {
        ns.print(`${host}: could not deploy cache opener.`);
        inaccessible++;
        continue;
      }
      const ram = ns.getScriptRam(cacheFile, host);
      const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
      if (!(ram > 0) || free < ram) {
        ns.print(`${host}: needs ${ns.format.ram(ram)} free RAM, has ${ns.format.ram(free)}.`);
        inaccessible++;
        continue;
      }
      const pid = ns.exec(cacheFile, host, 1);
      if (!pid) {
        ns.print(`${host}: cache opener launch failed (no direct access or RAM).`);
        inaccessible++;
        continue;
      }
      opened++;
      await ns.sleep(250);
      const reward = cacheRewardFile(host);
      if (ns.fileExists(reward, host)) {
        try { await ns.scp(reward, 'home', host); } catch { }
      }
      ns.print(`${host}: opened ${caches.length} cache file(s).`);
    } catch (error) {
      ns.print(`${host}: ${String(error)}`);
      inaccessible++;
    }
  }

  ns.print(`Dark Net cache sweep: ${found} cache file(s) on ${hosts.size} known host(s); opened ${opened} host(s); ${inaccessible} inaccessible.`);
  if (inaccessible) ns.print('Inaccessible hosts need a scout/backdoor/stasis link; rerun after one is available.');
}
