import {graftResetBlocked} from './progression-improvements-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import { claimSpending } from './spending-policy.js';
import { isScriptPaused } from './automation-control.js';
import { activityBusy, markActivitySupport } from './activity-coordination.js';
import { transitionActive, transitionFile } from './progression-coordination.js';
import { graftEconomics } from './automation-policy.js';

/** Choose useful, affordable grafts; do not interrupt grafting or program creation. */
export function graftTick(ns, fraction = 0.25, maxPayback = 4 * 3600_000) {
  if(maintenanceRequested(ns))return {status:'maintenance'};
  if (activityBusy(ns)) return { status: 'busy' };
  const reset = ns.getResetInfo();
  const sf = number => Number(typeof reset.ownedSF?.get === 'function' ? reset.ownedSF.get(number) : reset.ownedSF?.[number]) || 0;
  if ((reset.currentNode !== 10 && !sf(10)) || (reset.currentNode !== 4 && !sf(4))) return { status: 'unavailable' };
  let transition;
  try { transition = JSON.parse(ns.read(transitionFile)); } catch { }
  if (transitionActive(transition, ns.ps('home'))) return { status: 'busy' };
  const work = ns.singularity.getCurrentWork();
  if (['GRAFTING', 'CREATE_PROGRAM'].includes(work?.type)) return { status: 'busy' };
  try {
    if (ns.bladeburner.inBladeburner() && /black/i.test(ns.bladeburner.getCurrentAction()?.type || '')) return { status: 'busy' };
  } catch { /* Bladeburner may not be unlocked. */ }
  const player = ns.getPlayer();
  const reserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
  const travel = player.city === 'New Tokyo' ? 0 : 200_000;
  const budget = Math.max(0, player.money - reserve - travel) * (Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0);
  const installedList = ns.singularity.getOwnedAugmentations(false);
  const ownedList = ns.singularity.getOwnedAugmentations(true);
  const installed = new Set(installedList);
  const owned = new Set(ownedList);
  let plan;
  try { plan = JSON.parse(ns.read('tasks/augmentation-reset-plan.json')); } catch { }
  if (graftResetBlocked(plan,reset,ns.ps('home'))) return { status: 'reset-pending' };
  let hackingIncome = 0, rates = {};
  try {
    hackingIncome = Math.max(0, Number(ns.getTotalScriptIncome()[0]) || 0);
    const elapsed = Math.max(60, (Date.now() - reset.lastAugReset) / 1000);
    const sources = ns.getMoneySources().sinceInstall;
    rates = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, Math.max(0, Number(value) || 0) / elapsed]));
  } catch { /* Missing income evidence means no speculative graft purchases. */ }
  const candidates = [];
  for (const name of ns.grafting.getGraftableAugmentations()) {
    if (owned.has(name) || !ns.singularity.getAugmentationPrereq(name).every(required => installed.has(required))) continue;
    const cost = ns.grafting.getAugmentationGraftPrice(name);
    const duration = ns.grafting.getAugmentationGraftTime(name);
    if (!(cost > 0) || cost > budget || !(duration > 0)) continue;
    const economics = graftEconomics({ stats: ns.singularity.getAugmentationStats(name), cost, duration,
      entropy: player.entropy, immune: installed.has('Congruity Implant'), congruity: name === 'Congruity Implant',
      focusImmune: installed.has('Neuroreceptor Management Implant'), hackingIncome, rates, maxPayback });
    if (!economics.eligible) continue;
    candidates.push({ name, cost, ...economics });
  }
  const choice = candidates.sort((a, b) => a.payback - b.payback || b.benefit - a.benefit || a.cost - b.cost)[0];
  if (!choice) return { status: 'waiting' };
  try{plan=JSON.parse(ns.read('tasks/augmentation-reset-plan.json'));}catch{plan=null;}
  if(graftResetBlocked(plan,ns.getResetInfo(),ns.ps('home')))return {status:'reset-pending'};
  if(!claimSpending(ns,'graft',choice.cost+travel))return {status:'waiting-for-budget'};
  if (player.city !== 'New Tokyo' && !ns.singularity.travelToCity('New Tokyo')) return { status: 'travel-failed' };
  // Recheck work after travel to avoid replacing a graft started by another script.
  if (activityBusy(ns) || ns.singularity.getCurrentWork()?.type === 'GRAFTING') return { status: 'busy' };
  try{plan=JSON.parse(ns.read('tasks/augmentation-reset-plan.json'));}catch{plan=null;}
  if(isScriptPaused(ns,'grafting-manager.js')||maintenanceRequested(ns)||graftResetBlocked(plan,ns.getResetInfo(),ns.ps('home')))return {status:'reset-pending'};
  if (ns.getPlayer().money < choice.cost + reserve) return { status: 'waiting' };
  return { status: ns.grafting.graftAugmentation(choice.name, false) ? 'started' : 'rejected', ...choice };
}

export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
  await markActivitySupport(ns);
  ns.disableLog('ALL');
  const options = ns.flags([['budget-fraction', 0.25], ['max-payback-hours', 4]]);
  const maxPayback = Number(options['max-payback-hours']) * 3600_000;
  if (!(maxPayback > 0) || !Number.isFinite(maxPayback)) { ns.print('max-payback-hours must be a positive finite number.'); return; }
  if (ns.ps('home').some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
    try {
      const result = graftTick(ns, Number(options['budget-fraction']), maxPayback);
      await ns.write('tasks/grafting-status.json', JSON.stringify({ at: Date.now(), pid: ns.pid, maxPaybackHours: maxPayback / 3600_000, ...result }), 'w');
      if (result.status === 'unavailable') { ns.print('Grafting requires Grafting and Singularity access.'); return; }
      if (result.status === 'started') ns.print(`Grafting ${result.name}: estimated repayment ${(result.payback / 3600_000).toFixed(2)}h including graft time and lost cash income.`);
    } catch (error) { ns.print(`Grafting waiting: ${String(error)}`); }
    await ns.sleep(60_000);
  }
}
