export async function main(ns) {
  const out = [];
  for (const h of ['dark-citadel','granny-s::industries','iker_molina_casino.systems','cellgenesis','nitesec']) {
    let d = null;
    try { d = ns.dnet.getServerDetails(h); } catch (e) { out.push([h,'details',String(e)]); continue; }
    const ram = ns.getScriptRam('dw-probe-neighbours.js', h);
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h);
    let pids = [];
    try { pids = ns.ps(h).map(p=>p.filename+':'+p.threads); } catch (e) { pids=[String(e)]; }
    let pid = 0;
    try { pid = ns.exec('dw-probe-neighbours.js', h, 1, 'ub3r_l4byr1nth'); } catch (e) { out.push([h,'execerr',String(e)]); }
    out.push({host:h, ram, free, root:ns.hasRootAccess(h), session:d.hasSession, online:d.isOnline, pid, procs:pids});
  }
  await ns.write('tasks/dw-exectest.json', JSON.stringify(out), 'w');
  try { await ns.scp('tasks/dw-exectest.json','home','darkweb'); } catch(e) { }
}
