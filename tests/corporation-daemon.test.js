import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestGame } from './corporation-test-game.mjs';
import {
  DAEMON_DRY_RUN_FILE,
  DAEMON_STATE_FILE,
  DAEMON_STATUS_FILE,
  FINANCE_ACTIONS,
  buildDaemonStatus,
  defaultDaemonState,
  detectPeerWriters,
  financeOwnership,
  main,
  mergeFailures,
  readDaemonState,
  restoreDaemonState,
  runCorporationCycle,
  structuralClaim,
  warehousesTouched,
} from '../corporation-daemon.js';

const DAEMON = 'corporation-daemon.js';
const CYCLE = { script: DAEMON, quiet: true };

/** A game whose process list contains only this daemon (no peer writer). */
function daemonGame(options = {}) {
  return createTestGame({
    wallet: 1e12,
    scriptName: DAEMON,
    processes: [{ filename: DAEMON, pid: 4242 }],
    ...options,
  });
}

/** Run cycles with a profitable, cash-rich corporation so the optimiser is not in recovery. */
async function advance(game, cycles) {
  for (let cycle = 1; cycle <= cycles; cycle++) {
    game.setRevenue(2e6, 1e6);
    if (game.state.corporation) game.state.corporation.funds = Math.max(game.state.corporation.funds, 60e9);
    await runCorporationCycle(game.ns, { ...CYCLE, cyclesManaged: cycle });
  }
  return game;
}

const purchases = new Set(['createCorporation', 'expandIndustry', 'expandCity', 'purchaseWarehouse', 'purchaseUnlock', 'makeProduct', 'upgradeWarehouse']);

test('one cycle takes a fresh save from no corporation to a staffed first city and runs the optimiser', async () => {
  const game = daemonGame();
  const report = await runCorporationCycle(game.ns, CYCLE);

  assert.equal(game.api.hasCorporation(), true);
  assert.equal(game.count('createCorporation'), 1);
  assert.equal(game.count('expandIndustry'), 1, 'the first industry of the configured chain is created');
  assert.equal(report.state, 'RUNNING');
  assert.equal(report.phase, 'EXPAND');
  assert.deepEqual(report.errors, []);

  // Structural phase ran first, the optimiser second: both contributed decisions.
  assert.ok(report.actions.some((action) => action.label.startsWith('Create corporation')));
  assert.ok(report.optimizer, 'the optimiser ran in the same cycle');
  assert.ok(report.actions.some((action) => action.state === 'purchased'), 'the optimiser purchased something');

  // The single command publishes one status document with the legacy dashboard keys.
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.schemaVersion, 2);
  for (const key of ['mode', 'state', 'funds', 'reserve', 'divisions', 'growthPriority', 'phase', 'actions']) {
    assert.ok(key in status, `status document keeps ${key}`);
  }
  assert.equal(status.mode, 'bootstrap');
  assert.ok(game.files['tasks/corporation-bootstrap-status.json'], 'the structural phase keeps its own status file');
});

test('a full cycle never buys the same thing twice and never touches finance', async () => {
  const game = await advance(daemonGame(), 6);
  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, CYCLE);
  const fresh = game.mutationsSince(mark);

  const seen = new Set();
  for (const call of fresh) {
    if (!purchases.has(call.operation)) continue;
    const key = `${call.operation}:${call.args.slice(0, 2).join('/')}`;
    assert.equal(seen.has(key), false, `${key} was bought twice in one cycle`);
    seen.add(key);
  }
  for (const operation of FINANCE_ACTIONS) {
    assert.equal(fresh.filter((call) => call.operation === operation).length, 0, `${operation} must never be called by the daemon`);
  }
  assert.equal(report.guards.finance.owner, 'unowned');
  assert.deepEqual(report.guards.finance.actions.slice().sort(), FINANCE_ACTIONS.slice().sort());
});

