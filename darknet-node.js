import {createDarknetCredentials} from './darknet-credentials.js';
import { surveyFile, stormRequestFile } from './darknet-storm-policy.js';
import {restoreLabyrinthProgress,packLabyrinthProgress} from './darknet-labyrinth-policy.js';
import {serviceDarknetAnchor,anchorRequestFile} from './darknet-anchor-policy.js';
import {mazeLeaseOwned} from './darknet-development-policy.js';
/** Runs on authenticated darknet servers, scouts outward, and tries exact-match candidates. */
import { candidatePasswordTurn, isBlankPassword, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords } from './darknet-solvers.js';
import { stockSignalFile, chooseStockPromotion } from './darknet-stock-policy.js';
import { frontierFile, chooseMigrationTarget } from './darknet-migration-policy.js';
export function createDarknetProgressReporter(publish, now=()=>Date.now()) {
  let last=-Infinity;
  return async () => {
    const at=now();if(at>=last && at-last<30000)return false;
    try { await publish(true);last=now();return true; } catch { return false; }
  };
}
export async function main(ns) {
  const credentials = createDarknetCredentials(ns);
  const candidateFile = "darknet-candidates.txt";
  const nodeFile = "darknet-node.js";
  // Heavy calls live in helpers so this scout fits low-RAM servers (darkweb has
  // 16 GB): loot = openCache + phishingAttack, stasis = one-shot setStasisLink.
  const lootFile = "darknet-loot.js";
  const stasisFile = "darknet-stasis.js";
  const cacheFile = "darknet-cache.js";
  const promoteFile = 'darknet-promote.js';
  const migrateFile = 'darknet-migrate.js';
  const codeFiles = [nodeFile, lootFile, stasisFile, cacheFile, "darknet-solvers.js", "darknet-credentials.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-labyrinth-policy.js", "darknet-anchor-policy.js", "darknet-development-policy.js", "darknet-dictionaries.js", promoteFile, "darknet-stock-policy.js", migrateFile, "darknet-migration-policy.js", "darknet-storm-policy.js", "darknet-storm.js", "darknet-contract-policy.js", "darknet-reward-policy.js", "tasks/dnet-cache-context.json"];
  let lastMigration = 0;
  let lastLootResize = Date.now();
  const reportedHints = new Map();
  // Retry when the shared credential or candidate files change, not on every mutation.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map();
  const nilProgress = new Map();
  const mazeRequests=new Map();let lastMazeSurvey=0;
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
  const deployedFiles = new Map();
  // Only print a status line when it changes.
  const lastNote = new Map();
  const note = (key, message) => {
    if (lastNote.get(key) === message) return;
    lastNote.set(key, message);
    ns.print(message);
  };
  const heartbeatFile = `tasks/dnet-${encodeURIComponent(ns.getHostname())}.json`;
  let lastHeartbeat = 0;
  const heartbeat = async () => {
    if (Date.now() - lastHeartbeat < 30_000) return;
    const info = ns.dnet.getServerDetails(ns.getHostname());
    await ns.write(heartbeatFile, JSON.stringify({ host: ns.getHostname(), pid: ns.pid, at: Date.now(), version: 3,
      depth: info.depth, difficulty: info.difficulty, revision: startupRevision }), 'w');
    try { await ns.scp(heartbeatFile, 'home', ns.getHostname()); } catch { /* local heartbeat still helps adjacent scouts */ }
    lastHeartbeat = Date.now();
  };

  const survey = async (busy, stormHoldId = null) => {
    const host = ns.getHostname(), files = ns.ls(host), info = ns.dnet.getServerDetails(host);
    let lastCacheAt = 0;try{lastCacheAt=JSON.parse(ns.read('tasks/dnet-last-cache.json')||'{}').at||0;}catch{}
    let cacheRewards=null;try{cacheRewards=JSON.parse(ns.read('tasks/dnet-cache-rewards-'+encodeURIComponent(host)+'.json'));}catch{}
    const report = { rooted:typeof ns.hasRootAccess==="function"&&ns.hasRootAccess(host),depth:info.depth,modelId:info.modelId,passwordLength:info.passwordLength,passwordFormat:info.passwordFormat,data:info.data,isStationary:info.isStationary,hasSession:info.hasSession,maxRam:ns.getServerMaxRam(host),cacheRewards, lastCacheAt, stormHoldId, solverProgress:hashText(JSON.stringify({feedback:[...nilProgress],candidates:[...attemptedInputs].map(([host,state])=>[host,state.signature,state.cursor])},(_key,value)=>typeof value==="bigint"?value.toString():value instanceof Set?[...value]:value)), version: 1, host, pid: ns.pid, at: Date.now(), busy:busy||[...mazeRequests.values()].some(r=>r.owned&&Date.now()-r.at<90000),
      mazeRequests:[...mazeRequests.values()].slice(0,8),blockedRam: info.blockedRam, caches: files.filter(file => file.endsWith('.cache')).length,
      contractFiles: files.filter(file => file.endsWith('.cct')).sort(),
      contracts: files.filter(file => file.endsWith('.cct')).length, seed: files.includes('STORM_SEED.exe'),
      neighbours: ns.dnet.probe().filter(name => name !== host) };
    const file = surveyFile(host);
    await ns.write(file, JSON.stringify(report), 'w');
    try { await ns.scp(file, 'home', host); } catch { /* stale reports block storms */ }
  };

  const reportProgress=createDarknetProgressReporter(async busy=>{await heartbeat();await survey(busy);});
  const readLogs=async (host,options)=>{
    await reportProgress();
    try { return await ns.dnet.heartbleed(host,options); }
    finally { await reportProgress(); }
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
      await reportProgress();
      try { result = await ns.dnet.authenticate(host, password); }
      finally { await reportProgress(); }
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

  const authenticate = async (host, info, saved, candidates) => {
    if (info.hasSession){if(mazeRequests.delete(host))await survey(false);return true;}
    if (!isBlankPassword(info) && supportsFeedbackModel(info)) {
      if (!nilProgress.has(host)) nilProgress.set(host, {});
      const progress = nilProgress.get(host);
      let mazeScope=null;const mazeFile='tasks/dnet-maze-'+encodeURIComponent(host)+'.json';
      if(info.modelId==='(The Labyrinth)')try{
        const context=JSON.parse(ns.read('tasks/dnet-cache-context.json'));
        if([context.nodeReset,context.augReset].every(Number.isFinite))mazeScope=[context.nodeReset,context.augReset,host,info.modelId,info.passwordLength,info.passwordFormat,info.data];
        if(mazeScope&&!progress.signature){
          let raw=ns.read(mazeFile),restored=null;
          try{if(raw.length<250000)restored=restoreLabyrinthProgress(JSON.parse(raw),mazeScope);}catch{}
          if(!restored&&ns.fileExists(mazeFile,'home')&&await ns.scp(mazeFile,ns.getHostname(),'home')){raw=ns.read(mazeFile);if(raw.length<250000)restored=restoreLabyrinthProgress(JSON.parse(raw),mazeScope);}
          Object.assign(progress,restored||{});
        }
      }catch{/* Start with native reports if no validated checkpoint is available. */}
      if (typeof saved === "string" && progress.rejectedSaved !== saved) {
        const result = await trySavedPassword(host, saved, info);
        if (result.success) { nilProgress.delete(host); return true; }
        if (Number(result.code) !== AUTH_FAILURE) return false;
        progress.rejectedSaved = saved;
      }
      if (ns.getPlayer().skills.charisma < info.requiredCharismaSkill) {
        note(`${host}:nil`, `${host}: ${info.modelId} solving needs ${info.requiredCharismaSkill} Charisma for Heartbleed.`);
        return false;
      }
      const mazeGuard=async()=>{
        if(!mazeScope)return info.modelId!=='(The Labyrinth)';
        const owned=await mazeLeaseOwned(ns,mazeScope);
        mazeRequests.set(host,{maze:host,scope:mazeScope,at:Date.now(),progressAt:progress.mazeProgressAt||0,owned});
        if(Date.now()-lastMazeSurvey>=15000){await survey(owned);lastMazeSurvey=Date.now();}
        return owned;
      };
      if(info.modelId==='(The Labyrinth)'&&!await mazeGuard()){note(`${host}:maze-lease`,`${host}: waiting for the home manager's maze exploration grant.`);return false;}
      const solution = await solveFeedbackPassword({ ...info, hostname: host, probeBudget: 8 },
        async password => info.modelId!=='(The Labyrinth)'||await mazeGuard()?tryPassword(host,password):{success:false,code:409,message:'Maze grant changed'},
        () => readLogs(host, { peek: true, logsToCapture: 20 }), progress,async()=>{
          if(!await mazeGuard())return {success:false};
          const report=await ns.dnet.labreport();
          if(report?.success&&Array.isArray(report.coords)&&report.coords.length===2&&report.coords.every(Number.isInteger)){
            const coordinate=report.coords.join(',');if(coordinate!==progress.mazeCoordinate){progress.mazeCoordinate=coordinate;progress.mazeProgressAt=Date.now();}
          }return report;
        },async()=>await mazeGuard()?ns.dnet.labradar():{success:false});
      if(mazeScope&&await mazeLeaseOwned(ns,mazeScope))try{const saved=packLabyrinthProgress(progress,mazeScope);if(saved){await ns.write(mazeFile,JSON.stringify(saved),'w');await ns.scp(mazeFile,'home',ns.getHostname());}}catch(error){ns.print('Maze checkpoint unavailable: '+String(error));}
      if (!solution.success) {
        note(`${host}:nil`, `${host}: ${info.modelId} waiting: ${solution.reason}${solution.code ? ` (${solution.code})` : ""}.`);
        return false;
      }
      await credentials.save(host, solution.password);
      nilProgress.delete(host);
      if(mazeRequests.delete(host))await survey(false);
      note(`${host}:nil`, `${host}: ${info.modelId} solved using feedback; saved in credential store.`);
      return true;
    }
    if(!attemptedInputs.has(host))attemptedInputs.set(host,{});
    const result=await candidatePasswordTurn({...info,hostname:host},saved,candidates,attemptedInputs.get(host),
      password=>tryPassword(host,password),password=>trySavedPassword(host,password,info),Date.now(),8,RETRY_AFTER_MS);
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

  while (true) {
    try {
      // Run the helpers on this server with whatever RAM the scout leaves free.
      const self = ns.getHostname();
      // Acknowledge only between exploration passes. Keep authentication/migration idle until expiry.
      if(ns.fileExists(stormRequestFile,'home'))try{
        if(await ns.scp(stormRequestFile,self,'home')){
          const request=JSON.parse(ns.read(stormRequestFile));
          if(typeof request.id==='string'&&request.id&&Number.isFinite(request.at)&&request.at<=Date.now()&&Date.now()-request.at<30000){
            await survey(ns.ps(self).some(p=>[cacheFile,stasisFile,migrateFile].includes(p.filename)),request.id);
            await heartbeat();await ns.sleep(1000);continue;
          }
        }
      }catch{ /* No verified hold request: continue normal exploration. */ }
      await survey(true);
      await heartbeat();
      const freeRam = () => ns.getServerMaxRam(self) - ns.getServerUsedRam(self);
      const procRunning = (file) => ns.ps(self).some((p) => p.filename === file);
      const linked = ns.dnet.getStasisLinkedServers();
      let stasisStarted = await serviceDarknetAnchor(ns);
      let anchorHold=false;try{const r=JSON.parse(ns.read(anchorRequestFile));anchorHold=r.expiresAt>Date.now()&&!['done','blocked'].includes(r.phase)&&ns.isRunning(r.owner);}catch{}
      // Deep servers are valuable exploration anchors. Respect the global link cap.
      const selfInfo = ns.dnet.getServerDetails(self);
      if (!anchorHold&&selfInfo.depth >= 2 && selfInfo.difficulty % 8 < 6 && !linked.includes(self) && linked.length < ns.dnet.getStasisLinkLimit()
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
      const known = await credentials.refresh();
      const candidates = [...new Set([...readCandidates(), ...dictionaryWords(ns)])];
      // Read and hash the small deployment set once per exploration pass.
      const syncFiles = [...codeFiles, candidateFile].filter(f => ns.fileExists(f, self));
      const fileHashes = new Map(syncFiles.map(f => [f, hashText(ns.read(f))]));
      const signature = syncFiles.map(f => f+':'+fileHashes.get(f)).join('|');
      const codeSignature = codeFiles.filter(f => fileHashes.has(f)).map(f => fileHashes.get(f)).join('|');
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
              const result = await readLogs(host, { peek: true, logsToCapture: 8 });
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
        if (deployed.get(host) !== signature || !ns.fileExists(nodeFile, host)) {
              const previous = ns.fileExists(nodeFile, host) ? deployedFiles.get(host) : null;
              const changedFiles = syncFiles.filter(f => previous?.get(f) !== fileHashes.get(f));
          if (!(await ns.scp(changedFiles, host, self))) {
            note(`${host}:sync`, `${host}: deployment incomplete; will retry.`);
            continue;
          }
          deployed.set(host, signature);
              deployedFiles.set(host, fileHashes);
        }
        const scout = ns.ps(host).find(p => p.filename === nodeFile);
        const statusFile = `tasks/dnet-${encodeURIComponent(host)}.json`;
        try {
          if (scout && ns.fileExists(statusFile, host) && await ns.scp(statusFile, self, host)) {
            const status = JSON.parse(ns.read(statusFile));
            const revision = codeSignature;
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
      // Ask the worker to finish its action and yield; never kill an in-flight payout.
      const loot = ns.ps(self).find(p => p.filename === lootFile);
      if (!stasisStarted && !cacheStarted && loot && Date.now()-lastLootResize >= 120000) {
        const ram = ns.getScriptRam(lootFile, self);
        const extra = ram > 0 ? Math.floor(freeRam()/ram) : 0;
        if (extra >= Math.max(1, Math.ceil(loot.threads/4))) {
          await ns.write('tasks/dnet-loot-resize.json', JSON.stringify({pid:loot.pid,at:Date.now(),expiresAt:Date.now()+45000}), 'w');
          lastLootResize = Date.now();
        }
      }
      await survey(ns.ps(self).some(p => [cacheFile, stasisFile, migrateFile].includes(p.filename)));
      await ns.sleep(15_000);
    } catch (error) {
      ns.print(`Darknet scout recovered: ${String(error)}`);
      await ns.sleep(15_000);
    }
  }
}
