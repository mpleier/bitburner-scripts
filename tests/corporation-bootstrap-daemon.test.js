import test from 'node:test';
import assert from 'node:assert/strict';

import { validateConfig } from '../corporation-config.js';
import {
  BOOTSTRAP_STATUS_FILE,
  DRY_RUN_FILE,
  buildStatusDocument,
  isDuplicateInstance,
  main,
  parseDaemonArgs,
  readResetContext,
  runBootstrapExpansionCycle,
  summarizeFailures,
} from '../corporation-bootstrap-daemon.js';
import { createTestGame } from './corporation-test-game.mjs';

const { config } = validateConfig({});
const quiet = { quiet: true };

function readStatus(game, path = BOOTSTRAP_STATUS_FILE) {
  const raw = game.files[path];
  assert.ok(raw, `${path} was written`);
  return JSON.parse(raw);
}

test('daemon flags parse without swallowing the next flag', () => {
  assert.deepEqual(parseDaemonArgs(['--ticks=5', '--interval', '250', '--dry-run']), { ticks: 5, interval: 250, dryRun: true, quiet: false });
  assert.deepEqual(parseDaemonArgs(['--ticks', '3', '--quiet']), { ticks: 3, interval: 0, dryRun: false, quiet: true });
  assert.deepEqual(parseDaemonArgs(['--dry-run', 'false']), { ticks: 0, interval: 0, dryRun: false, quiet: false });
});

test('reset context tolerates a Map and a plain object for ownedSF', () => {
  const withMap = readResetContext({ getResetInfo: () => ({ currentNode: 3, ownedSF: new Map([[3, 1]]), bitNodeOptions: {} }) });
  assert.equal(withMap.hasSourceFile3, true);
  const plain = readResetContext({ getResetInfo: () => ({ currentNode: 15, ownedSF: { 3: 2 }, bitNodeOptions: { disableCorporation: true } }) });
  assert.equal(plain.hasSourceFile3, true);
  assert.equal(plain.disableCorporation, true);
  const broken = readResetContext({ getResetInfo: () => { throw new Error('no reset info'); } });
  assert.equal(broken.currentNode, 3);
  assert.equal(broken.hasSourceFile3, false);
});

test('a fresh save reaches a stable multi-city corporation through the daemon loop', async () => {
  const game = createTestGame({ wallet: 1e12, seedFunds: 400e9, args: ['--ticks=40', '--interval=0'] });
  const result = await main(game.ns);
  assert.equal(result.cycles, 40);

  const snapshot = game.api.getCorporation();
  assert.ok(snapshot, 'corporation created');
  const agri = game.api.getDivision('Agri');
  assert.ok(agri.cities.length >= 3, `cities ${agri.cities.join(',')}`);
  for (const city of agri.cities) {
    assert.equal(game.api.hasWarehouse('Agri', city), true, `warehouse ${city}`);
    const office = game.api.getOffice('Agri', city);
    assert.equal(office.size >= 9, true, `office ${city} size ${office.size}`);
    assert.equal(office.numEmployees >= 9, true, `staff ${city} ${office.numEmployees}/${office.size}`);
  }
  const offices = new Set(agri.cities.map((city) => game.api.getOffice('Agri', city).numEmployees));
  assert.ok([...offices].every((count) => count >= 9));

  // Seed money only: the wallet is untouched.
  assert.equal(game.state.wallet, 1e12);
  // Every purchase happened exactly once.
  const cities = game.calls.mutations.filter((call) => call.operation === 'expandCity').map((call) => `${call.args[0]}/${call.args[1]}`);
  assert.equal(new Set(cities).size, cities.length, `duplicate city purchase: ${cities.join(',')}`);
  const warehouses = game.calls.mutations.filter((call) => call.operation === 'purchaseWarehouse').map((call) => call.args.join('/'));
  assert.equal(new Set(warehouses).size, warehouses.length, 'no duplicate warehouse purchase');
  // The industry chain progressed beyond the first division.
  assert.ok(game.api.getDivision('Chem'), 'Chemical division created');
  // The status document is valid and keeps the legacy keys.
  const status = readStatus(game);
  assert.equal(status.schemaVersion, 2);
  assert.ok(['BOOTSTRAP', 'EXPANDING', 'READY'].includes(status.state));
  for (const key of ['at', 'mode', 'funds', 'reserve', 'divisions', 'growthPriority', 'actions', 'persistentFailures', 'bootstrap']) {
    assert.ok(key in status, `status key ${key}`);
  }
  assert.deepEqual(status.divisions.sort(), ['Agri', 'Chem', 'Tobacco']);
  assert.deepEqual(status.configErrors, []);
});

