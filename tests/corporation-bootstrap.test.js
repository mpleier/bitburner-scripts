import test from 'node:test';
import assert from 'node:assert/strict';

import { validateConfig } from '../corporation-config.js';
import {
  DEFAULT_OFFICE_COST,
  DEFAULT_WAREHOUSE_COST,
  SELF_FUND_COST,
  bootstrapDecisions,
  bootstrapProgress,
  cityPackageCost,
  corporationGate,
  creationPlan,
  materialSeedPlan,
  operatingReserve,
  readBootstrapSnapshot,
  runBootstrap,
  seedMaterials,
} from '../corporation-bootstrap.js';
import { createTestGame } from './corporation-test-game.mjs';

const { config } = validateConfig({});
const quiet = () => {};

function snapshotFor(game) {
  const reset = game.ns.getResetInfo();
  return readBootstrapSnapshot(game.api, config, {
    wallet: game.state.wallet,
    playerReserve: 0,
    currentNode: reset.currentNode,
    hasSourceFile3: reset.ownedSF.get(3) > 0,
    disableCorporation: reset.bitNodeOptions.disableCorporation,
  });
}

test('gate treats missing API, BitNode restrictions and permanent refusals as terminal', () => {
  assert.equal(corporationGate({ apiAvailable: false }).state, 'UNAVAILABLE');
  assert.equal(corporationGate({ hasCorporation: true }).state, 'READY');
  assert.equal(corporationGate({ currentOnly: true, currentNode: 4, hasSourceFile3: false }).state, 'UNAVAILABLE');
  assert.equal(corporationGate({ currentNode: 4, hasSourceFile3: true, canCreateSeed: 'Success' }).state, 'NO_CORP');
  assert.equal(corporationGate({ currentNode: 3, canCreateSeed: 'Success' }).state, 'NO_CORP');
  for (const refusal of ['NoSf3OrDisabled', 'DisabledBySoftCap']) {
    const gate = corporationGate({ canCreateSeed: refusal });
    assert.equal(gate.state, 'UNAVAILABLE');
    assert.equal(gate.code, `corporation.${refusal}`);
  }
  assert.equal(corporationGate({ canCreateSeed: 'CorporationExists' }).state, 'READY');
  assert.equal(corporationGate({ disableCorporation: true, canCreateSeed: 'Success' }).state, 'UNAVAILABLE');
});

test('creation prefers seed money, then self-funding only above the wallet floor', () => {
  const seed = creationPlan({ canCreateSeed: 'Success', wallet: 1e9, playerReserve: 0 }, config);
  assert.equal(seed.action, 'create');
  assert.equal(seed.mode, 'seed');
  assert.equal(seed.cost, 0);

  const self = creationPlan({ canCreateSeed: 'UseSeedMoneyOutsideBN3', canCreateSelf: 'Success', wallet: SELF_FUND_COST + 1e9, playerReserve: 0 }, config);
  assert.equal(self.action, 'create');
  assert.equal(self.mode, 'self');
  assert.equal(self.cost, SELF_FUND_COST);

  const reserved = creationPlan({ canCreateSeed: 'UseSeedMoneyOutsideBN3', canCreateSelf: 'Success', wallet: SELF_FUND_COST + 5e9, playerReserve: 10e9 }, config);
  assert.equal(reserved.action, 'wait');
  assert.equal(reserved.blockedBy, 'funds');
  assert.equal(reserved.gap, 5e9);

  const blocked = creationPlan({ canCreateSeed: 'NoSf3OrDisabled', canCreateSelf: 'NoSf3OrDisabled', wallet: 0 }, config);
  assert.equal(blocked.action, 'wait');
  assert.equal(blocked.blockedBy, 'eligibility');
});

