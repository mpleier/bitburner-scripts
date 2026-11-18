/**
 * Regression tests for the validation findings on the integrated corporation daemon
 * (card t_d14f9a7b): B2 restart-safe backoff, B4 fresh-save dry run, B5 status keys,
 * B6 single dry-run writer, B10 optimiser logging, B11 peer basenames, B12 profitPerCycle,
 * B13 pause semantics, N1 duplicate office growth, and spec criteria 6 and 8.
 *
 * Every test here fails when its fix is reverted; `tests/corporation-daemon.test.js` keeps the
 * behavioural suite (B1 report-only purity lives there too).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestGame } from './corporation-test-game.mjs';
import {
  DAEMON_DRY_RUN_FILE,
  DAEMON_STATE_FILE,
  DAEMON_STATUS_FILE,
  configArgv,
  defaultDaemonState,
  detectPeerWriters,
  main,
  officesTouched,
  runCorporationCycle,
} from '../corporation-daemon.js';

const DAEMON = 'corporation-daemon.js';
const CYCLE = { script: DAEMON, quiet: true };

function daemonGame(options = {}) {
  return createTestGame({
    wallet: 1e12,
    scriptName: DAEMON,
    processes: [{ filename: DAEMON, pid: 4242 }],
    ...options,
  });
}

async function advance(game, cycles) {
  for (let cycle = 1; cycle <= cycles; cycle++) {
    game.setRevenue(2e6, 1e6);
    if (game.state.corporation) game.state.corporation.funds = Math.max(game.state.corporation.funds, 60e9);
    await runCorporationCycle(game.ns, { ...CYCLE, cyclesManaged: cycle });
  }
  return game;
}

async function advanceWithPeers(game) {
  const peers = game.ns.ps;
  game.ns.ps = () => [{ filename: DAEMON, pid: 4242 }];
  await advance(game, 4);
  game.ns.ps = peers;
}

/** An existing corporation with one staffed materials division, for one-cycle probes. */
function seededGame(options = {}) {
  const game = daemonGame({ existing: true, funds: 60e9, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'], ...options });
  game.state.divisions.Agri = { name: 'Agri', industry: 'Agriculture', cities: ['Sector-12'], products: [], researchPoints: 0, lastCycleRevenue: 0, lastCycleExpenses: 0, numAdVerts: 0 };
  game.state.offices['Agri/Sector-12'] = { city: 'Sector-12', size: 9, numEmployees: 9, avgEnergy: 100, avgMorale: 100 };
  game.state.warehouses['Agri/Sector-12'] = { level: 1, city: 'Sector-12', size: 100, sizeUsed: 10, smartSupplyEnabled: false };
  return game;
}

// ---- N1: one office increment per cycle ---------------------------------------------------
test('one cycle never grows the same office twice (N1)', async () => {
  const game = await advance(daemonGame(), 3);
  const key = Object.keys(game.state.offices).find((entry) => game.state.warehouses[entry]);
  assert.ok(key, 'the fixture has an office with a warehouse');
  // The measured shape: a seed office below `bootstrap.initialOfficeSize` with free cash makes
  // the structural phase grow it and the people module grow it again in the same cycle.
  game.state.offices[key].size = 3;
  game.state.offices[key].numEmployees = 3;
  game.state.corporation.funds = 400e9;
  game.setRevenue(2e6, 1e6);

  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, CYCLE);
  const upgrades = game.mutationsSince(mark).filter((call) => call.operation === 'upgradeOfficeSize');
  const perKey = new Map();
  for (const call of upgrades) {
    const officeKey = `${call.args[0]}/${call.args[1]}`;
    perKey.set(officeKey, (perKey.get(officeKey) || 0) + 1);
  }
  for (const [officeKey, count] of perKey) assert.equal(count, 1, `${officeKey} grew ${count} times in one cycle`);
  assert.ok(report.guards.skipOffice.length > 0, 'the structural phase grew an office this cycle');
  assert.ok(upgrades.length > 0, 'the office still grew once');
});

test('officesTouched reports new and grown offices only', () => {
  const before = { divisions: [{ name: 'Agri', cities: ['Sector-12', 'Aevum'] }], offices: { 'Agri/Sector-12': { size: 3 } } };
  const after = { divisions: [{ name: 'Agri', cities: ['Sector-12', 'Aevum'] }], offices: { 'Agri/Sector-12': { size: 6 }, 'Agri/Aevum': { size: 3 } } };
  assert.deepEqual(officesTouched(before, after).sort(), ['Agri/Aevum', 'Agri/Sector-12']);
  assert.deepEqual(officesTouched(after, after), []);
  assert.deepEqual(officesTouched(null, after).sort(), ['Agri/Aevum', 'Agri/Sector-12']);
});

// ---- B2: restart-safe crash backoff ------------------------------------------------------
test('the crash streak is persisted by a crash and restored after a restart (B2)', async () => {
  async function crashOnce(options = {}) {
    const game = daemonGame({ args: ['--ticks=1'], scriptRam: 40, maxRam: 900, usedRam: 600, ...options });
    // main() reads ns.corporation once before the loop; the cycle's own read is the one that
    // throws, which is exactly the "phase crashed" path the loop must survive.
    let reads = 0;
    Object.defineProperty(game.ns, 'corporation', {
      configurable: true,
      get() {
        reads += 1;
        // Reads 1-2 are main's pre-loop optimiser wiring and a guarded name lookup; from the
        // third on, `runCorporationCycle` reads the API unguarded, which is a cycle crash.
        if (reads >= 3) throw new Error('corporation API unavailable');
        return game.api;
      },
    });
    await main(game.ns);
    return { game, state: JSON.parse(game.files[DAEMON_STATE_FILE]) };
  }

  const first = await crashOnce();
  assert.equal(first.state.crashStreak, 1, 'the crash path writes the streak before it sleeps');
  assert.ok(first.game.calls.sleeps.includes(60000), 'a first crash waits a minute');

  // A restart that finds a persisted streak must continue backing off instead of restarting at 1.
  // The state file is scoped to the reset identity, so the fixture carries the same ids.
  const stale = JSON.stringify({ ...defaultDaemonState(), nodeReset: 1000, augReset: 2000, crashStreak: 5 });
  const second = await crashOnce({ files: { [DAEMON_STATE_FILE]: stale } });
  assert.equal(second.state.crashStreak, 6, 'the persisted streak continues across the restart');
  assert.ok(second.game.calls.sleeps.includes(600000), 'a streak past CRASH_BACKOFF_CYCLES waits ten minutes');
});

// ---- B5: the whole §9.1 key set, and findings as a list ----------------------------------
test('the status document publishes every §9.1 key and a bounded findings list (B5)', async () => {
  const game = await advance(daemonGame(), 4);
  await runCorporationCycle(game.ns, CYCLE);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);

  const required = [
    'nodeReset', 'augReset', 'corporation', 'ownership', 'minOwnership', 'dividendRate',
    'estimatedDividendIncome', 'growthGoal', 'growthDecisions', 'fundingDiagnostics',
    'researchDecisions', 'productMetrics', 'productSlotsPerDivision', 'staffingGoals',
    'offices', 'upgradeDecisions', 'shareActions', 'hashMilestone', 'bootstrap', 'lastActionAt',
  ];
  for (const key of required) assert.ok(key in status, `status document is missing ${key}`);
  assert.equal(status.nodeReset, 1000);
  assert.equal(status.augReset, 2000);
  assert.equal(status.corporation, 'Apex Holdings');
  assert.ok(Array.isArray(status.growthDecisions));
  assert.ok(Array.isArray(status.findings));
  assert.ok(Array.isArray(status.unsupported));
  assert.ok(status.findings.length <= 32);
  assert.ok(Array.isArray(status.offices) && status.offices.length > 0, 'offices are published with size and employees');
  assert.equal(typeof status.offices[0].size, 'number');
  // A key the daemon cannot support is named, not silently zeroed.
  const unsupportedKeys = status.unsupported.map((entry) => entry.key);
  assert.ok(unsupportedKeys.includes('shareActions'));
  assert.ok(unsupportedKeys.includes('hashMilestone'));
});

