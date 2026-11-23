/** @param {NS} ns */
export async function main(ns) {
  const info = { max: ns.getServerMaxRam('darkweb'), used: ns.getServerUsedRam('darkweb'), ramScript: ns.getScriptRam('run-labyrinth-maze.js','darkweb'), ps: ns.ps('darkweb') };
  await ns.write('tasks/dw-ram-debug.json', JSON.stringify(info), 'w');
}
