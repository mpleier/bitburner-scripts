import {beginDarknetRefresh,observeDarknetRefresh,darknetRefreshEvidence} from './darknet-refresh-policy.js';
import {darknetContractDisposition} from './darknet-contract-policy.js';
import { darknetEconomics } from './darknet-economics-policy.js';
import { surveyPrefix, stormRequestFile, stormStateFile, stormResultFile, applyStormReceipt, planStorm } from './darknet-storm-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import { isScriptPaused } from './automation-control.js';
/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
import { isBlankPassword, parsePasswordEntries, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords } from './darknet-solvers.js';
import { frontierFile } from './darknet-migration-policy.js';
export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
  const passwordFile = "darknet-passwords.txt";
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  // Helper scripts are split out of the scout so each stays small enough for
  // low-RAM darknet servers (darkweb has 16 GB): the scout only cracks and
  // spreads; darknet-loot.js phishes and opens caches; darknet-stasis.js is a
  // one-shot that applies a stasis link.
  const lootFile = "darknet-loot.js";
  const stasisFile = "darknet-stasis.js";
  const cacheFile = "darknet-cache.js";
  const codeFiles = [nodeFile, lootFile, stasisFile, cacheFile, "darknet-solvers.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-dictionaries.js", "darknet-promote.js", "darknet-stock-policy.js", "darknet-migrate.js", "darknet-migration-policy.js", "darknet-storm-policy.js", "darknet-storm.js", "darknet-contract-policy.js"];
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
      for (const [host, password] of parsePasswordEntries(ns.read(file))) result.set(host, password);
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
    // Servers with no password (hint "There is no password", length 0, or the
    // ZeroLogon model) accept the empty string. The length filter below would
    // otherwise discard every candidate and leave nothing to try.
    if (isBlankPassword(details)) return [""];
    const clue = typeof details.data === "string" ? details.data.trim() : "";
    // "Type the numbers to prove you are human": the clue is the password with
    // other characters mixed in, so the password is the clue's digits alone.
    // Tried first, even if the length differs, since it is a single guess.
    const digitsOf = (text) => String(text ?? "").replace(/\D+/g, "");
    const wantsDigits = details.passwordFormat === "numeric" || /number|digit/i.test(String(details.passwordHint ?? ""));
    const derived = wantsDigits ? [digitsOf(details.data), digitsOf(details.passwordHint)].filter((x) => x.length > 0) : [];
    // Very short numeric passwords are cheap to enumerate (at most 999 tries).
    const counted = details.passwordFormat === "numeric" && details.passwordLength >= 1 && details.passwordLength <= 3
      ? Array.from({ length: 10 ** details.passwordLength }, (_, n) => String(n).padStart(details.passwordLength, "0"))
      : [];
    return [...new Set([...modelCandidates(details), ...derived, ...(clue && matches(clue) ? [clue] : []), ...words.filter(matches), ...counted])];
  };

  const reportedHints = new Map();
  // Cache complete attempt inputs so failed saved credentials are not retried every poll.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();
  const nilProgress = new Map();

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
    for (let tries = 0; tries < 3; tries++) {
      result = await ns.dnet.authenticate(host, password);
      if (result.success || Number(result.code) !== TIMED_OUT) break;
    }
    return result;
  };

  const trySavedPassword = async (host, password, info) => {
    // Native reconnect has no authentication delay. Stationary/story servers retain the normal path.
    if (info.isStationary === false && password.length <= 100) {
      try { if (ns.dnet.connectToSession(host, password).success) return { success: true, code: 200 }; }
      catch { /* Old API or missing access: authenticate normally. */ }
    }
    return tryPassword(host, password);
  };

  const authenticate = async (host, details, saved, candidates) => {
    if (details.hasSession) return true;
    if (!isBlankPassword(details) && supportsFeedbackModel(details)) {
      if (!nilProgress.has(host)) nilProgress.set(host, {});
      const progress = nilProgress.get(host);
      // Reuse a verified password without requiring Heartbleed after a restart.
      // Remember rejected saved values so they are not retried every poll.
      if (typeof saved === "string" && progress.rejectedSaved !== saved) {
        const result = await trySavedPassword(host, saved, details);
        if (result.success) { nilProgress.delete(host); return true; }
        if (Number(result.code) !== AUTH_FAILURE) return false;
        progress.rejectedSaved = saved;
      }
      if (ns.getPlayer().skills.charisma < details.requiredCharismaSkill) {
        note(`${host}:nil`, `${host}: ${details.modelId} solving needs ${details.requiredCharismaSkill} Charisma for Heartbleed.`);
        return false;
      }
      const solution = await solveFeedbackPassword({ ...details, hostname: host },
        password => tryPassword(host, password),
        () => ns.dnet.heartbleed(host, { peek: true, logsToCapture: 20 }), progress);
      if (!solution.success) {
        note(`${host}:nil`, `${host}: ${details.modelId} waiting: ${solution.reason}${solution.code ? ` (${solution.code})` : ""}.`);
        return false;
      }
      const reportFile = `darknet-passwords-${host.replace(/[^a-z0-9_-]/gi, "_")}.txt`;
      await ns.write(reportFile, `${host}=${solution.password}\n`, "w");
      nilProgress.delete(host);
      note(`${host}:nil`, `${host}: ${details.modelId} solved using feedback; saved to ${reportFile}.`);
      return true;
    }
    const signature = JSON.stringify([typeof saved === "string" ? saved : null, candidates]);
    const previous = attemptedInputs.get(host);
    if (previous && previous.signature === signature && Date.now() - previous.at < RETRY_AFTER_MS) return false;
    if (typeof saved === "string") {
      const result = await trySavedPassword(host, saved, details);
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

  const manageStorm = async () => {
    const reports = [];
    for (const file of ns.ls('home', surveyPrefix)) {
      try {
        const report = JSON.parse(ns.read(file));
        report.live = Number.isInteger(report.pid) && ns.ps(report.host).some(p => p.pid === report.pid && p.filename === nodeFile);
        reports.push(report);
      } catch { /* invalid or deleted hosts cannot authorize a storm */ }
    }
    let state = {};
    try { state = JSON.parse(ns.read(stormStateFile) || '{}'); } catch { }
    const roots = ns.dnet.probe(), now = Date.now(), currentReset=ns.getResetInfo(), reset=currentReset.lastNodeReset;
    const player=ns.getPlayer(),capabilities=[player.skills.charisma,player.mults?.dnet_money,player.mults?.crime_money,player.mults?.crime_success];
    const context=capabilities.every(Number.isFinite)?JSON.stringify([reset,currentReset.lastAugReset,Math.floor(capabilities[0]/250),...capabilities.slice(1)]):null;
    try { state = applyStormReceipt(state, JSON.parse(ns.read(stormResultFile) || '{}'), reset, now); } catch { }
    // A failed scout is not a locked frontier. Only native session state can distinguish them.
    const reachable=new Set(roots);for(const r of reports.filter(r=>r.live&&r.at<=now&&now-r.at<=90000))for(const h of r.neighbours||[])reachable.add(h);
    const frontier=[];
    for(const host of reachable)try{
      if(!reports.some(r=>r.host===host&&r.live)&&!ns.ps(host).some(p=>p.filename===nodeFile)&&ns.dnet.getServerDetails(host).hasSession===false)frontier.push(host);
    }catch{ /* Unknown hosts never authorize an early refresh. */ }
    const currentReports=reports.filter(r=>!frontier.includes(r.host));
    const decision = planStorm(currentReports, roots, state, now, reset,{stalled:true,frontier});
    if(ns.ps('home').some(p=>/contractor|contract-solver/i.test(p.filename))){decision.launch=false;decision.reason='Contract solver active';} 
    let totalIncome=null;try{totalIncome=ns.getMoneySources().sinceInstall.darknet;}catch{}
    const lastCacheAt=Math.max(0,...reports.filter(report=>report.live&&report.at<=now&&now-report.at<90000).map(report=>Number(report.lastCacheAt)||0));
    decision.state.refresh=observeDarknetRefresh(state.refresh,{at:now,reset,augReset:currentReset.lastAugReset,context,income:totalIncome,lastCacheAt,reports,receipt:state.lastResult});
    const evidence=darknetRefreshEvidence(decision.state.refresh,{reset,augReset:currentReset.lastAugReset,context},now);
    decision.state.economics=darknetEconomics(state.economics,totalIncome,lastCacheAt,reset,now,evidence);
    if(decision.ready){
      const hosts=new Set(JSON.parse(decision.signature).map(row=>row[0]));let contracts,validation;
      try{contracts=JSON.parse(ns.read('tasks/contracts-status.json'));validation=JSON.parse(ns.read('tasks/contract-validation.json'));}catch{}
      decision.state.contracts=darknetContractDisposition(currentReports.filter(r=>hosts.has(r.host)),contracts,validation,currentReset,now);
      if(!decision.state.contracts.allow){decision.launch=false;decision.reason=decision.state.contracts.reason;}
    }
    if(decision.launch&&!decision.state.economics.allow){decision.launch=false;decision.reason=decision.state.economics.reason;}
    note('storm-status', `StormSeed: ${decision.reason}.`);
    if (decision.launch && !maintenanceRequested(ns) && !isScriptPaused(ns, ns.getScriptName())) {
      const host = decision.seedHost, helper = 'darknet-storm.js';
      if (ns.ps(host).some(p => p.filename === helper)) return;
      if (await ns.scp([helper, 'darknet-storm-policy.js', 'darknet-contract-policy.js'], host, 'home')) {
        const ram = ns.getScriptRam(helper, host);
        if (ram > 0) {
          if (ns.getServerMaxRam(host) - ns.getServerUsedRam(host) < ram)
            for (const p of ns.ps(host)) if (p.filename === lootFile) ns.kill(p.pid);
          if (ns.getServerMaxRam(host) - ns.getServerUsedRam(host) >= ram) {
            const request = { id: `${ns.pid}:${now}`, host, at: now, reset, reports:currentReports, roots, signature: decision.signature, progressSignature:decision.progressSignature, mode:decision.mode, frontier:decision.frontier, income:totalIncome, incomeTolerance:decision.state.economics.allowLowIncome?decision.state.economics.moneyPerSecond*60:0, lastCacheAt };
            await ns.write(stormRequestFile, JSON.stringify(request), 'w');
            decision.state.pending = { id: request.id, host, at: now };
            decision.state.refresh=beginDarknetRefresh(decision.state.refresh,{id:request.id,at:now,reset,augReset:currentReset.lastAugReset,context,hosts:currentReports.filter(r=>r.live&&now-r.at<=90000)});
            // Save before launching: manager restarts must not dispatch duplicate storms.
            decision.state.lastAttempt = now;
            await ns.write(stormStateFile, JSON.stringify(decision.state), 'w');
            const pid = ns.exec(helper, host, 1);
            if (pid) note('storm', `StormSeed on ${host}: ${decision.reason}.`);
          }
        }
      }
    }
    await ns.write(stormStateFile, JSON.stringify(decision.state), 'w');
  };

  ns.print("Darknet manager active. Tries exact words in darknet-candidates.txt plus saved hostname=password entries.");
  while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
    try {
      ensureDarknetUnlock();
      const passwords = parsePasswords();
      const candidates = [...new Set([...parseCandidates(), ...dictionaryWords(ns)])];
      let depth = 0;
      for (const file of ns.ls('home', 'tasks/dnet-')) {
        try {
          const status = JSON.parse(ns.read(file));
          if (status.pid && Number.isFinite(status.depth) && Date.now() - status.at < 120000 && ns.isRunning(status.pid))
            depth = Math.max(depth, status.depth);
        } catch { }
      }
      await ns.write(frontierFile, JSON.stringify({ depth, expiresAt: Date.now() + 90000 }), 'w');

      for (const host of ns.dnet.probe()) {
        try {
          const details = ns.dnet.getServerDetails(host);
          if (details.isOnline === false) continue;

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
              if (!(await ns.scp(files, host, "home"))) {
                note(`${host}:sync`, `${host}: deployment incomplete; will retry.`);
                continue;
              }
              deployed.set(host, signature);
              deployedCode.set(host, codeSignature);
            }

            const scout = ns.ps(host).find(p => p.filename === nodeFile);
            try {
              const status = JSON.parse(ns.read(`tasks/dnet-${encodeURIComponent(host)}.json`) || '{}');
              if (isStalledScout(scout, status) || (scout && status.pid === scout.pid && (status.version !== 3 || status.revision !== codeSignature))) {
                ns.kill(scout.pid);
                for (const process of ns.ps(host)) if ([lootFile, stasisFile, cacheFile, 'darknet-promote.js', 'darknet-migrate.js'].includes(process.filename)) ns.kill(process.pid);
                note(`${host}:restart`, `${host}: refreshing an outdated or stalled scout.`);
              }
            } catch { /* missing heartbeat: leave an existing scout running */ }
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

      await manageStorm();
      await ns.sleep(30_000);
    } catch (error) {
      ns.print(`Darknet manager waiting: ${String(error)}`);
      await ns.sleep(30_000);
    }
  }
}