// ---- B4: a fresh save plans the follow-up, not just "create" ------------------------------
test('a fresh-save dry run plans the next steps after creation (B4)', async () => {
  const game = daemonGame({ wallet: 1e12 });
  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, { ...CYCLE, dryRun: true });
  assert.equal(game.mutationsSince(mark).length, 0);
  assert.equal(report.state, 'NO_CORP');

  const plan = JSON.parse(game.files[DAEMON_DRY_RUN_FILE]);
  assert.ok(plan.wouldDo.length > 1, `a fresh save planned ${plan.wouldDo.length} action(s)`);
  assert.ok(plan.wouldDo.some((action) => /^Create corporation/.test(action.label)));
  assert.ok(plan.wouldDo.some((action) => /after creation/.test(action.detail || '')), 'the follow-up plan is published');
});

// ---- B6: one writer for the dry-run plan --------------------------------------------------
test('exactly one writer publishes the dry-run plan (B6)', async () => {
  const game = await advance(daemonGame(), 4);
  await runCorporationCycle(game.ns, { ...CYCLE, dryRun: true });
  const writers = game.calls.files.filter((entry) => entry.path === DAEMON_DRY_RUN_FILE);
  assert.equal(writers.length, 1, `${writers.length} writes to ${DAEMON_DRY_RUN_FILE}`);
});

