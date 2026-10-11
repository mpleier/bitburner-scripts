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
  // v3 renamed ns.formatRam -> ns.format.ram; use whichever exists.
  const fmtRam = (v) => {
    try { if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(v); } catch {}
    try { return ns.formatRam(v); } catch {}
    return `${Number(v).toFixed(2)}GB`;
  };
  // Result codes are numeric (DarknetResponseCodeType): 401 = wrong password,
  // 408 = request timed out (password may or may not have been right).
  const AUTH_FAILURE = 401;
  const TIMED_OUT = 408;
  const RETRY_AFTER_MS = 10 * 60_000;
  const tryPassword = async (host, password) => {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await ns.dnet.authenticate(host, password);
      if (result.success || Number(result.code) !== TIMED_OUT) break;
    }
    return result;
  };
  const authenticate = async (host, info, saved, candidates) => {
    if (info.hasSession) return true;
    const signature = `${saved || ""}\0${candidates.join("\0")}`;
    const previous = attemptedInputs.get(host);
    if (previous && previous.signature === signature && Date.now() - previous.at < RETRY_AFTER_MS) return false;
    if (saved) {
      const result = await tryPassword(host, saved);
      if (result.success) return true;
      if (Number(result.code) !== AUTH_FAILURE) {
        ns.print(`${host}: saved password check stopped (${result.code}: ${result.message}); will retry.`);
        return false;
      }
      ns.print(`${host}: saved password rejected; trying candidates.`);
    }
    for (let i = 0; i < candidates.length; i++) {
      const password = candidates[i];
      if (password === saved) continue;
      const result = await tryPassword(host, password);
      if (result.success) {
        const reportFile = `darknet-passwords-${host.replace(/[^a-z0-9_-]/gi, "_")}.txt`;
        await ns.write(reportFile, `${host}=${password}\n`, "w");
        try { await ns.scp(reportFile, "home", ns.getHostname()); }
        catch (error) { ns.print(`${host}: could not sync credential report to home: ${String(error)}`); }
        ns.print(`${host}: candidate matched (${i + 1}/${candidates.length}); saved to ${reportFile}.`);
        return true;
      }
      if (Number(result.code) !== AUTH_FAILURE) {
        // Not a wrong-password answer (offline, moved, not adjacent...). Don't
        // mark the host as tried, so the next pass starts again.
        ns.print(`${host}: candidate check stopped (${result.code}: ${result.message}); will retry.`);
        return false;
      }
    }
    attemptedInputs.set(host, { signature, at: Date.now() });
    ns.print(`${host}: no match in ${candidates.length} candidates; retrying in ${RETRY_AFTER_MS / 60_000} min or when inputs change.`);
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
              if (result?.logs?.length) ns.print(`${host}: heartbleed log clue: ${JSON.stringify(result.logs)}`);
            } catch (error) { ns.print(`${host}: heartbleed unavailable: ${String(error)}`); }
          }
          continue;
        }
        // Only reallocate while the owner still blocks RAM; it is slow and fails
        // with NoBlockRAM once there is nothing left to free.
        if (info.blockedRam > 0) {
          try { await ns.dnet.memoryReallocation(host); }
          catch (error) { ns.print(`${host}: memory reallocation failed: ${String(error)}`); }
        }
        const syncFiles = [nodeFile, passwordFile, candidateFile, ...ns.ls(ns.getHostname(), "darknet-passwords-")];
        await ns.scp(syncFiles, host, ns.getHostname());
        if (!ns.ps(host).some(p => p.filename === nodeFile)) {
          const ram = ns.getScriptRam(nodeFile, host);
          const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
          if (ram > 0 && free >= ram) {
            const pid = ns.exec(nodeFile, host, Math.floor(free / ram));
            if (!pid) ns.print(`${host}: scout launch failed (${fmtRam(free)} free, ${fmtRam(ram)} required).`);
          } else ns.print(`${host}: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
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