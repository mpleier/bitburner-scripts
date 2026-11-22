/** @param {NS} ns */
export async function main(ns) {
  await ns.write('tasks/dnet-probe-debug.json', JSON.stringify({ at: Date.now(), probe: ns.dnet.probe(), adj: ns.scan().filter((h) => h.includes('l4byr1nth')) }), 'w');
}
