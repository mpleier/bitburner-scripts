/**
 * pc.js — Bitburner PC controller (v21)
 *
 * Run:  node pc.js
 * Requires: Bitburner Remote API enabled for file sync; agent.js running in-game for actions; Ollama optional.
 * Target: Bitburner v3.0.1+
 *
 * Remote API: connect Bitburner to 127.0.0.1:12525 to sync game scripts.
 * Darknet: type 'dnet-auto' for the full autonomous loop.
 * Architecture: worm does cracking/spreading/harvesting (it's adjacent to
 * targets); the PC observes via unified per-worm reports scp'd to home.
 */

let WebSocket;
try {
  WebSocket = require("ws");
} catch (error) {
  if (error?.code === "MODULE_NOT_FOUND" && /['"]ws['"]/.test(error.message || "")) {
    console.error("Missing PC controller dependency 'ws'. Run Start.bat or run 'npm ci' in the pc-controller folder.");
    process.exit(1);
  }
  throw error;
}
const readline  = require("readline");
const fs        = require("fs");
const path      = require("path");

// Record this controller's PID only after its WebSocket port is bound so
// Stop.bat can safely target this instance without terminating other Node apps.
const pidFile = path.join(__dirname, ".pc-controller.pid");
function removePidFile() {
  try {
    const marker = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    if (marker.pid === process.pid) fs.unlinkSync(pidFile);
  } catch { /* Missing or stale marker. */ }
}
process.on("exit", removePidFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  port:           12525,
  resultFile:     "tasks/__result.json",
  defaultHost:    "home",
  tickMs:         4000,
  cmdTimeoutMs:   300000,
  padding:        200,
  minWorkerCores: 1,
  homeReserveGb:  32,
  maxBatches:     3,

  buyServerAt:    1e9,
  serverRam:      64,
  maxServers:     25,

  pushWorkersOnBoot:    true,
  pushWorkersEveryMs:   60000,
  hackingAutoStartOnBoot: true,
  gameDaemonAutoStartOnBoot: true,
  gameDaemonCheckMs:    30000,

  // Darknet
  dnetAutoIntervalMs:    90000,
  dnetAutoStartOnBoot:   true,
  dnetSessionRefreshMs:  120000,
  dnetCrackThreads:      8,
  dnetReallocThreads:    4,
  dnetMaxPerTick:        5,
  dnetPasswordFile:      "darknet_pw.json",
  dnetRewardsFile:       "dnet_rewards.json",
  dnetSeedWorm:          true,
  dnetSeedHarvester:     true,
  dnetStasisLinks:       true,
  dnetMemRealloc:        true,
  dnetHighValueRam:      64,
  dnetEntryHost:         "darkweb",
  dnetRequireTor:        true,

  // Corporation. Decisions and scheduling run here; game calls are batched
  // through the connected Bitburner agent.
  corpAutoIntervalMs:    30000,
  corpAutoStartOnBoot:   true,
  corpName:              "Apex Holdings",
  corpReserve:           5e9,

  // Ollama
  ollamaHost:       "http://localhost:11434",
  ollamaModel:      "qwen3-coder:30b",
  ollamaKeepAlive:  "1h",
  ollamaTimeoutMs:  300000,
  ollamaTemp:       0.3,
  historyTurns:     6,
  maxObsChars:      2500,
  allowRunAction:   true,
  suppressThinking: false,
  preflightEveryMs: 300000,
};

// ---------------------------------------------------------------------------
// Worker source
// ---------------------------------------------------------------------------
const WORKERS = {
  "hack.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, delayMs] = ns.args;
  if (delayMs) await ns.asleep(delayMs);
  await ns.hack(target);
}
`,
  "grow.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, delayMs] = ns.args;
  if (delayMs) await ns.asleep(delayMs);
  await ns.grow(target);
}
`,
  "weaken.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, delayMs] = ns.args;
  if (delayMs) await ns.asleep(delayMs);
  await ns.weaken(target);
}
`,
  "dnet-auth.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, password] = ns.args;
  try {
    const result = await ns.dnet.authenticate(target, password);
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, password, result }), "w");
  } catch (e) {
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, password, error: e.message }), "w");
  }
}
`,
  "dnet-heartbleed.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, peek] = ns.args;
  try {
    const logs = await ns.dnet.heartbleed(target, { peek: peek === "true" });
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, logs }), "w");
  } catch (e) {
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, error: e.message }), "w");
  }
}
`,
  "dnet-session.js": `/** @param {NS} ns */