// ---- B10: the optimiser logs through the cycle logger -------------------------------------
test('a standalone cycle keeps the optimiser plan lines in the log (B10)', async () => {
  const game = await advance(daemonGame(), 4);
  const report = await runCorporationCycle(game.ns, { ...CYCLE, dryRun: true });
  assert.ok(report.logger.lines.some((line) => line.startsWith('plan:')), `no optimiser line in ${report.logger.lines.length} log lines`);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.ok(status.log.some((line) => line.startsWith('plan:')), 'the status document carries them too');
});

// ---- B12: profitPerCycle uses the market cycle, not a literal 10 ---------------------------
test('profitPerCycle is scaled by secondsPerMarketCycle (B12)', async () => {
  const game = seededGame({ constants: { secondsPerMarketCycle: 20 } });
  game.setRevenue(3e6, 1e6);
  await runCorporationCycle(game.ns, CYCLE);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.profitPerCycle, 2e6 * 20);
});

// ---- B11: peer detection compares basenames ----------------------------------------------
test('peer detection matches a peer by basename in either path form (B11)', () => {
  const ns = {
    getScriptName: () => '/corporation-daemon.js',
    ps: () => [
      { filename: '/corporation-daemon.js', pid: 1 },
      { filename: 'Tasks/corporation-manager.js', pid: 2 },
      { filename: 'Tasks/corporation-daemon.js', pid: 3 },
      { filename: 'hacknet-upgrade-manager.js', pid: 4 },
    ],
  };
  const peers = detectPeerWriters(ns);
  assert.deepEqual(peers.map((peer) => peer.script), ['corporation-manager.js'], 'a subdirectory peer is still a peer, and this daemon is not');
});

// ---- Criterion 6: every state the shipped daemon can publish -----------------------------
test('every documented daemon state is reachable (criterion 6)', async () => {
  const states = {};
  states.NO_CORP = (await runCorporationCycle(daemonGame({ wallet: 0, canCreateSeed: 'UseSeedMoneyOutsideBN3', canCreateSelf: 'UseSeedMoneyOutsideBN3' }).ns, CYCLE)).state;
  states.RUNNING = (await runCorporationCycle(daemonGame().ns, CYCLE)).state;
  states.UNAVAILABLE = (await runCorporationCycle(daemonGame({ disableCorporation: true }).ns, CYCLE)).state;
  const paused = await advance(daemonGame(), 2);
  states.SUSPENDED = (await runCorporationCycle(paused.ns, { ...CYCLE, isAllowed: () => false })).state;
  const peered = daemonGame({ processes: [{ filename: DAEMON, pid: 4242 }, { filename: 'autopilot.js', pid: 7 }] });
  await advanceWithPeers(peered);
  states.REPORT_ONLY = (await runCorporationCycle(peered.ns, CYCLE)).state;
  const idle = seededGame({ files: { 'corporation-config.json': JSON.stringify({ enabled: false }) } });
  states.DISABLED = (await runCorporationCycle(idle.ns, CYCLE)).state;

  // A negative margin against healthy cash is RECOVERY after budgets.recoveryMarginCycles ticks.
  const lossmaking = await advance(daemonGame(), 3);
  let recovery = null;
  for (let cycle = 0; cycle < 12 && recovery !== 'RECOVERY'; cycle++) {
    lossmaking.state.corporation.funds = Math.max(lossmaking.state.corporation.funds, 60e9);
    lossmaking.setRevenue(1e6, 2e6);
    recovery = (await runCorporationCycle(lossmaking.ns, { ...CYCLE, cyclesManaged: cycle })).state;
  }
  states.RECOVERY = recovery;

  for (const [expected, actual] of Object.entries(states)) assert.equal(actual, expected, `${expected} was not reachable`);
});