test('reserve and city package follow the documented budgets', () => {
  const cash = { funds: 1e12, expenses: 1e6 };
  const reserve = operatingReserve(cash, config, 10);
  assert.equal(reserve, config.budgets.reserveCap, 'cash fraction is capped by reserveCap');
  assert.equal(operatingReserve({ funds: 0, expenses: 0 }, config, 10), config.budgets.reserveFloor);
  assert.equal(operatingReserve({ funds: 1e8, expenses: 1e6 }, config, 10), 2e7, 'two expense cycles dominate');

  const packageCost = cityPackageCost({ constants: {} }, config);
  assert.equal(packageCost.office, DEFAULT_OFFICE_COST);
  assert.equal(packageCost.warehouse, DEFAULT_WAREHOUSE_COST);
  assert.equal(packageCost.total, DEFAULT_OFFICE_COST + DEFAULT_WAREHOUSE_COST + config.bootstrap.setupReserve);
});

test('an empty corporation is planned in unlock → industry order and fund-blocked cleanly', () => {
  const rich = createTestGame({ existing: true, funds: 500e9 });
  const decisions = bootstrapDecisions(snapshotFor(rich), config);
  const order = decisions.decisions.map((item) => item.id);
  const unlockIndex = order.indexOf('bootstrap.unlock:Warehouse API');
  const industryIndex = order.indexOf('bootstrap.industry:Agriculture');
  assert.ok(unlockIndex >= 0 && industryIndex > unlockIndex, order.join(','));
  assert.ok(decisions.decisions.every((item) => item.state === 'ready'));

  const poor = createTestGame({ existing: true, funds: 5e9 });
  const blocked = bootstrapDecisions(snapshotFor(poor), config);
  assert.ok(blocked.decisions.every((item) => item.state === 'blocked'));
  assert.ok(blocked.blockedBy.some((entry) => entry.code === 'bootstrap.unlockFunds'));
  assert.ok(blocked.blockedBy.some((entry) => entry.code === 'bootstrap.industryFunds'));
});

test('a funded corporation bootstraps to a staffed first city, exactly once per action', async () => {
  const game = createTestGame({ existing: true, funds: 500e9 });
  let report;
  for (let cycle = 0; cycle < 12; cycle++) {
    report = runBootstrap(game.api, config, { log: quiet });
    game.state.corporation.funds += 20e9; // a working division earns while the bootstrap runs
    if (report.state === 'READY') break;
  }
  assert.ok(report, 'bootstrap ran');
  assert.equal(report.state, 'READY', JSON.stringify(report.progress));
  assert.equal(game.count('purchaseUnlock'), 3);
  assert.deepEqual(game.calls.mutations.filter((call) => call.operation === 'purchaseUnlock').map((call) => call.args[0]), [
    'Warehouse API',
    'Office API',
    'Smart Supply',
  ]);
  assert.equal(game.count('expandIndustry'), 1);
  assert.equal(game.count('expandCity'), 1);
  assert.equal(game.count('purchaseWarehouse'), 1);
  const office = game.api.getOffice('Agri', 'Sector-12');
  assert.equal(office.size, 9);
  assert.equal(office.numEmployees, 9);
  assert.equal(game.api.hasWarehouse('Agri', 'Sector-12'), true);
  assert.equal(game.api.getWarehouse('Agri', 'Sector-12').smartSupplyEnabled, true);
  assert.deepEqual(report.errors, []);

  const mark = game.mark();
  const rerun = runBootstrap(game.api, config, { log: quiet });
  assert.equal(rerun.state, 'READY');
  assert.deepEqual(game.mutationsSince(mark), [], 'a completed bootstrap never buys twice');
});

test('seedMaterials sets input buy rates once without Smart Supply', () => {
  const calls = [];
  let buyAmounts = { Water: 0, Chemicals: 0 };
  const api = {
    getMaterial: (_division, _city, material) => ({ marketPrice: material === 'Water' ? 50 : 200, buyAmount: buyAmounts[material] }),
    buyMaterial: (division, city, material, rate) => {
      calls.push({ division, city, material, rate });
      buyAmounts = { ...buyAmounts, [material]: rate };
    },
  };
  const snapshot = {
    divisions: [{ name: 'Agri', industry: 'Agriculture' }],
    warehouses: { 'Agri/Sector-12': true },
    warehouseInfo: { 'Agri/Sector-12': { smartSupplyEnabled: false } },
    unlocks: { 'Smart Supply': false },
    industryData: { Agriculture: { requiredMaterials: { Water: 0.5, Chemicals: 0.2 } } },
    corp: { funds: 1e12, expenses: 0 },
    cycleSeconds: 10,
  };
  const first = seedMaterials(api, snapshot, 'Agri', 'Sector-12', config, { reserve: 0 });
  assert.equal(first.executed, true);
  assert.deepEqual(calls.map((call) => call.material).sort(), ['Chemicals', 'Water']);
  assert.ok(calls.every((call) => call.rate > 0));
  const second = seedMaterials(api, snapshot, 'Agri', 'Sector-12', config, { reserve: 0 });
  assert.equal(second.executed, false);
  assert.equal(calls.length, 2, 'existing buy rates are not rewritten');
});

