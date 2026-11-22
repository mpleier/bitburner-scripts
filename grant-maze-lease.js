/** @param {NS} ns */
export async function main(ns) {
  const pid = Number(ns.args[0]);
  const target = ns.args[1] || 'th3_l4byr1nth';
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('usage: run grant-maze-lease.js <navigator-pid> [target]');
  const ctx = JSON.parse(ns.read('tasks/dnet-cache-context.json'));
  const details = ns.dnet.getServerDetails(target);
  const scope = [ctx.nodeReset, ctx.augReset, target, details.passwordLength, details.passwordFormat, details.data];
  const manager = ns.ps('home').find(p => p.filename === 'darknet-manager.js');
  const file = 'tasks/dnet-maze-leases.json';
  const now = Date.now();
  let leases = [];
  try {
    const old = JSON.parse(ns.read(file));
    if (old.version === 1 && old.nodeReset === scope[0] && old.augReset === scope[1] && now - old.at < 90000 && Array.isArray(old.leases)) leases = old.leases;
  } catch {}
  leases = leases.filter(l => !(l.host === 'home' && l.pid === pid));
  leases.push({ host: 'home', pid, scope, startedAt: now, managerPid: manager?.pid || 40, active: true, progressAt: now, at: now, expiresAt: now + 90000 });
  await ns.write(file, JSON.stringify({ version: 1, nodeReset: scope[0], augReset: scope[1], at: now, leases }), 'w');
  ns.tprint(`MAZE_LEASE ${target} pid=${pid} manager=${manager?.pid || 40}`);
}
