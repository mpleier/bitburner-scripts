/** Temporarily stop darkweb workers so RAM-heavy Dark Net maintenance can run here. */
export async function main(ns) {
  ns.disableLog('ALL');
  const host = ns.getHostname();
  const killed = [];
  for (const p of ns.ps(host)) {
    if (p.filename === ns.getScriptName()) continue;
    killed.push({ filename: p.filename, args: p.args || [], threads: p.threads, pid: p.pid });
    ns.kill(p.pid);
  }
  await ns.write('tasks/dw-killed-procs.json', JSON.stringify({ at: Date.now(), host, killed }), 'w');
  await ns.scp('tasks/dw-killed-procs.json', 'home', host);
  ns.tprint('DW_FREE_RAM killed=' + killed.length);
}
