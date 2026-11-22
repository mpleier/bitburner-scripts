import * as maze from './debug-maze.js';
/** @param {NS} ns */
export async function main(ns) {
  await ns.write('tasks/dnet-maze-wrapper-debug.json', JSON.stringify({ at: Date.now(), args: ns.args, host: ns.getHostname(), pid: ns.pid }), 'w');
  try {
    await maze.main(ns);
  } catch (error) {
    await ns.write('tasks/dnet-maze-error.json', JSON.stringify({ at: Date.now(), error: String(error), stack: error && error.stack }), 'w');
  }
}
