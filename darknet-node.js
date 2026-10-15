/** Runs on authenticated darknet servers, scouts outward, and tries exact-match candidates. */
import { isBlankPassword, parsePasswordEntries, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords } from './darknet-solvers.js';
import { stockSignalFile, chooseStockPromotion } from './darknet-stock-policy.js';
import { frontierFile, chooseMigrationTarget } from './darknet-migration-policy.js';
export async function main(ns) {
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  // Heavy calls live in helpers so this scout fits low-RAM servers (darkweb has
  // 16 GB): loot = openCache + phishingAttack, stasis = one-shot setStasisLink.
  const lootFile = "darknet-loot.js";
  const stasisFile = "darknet-stasis.js";
  const cacheFile = "darknet-cache.js";
  const promoteFile = 'darknet-promote.js';
  const migrateFile = 'darknet-migrate.js';
  const codeFiles = [nodeFile, lootFile, stasisFile, cacheFile, "darknet-solvers.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-dictionaries.js", promoteFile, "darknet-stock-policy.js", migrateFile, "darknet-migration-policy.js"];
  let lastMigration = 0;
  const reportedHints = new Map();
  // Retry when the shared credential or candidate files change, not on every mutation.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();
  const nilProgress = new Map();
  // Every ns call is logged by default; keep only what this script prints.
  ns.disableLog("ALL");

  const hashText = (text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${text.length}:${h}`;
  };
  const startupRevision = codeFiles.filter(file => ns.fileExists(file, ns.getHostname())).map(file => hashText(ns.read(file))).join('|');
  // Last state copied to each neighbour, so files are only re-sent when they change.
  const deployed = new Map();
  // Only print a status line when it changes.
  const lastNote = new Map();
  const note = (key, message) => {
    if (lastNote.get(key) === message) return;
    lastNote.set(key, message);
    ns.print(message);
  };
  const heartbeatFile = `tasks/dnet-${encodeURIComponent(ns.getHostname())}.json`;
  let lastHeartbeat = 0;
  const syncedReports = new Map();
  const heartbeat = async () => {
    if (Date.now() - lastHeartbeat < 30_000) return;
    const info = ns.dnet.getServerDetails(ns.getHostname());
    await ns.write(heartbeatFile, JSON.stringify({ host: ns.getHostname(), pid: ns.pid, at: Date.now(), version: 3,
      depth: info.depth, difficulty: info.difficulty, revision: startupRevision }), 'w');
    try { await ns.scp(heartbeatFile, 'home', ns.getHostname()); } catch { /* local heartbeat still helps adjacent scouts */ }
    lastHeartbeat = Date.now();
  };

  const readMap = () => {
    const map = new Map();
    const files = [passwordFile, ...ns.ls(ns.getHostname(), "darknet-passwords-")];
    for (const file of files) {
      for (const [host, password] of parsePasswordEntries(ns.read(file))) map.set(host, password);
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
    // Servers with no password (hint "There is no password", length 0, or the
    // ZeroLogon model) accept the empty string. The length filter below would
    // otherwise discard every candidate and leave nothing to try.
    if (isBlankPassword(info)) return [""];
    const clue = typeof info.data === "string" ? info.data.trim() : "";
    // "Type the numbers to prove you are human": the clue is the password with
    // other characters mixed in, so the password is the clue's digits alone.
    // Tried first, even if the length differs, since it is a single guess.
    const digitsOf = (text) => String(text ?? "").replace(/\D+/g, "");
    const wantsDigits = info.passwordFormat === "numeric" || /number|digit/i.test(String(info.passwordHint ?? ""));
    const derived = wantsDigits ? [digitsOf(info.data), digitsOf(info.passwordHint)].filter((x) => x.length > 0) : [];
    // Very short numeric passwords are cheap to enumerate (at most 999 tries).
    const counted = info.passwordFormat === "numeric" && info.passwordLength >= 1 && info.passwordLength <= 3
      ? Array.from({ length: 10 ** info.passwordLength }, (_, n) => String(n).padStart(info.passwordLength, "0"))
      : [];
    return [...new Set([...modelCandidates(info), ...derived, ...(clue && matches(clue) ? [clue] : []), ...words.filter(matches), ...counted])];
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
    for (let tries = 0; tries < 3; tries++) {
      await heartbeat();
      result = await ns.dnet.authenticate(host, password);
      if (result.success || Number(result.code) !== TIMED_OUT) break;
    }
    return result;
  };
  const authenticate = async (host, info, saved, candidates) => {
    if (info.hasSession) return true;
    if (!isBlankPassword(info) && supportsFeedbackModel(info)) {
      if (!nilProgress.has(host)) nilProgress.set(host, {});
      const progress = nilProgress.get(host);
      if (typeof saved === "string" && progress.rejectedSaved !== saved) {
        const result = await tryPassword(host, saved);
        if (result.success) { nilProgress.delete(host); return true; }
        if (Number(result.code) !== AUTH_FAILURE) return false;
        progress.rejectedSaved = saved;
      }
      if (ns.getPlayer().skills.charisma < info.requiredCharismaSkill) {
        note(`${host}:nil`, `${host}: ${info.modelId} solving needs ${info.requiredCharismaSkill} Charisma for Heartbleed.`);
        return false;
      }
      const solution = await solveFeedbackPassword({ ...info, hostname: host },
        password => tryPassword(host, password),
        () => ns.dnet.heartbleed(host, { peek: true, logsToCapture: 20 }), progress, () => ns.dnet.labreport());
      if (!solution.success) {
        note(`${host}:nil`, `${host}: ${info.modelId} waiting: ${solution.reason}${solution.code ? ` (${solution.code})` : ""}.`);
        return false;
      }
      const reportFile = `darknet-passwords-${host.replace(/[^a-z0-9_-]/gi, "_")}.txt`;
      await ns.write(reportFile, `${host}=${solution.password}\n`, "w");
      try { await ns.scp(reportFile, "home", ns.getHostname()); }
      catch (error) { ns.print(`${host}: could not sync credential report to home: ${String(error)}`); }
      nilProgress.delete(host);
      note(`${host}:nil`, `${host}: ${info.modelId} solved using feedback; saved to ${reportFile}.`);
      return true;
    }
    const signature = JSON.stringify([typeof saved === "string" ? saved : null, candidates]);
    const previous = attemptedInputs.get(host);
    if (previous && previous.signature === signature && Date.now() - previous.at < RETRY_AFTER_MS) return false;
    if (typeof saved === "string") {
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
      // Run the helpers on this server with whatever RAM the scout leaves free.
      const self = ns.getHostname();
      await heartbeat();
      // Retry credential delivery after temporary disconnections. Mark reports
      // synchronized only after scp succeeds, so failed uploads are not lost.
      for (const file of ns.ls(self, 'darknet-passwords-')) {
        const signature = hashText(ns.read(file));
        if (syncedReports.get(file) === signature) continue;
        try { if (await ns.scp(file, 'home', self)) syncedReports.set(file, signature); } catch { /* retry next cycle */ }
      }
      const freeRam = () => ns.getServerMaxRam(self) - ns.getServerUsedRam(self);
      const procRunning = (file) => ns.ps(self).some((p) => p.filename === file);
      const linked = ns.dnet.getStasisLinkedServers();
      let stasisStarted = false;
      // Deep servers are valuable exploration anchors. Respect the global link cap.
      const selfInfo = ns.dnet.getServerDetails(self);
      if (selfInfo.depth >= 2 && selfInfo.difficulty % 8 < 6 && !linked.includes(self) && linked.length < ns.dnet.getStasisLinkLimit()
          && ns.fileExists(stasisFile, self) && !procRunning(stasisFile)) {
        const ram = ns.getScriptRam(stasisFile, self);
        if (ram > 0 && freeRam() >= ram) stasisStarted = ns.exec(stasisFile, self, 1) > 0;
      }
      // Open any .cache file on this server. The loot helper does this too, so the
      // one-shot is only needed when loot isn't running (e.g. not enough RAM yet).
      let cacheStarted = false;
      if (!stasisStarted && ns.ls(self, ".cache").length > 0 && ns.fileExists(cacheFile, self)
          && !procRunning(cacheFile) && !procRunning(lootFile)) {
        const ram = ns.getScriptRam(cacheFile, self);
        if (ram > 0 && freeRam() >= ram) cacheStarted = ns.exec(cacheFile, self, 1) > 0;
        else note(`${self}:cache`, `${self}: cache file waiting; needs ${fmtRam(ram)} free RAM, ${fmtRam(freeRam())} available.`);
      }
      // Give one promotion thread space before allocating the remaining RAM to phishing.
      if (!stasisStarted && !cacheStarted && ns.fileExists(promoteFile, self) && !procRunning(promoteFile)) {
        try {
          if (ns.fileExists(stockSignalFile, 'home') && await ns.scp(stockSignalFile, self, 'home') &&
              chooseStockPromotion(JSON.parse(ns.read(stockSignalFile)))) {
            const ram = ns.getScriptRam(promoteFile, self);
            const loot = ns.ps(self).find(p => p.filename === lootFile);
            if (freeRam() < ram && loot?.threads > 1) { ns.kill(loot.pid); await ns.sleep(1); }
            if (ram > 0 && freeRam() >= ram) ns.exec(promoteFile, self, 1);
          }
        } catch { /* No current stock signal or TIX access: keep phishing. */ }
      }
      // The stasis and cache one-shots need their RAM first; loot is sized on the next pass.
      if (!stasisStarted && !cacheStarted && ns.fileExists(lootFile, self) && !procRunning(lootFile)) {
        const ram = ns.getScriptRam(lootFile, self);
        const threads = ram > 0 ? Math.floor(freeRam() / ram) : 0;
        if (threads >= 1) ns.exec(lootFile, self, threads);
        else note(`${self}:loot`, `${self}: not enough free RAM for the loot helper (${fmtRam(ram)} per thread, ${fmtRam(freeRam())} free).`);
      }
      const known = readMap();
      const candidates = [...new Set([...readCandidates(), ...dictionaryWords(ns)])];
      for (const host of ns.dnet.probe()) {
        try {
        if (host === self) continue;
        const info = ns.dnet.getServerDetails(host);
        if (info.isOnline === false) continue;
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
        // Re-send files only when they changed or the neighbour was wiped. Running
        // scripts are never killed here: neighbours also deploy back to us, and
        // killing each other's scouts on a version change would loop.
        const syncFiles = [...codeFiles, passwordFile, candidateFile, ...ns.ls(self, "darknet-passwords-")]
          .filter((f) => ns.fileExists(f, self));
        const signature = syncFiles.map((f) => `${f}:${hashText(ns.read(f))}`).join("|");
        if (deployed.get(host) !== signature || !ns.fileExists(nodeFile, host)) {
          if (!(await ns.scp(syncFiles, host, self))) {
            note(`${host}:sync`, `${host}: deployment incomplete; will retry.`);
            continue;
          }
          deployed.set(host, signature);
        }
        const scout = ns.ps(host).find(p => p.filename === nodeFile);
        const statusFile = `tasks/dnet-${encodeURIComponent(host)}.json`;
        try {
          if (scout && ns.fileExists(statusFile, host) && await ns.scp(statusFile, self, host)) {
            const status = JSON.parse(ns.read(statusFile));
            const revision = codeFiles.filter(file => ns.fileExists(file, self)).map(file => hashText(ns.read(file))).join('|');
            if (isStalledScout(scout, status) || (scout && status.pid === scout.pid && (status.version !== 3 || status.revision !== revision))) {
              ns.kill(scout.pid);
              for (const process of ns.ps(host)) if ([lootFile, stasisFile, cacheFile, promoteFile, migrateFile].includes(process.filename)) ns.kill(process.pid);
              note(`${host}:restart`, `${host}: restarting stalled scout.`);
            }
          }
        } catch { /* only restart when a matching stale heartbeat is verified */ }
        if (!ns.ps(host).some(p => p.filename === nodeFile)) {
          const ram = ns.getScriptRam(nodeFile, host);
          const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
          if (ram > 0 && free >= ram) {
            // One thread: the scout on that server starts its own loot helper.
            const pid = ns.exec(nodeFile, host, 1);
            if (!pid) note(`${host}:scout`, `${host}: scout launch failed (${fmtRam(free)} free, ${fmtRam(ram)} required).`);
            else note(`${host}:scout`, `${host}: scout started (${fmtRam(ram)}).`);
          } else note(`${host}:scout`, `${host}: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
        }
        } catch (error) { ns.print(`${host}: skipped after a server/network error: ${String(error)}`); }
      }
      if (Date.now() - lastMigration > 300000 && ns.fileExists(migrateFile, self) && !procRunning(migrateFile)) {
        try {
          if (await ns.scp(frontierFile, self, 'home')) {
            const neighbours = ns.dnet.probe().filter(host => host !== self).map(host => ({ host,
              ...ns.dnet.getServerDetails(host), stasis: linked.includes(host), scoutRunning: ns.ps(host).some(p => p.filename === nodeFile) }));
            const target = chooseMigrationTarget(neighbours, JSON.parse(ns.read(frontierFile)));
            if (target) {
              const ram = ns.getScriptRam(migrateFile, self), loot = ns.ps(self).find(p => p.filename === lootFile);
              if (ram > 0 && freeRam() < ram && loot?.threads > 1) { ns.kill(loot.pid); await ns.sleep(1); }
              const threads = ram > 0 ? Math.min(16, Math.floor(freeRam() / ram)) : 0;
              if (threads && ns.exec(migrateFile, self, threads, target)) lastMigration = Date.now();
            }
          }
        } catch { /* Network changes: leave scouts and stasis links in place. */ }
      }
      await ns.sleep(15_000);
    } catch (error) {
      ns.print(`Darknet scout recovered: ${String(error)}`);
      await ns.sleep(15_000);
    }
  }
}