export async function main(ns) {
  const [target, password] = ns.args;
  try {
    const session = await ns.dnet.connectToSession(target, password || "");
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, session }), "w");
  } catch (e) {
    ns.write("tasks/__dnet_result.json", JSON.stringify({ target, error: e.message }), "w");
  }
}
`,
  "darknet-realloc.js": `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const [target] = ns.args;
  if (!target) return;
  const HOST = ns.getHostname();
  const PW_FILE = "darknet_pw.json";
  const MAX_PASSES = 400;
  const PASS_DELAY_MS = 150;
  let sessionOk = false;
  try {
    const db = JSON.parse(ns.read(PW_FILE)) || {};
    const pw = db[target];
    if (typeof pw === "string") { await ns.dnet.connectToSession(target, pw); sessionOk = true; }
  } catch (e) {}
  if (!sessionOk) {
    try { const d = ns.dnet.getServerDetails(target); if (d && d.hasSession) sessionOk = true; } catch {}
  }
  if (!sessionOk) { ns.print("no session to " + target); return; }
  try {
    const d = ns.dnet.getServerDetails(target);
    if (d && d.isConnectedToCurrentServer === false) {
      ns.print("not adjacent to " + target + " from " + HOST);
      return;
    }
  } catch {}
  let totalFreed = 0, passes = 0, stalled = 0;
  while (passes < MAX_PASSES) {
    const before = ns.getServerUsedRam(target);
    if (before <= 0) break;
    let ok = false, err = null;
    try { ok = await ns.dnet.memoryReallocation(target); }
    catch (e) { err = e.message || String(e); }
    const after = ns.getServerUsedRam(target);
    const freed = before - after;
    if (freed > 0) { totalFreed += freed; stalled = 0; } else { stalled++; }
    if (stalled >= 3) break;
    if (err) break;
    passes++;
    await ns.sleep(PASS_DELAY_MS);
  }
  const finalUsed = ns.getServerUsedRam(target);
  const maxRam = ns.getServerMaxRam(target);
  ns.print("realloc " + target + " from " + HOST + ": freed " + totalFreed.toFixed(2) + " GB, " + finalUsed.toFixed(2) + "/" + maxRam + " GB used (" + passes + " passes)");
  try {
    ns.write("tasks/realloc_" + target + ".json",
      JSON.stringify({ host: target, freed: totalFreed, remainingUsed: finalUsed, maxRam, cleared: finalUsed <= 0.01, passes, ranFrom: HOST, at: Date.now() }), "w");
    ns.scp("tasks/realloc_" + target + ".json", "home", HOST);
  } catch {}
}
`,
  "darknet-open-cache.js": `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const HOST = ns.getHostname();
  let caches = [];
  try { caches = [...new Set(ns.ls(HOST, ".cache"))]; } catch {}
  const opened = [], failed = [];
  for (const f of caches) {
    try { const r = await ns.dnet.openCache(f); opened.push({ file: f, result: r }); ns.print("opened " + f); }
    catch (e) { failed.push({ file: f, error: e.message }); }
  }
  try {
    ns.write("tasks/caches_" + HOST + ".json",
      JSON.stringify({ host: HOST, opened, failed, at: Date.now() }), "w");
    ns.scp("tasks/caches_" + HOST + ".json", "home", HOST);
  } catch {}
}
`,
  "darknet-harvest.js": `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const HOST = ns.getHostname();
  const PW_FILE = "darknet_pw.json";

  function loadPw() { try { return JSON.parse(ns.read(PW_FILE)) || {}; } catch { return {}; } }
  function savePw(obj) { try { ns.write(PW_FILE, JSON.stringify(obj, null, 2), "w"); } catch {} }

  const totals = {
    host: HOST, money: 0, caches: 0, files: 0, passwords: 0,
    phishingCalls: 0, started: Date.now(),
  };

  const openedCaches = new Set();
  let caches = [];
  try { caches = [...new Set(ns.ls(HOST, ".cache"))]; } catch {}
  for (const f of caches) {
    if (openedCaches.has(f)) continue;
    try {
      const r = await ns.dnet.openCache(f);
      openedCaches.add(f);
      totals.caches++;
      ns.print("cache " + f + ": " + JSON.stringify(r).slice(0, 120));
    } catch (e) { ns.print("openCache " + f + " failed: " + e.message); }
  }

  let dataFiles = [];
  try {
    dataFiles = ns.ls(HOST).filter(f =>
      /\\.(txt|json|lit|dat|log|csv|yml|yaml|ini|conf)$/i.test(f) &&
      !f.endsWith(".cache") &&
      !f.startsWith("tasks/")
    );
  } catch {}

  const looksLikeHost = (s) => /^[a-z0-9][a-z0-9._-]{2,}$/i.test(s) && !/^(http|https|ftp)$/i.test(s);
  const COMMON_PW = new Set(["password","admin","default","123456","changeme","letmein","root","guest"]);
  const looksLikePw = (s) => {
    if (s.length < 4 || s.length > 64) return false;
    if (COMMON_PW.has(s.toLowerCase())) return true;
    if (/^[a-z]+$/i.test(s)) return false;
    return true;
  };

  const db = loadPw();
  const candidates = [];
  for (const f of dataFiles) {
    try {
      const content = ns.read(f);
      if (!content || content.length > 20000) continue;
      totals.files++;

      const patterns = [
        /([a-z][a-z0-9._-]{3,})\\s*[:=]\\s*([^\\s,;"']{4,64})/gi,
        /([a-z][a-z0-9._-]{3,})\\s+(?:password|pass|pw)\\s+([^\\s,;"']{4,64})/gi,
        /(?:host|server|target)\\s*[:=]?\\s*([a-z][a-z0-9._-]{3,})[^\\n]{0,40}?(?:password|pass|pw)\\s*[:=]?\\s*([^\\s,;"']{4,64})/gi,
      ];

      for (const re of patterns) {
        let m;
        while ((m = re.exec(content)) !== null) {
          const host = m[1].toLowerCase();
          const pw = m[2];
          if (!looksLikeHost(host) || !looksLikePw(pw)) continue;
          if (/^(host|server|target|user|login|name)$/.test(host)) continue;
          if (/^(null|undefined|true|false|none)$/i.test(pw)) continue;
          if (!db[host]) candidates.push({ host, pw });
        }
      }
    } catch {}
  }

  let learned = 0;
  for (const { host, pw } of candidates) {
    try {
      const r = await ns.dnet.authenticate(host, pw);
      const success = r === true || (r && r.success === true);
      if (success) {
        db[host] = pw;
        learned++;
        ns.print("verified pw for " + host + ": " + pw);
      }
    } catch {}
  }
  if (learned > 0) { savePw(db); totals.passwords = learned; }

  const START = Date.now();
  const MAX_RUNTIME_MS = 8 * 60 * 1000;
  let consecutiveFails = 0;
  let consecutiveZeroGain = 0;

  while (Date.now() - START < MAX_RUNTIME_MS) {
    const before = ns.getPlayer().money;
    let ok = false;
    try {
      await ns.dnet.phishingAttack();
      ok = true;
    } catch (e) {
      consecutiveFails++;
      if (consecutiveFails > 5) break;
    }

    if (ok) {
      consecutiveFails = 0;
      totals.phishingCalls++;
      const after = ns.getPlayer().money;
      const gained = after - before;
      if (gained > 0) {
        totals.money += gained;
        consecutiveZeroGain = 0;
      } else {
        consecutiveZeroGain++;
        if (consecutiveZeroGain > 20) {
          ns.print("phishing stalled after " + totals.phishingCalls + " calls — breaking");
          break;
        }
      }
    }

    try {
      const fresh = [...new Set(ns.ls(HOST, ".cache"))];
      for (const f of fresh) {
        if (openedCaches.has(f)) continue;
        try { await ns.dnet.openCache(f); openedCaches.add(f); totals.caches++; } catch {}
      }
    } catch {}

    await ns.sleep(1000);
  }

  totals.ended = Date.now();
  try {
    ns.write("tasks/harvest_" + HOST + ".json", JSON.stringify(totals), "w");
    ns.scp("tasks/harvest_" + HOST + ".json", "home", HOST);
  } catch {}
}
`,
  "darknet-worm.js": `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const HOST = ns.getHostname();
  const SCRIPT = "darknet-worm.js";
  const REALLOC = "darknet-realloc.js";
  const HARVEST = "darknet-harvest.js";
  const PW = "darknet_pw.json";
  const STASIS_PLAN = "darknet-stasis-plan.json";
  const MAX_CRACKS_PER_CYCLE = 3;
  const MAX_SPREADS_PER_CYCLE = 3;
  const MAX_CANDIDATES = 220;
  const failedCracks = new Map();

  const SCRIPT_RAM  = ns.getScriptRam(SCRIPT, HOST) || 2;
  const REALLOC_RAM = ns.getScriptRam(REALLOC, HOST) || 2;
  const HARVEST_RAM = ns.getScriptRam(HARVEST, HOST) || 3;

  // Self-dedup
  const myPid = ns.pid;
  const twins = ns.ps(HOST).filter(p => p.filename === SCRIPT && p.pid !== myPid);
  if (twins.length > 0) {
    ns.print("dup worm on " + HOST + " — exiting");
    return;
  }

  const state = {
    host: HOST, started: Date.now(), cycles: 0,
    instanceCracks: 0, totalSpreads: 0, totalCrashes: 0,
    lastNeighbors: [], lastCracks: [], lastSpreads: [], errors: [],
    modelIds: {},
  };

  function loadPw() { try { return JSON.parse(ns.read(PW)) || {}; } catch { return {}; } }
  function savePw(o) { try { ns.write(PW, JSON.stringify(o, null, 2), "w"); } catch {} }
  function remember(h, pw) {
    const db = loadPw();
    if (db[h] === pw) return;
    db[h] = pw;
    savePw(db);
    ns.print("cracked " + h + " <- \\"" + pw + "\\"");
    state.instanceCracks++;
    state.lastCracks.push({ host: h, pw, at: Date.now() });
    if (state.lastCracks.length > 20) state.lastCracks = state.lastCracks.slice(-20);
  }

  // ---- Wordlists ----
  const LISTS = {
    fresh: ["admin", "password", "0000", "12345"],
    dog:   ["fido", "spot", "rover", "max"],
    euro:  ["Austria","Belgium","Bulgaria","Croatia","Republic of Cyprus",
            "Czech Republic","Denmark","Estonia","Finland","France","Germany",
            "Greece","Hungary","Ireland","Italy","Latvia","Lithuania",
            "Luxembourg","Malta","Netherlands","Poland","Portugal","Romania",
            "Slovakia","Slovenia","Spain","Sweden"],
    toppass: ["123456","password","12345678","qwerty","123456789","12345",
              "1234","111111","1234567","dragon","123123","baseball","abc123",
              "football","monkey","letmein","696969","shadow","master",
              "666666","qwertyuiop","123321","mustang","1234567890","michael",
              "654321","superman","1qaz2wsx","7777777","121212","0","qazwsx",
              "123qwe","trustno1","jordan","jennifer","zxcvbnm","asdfgh",
              "hunter","buster","soccer","harley","batman","andrew","tigger",
              "sunshine","iloveyou","2000","charlie","robert","thomas",
              "hockey","ranger","daniel","starwars","112233","george",
              "computer","michelle","jessica","pepper","1111","zxcvbn",
              "555555","11111111","131313","freedom","777777","pass",
              "maggie","159753","aaaaaa","ginger","princess","joshua",
              "cheese","amanda","summer","love","ashley","6969","nicole",
              "chelsea","biteme","matthew","access","yankees","987654321",
              "dallas","austin","thunder","taylor","matrix"],
  };

  const TOP20 = ["123456","password","12345678","qwerty","123456789","12345",
                 "1234","111111","1234567","dragon","123123","baseball",
                 "abc123","football","monkey","letmein","696969","shadow",
                 "master","666666"];

  const litCache = { data: {}, scanned: new Set() };

  function scanLitFiles() {
    let files = [];
    try { files = ns.ls(HOST).filter(f => f.endsWith(".lit")); } catch { return; }
    let newWords = 0;
    for (const f of files) {
      if (litCache.scanned.has(f)) continue;
      try {
        const raw = ns.read(f);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const words = parsed.filter(x => typeof x === "string");
          litCache.data[f] = words;
          litCache.scanned.add(f);
          newWords += words.length;
        }
      } catch {}
    }
    if (newWords > 0) {
      const total = Object.values(litCache.data).reduce((s, a) => s + a.length, 0);
      ns.print("loaded " + newWords + " new words (" + total + " total)");
    }
  }

  function allLitWords() {
    const out = new Set();
    for (const arr of Object.values(litCache.data)) for (const w of arr) out.add(w);
    return [...out];
  }

  function bundledCandidates() {
    try {
      return [...new Set(ns.read("darknet-candidates.txt").split(/\\r?\\n/)
        .map(x => x.trim()).filter(x => x && !x.startsWith("#")))];
    } catch { return []; }
  }

  function categoryCandidates(hint) {
    const h = String(hint || "").toLowerCase();
    const out = new Set();
    if (h.includes("dog") || h.includes("pet") || h.includes("name of")) {
      LISTS.dog.forEach(p => out.add(p));
    }
    if (h.includes("country") || h.includes("euro") || h.includes("nation")) {
      LISTS.euro.forEach(p => out.add(p));
    }
    if (h.includes("fresh") || h.includes("factory") || h.includes("install")) {
      LISTS.fresh.forEach(p => out.add(p));
    }
    if (h.includes("common") || h.includes("popular") || h.includes("top")) {
      LISTS.toppass.forEach(p => out.add(p));
    }
    return [...out];
  }

  function gen(hint) {
    if (!hint) return [];
    const h = String(hint).toLowerCase();
    const out = new Set();

    if (h.includes("no password") || h.includes("didn't set") ||
        h.includes("did not set") || h.includes("blank") ||
        h.includes("nothing") || h.includes("forgot")) {
      out.add("");
    }
    const keyMatch = h.match(/the key is\\s+([^\\s,.;:]+)/);
    if (keyMatch) out.add(keyMatch[1]);
    if (h.includes("default")) {
      ["password","admin","default","123456","changeme",
       "letmein","root","guest","qwerty"].forEach(p => out.add(p));
    }
    const bm = h.match(/it'?s\\s+(\\w+)\\s+in\\s+base\\s+(\\d+)/);
    if (bm) {
      const v = parseInt(bm[1], 10), b = parseInt(bm[2], 10);
      if (!isNaN(v) && !isNaN(b)) out.add(v.toString(b));
    }
    const sm = h.match(/sorted\\s+is\\s+(\\d+)/);
    if (sm) {
      const d = sm[1].split("");
      const p = new Set();
      const perm = (a, c) => {
        c = c || "";
        if (!a.length) { p.add(c); return; }
        for (let i = 0; i < a.length; i++) perm(a.slice(0,i).concat(a.slice(i+1)), c + a[i]);
      };
      perm(d); p.forEach(x => out.add(x));
    }
    if (h.includes("divisible")) {
      const nm = h.match(/divisible\\s+by\\s+your\\s+input.*?(\\d+)/);
      if (nm) { const n = parseInt(nm[1], 10);
        for (let i = 2; i <= 100; i++) if (n % i === 0) out.add(String(i)); }
    }
    const rm = h.match(/\\b([IVXLCDM]{2,})\\b/);
    if (rm) {
      const m = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
      let t = 0, pv = 0;
      for (let i = rm[1].length - 1; i >= 0; i--) {
        const c = m[rm[1][i]] || 0; t += c < pv ? -c : c; pv = c;
      }
      out.add(String(t));
    }
    const ym = h.match(/\\b(19|20)\\d{2}\\b/);
    if (ym) out.add(ym[0]);
    const numMatch = h.match(/\\b(\\d{2,10})\\b/);
    if (numMatch) out.add(numMatch[1]);

    if (h.includes("backwards") || h.includes("reverse")) {
      const words = h.match(/[a-z]{3,}/g) || [];
      for (const w of words) out.add(w.split("").reverse().join(""));
    }

    if (h.includes("rot13") || h.includes("caesar")) {
      const words = h.match(/[a-z]{3,}/g) || [];
      const rot13 = (s) => s.replace(/[a-z]/gi, (c) => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + 13) % 26) + 65);
        if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + 13) % 26) + 97);
        return c;
      });
      for (const w of words) out.add(rot13(w));
    }

    const em = h.match(/[-\\d+*/().\\s]{3,}/);
    if (em && /[+\\-*/]/.test(em[0])) {
      try {
        const v = Function('"use strict"; return (' + em[0] + ');')();
        if (Number.isFinite(v)) out.add(String(Math.round(v)));
      } catch {}
    }
    return [...out];
  }

  // Extract literal passwords from heartbleed log lines. The game logs the
  // leaked value after "Authentication successful: " — capture to end of line
  // so multi-word passwords survive.
  function extractPasswordsFromLogs(logs) {
    const out = new Set();
    const patterns = [
      /authentication successful[:\\s]+(.+?)$/i,
      /password[\\s:=]+(.+?)$/i,
      /logged in with[:\\s]+(.+?)$/i,
      /accepted[:\\s]+(.+?)$/i,
      /credentials[:\\s]+(.+?)$/i,
    ];
    for (const line of logs) {
      const s = String(line).trim();
      for (const re of patterns) {
        const m = s.match(re);
        if (m && m[1]) {
          const cand = m[1].trim().replace(/[.;,]+$/, "");
          if (cand.length >= 1 && cand.length <= 64) out.add(cand);
        }
      }
    }
    return [...out];
  }

  // Filter candidate list by the server's declared passwordFormat / passwordLength.
  // For a "numeric, 4" server we skip every non-4-digit candidate outright.
  function formatFilter(candidates, fmt, len) {
    if (!fmt && !len) return candidates;
    const f = (fmt || "ASCII").toLowerCase();
    return candidates.filter((pw) => {
      if (len && pw.length !== len) return false;
      if (f === "numeric")   return /^[0-9]+$/.test(pw);
      if (f === "alphabetic")return /^[a-z]+$/i.test(pw);
      if (f === "alphanumeric") return /^[a-z0-9]+$/i.test(pw);
      return pw.length > 0 && pw.length <= 64;
    });
  }

  // Simplest correct form: authenticate grants session to this pid.
  async function tryAuth(h, pw) {
    try {
      const r = await ns.dnet.authenticate(h, pw);
      return r === true || (r && r.success === true);
    } catch { return false; }
  }

  async function crack(h) {
    const db = loadPw();
    let details = null;
    try { details = ns.dnet.getServerDetails(h); } catch {}

    const hint = details ? details.passwordHint : null;
    const fmt  = details ? details.passwordFormat : null;
    const len  = details ? details.passwordLength : null;
    const reqCha = details && typeof details.requiredCharismaSkill === "number"
      ? details.requiredCharismaSkill : 0;
    const modelId = details ? details.modelId : null;
    const known = db[h];
    const fileCandidates = bundledCandidates();
    const signature = JSON.stringify([hint, details && details.data, fmt, len, known, fileCandidates]);
    const previous = failedCracks.get(h);
    if (previous && previous.signature === signature && Date.now() - previous.at < 5 * 60 * 1000) return undefined;
    if (Object.prototype.hasOwnProperty.call(db, h) && await tryAuth(h, known)) {
      failedCracks.delete(h);
      return known;
    }

    scanLitFiles();

    if (modelId) state.modelIds[h] = modelId;

    const ordered = [];
    const seen = new Set();
    const push = (pw) => {
      if (seen.has(pw)) return;
      if (ordered.length >= MAX_CANDIDATES * 3) return;
      seen.add(pw);
      ordered.push(pw);
    };

    push("");
    for (const c of fileCandidates) push(c);

    if (hint) {
      for (const c of gen(hint)) push(c);
    }
    if (details && typeof details.data === "string") {
      push(details.data.trim());
      for (const c of gen(details.data)) push(c);
    }

    // Heartbleed is gated by charisma; crack is not
    if (ns.getPlayer().charisma >= reqCha) {
      for (let pass = 0; pass < 2; pass++) {
        let logs = [];
        try {
          const r = await ns.dnet.heartbleed(h, { peek: true });
          logs = (r && Array.isArray(r.logs)) ? r.logs : [];
        } catch { break; }
        if (!logs.length) break;
        const before = ordered.length;
        for (const l of logs) for (const c of gen(l)) push(c);
        for (const c of extractPasswordsFromLogs(logs)) push(c);
        if (ordered.length === before) break;
      }
    }

    for (const c of categoryCandidates(hint)) push(c);
    for (const c of TOP20) push(c);
    for (const c of allLitWords()) push(c);

    const filtered = formatFilter(ordered, fmt, len).slice(0, MAX_CANDIDATES);

    ns.print("crack " + h + ": " + ordered.length + " raw, " + filtered.length + " after filter" +
      (fmt ? " [" + fmt + (len ? "/" + len : "") + "]" : ""));

    for (const pw of filtered) {
      if (await tryAuth(h, pw)) { failedCracks.delete(h); return pw; }
    }
    failedCracks.set(h, { signature, at: Date.now() });
    return null;
  }

  function report(neighbors) {
    state.lastNeighbors = neighbors;
    state.cycles++;
    state.updatedAt = Date.now();
    if (state.errors.length > 30) state.errors = state.errors.slice(-30);

    // Rate-limited modelId refresh: only for hosts we don't know yet
    for (const n of neighbors) {
      if (state.modelIds[n]) continue;
      try {
        const d = ns.dnet.getServerDetails(n);
        if (d && d.modelId) state.modelIds[n] = d.modelId;
      } catch {}
    }

    try {
      const f = "tasks/report_" + HOST + ".json";
      ns.write(f, JSON.stringify({
        host: HOST,
        neighbors,
        passwords: loadPw(),
        cycles: state.cycles,
        instanceCracks: state.instanceCracks,
        totalSpreads: state.totalSpreads,
        totalCrashes: state.totalCrashes,
        lastCracks: state.lastCracks,
        lastSpreads: state.lastSpreads,
        modelIds: state.modelIds,
        errors: state.errors,
        at: Date.now(),
      }), "w");
      ns.scp(f, "home", HOST);
    } catch (e) { ns.print("report failed: " + e.message); }
  }

  while (true) {
    try {
      scanLitFiles();

      let neighbors = [];
      try { neighbors = [...new Set(ns.dnet.probe() || [])].filter(h => h !== HOST); } catch {}

      // PC owns link selection; each worm applies the decision locally because
      // setStasisLink() only affects the server running this script.
      try {
        const plan = JSON.parse(ns.read(STASIS_PLAN) || "{}");
        const shouldLink = Array.isArray(plan.hosts) && plan.hosts.includes(HOST);
        const linked = (plan.linked || []).includes(HOST);
        if (shouldLink !== linked) {
          const result = await ns.dnet.setStasisLink(shouldLink);
          if (result) ns.print("stasis link " + (shouldLink ? "enabled" : "released") + " for " + HOST);
        }
      } catch {}

      const freeHere = ns.getServerMaxRam(HOST) - ns.getServerUsedRam(HOST);
      const pwDb = loadPw();
      let cracks = 0, spreads = 0;

      for (const target of neighbors) {
        if (spreads >= MAX_SPREADS_PER_CYCLE) break;
        if (cracks >= MAX_CRACKS_PER_CYCLE) break;

        const pw = await crack(target);
        if (pw === undefined) continue; // Still cooling down; don't consume this cycle's crack budget.
        cracks++;
        if (pw === null) { ns.print("crack failed on " + target); continue; }
        remember(target, pw);

        const targetFree = ns.getServerMaxRam(target) - ns.getServerUsedRam(target);

        if (targetFree >= SCRIPT_RAM + HARVEST_RAM && !ns.isRunning(SCRIPT, target)) {
          try {
            for (const f of [SCRIPT, REALLOC, HARVEST, PW, "darknet-candidates.txt", STASIS_PLAN]) {
              try { ns.scp(f, target); } catch {}
            }
            const pid = ns.exec(SCRIPT, target, { threads: 1, preventDuplicates: true });
            if (pid > 0) {
              ns.print("  -> worm " + target + " (" + pid + ")");
              spreads++;
              state.totalSpreads++;
              state.lastSpreads.push({ host: target, pid, at: Date.now() });
              if (state.lastSpreads.length > 20) state.lastSpreads = state.lastSpreads.slice(-20);
            } else {
              state.errors.push("exec 0 on " + target + " (free=" + targetFree.toFixed(1) + ")");
            }
          } catch (e) { state.errors.push("spread " + target + ": " + e.message); }
        }

        if (targetFree >= HARVEST_RAM && !ns.isRunning(HARVEST, target)) {
          try {
            ns.scp(HARVEST, target);
            ns.scp(PW, target);
            ns.exec(HARVEST, target, { threads: 1, preventDuplicates: true });
          } catch {}
        }

        if (freeHere >= REALLOC_RAM * 2) {
          try {
            ns.scp(REALLOC, HOST);
            ns.exec(REALLOC, HOST, 2, target);
          } catch {}
        }
      }

      report(neighbors);
      await ns.sleep(15000);
    } catch (e) {
      state.totalCrashes++;
      state.errors.push("CRASH: " + (e && e.message));
      try {
        ns.write("tasks/crash_" + HOST + ".json", JSON.stringify({
          host: HOST, error: e && e.message, stack: e && e.stack, at: Date.now(),
        }), "w");
        ns.scp("tasks/crash_" + HOST + ".json", "home", HOST);
      } catch {}
      await ns.sleep(60000);
    }
  }
}
`,
};

const WORKER_NAMES = Object.keys(WORKERS);
const DNET_CANDIDATES_FILE = "darknet-candidates.txt";
let DNET_CANDIDATE_TEXT = "";
function refreshDnetCandidates() {
  for (const candidatePath of [
    path.join(__dirname, DNET_CANDIDATES_FILE),
    path.join(__dirname, "..", DNET_CANDIDATES_FILE),
  ]) {
    try { DNET_CANDIDATE_TEXT = fs.readFileSync(candidatePath, "utf8"); break; }
    catch { DNET_CANDIDATE_TEXT = ""; }
  }
  return DNET_CANDIDATE_TEXT;
}
refreshDnetCandidates();

const AGENT_FILE = "agent.js";
let AGENT_SOURCE = "";
for (const agentPath of [path.join(__dirname, AGENT_FILE), path.join(__dirname, "..", AGENT_FILE)]) {
  try { AGENT_SOURCE = fs.readFileSync(agentPath, "utf8"); break; }
  catch { /* Try the repository root when running from pc-controller/. */ }
}
if (!AGENT_SOURCE) console.warn(`⚠️ ${AGENT_FILE} missing beside pc.js and in the repository root.`);

// ---------------------------------------------------------------------------
// WebSocket connections: Bitburner Remote API for file sync and agent.js for NS actions
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({ port: CONFIG.port, host: "127.0.0.1" });
wss.on("listening", () => {
  try {
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startedAt: Date.now(), directory: __dirname }));
  } catch (error) {
    console.warn(`⚠️ Could not write controller PID file: ${error.message}`);
  }
});
let agent = null;
let nextId = 1;
const pending = new Map();
let remoteApi = null;
let nextRemoteId = 1;
const pendingRemote = new Map();

function requestRemoteApi(method, params = {}, ws = remoteApi, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("Bitburner Remote API is not connected"));
    const id = nextRemoteId++;
    const timer = setTimeout(() => {
      if (pendingRemote.has(id)) {
        pendingRemote.delete(id);
        reject(new Error(`Remote API timeout for ${method}`));
      }
    }, timeoutMs);
    pendingRemote.set(id, { ws, resolve, reject, timer });
    try { ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }
    catch (error) {
      clearTimeout(timer);
      pendingRemote.delete(id);
      reject(error);
    }
  });
}

function listGameScripts(directory, root, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["pc-controller", "node_modules", "vendor", "docs", "sources", "scripts", "tests"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) listGameScripts(absolute, root, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      output.push({ filename: path.relative(root, absolute).split(path.sep).join("/"), content: fs.readFileSync(absolute, "utf8") });
    }
  }
  return output;
}

async function syncFilesThroughRemoteApi(ws = remoteApi) {
  const root = path.resolve(__dirname, "..");
  const files = listGameScripts(root, root);
  const candidatePath = path.join(root, "darknet-candidates.txt");
  if (fs.existsSync(candidatePath)) files.push({ filename: "darknet-candidates.txt", content: fs.readFileSync(candidatePath, "utf8") });
  let synced = 0;
  for (const file of files) {
    await requestRemoteApi("pushFile", { ...file, server: "home" }, ws);
    synced++;
  }
  console.log(`📡 Remote API synced ${synced} game file(s) to home; run 'run agent.js' once in Bitburner to enable PC actions.`);
  return synced;
}

wss.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${CONFIG.port} is already in use. Stop bridge.js/autopilot.js and restart pc.js.`);
    process.exit(1);
  }
  console.error("❌ WebSocket server error:", error.message);
});