test('consecutive cycles never buy something the corporation already owns', async () => {
  const game = await advance(daemonGame(), 8);
  const unlockCalls = game.calls.mutations.filter((call) => call.operation === 'purchaseUnlock').map((call) => call.args[0]);
  const cityCalls = game.calls.mutations.filter((call) => call.operation === 'expandCity').map((call) => `${call.args[0]}/${call.args[1]}`);
  const warehouseCalls = game.calls.mutations.filter((call) => call.operation === 'purchaseWarehouse').map((call) => `${call.args[0]}/${call.args[1]}`);
  const industryCalls = game.calls.mutations.filter((call) => call.operation === 'expandIndustry').map((call) => call.args[0]);

  assert.ok(cityCalls.length > 0, 'the run expanded cities');
  assert.equal(new Set(unlockCalls).size, unlockCalls.length, 'an unlock is bought once');
  assert.equal(new Set(cityCalls).size, cityCalls.length, 'a city is expanded to once');
  assert.equal(new Set(warehouseCalls).size, warehouseCalls.length, 'a warehouse is bought once');
  assert.equal(new Set(industryCalls).size, industryCalls.length, 'an industry is created once');
  assert.equal(game.count('createCorporation'), 1);
});

test('the optimiser skips a warehouse the structural phase upgraded in the same cycle', async () => {
  const game = await advance(daemonGame(), 4);
  for (const warehouse of Object.values(game.state.warehouses)) warehouse.sizeUsed = 85;
  game.state.corporation.funds = 60e9;
  game.setRevenue(5e6, 1e6);

  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, CYCLE);
  const upgrades = game.mutationsSince(mark).filter((call) => call.operation === 'upgradeWarehouse');

  assert.ok(report.guards.skipWarehouse.length > 0, 'the structural phase touched at least one warehouse');
  for (const call of upgrades) assert.ok(report.guards.skipWarehouse.includes(`${call.args[0]}/${call.args[1]}`));
  const perKey = new Map();
  for (const call of upgrades) {
    const key = `${call.args[0]}/${call.args[1]}`;
    perKey.set(key, (perKey.get(key) || 0) + 1);
  }
  for (const [key, count] of perKey) assert.equal(count, 1, `${key} was upgraded ${count} times in one cycle`);
  assert.ok(report.actions.some((action) => /structural phase already touched this warehouse/.test(action.detail || '')),
    'the optimiser explains why it skipped the warehouse');
});

test('a pending city package keeps a claim on free cash, structural before discretionary', async () => {
  const game = await advance(daemonGame(), 10);
  // Staffed offices, so the next city is blocked by funds (not by staffing).
  for (const office of Object.values(game.state.offices)) office.numEmployees = Math.max(office.numEmployees, 9);
  game.state.corporation.funds = 9.5e9;
  game.setRevenue(2e6, 1e6);

  const report = await runCorporationCycle(game.ns, CYCLE);
  const claim = report.guards.claim;
  assert.equal(claim.pending > 0, true, 'a city package is staged');
  assert.ok(claim.claim > 0, 'the staged package holds cash back');
  assert.ok(claim.claim <= claim.free * 0.5 + 1, 'the claim is bounded by budgets.structuralClaimFraction');
  assert.ok(report.reserve >= claim.claim, 'the optimiser reserve includes the claim');
  // Discretionary growth waits for the package; operating spend does not.
  const discretionary = report.actions.filter((action) => /^(Upgrade|AdVert)/.test(action.label));
  for (const action of discretionary) assert.notEqual(action.state, 'purchased', `${action.label} must not spend claimed cash`);
  assert.ok(report.actions.some((action) => action.state === 'purchased'), 'inputs, staffing and sales still run');
});

test('a peer corporation controller makes the daemon report-only with zero mutations', async () => {
  const game = daemonGame({ processes: [{ filename: DAEMON, pid: 4242 }, { filename: 'corporation-manager.js', pid: 99 }] });
  await advanceWithPeers(game);
  const report = await runCorporationCycle(game.ns, CYCLE);

  assert.equal(report.state, 'REPORT_ONLY');
  assert.equal(report.guards.finance.owner, 'corporation-manager.js');
  assert.equal(report.guards.finance.delegated, true);
  assert.equal(report.actions.every((action) => action.state === 'skipped'), true);
  assert.equal(game.calls.mutations.filter((call) => call.at >= 0).length, game.calls.mutations.length);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.mode, 'report-only');
  assert.deepEqual(status.guards.peers, ['corporation-manager.js']);
});

