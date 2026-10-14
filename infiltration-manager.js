import { getNsDataThroughFile, getActiveSourceFiles } from './helpers.js';
import { isScriptPaused } from './automation-control.js';
import { activityBusy, claimActivity, releaseActivity } from './activity-coordination.js';
import { transitionActive, transitionFile } from './progression-coordination.js';
import { infiltrationInput, chooseInfiltration, findInfiltrationState, selectRewardFaction } from './infiltration-solvers.js';

export const infiltrationStatusFile = 'tasks/infiltration-status.json';
function transitionBusy(ns) {
  let record;
  try { record = JSON.parse(ns.read(transitionFile)); } catch { }
  return transitionActive(record, ns.ps('home'));
}
function button(document, pattern) {
  return [...document.querySelectorAll('button')].find(node => !node.disabled && pattern.test(node.textContent.trim()));
}
/** Runs the actual puzzle handlers. No synthetic keyboard events or fabricated success. */
export async function playInfiltration(ns, document, state, faction = null) {
  let lastLease = 0, emptyStageSince = 0, lastStage;
  const startedAt = Date.now();
  while (findInfiltrationState(document) === state) {
    if (transitionBusy(ns) || Date.now() - startedAt > 10 * 60_000) {
      state.cancel(); return { status: 'interrupted' };
    }
    if (Date.now() - lastLease > 3000) {
      if (!(await claimActivity(ns, 'infiltration'))) { state.cancel(); return { status: 'interrupted' }; }
      lastLease = Date.now();
    }
    if (String(state.results).includes('✗')) { state.cancel(); return { status: 'failed' }; }
    const stage = state.stage;
    if (stage !== lastStage) { lastStage = stage; emptyStageSince = Date.now(); }
    const victory = button(document, /^Sell for\b/i);
    if (victory && /Infiltration successful!/i.test(document.body.textContent)) {
      if (faction && selectRewardFaction(document, faction)) await ns.sleep(100);
      const trade = faction && button(document, /^Trade for\b/i);
      (trade || victory).click();
      await ns.sleep(150);
      if (findInfiltrationState(document) === state) throw new Error('Reward selection did not leave the infiltration');
      return { status: 'completed', reward: trade ? 'reputation' : 'money' };
    }
    const start = button(document, /^Start$/i);
    if (start && state.gameStartTimestamp < 0) {
      const demand = document.body.textContent.match(/Market demand:\s*([\d.,]+)%/i);
      if (demand && Number(demand[1].replaceAll(',', '')) < 65) {
        state.cancel(); return { status: 'market-cooldown' };
      }
      start.click(); await ns.sleep(30); continue;
    }
    const input = infiltrationInput(stage);
    if (input.unsupported || (!input.wait && typeof input.key !== 'string')) {
      // Intro and victory are empty models; allow React to render their buttons.
      if (Object.keys(stage).length === 0 && Date.now() - emptyStageSince < 2000) {
        await ns.sleep(20); continue;
      }
      state.cancel(); return { status: 'unsupported-ui', stage: stage.constructor?.name };
    }
    if (input.key && state.stage === stage) stage.onKey({ key: input.key, altKey: false, ctrlKey: false,
      metaKey: false, shiftKey: false, preventDefault() {} });
    await ns.sleep(20);
  }
  return { status: 'cancelled' };
}

export async function main(ns) {
  ns.disableLog('ALL');
  const options = ns.flags([['interval', 60000], ['max-difficulty', 1.5], ['money-only', false]]);
  if (isScriptPaused(ns, ns.getScriptName())) return;
  if (ns.ps('home').some(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)) return;
  const sourceFiles = await getActiveSourceFiles(ns);
  if (!sourceFiles[4]) { ns.print('Automatic infiltration entry requires Singularity access.'); return; }
  const document = globalThis['document'];
  if (!document) { ns.print('Infiltration UI is unavailable.'); return; }
  let active = null;
  ns.atExit(() => { try { active?.cancel(); } finally { releaseActivity(ns); } });
  while (true) {
    let result = { status: 'waiting' }, previousWorker, enteredUi = false;
    try {
      if (activityBusy(ns) || transitionBusy(ns) || findInfiltrationState(document)) continue;
      const work = await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()', '/Temp/infiltration-work.txt');
      if (['GRAFTING', 'CREATE_PROGRAM'].includes(work?.type)) continue;
      const blackOp = sourceFiles[7] && await getNsDataThroughFile(ns,
        'ns.bladeburner.inBladeburner() && /black/i.test(ns.bladeburner.getCurrentAction()?.type || "")', '/Temp/infiltration-blackop.txt');
      if (blackOp || ns.getPlayer().hp.current < ns.getPlayer().hp.max * 0.9) continue;
      const locations = ns.infiltration.getPossibleLocations().map(location => ns.infiltration.getInfiltration(location.name));
      const target = chooseInfiltration(locations, ns.getPlayer().city, Number(options['max-difficulty']));
      if (!target || !(await claimActivity(ns, 'infiltration'))) continue;
      previousWorker = ns.ps('home').find(p => /(^|\/)work-for-factions\.js$/.test(p.filename));
      if (previousWorker) ns.kill(previousWorker.pid);
      await ns.sleep(500);
      const entered = await getNsDataThroughFile(ns,
        '(() => { if(["GRAFTING","CREATE_PROGRAM"].includes(ns.singularity.getCurrentWork()?.type)) return false; ns.singularity.stopAction(); const p=ns.getPlayer(); if(p.city!==ns.args[0] && (p.money<200000 + Math.max(0,Number(ns.read("reserve.txt"))||0) || !ns.singularity.travelToCity(ns.args[0]))) return false; return ns.singularity.goToLocation(ns.args[1]); })()',
        '/Temp/infiltration-enter.txt', [target.location.city, target.location.name]);
      if (!entered) continue;
      if (sourceFiles[7]) await getNsDataThroughFile(ns,
        'ns.bladeburner.inBladeburner() ? ns.bladeburner.stopBladeburnerAction() : false', '/Temp/infiltration-stop-combat.txt');
      await ns.sleep(150);
      const enter = button(document, /infiltrate/i);
      if (!enter) { result = { status: 'entry-ui-unavailable' }; continue; }
      enter.click(); enteredUi = true;
      for (let retry = 0; retry < 30 && !active; retry++) { await ns.sleep(50); active = findInfiltrationState(document); }
      if (!active) { result = { status: 'unsupported-ui' }; continue; }
      result = await playInfiltration(ns, document, active, !options['money-only'] && work?.type === 'FACTION' ? work.factionName : null);
      result.location = target.location.name;
    } catch (error) { result = { status: 'waiting', error: String(error) }; }
    finally {
      try {
        if (active) active.cancel();
        else if (enteredUi) button(document, /^Cancel(?: Infiltration)?$/i)?.click();
      } catch { }
      active = null;
      releaseActivity(ns);
      if (previousWorker && !transitionBusy(ns) && !isScriptPaused(ns, previousWorker.filename) &&
          !ns.ps('home').some(p => p.filename === previousWorker.filename))
        ns.run(previousWorker.filename, 1, ...previousWorker.args);
      await ns.write(infiltrationStatusFile, JSON.stringify({ at: Date.now(), pid: ns.pid, ...result }), 'w');
      ns.print(`Infiltration: ${result.status}${result.location ? ' at ' + result.location : ''}${result.error ? ': ' + result.error : ''}`);
      await ns.sleep(Math.max(1000, Number(options.interval) || 60000));
    }
  }
}
