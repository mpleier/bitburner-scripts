import {coordinateCharismaGoal,charismaTrainingFile} from './darknet-charisma-policy.js';
import {ramRecoveryFile,ramRecoveryModel,scheduleRamRecovery} from './darknet-ram-policy.js';
import {readDarknetReports,prioritizeDarknetTargets,darknetDeploymentFile,readDarknetDeployment,createAttemptBudget} from './darknet-throughput-policy.js';
import {createDarknetCredentials} from './darknet-credentials.js';
import {refreshDarknetScouts,prepareDarknetRollout} from './darknet-rollout.js';
import {cacheContextFile,rewardSummaryFile,darknetRewardProductivity} from './darknet-reward-policy.js';
import {coordinateDarknetAnchors} from './darknet-anchor-policy.js';
import {coordinateDarknetDevelopment} from './darknet-development-policy.js';
import {darknetObservationFile,darknetCapabilityContext} from './darknet-observation-policy.js';
import {beginDarknetRefresh,darknetRefreshEvidence} from './darknet-refresh-policy.js';
import {darknetContractDisposition} from './darknet-contract-policy.js';
import { darknetEconomics, recurringPlayerIncome } from './darknet-economics-policy.js';
import { ensureStanekFirst } from './stanek-first-policy.js';
import { surveyPrefix, stormRequestFile, stormStateFile, stormResultFile, applyStormReceipt, planStorm,observeStormBlocker } from './darknet-storm-policy.js';
import {registerAutomation,automationHeartbeat,beginAutomationAction,endAutomationAction,maintenanceRequested} from './runtime-policy.js';
import { isScriptPaused } from './automation-control.js';
/** Darknet coordinator. Tries supplied exact-match candidates on discovered servers. */
import { candidatePasswordTurn, isBlankPassword, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords, passwordLengthMatches } from './darknet-solvers.js';
import { frontierFile } from './darknet-migration-policy.js';
export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
  // Accept Stanek before labyrinth rewards or augmentation purchases can block the Church.
  const stanekFirst=ensureStanekFirst(ns);
  if(stanekFirst.accepted)ns.print("Accepted Stanek's Gift before any other augmentation.");
  // A webstorm deletes/moves most of the network and grants no immediate reward.
  // Keep it opt-in until there is measured stagnation, rather than treating a seed as a reset button.
  const autoStormSeed=(ns.args||[]).includes('--enable-auto-stormseed')||(ns.args||[]).includes('--auto-stormseed');
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
  const watcherFile = "darknet-cache-watch.js";
  const codeFiles = [nodeFile, lootFile, "darknet-auth.js", "darknet-bleed.js", stasisFile, cacheFile, watcherFile, "darknet-solvers.js", "darknet-throughput-policy.js", "darknet-charisma-policy.js", "darknet-ram-policy.js", "darknet-ram.js", "darknet-credentials.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-labyrinth-policy.js", "darknet-navigator-policy.js", "darknet-maze.js", "darknet-anchor-policy.js", "darknet-development-policy.js", "darknet-dictionaries.js", "darknet-promote.js", "darknet-stock-policy.js", "darknet-migrate.js", "darknet-migration-policy.js", "darknet-storm-policy.js", "darknet-storm.js", "darknet-contract-policy.js", "darknet-reward-policy.js", "tasks/dnet-cache-context.json"];
  let lastHeartbeatPrune = 0;
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
  /** ns.exec on a darknet host needs both a live session and a direct connection. */
  const executionState = (host) => {
    try {
      const d = ns.dnet.getServerDetails(host);
      if (d?.isOnline === false) return {ready:false,reason:'offline'};
      let directHosts=[];try{directHosts=ns.dnet.probe();}catch{}
      const directlyConnected = d?.hasStasisLink === true || d?.backdoorInstalled === true ||
        (Array.isArray(directHosts) && directHosts.includes(host));
      if (!directlyConnected) return {ready:false,reason:'not directly connected'};
      if (d?.hasSession === false) return {ready:false,reason:'no authenticated session'};
      return {ready:true,reason:'session ready'};
    } catch (error) {
      return {ready:false,reason:'session check unavailable: '+String(error)};
    }
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
      if (!passwordLengthMatches(details,value)) return false;
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
    const digitsOf = (text) => String(text ?? "").replace(/\D+/g, "");
    const wantsDigits = details.passwordFormat === "numeric" || /number|digit/i.test(String(details.passwordHint ?? ""));
    const derived = wantsDigits ? [digitsOf(details.data), digitsOf(details.passwordHint)].filter((x) => x.length > 0) : [];
    // Very short numeric passwords are cheap to enumerate (at most 999 tries).
    const counted = details.passwordFormat === "numeric" && details.passwordLength >= 1 && details.passwordLength <= 3
      ? Array.from({ length: 10 ** details.passwordLength }, (_, n) => String(n).padStart(details.passwordLength, "0"))
      : [];
    return [...new Set([...modelCandidates(details).filter(matches), ...derived.filter(matches), ...(clue && matches(clue) ? [clue] : []), ...words.filter(matches), ...counted])];
  };

  const reportedHints = new Map(),managerCharismaBlocked=new Map();
  // Cache complete attempt inputs so failed saved credentials are not retried every poll.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();
  let targetTurn=0;let takeAttempt=()=>true;
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

  const nativeCall=async(host,kind,action)=>{
    let expectedMs;try{const details=ns.dnet.getServerDetails(host),threads=ns.getRunningScript()?.threads||1,player=ns.getPlayer();expectedMs=kind==='darknet-heartbleed'?ns.formulas.dnet.getHeartbleedTime(details,threads,player):ns.formulas.dnet.getAuthenticateTime(details,threads,player);}catch{}
    beginAutomationAction(ns,kind,expectedMs);
    try{return await action();}finally{endAutomationAction(ns);}
  };
  const tryPassword = async (host, password) => {
    try {
      const details = ns.dnet.getServerDetails(host);
      if (!passwordLengthMatches(details, password))
        return {success:false,code:AUTH_FAILURE,message:'Candidate length mismatch'};
    } catch { }
    let result;
    for (let tries = 0; tries < 3; tries++) {
      if(!takeAttempt())return result||{success:false,code:408,message:"Target turn budget reached"};
      result=await nativeCall(host,'darknet-authenticate',()=>ns.dnet.authenticate(host,password));
      if (result.success || Number(result.code) !== TIMED_OUT) break;
    }
    return result;
  };

  const trySavedPassword = async (host, password, info) => {
    if (!passwordLengthMatches(info, password))
      return {success:false,code:AUTH_FAILURE,message:'Candidate length mismatch'};
    // Native reconnect has no authentication delay. Stationary/story servers retain the normal path.
    if (info.isStationary === false && password.length <= 100) {
      try { if (ns.dnet.connectToSession(host, password).success) return { success: true, code: 200 }; }
      catch { /* Old API or missing access: authenticate normally. */ }
    }
    return tryPassword(host, password);
  };
  // A labyrinth is a story server, not a normal password puzzle. Once the maze
  // has been completed it has root access (and usually a reward cache), so stop
  // skipping it and let the normal saved-credential path attach/deploy.
  const labyrinthSolved = (host, details) => {
    if (details.modelId !== '(The Labyrinth)') return false;
    if (details.hasSession) return true;
    try { if (ns.hasRootAccess(host)) return true; } catch { }
    try { return ns.ls(host, '.cache').length > 0; } catch { return false; }
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
      if(details.modelId==='(The Labyrinth)'){
        if(!labyrinthSolved(host,details)){note(host+':maze',host+': waiting for an adjacent Dark Net navigator.');return false;}
        if(typeof saved==='string'&&saved){
          const result=await trySavedPassword(host,saved,details);
          if(result.success){nilProgress.delete(host);note(host+':maze',host+': solved; attached with saved credentials.');return true;}
        }
        // Root access is the durable result of finishing the maze. Treat it as
        // authorization to deploy the watcher/scout even if the session lapsed.
        try{if(ns.hasRootAccess(host)){note(host+':maze',host+': solved with root access; deploying without re-authentication.');return true;}}catch{}
        note(host+':maze',host+': maze solved, but no usable saved credential yet.');
        return false;
      }
      const solution = await solveFeedbackPassword({ ...details, hostname: host, probeBudget: 8 },
        password => tryPassword(host, password),
        () => nativeCall(host,'darknet-heartbleed',()=>ns.dnet.heartbleed(host, { peek: true, logsToCapture: 20 })), progress);
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

  const manageStorm = async (reports) => {
    if (!autoStormSeed) {
      note('storm-status', 'StormSeed: automatic dispatch disabled (enable with --enable-auto-stormseed after measured stagnation).');
      return;
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
    decision.state.blocker=observeStormBlocker(state.reset===reset&&state.blocker?.since>=currentReset.lastAugReset?state.blocker:null,decision.blocker,now);
    const blocker=decision.state.blocker;
    const detail=blocker?' ['+blocker.reasons.join(', ')+'; observed '+Math.floor((now-blocker.since)/30000)*30+'s'+(blocker.reportAgeMs===null?'':'; survey '+Math.floor(blocker.reportAgeMs/1000)+'s old')+']':'';
    note('storm-status', `StormSeed: ${decision.reason}${detail}.`);
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
      const snapshot=await readDarknetReports(ns);
      for(const n of snapshot.navigators){const moves=Number.isSafeInteger(n.moves)?n.moves:0,position=Array.isArray(n.coords)?n.coords.join(','):'unknown';const t=n.timing,a=t?.actions?.move,radar=t?.actions?.radar;const speed=a?.count>0&&Number.isFinite(a.ms)?'; '+(a.ms/a.count/1000).toFixed(2)+'s/move, '+(n.threads||1)+' threads, '+((radar?.ms||0)/1000).toFixed(1)+'s radar, '+((t.coordinationMs||0)/1000).toFixed(1)+'s coordination':'';note('navigator:'+n.target,'Maze '+n.target+' on '+n.host+': '+n.phase+'; '+moves+' moves; position '+position+speed+'.');}
      if(!maintenanceRequested(ns)){
        const reports=snapshot.surveys;
        const reset=ns.getResetInfo(),values=await coordinateDarknetDevelopment(ns,reports,reset,snapshot.navigators);
        await coordinateDarknetAnchors(ns,reports,passwords,reset,values);
        const charismaGoal=await coordinateCharismaGoal(ns,[...reports,{live:true,at:Date.now(),neighbours:ns.dnet.probe(),charismaBlocked:[...managerCharismaBlocked.values()]}],reset);
        if(charismaGoal.state==='target'){
          note('charisma-goal','Dark Net Charisma: '+charismaGoal.current+'/'+charismaGoal.target+(charismaGoal.host?' for '+charismaGoal.host:' for the next labyrinth')+'.');
          try{const t=JSON.parse(ns.read(charismaTrainingFile));if(t.parentPid===ns.pid&&t.nodeReset===reset.lastNodeReset&&t.augReset===reset.lastAugReset&&t.target===charismaGoal.target&&t.at<=Date.now()&&Date.now()-t.at<120000)note('charisma-training','Charisma training: '+t.state+'; '+t.reason+'.');}catch{}
        }
      }
      const candidates = [...new Set([...parseCandidates(), ...dictionaryWords(ns)])];
      let depth = 0;
      for(const status of snapshot.heartbeats)if(Number.isFinite(status.depth))depth=Math.max(depth,status.depth);
      await ns.write(frontierFile, JSON.stringify({ depth, expiresAt: Date.now() + 90000 }), 'w');

      // Read and hash the small deployment set once per exploration pass.
      const syncFiles = [...codeFiles, candidateFile].filter(f => ns.fileExists(f, "home"));
      const fileHashes = new Map(syncFiles.map(f => [f, hashText(ns.read(f))]));
      const signature = syncFiles.map(f => f+':'+fileHashes.get(f)).join('|');
      const codeSignature = codeFiles.filter(f => fileHashes.has(f)).map(f => fileHashes.get(f)).join('|');
      await ns.write(darknetDeploymentFile,JSON.stringify({version:1,at:Date.now(),files:syncFiles}),'w');
      await refreshDarknetScouts(ns,syncFiles,codeSignature,upgradePending,snapshot.heartbeats);
      // Every scout leaves a per-host heartbeat on home, and dead/renamed hosts leave theirs
      // behind forever: they are informational copies, so stale ones are pruned within a
      // bounded per-cycle budget to keep saves and directory scans small.
      const pruneNow = Date.now();
      if (pruneNow - lastHeartbeatPrune >= 60000) {
        lastHeartbeatPrune = pruneNow;
        let pruned = 0;
        for (const file of ns.ls('home', 'tasks/dnet-')) {
          if (pruned >= 1500) break;
          if (!file.endsWith('.json') || /-(cache|solver|phishing|loot|navigator|anchor|storm)/.test(file)) continue;
          let record = null;
          try { record = JSON.parse(ns.read(file)); } catch { continue; }
          if (record?.host === undefined || !Number.isFinite(record?.at) || record.at > pruneNow - 6 * 3600000) continue;
          if (ns.rm(file, 'home')) pruned++;
        }
        if (pruned) note('dnet-heartbeat-prune', 'Pruned ' + pruned + ' stale darknet heartbeat files.');
      }
      // darkweb is the launchpad into the Dark Net. Refresh its scout when the
      // manager can actually execute there, otherwise leave the working copy alone.
      try {
        if (ns.serverExists('darkweb') && executionState('darkweb').ready) {
          if (await ns.scp(syncFiles, 'darkweb', 'home')) {
            for (const process of ns.ps('darkweb')) if (codeFiles.includes(process.filename)) ns.kill(process.pid);
            const ram = ns.getScriptRam(nodeFile, 'darkweb');
            const free = ns.getServerMaxRam('darkweb') - ns.getServerUsedRam('darkweb');
            if (ram > 0 && free >= ram) {
              if (ns.exec(nodeFile, 'darkweb', 1)) note('darkweb:scout', 'darkweb: scout started with current code.');
              else note('darkweb:scout', 'darkweb: scout exec rejected after refresh.');
            } else note('darkweb:scout', `darkweb: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
          }
        }
      } catch { /* darkweb is optional until the player can enter the Dark Net. */ }
      // Normal roots come first. Also include any surveyed server that has a
      // reward cache or is a completed labyrinth: those are exactly the hosts
      // the old labyrinth skip used to leave out of the deployment loop.
      const targets = new Set(prioritizeDarknetTargets(ns.dnet.probe(),targetTurn++,host=>ns.dnet.getServerDetails(host)));
      for (const report of snapshot.surveys) {
        if (!report?.host || report.live === false) continue;
        if (Number(report.caches) > 0 || (report.modelId === '(The Labyrinth)' && report.rooted)) targets.add(report.host);
      }
      // The navigator's completion report is the durable maze-solved marker;
      // it may still be on home after the adjacent navigator process exits.
      for (const file of ns.ls('home', 'tasks/dnet-navigator-')) {
        try {
          const report = JSON.parse(ns.read(file));
          if (report?.phase === 'complete' && typeof report.target === 'string') targets.add(report.target);
        } catch { }
      }
      for (const file of ns.ls('home', 'tasks/dnet-cache-rewards-')) {
        try {
          const report = JSON.parse(ns.read(file));
          if (typeof report?.host === 'string') targets.add(report.host);
        } catch { }
      }
      // Credentials include hosts that are not roots and have no live survey.
      // Inspect only hosts that already hold a cache; this catches a completed
      // labyrinth whose navigator has exited and whose cache is still pending.
      for (const host of passwords.keys()) {
        try {
          if (ns.ls(host, '.cache').length && ns.dnet.getServerDetails(host).modelId === '(The Labyrinth)') targets.add(host);
        } catch { }
      }
      for (const host of targets) {
        takeAttempt=createAttemptBudget();
        try {
          let details;
          try { details = ns.dnet.getServerDetails(host); } catch { continue; }
          if (details.isOnline === false) continue;

          if (!passwords.has(host)) {
            const hint = `${details.passwordHint || "none"} (format ${details.passwordFormat || "unknown"}, length ${details.passwordLength ?? "?"})`;
            if (reportedHints.get(host) !== hint) {
              ns.print(`${host} (depth ${details.depth}) discovered; trying candidate words. Hint: ${hint}`);
              reportedHints.set(host, hint);
            }
          }

          if(details.modelId==='(The Labyrinth)'&&ns.getPlayer().skills.charisma<details.requiredCharismaSkill)managerCharismaBlocked.set(host,{host,modelId:details.modelId,required:details.requiredCharismaSkill,at:Date.now()});else managerCharismaBlocked.delete(host);
          const hostCandidates = candidatesFor(details, candidates);
          const authenticated = await authenticate(host, details, passwords.get(host), hostCandidates);

          if (!authenticated) {
            // Peek at recent server logs for useful clues without consuming them.
            const charisma = ns.getPlayer().skills.charisma;
            const required = ns.dnet.getServerRequiredCharismaLevel(host);
            const lastPeek = heartbleedAt.get(host) || 0;
            if (details.modelId!=='(The Labyrinth)'&&charisma >= required && Date.now() - lastPeek > 10 * 60_000) {
              heartbleedAt.set(host, Date.now());
              try {
                const result = await nativeCall(host,'darknet-heartbleed',()=>ns.dnet.heartbleed(host, { peek: true, logsToCapture: 8 }));
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
          if(details.blockedRam>0){
            const reset=ns.getResetInfo(),scope=[reset.lastNodeReset,reset.lastAugReset,host,ramRecoveryModel,details.modelId];
            await scheduleRamRecovery(ns,host,{...details,hasSession:true},scope,'root');
          }

          if (ns.fileExists(nodeFile, "home")) {
            if (deployed.get(host) !== signature || !ns.fileExists(nodeFile, host)) {
              const previous = ns.fileExists(nodeFile, host) ? deployedFiles.get(host) : null;
              const changedFiles = syncFiles.filter(f => previous?.get(f) !== fileHashes.get(f));
              // Running copies keep their old code, so stop them when the scripts
              // changed; the launch step below starts the new version.
              const oldCode = deployedCode.get(host);
              if (oldCode !== undefined && oldCode !== codeSignature) {
                const syncState = executionState(host);
                if (!syncState.ready) {
                  note(`${host}:sync`, `${host}: code changed but scout restart deferred (${syncState.reason}).`);
                } else {
                  if(!await prepareDarknetRollout(ns,host))continue;
                  for (const p of ns.ps(host)) if (codeFiles.includes(p.filename)&&p.filename!=='darknet-maze.js') ns.kill(p.pid);
                }
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
              const refreshState = executionState(host);
              if (isStalledScout(scout, status) || (scout && status.pid === scout.pid && (status.version !== 3 || status.revision !== codeSignature))) {
                if (!refreshState.ready) {
                  note(`${host}:restart`, `${host}: scout refresh deferred (${refreshState.reason}); keeping the existing scout.`);
                } else {
                  if(!await prepareDarknetRollout(ns,host))continue;
                  if(!await ns.scp(syncFiles,host,'home'))continue;
                  ns.kill(scout.pid);
                  for (const process of ns.ps(host)) if ([lootFile, stasisFile, cacheFile, watcherFile, 'darknet-promote.js', 'darknet-migrate.js'].includes(process.filename)) ns.kill(process.pid);
                  note(`${host}:restart`, `${host}: refreshing an outdated or stalled scout.`);
                }
              }
            } catch { /* missing heartbeat: leave an existing scout running */ }
            const running = ns.ps(host).some((p) => p.filename === nodeFile);
            if (!running) {
              const ram = ns.getScriptRam(nodeFile, host);
              const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
              const session = executionState(host);
              if (!session.ready) {
                note(`${host}:scout`, `${host}: scout deferred (${session.reason}); ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
              } else if (ram > 0 && free >= ram) {
                // One thread: the scout launches the loot helper with the remaining RAM.
                const pid = ns.exec(nodeFile, host, 1);
                if (!pid) {
                  const after = executionState(host);
                  note(`${host}:scout`, `${host}: scout exec rejected (${after.reason}); ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
                } else note(`${host}:scout`, `${host}: scout started (${fmtRam(ram)}).`);
              } else {
                note(`${host}:scout`, `${host}: scout needs ${fmtRam(ram)} free RAM; ${fmtRam(free)} available.`);
              }
            }
            // One watcher per host. It re-probes live neighbours each cycle, so
            // a newly created edge is picked up without a manager restart.
            if (ns.fileExists(watcherFile, host) && !ns.ps(host).some(p => p.filename === watcherFile)) {
              const watcherRam = ns.getScriptRam(watcherFile, host);
              const watcherFree = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
              const watcherSession = executionState(host);
              if (!watcherSession.ready) {
                note(`${host}:cache-watch`, `${host}: cache watcher deferred (${watcherSession.reason}).`);
              } else if (watcherRam > 0 && watcherFree >= watcherRam && !ns.exec(watcherFile, host, 1)) {
                note(`${host}:cache-watch`, `${host}: cache watcher exec rejected (${executionState(host).reason}).`);
              }
            }
          }
        } catch (error) {
          ns.print(`${host}: skipped after a server/network error: ${String(error)}`);
        }
      }

      await manageStorm(snapshot.surveys);
      await ns.sleep(30_000);
    } catch (error) {
      ns.print(`Darknet manager waiting: ${String(error)}`);
      await ns.sleep(30_000);
    }
  }
}