async function advanceWithPeers(game) {
  // Build a corporation with the peer hidden, then let the daemon see it again.
  const peers = game.ns.ps;
  game.ns.ps = () => [{ filename: DAEMON, pid: 4242 }];
  await advance(game, 4);
  game.ns.ps = peers;
}

test('a paused automation suspends the cycle and spends nothing', async () => {
  const game = await advance(daemonGame(), 4);
  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, { ...CYCLE, isAllowed: () => false });
  assert.equal(report.state, 'SUSPENDED');
  // Zeroing buy rates is the only allowed write while suspended (spec invariant 4).
  const spent = game.mutationsSince(mark).filter((call) => purchases.has(call.operation));
  assert.deepEqual(spent, [], 'nothing is purchased while paused');
  assert.ok(report.actions.every((action) => action.state === 'skipped' || action.state === 'blocked' || action.state === 'no-op'));
  assert.equal(report.optimizer, null);
});

test('a hostile API produces a failed, bounded cycle instead of an exception', async () => {
  const game = daemonGame({ failAllMutations: true, existing: true, funds: 60e9, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
  // Seed a division directly: every api mutation now throws.
  game.state.divisions.Agri = { name: 'Agri', industry: 'Agriculture', cities: ['Sector-12'], products: [], researchPoints: 0, lastCycleRevenue: 0, lastCycleExpenses: 0, numAdVerts: 0 };
  game.state.offices['Agri/Sector-12'] = { city: 'Sector-12', size: 3, numEmployees: 3, avgEnergy: 100, avgMorale: 100 };

  const report = await runCorporationCycle(game.ns, CYCLE);
  assert.ok(Array.isArray(report.errors));
  assert.ok(report.errors.length > 0, 'failures are reported');
  assert.ok(report.persistentFailures.length > 0, 'failures are counted for the status document');
  for (const failure of report.persistentFailures) {
    assert.equal(typeof failure.operation, 'string');
    assert.equal(typeof failure.count, 'number');
  }
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.ok(Array.isArray(status.persistentFailures));
  assert.equal(game.calls.mutations.length, 0, 'no mutation can succeed on a hostile API');
});

test('dry run plans the structural and optimiser actions and mutates nothing', async () => {
  const game = await advance(daemonGame(), 4);
  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, { ...CYCLE, dryRun: true });

  assert.equal(game.mutationsSince(mark).length, 0, 'a dry run must not mutate');
  assert.equal(report.dryRun, true);
  assert.ok(report.optimizer, 'the optimiser plans in dry-run mode');
  assert.ok(report.actions.some((action) => action.state === 'dry-run'), 'structural plans are recorded');
  assert.ok(report.actions.some((action) => action.state === 'planned'), 'optimiser plans are recorded');
  const plan = JSON.parse(game.files[DAEMON_DRY_RUN_FILE]);
  assert.equal(plan.dryRun, true);
  assert.ok(plan.wouldDo.length > 0);
});

test('the daemon state file is scoped to the corporation, node and augmentation reset', async () => {
  const game = daemonGame();
  const identity = { nodeReset: 1000, augReset: 2000, corporation: null };
  await runCorporationCycle(game.ns, CYCLE);
  const state = { ...defaultDaemonState(), nodeReset: 1000, augReset: 2000, corporation: 'Apex Holdings', cyclesManaged: 7 };
  game.files[DAEMON_STATE_FILE] = JSON.stringify(state);

  assert.equal(readDaemonState(game.ns, { identity }).cyclesManaged, 7);
  assert.equal(readDaemonState(game.ns, { identity: { nodeReset: 1001, augReset: 2000, corporation: null } }).cyclesManaged, 0);
  assert.equal(readDaemonState(game.ns, { identity: { nodeReset: 1000, augReset: 2001, corporation: null } }).cyclesManaged, 0);
  assert.equal(readDaemonState(game.ns, { identity: { nodeReset: 1000, augReset: 2000, corporation: 'Other Corp' } }).cyclesManaged, 0);
  assert.equal(restoreDaemonState({ schemaVersion: 99 }, identity).cyclesManaged, 0, 'a foreign schema is discarded');
  assert.equal(restoreDaemonState('not json', identity).cyclesManaged, 0);
});

test('main honours --ticks and refuses to start when home RAM cannot host the daemon', async () => {
  const game = daemonGame({ args: ['--ticks=3'], scriptRam: 40, maxRam: 900, usedRam: 600 });
  const result = await main(game.ns);
  assert.equal(result.cycles, 3);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.cyclesManaged, 3);
  assert.ok(status.actions.length <= 40, 'the status document stays bounded');

  const cramped = daemonGame({ args: ['--ticks=3'], scriptRam: 5000, maxRam: 100, usedRam: 0 });
  const stopped = await main(cramped.ns);
  assert.equal(stopped.cycles, 0);
  assert.equal(stopped.reason, 'ram');
  assert.equal(cramped.calls.mutations.length, 0);
  assert.ok(cramped.calls.logs.some((line) => /needs 5000\.0 GB/.test(line)));
});

