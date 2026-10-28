import {createDarknetCredentials} from './darknet-credentials.js';
import {refreshDarknetScouts} from './darknet-rollout.js';
import {cacheContextFile,rewardSummaryFile,darknetRewardProductivity} from './darknet-reward-policy.js';
import {coordinateDarknetAnchors} from './darknet-anchor-policy.js';
import {coordinateDarknetDevelopment} from './darknet-development-policy.js';
import {darknetObservationFile,darknetCapabilityContext} from './darknet-observation-policy.js';
import {beginDarknetRefresh,darknetRefreshEvidence} from './darknet-refresh-policy.js';
import {darknetContractDisposition} from './darknet-contract-policy.js';
import { darknetEconomics, recurringPlayerIncome } from './darknet-economics-policy.js';
import { surveyPrefix, stormRequestFile, stormStateFile, stormResultFile, applyStormReceipt, planStorm } from './darknet-storm-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import { isScriptPaused } from './automation-control.js';
/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
import { candidatePasswordTurn, isBlankPassword, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords } from './darknet-solvers.js';
import { frontierFile } from './darknet-migration-policy.js';
export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
  const cacheReset=ns.getResetInfo();await ns.write(cacheContextFile,JSON.stringify({nodeReset:cacheReset.lastNodeReset,augReset:cacheReset.lastAugReset}),'w');
  const credentials = createDarknetCredentials(ns);
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  // Helper scripts are split out of the scout so each stays small enough for
  // low-RAM darknet servers (darkweb has 16 GB): the scout only cracks and
  // spreads; darknet-loot.js phishes and opens caches; darknet-stasis.js is a
  // one-shot that applies a stasis link.
  const lootFile = "darknet-loot.js";
  const stasisFile = "darknet-stasis.js";
  const cacheFile = "darknet-cache.js";
  const codeFiles = [nodeFile, lootFile, stasisFile, cacheFile, "darknet-solvers.js", "darknet-credentials.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-labyrinth-policy.js", "darknet-anchor-policy.js", "darknet-development-policy.js", "darknet-dictionaries.js", "darknet-promote.js", "darknet-stock-policy.js", "darknet-migrate.js", "darknet-migration-policy.js", "darknet-storm-policy.js", "darknet-storm.js", "darknet-contract-policy.js", "darknet-reward-policy.js", "tasks/dnet-cache-context.json"];
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
  const deployedFiles = new Map();
  const upgradePending = new Set();
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
      automationHeartbeat(ns);
      try { result = await ns.dnet.authenticate(host, password); }
      finally { automationHeartbeat(ns); }
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
      const solution = await solveFeedbackPassword({ ...details, hostname: host, probeBudget: 8 },
        password => tryPassword(host, password),
        () => ns.dnet.heartbleed(host, { peek: true, logsToCapture: 20 }), progress);
      if (!solution.success) {
        note(`${host}:nil`, `${host}: ${details.modelId} waiting: ${solution.reason}${solution.code ? ` (${solution.code})` : ""}.`);
        return false;
      }
      await credentials.save(host, solution.password);
      nilProgress.delete(host);
      note(`${host}:nil`, `${host}: ${details.modelId} solved using feedback; saved in credential store.`);
      return true;
    }
    if(!attemptedInputs.has(host))attemptedInputs.set(host,{});
    const result=await candidatePasswordTurn({...details,hostname:host},saved,candidates,attemptedInputs.get(host),
      password=>tryPassword(host,password),password=>trySavedPassword(host,password,details),Date.now(),8,RETRY_AFTER_MS);
    if(result.success) {
      if(result.saved)return true;
      await credentials.save(host, result.password);
      note(host+':candidate',host+': candidate matched; saved in credential store.');
      return true;
    }
    if(result.reason==='exhausted')ns.print(host+': no match in '+candidates.length+' candidates; retrying in '+RETRY_AFTER_MS/60000+' min or when inputs change.');
    else if(result.reason==='interrupted')note(host+':candidate',host+': candidate check interrupted ('+result.code+'); progress retained.');
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
    const context=darknetCapabilityContext(currentReset,ns.getPlayer());
    try { state = applyStormReceipt(state, JSON.parse(ns.read(stormResultFile) || '{}'), reset, now); } catch { }
    // A failed scout is not a locked frontier. Only native session state can distinguish them.
    const reachable=new Set(roots);for(const r of reports.filter(r=>r.live&&r.at<=now&&now-r.at<=90000))for(const h of r.neighbours||[])reachable.add(h);
    const frontier=[];
    for(const host of reachable)try{
      if(!reports.some(r=>r.host===host&&r.live)&&!ns.ps(host).some(p=>p.filename===nodeFile)&&ns.dnet.getServerDetails(host).hasSession===false)frontier.push(host);
    }catch{ /* Unknown hosts never authorize an early refresh. */ }
    const currentReports=reports.filter(r=>!frontier.includes(r.host));
    const decision = planStorm(currentReports, roots, state, now, reset,{stalled:true,frontier});
    try{const anchor=JSON.parse(ns.read('tasks/dnet-anchor-request.json'));if(anchor.expiresAt>now&&!['done','blocked'].includes(anchor.phase)){decision.launch=false;decision.reason='Stasis anchor transaction active';}}catch{}
    if(ns.ps('home').some(p=>/contractor|contract-solver/i.test(p.filename))){decision.launch=false;decision.reason='Contract solver active';} 
    let totalIncome=null,playerIncome=null;try{const sources=ns.getMoneySources().sinceInstall;totalIncome=sources.darknet;playerIncome=recurringPlayerIncome(sources);}catch{}
    const lastCacheAt=Math.max(0,...reports.filter(report=>report.live&&report.at<=now&&now-report.at<90000).map(report=>Number(report.lastCacheAt)||0));
    let observations;try{observations=JSON.parse(ns.read(darknetObservationFile));}catch{}
    const observationFresh=observations?.nodeReset===reset&&observations.augReset===currentReset.lastAugReset&&Number.isFinite(observations.at)&&observations.at<=now&&now-observations.at<=90000;
    let rewardSummary;try{rewardSummary=JSON.parse(ns.read(rewardSummaryFile));}catch{}
    const rewardStatus=darknetRewardProductivity(rewardSummary,currentReset,now);
    const evidence=darknetRefreshEvidence(observationFresh?observations:null,{reset,augReset:currentReset.lastAugReset,context},now);
    decision.state.economics=darknetEconomics(state.economics,totalIncome,lastCacheAt,reset,now,evidence,{ready:decision.ready===true,mode:decision.mode,playerIncome,augReset:currentReset.lastAugReset,rewardStatus});
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
      if (await ns.scp([helper, 'darknet-storm-policy.js', 'darknet-contract-policy.js','darknet-reward-policy.js'], host, 'home')) {
        const ram = ns.getScriptRam(helper, host);
        if (ram > 0) {
          if (ns.getServerMaxRam(host) - ns.getServerUsedRam(host) < ram)
            for (const p of ns.ps(host)) if (p.filename === lootFile) ns.kill(p.pid);
          if (ns.getServerMaxRam(host) - ns.getServerUsedRam(host) >= ram) {
            const request = { id: `${ns.pid}:${now}`, host, at: now, reset, reports:currentReports, roots, signature: decision.signature, progressSignature:decision.progressSignature, mode:decision.mode, frontier:decision.frontier, income:totalIncome, rewardGuard:true, incomeTolerance:decision.state.economics.allowLowIncome?decision.state.economics.moneyPerSecond*60:0, lastCacheAt };
            await ns.write(stormRequestFile, JSON.stringify(request), 'w');
            decision.state.pending = { id: request.id, host, at: now };
            decision.state.refresh=beginDarknetRefresh(observationFresh?observations:null,{id:request.id,at:now,reset,augReset:currentReset.lastAugReset,context,forecast:evidence.measuredReturns?{netRate:evidence.netRate,rebuildMs:evidence.rebuildMs,baselineRate:decision.state.economics.moneyPerSecond}:null,hosts:currentReports.filter(r=>r.live&&now-r.at<=90000)});
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
      const passwords = await credentials.refresh();
      if(!maintenanceRequested(ns)){
        const reports=[];
        for(const file of ns.ls('home',surveyPrefix))try{const r=JSON.parse(ns.read(file));r.live=ns.ps(r.host).some(p=>p.pid===r.pid&&p.filename===nodeFile);reports.push(r);}catch{}
        const reset=ns.getResetInfo(),values=await coordinateDarknetDevelopment(ns,reports,reset);
        await coordinateDarknetAnchors(ns,reports,passwords,reset,values);
      }
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

      // Read and hash the small deployment set once per exploration pass.
      const syncFiles = [...codeFiles, candidateFile].filter(f => ns.fileExists(f, "home"));
      const fileHashes = new Map(syncFiles.map(f => [f, hashText(ns.read(f))]));
      const signature = syncFiles.map(f => f+':'+fileHashes.get(f)).join('|');
      const codeSignature = codeFiles.filter(f => fileHashes.has(f)).map(f => fileHashes.get(f)).join('|');
      await refreshDarknetScouts(ns,syncFiles,codeSignature,upgradePending);
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
            if (deployed.get(host) !== signature || !ns.fileExists(nodeFile, host)) {
              const previous = ns.fileExists(nodeFile, host) ? deployedFiles.get(host) : null;
              const changedFiles = syncFiles.filter(f => previous?.get(f) !== fileHashes.get(f));
              // Running copies keep their old code, so stop them when the scripts
              // changed; the launch step below starts the new version.
              const oldCode = deployedCode.get(host);
              if (oldCode !== undefined && oldCode !== codeSignature) {
                for (const p of ns.ps(host)) if (codeFiles.includes(p.filename)) ns.kill(p.pid);
              }
              if (!(await ns.scp(changedFiles, host, "home"))) {
                note(`${host}:sync`, `${host}: deployment incomplete; will retry.`);
                continue;
              }
              deployed.set(host, signature);
              deployedFiles.set(host, fileHashes);
              deployedCode.set(host, codeSignature);
            }

            const scout = ns.ps(host).find(p => p.filename === nodeFile);
            try {
              const status = JSON.parse(ns.read(`tasks/dnet-${encodeURIComponent(host)}.json`) || '{}');
              if (isStalledScout(scout, status) || (scout && status.pid === scout.pid && (status.version !== 3 || status.revision !== codeSignature))) {
                if(!await ns.scp(syncFiles,host,'home'))continue;
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
