import { modelCandidates, passwordHintCandidates, passwordLengthMatches, passwordFormatMatches } from './darknet-solvers.js';
import { createDarknetCredentials } from './darknet-credentials.js';

/**
 * End-to-end Labyrinth route repair.
 *
 * The manager cannot solve a Labyrinth from `darkweb` unless some host with an
 * active session is directly adjacent to it. When the Dark Net reshuffles that
 * link disappears, so this script walks the reachable Dark Net with a tiny
 * neighbour-probe worker, finds a host adjacent to the current Labyrinth, and
 * stasis-links it so the route cannot move again. Everything is reported to
 * home under tasks/dw-labyrinth-connector.json.
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const self = ns.getHostname();
  const PROBE = 'dw-probe-neighbours.js';
  const CONNECTOR = 'darknet-labyrinth-connector.js';
  const PROBE_REPORT = 'tasks/dw-adj-report.json';
  const STASIS = 'darknet-stasis.js';
  const STASIS_REPORT = 'tasks/dw-stasis.json';
  let OUT = 'tasks/dw-labyrinth-connector.json';

  let target = String(ns.args[0] || '');
  if (/^\d+$/.test(target)) target = '';
  if (!target) {
    try {
      const saved = JSON.parse(ns.read('tasks/dnet-labyrinth-target.json'));
      if (saved?.schema === 1 && saved.nodeReset === ns.getResetInfo().lastNodeReset && typeof saved.host === 'string') target = saved.host;
    } catch { /* fall through */ }
  }
  if (!target) target = 'th3_l4byr1nth';
  // Nested launches carry one JSON argument: the remote exec helper drops
  // invocations with two or more trailing arguments.
  let nestedArg = null;
  try { nestedArg = JSON.parse(String(ns.args[0] || '')); } catch { /* plain target */ }
  if (nestedArg && typeof nestedArg.target === 'string') target = nestedArg.target;
  const maxDepth = Number(nestedArg?.depth ?? (ns.args[1] || 6));
  if (nestedArg) OUT = 'tasks/dw-labyrinth-connector-' + self.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  const maxHosts = Number(/^\d+$/.test(String(ns.args[0] || '')) ? ns.args[0] : ns.args[2] || 250);

  const out = {
    at: Date.now(), target, maxDepth,
    steps: [], visited: [], found: null,
    stasis: null, restored: [], nested: [], errors: [],
  };
  const note = (s) => {
    out.steps.push(s);
    ns.tprint('DW_CONNECTOR ' + s);
  };

  const credentialStore = createDarknetCredentials(ns);
  let credentials = new Map();
  try { credentials = await credentialStore.refresh(); }
  catch (e) { out.errors.push('credentials: ' + String(e)); }

  // Use the shared credential store's writer. It keeps the schema's 3-field
  // records, version marker and recency cap intact; a hand-rolled write here
  // would make decodeCredentials() reject the whole bundle on the next refresh.
  const remember = async (host, pw) => {
    credentials.set(host, pw);
    try { await credentialStore.save(host, pw); }
    catch (e) { out.errors.push('save credential ' + host + ': ' + String(e)); }
  };

  const candidatesFor = (details, saved) => {
    const info = details || {};
    const list = [saved, ''];
    try { list.push(...modelCandidates(info)); } catch { /* no solved model candidate */ }
    try { list.push(...passwordHintCandidates(info)); } catch { /* no explicit hint candidate */ }
    const seen = new Set();
    return list.filter((value) => {
      if (typeof value !== 'string' || seen.has(value)) return false;
      seen.add(value);
      return passwordLengthMatches(info, value) && passwordFormatMatches(info, value);
    }).slice(0, 64);
  };

  const session = async (host) => {
    let details = null;
    try { details = ns.dnet.getServerDetails(host); } catch { /* not yet visible */ }
    if (details && details.hasSession === true) return true;
    // Offline/churned hosts answer "Service Unavailable" to every auth call.
    if (details && details.isOnline === false) return false;
    // Model/hint solvers supply the deterministic answer; saved credentials
    // are only a fast path and are skipped when their length no longer fits.
    const candidates = candidatesFor(details, credentials.get(host));
    // authenticate() opens a new session; connectToSession() only resumes an
    // existing one. Live probes showed every fresh neighbour opening through
    // authenticate(), including ZeroLogon hosts whose correct PIN is empty.
    const opened = async (pw) => {
      try {
        const result = await ns.dnet.authenticate(host, pw);
        return !!(result && result.success === true);
      } catch { return false; }
    };
    for (const pw of candidates) {
      if (await opened(pw)) {
        if (pw !== credentials.get(host)) {
          try { await remember(host, pw); } catch { /* non-fatal */ }
          note('renewed credential ' + host);
        }
        return true;
      }
    }
    for (const pw of candidates) {
      try {
        const result = ns.dnet.connectToSession(host, pw);
        if (result && result.success === true) return true;
      } catch { /* try the next candidate */ }
    }
    return false;
  };

  // Dark Net hosts other than darkweb's direct neighbours are not valid
  // targets for scp/exec/ps from here ("Invalid host"). The node fleet already
  // publishes each host's probe() result in its survey on home; use those
  // reports instead of trying to run a remote probe worker.
  const surveyFile = (host) => 'tasks/dnet-' + encodeURIComponent(host) + '.json';
  const directNeighbours = new Set();
  try { for (const n of ns.dnet.probe()) directNeighbours.add(n); } catch (e) { out.errors.push('probe self: ' + String(e)); }
  const probeRemote = async (host) => {
    const file = surveyFile(host);
    try {
      if (self !== 'home' && !ns.fileExists(file, self)) {
        if (!(await ns.scp(file, self, 'home'))) return null;
      }
      const report = JSON.parse(ns.read(file));
      const fresh = !report.at || Date.now() - report.at < 15 * 60 * 1000;
      if (!fresh || !Array.isArray(report.neighbours)) return null;
      return report;
    } catch (e) { return null; }
  };

  note('start target=' + target + ' creds=' + credentials.size);

  // A missing stasis link on darkweb makes the whole BFS unreachable from home.
  // Self-heal it before walking the graph.
  if (self === 'darkweb') {
  try {
    const links = ns.dnet.getStasisLinkedServers();
    if (!links.includes('darkweb')) {
      const ENSURE = 'dw-ensure-stasis.js';
      if (!ns.fileExists(ENSURE, 'darkweb')) await ns.scp(ENSURE, 'darkweb', 'home');
      const pid = ns.exec(ENSURE, 'darkweb', 1);
      if (!pid) out.errors.push('stasis: could not start link repair on darkweb');
      else {
        for (let i = 0; i < 20 && !ns.fileExists('tasks/dw-stasis-report.json', self); i++) await ns.sleep(250);
        try {
          const copied = await ns.scp('tasks/dw-stasis-report.json', self, 'darkweb');
          if (copied) note('stasis: ' + JSON.stringify(JSON.parse(ns.read('tasks/dw-stasis-report.json')).result || {}));
        } catch (e) { out.errors.push('stasis report: ' + String(e)); }
      }
    } else note('stasis: darkweb already linked');
  } catch (e) { out.errors.push('stasis preflight: ' + String(e)); }
  }

  const queue = [[self, 0]];
  const seen = new Set();
  while (queue.length && out.visited.length < maxHosts) {
    const [host, depth] = queue.shift();
    if (seen.has(host) || !host || host === target) continue;
    seen.add(host);
    // Traversal uses the nodes' own surveys, so no session from this host is
    // needed for non-neighbours (they are not even valid exec targets here).
    const report = await probeRemote(host);
    if (!report) {
      note('no survey ' + host);
      continue;
    }
    const neighbours = Array.isArray(report.neighbours) ? report.neighbours : [];
    const adjacent = neighbours.includes(target);
    out.visited.push({ host, depth, neighbours, adjacent });
    if (adjacent) {
      out.found = host;
      note('FOUND ' + host + ' depth=' + depth + ' neighbours=' + neighbours.length);
      break;
    }
    if (depth < maxDepth) {
      for (const neighbour of neighbours) {
        if (typeof neighbour === 'string' && neighbour && !seen.has(neighbour) && neighbour !== target) queue.push([neighbour, depth + 1]);
      }
    }
  }
  if (!out.found) note('no adjacent host found');

  if (out.found) {
    const host = out.found;
    const reachable = self === 'home' || directNeighbours.has(host);
    if (!reachable) {
      note('stasis deferred: ' + host + ' is not a direct neighbour of ' + self);
    } else if (!(await session(host))) {
      note('lost session before stasis ' + host);
    } else {
      const ownRam = ns.getServerMaxRam(host);
      if (ownRam < 16) {
        note('skip stasis ' + host + ': only ' + ownRam + ' GB RAM');
      } else {
        // Only pause Dark Net workers. Never kill unrelated jobs on a host that
        // happens to be adjacent to the maze.
        const workers = ns.ps(host).filter((p) => /^(darknet-|stasis-|dw-)/.test(p.filename));
        const saved = workers.map((p) => ({ filename: p.filename, args: (p.args || []).map(String), threads: p.threads, pid: p.pid }));
        for (const p of saved) {
          try { ns.kill(p.pid, host); } catch (e) { out.errors.push('kill ' + p.filename + '@' + host + ': ' + String(e)); }
        }
        await ns.sleep(750);
        try { ns.rm(STASIS_REPORT, host); } catch { /* none */ }
        let copied = false;
        try { copied = await ns.scp(STASIS, host, 'home'); } catch (e) { out.errors.push('scp stasis: ' + String(e)); }
        let pid = 0;
        if (copied) {
          try { pid = ns.exec(STASIS, host, 1); } catch (e) { out.errors.push('exec stasis: ' + String(e)); }
        }
        let result = null;
        if (pid) {
          for (let i = 0; i < 40; i++) {
            await ns.sleep(250);
            if (ns.fileExists(STASIS_REPORT, host)) break;
          }
          try {
            if (await ns.scp(STASIS_REPORT, self, host)) result = JSON.parse(ns.read(STASIS_REPORT));
          } catch (e) { out.errors.push('read stasis report: ' + String(e)); }
        }
        let linked = [];
        try { linked = ns.dnet.getStasisLinkedServers(); } catch (e) { out.errors.push('linked list: ' + String(e)); }
        out.stasis = { host, ram: ownRam, pid, killed: saved.length, result, linked, verified: linked.includes(host) };
        note('stasis ' + host + ' verified=' + out.stasis.verified + ' linked=' + linked.length);

        for (const p of saved) {
          try {
            const newPid = ns.exec(p.filename, host, p.threads, ...p.args);
            out.restored.push({ filename: p.filename, host, pid: newPid });
          } catch (e) { out.errors.push('restore ' + p.filename + '@' + host + ': ' + String(e)); }
        }
        note('restored ' + out.restored.length + '/' + saved.length);
      }
    }
  }

  // Publish before writing the local report so copy failures are included in
  // the report instead of being appended after the write (and lost).
  if (self !== 'home') {
    try { await ns.scp(OUT, 'home', self); }
    catch (e) { out.errors.push('publish report: ' + String(e)); }
  }
  await ns.write(OUT, JSON.stringify(out), 'w');
}
