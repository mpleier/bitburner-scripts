/** Runs on authenticated darknet servers, scouts outward, and tries exact-match candidates. */
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  const reportedHints = new Map();
  // Retry when the shared credential or candidate files change, not on every mutation.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();
  ns.disableLog("sleep");
  ns.disableLog("scp");
  ns.disableLog("scan");

  const readMap = () => {
    const map = new Map();
    const files = [passwordFile, ...ns.ls(ns.getHostname(), "darknet-passwords-")];
    for (const file of files) {
      for (const row of ns.read(file).split(/\r?\n/).map(x => x.trim())) {
        if (!row || row.startsWith("#")) continue;
        const i = row.indexOf("=");
        if (i > 0) map.set(row.slice(0, i).trim(), row.slice(i + 1).trim());
      }
    }
    return map;
  };
  const readCandidates = () => [...new Set(ns.read(candidateFile).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#")))];
  const candidatesFor = (info, words) => {
    const matches = value => {
      if (typeof info.passwordLength === "number" && value.length !== info.passwordLength) return false;
      switch (info.passwordFormat) {
        case "numeric": return /^\d+$/.test(value);
        case "alphabetic": return /^[a-z]+$/i.test(value);
        case "alphanumeric": return /^[a-z0-9]+$/i.test(value);
        case "ASCII": return /^[\x20-\x7e]+$/.test(value);
        default: return true;
      }
    };
    const clue = typeof info.data === "string" ? info.data.trim() : "";
    return [...new Set([...(clue && matches(clue) ? [clue] : []), ...words.filter(matches)])];
  };
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
    const signature = `${saved || ""}\0${candidates.join("\0")}`;
    if (attemptedInputs.get(host) === signature) return false;
    attemptedInputs.set(host, signature);
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
        const reportFile = `darknet-passwords-${host.replace(/[^a-z0-9_-]/gi, "_")}.txt`;
        await ns.write(reportFile, `${host}=${password}\n`, "w");
        try { await ns.scp(reportFile, "home", ns.getHostname()); }
        catch (error) { ns.print(`${host}: could not sync credential report to home: ${String(error)}`); }
        ns.print(`${host}: candidate matched (${i + 1}/${candidates.length}); saved to ${reportFile}.`);
        return true;
      }
      if (result.code !== "AuthFailure") {
        ns.print(`${host}: candidate check stopped (${result.code}); will retry after rediscovery.`);
        attemptedInputs.delete(host);
        return false;
      }
    }
    ns.print(`${host}: no match in ${candidates.length} candidates; this scout will not retry until restarted.`);
    return false;
  };

  while (true) {
    try {
      openCaches();
      try {
        const result = await ns.dnet.phishingAttack();
        if (result?.success) ns.print(`Phishing succeeded: ${JSON.stringify(result.data ?? result.message ?? "reward received")}`);
      } catch { /* some servers restrict this */ }
      // Deep servers are valuable exploration anchors. Respect the global link cap.
      const self = ns.getHostname();
      const selfDepth = ns.dnet.getDepth(self);
      const linked = ns.dnet.getStasisLinkedServers();
      const linkLimit = ns.dnet.getStasisLinkLimit();
      if (selfDepth >= 2 && !linked.includes(self) && linked.length < linkLimit) {
        try {
          await ns.dnet.setStasisLink(true);
          const linkedAfter = ns.dnet.getStasisLinkedServers();
          if (linkedAfter.includes(self)) ns.print(`${self}: stasis link set (${linkedAfter.length}/${linkLimit}); keeping this deep scout reachable.`);
        } catch (error) { ns.print(`${self}: could not set stasis link: ${String(error)}`); }
      }
      const known = readMap();
      const candidates = readCandidates();
      for (const host of ns.dnet.probe()) {
        try {
        const info = ns.dnet.getServerDetails(host);
        if (!info.isOnline) continue;
        if (!known.has(host)) {
          const hint = `${info.passwordHint || "none"} (format ${info.passwordFormat || "unknown"}, length ${info.passwordLength ?? "?"})`;
          if (reportedHints.get(host) !== hint) {
            ns.print(`${host} (depth ${info.depth}) is visible. Trying candidate words. Hint: ${hint}`);
            reportedHints.set(host, hint);
          }
        }
        const hostCandidates = candidatesFor(info, candidates);
        const authenticated = await authenticate(host, info, known.get(host), hostCandidates);
        if (!authenticated) {
          const charisma = ns.getPlayer().skills.charisma;
          const required = ns.dnet.getServerRequiredCharismaLevel(host);
          const lastPeek = heartbleedAt.get(host) || 0;
          if (charisma >= required && Date.now() - lastPeek > 10 * 60_000) {
            heartbleedAt.set(host, Date.now());
            try {
              const result = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 8 });
              if (result?.data) ns.print(`${host}: heartbleed log clue: ${JSON.stringify(result.data)}`);
            } catch (error) { ns.print(`${host}: heartbleed unavailable: ${String(error)}`); }
          }
          continue;
        }
        await ns.dnet.memoryReallocation(host);
        const syncFiles = [nodeFile, passwordFile, candidateFile, ...ns.ls(ns.getHostname(), "darknet-passwords-")];
        await ns.scp(syncFiles, host, ns.getHostname());
        if (!ns.ps(host).some(p => p.filename === nodeFile)) {
          const ram = ns.getScriptRam(nodeFile, host);
          const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
          if (ram > 0 && free >= ram) {
            const pid = ns.exec(nodeFile, host, Math.floor(free / ram));
            if (!pid) ns.print(`${host}: scout launch failed (${ns.formatRam(free)} free, ${ns.formatRam(ram)} required).`);
          } else ns.print(`${host}: scout needs ${ns.formatRam(ram)} free RAM; ${ns.formatRam(free)} available.`);
        }
        } catch (error) { ns.print(`${host}: skipped after a server/network error: ${String(error)}`); }
      }
      await ns.dnet.nextMutation();
    } catch (error) {
      ns.print(`Darknet scout recovered: ${String(error)}`);
      await ns.sleep(15_000);
    }
  }
}