process.on("unhandledRejection", (r) =>
  console.error("⚠️ unhandled rejection:", (r && r.message) || r)
);

wss.on("connection", (ws) => {
  let identified = false;
  let remoteIdentified = false;

  // Remote API has no agent hello packet. Probe with its read-only server list
  // request; a normal PC agent ignores it and identifies itself below.
  const probeId = nextRemoteId++;
  const probeTimer = setTimeout(() => {
    const pendingProbe = pendingRemote.get(probeId);
    if (pendingProbe) {
      pendingRemote.delete(probeId);
      clearTimeout(pendingProbe.timer);
    }
  }, 5000);
  pendingRemote.set(probeId, { ws, resolve: (servers) => {
    remoteIdentified = true;
    remoteApi = ws;
    console.log(`📡 Bitburner Remote API connected (${Array.isArray(servers) ? servers.length : 0} servers visible)`);
    void syncFilesThroughRemoteApi(ws).catch((error) => console.error("Remote API sync failed:", error.message));
  }, reject: () => {}, timer: probeTimer });
  try { ws.send(JSON.stringify({ jsonrpc: "2.0", id: probeId, method: "getAllServers" })); }
  catch { clearTimeout(probeTimer); pendingRemote.delete(probeId); }

  ws.on("message", (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "hello") {
      const probe = pendingRemote.get(probeId);
      if (probe) { clearTimeout(probe.timer); pendingRemote.delete(probeId); }
      if (msg.role !== "pc-agent") {
        console.log(`⚠️ rejected legacy WebSocket client from ${msg.host || "unknown"}; run agent.js`);
        try { ws.close(1008, "Run the pc.js agent.js client"); } catch {}
        return;
      }
      identified = true;
      agent = ws;
      console.log("🎮 agent connected");
      console.log(`   hello from ${msg.host} (pid ${msg.pid ?? "?"})`);
      return;
    }
    if (msg.jsonrpc === "2.0" && msg.id !== undefined && pendingRemote.has(msg.id)) {
      const request = pendingRemote.get(msg.id);
      if (request.ws !== ws) return;
      pendingRemote.delete(msg.id);
      clearTimeout(request.timer);
      if (msg.error) request.reject(new Error(String(msg.error)));
      else request.resolve(msg.result);
      if (!remoteIdentified && msg.id === probeId) remoteIdentified = true;
      return;
    }
    if (!identified || agent !== ws) return;
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
    }
  });

  ws.on("close", () => {
    for (const [id, request] of pendingRemote) {
      if (request.ws === ws) { pendingRemote.delete(id); clearTimeout(request.timer); request.reject(new Error("Bitburner Remote API disconnected")); }
    }
    if (remoteApi === ws) {
      remoteApi = null;
      console.log("📡 Bitburner Remote API disconnected");
    }
    if (agent === ws) {
      console.log("🎮 agent disconnected");
      agent = null;
      for (const [id, { reject, timer }] of pending) {
        pending.delete(id); clearTimeout(timer);
        reject(new Error("agent disconnected"));
      }
    }
  });

  ws.on("error", () => {});
});

function sendRaw(payload, timeoutMs = CONFIG.cmdTimeoutMs) {
  return new Promise((resolve, reject) => {
    if (!agent || agent.readyState !== WebSocket.OPEN)
      return reject(new Error("agent not connected"));
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    agent.send(JSON.stringify({ id, ...payload }));
  });
}

// ---------------------------------------------------------------------------
// Generated-script runner
// ---------------------------------------------------------------------------
function makeScript(body) {
  return `/** @param {NS} ns */
export async function main(ns) {
  let result = null, error = null;
  try {
    result = await (async () => {
${body}
    })();
  } catch (e) {
    error = (e && e.message) || String(e);
  }
  await ns.write(${JSON.stringify(CONFIG.resultFile)}, JSON.stringify({ result, error }), "w");
}
`;
}