test('seedMaterials prefers Smart Supply and never buys for a city without a warehouse', () => {
  const calls = [];
  const api = {
    setSmartSupply: (...args) => calls.push(['smart', ...args]),
    getMaterial: () => ({ marketPrice: 50, buyAmount: 0 }),
    buyMaterial: (...args) => calls.push(['buy', ...args]),
  };
  const snapshot = {
    divisions: [{ name: 'Agri', industry: 'Agriculture' }],
    warehouses: { 'Agri/Sector-12': true, 'Agri/Aevum': false },
    warehouseInfo: { 'Agri/Sector-12': { smartSupplyEnabled: false } },
    unlocks: { 'Smart Supply': true },
    industryData: { Agriculture: { requiredMaterials: { Water: 0.5 } } },
    corp: { funds: 1e12 },
    cycleSeconds: 10,
  };
  seedMaterials(api, snapshot, 'Agri', 'Sector-12', config, {});
  assert.deepEqual(calls, [['smart', 'Agri', 'Sector-12', true]]);
  const noWarehouse = seedMaterials(api, snapshot, 'Agri', 'Aevum', config, {});
  assert.equal(noWarehouse.executed, false);
  assert.equal(noWarehouse.actions[0].state, 'blocked');
  assert.equal(calls.length, 1);
});

test('a fresh save that only owns Smart Supply is driven through the entrypoint', async () => {
  const game = createTestGame({ existing: true, funds: 500e9, unlocks: ['Warehouse API', 'Office API', 'Smart Supply'] });
  let report;
  for (let cycle = 0; cycle < 12; cycle++) {
    report = runBootstrap(game.api, config, { log: quiet });
    if (report.state === 'READY') break;
  }
  assert.equal(report.state, 'READY');
  assert.equal(game.count('setSmartSupply'), 1);
  assert.equal(game.count('buyMaterial'), 0);
});

test('no corporation is created when funding is short, and nothing is bought', () => {
  const game = createTestGame({ wallet: 10e9, canCreateSeed: 'UseSeedMoneyOutsideBN3' });
  const report = runBootstrap(game.api, config, { log: quiet });
  assert.equal(report.state, 'NO_CORP');
  assert.ok(report.blockedBy.some((entry) => entry.code === 'bootstrap.funds'));
  assert.deepEqual(game.calls.mutations, []);
  assert.equal(game.state.corporation, null);
});

test('a fresh save reaches a staffed corporation through seed money', async () => {
  const game = createTestGame({ wallet: 1e9 });
  let report;
  for (let cycle = 0; cycle < 16; cycle++) {
    report = runBootstrap(game.api, config, { log: quiet });
    if (report.state === 'READY') break;
    if (game.state.corporation) game.state.corporation.funds += 20e9;
  }
  assert.equal(report.state, 'READY');
  assert.ok(game.state.corporation);
  assert.equal(game.state.wallet, 1e9, 'seed money does not touch the player wallet');
  assert.equal(game.count('createCorporation'), 1);
  assert.equal(game.calls.mutations[0].operation, 'createCorporation');
});