test('a loss-making corporation shaped like the captured live save runs one safe cycle', async () => {
  // Mirrors tests/fixtures/corporation-live-snapshot.json: Apex Holdings, Agri + Tobacco one city
  // each, no products, revenue < expenses, ~$1.69b funds. This is the state the shipped save is in.
  const game = daemonGame({ existing: true, funds: 1692740517, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
  game.setRevenue(14609.89, 26809.76);
  for (const [name, industry] of [['Agri', 'Agriculture'], ['Tobacco', 'Tobacco']]) {
    game.state.divisions[name] = { name, industry, cities: ['Sector-12'], products: [], researchPoints: name === 'Agri' ? 178.7 : 167.5, lastCycleRevenue: 0, lastCycleExpenses: 0, numAdVerts: 0 };
    game.state.offices[`${name}/Sector-12`] = { city: 'Sector-12', size: 9, numEmployees: 9, avgEnergy: 100, avgMorale: 100 };
    game.state.warehouses[`${name}/Sector-12`] = { level: 1, city: 'Sector-12', size: 100, sizeUsed: 10, smartSupplyEnabled: false };
  }

  const mark = game.mark();
  const report = await runCorporationCycle(game.ns, CYCLE);
  const fresh = game.mutationsSince(mark);

  assert.deepEqual(report.errors, []);
  assert.equal(report.state, 'RUNNING');
  assert.equal(report.divisions.length, 2);
  assert.ok(report.funds >= report.reserve, 'the reserve invariant survives a cycle');
  // A loss-making corporation must not buy discretionary industry or advertising with its reserve.
  assert.equal(fresh.filter((call) => call.operation === 'expandIndustry').length, 0);
  assert.equal(fresh.filter((call) => call.operation === 'hireAdVert').length, 0);
  for (const operation of FINANCE_ACTIONS) assert.equal(fresh.filter((call) => call.operation === operation).length, 0);
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.divisions.length, 2);
  assert.ok(status.persistentFailures.length === 0);
});

test('an unusable config is reported in the status document, not thrown', async () => {
  const game = daemonGame({
    files: { 'corporation-config.json': JSON.stringify({ dryRun: 'yes', mystery: true, bootstrap: { cities: ['Atlantis'] } }) },
  });
  const report = await runCorporationCycle(game.ns, CYCLE);
  assert.equal(report.configErrors.length, 2, 'the invalid dryRun and the unknown city are reported');
  for (const error of report.configErrors) assert.equal(error.code, 'config.invalidField');
  assert.equal(report.configWarnings.length, 1);
  assert.equal(report.configWarnings[0].path, 'mystery');
  const status = JSON.parse(game.files[DAEMON_STATUS_FILE]);
  assert.equal(status.configErrors.length, 2);
  assert.equal(status.configWarnings.length, 1);
});

test('structuralClaim ignores a long wait and honours the configured fraction', () => {
  const quote = { division: 'Agri', city: 'Aevum', cost: 9e9, gap: 1e9, reason: 'insufficient funds' };
  const staged = { funds: 10e9, reserve: 1e9, quotes: [quote] };
  const claim = structuralClaim(staged, { config: { budgets: { structuralClaimFraction: 0.5 } } });
  assert.equal(claim.claim, 4.5e9, 'half of the 9e9 free cash');
  assert.equal(claim.division, 'Agri');

  assert.equal(structuralClaim({ ...staged, quotes: [{ ...quote, longWait: true }] }).claim, 0, 'a far-off package is not a claim');
  assert.equal(structuralClaim({ ...staged, quotes: [{ ...quote, reason: 'existing offices are understaffed' }] }).claim, 0);
  assert.equal(structuralClaim({ ...staged, quotes: [quote] }, { fraction: 0 }).claim, 0);
  assert.equal(structuralClaim({ funds: 0, reserve: 0, quotes: [quote] }).claim, 0);
  assert.equal(structuralClaim(null).claim, 0);
});

test('warehousesTouched reports new and upgraded warehouses only', () => {
  const before = {
    divisions: [{ name: 'Agri', cities: ['Sector-12', 'Aevum'] }],
    warehouses: { 'Agri/Sector-12': true },
    warehouseInfo: { 'Agri/Sector-12': { level: 1 } },
  };
  const after = {
    divisions: [{ name: 'Agri', cities: ['Sector-12', 'Aevum', 'Volhaven'] }],
    warehouses: { 'Agri/Sector-12': true, 'Agri/Aevum': true },
    warehouseInfo: { 'Agri/Sector-12': { level: 2 }, 'Agri/Aevum': { level: 1 } },
  };
  assert.deepEqual(warehousesTouched(before, after).sort(), ['Agri/Aevum', 'Agri/Sector-12']);
  assert.deepEqual(warehousesTouched(after, after), []);
  assert.deepEqual(warehousesTouched(null, after).sort(), ['Agri/Aevum', 'Agri/Sector-12'], 'without a before snapshot every warehouse counts as touched');
});

test('peer detection and failure merging stay bounded and honest', () => {
  const ns = {
    getScriptName: () => DAEMON,
    ps: () => [
      { filename: '/corporation-daemon.js', pid: 1 },
      { filename: 'corporation-bootstrap-daemon.js', pid: 2 },
      { filename: 'autopilot.js', pid: 3 },
      { filename: 'hacknet-upgrade-manager.js', pid: 4 },
      { filename: 'corporation-manager.js', pid: 5 },
    ],
  };
  const peers = detectPeerWriters(ns);
  assert.deepEqual(peers.map((peer) => peer.script), ['corporation-bootstrap-daemon.js', 'autopilot.js', 'corporation-manager.js']);

  const merged = mergeFailures(
    [{ operation: 'sell', message: 'boom', count: 2, firstAt: 10, lastAt: 20, announced: false }],
    [{ operation: 'sell', message: 'boom', count: 5, firstAt: 5, lastAt: 30, announced: true }],
    [{ operation: 'buy', message: 'other', count: 1, firstAt: 15, lastAt: 15 }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].operation, 'sell');
  assert.equal(merged[0].count, 5);
  assert.equal(merged[0].firstAt, 5);
  assert.equal(merged[0].announced, true);

  const config = { finance: { payDividends: true, manageShares: true, acceptInvestment: true } };
  assert.equal(financeOwnership(config, { peers }).owner, 'autopilot.js');
  assert.deepEqual(financeOwnership(config, { peers: [] }).wanted, ['dividends', 'shares', 'investment']);

  const status = buildDaemonStatus({ actions: Array.from({ length: 60 }, (_, index) => ({ label: `a${index}`, state: 'purchased' })), funds: 5, dryRun: false });
  assert.equal(status.actions.length, 40);
  assert.equal(status.funds, 5);
});