async function run(body, opts = {}) {
  const reply = await sendRaw({
    source:  makeScript(body),
    host:    opts.host    ?? CONFIG.defaultHost,
    threads: opts.threads ?? 1,
    args:    opts.args    ?? [],
  });
  if (reply === undefined)
    throw new Error("agent returned no result");
  return reply;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPlayer()       { return run(`return ns.getPlayer();`); }
async function getHackingLevel() { return run(`return ns.getHackingLevel();`); }
async function getMoney()        { return (await getPlayer()).money; }
async function getPurchasedServers() { return run(`return ns.cloud.getServerNames();`); }

async function getServers() {
  return run(`
    const seen = new Set(["home"]);
    const q = ["home"];
    while (q.length) {
      const h = q.shift();
      for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    const out = [];
    for (const h of seen) {
      if (h === "home" || h === "darkweb") continue;
      out.push(ns.getServer(h));
    }
    return out;
  `);
}

async function scanAll() {
  return run(`
    const seen = new Set(["home"]);
    const q = ["home"];
    while (q.length) {
      const h = q.shift();
      for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return [...seen];
  `);
}

async function getHostRams(hosts) {
  return run(`
    const list = ${JSON.stringify(hosts)};
    const out = {};
    for (const h of list) {
      try { out[h] = { max: ns.getServerMaxRam(h), used: ns.getServerUsedRam(h) }; } catch {}
    }
    return out;
  `);
}

async function getActiveHackTargets(hosts) {
  return run(`
    const hosts = ${JSON.stringify(hosts)};
    const active = new Set();
    for (const host of hosts) {
      let processes = [];
      try { processes = ns.ps(host); } catch { continue; }
      for (const process of processes) {
        const name = String(process.filename || "").replace(/\\\\/g, "/").toLowerCase();
        if (!/(?:^|\\/)(?:hack|grow|weak|weaken)(?:-target)?\\.js$/.test(name)) continue;
        const target = process.args?.[0];
        if (typeof target === "string" && target) active.add(target);
      }
    }
    return [...active];
  `);
}

async function getHostCores(hosts) {
  return run(`
    const list = ${JSON.stringify(hosts)};
    const out = {};
    for (const h of list) {
      try { out[h] = ns.getServer(h).cpuCores || 1; } catch { out[h] = 1; }
    }
    return out;
  `);
}

async function getScriptRams(scripts) {
  return run(`
    const list = ${JSON.stringify(scripts)};
    const out = {};
    for (const s of list) out[s] = ns.getScriptRam(s, "home");
    return out;
  `);
}

let cachedScriptRams = null;
async function scriptRams() {
  if (!cachedScriptRams) cachedScriptRams = await getScriptRams(WORKER_NAMES);
  return cachedScriptRams;
}
function invalidateScriptRams() { cachedScriptRams = null; }

const cooldown = new Map();
function isCoolingDown(target) {
  const t = cooldown.get(target);
  return !!t && t > Date.now();
}
function coolDown(target, ms = 5000) {
  cooldown.set(target, Date.now() + ms);
}

async function exec(script, host, threads, args = []) {
  return run(
    `return ns.exec(${JSON.stringify(script)}, ${JSON.stringify(host)}, ${threads}, ...${JSON.stringify(args)});`,
    { threads: 1 }
  );
}

async function scpFile(file, host) {
  return run(`return ns.scp(${JSON.stringify(file)}, ${JSON.stringify(host)}, "home");`);
}

// ---------------------------------------------------------------------------
// Worker distribution
// ---------------------------------------------------------------------------
async function pushWorkers(hosts = null) {
  refreshDnetCandidates();
  const writeBlock = WORKER_NAMES.map((name) =>
    `await ns.write(${JSON.stringify(name)}, ${JSON.stringify(WORKERS[name])}, "w");`
  ).join("\n    ");

  const written = await run(`
    ${writeBlock}
    await ns.write(${JSON.stringify(DNET_CANDIDATES_FILE)}, ${JSON.stringify(DNET_CANDIDATE_TEXT)}, "w");
    ${AGENT_SOURCE ? `await ns.write(${JSON.stringify(AGENT_FILE)}, ${JSON.stringify(AGENT_SOURCE)}, "w");` : ""}
    return ${JSON.stringify(WORKER_NAMES)};
  `);

  if (!hosts) {
    const pserv = await getPurchasedServers();
    const servers = await getServers();
    const rooted = servers.filter((s) => s.hasAdminRights).map((s) => s.hostname);
    hosts = [...new Set(["home", ...pserv, ...rooted])];
  }

  const copied = await run(`
    const hosts = ${JSON.stringify(hosts)}.filter(h => h !== "home");
    const files = ${JSON.stringify([...WORKER_NAMES, DNET_CANDIDATES_FILE])};
    let ok = 0, failed = [];
    for (const h of hosts) {
      for (const f of files) {
        let success = false;
        try { success = ns.scp(f, h, "home"); } catch {}
        if (success) ok++;
        else failed.push(h + ":" + f);
      }
    }
    return { ok, failed };
  `);

  invalidateScriptRams();

  console.log(`📦 pushed ${written.length} workers → ` +
    `${copied.ok} copies across ${hosts.length} host(s)`);
  if (copied.failed.length) {
    console.log(`   ⚠️ failures: ${copied.failed.slice(0, 5).join(", ")}` +
      (copied.failed.length > 5 ? ` … +${copied.failed.length - 5}` : ""));
  }
  return copied;
}

// ---------------------------------------------------------------------------
// Batch planning
// ---------------------------------------------------------------------------
async function planBatch(target) {
  const info = await run(`
    const h = ${JSON.stringify(target)};
    const s = ns.getServer(h);
    const cores = ns.getServer("home").cpuCores || 1;
    const hackPct = ns.hackAnalyze(h);
    if (!(hackPct > 0) || s.moneyMax <= 0) return { ok: false };
    if (s.requiredHackingLevel > ns.getHackingLevel()) return { ok: false };

    const stealPct = 0.5;
    const hackThreads = Math.max(1, Math.min(300, Math.floor(stealPct / hackPct)));
    const moneyAfter  = s.moneyAvailable * (1 - hackPct * hackThreads);
    const growMult    = s.moneyMax / Math.max(1, moneyAfter);
    const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(h, growMult, cores)));
    const weakenPer   = ns.weakenAnalyze(1, cores);
    const hackSec     = ns.hackAnalyzeSecurity(hackThreads, h);
    const growSec     = ns.growthAnalyzeSecurity(growThreads, h, cores);
    const secOver     = Math.max(0, s.hackDifficulty - s.minDifficulty);

    const w1 = Math.max(1, Math.ceil(hackSec / weakenPer));
    const w2 = Math.max(1, Math.ceil(growSec / weakenPer));
    const extraWeaken = Math.ceil(secOver / weakenPer);

    return {
      ok: true,
      hackTime:   ns.getHackTime(h),
      growTime:   ns.getGrowTime(h),
      weakenTime: ns.getWeakenTime(h),
      hackThreads, growThreads, w1, w2, extraWeaken,
    };
  `);

  if (!info.ok) return null;

  const w = info.weakenTime;
  const h = info.hackTime;
  const g = info.growTime;
  const p = CONFIG.padding;

  const actions = [
    { script: "hack.js",   threads: info.hackThreads,           delay: Math.max(0, w - h),      arg: target },
    { script: "weaken.js", threads: info.w1 + info.extraWeaken, delay: p,                       arg: target },
    { script: "grow.js",   threads: info.growThreads,           delay: Math.max(0, w - g + 2*p), arg: target },
    { script: "weaken.js", threads: info.w2,                    delay: 3 * p,                    arg: target },
  ];

  const totalThreads = actions.reduce((a, b) => a + b.threads, 0);
  return { target, actions, totalThreads, durationMs: w + 4 * p };
}

// ---------------------------------------------------------------------------
// Prep planning
// ---------------------------------------------------------------------------
async function planPrep(s) {
  const target = s.hostname;

  const info = await run(`
    const h = ${JSON.stringify(target)};
    const sv = ns.getServer(h);
    const cores = ns.getServer("home").cpuCores || 1;
    const weakenPer = ns.weakenAnalyze(1, cores);
    const secGap = Math.max(0, sv.hackDifficulty - sv.minDifficulty);
    const moneyRatio = sv.moneyAvailable / Math.max(1, sv.moneyMax);

    let kind, actions = [];

    if (secGap > 1) {
      kind = "weaken";
      const t = Math.max(1, Math.ceil(secGap / weakenPer));
      actions.push({ script: "weaken.js", threads: t, delay: 0, arg: h });
    } else if (moneyRatio < 0.9) {
      kind = "grow";
      const growMult = sv.moneyMax / Math.max(1, sv.moneyAvailable);
      const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(h, growMult, cores)));
      const growSec = ns.growthAnalyzeSecurity(growThreads, h, cores);
      const wThreads = Math.max(1, Math.ceil(growSec / weakenPer));
      const delay = Math.max(0, ns.getWeakenTime(h) - ns.getGrowTime(h));
      actions.push({ script: "grow.js",   threads: growThreads, delay: 0, arg: h });
      actions.push({ script: "weaken.js", threads: wThreads,    delay,     arg: h });
    } else {
      return { ok: false, reason: "already prepped" };
    }

    return { ok: true, kind, actions, weakenTime: ns.getWeakenTime(h) };
  `);

  if (!info.ok) return null;

  const totalThreads = info.actions.reduce((a, b) => a + b.threads, 0);
  return {
    target,
    actions: info.actions,
    totalThreads,
    durationMs: info.weakenTime + 300,
    kind: "prep",
  };
}

// ---------------------------------------------------------------------------
// In-flight batches
// ---------------------------------------------------------------------------
const inflight = [];

function pruneInflight() {
  const now = Date.now();
  while (inflight.length && inflight[0].endsAt <= now) inflight.shift();
}

function inflightUsage(scriptRam) {
  const used = {};
  for (const b of inflight) {
    for (const p of b.placements) {
      used[p.host] = (used[p.host] ?? 0) + p.threads * (scriptRam[p.script] ?? 0);
    }
  }
  return used;
}

// ---------------------------------------------------------------------------
// RAM distribution
// ---------------------------------------------------------------------------
function distribute(actions, hostRams, scriptRam, hostCores = {}) {
  const placements = [];
  const usedThisBatch = {};
  for (const h of Object.keys(hostRams)) usedThisBatch[h] = 0;

  const inflightUsed = inflightUsage(scriptRam);

  const hosts = Object.keys(hostRams)
    .filter((h) => (hostCores[h] ?? 1) >= CONFIG.minWorkerCores)
    .sort((a, b) => {
      const fa = hostRams[a].max - hostRams[a].used;
      const fb = hostRams[b].max - hostRams[b].used;
      return fb - fa;
    });

  if (!hosts.length) return null;

  for (const action of actions) {
    let remaining = action.threads;
    const perThread = scriptRam[action.script];
    if (!perThread || perThread <= 0) return null;

    for (const host of hosts) {
      if (remaining <= 0) break;
      const info = hostRams[host];

      const reserve = host === "home"
        ? Math.min(CONFIG.homeReserveGb, Math.floor(info.max * 0.25))
        : 0;

      const free = info.max
        - info.used
        - usedThisBatch[host]
        - (inflightUsed[host] ?? 0)
        - reserve;
      const canFit = Math.floor(Math.max(0, free) / perThread);
      const take = Math.min(canFit, remaining);
      if (take > 0) {
        placements.push({ ...action, host, threads: take });
        usedThisBatch[host] += take * perThread;
        remaining -= take;
      }
    }
    if (remaining > 0) return null;
  }
  return placements;
}

// ---------------------------------------------------------------------------
// Server + home management
// ---------------------------------------------------------------------------
async function manageServers() {
  const player = await getPlayer();
  const pserv = await getPurchasedServers();

  if (pserv.length < CONFIG.maxServers && player.money > CONFIG.buyServerAt) {
    const name = `pserv-${Date.now().toString(36)}`;
    try {
      const r = await run(
        `return ns.cloud.purchaseServer(${JSON.stringify(name)}, ${CONFIG.serverRam});`
      );
      if (r) {
        console.log(`🛒 bought ${r} (${CONFIG.serverRam} GB)`);
        await pushWorkers([r]);
      }
    } catch (e) {
      console.log("buy failed:", e.message);
    }
  }

  // Home RAM upgrades are part of the Singularity API in current Bitburner.
  // Skip cleanly when Source-File 4 (or the API) is unavailable.
  let cost = 0;
  try {
    cost = await run(`return typeof ns.singularity?.getUpgradeHomeRamCost === "function" ? ns.singularity.getUpgradeHomeRamCost() : 0;`);
  } catch (e) { console.log("home RAM cost query failed:", e.message); }

  if (cost > 0 && player.money > cost * 5) {
    try {
      const ok = await run(`return typeof ns.singularity?.upgradeHomeRam === "function" && ns.singularity.upgradeHomeRam();`);
      if (ok) console.log(`⬆️ home RAM upgraded (next cost $${cost.toExponential(2)})`);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------
function scoreTarget(s, hacking) {
  if (!s.hasAdminRights) return -1;
  if (s.requiredHackingLevel > hacking) return -1;
  if (s.moneyMax <= 0) return -1;

  const chance = s.hackChance ?? 1;
  const perHack = s.moneyMax * 0.5 * chance;
  const income = perHack / ((s.hackTime ?? 1000) / 1000);

  const secGap     = Math.max(0, (s.hackDifficulty ?? 0) - (s.minDifficulty ?? 0));
  const moneyRatio = Math.min(1, (s.moneyAvailable ?? 0) / Math.max(1, s.moneyMax));
  const prepPenalty = (1 / (1 + secGap)) * (0.1 + 0.9 * moneyRatio);

  return income * prepPenalty;
}

// ---------------------------------------------------------------------------
// Scheduler tick
// ---------------------------------------------------------------------------
async function autopilotTick() {
  pruneInflight();

  const servers = await getServers();
  const level = await getHackingLevel();
  const rootable = servers.filter(s => !s.hasAdminRights && s.requiredHackingLevel <= level);
  if (rootable.length) {
    try {
      const rooted = await run(`
        const hosts = ${JSON.stringify(rootable.map(s => s.hostname))};
        const opened = [];
        for (const host of hosts) {
          try {
            const server = ns.getServer(host);
            if (server.hasAdminRights || server.requiredHackingLevel > ns.getHackingLevel()) continue;
            if (ns.fileExists("BruteSSH.exe", "home")) try { ns.brutessh(host); } catch {}
            if (ns.fileExists("FTPCrack.exe", "home")) try { ns.ftpcrack(host); } catch {}
            if (ns.fileExists("relaySMTP.exe", "home")) try { ns.relaysmtp(host); } catch {}
            if (ns.fileExists("HTTPWorm.exe", "home")) try { ns.httpworm(host); } catch {}
            if (ns.fileExists("SQLInject.exe", "home")) try { ns.sqlinject(host); } catch {}
            if (server.openPortCount >= server.numOpenPortsRequired && ns.nuke(host)) opened.push(host);
          } catch {}
        }
        return opened;
      `);
      if (rooted?.length) console.log(`🔓 rooted ${rooted.length} server(s): ${rooted.slice(0, 5).join(", ")}`);
    } catch (error) { console.log("root scan failed:", error.message); }
  }

  const player = await getPlayer();
  const hacking = player.skills?.hacking ?? player.hacking;

  const ranked = servers
    .map((s) => ({ s, score: scoreTarget(s, hacking) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return { launched: false, reason: "no hackable targets" };

  const pserv = await getPurchasedServers();
  const rooted = servers.filter((s) => s.hasAdminRights).map((s) => s.hostname);
  const hosts = [...new Set(["home", ...pserv, ...rooted])];
  const hostRams = await getHostRams(hosts);
  const hostCores = await getHostCores(hosts);
  const sRam = await scriptRams();

  const activeTargets = await getActiveHackTargets(hosts);
  const busyTargets = new Set([...inflight.map((b) => b.target), ...activeTargets]);

  for (const cand of ranked.slice(0, 10)) {
    const s = cand.s;
    const target = s.hostname;
    if (busyTargets.has(target)) continue;
    if (isCoolingDown(target)) continue;
    if (inflight.length >= CONFIG.maxBatches) break;

    const secGap     = (s.hackDifficulty ?? 0) - (s.minDifficulty ?? 0);
    const moneyRatio = (s.moneyAvailable ?? 0) / Math.max(1, s.moneyMax ?? 1);
    if (secGap > 1 || moneyRatio < 0.9) continue;

    const batch = await planBatch(target);
    if (!batch) continue;

    const placements = distribute(batch.actions, hostRams, sRam, hostCores);
    if (!placements) {
      console.log(`   skip ${target}: batch needs ${batch.totalThreads} threads`);
      continue;
    }

    console.log(`⚡ batch on ${target}  threads: ` +
      batch.actions.map((a) => `${a.script[0].toUpperCase()}${a.threads}`).join("/"));

    const launched = [];
    for (const pl of placements) {
      try {
        const pid = await exec(pl.script, pl.host, pl.threads, [pl.arg, pl.delay]);
        if (pid > 0) {
          launched.push(pl);
          console.log(`   ${pl.script} x${pl.threads} @ ${pl.host} (pid ${pid})`);
        } else {
          console.log(`   ⚠️ exec 0: ${pl.script} x${pl.threads} @ ${pl.host}`);
        }
      } catch (e) {
        console.log(`   exec ${pl.host} failed: ${e.message}`);
      }
    }

    if (launched.length > 0) {
      inflight.push({
        target, kind: "batch",
        endsAt: Date.now() + batch.durationMs + 500,
        placements: launched,
      });
      inflight.sort((a, b) => a.endsAt - b.endsAt);
      return {
        launched: true, kind: "batch", target,
        threads: batch.totalThreads,
        durationMs: batch.durationMs,
        hosts: launched.length,
      };
    }
    coolDown(target);
  }

  for (const cand of ranked.slice(0, 8)) {
    const s = cand.s;
    const target = s.hostname;
    if (busyTargets.has(target)) continue;
    if (isCoolingDown(target)) continue;
    if (inflight.length >= CONFIG.maxBatches) break;

    const prep = await planPrep(s);
    if (!prep) continue;

    const placements = distribute(prep.actions, hostRams, sRam, hostCores);
    if (!placements) {
      console.log(`   skip prep ${target}: needs ${prep.totalThreads} threads`);
      continue;
    }

    console.log(`🔧 prep on ${target}  threads: ` +
      prep.actions.map((a) => `${a.script[0].toUpperCase()}${a.threads}`).join("/"));

    const launched = [];
    for (const pl of placements) {
      try {
        const pid = await exec(pl.script, pl.host, pl.threads, [pl.arg, pl.delay]);
        if (pid > 0) {
          launched.push(pl);
          console.log(`   ${pl.script} x${pl.threads} @ ${pl.host} (pid ${pid})`);
        }
      } catch (e) {
        console.log(`   exec ${pl.host} failed: ${e.message}`);
      }
    }

    if (launched.length > 0) {
      inflight.push({
        target, kind: "prep",
        endsAt: Date.now() + prep.durationMs + 500,
        placements: launched,
      });
      inflight.sort((a, b) => a.endsAt - b.endsAt);
      return {
        launched: true, kind: "prep", target,
        threads: prep.totalThreads,
        durationMs: prep.durationMs,
        hosts: launched.length,
      };
    }
    coolDown(target);
  }

  return { launched: false, reason: "no target hackable or preppable" };
}

// ===========================================================================
// DARKNET AUTOMATION
// ===========================================================================
const PASSWORDS_FILE = path.join(__dirname, CONFIG.dnetPasswordFile);
const REWARDS_FILE   = path.join(__dirname, CONFIG.dnetRewardsFile);

function loadPasswords() {
  try {
    const raw = JSON.parse(fs.readFileSync(PASSWORDS_FILE, "utf8"));
    const flat = {};
    for (const [host, val] of Object.entries(raw)) {
      flat[host] = typeof val === "string" ? val : val.password;
    }
    return flat;
  } catch { return {}; }
}
function savePasswords(flat) {
  try { fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(flat, null, 2)); } catch {}
}
function rememberPassword(host, password) {
  const db = loadPasswords();
  if (db[host] === password) return;
  db[host] = password;
  savePasswords(db);
  syncPasswordFileToGame().catch(() => {});
}
function getPassword(host) {
  const db = loadPasswords();
  if (!Object.prototype.hasOwnProperty.call(db, host)) return null;
  return db[host];
}
function prunePasswords(activeHosts) {
  const db = loadPasswords();
  const active = new Set(activeHosts);
  let removed = 0;
  for (const host of Object.keys(db)) {
    if (!active.has(host)) { delete db[host]; removed++; }
  }
  if (removed > 0) { savePasswords(db); console.log(`   pruned ${removed} stale passwords`); }
  return removed;
}

function loadRewards() {
  try { return JSON.parse(fs.readFileSync(REWARDS_FILE, "utf8")); }
  catch {
    return { money: 0, caches: 0, filesRead: 0, passwords: 0, phishingCalls: 0, firstAt: Date.now(), lastAt: Date.now(), perHost: {} };
  }
}
function saveRewards(r) {
  try { fs.writeFileSync(REWARDS_FILE, JSON.stringify(r, null, 2)); } catch {}
}

async function syncPasswordFileToGame() {
  const db = loadPasswords();
  const content = JSON.stringify(db, null, 2);
  await run(
    `ns.write(${JSON.stringify(CONFIG.dnetPasswordFile)}, ${JSON.stringify(content)}, "w"); return true;`
  );
}

async function syncDnetCandidatesToGame() {
  const content = refreshDnetCandidates();
  await run(
    `ns.write(${JSON.stringify(DNET_CANDIDATES_FILE)}, ${JSON.stringify(content)}, "w"); return true;`
  );
}

async function pullPasswordsFromGame() {
  try {
    const pcDb = loadPasswords();
    let added = 0;

    try {
      const raw = await run(`
        try { return ns.read(${JSON.stringify(CONFIG.dnetPasswordFile)}); }
        catch { return "{}"; }
      `);
      const db = JSON.parse(raw || "{}");
      for (const [host, pw] of Object.entries(db)) {
        if (typeof pw !== "string") continue;
        if (pcDb[host] !== pw) { pcDb[host] = pw; added++; }
      }
    } catch {}

    try {
      const merged = await run(`
        const files = ns.ls("home").filter(f => f.startsWith("tasks/report_") && f.endsWith(".json"));
        const out = {};
        for (const f of files) {
          try {
            const d = JSON.parse(ns.read(f));
            if (d && d.passwords) {
              for (const [h, pw] of Object.entries(d.passwords)) {
                if (typeof pw === "string") out[h] = pw;
              }
            }
          } catch {}
        }
        return out;
      `);
      for (const [host, pw] of Object.entries(merged || {})) {
        if (pcDb[host] !== pw) { pcDb[host] = pw; added++; }
      }
    } catch {}

    if (added > 0) savePasswords(pcDb);
    return added;
  } catch { return 0; }
}

let cachedDnetScout = null;
let lastDnetScout = 0;

async function scoutDarknet(force = false) {
  if (!force && cachedDnetScout && Date.now() - lastDnetScout < CONFIG.dnetAutoIntervalMs / 2) {
    return cachedDnetScout;
  }
  lastDnetScout = Date.now();

  const result = await run(`
    const ENTRY = ${JSON.stringify(CONFIG.dnetEntryHost)};
    const out = [];
    const seen = new Set();
    const queue = [];

    function record(host, source) {
      let isDnet = false, depth = -1;
      try { isDnet = ns.dnet.isDarknet(host); } catch {}
      try { depth = ns.dnet.getDepth(host); } catch {}
      const treatAsDnet = isDnet || source === "probe" || source === "worm";
      const entry = {
        host, isDarknet: treatAsDnet, depth,
        hasAdmin: ns.hasRootAccess(host),
        maxRam: ns.getServerMaxRam(host),
        discoveredVia: source,
      };
      if (treatAsDnet) {
        try {
          const info = ns.dnet.getServerDetails(host);
          entry.authRequired = info.requiresPassword ?? true;
          entry.passwordHint = info.passwordHint ?? null;
        } catch (e) {
          entry.authRequired = true;
          entry.passwordHint = null;
          entry.detailError = e.message;
        }
      }
      out.push(entry);
    }

    function enqueue(host, source) {
      if (seen.has(host)) return;
      seen.add(host);
      record(host, source);
      queue.push(host);
    }

    enqueue("home", "root");
    if (ENTRY && ENTRY !== "home") enqueue(ENTRY, "entry");

    while (queue.length) {
      const host = queue.shift();
      let neighbors = [];
      try { neighbors = ns.scan(host) || []; } catch {}
      for (const n of neighbors) enqueue(n, "scan");
    }

    try {
      for (const n of ns.dnet.probe() || []) enqueue(n, "probe");
    } catch {}

    const reportFiles = ns.ls("home").filter(f => f.startsWith("tasks/report_") && f.endsWith(".json"));
    for (const f of reportFiles) {
      try {
        const d = JSON.parse(ns.read(f));
        if (!d || !d.host) continue;
        if (!seen.has(d.host)) { seen.add(d.host); record(d.host, "worm"); }
        for (const n of (d.neighbors || [])) {
          if (seen.has(n)) continue;
          seen.add(n);
          record(n, "worm");
        }
      } catch {}
    }

    return out;
  `);
  cachedDnetScout = result;
  return result;
}

async function preflightDarknet() {
  const report = {
    tor: false, dscape: false, dnetApi: false,
    entry: CONFIG.dnetEntryHost, entryProbe: [],
    entrySession: false, directExec: false,
  };

  try {
    report.tor = await run(`try { return ns.hasTorRouter(); } catch { return false; }`);
  } catch {}

  if (CONFIG.dnetRequireTor && !report.tor) {
    console.log("⚠️  TOR router not owned — run in terminal: buy tor");
    return report;
  }

  try {
    report.dscape = await run(
      `try { return ns.fileExists("DarkscapeNavigator.exe", "home"); } catch { return false; }`
    );
  } catch {}

  if (!report.dscape) {
    console.log("⚠️  DarkscapeNavigator.exe not found on home — run in terminal: buy darkscape");
  }

  try {
    const t = await run(`return typeof ns.dnet;`);
    report.dnetApi = t === "object";
  } catch {}

  if (!report.dnetApi) {
    console.log("⚠️  ns.dnet API unavailable");
    return report;
  }

  try {
    const probes = await run(`
      try { return [...new Set(ns.dnet.probe() || [])]; }
      catch (e) { return { error: e.message }; }
    `);
    report.entryProbe = Array.isArray(probes) ? probes : [];
  } catch {}

  if (report.entryProbe.includes(CONFIG.dnetEntryHost)) {
    try {
      const admin = await run(
        `const [h] = ns.args;
         try {
           const s = ns.getServer(h);
           return { admin: s.hasAdminRights, ram: s.maxRam };
         } catch { return { admin: false, ram: 0 }; }`,
        { args: [CONFIG.dnetEntryHost], host: "home", threads: 1 }
      );

      if (admin && admin.admin && admin.ram > 0) {
        report.directExec = true;

        for (const f of ["darknet-worm.js", "darknet-realloc.js", "darknet-harvest.js", CONFIG.dnetPasswordFile, DNET_CANDIDATES_FILE, "darknet-stasis-plan.json"]) {
          try { await scpFile(f, CONFIG.dnetEntryHost); } catch {}
        }

        const running = await run(
          `const [s, h] = ns.args;
           try { return ns.isRunning(s, h); } catch { return false; }`,
          { args: ["darknet-worm.js", CONFIG.dnetEntryHost], host: "home", threads: 1 }
        );

        if (!running) {
          const pid = await run(
            `const [s, h] = ns.args;
             try { return ns.exec(s, h, { threads: 1, preventDuplicates: true }); }
             catch { return 0; }`,
            { args: ["darknet-worm.js", CONFIG.dnetEntryHost], host: "home", threads: 1 }
          ).catch(() => 0);
          if (pid > 0) console.log(`🐛 seeded worm on ${CONFIG.dnetEntryHost} via direct exec (pid ${pid})`);
        } else {
          console.log(`🐛 worm already running on ${CONFIG.dnetEntryHost}`);
        }
        report.entrySession = true;
      } else {
        console.log(`ℹ️  ${CONFIG.dnetEntryHost} not rooted or has no RAM — cannot direct-exec`);
      }
    } catch (e) {
      console.log(`direct exec to ${CONFIG.dnetEntryHost} failed: ${e.message}`);
    }
  }

  const probeSummary = report.entryProbe.length
    ? `probe=[${report.entryProbe.slice(0, 3).join(", ")}${report.entryProbe.length > 3 ? ",…" : ""}]`
    : "probe=[]";

  console.log(
    `🛰  preflight: tor=${report.tor} dscape=${report.dscape} ` +
    `api=${report.dnetApi} session=${report.entrySession} direct=${report.directExec} ${probeSummary}`
  );

  if (report.tor && report.dscape && report.dnetApi && report.entryProbe.length === 0) {
    console.log("ℹ️  Home is not adjacent to the darknet — run in terminal: connect darkweb");
  }

  return report;
}

async function tryAuthenticate(host, password, threads = CONFIG.dnetCrackThreads) {
  const reply = await run(
    `const [t, pw] = ns.args;
     try {
       const r = await ns.dnet.authenticate(t, pw);
       return r === true || (r && r.success === true);
     } catch (e) { return { error: e.message }; }`,
    { args: [host, password], host: "home", threads }
  );
  if (reply === true) return true;
  if (reply && typeof reply === "object") return false;
  return false;
}

// PC-side cracking: home is only adjacent to darkweb. authenticate() requires
// adjacency, so no other host can be cracked from here.
async function crackDarknetServer(entry) {
  const host = entry.host;
  if (host !== CONFIG.dnetEntryHost) return false;

  const stored = getPassword(host);
  if (stored !== null) {
    try {
      if (await tryAuthenticate(host, stored)) {
        console.log(`   ✅ ${host} (cached)`);
        return true;
      }
    } catch {}
  }

  try {
    if (await tryAuthenticate(host, "")) {
      console.log(`   ✅ ${host} ← ""`);
      rememberPassword(host, "");
      return true;
    }
  } catch {}

  return false;
}

async function establishSession(host) {
  try {
    const session = await run(
      `const [t] = ns.args;
       try { return await ns.dnet.connectToSession(t); }
       catch (e) { return { error: e.message }; }`,
      { args: [host], host: "home", threads: 1 }
    );
    if (session === true) return true;
    if (session && typeof session === "object") {
      if (session.error) return false;
      if (session.success === true) return true;
      if (session.connected === true) return true;
      if (session.session || session.id) return true;
    }
    return false;
  } catch { return false; }
}

async function seedWorm(host) {
  try {
    for (const f of ["darknet-worm.js", "darknet-realloc.js", "darknet-harvest.js", CONFIG.dnetPasswordFile, DNET_CANDIDATES_FILE, "darknet-stasis-plan.json"]) {
      try { await scpFile(f, host); } catch {}
    }
    const running = await run(
      `const [s, h] = ns.args;
       try { return ns.isRunning(s, h); } catch { return false; }`,
      { args: ["darknet-worm.js", host], host: "home", threads: 1 }
    );
    if (running) return true;
    const pid = await run(
      `const [s, h] = ns.args;
       try { return ns.exec(s, h, { threads: 1, preventDuplicates: true }); }
       catch { return 0; }`,
      { args: ["darknet-worm.js", host], host: "home", threads: 1 }
    ).catch(() => 0);
    if (pid > 0) console.log(`   🐛 seeded worm on ${host} (pid ${pid})`);
    return pid > 0;
  } catch { return false; }
}

async function seedHarvester(host) {
  try {
    await scpFile("darknet-harvest.js", host);

    const running = await run(
      `const [s, h] = ns.args;
       try { return ns.isRunning(s, h); } catch { return false; }`,
      { args: ["darknet-harvest.js", host], host: "home", threads: 1 }
    );
    if (running) return false;

    const info = await run(
      `const [h, s] = ns.args;
       try {
         const need = ns.getScriptRam(s, "home");
         const srv = ns.getServer(h);
         return { need, free: srv.maxRam - srv.ramUsed };
       } catch { return { need: 0, free: 0 }; }`,
      { args: [host, "darknet-harvest.js"], host: "home", threads: 1 }
    );

    if (!info || info.free < info.need) return false;

    const pid = await run(
      `const [s, h] = ns.args;
       try { return ns.exec(s, h, { threads: 1, preventDuplicates: true }); }
       catch { return 0; }`,
      { args: ["darknet-harvest.js", host], host: "home", threads: 1 }
    ).catch(() => 0);
    if (pid > 0) {
      console.log(`   💰 harvester seeded on ${host} (pid ${pid}, ${info.need.toFixed(1)} GB)`);
      return true;
    }
  } catch {}
  return false;
}

async function canExecOn(host) {
  if (host === CONFIG.dnetEntryHost) return true;
  try {
    const linked = await run(`
      try {
        if (typeof ns.dnet.getStasisLinkedServers === "function") return ns.dnet.getStasisLinkedServers();
        if (typeof ns.dnet.getStasisLinks === "function") return ns.dnet.getStasisLinks();
        return [];
      } catch { return []; }
    `);
    return Array.isArray(linked) && linked.includes(host);
  } catch { return false; }
}

async function manageStasisLinks(authedHosts) {
  if (!CONFIG.dnetStasisLinks) return 0;
  try {
    const limit = await run(`try { return ns.dnet.getStasisLinkLimit(); } catch { return 0; }`);
    if (!limit || limit <= 0) return 0;

    const current = await run(`
      try {
        if (typeof ns.dnet.getStasisLinkedServers === "function") return ns.dnet.getStasisLinkedServers();
        if (typeof ns.dnet.getStasisLinks === "function") return ns.dnet.getStasisLinks();
        return [];
      } catch { return []; }
    `);

    const linked = [...new Set(Array.isArray(current) ? current : [])];
    const eligible = authedHosts
      .filter((h) => (h.maxRam ?? 0) >= CONFIG.dnetHighValueRam)
      .sort((a, b) => (b.maxRam ?? 0) - (a.maxRam ?? 0));
    const selected = eligible.slice(0, limit).map((h) => h.host);
    const plan = { hosts: selected, linked, limit, updatedAt: Date.now() };
    await run(`ns.write("darknet-stasis-plan.json", ${JSON.stringify(JSON.stringify(plan))}, "w");`);

    let distributed = 0;
    for (const entry of authedHosts) {
      try {
        const ok = await scpFile("darknet-stasis-plan.json", entry.host);
        if (ok) distributed++;
      } catch {}
    }
    const created = selected.filter((h) => !linked.includes(h)).length;
    if (created) console.log(`   🔗 PC selected ${created} stasis link(s): ${selected.join(", ")}`);
    return created;
  } catch { return 0; }
}

async function sweepCacheOpeners(authedHosts) {
  let opened = 0;
  const seen = new Set();
  for (const entry of authedHosts) {
    const host = entry.host;
    if (seen.has(host)) continue;
    seen.add(host);

    if (!(await canExecOn(host))) continue;

    const cacheStamp = `tasks/caches_${host}.json`;
    const already = await run(
      `const [f] = ns.args;
       try { return ns.fileExists(f, "home"); } catch { return false; }`,
      { args: [cacheStamp], host: "home", threads: 1 }
    );
    if (already) continue;

    try { await scpFile("darknet-open-cache.js", host); } catch { continue; }
    const pid = await exec("darknet-open-cache.js", host, 1);
    if (pid > 0) {
      console.log(`   📂 cache opener launched on ${host} (pid ${pid})`);
      opened++;
    }
  }
  return opened;
}

let lastSessionRefresh = 0;
async function refreshSessions(authedHosts) {
  if (Date.now() - lastSessionRefresh < CONFIG.dnetSessionRefreshMs) return 0;
  lastSessionRefresh = Date.now();

  let refreshed = 0;
  for (const entry of authedHosts) {
    const pw = getPassword(entry.host);
    if (pw === null) continue;
    try {
      const ok = await run(
        `const [h, pw] = ns.args;
         try {
           const r = await ns.dnet.connectToSession(h, pw);
           return r === true || (r && (r.success === true || r.connected === true || r.session || r.id));
         } catch { return false; }`,
        { args: [entry.host, pw], host: "home", threads: 1 }
      );
      if (ok) refreshed++;
    } catch {}
  }
  if (refreshed > 0) console.log(`   ♻️ refreshed ${refreshed} sessions`);
  return refreshed;
}

async function pullHarvestStats() {
  try {
    const summary = await run(`
      const files = ns.ls("home", "tasks/harvest_").filter(f => f.endsWith(".json"));
      let money = 0, caches = 0, filesRead = 0, passwords = 0, phishingCalls = 0;
      const now = Date.now();
      const MAX_AGE = 30 * 60 * 1000;
      const stale = [];
      const perHost = {};

      for (const f of files) {
        try {
          const raw = ns.read(f);
          const d = JSON.parse(raw);
          money        += d.money || 0;
          caches       += d.caches || 0;
          filesRead    += d.files || 0;
          passwords    += d.passwords || 0;
          phishingCalls += d.phishingCalls || 0;
          if (d.host) perHost[d.host] = {
            money: d.money || 0, caches: d.caches || 0,
            files: d.files || 0, passwords: d.passwords || 0,
            phishingCalls: d.phishingCalls || 0,
          };
          if (d.ended && now - d.ended > MAX_AGE) stale.push(f);
        } catch { stale.push(f); }
      }

      for (const f of stale) { try { ns.rm(f, "home"); } catch {} }

      return { money, caches, filesRead, passwords, phishingCalls, perHost, live: files.length - stale.length, stale: stale.length };
    `).catch(() => null);

    if (!summary) return;

    const r = loadRewards();
    r.money = Math.max(r.money, summary.money);
    r.caches = Math.max(r.caches, summary.caches);
    r.filesRead = Math.max(r.filesRead, summary.filesRead);
    r.passwords = Math.max(r.passwords, summary.passwords);
    r.phishingCalls = Math.max(r.phishingCalls, summary.phishingCalls);
    r.perHost = summary.perHost;
    r.lastAt = Date.now();
    saveRewards(r);

    return { summary, aggregated: r };
  } catch { return null; }
}

const dnetStats = {
  started: null,
  cycles: 0,
  discovered: 0,
  authed: 0,
  cracked: 0,
  failedCracks: 0,
  seeded: 0,
  stasisLinks: 0,
  memReallocs: 0,
  cachesOpened: 0,
  sessionsRefreshed: 0,
  passwords: 0,
  lastCycleMs: 0,
  instability: null,
  harvesters: 0,
  totalMoney: 0,
  totalCaches: 0,
  totalFilesRead: 0,
  totalPasswordsFromFiles: 0,
  phishingCalls: 0,
};

function printDnetStats() {
  const elapsed = dnetStats.started ? Math.round((Date.now() - dnetStats.started) / 1000) : 0;
  const rate = dnetStats.cycles > 0 ? Math.round(elapsed / dnetStats.cycles) : 0;
  const money = dnetStats.totalMoney >= 1e9
    ? `$${(dnetStats.totalMoney / 1e9).toFixed(2)}b`
    : dnetStats.totalMoney >= 1e6
      ? `$${(dnetStats.totalMoney / 1e6).toFixed(2)}m`
      : dnetStats.totalMoney >= 1e3
        ? `$${(dnetStats.totalMoney / 1e3).toFixed(1)}k`
        : `$${Math.round(dnetStats.totalMoney)}`;

  console.log(
    `📊 [cycle ${dnetStats.cycles}] ` +
    `dnet=${dnetStats.discovered} authed=${dnetStats.authed} ` +
    `cracked=${dnetStats.cracked} seeded=${dnetStats.seeded} ` +
    `realloc=${dnetStats.memReallocs} ` +
    `💰=${money} (${dnetStats.phishingCalls} phish, ${dnetStats.totalCaches} caches, ${dnetStats.totalPasswordsFromFiles} pw-files) ` +
    `harvesters=${dnetStats.harvesters} ` +
    `instability=${dnetStats.instability ?? "?"} (${rate}s/cycle)`
  );
}

let dnetAutoRunning = false;

// ---------------------------------------------------------------------------
// Corporation automation (PC-coordinated)
// ---------------------------------------------------------------------------
let corpAutoRunning = false;
let corpCycles = 0;
let corpLastUpgradeAt = 0;
let corpLastSummaryAt = 0;
let corpLastSnapshot = null;
const CORP_OWNER_FILE = "tasks/__pc_corp_owner.json";

async function setCorporationLease(active) {
  if (!agent) return false;
  const source = active
    ? `await ns.write(${JSON.stringify(CORP_OWNER_FILE)}, JSON.stringify({ owner: "pc-controller", expiresAt: ${Date.now() + 90_000} }), "w"); return true;`
    : `return ns.rm(${JSON.stringify(CORP_OWNER_FILE)}, "home");`;
  return run(source, { host: "home", threads: 1 });
}

async function getCorporationSnapshot() {
  return run(`
    const reset = ns.getResetInfo();
    const owned = reset?.ownedSF;
    const sf3 = Number(typeof owned?.get === "function" ? owned.get(3) : owned?.[3]) || 0;
    const access = reset?.currentNode === 3 || sf3 > 0;
    if (!access) return { available: false, reason: "Corporation API requires BitNode 3 or Source-File 3 access.", currentNode: reset?.currentNode ?? null, sourceFile3: sf3 };

    const c = ns.corporation;
    const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
    const hasCorp = safe(() => c.hasCorporation(), false);
    const result = {
      available: true, hasCorporation: !!hasCorp,
      eligible: hasCorp ? null : safe(() => c.canCreateCorporation(true), null),
      currentNode: reset?.currentNode ?? null, sourceFile3: sf3,
      corporation: hasCorp ? safe(() => c.getCorporation(), null) : null,
      unlocks: {}, unlockCosts: {}, industryCosts: {}, divisions: {}, officeCosts: {}, warehouseCosts: {},
      offer: hasCorp ? safe(() => c.getInvestmentOffer(), null) : null,
      upgradeCosts: {}, upgradeLevels: {},
    };
    if (!hasCorp) return result;
    const corp = result.corporation;
    const names = ["Warehouse API", "Office API", "Smart Supply"];
    for (const name of names) {
      result.unlocks[name] = safe(() => c.hasUnlock(name), false);
      result.unlockCosts[name] = safe(() => c.getUnlockCost(name), null);
    }
    for (const industry of ["Agriculture", "Restaurant"])
      result.industryCosts[industry] = safe(() => c.getIndustryData(industry).startingCost, null);
    for (const upgrade of ["Smart Factories", "Smart Storage", "Wilson Analytics"]) {
      result.upgradeCosts[upgrade] = safe(() => c.getUpgradeLevelCost(upgrade), null);
      result.upgradeLevels[upgrade] = safe(() => c.getUpgradeLevel(upgrade), 0);
    }
    for (const divisionName of corp?.divisions || []) {
      const d = safe(() => c.getDivision(divisionName), null);
      if (!d) continue;
      const info = { name: divisionName, industry: d.industry, cities: d.cities || [], products: d.products || [], offices: {}, warehouses: {}, productInfo: {} };
      for (const city of info.cities) {
        if (result.unlocks["Office API"]) {
          info.offices[city] = safe(() => c.getOffice(divisionName, city), null);
          const office = info.offices[city];
          const target = corp.funds > 1e13 ? 30 : corp.funds > 1e12 ? 15 : corp.funds > 2e11 ? 9 : 3;
          if (office && office.size < target)
            result.officeCosts[divisionName + "/" + city + "/" + (target - office.size)] = safe(() => c.getOfficeSizeUpgradeCost(divisionName, city, target - office.size), null);
        }
        if (result.unlocks["Warehouse API"]) {
          const has = safe(() => c.hasWarehouse(divisionName, city), false);
          info.warehouses[city] = has ? safe(() => c.getWarehouse(divisionName, city), null) : null;
          if (has) result.warehouseCosts[divisionName + "/" + city] = safe(() => c.getUpgradeWarehouseCost(divisionName, city), null);
        }
      }
      if (divisionName === "Dining" && info.cities.length && result.unlocks["Warehouse API"]) {
        for (const product of info.products)
          info.productInfo[product] = safe(() => c.getProduct(divisionName, info.cities[0], product), null);
      }
      result.divisions[divisionName] = info;
    }
    return result;
  `, { host: "home", threads: 1 });
}

function buildCorporationPlan(s) {
  const actions = [];
  const reserve = CONFIG.corpReserve;
  const corpFunds = Number(s?.corporation?.funds || 0);
  const divisions = s?.divisions || {};
  const has = (name) => !!divisions[name];
  const unlock = (name) => !!s?.unlocks?.[name];
  const add = (type, args = [], minCash = null) => actions.push({ type, args, minCash });
  const allCities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];

  if (!s?.available) return { actions, reason: s?.reason || "Corporation API unavailable" };
  if (!s.hasCorporation) {
    if (s.eligible === "Success") add("createCorporation", [CONFIG.corpName, true]);
    return { actions, reason: s.eligible === "Success" ? "creating corporation" : `waiting for corporation eligibility (${String(s.eligible)})` };
  }

  const offer = s.offer;
  if (offer?.funds > 0 && offer.round <= 3 && offer.funds > Math.max(1e9, corpFunds * 0.1)) add("acceptInvestmentOffer");

  if (!has("Agri")) {
    const cost = Number(s.industryCosts?.Agriculture);
    if (Number.isFinite(cost) && corpFunds > cost + reserve * 2) add("expandIndustry", ["Agriculture", "Agri"], cost + reserve * 2);
  }
  for (const name of ["Warehouse API", "Office API", "Smart Supply"]) {
    const cost = Number(s.unlockCosts?.[name]);
    if (!unlock(name) && Number.isFinite(cost) && corpFunds > cost + reserve) add("purchaseUnlock", [name], cost + reserve);
  }

  const cityCount = corpFunds > 5e12 ? 6 : corpFunds > 1e12 ? 3 : 1;
  const manageDivision = (name, productDivision) => {
    const d = divisions[name];
    if (!d) return;
    for (const city of allCities.slice(0, cityCount)) {
      if (!d.cities.includes(city) && corpFunds > reserve + 5e9) add("expandCity", [name, city], reserve + 5e9);
      if (unlock("Office API")) {
        const office = d.offices?.[city];
        if (office) {
          const target = corpFunds > 1e13 ? 30 : corpFunds > 1e12 ? 15 : corpFunds > 2e11 ? 9 : 3;
          if (office.size < target) {
            const cost = s.officeCosts?.[`${name}/${city}/${target - office.size}`];
            if (Number.isFinite(cost) && corpFunds > cost + reserve) add("upgradeOfficeSize", [name, city, target - office.size], cost + reserve);
          }
          if ((office.numEmployees || 0) < (office.size || 0)) add("hireToSize", [name, city]);
          const employees = office.numEmployees || 0;
          if (employees > 0) {
            const ratios = productDivision ? [0.25, 0.25, 0.10, 0.10, 0.30] : [0.20, 0.20, 0.10, 0.10, 0.40];
            const jobs = ["Operations", "Engineer", "Business", "Management", "Research & Development"];
            const counts = ratios.map(r => Math.floor(employees * r));
            let remainder = employees - counts.reduce((a, b) => a + b, 0);
            for (let i = 0; remainder > 0; i = (i + 1) % counts.length, remainder--) counts[i]++;
            add("assignOffice", [name, city, jobs, counts]);
          }
          add("buyTea", [name, city]);
        }
      }
      if (!unlock("Warehouse API")) continue;
      if (!d.cities.includes(city)) continue; // City expansion happens next cycle.
      const warehouse = d.warehouses?.[city];
      if (!warehouse && corpFunds > reserve + 5e9) add("purchaseWarehouse", [name, city], reserve + 5e9);
      else if (warehouse && warehouse.sizeUsed / Math.max(1, warehouse.size) > 0.8) {
        const cost = s.warehouseCosts?.[`${name}/${city}`];
        if (Number.isFinite(cost) && corpFunds > cost + reserve) add("upgradeWarehouse", [name, city], cost + reserve);
      }
      if (unlock("Smart Supply")) add("setSmartSupply", [name, city, true]);
      if (productDivision) {
        for (const product of d.products || []) add("sellProduct", [name, city, product, "MAX", "MP", true]);
      } else {
        for (const material of ["Plants", "Food"]) add("sellMaterial", [name, city, material, "MAX", "MP"]);
        if (unlock("Smart Supply")) for (const material of ["Water", "Chemicals"]) add("buyMaterial", [name, city, material, 0]);
      }
    }
  };

  manageDivision("Agri", false);
  if (has("Agri") && !has("Dining") && corpFunds > 1e12) {
    const cost = Number(s.industryCosts?.Restaurant);
    if (Number.isFinite(cost) && corpFunds > cost + reserve) add("expandIndustry", ["Restaurant", "Dining"], cost + reserve);
  }
  manageDivision("Dining", true);
  const dining = divisions.Dining;
  if (dining && dining.cities.length && unlock("Warehouse API")) {
    const products = dining.products || [];
    const complete = products.every(p => (dining.productInfo?.[p]?.developmentProgress || 0) >= 100);
    if (products.length < 3 && complete && corpFunds > 2e12) {
      const investment = Math.min(10e9, Math.max(1e9, corpFunds * 0.005));
      if (corpFunds > 2 * investment + reserve) add("makeProduct", ["Dining", dining.cities[0], `Apex Dining ${products.length + 1}`, investment, investment], 2 * investment + reserve);
    }
  }

  if (Date.now() - corpLastUpgradeAt >= 60000) {
    for (const upgrade of ["Smart Factories", "Smart Storage", "Wilson Analytics"]) {
      const cost = Number(s.upgradeCosts?.[upgrade]);
      if (Number.isFinite(cost) && cost <= corpFunds * 0.01 && corpFunds > cost + reserve) {
        add("levelUpgrade", [upgrade], cost + reserve);
        break;
      }
    }
  }
  return { actions, reason: `${s.corporation?.name || "Corporation"}: $${Math.round(corpFunds).toLocaleString()}, divisions=${Object.keys(divisions).join(",") || "none"}` };
}

async function applyCorporationPlan(actions) {
  if (!actions.length) return [];
  return run(`
    const [raw] = ns.args;
    const actions = JSON.parse(raw);
    const c = ns.corporation;
    const results = [];
    for (const op of actions) {
      try {
        if (op.minCash != null && c.getCorporation().funds < op.minCash) {
          results.push({ type: op.type, skipped: "cash reserve" });
          continue;
        }
        if (op.type === "hireToSize") {
          const [division, city] = op.args;
          let office = c.getOffice(division, city);
          while ((office.numEmployees || 0) < (office.size || 0)) {
            if (!c.hireEmployee(division, city)) break;
            office = c.getOffice(division, city);
          }
          results.push({ type: op.type, ok: true });
        } else if (op.type === "assignOffice") {
          const [division, city, jobs, counts] = op.args;
          for (const job of jobs) c.setJobAssignment(division, city, job, 0);
          for (let i = 0; i < jobs.length; i++) if (counts[i]) c.setJobAssignment(division, city, jobs[i], counts[i]);
          results.push({ type: op.type, ok: true });
        } else {
          const result = await c[op.type](...(op.args || []));
          results.push({ type: op.type, ok: result !== false });
        }
      } catch (error) { results.push({ type: op.type, error: String(error) }); }
    }
    return results;
  `, { args: [JSON.stringify(actions)], host: "home", threads: 1 });
}

async function corporationAutoTick() {
  await setCorporationLease(true);
  const s = await getCorporationSnapshot();
  corpLastSnapshot = s;
  const plan = buildCorporationPlan(s);
  if (plan.actions.length) {
    const results = await applyCorporationPlan(plan.actions);
    const errors = (results || []).filter(r => r.error);
    if (errors.length) console.log(`🏢 corporation: ${errors.length} action error(s): ${errors.slice(0, 3).map(r => `${r.type}: ${r.error}`).join("; ")}`);
    if ((results || []).some(r => r.type === "levelUpgrade" && r.ok)) corpLastUpgradeAt = Date.now();
    console.log(`🏢 ${plan.reason} · applied ${results?.filter(r => r.ok).length || 0}/${plan.actions.length} actions`);
  } else if (Date.now() - corpLastSummaryAt > 60000) {
    corpLastSummaryAt = Date.now();
    console.log(`🏢 ${plan.reason}`);
  }
  corpCycles++;
  return { available: s.available, hasCorporation: s.hasCorporation, eligible: s.eligible, cycles: corpCycles, planned: plan.actions.length, reason: plan.reason };
}

async function corporationAutoLoop() {
  if (corpAutoRunning) { console.log("corporation auto already running"); return; }
  corpAutoRunning = true;
  console.log("🏢 PC corporation manager STARTED — type 'corp-auto' again to stop");
  try {
    while (corpAutoRunning) {
      try {
        if (!agent) { await sleep(2000); continue; }
        await corporationAutoTick();
      } catch (error) { console.log("🏢 corporation loop recovered:", error.message); }
      const until = Date.now() + CONFIG.corpAutoIntervalMs;
      while (corpAutoRunning && Date.now() < until) await sleep(500);
    }
  } finally {
    corpAutoRunning = false;
    try { await setCorporationLease(false); }
    catch (error) { console.log("🏢 could not release corporation ownership lease:", error.message); }
    console.log("🏢 PC corporation manager STOPPED");
  }
}

const DNET_OWNER_FILE = "tasks/__pc_dnet_owner.json";
async function setDarknetLease(active) {
  if (!agent) return false;
  const source = active
    ? `await ns.write(${JSON.stringify(DNET_OWNER_FILE)}, JSON.stringify({ owner: "pc-controller", expiresAt: ${Date.now() + 180_000} }), "w"); return true;`
    : `return ns.rm(${JSON.stringify(DNET_OWNER_FILE)}, "home");`;
  return run(source, { host: "home", threads: 1 });
}

async function dnetAutoLoop() {
  if (dnetAutoRunning) { console.log("darknet auto already running"); return; }
  dnetAutoRunning = true;
  dnetStats.started = Date.now();
  console.log("🌐 darknet auto-pilot STARTED — type 'dnet-auto' again to stop");

  let pf;
  try {
    await setDarknetLease(true);
    pf = await preflightDarknet();
  } catch (error) {
    dnetAutoRunning = false;
    try { await setDarknetLease(false); } catch {}
    console.log(`🌐 auto-pilot preflight failed: ${error.message}`);
    return;
  }

  if (CONFIG.dnetRequireTor && !pf.tor) {
    dnetAutoRunning = false;
    try { await setDarknetLease(false); } catch {}
    console.log("🌐 auto-pilot STOPPED — TOR router required. Run: buy tor");
    return;
  }
  if (!pf.dnetApi) {
    dnetAutoRunning = false;
    try { await setDarknetLease(false); } catch {}
    console.log("🌐 auto-pilot STOPPED — ns.dnet API not available. Run: buy darkscape");
    return;
  }

  if (pf.directExec) {
    console.log(`✅ worm seeded on ${CONFIG.dnetEntryHost} via direct exec`);
  } else if (pf.entrySession) {
    console.log(`✅ connected to ${CONFIG.dnetEntryHost}`);
  } else if (pf.entryProbe.includes(CONFIG.dnetEntryHost)) {
    console.log(`⚠️  ${CONFIG.dnetEntryHost} adjacent but seeding failed — will retry`);
  } else if (pf.entryProbe.length === 0) {
    console.log(`ℹ️  no darknet neighbors visible from home — run in terminal: connect darkweb`);
  }

  while (dnetAutoRunning) {
    const cycleStart = Date.now();
    try {
      if (!agent) { await sleep(2000); continue; }
      await setDarknetLease(true);

      if (pf.directExec) {
        try {
          const running = await run(
            `const [s, h] = ns.args;
             try { return ns.isRunning(s, h); } catch { return false; }`,
            { args: ["darknet-worm.js", CONFIG.dnetEntryHost], host: "home", threads: 1 }
          );
          if (!running) await seedWorm(CONFIG.dnetEntryHost);
        } catch {}
      }

      const pulled = await pullPasswordsFromGame();
      if (pulled > 0) console.log(`   ⬇️  merged ${pulled} passwords from worm`);

      await syncPasswordFileToGame();
      await syncDnetCandidatesToGame();

      if (pf.directExec) {
        try { await scpFile(CONFIG.dnetPasswordFile, CONFIG.dnetEntryHost); } catch {}
        try { await scpFile(DNET_CANDIDATES_FILE, CONFIG.dnetEntryHost); } catch {}
      }

      const all = await scoutDarknet(true);
      const dnet = all.filter((s) => s.isDarknet);

      const authed = dnet.filter((s) => s.hasAdmin);
      const unauth = dnet.filter((s) => !s.hasAdmin);

      dnetStats.discovered = dnet.length;
      dnetStats.authed = authed.length;

      prunePasswords(dnet.map((s) => s.host));

      const toCrack = unauth
        .filter((h) => h.host === CONFIG.dnetEntryHost)
        .filter((h) => getPassword(h.host) === null)
        .slice(0, 1);

      for (const entry of toCrack) {
        if (!dnetAutoRunning) break;
        const ok = await crackDarknetServer(entry);
        if (ok) {
          dnetStats.cracked++;
          if (await establishSession(entry.host)) {
            await seedWorm(entry.host);
            dnetStats.seeded++;
          }
        } else {
          dnetStats.failedCracks++;
        }
      }

      if (CONFIG.dnetSeedHarvester) {
        try {
          const live = await run(`
            const files = ns.ls("home", "tasks/harvest_").filter(f => f.endsWith(".json"));
            const now = Date.now();
            let live = 0;
            for (const f of files) {
              try {
                const d = JSON.parse(ns.read(f));
                if (d && !d.ended) live++;
                else if (d && d.ended && now - d.ended < 600000) live++;
              } catch {}
            }
            return live;
          `);
          dnetStats.harvesters = live;
        } catch {}

        for (const entry of authed) {
          if (!(await canExecOn(entry.host))) continue;
          try {
            const running = await run(
              `const [s, h] = ns.args;
               try { return ns.isRunning(s, h); } catch { return false; }`,
              { args: ["darknet-harvest.js", entry.host], host: "home", threads: 1 }
            );
            if (!running) await seedHarvester(entry.host);
          } catch {}
        }
      }

      dnetStats.sessionsRefreshed += await refreshSessions(authed);
      dnetStats.stasisLinks += await manageStasisLinks(authed);
      dnetStats.cachesOpened += await sweepCacheOpeners(authed);

      try {
        const h = await pullHarvestStats();
        if (h && h.summary) {
          dnetStats.totalMoney = h.summary.money;
          dnetStats.totalCaches = h.summary.caches;
          dnetStats.totalFilesRead = h.summary.filesRead;
          dnetStats.totalPasswordsFromFiles = h.summary.passwords;
          dnetStats.phishingCalls = h.summary.phishingCalls;
        }
      } catch {}

      try { dnetStats.instability = await run(`return ns.dnet.getInstability();`); } catch {}

      dnetStats.passwords = Object.keys(loadPasswords()).length;
      dnetStats.cycles++;
      dnetStats.lastCycleMs = Date.now() - cycleStart;

      printDnetStats();
    } catch (e) {
      console.log("dnet-auto error:", e.message);
      await sleep(5000);
    }

    const sleepEnd = Date.now() + CONFIG.dnetAutoIntervalMs;
    while (dnetAutoRunning && Date.now() < sleepEnd) await sleep(1000);
  }

  try { await setDarknetLease(false); }
  catch (error) { console.log("could not release darknet ownership lease:", error.message); }
  console.log("🌐 darknet auto-pilot STOPPED");
}

function dnetAutoStop() {
  dnetAutoRunning = false;
  console.log("stopping darknet auto-pilot…");
}

// ===========================================================================
// END DARKNET
// ===========================================================================

// ---------------------------------------------------------------------------
// Autopilot loop (hacking)
// ---------------------------------------------------------------------------
let lastPush = 0;
let lastManage = 0;
let autopilotRunning = false;
const HACK_OWNER_FILE = "tasks/__pc_hack_owner.json";
async function setHackingLease(active) {
  if (!agent) return false;
  const source = active
    ? `await ns.write(${JSON.stringify(HACK_OWNER_FILE)}, JSON.stringify({ owner: "pc-controller", expiresAt: ${Date.now() + 90_000} }), "w"); return true;`
    : `return ns.rm(${JSON.stringify(HACK_OWNER_FILE)}, "home");`;
  return run(source, { host: "home", threads: 1 });
}

async function autopilotLoop() {
  if (autopilotRunning) { console.log("hacking autopilot already running"); return; }
  autopilotRunning = true;
  console.log("🤖 PC hacking/server autopilot started — type 'auto' again to stop\n");
  try {
    while (autopilotRunning) {
      try {
        if (!agent) { await sleep(1000); continue; }
        await setHackingLease(true);
        if (Date.now() - lastManage > 30000) { await manageServers(); lastManage = Date.now(); }
        if (Date.now() - lastPush > CONFIG.pushWorkersEveryMs) { await pushWorkers(); lastPush = Date.now(); }
        await autopilotTick();
      } catch (e) { console.log("autopilot error:", e.message); }
      await sleep(CONFIG.tickMs);
    }
  } finally {
    autopilotRunning = false;
    try { await setHackingLease(false); }
    catch (error) { console.log("could not release hacking ownership lease:", error.message); }
    console.log("🤖 PC hacking/server autopilot stopped");
  }
}

// The PC controller owns the top-level automation lifecycle. daemon.js remains
// the in-game worker manager for game systems that need long-running scripts.
let gameDaemonSupervisorRunning = false;
let lastGameDaemonWarningAt = 0;
let fullAutomationRunning = false;
async function ensureGameDaemon() {
  if (!agent) return false;
  const state = await run(`
    if (!ns.fileExists("daemon.js", "home")) return { missing: true };
    const current = ns.ps("home").find(p => p.filename === "daemon.js");
    if (current) return { running: true, pid: current.pid };
    let pid = 0;
    try { pid = ns.exec("daemon.js", "home", { threads: 1 }, "--no-tail-windows"); }
    catch (error) { return { error: error.message }; }
    return { started: pid > 0, pid };
  `, { host: "home", threads: 1 });

  if (state?.missing) {
    if (Date.now() - lastGameDaemonWarningAt > 300_000) {
      lastGameDaemonWarningAt = Date.now();
      console.log("🎛️ game automation files are not on home yet; connect Remote API or sync the scripts and pc.js will retry.");
    }
    return false;
  }
  if (state?.error) {
    console.log(`🎛️ could not start daemon.js: ${state.error}`);
    return false;
  }
  if (state?.started) console.log(`🎛️ PC started game automation manager (daemon.js, pid ${state.pid}).`);
  return state?.running === true || state?.started === true;
}

async function gameDaemonSupervisorLoop() {
  if (gameDaemonSupervisorRunning) return;
  gameDaemonSupervisorRunning = true;
  try {
    while (gameDaemonSupervisorRunning) {
      try {
        if (agent) await ensureGameDaemon();
      } catch (error) {
        console.log(`🎛️ game automation supervision recovered: ${error.message}`);
      }
      const until = Date.now() + CONFIG.gameDaemonCheckMs;
      while (gameDaemonSupervisorRunning && Date.now() < until) await sleep(500);
    }
  } finally {
    gameDaemonSupervisorRunning = false;
  }
}

const GAME_AUTOMATION_PROCESS_NAMES = [
  "daemon.js", "stats.js", "darknet-manager.js", "corporation-manager.js", "go.js",
  "stockmaster.js", "hacknet-upgrade-manager.js", "spend-hacknet-hashes.js", "sleeve.js",
  "gangs.js", "work-for-factions.js", "bladeburner.js", "tor-manager.js",
  "program-manager.js", "contractor.js", "ram-manager.js", "faction-manager.js",
  "host-manager.js", "backdoor-all-servers.js", "darknet-worm.js", "darknet-harvest.js",
  "darknet-realloc.js", "hack.js", "grow.js", "weaken.js", "hack-target.js",
  "grow-target.js", "weak-target.js", "manualhack-target.js", "share.js",
];

async function stopGameAutomation() {
  return run(`
    const managed = new Set(${JSON.stringify(GAME_AUTOMATION_PROCESS_NAMES)});
    const queue = ["home"], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      try { for (const next of ns.scan(queue[i])) if (!seen.has(next)) { seen.add(next); queue.push(next); } } catch {}
    }
    let stopped = 0;
    for (const host of seen) {
      try {
        if (!ns.hasRootAccess(host)) continue;
        for (const process of ns.ps(host)) {
          const name = String(process.filename).split("/").pop();
          if (managed.has(name) && ns.kill(process.pid, host)) stopped++;
        }
      } catch {}
    }
    return stopped;
  `, { host: "home", threads: 1 });
}

async function startAllAutomation() {
  if (fullAutomationRunning) return;
  if (!agent) {
    console.log("cannot start full automation until agent.js is connected in Bitburner.");
    return;
  }
  fullAutomationRunning = true;
  if (CONFIG.hackingAutoStartOnBoot) {
    try { await setHackingLease(true); } catch (error) { console.log(`hacking lease failed: ${error.message}`); }
    void autopilotLoop();
  }
  if (CONFIG.corpAutoStartOnBoot) {
    try { await setCorporationLease(true); } catch (error) { console.log(`corporation lease failed: ${error.message}`); }
    corporationAutoLoop();
  }
  if (CONFIG.dnetAutoStartOnBoot) {
    try { await setDarknetLease(true); } catch (error) { console.log(`darknet lease failed: ${error.message}`); }
    void dnetAutoLoop();
  }
  if (CONFIG.gameDaemonAutoStartOnBoot) {
    try { await ensureGameDaemon(); } catch (error) { console.log(`game suite startup failed: ${error.message}`); }
    void gameDaemonSupervisorLoop();
  }
  console.log("🎛️ full automation is under PC control.");
}

async function stopAllAutomation() {
  fullAutomationRunning = false;
  autopilotRunning = false;
  corpAutoRunning = false;
  gameDaemonSupervisorRunning = false;
  dnetAutoStop();
  let stopped = 0;
  try { stopped = await stopGameAutomation(); }
  catch (error) { console.log(`could not stop all game managers: ${error.message}`); }
  for (const release of [setHackingLease(false), setCorporationLease(false), setDarknetLease(false)]) {
    try { await release; } catch {}
  }
  console.log(`⏹️ full automation stopped; terminated ${stopped} game manager/worker process(es).`);
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------
let currentAbort = null;

async function ollamaPreflight() {
  try {
    const res = await fetch(`${CONFIG.ollamaHost}/api/tags`);
    if (!res.ok) throw new Error(`tags HTTP ${res.status}`);
    const { models } = await res.json();
    const names = (models || []).map((m) => m.name);
    const wanted = CONFIG.ollamaModel;
    const available = names.includes(wanted) || names.includes(wanted + ":latest");
    if (!available) { console.log(`⚠️  model "${wanted}" not found.`); return false; }
    console.log(`✅ Ollama model "${wanted}" available.`);
    return true;
  } catch (e) { console.log(`⚠️  Ollama preflight failed: ${e.message}`); return false; }
}

async function ollamaChat(messages, formatSchema) {
  const body = {
    model: CONFIG.ollamaModel, messages,
    format: formatSchema || "json", stream: false,
    options: { temperature: CONFIG.ollamaTemp },
    keep_alive: CONFIG.ollamaKeepAlive,
  };
  currentAbort = new AbortController();
  const timer = setTimeout(() => currentAbort.abort(), CONFIG.ollamaTimeoutMs);
  let res;
  try {
    res = await fetch(`${CONFIG.ollamaHost}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: currentAbort.signal,
    });
  } catch (e) {
    clearTimeout(timer); currentAbort = null;
    if (e.name === "AbortError") throw new Error("Ollama aborted or timed out");
    throw new Error(`Ollama unreachable`);
  }
  clearTimeout(timer); currentAbort = null;
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return json.message?.content ?? "";
}

function parseModelJson(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error("unbalanced braces");
}

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    thought: { type: "string" },
    action: { type: "string", enum: [
      "state", "scan", "servers", "level", "money",
      "nuke", "exec", "push", "buy", "manage",
      "plan", "tick", "darknet", "run", "wait", "note", "done",
    ]},
    params: { type: "object", additionalProperties: true },
    reason: { type: "string" },
  },
  required: ["action", "reason"],
};

const SYSTEM_PROMPT = `You are the autonomous controller for a Bitburner save.
GOAL: maximise income and progression.

ACTIONS:
  state · scan · servers · level · money
  nuke {host} · exec {script, host, threads, args?}
  push · buy · manage · tick · plan {target}
  darknet · run {js} · wait {ms} · note {text} · done

RULES:
- Snapshot is in every message. Do NOT call 'state' at the start.
- Prefer 'tick' when unsure.
- Darknet is fully automated by dnet-auto (worm cracks/spreads, PC observes).
- Output ONLY JSON. No prose, no fences.
`;

async function snapshot() {
  const player = await getPlayer();
  const hacking = player.skills?.hacking ?? player.hacking;
  const topServers = await run(`
    const seen = new Set(["home"]); const q = ["home"];
    while (q.length) { const h = q.shift(); for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
    const out = [];
    for (const h of seen) {
      if (h === "home" || h === "darkweb") continue;
      const s = ns.getServer(h);
      if (!s.hasAdminRights || s.moneyMax <= 0) continue;
      out.push({ host: h, lvl: s.requiredHackingLevel, money: Math.round(s.moneyAvailable ?? 0), max: Math.round(s.moneyMax ?? 0), sec: +(s.hackDifficulty ?? 0).toFixed(1), minSec: +(s.minDifficulty ?? 0).toFixed(1) });
    }
    out.sort((a, b) => b.max - a.max);
    return out.slice(0, 10);
  `);
  const pserv = await getPurchasedServers();
  const rewards = loadRewards();
  return {
    hackingLevel: hacking, money: Math.round(player.money),
    purchasedServers: pserv.length, inFlightBatches: inflight.length,
    topServers,
    darknet: {
      running: dnetAutoRunning, cycles: dnetStats.cycles,
      discovered: dnetStats.discovered, authed: dnetStats.authed,
      cracked: dnetStats.cracked, memReallocs: dnetStats.memReallocs,
      harvesters: dnetStats.harvesters,
      money: rewards.money, caches: rewards.caches,
      phishingCalls: rewards.phishingCalls,
      passwords: dnetStats.passwords,
      instability: dnetStats.instability,
    },
  };
}

async function executeAction(action, params = {}) {
  switch (action) {
    case "state":   return await snapshot();
    case "scan":    return await scanAll();
    case "servers": return (await getServers()).map((s) => ({ host: s.hostname, admin: s.hasAdminRights, lvl: s.requiredHackingLevel, max: Math.round(s.moneyMax ?? 0) }));
    case "level":   return await getHackingLevel();
    case "money":   return await getMoney();
    case "nuke": {
      if (!params.host) return { ok: false, error: "requires host" };
      try { return { ok: await run(`return ns.nuke(${JSON.stringify(params.host)});`) }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    case "exec": {
      if (!params.script || !params.host) return { ok: false, error: "requires script + host" };
      const args = JSON.stringify(params.args ?? []);
      try { const pid = await run(`return ns.exec(${JSON.stringify(params.script)}, ${JSON.stringify(params.host)}, ${params.threads ?? 1}, ...${args});`); return { ok: pid > 0, pid }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    case "push":   await pushWorkers(); return { ok: true };
    case "buy": {
      const player = await getPlayer();
      let cost = 0; try { cost = await run(`return ns.cloud.getServerCost(${CONFIG.serverRam});`); } catch {}
      if (cost > 0 && player.money < cost) return { bought: false, reason: "insufficient funds" };
      const name = `pserv-${Date.now().toString(36)}`;
      const r = await run(`return ns.cloud.purchaseServer(${JSON.stringify(name)}, ${CONFIG.serverRam});`);
      if (r) { await pushWorkers([r]); return { bought: true, host: r }; }
      return { bought: false };
    }
    case "manage": await manageServers(); return { ok: true };
    case "plan":   return await planBatch(params.target) ?? { ok: false };
    case "tick":   return await autopilotTick();
    case "darknet": return { ok: true, running: dnetAutoRunning, hint: "toggle with dnet-auto in REPL" };
    case "run": {
      if (!CONFIG.allowRunAction) return "disabled";
      const js = String(params.js ?? "");
      if (!js || js.length > 4000) return { ok: false, error: "invalid js" };
      try { return { ok: true, result: await run(js) }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    case "wait":    return { ok: true };
    case "note":    return { ok: true };
    case "done":    return "__DONE__";
    default: throw new Error(`Unknown action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// AI session
// ---------------------------------------------------------------------------
let aiRunning = false;
let aiHistory = [];
let aiTurns = 0;

function truncate(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return "";
  return s.length > CONFIG.maxObsChars ? s.slice(0, CONFIG.maxObsChars) + "…" : s;
}
function trimHistory() {
  if (aiHistory.length === 0) return;
  const [system, ...rest] = aiHistory;
  const maxRest = CONFIG.historyTurns * 2;
  if (rest.length > maxRest) aiHistory = [system, ...rest.slice(-maxRest)];
}

async function ollamaOnce() {
  if (!agent) throw new Error("agent not connected");
  if (aiHistory.length === 0) aiHistory.push({ role: "system", content: SYSTEM_PROMPT });
  aiHistory.push({ role: "user", content: `Turn ${aiTurns + 1}:\n${truncate(await snapshot())}` });
  const raw = await ollamaChat(aiHistory, ACTION_SCHEMA);
  let decision;
  try { decision = parseModelJson(raw); } catch { throw new Error(`non-JSON: ${raw.slice(0, 200)}`); }
  console.log(`🧠 [${decision.action}] ${decision.thought ?? ""}`);
  aiHistory.push({ role: "assistant", content: JSON.stringify(decision) });
  let observation;
  try { observation = await executeAction(decision.action, decision.params || {}); }
  catch (e) { observation = { ok: false, error: e.message }; }
  console.log(`   → ${truncate(observation).slice(0, 300)}`);
  aiHistory.push({ role: "user", content: `Result:\n${truncate(observation)}` });
  trimHistory(); aiTurns++;
  return decision;
}

async function ollamaLoop() {
  if (aiRunning) return;
  aiRunning = true; aiTurns = 0; aiHistory = [];
  console.log(`🤖 AI loop started (${CONFIG.ollamaModel})`);
  while (aiRunning) {
    try {
      const d = await ollamaOnce();
      if (d.action === "done") break;
      if (d.action === "wait") await sleep(d.params?.ms ?? 5000);
    } catch (e) { console.log("AI error:", e.message); await sleep(5000); }
    await sleep(500);
  }
  aiRunning = false;
  console.log("🤖 AI loop stopped");
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "pc> " });

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  const [cmd, ...rest] = input.split(/\s+/);
  try {
    switch (cmd) {
      case "q": case "quit": process.exit(0);
      case "help":
        console.log(`
  status · player · level · money · scan · servers · pserv
  auto                ← START/STOP PC-side hacking and server management (also starts on boot)
  corp-auto           ← START/STOP PC-side corporation management
  corp-status · corp-stop
  all-auto            ← START/STOP the full PC-managed automation suite
  game-suite          ← ensure the PC-managed in-game helper suite is running
  nuke <host> · scp <file> <host> · exec <script> <host> <threads> [arg]
  push · plan <target> · tick · manage · buy
  dnet-auto           ← START/STOP the full autonomous darknet loop
  dnet-stats · dnet-preflight · dnet-rewards
  dnet-probe · dnet-scout · dnet-pw · dnet-caches
  dnet-harvest [host] ← seed harvester
  dnet-raw <host> · dnet-forget <host> · dnet-realloc <neighbor> <target>
  dnet-seed [host] · dnet-report [host]
  darknet-candidates.txt beside pc.js is synced into the darknet worm
  syncpw
  sync                  ← PUSH repository game scripts using Remote API
  run <js>
  ai · ai-once · ai-stop · ai-reset · ai-status · ai-model <name>
  quit
        `);
        break;

      case "status": {
        console.log(`  agent:    ${agent ? "✅" : "❌"}`);
        console.log(`  remote:   ${remoteApi ? "✅ Bitburner Remote API connected" : "❌ not connected"}`);
        console.log(`  all-auto: ${fullAutomationRunning ? "▶ running" : "⏹ stopped"}`);
        console.log(`  auto:     ${autopilotRunning ? "▶ running" : "⏹ stopped"}`);
        console.log(`  game suite: ${gameDaemonSupervisorRunning ? "▶ supervised" : "⏹ stopped"}`);
        console.log(`  inflight: ${inflight.length}`);
        for (const b of inflight) {
          const s = Math.max(0, (b.endsAt - Date.now()) / 1000).toFixed(1);
          console.log(`    [${b.kind ?? "?"}] ${b.target} — ${s}s`);
        }
        console.log(`  dnet-auto: ${dnetAutoRunning ? "▶ running" : "⏹ stopped"}`);
        console.log(`  corp-auto: ${corpAutoRunning ? "▶ running" : "⏹ stopped"} · cycles=${corpCycles}`);
        break;
      }

      case "player": console.log(await getPlayer()); break;
      case "level":  console.log(await getHackingLevel()); break;
      case "money":  console.log(await getMoney()); break;
      case "scan":   console.log(await scanAll()); break;
      case "servers":console.log(await getServers()); break;
      case "pserv":  console.log(await getPurchasedServers()); break;
      case "corp-auto":
        if (corpAutoRunning) { corpAutoRunning = false; console.log("stopping PC corporation manager…"); }
        else corporationAutoLoop();
        break;
      case "corp-stop": corpAutoRunning = false; console.log("stopping PC corporation manager…"); break;
      case "corp-status": console.log(JSON.stringify(await getCorporationSnapshot(), null, 2)); break;
      case "all-auto":
        if (fullAutomationRunning) await stopAllAutomation();
        else await startAllAutomation();
        break;
      case "game-suite": {
        const running = await ensureGameDaemon();
        console.log(running ? "🎛️ daemon.js is running under PC supervision." : "🎛️ game suite is not ready; check that daemon.js is synced and home has free RAM.");
        break;
      }
      case "nuke":   console.log(await run(`return ns.nuke(${JSON.stringify(rest[0])});`)); break;
      case "scp":    console.log(await scpFile(rest[0], rest[1])); break;

      case "exec": {
        const [script, host, threads, ...args] = rest;
        console.log(await exec(script, host, parseInt(threads, 10), args));
        break;
      }

      case "push":   await pushWorkers(); break;
      case "sync":   await syncFilesThroughRemoteApi(); break;
      case "plan":   console.log(await planBatch(rest[0])); break;
      case "tick":   console.log(await autopilotTick()); break;
      case "auto":
        if (autopilotRunning) { autopilotRunning = false; console.log("stopping PC hacking/server autopilot…"); }
        else void autopilotLoop();
        break;
      case "auto-stop": autopilotRunning = false; console.log("stopping PC hacking/server autopilot…"); break;
      case "manage": await manageServers(); break;

      case "buy": {
        const player = await getPlayer();
        let cost = 0;
        try { cost = await run(`return ns.cloud.getServerCost(${CONFIG.serverRam});`); } catch {}
        if (cost > 0 && player.money < cost) { console.log(`need $${Math.round(cost - player.money)} more`); break; }
        const name = `pserv-${Date.now().toString(36)}`;
        const r = await run(`return ns.cloud.purchaseServer(${JSON.stringify(name)}, ${CONFIG.serverRam});`);
        console.log("bought:", r);
        if (r) await pushWorkers([r]);
        break;
      }

      case "run":    console.log("=>", await run(rest.join(" "))); break;

      case "dnet-auto":
        if (dnetAutoRunning) dnetAutoStop();
        else dnetAutoLoop();
        break;

      case "dnet-stats": console.log(JSON.stringify(dnetStats, null, 2)); break;

      case "dnet-preflight":
        console.log(JSON.stringify(await preflightDarknet(), null, 2));
        break;

      case "dnet-report": {
        const host = rest[0] || CONFIG.dnetEntryHost;
        const raw = await run(`
          const [h] = ns.args;
          const f = "tasks/report_" + h + ".json";
          try { return ns.fileExists(f, "home") ? ns.read(f) : "(no report yet)"; }
          catch (e) { return "error: " + e.message; }
        `, { args: [host], host: "home", threads: 1 });
        console.log(raw);
        break;
      }

      case "dnet-rewards": {
        const r = loadRewards();
        const money = r.money >= 1e9 ? `$${(r.money / 1e9).toFixed(2)}b`
          : r.money >= 1e6 ? `$${(r.money / 1e6).toFixed(2)}m`
          : r.money >= 1e3 ? `$${(r.money / 1e3).toFixed(1)}k`
          : `$${Math.round(r.money)}`;
        console.log(`💰 total: ${money}`);
        console.log(`   caches: ${r.caches}  phishing calls: ${r.phishingCalls}`);
        console.log(`   files read: ${r.filesRead}  passwords learned: ${r.passwords}`);
        console.log(`   tracked since: ${new Date(r.firstAt).toISOString()}`);
        console.log(`   per host:`);
        for (const [h, d] of Object.entries(r.perHost || {})) {
          console.log(`     ${h}: $${Math.round(d.money)} · ${d.caches} caches · ${d.phishingCalls} phish`);
        }
        break;
      }

      case "dnet-harvest": {
        const host = rest[0];
        if (host) {
          const ok = await seedHarvester(host);
          console.log(ok ? `harvester seeded on ${host}` : `${host} already has one, or no RAM`);
          break;
        }
        const all = await scoutDarknet();
        const authed = all.filter((s) => s.isDarknet && s.hasAdmin);
        let n = 0;
        for (const entry of authed) {
          if (!(await canExecOn(entry.host))) continue;
          if (await seedHarvester(entry.host)) n++;
        }
        console.log(`seeded ${n} harvester(s) across reachable authed hosts`);
        break;
      }

      case "dnet-caches": {
        const all = await scoutDarknet();
        const authed = all.filter((s) => s.isDarknet);
        const rows = [];
        for (const entry of authed) {
          try {
            const files = await run(
              `const [h] = ns.args; try { return ns.ls(h, ".cache"); } catch { return []; }`,
              { args: [entry.host], host: "home", threads: 1 }
            );
            if (files && files.length) rows.push({ host: entry.host, files });
          } catch {}
        }
        console.log(JSON.stringify(rows, null, 2));
        break;
      }

      case "dnet-seed": {
        const host = rest[0] || CONFIG.dnetEntryHost;
        console.log("seeding", host);
        for (const f of ["darknet-worm.js", "darknet-realloc.js", "darknet-harvest.js", CONFIG.dnetPasswordFile, DNET_CANDIDATES_FILE, "darknet-stasis-plan.json"]) {
          try { await scpFile(f, host); } catch {}
        }
        const pid = await run(
          `const [s, h] = ns.args;
           try { return ns.exec(s, h, { threads: 1, preventDuplicates: true }); }
           catch { return 0; }`,
          { args: ["darknet-worm.js", host], host: "home", threads: 1 }
        ).catch(() => 0);
        console.log(`worm on ${host} → pid ${pid}`);
        break;
      }

      case "dnet-probe": {
        const probes = await run(`
          try {
            const list = [...new Set(ns.dnet.probe() || [])];
            const out = [];
            for (const h of list) {
              let depth = -1, info = null;
              try { depth = ns.dnet.getDepth(h); } catch {}
              try { info = ns.dnet.getServerDetails(h); } catch {}
              out.push({ host: h, depth, authRequired: info?.requiresPassword ?? true, passwordHint: info?.passwordHint ?? null, maxRam: ns.getServerMaxRam(h) });
            }
            return out;
          } catch (e) { return { error: e.message }; }
        `);
        console.log(JSON.stringify(probes, null, 2));
        break;
      }

      case "dnet-scout": console.log(JSON.stringify(await scoutDarknet(true), null, 2)); break;
      case "dnet-pw": console.log(loadPasswords()); break;

      case "dnet-raw": {
        if (!rest[0]) { console.log("usage: dnet-raw <host>"); break; }
        const raw = await run(
          `const [t] = ns.args; try { return ns.dnet.getServerDetails(t); } catch (e) { return { error: e.message }; }`,
          { args: [rest[0]], host: "home", threads: 1 }
        );
        console.log(JSON.stringify(raw, null, 2));
        break;
      }

      case "dnet-forget": {
        if (!rest[0]) { console.log("usage: dnet-forget <host>"); break; }
        const db = loadPasswords();
        delete db[rest[0]];
        savePasswords(db);
        await syncPasswordFileToGame();
        console.log(`forgot ${rest[0]}`);
        break;
      }

      case "dnet-realloc": {
        if (rest.length >= 2) {
          const [neighbor, target] = rest;
          try { await scpFile("darknet-realloc.js", neighbor); } catch {}
          const pid = await run(
            `const [s, h, t, th] = ns.args;
             try { return ns.exec(s, h, th, t); } catch { return 0; }`,
            { args: ["darknet-realloc.js", neighbor, target, CONFIG.dnetReallocThreads], host: "home", threads: 1 }
          ).catch(() => 0);
          console.log(`realloc ${target} on ${neighbor} → pid ${pid}`);
        } else {
          console.log("usage: dnet-realloc <neighbor> <target>");
        }
        break;
      }

      case "syncpw":
        await syncPasswordFileToGame();
        console.log("synced");
        break;

      case "ai":       ollamaLoop(); break;
      case "ai-stop":
        if (currentAbort) currentAbort.abort();
        aiRunning = false;
        console.log("stopping AI…");
        break;
      case "ai-once": {
        const d = await ollamaOnce();
        console.log("decision:", d);
        break;
      }
      case "ai-reset": aiHistory = []; aiTurns = 0; console.log("reset"); break;
      case "ai-status":
        console.log(`running=${aiRunning} turns=${aiTurns} history=${aiHistory.length} model=${CONFIG.ollamaModel}`);
        break;
      case "ai-model": {
        if (!rest[0]) { console.log("usage: ai-model <name>"); break; }
        CONFIG.ollamaModel = rest[0];
        console.log(`model → ${rest[0]}`);
        break;
      }
      case "ai-preflight": await ollamaPreflight(); break;

      default: console.log("unknown — type 'help'");
    }
  } catch (e) { console.error("!!", e.message); }
  rl.prompt();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
console.log("=== Bitburner PC controller v21 ===");
console.log(`WebSocket ws://127.0.0.1:${CONFIG.port}`);
console.log(`Auto-push workers: ${CONFIG.pushWorkersOnBoot ? "on" : "off"} · every ${CONFIG.pushWorkersEveryMs/1000}s`);
console.log(`PC hacking/server autopilot: auto-start=${CONFIG.hackingAutoStartOnBoot ? "on" : "off"}`);
console.log(`Game automation suite: daemon.js auto-start=${CONFIG.gameDaemonAutoStartOnBoot ? "on" : "off"} · check=${CONFIG.gameDaemonCheckMs/1000}s`);
console.log(`Darknet: every ${CONFIG.dnetAutoIntervalMs/1000}s · entry=${CONFIG.dnetEntryHost}`);
console.log(`Corporation: PC-managed · auto-start=${CONFIG.corpAutoStartOnBoot ? "on" : "off"} · interval=${CONFIG.corpAutoIntervalMs/1000}s`);
console.log(`Worm-driven: cracking/spreading/harvesting run in the worm; PC observes`);
console.log(`Ollama: ${CONFIG.ollamaHost} (${CONFIG.ollamaModel})`);
console.log("\n💡 PC.js starts and supervises the full automation suite. Its controller owns hacking, corporation, and darknet; daemon.js starts the remaining game managers.\n");
console.log("In Bitburner, open Options → Remote API and connect to 127.0.0.1:12525 for script sync.");
console.log("After the first sync, run 'run agent.js' once in Bitburner to enable PC-controlled actions.\n");

(async () => {
  while (!agent) await sleep(500);

  try {
    const n = await run(`
      const stale = ns.ls("home").filter(f =>
        f.startsWith("tasks/probe_") || f.startsWith("tasks/pw_") ||
        f.startsWith("tasks/state_") || f.startsWith("tasks/wordlists_")
      );
      for (const f of stale) { try { ns.rm(f, "home"); } catch {} }
      return stale.length;
    `);
    if (n > 0) console.log(`🧹 removed ${n} stale report files`);
  } catch {}

  await ollamaPreflight();
  if (CONFIG.pushWorkersOnBoot) {
    try { await pushWorkers(); } catch (e) { console.log("push failed:", e.message); }
  }
  await startAllAutomation();
  setInterval(ollamaPreflight, CONFIG.preflightEveryMs);
})();

rl.prompt();
