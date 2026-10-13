import { graftScore } from './automation-policy.js';

/** Choose useful, affordable grafts; do not interrupt grafting or program creation. */
export function graftTick(ns, fraction = 0.25) {
  const reset = ns.getResetInfo();
  const sf = number => Number(typeof reset.ownedSF?.get === 'function' ? reset.ownedSF.get(number) : reset.ownedSF?.[number]) || 0;
  if ((reset.currentNode !== 10 && !sf(10)) || (reset.currentNode !== 4 && !sf(4))) return { status: 'unavailable' };
  const work = ns.singularity.getCurrentWork();
  if (['GRAFTING', 'CREATE_PROGRAM'].includes(work?.type)) return { status: 'busy' };
  try {
    if (ns.bladeburner.inBladeburner() && /black/i.test(ns.bladeburner.getCurrentAction()?.type || '')) return { status: 'busy' };
  } catch { /* Bladeburner may not be unlocked. */ }
  const player = ns.getPlayer();
  const reserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
  const travel = player.city === 'New Tokyo' ? 0 : 200_000;
  const budget = Math.max(0, player.money - reserve - travel) * Math.max(0, Math.min(1, fraction));
  const installed = new Set(ns.singularity.getOwnedAugmentations(false));
  const owned = new Set(ns.singularity.getOwnedAugmentations(true));
  const candidates = [];
  for (const name of ns.grafting.getGraftableAugmentations()) {
    if (owned.has(name) || !ns.singularity.getAugmentationPrereq(name).every(required => installed.has(required))) continue;
    const cost = ns.grafting.getAugmentationGraftPrice(name);
    const duration = ns.grafting.getAugmentationGraftTime(name);
    if (!(cost > 0) || cost > budget || !(duration > 0)) continue;
    const benefit = name === 'Congruity Implant' ? 1000 : graftScore(ns.singularity.getAugmentationStats(name));
    // Grafting adds entropy. Skip weak upgrades whose benefit does not justify it.
    if (benefit < 0.3) continue;
    candidates.push({ name, cost, score: benefit / duration });
  }
  const choice = candidates.sort((a, b) => b.score - a.score || a.cost - b.cost)[0];
  if (!choice) return { status: 'waiting' };
  if (player.city !== 'New Tokyo' && !ns.singularity.travelToCity('New Tokyo')) return { status: 'travel-failed' };
  // Recheck work after travel to avoid replacing a graft started by another script.
  if (ns.singularity.getCurrentWork()?.type === 'GRAFTING') return { status: 'busy' };
  if (ns.getPlayer().money < choice.cost + reserve) return { status: 'waiting' };
  return { status: ns.grafting.graftAugmentation(choice.name, false) ? 'started' : 'rejected', name: choice.name };
}

export async function main(ns) {
  ns.disableLog('ALL');
  if (ns.ps('home').some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  while (true) {
    try {
      const result = graftTick(ns);
      if (result.status === 'unavailable') { ns.print('Grafting requires Grafting and Singularity access.'); return; }
      if (result.status === 'started') ns.print(`Grafting ${result.name}; other work will wait until it completes.`);
    } catch (error) { ns.print(`Grafting waiting: ${String(error)}`); }
    await ns.sleep(60_000);
  }
}
