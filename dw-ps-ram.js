/** @param {NS} ns */
export async function main(ns) {
  const ps = ns.ps('darkweb').map((p) => ({ ...p, ram: ns.getScriptRam(p.filename, 'darkweb') }));
  await ns.write('tasks/dw-ps-ram.json', JSON.stringify({ at: Date.now(), max: ns.getServerMaxRam('darkweb'), used: ns.getServerUsedRam('darkweb'), ps }), 'w');
}
