import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import { getNsDataThroughFile, getActiveSourceFiles } from './helpers.js';
import { isScriptPaused } from './automation-control.js';
import { activityBusy, activityGuard } from './activity-coordination.js';
import { transitionActive, transitionFile } from './progression-coordination.js';

export function needsHealing(player, threshold = 0.9) {
  return player.hp?.max > 0 && player.hp.current < player.hp.max * threshold;
}
/** Recover health with available cash, preserving grafts and UI activity. */
export async function main(ns) {
 registerAutomation(ns);
  ns.disableLog('ALL');
  if (isScriptPaused(ns, ns.getScriptName())) return;
  const access = await getActiveSourceFiles(ns);
  if (!access[4]) { ns.print('Health recovery requires Singularity access.'); return; }
  if (ns.ps('home').some(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)) return;
  while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
    try {
      let transition;
      try { transition = JSON.parse(ns.read(transitionFile)); } catch { }
      if (!activityBusy(ns) && !transitionActive(transition, ns.ps('home')) && needsHealing(ns.getPlayer())) {
        const healed = await getNsDataThroughFile(ns,
          `(() => { const p=ns.getPlayer(), w=ns.singularity.getCurrentWork(); const reserve=Math.max(0,Number(ns.read("reserve.txt"))||0); const cost=Math.min(Math.max(0,p.money)*.1, (p.hp.max-p.hp.current)*100000); if(${activityGuard} || w?.type==="GRAFTING" || p.hp.current>=p.hp.max*.9 || (cost > 0 && p.money-reserve < cost)) return false; ns.singularity.hospitalize(); return ns.getPlayer().hp.current===ns.getPlayer().hp.max; })()`,
          '/Temp/health-recovery.txt');
        if (healed) ns.print('Recovered health at the hospital.');
      }
    } catch (error) { ns.print(`Health recovery waiting: ${String(error)}`); }
    await ns.sleep(5000);
  }
}
