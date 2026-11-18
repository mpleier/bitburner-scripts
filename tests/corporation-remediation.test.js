/**
 * Shared module-level remediation tests (card t_d14f9a7b): reserved configuration knobs (B3),
 * the unowned-finance defaults (N2), the dead `allowCreate` option (F7) and the mid-tick pause
 * guard on `setSmartSupply` (B9). Each test fails when its fix is reverted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RESERVED_CONFIG_PATHS, validateConfig } from '../corporation-config.js';
import { runBootstrap } from '../corporation-bootstrap.js';
import { createCorporationOptimizer } from '../corporation-optimizer.js';
import { createTestGame } from './corporation-test-game.mjs';

const { config } = validateConfig({});
const quiet = () => {};

// ---- B3: reserved knobs are accepted, reported, and honest about doing nothing ------------
test('reserved configuration keys are accepted and reported as ignored (B3)', () => {
  const reservedInput = {
    market: { priceCeiling: 500000, exportQualityMargin: 0.1, throttleProductionOnBacklog: true },
    bootstrap: { expediteStagedExpansion: false },
    finance: { minOwnership: 0.7 },
  };
  const { config: parsed, errors, warnings } = validateConfig(reservedInput);

  assert.deepEqual(errors, [], 'a reserved key is not an error');
  const ignored = warnings.filter((warning) => warning.code === 'config.ignoredKey');
  assert.deepEqual(
    ignored.map((warning) => warning.path).sort(),
    ['bootstrap.expediteStagedExpansion', 'finance.minOwnership', 'market.exportQualityMargin', 'market.priceCeiling', 'market.throttleProductionOnBacklog'],
  );
  for (const warning of ignored) assert.match(warning.message, /reserved/);
  // The value is still stored: a future implementation can read it without a config migration.
  assert.equal(parsed.market.priceCeiling, 500000);
  assert.equal(parsed.bootstrap.expediteStagedExpansion, false);

  for (const path of ['market.priceCeiling', 'market.exportQualityMargin', 'market.throttleProductionOnBacklog', 'bootstrap.expediteStagedExpansion']) {
    assert.ok(RESERVED_CONFIG_PATHS.includes(path), `${path} is marked reserved`);
  }
});

test('an unknown key still reports unknownKey, so "ignored" and "unknown" stay distinct (B3)', () => {
  const { errors, warnings } = validateConfig({ market: { priceCeilling: 1 }, mystery: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map((warning) => warning.code).sort(), ['config.unknownKey', 'config.unknownKey']);
});

// ---- N2: the shipped finance switches are off and the rest is reserved -------------------
test('the finance defaults ask for nothing the daemon does not implement (N2)', () => {
  const { config: defaults, warnings } = validateConfig({});
  assert.equal(defaults.finance.acceptInvestment, false);
  assert.equal(defaults.finance.payDividends, false);
  assert.equal(defaults.finance.manageShares, false);
  assert.equal(defaults.finance.bribeFactions, false);
  assert.deepEqual(warnings, [], 'the shipped defaults raise no warning');
  for (const path of ['finance.ipoShares', 'finance.ipoValuationFloor', 'finance.dividendTiers', 'finance.bribeFactions', 'finance.investmentMinOwnership']) {
    assert.ok(RESERVED_CONFIG_PATHS.includes(path), `${path} is reserved until a finance module exists`);
  }
});

// ---- F7: `allowCreate: false` actually disables creation ---------------------------------
test('allowCreate:false performs no creation at all (F7)', () => {
  const game = createTestGame({ wallet: 1e12 });
  const report = runBootstrap(game.api, config, { allowCreate: false, log: quiet });

  assert.equal(game.count('createCorporation'), 0, 'no corporation may be founded by this call');
  assert.deepEqual(game.calls.mutations, []);
  assert.ok(report.blockedBy.some((entry) => entry.code === 'bootstrap.createDisabled'));

  // Without the flag the same state still creates one, so the guard is the option, not the state.
  const allowed = runBootstrap(game.api, config, { log: quiet });
  assert.equal(allowed.state, 'BOOTSTRAP');
  assert.equal(game.count('createCorporation'), 1);
});

// ---- B9: a mid-tick pause stops even the Smart Supply write ------------------------------
test('a pause that lands mid-tick stops setSmartSupply too (B9)', () => {
  const game = createTestGame({
    existing: true,
    funds: 60e9,
    unlocks: ['Warehouse API', 'Office API', 'Smart Supply'],
  });
  game.state.divisions.Agri = { name: 'Agri', industry: 'Agriculture', cities: ['Sector-12'], products: [], researchPoints: 0, lastCycleRevenue: 0, lastCycleExpenses: 0, numAdVerts: 0 };
  game.state.offices['Agri/Sector-12'] = { city: 'Sector-12', size: 9, numEmployees: 9, avgEnergy: 100, avgMorale: 100 };
  game.state.warehouses['Agri/Sector-12'] = { level: 1, city: 'Sector-12', size: 100, sizeUsed: 10, smartSupplyEnabled: false };

  // The tick's opening guard passes; every later check (including the Smart Supply write) sees
  // the pause. `!dryRun` alone used to let that one write through.
  let checks = 0;
  const optimizer = createCorporationOptimizer({
    api: game.api,
    config,
    cycleSeconds: 10,
    isAllowed: () => {
      checks += 1;
      return checks === 1;
    },
    write: null,
  });
  const result = optimizer.tick();

  assert.ok(checks > 1, 'the tick consulted the guard more than once');
  assert.equal(result.state, 'RUNNING');
  assert.deepEqual(game.calls.mutations, [], `a paused tick mutated: ${game.calls.mutations.map((call) => call.operation).join(', ')}`);
});
