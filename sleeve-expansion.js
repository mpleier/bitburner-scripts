import { achievementActionAllowed } from './achievement-policy.js';
import { registerAutomation, automationHeartbeat, maintenanceRequested } from './runtime-policy.js';
import { claimSpending } from './spending-policy.js';
import { isScriptPaused } from './automation-control.js';
import { maximumSleeves } from './sleeve-policy.js';
/** Buys sleeves and raises memory in BN10, without changing sleeve tasks. */
export function expandSleeves(ns, fraction = 1) {
  const reset = ns.getResetInfo();
  if (reset.currentNode !== 10) return { available: false, bought: 0, upgraded: 0 };
  if(isScriptPaused(ns,'sleeve-expansion.js')||maintenanceRequested(ns)||!achievementActionAllowed(ns,'sleeve'))return {available:false,bought:0,upgraded:0};

  const reserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
  let remaining = Math.max(0, ns.getPlayer().money - reserve) * (Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0);
  let bought = 0, upgraded = 0;
  const affordable = cost => Number.isFinite(cost) && cost > 0 && cost <= remaining && ns.getPlayer().money >= cost + reserve;
  if (ns.sleeve.getNumSleeves() < maximumSleeves(reset)) {
    const cost = ns.sleeve.getSleeveCost();
    if (affordable(cost)&&claimSpending(ns,"sleeveExpansion",cost)) {
      const before = ns.sleeve.getNumSleeves();
      ns.sleeve.purchaseSleeve();
      if (ns.sleeve.getNumSleeves() > before) { remaining -= cost; bought++; }
    }
  }
  const candidates = [];
  for (let index = 0; index < ns.sleeve.getNumSleeves(); index++) {
    const memory = ns.sleeve.getSleeve(index).memory;
    if (!Number.isFinite(memory) || memory >= 100) continue;
    let amount = Math.min(10, 100 - memory);
    while (amount > 1 && ns.sleeve.getMemoryUpgradeCost(index, amount) > remaining) amount--;
    candidates.push({ index, amount, cost: ns.sleeve.getMemoryUpgradeCost(index, amount), memory });
  }
  for (const item of candidates.sort((a, b) => a.cost - b.cost)) {
    while (item.amount > 1 && item.cost > remaining) {
      item.amount--;
      item.cost = ns.sleeve.getMemoryUpgradeCost(item.index, item.amount);
    }
    if (!affordable(item.cost)||!claimSpending(ns,"sleeveExpansion",item.cost)) continue;
    ns.sleeve.upgradeMemory(item.index, item.amount);
    if (ns.sleeve.getSleeve(item.index).memory > item.memory) { remaining -= item.cost; upgraded++; }
  }
  return { available: true, bought, upgraded };
}

export async function main(ns) {
    if (isScriptPaused(ns, ns.getScriptName())) return;
  ns.disableLog('ALL');
  const options = ns.flags([['budget-fraction', 1]]);
  const fraction=Number(options['budget-fraction']);
  if(!Number.isFinite(fraction)||fraction<0||fraction>1)return ns.tprint('Sleeve expansion: budget-fraction must be between 0 and 1.');
  if (ns.ps('home').some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  if (ns.getResetInfo().currentNode !== 10) return;
  registerAutomation(ns);
  while (!isScriptPaused(ns,ns.getScriptName())) {
    automationHeartbeat(ns);
    try {
      const result = expandSleeves(ns, Number(options['budget-fraction']));
      if (result.bought || result.upgraded) ns.print(`Sleeves: ${result.bought} purchased, ${result.upgraded} memory upgrades.`);
    } catch (error) { ns.print(`Sleeve expansion waiting: ${String(error)}`); }
    await ns.sleep(60_000);
  }
}