// ---- Criterion 8: reserve property over random snapshots --------------------------------
test('the reserve invariant holds over random snapshots (criterion 8)', async () => {
  let seed = 20261117;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const industries = [['Agri', 'Agriculture'], ['Tobacco', 'Tobacco'], ['Chem', 'Chemical']];
  for (let attempt = 0; attempt < 24; attempt++) {
    const funds = 1e6 + Math.floor(random() * 8e10);
    const game = daemonGame({ existing: true, funds, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index++) {
      const [name, industry] = industries[index];
      game.state.divisions[name] = { name, industry, cities: ['Sector-12'], products: [], researchPoints: Math.floor(random() * 1e5), lastCycleRevenue: 0, lastCycleExpenses: 0, numAdVerts: 0 };
      game.state.offices[`${name}/Sector-12`] = { city: 'Sector-12', size: 3 + Math.floor(random() * 30), numEmployees: Math.floor(random() * 9), avgEnergy: 100, avgMorale: 100 };
      game.state.warehouses[`${name}/Sector-12`] = { level: 1 + Math.floor(random() * 5), city: 'Sector-12', size: 100 * (1 + Math.floor(random() * 20)), sizeUsed: Math.floor(random() * 100), smartSupplyEnabled: false };
    }
    game.setRevenue(Math.floor(random() * 5e6), Math.floor(random() * 5e6));

    const before = game.state.corporation.funds;
    const report = await runCorporationCycle(game.ns, CYCLE);
    const spent = Math.max(0, before - game.state.corporation.funds);

    assert.ok(game.state.corporation.funds >= 0, `attempt ${attempt}: the mock went negative (${game.state.corporation.funds})`);
    assert.ok(report.funds >= 0);
    assert.ok(report.reserve >= 0, `attempt ${attempt}: negative reserve`);
    assert.ok(spent <= Math.max(0, before - report.reserve) + 1, `attempt ${attempt}: spent $${Math.round(spent)} with only $${Math.round(before - report.reserve)} above the reserve`);
  }
});

// ---- B13: a pause zeroes buy rates, which also stops production --------------------------
test('a suspended cycle zeroes the recipe buy rates too, so production stops (B13)', async () => {
  const game = await advance(daemonGame(), 4);
  const key = Object.keys(game.state.warehouses)[0];
  const [division, city] = key.split('/');
  for (const material of ['Water', 'Chemicals']) game.api.buyMaterial(division, city, material, 6);

  const mark = game.mark();
  await runCorporationCycle(game.ns, { ...CYCLE, isAllowed: () => false });
  const zeroed = game.mutationsSince(mark).filter((call) => call.operation === 'buyMaterial' && call.args[3] === 0).map((call) => call.args[2]);
  assert.ok(zeroed.includes('Water'), 'a recipe material is zeroed on the pause path');
  // Documented consequence (spec §5.3, README): with its inputs at rate 0 the division produces
  // nothing until the guard clears, which is why SUSPENDED is not a "do less" state.
});

// ---- the entrypoint's own flags are not configuration errors ------------------------------
test('the daemon own flags never surface as config.unknownFlag (B8 follow-up)', async () => {
  const game = daemonGame({ args: ['--ticks=1', '--interval', '250', '--quiet'] });
  const report = await runCorporationCycle(game.ns, CYCLE);
  assert.deepEqual(report.configWarnings, []);
  assert.deepEqual(configArgv(['--ticks=5', '--interval', '250', '--dry-run']), ['--dry-run']);
  assert.deepEqual(configArgv(['--ticks', '3', '--min-ownership', '0.6']), ['--min-ownership', '0.6']);
});