test('self-funding is refused when the wallet would drop below the player reserve', () => {
  const game = createTestGame({ wallet: SELF_FUND_COST + 1e9, canCreateSeed: 'UseSeedMoneyOutsideBN3' });
  game.files['reserve.txt'] = '2e9';
  const report = runBootstrap(game.api, config, { log: quiet, context: { wallet: game.state.wallet, playerReserve: 2e9, currentNode: 4, hasSourceFile3: true } });
  assert.equal(report.state, 'NO_CORP');
  assert.deepEqual(game.calls.mutations, []);
  // With the reserve released, the same wallet is enough.
  const ok = runBootstrap(game.api, config, { log: quiet, context: { wallet: game.state.wallet, playerReserve: 0, currentNode: 4, hasSourceFile3: true } });
  assert.notEqual(ok.state, 'NO_CORP');
  assert.equal(game.count('createCorporation'), 1);
});

test('BitNode gating exits without a single mutation', () => {
  const context = (game) => {
    const reset = game.ns.getResetInfo();
    return { wallet: game.state.wallet, playerReserve: 0, currentNode: reset.currentNode, hasSourceFile3: reset.ownedSF.get(3) > 0, disableCorporation: reset.bitNodeOptions.disableCorporation };
  };
  const game = createTestGame({ wallet: 1e12, currentNode: 4, ownedSF: new Map() });
  const report = runBootstrap(game.api, config, { log: quiet, context: context(game) });
  assert.equal(report.state, 'UNAVAILABLE');
  assert.equal(report.terminal, true);
  assert.deepEqual(game.calls.mutations, []);

  const disabled = createTestGame({ wallet: 1e12, disableCorporation: true });
  assert.equal(runBootstrap(disabled.api, config, { log: quiet, context: context(disabled) }).state, 'UNAVAILABLE');
  assert.deepEqual(disabled.calls.mutations, []);

  const softcap = createTestGame({ wallet: 1e12, canCreateSeed: 'DisabledBySoftCap' });
  assert.equal(runBootstrap(softcap.api, config, { log: quiet, context: context(softcap) }).state, 'UNAVAILABLE');
  assert.deepEqual(softcap.calls.mutations, []);
});

test('an API that throws on every mutation produces failures, not exceptions', () => {
  const game = createTestGame({ existing: true, funds: 500e9, failAllMutations: true });
  const report = runBootstrap(game.api, config, { log: quiet });
  assert.ok(report.actions.length > 0);
  assert.ok(report.actions.every((action) => action.state === 'failed' || action.state === 'skipped'));
  assert.ok(report.errors.length > 0);
  assert.ok(report.errors.every((error) => typeof error.operation === 'string' && typeof error.message === 'string'));
  assert.equal(game.state.corporation.funds, 500e9, 'no funds moved on failure');
});

test('progress reports the exact blocking check', () => {
  const game = createTestGame({ existing: true, funds: 500e9 });
  const snapshot = snapshotFor(game);
  const progress = bootstrapProgress(snapshot, config);
  assert.equal(progress.complete, false);
  const byName = Object.fromEntries(progress.checks.map((check) => [check.name, check.ok]));
  assert.equal(byName.corporation, true);
  assert.equal(byName.unlocks, false);
  assert.equal(byName.coreDivision, false);
});

test('materialSeedPlan honours Smart Supply, budget scaling and existing rates', () => {
  const quotes = [
    { name: 'Water', coefficient: 0.5, marketPrice: 50, buyAmount: 0 },
    { name: 'Chemicals', coefficient: 0.2, marketPrice: 200, buyAmount: 0 },
  ];
  const smart = materialSeedPlan(quotes, { smartSupplyEnabled: true });
  assert.deepEqual(smart.orders, []);

  const scaled = materialSeedPlan(quotes, { free: 10, cashFraction: 0.05, cycleSeconds: 10 });
  assert.ok(scaled.cost <= 0.5 + 1e-9, `cost ${scaled.cost} within budget 0.5`);
  assert.ok(scaled.orders.every((order) => order.rate > 0));

  const already = materialSeedPlan(quotes.map((quote) => ({ ...quote, buyAmount: 99 })), { free: 1e12, cashFraction: 0.05 });
  assert.deepEqual(already.orders, []);

  assert.deepEqual(materialSeedPlan([], {}).orders, []);
  assert.deepEqual(materialSeedPlan([{ name: 'Water', coefficient: 0, marketPrice: 0 }], {}).orders, []);
});
