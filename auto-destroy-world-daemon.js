/**
 * Complete the current BitNode as soon as either completion route is available:
 *   - w0r1d_d43m0n is hackable/rooted
 *   - Bladeburner's Operation Daedalus is complete
 *
 * The daemon runs this periodically. It roots the World Daemon when needed,
 * then destroys the BitNode and restarts daemon.js in the next node.
 */
const target = 'w0r1d_d43m0n';
/** Last printed completion blocker, so the 29 s check logs a state change instead of repeating itself. */
let lastBlocker = '';

import { writeSleeveMemoryPriority, clearSleeveMemoryPriority } from './sleeve-memory-priority-policy.js';

function nextBitNode(ns) {
  try {
    const plan = JSON.parse(ns.read('tasks/bitnode-priority.json'));
    if (Number.isInteger(plan?.nextBn) && plan.nextBn >= 1 && plan.nextBn <= 15) return plan.nextBn;
  } catch { }
  const current = ns.getResetInfo().currentNode;
  return current >= 1 && current < 15 ? current + 1 : 1;
}

function bladeburnerComplete(ns) {
  try {
    if (typeof ns.bladeburner?.inBladeburner !== 'function' || !ns.bladeburner.inBladeburner()) return false;
    const names = ns.bladeburner.getBlackOpNames();
    if (!Array.isArray(names) || !names.includes('Operation Daedalus')) return false;
    return ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0;
  } catch {
    return false;
  }
}

/** BN10 memory is permanent only for that node and is lost when leaving it. */
export function sleeveMemoryReady(ns) {
  const reset = ns.getResetInfo();
  if (reset.currentNode !== 10) return true;
  try {
    const count = ns.sleeve.getNumSleeves();
    if (!Number.isInteger(count) || count < 1) return false;
    for (let i = 0; i < count; i++) {
      const memory = Number(ns.sleeve.getSleeve(i)?.memory);
      if (!Number.isFinite(memory) || memory < 100) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sleeveMemorySummary(ns) {
  try {
    const count = ns.sleeve.getNumSleeves(), rows = [];
    for (let i = 0; i < count; i++) rows.push(`${i}:${Number(ns.sleeve.getSleeve(i)?.memory) || 0}/100`);
    return rows.join(', ');
  } catch {
    return 'unavailable';
  }
}

function sleeveMemoryList(ns) {
  try {
    const count = ns.sleeve.getNumSleeves(), rows = [];
    for (let i = 0; i < count; i++) rows.push(Number(ns.sleeve.getSleeve(i)?.memory) || 0);
    return rows;
  } catch {
    return [];
  }
}

/**
 * Why the completion gate is closed, in one line. The World Daemon server does not exist until
 * The Red Pill is INSTALLED (bitburner-src src/Server/ServerHelpers.ts: `Player.hasAugmentation(
 * AugmentationName.TheRedPill, true) || baseServer.hostname !== SpecialServers.WorldDaemon`), so
 * "daemon missing" always means the Red Pill is not installed yet, not that the network is misread.
 */
function completionBlocker(ns, {daemonExists, hackingLevel}) {
  if (daemonExists) {
    const needs = ns.getServerRequiredHackingLevel(target);
    return `waiting on hacking ${Math.floor(hackingLevel).toLocaleString('en')} of ${needs.toLocaleString('en')} required to hack the World Daemon`;
  }
  let rep = null, req = null;
  try {
    rep = ns.singularity.getFactionRep('Daedalus');
    req = ns.singularity.getAugmentationRepReq('The Red Pill');
  } catch { /* singularity unavailable: fall through to the generic line */ }
  const repPart = Number.isFinite(rep) && Number.isFinite(req)
    ? `Daedalus reputation ${Math.floor(rep).toLocaleString('en')} of ${req.toLocaleString('en')}`
    : 'Daedalus reputation unknown';
  return `The Red Pill is not installed, so w0r1d_d43m0n does not exist yet (${repPart}; Bladeburner Operation Daedalus also incomplete)`;
}

export async function main(ns) {
  ns.disableLog('ALL');
  if (typeof ns.singularity?.destroyW0r1dD43m0n !== 'function') return;

  const reset = ns.getResetInfo();
  const daemonExists = ns.serverExists(target);
  const hackingLevel = ns.getHackingLevel();
  const daemonHackable = daemonExists && hackingLevel >= ns.getServerRequiredHackingLevel(target);
  const bladeburner = bladeburnerComplete(ns);
  if (!daemonHackable && !bladeburner) {
    // Print once per distinct blocker instead of returning silently forever: a BitNode that never
    // finishes looks identical to a broken script unless the gate names itself.
    const blocker = completionBlocker(ns, {daemonExists, hackingLevel});
    if (blocker !== lastBlocker) { lastBlocker = blocker; ns.print(`BitNode ${reset.currentNode} not finishable yet: ${blocker}.`); }
    await clearSleeveMemoryPriority(ns);
    return;
  }
  lastBlocker = '';


  if (daemonHackable && !ns.hasRootAccess(target)) {
    if (!ns.isRunning('/Tasks/crack-host.js', 'home', target)) {
      const pid = ns.run('/Tasks/crack-host.js', 1, target);
      if (!pid) return;
      for (let i = 0; i < 100 && ns.isRunning(pid); i++) await ns.sleep(100);
    }
    if (!ns.hasRootAccess(target) && !bladeburner) {
      await clearSleeveMemoryPriority(ns);
      return;
    }
  }

  if (!sleeveMemoryReady(ns)) {
    await writeSleeveMemoryPriority(ns, reset, sleeveMemoryList(ns));
    ns.print(`BN10 completion held: sleeve memory is not 100/100 (${sleeveMemorySummary(ns)}).`);
    return;
  }
  await clearSleeveMemoryPriority(ns);

  const next = nextBitNode(ns);
  ns.print(`${bladeburner && !daemonHackable ? 'Bladeburner' : 'World Daemon'} completion ready; destroying BitNode and entering BN${next}.`);
  await ns.singularity.destroyW0r1dD43m0n(next, 'bootstrap-start.js');
}
