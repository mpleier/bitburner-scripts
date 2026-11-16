import {formatMoney, formatNumberShort, parseShortNumber} from './helpers.js';

/**
 * Buy every affordable Hacknet node and upgrade, in cost order.
 *
 * Usage:
 *   run buy-all-hacknet.js
 *   run buy-all-hacknet.js --reserve 1b --max-spend 50b
 *   run buy-all-hacknet.js --dry-run
 *
 * Hash-capacity upgrades cost hashes, not money, and are intentionally excluded.
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const dryRun = ns.args.includes('--dry-run');
  const readArg = name => {
    const prefix = name + '=';
    const direct = ns.args.find(arg => typeof arg === 'string' && arg.startsWith(prefix));
    if (direct) return direct.slice(prefix.length);
    const index = ns.args.indexOf('--' + name);
    const next = index >= 0 ? ns.args[index + 1] : null;
    return typeof next === 'string' && !next.startsWith('--') ? next : null;
  };
  const parse = (value, fallback) => {
    if (value == null || value === '') return fallback;
    const parsed = parseShortNumber(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const reserve = parse(readArg('reserve'), Number(ns.read('reserve.txt')) || 0);
  const cap = parse(readArg('max-spend'), Infinity);
  if (reserve === null || cap === null) {
    ns.tprint('Hacknet purchase: reserve/max-spend must be finite, non-negative numbers.');
    return;
  }

  const money = () => ns.getPlayer().money;
  const available = () => Math.max(0, Math.min(money() - reserve, cap - spent));
  let spent = 0, nodes = 0, upgrades = 0, failures = 0;
  const buy = (kind, cost, action) => {
    if (dryRun) { ns.print(`[dry] ${kind} for ${formatNumberShort(cost)}`); return true; }
    const ok = action();
    if (!ok) { failures++; return false; }
    spent += cost;
    if (kind === 'node') nodes++; else upgrades++;
    ns.print(`Purchased ${kind} for ${formatNumberShort(cost)}; total ${formatNumberShort(spent)}.`);
    return true;
  };

  // Nodes first so every purchased node can then receive upgrades.
  while (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
    const cost = ns.hacknet.getPurchaseNodeCost();
    if (!Number.isFinite(cost) || cost <= 0 || cost > available()) break;
    if (dryRun) { spent += cost; nodes++; ns.print(`[dry] node for ${formatNumberShort(cost)}`); }
    else if (buy('node', cost, () => ns.hacknet.purchaseNode() >= 0) === false) break;
    if (failures >= 3) break;
  }

  // Then repeatedly buy the cheapest remaining affordable upgrade.
  for (let pass = 0; pass < 100000; pass++) {
    let best = null;
    for (let i = 0; i < ns.hacknet.numNodes(); i++) {
      const options = [
        ['level', ns.hacknet.getLevelUpgradeCost(i, 1), () => ns.hacknet.upgradeLevel(i, 1)],
        ['ram', ns.hacknet.getRamUpgradeCost(i, 1), () => ns.hacknet.upgradeRam(i, 1)],
        ['core', ns.hacknet.getCoreUpgradeCost(i, 1), () => ns.hacknet.upgradeCore(i, 1)],
      ];
      for (const [kind, cost, action] of options)
        if (Number.isFinite(cost) && cost > 0 && cost <= available() && (!best || cost < best.cost))
          best = {kind, cost, action};
    }
    if (!best || failures >= 3) break;
    if (dryRun) { spent += best.cost; upgrades++; ns.print(`[dry] ${best.kind} for ${formatNumberShort(best.cost)}`); }
    else if (!buy(best.kind, best.cost, best.action)) {
      if (failures >= 3) break;
    }
  }

  ns.tprint(`Hacknet purchases${dryRun ? ' (dry run)' : ''}: ${nodes} node(s), ${upgrades} upgrade(s), ${formatMoney(spent, 3, 2)} spent; reserve ${formatMoney(reserve, 3, 2)}.`);
}

