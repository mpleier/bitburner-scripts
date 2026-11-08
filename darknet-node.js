import {navigatorFile,scheduleNavigator,chooseMazeThreads} from './darknet-navigator-policy.js';
import {charismaGate} from './darknet-charisma-policy.js';
import {ramRecoveryFile,ramRecoveryModel,scheduleRamRecovery} from './darknet-ram-policy.js';
import {prioritizeDarknetTargets,darknetDeploymentFile,readDarknetDeployment,packSolverProgress,restoreSolverProgress,createAttemptBudget,yieldDarknetLoot,readLootYield,clearLootYield,solverProgressFingerprint} from './darknet-throughput-policy.js';
import {createDarknetCredentials} from './darknet-credentials.js';
import { surveyFile, stormRequestFile } from './darknet-storm-policy.js';
import {serviceDarknetAnchor,anchorRequestFile} from './darknet-anchor-policy.js';
import {mazeLeaseOwned,readMazeLease,mazeLeaseIdentity} from './darknet-development-policy.js';
/** Runs on authenticated darknet servers, scouts outward, and tries exact-match candidates. */
import { candidatePasswordTurn, isBlankPassword, solveFeedbackPassword, supportsFeedbackModel, modelCandidates, isStalledScout, dictionaryWords, passwordLengthMatches, passwordHintCandidates } from './darknet-solvers.js';
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
  const watcherFile = "darknet-cache-watch.js";
  const promoteFile = 'darknet-promote.js';
  const migrateFile = 'darknet-migrate.js';
  const codeFiles = [nodeFile, lootFile, stasisFile, cacheFile, "darknet-cache-watch.js", "darknet-solvers.js", "darknet-throughput-policy.js", "darknet-charisma-policy.js", "darknet-ram-policy.js", "darknet-ram.js", "darknet-credentials.js", "darknet-feedback.js", "darknet-advanced.js", "darknet-labyrinth-policy.js", "darknet-navigator-policy.js", "darknet-maze.js", "darknet-anchor-policy.js", "darknet-development-policy.js", "darknet-dictionaries.js", promoteFile, "darknet-stock-policy.js", migrateFile, "darknet-migration-policy.js", "darknet-storm-policy.js", "darknet-storm.js", "darknet-contract-policy.js", "darknet-reward-policy.js", "tasks/dnet-cache-context.json"];
  let lastMigration = 0;
  let lastLootResize = Date.now();
  const reportedHints = new Map();
  // Retry when the shared credential or candidate files change, not on every mutation.
  const attemptedInputs = new Map();
  const heartbleedAt = new Map(),rejectedCredentials=new Map(),charismaBlocked=new Map();
  let targetTurn=0;let takeAttempt=()=>true;
  let attemptGuard=async()=>true;const solverScopes=new Map();
  const checkpointVersions=new Map(),checkpointOwnership=new Map();
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
    let cacheRewards=null;try{cacheRewards=JSON.parse(ns.read('tasks/dnet-cache-rewards-'+encodeURIComponent(host)+'.json'));}catch{}
    // Cache receipts are per-host; a global last-cache marker would make unrelated hosts
    // look pending and block reward coverage (and therefore StormSeed).
    const lastCacheAt=Number.isFinite(cacheRewards?.at)&&cacheRewards.host===host?cacheRewards.at:0;
    let phishing=null;try{phishing=JSON.parse(ns.read('tasks/dnet-phishing-'+encodeURIComponent(host)+'.json'));}catch{}
    const priorityHandoff=!!readLootYield(ns.read('tasks/dnet-loot-resize.json'));
    const workReasons=[...new Set([...(priorityHandoff?['priority RAM handoff']:[]),...ns.ps(host).filter(p=>[cacheFile,stasisFile,migrateFile,ramRecoveryFile,navigatorFile].includes(p.filename)).map(p=>p.filename===cacheFile?'cache collection':p.filename===stasisFile?'anchor/stasis':p.filename===ramRecoveryFile?'RAM recovery':p.filename===navigatorFile?'maze navigation':'migration'),...([...mazeRequests.values()].some(r=>r.owned&&r.scope?.[3]!==ramRecoveryModel&&Date.now()-r.at<90000)?['cracking']:[]),...(stormHoldId?['maintenance hold']:[])])];
    const report = { charismaBlocked:[...charismaBlocked.values()].filter(t=>Date.now()-t.at<=120000).slice(0,16),workReasons,phishing,rooted:typeof ns.hasRootAccess==="function"&&ns.hasRootAccess(host),depth:info.depth,modelId:info.modelId,passwordLength:info.passwordLength,passwordFormat:info.passwordFormat,data:info.data,isStationary:info.isStationary,hasSession:info.hasSession,maxRam:ns.getServerMaxRam(host),cacheRewards, lastCacheAt, stormHoldId, solverProgress:hashText(solverProgressFingerprint({feedback:[...nilProgress],candidates:[...attemptedInputs].map(([host,state])=>[host,state.signature,state.cursor])})), version: 1, host, pid: ns.pid, at: Date.now(), busy:busy||priorityHandoff||[...mazeRequests.values()].some(r=>r.owned&&Date.now()-r.at<90000),
      mazeRequests:[...mazeRequests.values()].slice(0,8),blockedRam: info.blockedRam, caches: files.filter(file => file.endsWith('.cache')).length,
      contractFiles: files.filter(file => file.endsWith('.cct')).sort(),
      contracts: files.filter(file => file.endsWith('.cct')).length, seed: files.includes('STORM_SEED.exe'),
      neighbours: ns.dnet.probe().filter(name => name !== host) };
    const file = surveyFile(host);
    await ns.write(file, JSON.stringify(report), 'w');
    try { await ns.scp(file, 'home', host); } catch { /* stale reports block storms */ }
  };

  const reportProgress=createDarknetProgressReporter(async busy=>{await heartbeat();await survey(busy);});
  const targetLogOwned=async host=>{const request=mazeRequests.get(host);return !request||await mazeLeaseOwned(ns,request.scope);};
  const readLogs=async (host,options)=>{
    if(!await targetLogOwned(host))return {success:false,code:409,logs:[],message:'Waiting for target grant'};
    await reportProgress();
    try { return await ns.dnet.heartbleed(host,options); }
    finally { await reportProgress(); }
  };
  const readCandidates = () => [...new Set(ns.read(candidateFile).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#")))];
  const candidatesFor = (info, words) => {
    const matches = value => {
      if (!passwordLengthMatches(info,value)) return false;
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
    return [...new Set([...modelCandidates(info).filter(matches), ...passwordHintCandidates(info).filter(matches),
      ...derived.filter(matches), ...(clue && matches(clue) ? [clue] : []), ...words.filter(matches), ...counted])];
  };
  // v3 renamed ns.formatRam -> ns.format.ram; use whichever exists.
  const fmtRam = (v) => {
    try { if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(v); } catch {}
    try { return ns.formatRam(v); } catch {}
    return `${Number(v).toFixed(2)}GB`;
  };
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
    } catch (error) { return {ready:false,reason:'session check unavailable: '+String(error)}; }
  };
  // Result codes are numeric (DarknetResponseCodeType): 401 = wrong password,
  // 408 = request timed out (password may or may not have been right).
  const AUTH_FAILURE = 401;
  const TIMED_OUT = 408;
  const RETRY_AFTER_MS = 10 * 60_000;
  const tryPassword = async (host, password) => {
    try {
      const details = ns.dnet.getServerDetails(host);
      if (!passwordLengthMatches(details, password))
        return {success:false,code:AUTH_FAILURE,message:'Candidate length mismatch'};
    } catch { }
    let result;
    for (let tries = 0; tries < 3; tries++) {
      if(!await attemptGuard()||!takeAttempt())return result||{success:false,code:408,message:"Target turn budget reached"};
      await reportProgress();
      try { result = await ns.dnet.authenticate(host, password); }
      finally { await reportProgress(); }
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

  const authenticate = async (host,info,saved,candidates) => {
    attemptGuard=async()=>true;
    if(info.hasSession){charismaBlocked.delete(host);return authenticateTurn(host,info,saved,candidates);}
    if(info.modelId==='(The Labyrinth)'&&ns.hasRootAccess(host)){mazeRequests.delete(host);charismaBlocked.delete(host);return true;}
    let scope=null;
    try{const c=JSON.parse(ns.read('tasks/dnet-cache-context.json'));if([c.nodeReset,c.augReset].every(Number.isFinite))scope=[c.nodeReset,c.augReset,host,info.modelId,info.passwordLength,info.passwordFormat,info.data];}catch{}
    // Only native wrong-password responses invalidate this puzzle's saved credential.
    if(scope&&!isBlankPassword(info)&&typeof saved==='string'){
      const identity=JSON.stringify(scope),rejected=rejectedCredentials.get(host);
      if(rejected?.identity!==identity||rejected.password!==saved){
        const result=await trySavedPassword(host,saved,info);
        if(result?.success){rejectedCredentials.delete(host);nilProgress.delete(host);if(mazeRequests.delete(host))await survey(false);return true;}
        if(Number(result?.code)!==AUTH_FAILURE)return false;
        rejectedCredentials.set(host,{identity,password:saved});
      }
      candidates=candidates.filter(password=>password!==saved);saved=undefined;
    }
    if(!isBlankPassword(info)&&charismaGate(info,ns.getPlayer().skills.charisma,supportsFeedbackModel(info))){
      const changed=mazeRequests.delete(host);checkpointOwnership.delete(host);
      charismaBlocked.set(host,{host,modelId:info.modelId,required:info.requiredCharismaSkill,at:Date.now()});
      note(host+':charisma',host+': needs '+info.requiredCharismaSkill+' Charisma before feedback solving.');
      if(changed||Date.now()-lastMazeSurvey>=15000){await survey(false);lastMazeSurvey=Date.now();}
      return false;
    }
    charismaBlocked.delete(host);
    if(info.modelId==='(The Labyrinth)'){
      if(!scope)return false;
      const source=ns.getHostname(),processes=ns.ps(source);
      if(processes.some(p=>p.filename===navigatorFile&&p.args?.[0]===host&&p.args?.[1]===JSON.stringify(scope))){mazeRequests.delete(host);return false;}
      const ram=ns.getScriptRam(navigatorFile,source),loot=processes.find(p=>p.filename===lootFile);
      const capacity=ns.getServerMaxRam(source)-ns.getServerUsedRam(source)+(loot?loot.threads*ns.getScriptRam(lootFile,source):0);
      if(!(ram>0)||capacity<ram){mazeRequests.delete(host);note(host+':maze-ram',host+': waiting for a navigator source with enough RAM.');return false;}
      const grant=await readMazeLease(ns,scope);
      let expectedMs=null;
      try{const threads=chooseMazeThreads(Math.min(64,Math.floor(capacity/ram)),n=>ns.formulas.dnet.getAuthenticateTime(info,n,ns.getPlayer()));const quote=ns.formulas.dnet.getAuthenticateTime(info,threads,ns.getPlayer());if(Number.isFinite(quote)&&quote>0)expectedMs=quote;}catch{}
      mazeRequests.delete(host);mazeRequests.set(host,{maze:host,scope,at:Date.now(),progressAt:0,owned:!!grant,expectedMs});
      if(Date.now()-lastMazeSurvey>=15000){await survey(!!grant);lastMazeSurvey=Date.now();}
      if(grant)await scheduleNavigator(ns,host,scope,ns.pid);
      return false;
    }
    const coordinated=scope&&!isBlankPassword(info)&&typeof saved!=='string',shared=coordinated;
    const file='tasks/dnet-solver-'+encodeURIComponent(host)+'.json';
    if(coordinated){
      const identity=JSON.stringify(scope);if(solverScopes.get(host)!==identity){nilProgress.delete(host);attemptedInputs.delete(host);checkpointVersions.delete(host);solverScopes.set(host,identity);}
      attemptGuard=async()=>mazeLeaseIdentity(await readMazeLease(ns,scope))===checkpointOwnership.get(host);
      const lease=await readMazeLease(ns,scope),owned=!!lease;
      mazeRequests.delete(host);mazeRequests.set(host,{maze:host,scope,at:Date.now(),progressAt:nilProgress.get(host)?.checkpointAt||0,owned});
      if(Date.now()-lastMazeSurvey>=15000){await survey(owned);lastMazeSurvey=Date.now();}
      if(!owned){checkpointOwnership.delete(host);return false;}
      const owner=mazeLeaseIdentity(lease);
      if(checkpointOwnership.get(host)!==owner){
        // Re-read only on a new grant. A failed transfer must be retried, never
        // replaced by this scout's older state.
        let restored=null;
        if(ns.fileExists(file,'home')){
          if(!await ns.scp(file,ns.getHostname(),'home'))return false;
          restored=restoreSolverProgress(ns.read(file),scope);
        }
        nilProgress.set(host,restored?.feedback||{});attemptedInputs.set(host,restored?.candidates||{});
        checkpointVersions.set(host,solverProgressFingerprint({feedback:nilProgress.get(host),candidates:attemptedInputs.get(host)}));
        checkpointOwnership.set(host,owner);
      }
    }
    const result=await authenticateTurn(host,info,saved,candidates);
    if(shared&&mazeLeaseIdentity(await readMazeLease(ns,scope))===checkpointOwnership.get(host)){
      if(result){await ns.rm(file);await ns.rm(file,'home');mazeRequests.delete(host);await survey(false);}
      else try{
        if(!nilProgress.has(host))nilProgress.set(host,{});
        const feedback=nilProgress.get(host),candidates=attemptedInputs.get(host)||{};
        const version=solverProgressFingerprint({feedback,candidates});
        if(version!==checkpointVersions.get(host)){
          feedback.checkpointAt=Date.now();const raw=packSolverProgress(scope,{feedback,candidates});
          if(raw){await ns.write(file,raw,'w');if(!await ns.scp(file,'home',ns.getHostname()))throw Error('Checkpoint upload failed');checkpointVersions.set(host,version);const request=mazeRequests.get(host);if(request){request.progressAt=feedback.checkpointAt;request.at=Date.now();}} 
        }
      }catch(error){ns.print('Solver checkpoint deferred: '+String(error));}
    }
    return result;
  };
  const authenticateTurn = async (host, info, saved, candidates) => {
    if (info.hasSession){if(mazeRequests.get(host)?.scope?.[3]!==ramRecoveryModel&&mazeRequests.delete(host))await survey(false);return true;}
    if (!isBlankPassword(info) && supportsFeedbackModel(info)) {
      if (!nilProgress.has(host)) nilProgress.set(host, {});
      const progress = nilProgress.get(host);
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
      const solution=await solveFeedbackPassword({...info,hostname:host,probeBudget:8},password=>tryPassword(host,password),()=>readLogs(host,{peek:true,logsToCapture:20}),progress);
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
            await survey(ns.ps(self).some(p=>[cacheFile,stasisFile,migrateFile,ramRecoveryFile,navigatorFile].includes(p.filename)),request.id);
            await heartbeat();await ns.sleep(1000);continue;
          }
        }
      }catch{ /* No verified hold request: continue normal exploration. */ }
      await survey(false);
      await heartbeat();
      const freeRam = () => ns.getServerMaxRam(self) - ns.getServerUsedRam(self);
      const procRunning = (file) => ns.ps(self).some((p) => p.filename === file);
      const linked = ns.dnet.getStasisLinkedServers();
      let stasisStarted = await serviceDarknetAnchor(ns);
      // Stasis-link selection is manager-owned; this scout only executes the
      // manager's current prepare/apply/release phase.
      // Open any .cache file on this server. The loot helper does this too, so the
      // one-shot is only needed when loot isn't running (e.g. not enough RAM yet).
      let cacheStarted = false;
      if (!stasisStarted && ns.ls(self, ".cache").length > 0 && ns.fileExists(cacheFile, self)
          && !procRunning(cacheFile)) {
        const ram = ns.getScriptRam(cacheFile, self);
        if (ram > 0 && freeRam() >= ram) cacheStarted = ns.exec(cacheFile, self, 1) > 0;
        else if (ram > 0) {
          // A cache is a finite reward; make phishing yield its RAM rather than leaving the
          // cache blocked behind loot until the next survey.
          if (!await yieldDarknetLoot(ns, ram, 'cache')) note(`${self}:cache`, `${self}: cache file waiting; needs ${fmtRam(ram)} free RAM, ${fmtRam(freeRam())} available.`);
        } else note(`${self}:cache`, `${self}: cache file waiting; cache script RAM unavailable.`);
        if (cacheStarted) await clearLootYield(ns, 'cache');
      }
      // A completed labyrinth can leave its cache on a directly connected server. The
      // navigator may already have exited, so let an adjacent scout open it from here.
      if (!stasisStarted && typeof ns.dnet?.probe === 'function') for (const neighbour of ns.dnet.probe()) {
        try {
          const caches = ns.ls(neighbour, '.cache');
          if (!caches.length || ns.ps(neighbour).some(p => p.filename === cacheFile)) continue;
          const deploy = [cacheFile, 'darknet-reward-policy.js', ...(ns.fileExists('tasks/dnet-cache-context.json', self) ? ['tasks/dnet-cache-context.json'] : [])];
          if (!ns.fileExists(cacheFile, neighbour) && !await ns.scp(deploy, neighbour, self)) continue;
          const ram = ns.getScriptRam(cacheFile, neighbour);
          if (ram > 0 && ns.getServerMaxRam(neighbour) - ns.getServerUsedRam(neighbour) >= ram && ns.exec(cacheFile, neighbour, 1) > 0)
            note(`${neighbour}:cache`, `${neighbour}: opened ${caches.length} cache file(s) via adjacent scout ${self}.`);
        } catch { /* Neighbour may be offline or not directly executable. */ }
      }
      // Persistent neighbour cache sweep: edges appear and disappear while this
      // scout runs, so keep a watcher instead of relying only on the one-shot
      // check above.
      if (!stasisStarted && ns.fileExists(watcherFile, self) && !procRunning(watcherFile)) {
        const watcherRam = ns.getScriptRam(watcherFile, self);
        if (watcherRam > 0 && freeRam() >= watcherRam) ns.exec(watcherFile, self, 1);
      }
      // Give one promotion thread space before allocating the remaining RAM to phishing.
      if (!stasisStarted && !cacheStarted && ns.fileExists(promoteFile, self) && !procRunning(promoteFile)) {
        try {
          if (ns.fileExists(stockSignalFile, 'home') && await ns.scp(stockSignalFile, self, 'home') &&
              chooseStockPromotion(JSON.parse(ns.read(stockSignalFile)))) {
            const ram = ns.getScriptRam(promoteFile, self);
            if(await yieldDarknetLoot(ns,ram,'promotion')){if(ns.exec(promoteFile,self,1))await clearLootYield(ns,'promotion');}
          }
        } catch { /* No current stock signal or TIX access: keep phishing. */ }
      }
      // The stasis and cache one-shots need their RAM first; loot is sized on the next pass.
      if (!stasisStarted && !cacheStarted && !readLootYield(ns.read('tasks/dnet-loot-resize.json')) && ns.fileExists(lootFile, self) && !procRunning(lootFile)) {
        const ram = ns.getScriptRam(lootFile, self);
        const threads = ram > 0 ? Math.floor(freeRam() / ram) : 0;
        if (threads >= 1) ns.exec(lootFile, self, threads);
        else note(`${self}:loot`, `${self}: not enough free RAM for the loot helper (${fmtRam(ram)} per thread, ${fmtRam(freeRam())} free).`);
      }
      const known = await credentials.refresh();
      const candidates = [...new Set([...readCandidates(), ...dictionaryWords(ns)])];
      // Only home supplies executable files, including newly added dependencies.
      let homeFiles=null;
      try{if(ns.fileExists(darknetDeploymentFile,'home')&&await ns.scp(darknetDeploymentFile,self,'home'))homeFiles=readDarknetDeployment(ns.read(darknetDeploymentFile));}catch{}
      for (const host of prioritizeDarknetTargets(ns.dnet.probe(),targetTurn++,host=>ns.dnet.getServerDetails(host))) {
        takeAttempt=createAttemptBudget();
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
          if (info.modelId!=='(The Labyrinth)'&&charisma >= required && Date.now() - lastPeek > 10 * 60_000 && await targetLogOwned(host)) {
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
        if(!(info.blockedRam>0)&&mazeRequests.get(host)?.scope?.[3]===ramRecoveryModel)mazeRequests.delete(host);
        if(info.blockedRam>0){
          try{
            const context=JSON.parse(ns.read('tasks/dnet-cache-context.json'));
            if([context.nodeReset,context.augReset].every(Number.isFinite)){
              const scope=[context.nodeReset,context.augReset,host,ramRecoveryModel,info.modelId],lease=await readMazeLease(ns,scope);
              mazeRequests.delete(host);mazeRequests.set(host,{maze:host,scope,at:Date.now(),progressAt:0,owned:!!lease});
              if(Date.now()-lastMazeSurvey>=15000){await survey(!!lease);lastMazeSurvey=Date.now();}
              if(lease)await scheduleRamRecovery(ns,host,{...info,hasSession:true},scope,mazeLeaseIdentity(lease));
            }
          }catch(error){ns.print(host+': RAM worker deferred: '+String(error));}
        }
        const scout = ns.ps(host).find(p => p.filename === nodeFile);
        const statusFile = `tasks/dnet-${encodeURIComponent(host)}.json`;
        try {
          if (scout && ns.fileExists(statusFile, host) && await ns.scp(statusFile, self, host)) {
            const status = JSON.parse(ns.read(statusFile));
            // Revision upgrades belong exclusively to the home manager.
            if (isStalledScout(scout, status)) {
              if(!homeFiles||!await ns.scp(homeFiles,host,'home'))continue;
              ns.kill(scout.pid);
              for (const process of ns.ps(host)) if ([lootFile, stasisFile, cacheFile, promoteFile, migrateFile,ramRecoveryFile].includes(process.filename)) ns.kill(process.pid);
              note(`${host}:restart`, `${host}: restarting stalled scout.`);
            }
          }
        } catch { /* only restart when a matching stale heartbeat is verified */ }
        if (!ns.ps(host).some(p => p.filename === nodeFile)) {
          if(!homeFiles||!await ns.scp(homeFiles,host,'home')){note(host+':sync',host+': waiting for current deployment from home.');continue;}
          const ram = ns.getScriptRam(nodeFile, host);
          const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
          const session = executionState(host);
          if (!session.ready) {
            note(`${host}:scout`, `${host}: scout deferred (${session.reason}); ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
          } else if (ram > 0 && free >= ram) {
            // One thread: the scout on that server starts its own loot helper.
            const pid = ns.exec(nodeFile, host, 1);
            if (!pid) note(`${host}:scout`, `${host}: scout exec rejected (${executionState(host).reason}); ${fmtRam(free)} free, ${fmtRam(ram)} required.`);
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
              const ram = ns.getScriptRam(migrateFile, self);
              const ready=await yieldDarknetLoot(ns,ram,'migration');
              const threads = ready ? Math.min(16, Math.floor(freeRam() / ram)) : 0;
              if (threads && ns.exec(migrateFile, self, threads, target)){lastMigration = Date.now();await clearLootYield(ns,'migration');}
            }
          }
        } catch { /* Network changes: leave scouts and stasis links in place. */ }
      }
      // Ask the worker to finish its action and yield; never kill an in-flight payout.
      const loot = ns.ps(self).find(p => p.filename === lootFile);
      if (!stasisStarted && !cacheStarted && loot && Date.now()-lastLootResize >= 120000) {
        const ram = ns.getScriptRam(lootFile, self);
        const extra = ram > 0 ? Math.floor(freeRam()/ram) : 0;
        if (extra >= Math.max(1, Math.ceil(loot.threads/4))&&!readLootYield(ns.read('tasks/dnet-loot-resize.json'))) {
          await ns.write('tasks/dnet-loot-resize.json', JSON.stringify({pid:loot.pid,at:Date.now(),expiresAt:Date.now()+45000}), 'w');
          lastLootResize = Date.now();
        }
      }
      await survey(ns.ps(self).some(p => [cacheFile, stasisFile, migrateFile,ramRecoveryFile,navigatorFile].includes(p.filename)));
      await ns.sleep(15_000);
    } catch (error) {
      ns.print(`Darknet scout recovered: ${String(error)}`);
      await ns.sleep(15_000);
    }
  }
}
