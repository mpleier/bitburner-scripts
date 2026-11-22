/** BFS the Dark Net from darkweb to find a host directly adjacent to the Labyrinth. */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = ns.args[0] || 'th3_l4byr1nth';
  const maxDepth = Number(ns.args[1] || 3);
  const self = ns.getHostname();
  const out = { at: Date.now(), target, self, visited: [], found: null, errors: [] };
  const note = (s) => { out.log = (out.log || []).concat(s); ns.tprint('DW_BFS ' + s); };

  const creds = new Map();
  try {
    const data = JSON.parse(ns.read('tasks/credentials-home.json'));
    for (const row of data.entries || []) if (Array.isArray(row) && typeof row[1] === 'string') creds.set(row[0], row[1]);
  } catch (e) { note('cred load failed: ' + String(e)); }

  const session = async (host) => {
    if (host === self) return true;
    try {
      if (ns.dnet.getServerDetails(host).hasSession === true) return true;
      const pw = creds.get(host);
      if (!pw) return false;
      if (ns.dnet.connectToSession(host, pw).success === true) return true;
      const r = await ns.dnet.authenticate(host, pw);
      return r && r.success === true;
    } catch { return false; }
  };

  const queue = [['darkweb', 0]];
  const seen = new Set();
  while (queue.length) {
    const [host, depth] = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    out.visited.push({ host, depth });
    if (!(await session(host))) { note('no session ' + host); continue; }
    const report = 'tasks/adj-' + host + '.json';
    try {
      if (!ns.fileExists('probe-adj.js', host)) await ns.scp('probe-adj.js', host, self);
      ns.exec('probe-adj.js', host, 1, target);
      let ok = false;
      for (let i = 0; i < 20; i++) {
        await ns.sleep(250);
        if (ns.fileExists(report, host)) { ok = true; break; }
      }
      if (!ok) { note('no report ' + host); continue; }
      if (host !== self) {
        await ns.scp(report, self, host);
        await ns.scp(report, 'home', self);
      }
      const data = JSON.parse(ns.read(report));
      out.visited[out.visited.length - 1].neighbours = data.neighbours;
      if (data.adjacent) { out.found = host; note('FOUND ' + host); break; }
      if (depth < maxDepth) for (const n of data.neighbours || []) if (!seen.has(n)) queue.push([n, depth + 1]);
    } catch (e) { out.errors.push({ host, error: String(e) }); note('err ' + host + ' ' + String(e)); }
  }
  await ns.write('tasks/dw-bfs.json', JSON.stringify(out), 'w');
  await ns.scp('tasks/dw-bfs.json', 'home', self);
}
