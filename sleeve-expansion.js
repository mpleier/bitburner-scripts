import { isScriptPaused } from './automation-control.js';
/** Buys sleeves and raises memory in BN10, without changing sleeve tasks. */
export function expandSleeves(ns, fraction = 0.1) {
  if (ns.getResetInfo().currentNode !== 10) return { available: false, bought: 0, upgraded: 0 };
  const reserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
  let remaining = Math.max(0, ns.getPlayer().money - reserve) * Math.max(0, Math.min(1, fraction));
  let bought = 0, upgraded = 0;
  const affordable = cost => Number.isFinite(cost) && cost > 0 && cost <= remaining && ns.getPlayer().money >= cost + reserve;
  if (ns.sleeve.getNumSleeves() < 8) {
    const cost = ns.sleeve.getSleeveCost();
    if (affordable(cost)) {
      const before = ns.sleeve.getNumSleeves();
      ns.sleeve.purchaseSleeve();
      if (ns.sleeve.getNumSleeves() > before) { remaining -= cost; bought++; }
    }
  }
  const candidates = [];
  for (let index = 0; index < ns.sleeve.getNumSleeves(); index++) {
    const memory = ns.sleeve.getSleeve(index).memory;
    if (!Number.isFinite(memory) || memory >= 100) continue;
    const amount = Math.min(10, 100 - memory);
    candidates.push({ index, amount, cost: ns.sleeve.getMemoryUpgradeCost(index, amount), memory });
  }
  for (const item of candidates.sort((a, b) => a.cost - b.cost)) {
    if (!affordable(item.cost)) continue;
    ns.sleeve.upgradeMemory(item.index, item.amount);
    if (ns.sleeve.getSleeve(item.index).memory > item.memory) { remaining -= item.cost; upgraded++; }
  }
  return { available: true, bought, upgraded };
}

export async function main(ns) {
    if (isScriptPaused(ns, ns.getScriptName())) return;
  ns.disableLog('ALL');
  if (ns.ps('home').some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  if (ns.getResetInfo().currentNode !== 10) return;
  while (true) {
    try {
      const result = expandSleeves(ns);
      if (result.bought || result.upgraded) ns.print(`Sleeves: ${result.bought} purchased, ${result.upgraded} memory upgrades.`);
    } catch (error) { ns.print(`Sleeve expansion waiting: ${String(error)}`); }
    await ns.sleep(60_000);
  }
}