test('re-running against the same state never repeats a purchase', async () => {
  const game = createTestGame({ existing: true, funds: 500e9, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
  for (let cycle = 0; cycle < 14; cycle++) {
    const report = await runBootstrapExpansionCycle(game.ns, { config, ...quiet, now: 1e6 + cycle * 1000 });
    if (report.state === 'READY' && cycle > 6) break;
  }
  const owned = () => ({
    cities: new Set(Object.values(game.state.divisions).flatMap((division) => division.cities.map((city) => `${division.name}/${city}`))),
    warehouses: new Set(Object.keys(game.state.warehouses)),
    industries: new Set(Object.values(game.state.divisions).map((division) => division.industry)),
    unlocks: new Set(game.state.unlocks),
  });
  for (const pass of [1, 2]) {
    const before = owned();
    const mark = game.mark();
    await runBootstrapExpansionCycle(game.ns, { config, ...quiet, now: 2e6 + pass * 1000 });
    const fresh = game.mutationsSince(mark);
    for (const call of fresh) {
      if (call.operation === 'expandCity') assert.equal(before.cities.has(`${call.args[0]}/${call.args[1]}`), false, `re-bought city ${call.args.join('/')}`);
      if (call.operation === 'purchaseWarehouse') assert.equal(before.warehouses.has(call.args.join('/')), false, `re-bought warehouse ${call.args.join('/')}`);
      if (call.operation === 'expandIndustry') assert.equal(before.industries.has(call.args[0]), false, `re-created ${call.args[0]}`);
      if (call.operation === 'purchaseUnlock') assert.equal(before.unlocks.has(call.args[0]), false, `re-bought ${call.args[0]}`);
      assert.notEqual(call.operation, 'createCorporation', 'the corporation already exists');
    }
  }
});

test('dry run plans without mutating and writes the plan document', async () => {
  const game = createTestGame({ existing: true, funds: 500e9, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
  const mark = game.mark();
  const report = await runBootstrapExpansionCycle(game.ns, { config, dryRun: true, ...quiet, now: 5e6 });
  assert.deepEqual(game.mutationsSince(mark), [], 'no mutating API call in dry run');
  assert.equal(report.dryRun, true);
  const plan = JSON.parse(game.files[DRY_RUN_FILE]);
  assert.equal(plan.dryRun, true);
  assert.ok(plan.wouldDo.length > 0, 'the plan names what would happen');
  assert.ok(plan.wouldDo.some((action) => /Agriculture/.test(action.label)));
  const status = readStatus(game);
  assert.equal(status.dryRun, true);
});

test('an API that rejects every mutation never throws out of a cycle', async () => {
  const game = createTestGame({ existing: true, funds: 500e9, failAllMutations: true });
  let report;
  for (let cycle = 0; cycle < 6; cycle++) {
    report = await runBootstrapExpansionCycle(game.ns, { config, ...quiet, now: 1e7 + cycle, failures: report?.persistentFailures });
  }
  assert.ok(report.actions.every((action) => action.state !== 'done'));
  assert.ok(report.errors.length > 0);
  assert.ok(report.persistentFailures.some((failure) => failure.count >= 5));
  assert.equal(game.state.corporation.funds, 500e9);
});

test('BitNode gating writes an unavailable status and mutates nothing', async () => {
  const game = createTestGame({ wallet: 1e12, currentNode: 4, ownedSF: new Map() });
  const report = await runBootstrapExpansionCycle(game.ns, { config, ...quiet });
  assert.equal(report.state, 'UNAVAILABLE');
  assert.equal(report.terminal, true);
  assert.deepEqual(game.calls.mutations, []);
  const status = readStatus(game);
  assert.equal(status.state, 'UNAVAILABLE');
  assert.equal(status.mode, 'unavailable');

  const bounded = createTestGame({ wallet: 1e12, currentNode: 4, ownedSF: new Map(), args: ['--ticks=5'] });
  assert.equal(await main(bounded.ns), undefined, 'the loop exits on a terminal gate');
  assert.deepEqual(bounded.calls.mutations, []);
});

test('main refuses to start without RAM or with a second instance', async () => {
  const starved = createTestGame({ wallet: 1e12, args: ['--ticks=5'], scriptRam: 5000, maxRam: 1000, usedRam: 990 });
  assert.equal(await main(starved.ns), undefined);
  assert.deepEqual(starved.calls.mutations, []);
  assert.ok(starved.calls.logs.some((line) => /needs 5000\.0 GB/.test(line)));

  const duplicate = createTestGame({
    wallet: 1e12,
    args: ['--ticks=5'],
    processes: [
      { filename: 'corporation-bootstrap-daemon.js', pid: 4242 },
      { filename: 'corporation-bootstrap-daemon.js', pid: 5151 },
    ],
  });
  assert.equal(await main(duplicate.ns), undefined);
  assert.deepEqual(duplicate.calls.mutations, []);
  assert.ok(duplicate.calls.logs.some((line) => /already running/.test(line)));
  assert.equal(isDuplicateInstance(duplicate.ns, 'corporation-bootstrap-daemon.js'), true);
});

test('the status document keeps every §9.1 key it owns', () => {
  const game = createTestGame({ existing: true, funds: 1e9 });
  const report = {
    state: 'BOOTSTRAP',
    phase: 'BOOTSTRAP',
    terminal: false,
    reason: 'bootstrap in progress',
    dryRun: false,
    funds: 1e9,
    reserve: 1e8,
    divisions: ['Agri'],
    actions: [{ label: 'x', state: 'done', detail: '', at: 1 }],
    errors: [],
    blockedBy: [],
    quotes: [],
    cooldowns: {},
    progress: { complete: false, checks: [{ name: 'staff', ok: false, detail: '3/9' }] },
    persistentFailures: [],
    configErrors: [],
    configWarnings: [],
    cyclesManaged: 3,
  };
  const status = buildStatusDocument(report, { ns: game.ns, config, reset: readResetContext(game.ns), now: 42 });
  for (const key of [
    'schemaVersion', 'at', 'pid', 'nodeReset', 'augReset', 'corporation', 'state', 'stateSince', 'stateReason',
    'mode', 'funds', 'reserve', 'divisions', 'growthPriority', 'phase', 'dryRun', 'configErrors', 'blockedBy',
    'stagedExpansion', 'actions', 'bootstrap', 'persistentFailures', 'cyclesManaged',
  ]) {
    assert.ok(key in status, `missing ${key}`);
  }
  assert.equal(status.at, 42);
  assert.equal(JSON.stringify(status).length < 8000, true, 'status document stays small');
});

test('failure counters accumulate across restarts and survive a quiet cycle', () => {
  const first = summarizeFailures([], [{ operation: 'expandCity', message: 'boom' }], 1000);
  assert.equal(first[0].count, 1);
  const second = summarizeFailures(first, [{ operation: 'expandCity', message: 'boom' }], 2000);
  assert.equal(second[0].count, 2);
  assert.equal(second[0].firstAt, 1000);
  const quietCycle = summarizeFailures(second, [], 3000);
  assert.equal(quietCycle[0].count, 2, 'a clean cycle does not erase history');
  const stale = summarizeFailures(second, [], 2000 + 3_600_001);
  assert.deepEqual(stale, [], 'failures older than an hour are dropped');
});
