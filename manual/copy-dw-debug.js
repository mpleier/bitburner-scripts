/** Copy the labyrinth debug files off the Darkweb server (ns.read cannot name a source host). */
/** @param {NS} ns */
export async function main(ns) {
  const source = 'darkweb';
  for (const f of ['tasks/dnet-maze-debug.json','tasks/dnet-maze-error.json','tasks/dnet-maze-wrapper-debug.json']) {
    const local = 'tasks/dw-' + f.split('/').pop();
    let raw = '';
    if (ns.getHostname() === source) raw = ns.read(f);
    else {
      try { if (await ns.scp(f, ns.getHostname(), source)) raw = ns.read(f); } catch { /* Darkweb unreachable from here. */ }
    }
    await ns.write(local, raw || 'NULL', 'w');
  }
}
