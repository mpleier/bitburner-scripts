/** @param {NS} ns */
export async function main(ns) {
  for (const f of ['tasks/dnet-maze-debug.json','tasks/dnet-maze-error.json','tasks/dnet-maze-wrapper-debug.json']) {
    const raw = ns.read(f, 'darkweb');
    await ns.write('tasks/dw-' + f.split('/').pop(), raw || 'NULL', 'w');
  }
}
