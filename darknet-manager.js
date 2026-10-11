/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  ns.disableLog("sleep");
  ns.disableLog("scan");

  const parsePasswords = () => {
    const result = new Map();
    for (const line of ns.read(passwordFile).split(/\r?\n/)) {
      const row = line.trim();
      if (!row || row.startsWith("#")) continue;
      const i = row.indexOf("=");
      if (i > 0) result.set(row.slice(0, i).trim(), row.slice(i + 1).trim());
    }
    return result;
  };
  const parseCandidates = () => [...new Set(ns.read(candidateFile).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#")))];
  const reportedHints = new Map();
  const attemptedHosts = new Set();
  const ensureDarknetUnlock = () => {
    if (!ns.hasTorRouter()) {
      try { ns.singularity.purchaseTor(); } catch { /* Singularity may not be unlocked. */ }
    }
    if (ns.hasTorRouter() && !ns.fileExists("DarkscapeNavigator.exe", "home")) {
      try { ns.singularity.purchaseProgram("DarkscapeNavigator.exe"); } catch { /* wait until affordable/API is unlocked */ }
    }
  };
  const authenticate = async (host, details, saved, candidates) => {
    if (details.hasSession) return true;
    if (saved) {
      const result = await ns.dnet.authenticate(host, saved);
      if (result.success) return true;
      ns.print(`${host}: saved password failed (${result.code}); trying candidates.`);
    }
    if (attemptedHosts.has(host)) return false;
    attemptedHosts.add(host);
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
    ns.print(`${host}: no match in ${candidates.length} candidates; this host will not be retried until this manager restarts.`);
    return false;
  };

  ns.print("Darknet manager active. Tries exact words in darknet-candidates.txt plus saved hostname=password entries.");
  while (true) {
    try {
      ensureDarknetUnlock();
      const passwords = parsePasswords();
      const candidates = parseCandidates();
      for (const host of ns.dnet.probe()) {
        const details = ns.dnet.getServerDetails(host);
        if (!details.isOnline) continue;
        if (!passwords.has(host) && !attemptedHosts.has(host)) {
          const hint = details.passwordHint || "none";
          if (reportedHints.get(host) !== hint) {
            ns.print(`${host} (depth ${details.depth}) discovered; trying candidate words. Hint: ${hint}`);
            reportedHints.set(host, hint);
          }
        }
        const authenticated = await authenticate(host, details, passwords.get(host), candidates);
        if (!authenticated) continue;
        await ns.dnet.memoryReallocation(host);
        if (ns.fileExists(nodeFile, "home")) {
          await ns.scp([nodeFile, passwordFile, candidateFile], host, "home");
          const running = ns.ps(host).some(p => p.filename === nodeFile);
          if (!running) {
            const ram = ns.getScriptRam(nodeFile, host);
            const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
            if (ram > 0 && free >= ram) {
              const threads = Math.floor(free / ram);
              const pid = ns.exec(nodeFile, host, threads);
              if (!pid) ns.print(`${host}: scout launch failed; ${ns.formatRam(free)} free, ${ns.formatRam(ram)} required.`);
              else ns.print(`${host}: scout started (${threads} threads).`);
            } else ns.print(`${host}: scout needs ${ns.formatRam(ram)} free RAM; ${ns.formatRam(free)} available.`);
          }
        }
      }
      await ns.sleep(30_000);
    } catch (error) {
      ns.print(`Darknet manager waiting: ${String(error)}`);
      await ns.sleep(30_000);
    }
  }
}