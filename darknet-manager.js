/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  // Helper scripts are split out of the scout so each stays small enough for
  // low-RAM darknet servers (darkweb has 16 GB): the scout only cracks and
  // spreads; darknet-loot.js phishes and opens caches; darknet-stasis.js is a
  // one-shot that applies a stasis link.
  const lootFile = "darknet-loot.js";
  const stasisFile = "darknet-stasis.js";
  const codeFiles = [nodeFile, lootFile, stasisFile];
  // Every ns call is logged by default (scp, probe, getServerMaxRam...), which
  // buried the useful lines. Keep only what this script prints itself.
  ns.disableLog("ALL");

  const hashText = (text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${text.length}:${h}`;
  };
  // Last state copied to each host, so files are only re-sent when they change
  // or the host was wiped/restarted, not on every poll.
  const deployed = new Map();
  const deployedCode = new Map();
  // Only print a status line when it changes.
  const lastNote = new Map();
  const note = (key, message) => {
    if (lastNote.get(key) === message) return;
    lastNote.set(key, message);
    ns.print(message);
  };

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

  const authenticate = async (host, details, saved, candidates) => {
    if (details.hasSession) return true;
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
                // heartbleed returns { success, code, message, logs: string[] }.
                if (result?.logs?.length) ns.print(`${host}: heartbleed log clue: ${JSON.stringify(result.logs)}`);
              } catch (error) {
                ns.print(`${host}: heartbleed unavailable: ${String(error)}`);
              }
            }
            continue;
          }

          // Only reallocate while the owner still blocks RAM; it is slow, and
          // fails with NoBlockRAM once there is nothing left to free.
          if (details.blockedRam > 0) {
            try { await ns.dnet.memoryReallocation(host); }
            catch (error) { ns.print(`${host}: memory reallocation failed: ${String(error)}`); }
          }

          if (ns.fileExists(nodeFile, "home")) {
            // Only scp files that actually exist on home to avoid warnings.
            const files = [...codeFiles, candidateFile, ...ns.ls("home", "darknet-passwords-")]
              .filter((f) => ns.fileExists(f, "home"));
            if (ns.fileExists(passwordFile, "home")) files.push(passwordFile);
            const signature = files.map((f) => `${f}:${hashText(ns.read(f))}`).join("|");
            const codeSignature = codeFiles.filter((f) => files.includes(f)).map((f) => hashText(ns.read(f))).join("|");

            if (deployed.get(host) !== signature || !ns.fileExists(nodeFile, host)) {
              // Running copies keep their old code, so stop them when the scripts
              // changed; the launch step below starts the new version.
              const oldCode = deployedCode.get(host);
              if (oldCode !== undefined && oldCode !== codeSignature) {
                for (const p of ns.ps(host)) if (codeFiles.includes(p.filename)) ns.kill(p.pid);
              }
              await ns.scp(files, host, "home");
              deployed.set(host, signature);
              deployedCode.set(host, codeSignature);
            }

            const running = ns.ps(host).some((p) => p.filename === nodeFile);
            if (!running) {
              const ram = ns.getScriptRam(nodeFile, host);
              const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
              if (ram > 0 && free >= ram) {
                // One thread: the scout launches the loot helper with the remaining RAM.
                const pid = ns.exec(nodeFile, host, 1);
                if (!pid) note(`${host}:scout`, `${host}: scout launch failed; ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
                else note(`${host}:scout`, `${host}: scout started (${fmtRam(ram)}).`);
              } else {
                note(`${host}:scout`, `${host}: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
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