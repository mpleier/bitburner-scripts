/** Runs on authenticated darknet servers, scouts outward, and tries exact-match candidates. */
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  const reportedHints = new Map();
  const attemptedHosts = new Set();
  ns.disableLog("sleep");
  ns.disableLog("scp");
  ns.disableLog("scan");

  const readMap = () => {
    const map = new Map();
    for (const row of ns.read(passwordFile).split(/\r?\n/).map(x => x.trim())) {
      if (!row || row.startsWith("#")) continue;
      const i = row.indexOf("=");
      if (i > 0) map.set(row.slice(0, i).trim(), row.slice(i + 1).trim());
    }
    return map;
  };
  const readCandidates = () => [...new Set(ns.read(candidateFile).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#")))];
  const openCaches = () => {
    for (const file of ns.ls(ns.getHostname(), ".cache")) {
      try {
        const result = ns.dnet.openCache(file, true);
        if (result.success) ns.print(`Opened ${file}: ${result.message}`);
      } catch (error) { ns.print(`Could not open ${file}: ${String(error)}`); }
    }
  };
  const authenticate = async (host, info, saved, candidates) => {
    if (info.hasSession) return true;
    if (attemptedHosts.has(host)) return false;
    attemptedHosts.add(host);
    if (saved) {
      const result = await ns.dnet.authenticate(host, saved);
      if (result.success) return true;
      ns.print(`${host}: saved password failed (${result.code}); trying candidates.`);
    }
    for (let i = 0; i < candidates.length; i++) {
      const password = candidates[i];
      if (password === saved) continue;
      const result = await ns.dnet.authenticate(host, password);
      if (result.success) {
        await ns.write(passwordFile, `${host}=${password}` + "\n", "a");
        ns.print(`${host}: candidate matched (${i + 1}/${candidates.length}); saved to ${passwordFile}.`);
        return true;
      }
      if (result.code !== "AuthFailure") {
        ns.print(`${host}: candidate check stopped (${result.code}); will retry after rediscovery.`);
        attemptedHosts.delete(host);
        return false;
      }
    }
    ns.print(`${host}: no match in ${candidates.length} candidates; this scout will not retry until restarted.`);
    return false;
  };

  while (true) {
    try {
      openCaches();
      try { await ns.dnet.phishingAttack(); } catch { /* some servers restrict this */ }
      const known = readMap();
      const candidates = readCandidates();
      for (const host of ns.dnet.probe()) {
        const info = ns.dnet.getServerDetails(host);
        if (!info.isOnline) continue;
        if (!known.has(host) && !attemptedHosts.has(host)) {
          const hint = info.passwordHint || "none";
          if (reportedHints.get(host) !== hint) {
            ns.print(`${host} (depth ${info.depth}) is visible. Trying candidate words. Hint: ${hint}`);
            reportedHints.set(host, hint);
          }
        }
        const authenticated = await authenticate(host, info, known.get(host), candidates);
        if (!authenticated) continue;
        await ns.dnet.memoryReallocation(host);
        await ns.scp([nodeFile, passwordFile, candidateFile], host, ns.getHostname());
        if (!ns.ps(host).some(p => p.filename === nodeFile)) {
          const ram = ns.getScriptRam(nodeFile, host);
          const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
          if (ram > 0 && free >= ram) {
            const pid = ns.exec(nodeFile, host, Math.floor(free / ram));
            if (!pid) ns.print(`${host}: scout launch failed (${ns.formatRam(free)} free, ${ns.formatRam(ram)} required).`);
          } else ns.print(`${host}: scout needs ${ns.formatRam(ram)} free RAM; ${ns.formatRam(free)} available.`);
        }
      }
      await ns.dnet.nextMutation();
    } catch (error) {
      ns.print(`Darknet scout recovered: ${String(error)}`);
      await ns.sleep(15_000);
    }
  }
}