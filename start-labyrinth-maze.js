/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0] || 'th3_l4byr1nth';
  const ctx = JSON.parse(ns.read('tasks/dnet-cache-context.json'));
  const d = ns.dnet.getServerDetails(target);
  const scope = [ctx.nodeReset, ctx.augReset, target, d.modelId, d.passwordLength, d.passwordFormat, d.data];
  const workerHost = 'darkweb';
  if (ns.getHostname() !== workerHost) {
    for (const file of ['run-labyrinth-maze.js', 'debug-maze.js', 'darknet-maze.js']) {
      if (ns.fileExists(file, 'home') && !await ns.scp(file, workerHost, 'home')) {
        ns.tprint(`MAZE_START could not copy ${file} to ${workerHost}`);
        return 0;
      }
    }
  }
  const pid = ns.exec('run-labyrinth-maze.js', workerHost, 1, target, JSON.stringify(scope), Date.now(), 0);
  if (!pid) throw new Error('failed to start darknet-maze.js');
  const manager = ns.ps('home').find(p => p.filename === 'darknet-manager.js');
  const file = 'tasks/dnet-maze-leases.json';
  const now = Date.now();
  let existing = [];
  try {
    const old = JSON.parse(ns.read(file));
    if (old.version === 1 && old.nodeReset === scope[0] && old.augReset === scope[1] && now - old.at < 90000 && Array.isArray(old.leases)) existing = old.leases;
  } catch {}
  const leases = existing.filter(l => !(l.host === 'home' && l.pid === pid));
  leases.push({ host: 'home', pid, scope, startedAt: now, managerPid: manager?.pid || 40, active: true, progressAt: now, at: now, expiresAt: now + 120000 });
  await ns.write(file, JSON.stringify({ version: 1, nodeReset: scope[0], augReset: scope[1], at: now, leases }), 'w');
  await ns.write('tasks/dnet-maze-start-debug.json', JSON.stringify({ at: now, target, details: d, scope, pid, manager: manager?.pid || 40 }), 'w');
  ns.tprint(`MAZE_START ${target} pid=${pid} manager=${manager?.pid || 40}`);
}
