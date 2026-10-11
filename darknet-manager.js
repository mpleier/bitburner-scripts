/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  ns.disableLog("sleep");
  ns.disableLog("scan");

  // v3 renamed ns.formatRam -> ns.format.ram. Use whichever exists.
  const fmtRam = (v) => {
    try { if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(v); } catch {}
    try { return ns.formatRam(v); } catch {}
    return `${v.toFixed(2)}GB`;
  };

  const parsePasswords = () => {
    const result = new Map();
    const files = [passwordFile, ...ns.ls("home", "darknet-passwords-")];
    for (const file of files) {
      for (const line of ns.read(file).split(/\r?\n/)) {
        const row = line.trim();
        if (!row || row.startsWith("#")) continue;
        const i = row.indexOf("=");
        if (i > 0) result.set(row.slice(0, i).trim(), row.slice(i + 1).trim());
      }
    }
    return result;
  };

  const parseCandidates = () => [
    ...new Set(
      ns.read(candidateFile)
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x && !x.startsWith("#"))
    ),
  ];

  const candidatesFor = (details, words) => {
    const matches = (value) => {
      if (typeof details.passwordLength === "number" && value.length !== details.passwordLength) return false;
      switch (details.passwordFormat) {
        case "numeric": return /^\d+$/.test(value);
        case "alphabetic": return /^[a-z]+$/i.test(value);
        case "alphanumeric": return /^[a-z0-9]+$/i.test(value);
        case "ASCII": return /^[\x20-\x7e]+$/.test(value);
        default: return true;
      }
    };
    const clue = typeof details.data === "string" ? details.data.trim() : "";
    return [...new Set([...(clue && matches(clue) ? [clue] : []), ...words.filter(matches)])];
  };

  const reportedHints = new Map();
  // Cache complete attempt inputs so failed saved credentials are not retried every poll.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();

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
        ns.print(`${host}: candidate matched (${i + 1}/${candidates.length}); saved to ${reportFile}.`);
        return true;
      }
      if (result.code !== "AuthFailure") {
        ns.print(`${host}: candidate check stopped (${result.code}); will retry after rediscovery.`);
        attemptedInputs.delete(host);
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
        try {
          const details = ns.dnet.getServerDetails(host);
          if (!details.isOnline) continue;

          if (!passwords.has(host)) {
            const hint = `${details.passwordHint || "none"} (format ${details.passwordFormat || "unknown"}, length ${details.passwordLength ?? "?"})`;
            if (reportedHints.get(host) !== hint) {
              ns.print(`${host} (depth ${details.depth}) discovered; trying candidate words. Hint: ${hint}`);
              reportedHints.set(host, hint);
            }
          }

          const hostCandidates = candidatesFor(details, candidates);
          const authenticated = await authenticate(host, details, passwords.get(host), hostCandidates);

          if (!authenticated) {
            // Peek at recent server logs for useful clues without consuming them.
            const charisma = ns.getPlayer().skills.charisma;
            const required = ns.dnet.getServerRequiredCharismaLevel(host);
            const lastPeek = heartbleedAt.get(host) || 0;
            if (charisma >= required && Date.now() - lastPeek > 10 * 60_000) {
              heartbleedAt.set(host, Date.now());
              try {
                const result = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 8 });
                if (result?.data) ns.print(`${host}: heartbleed log clue: ${JSON.stringify(result.data)}`);
              } catch (error) {
                ns.print(`${host}: heartbleed unavailable: ${String(error)}`);
              }
            }
            continue;
          }

          await ns.dnet.memoryReallocation(host);

          if (ns.fileExists(nodeFile, "home")) {
            // Only scp files that actually exist on home to avoid warnings.
            const files = [nodeFile, candidateFile, ...ns.ls("home", "darknet-passwords-")];
            if (ns.fileExists(passwordFile, "home")) files.push(passwordFile);
            await ns.scp(files, host, "home");

            const running = ns.ps(host).some((p) => p.filename === nodeFile);
            if (!running) {
              const ram = ns.getScriptRam(nodeFile, host);
              const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
              if (ram > 0 && free >= ram) {
                const threads = Math.floor(free / ram);
                const pid = ns.exec(nodeFile, host, threads);
                if (!pid) ns.print(`${host}: scout launch failed; ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
                else ns.print(`${host}: scout started (${threads} threads).`);
              } else {
                ns.print(`${host}: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
              }
            }
          }
        } catch (error) {
          ns.print(`${host}: skipped after a server/network error: ${String(error)}`);
        }
      }

      await ns.sleep(30_000);
    } catch (error) {
      ns.print(`Darknet manager waiting: ${String(error)}`);
      await ns.sleep(30_000);
    }
  }
}