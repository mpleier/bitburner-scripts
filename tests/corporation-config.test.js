import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyCorporationFlags,
  CORPORATION_CONFIG_PATH,
  corporationBudgetLadder,
  defaultCorporationConfig,
  loadCorporationConfig,
  validateCorporationConfig,
} from '../corporation-config.js';

const shipped = JSON.parse(readFileSync(new URL(`../${CORPORATION_CONFIG_PATH}`, import.meta.url), 'utf8'));

test('the shipped config file validates without errors or warnings', () => {
  const { config, errors, warnings, report } = validateCorporationConfig(shipped);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(report, []);
  const defaults = defaultCorporationConfig();
  assert.equal(config.schemaVersion, defaults.schemaVersion);
  assert.deepEqual(config.people.officeTargets, defaults.people.officeTargets);
  assert.deepEqual(config.finance.dividendTiers, defaults.finance.dividendTiers);
  assert.equal(config.product.scienceFloor, 1.15);
  assert.equal(config.market.maxAdVerts.products, 20);
});

test('invalid values fall back to their defaults and are reported', () => {
  const { config, errors, report } = validateCorporationConfig({
    dryRun: 'yes',
    product: { scienceFloor: 1.05, scienceAbandonFloor: 1.2 },
    finance: { minOwnership: 2, investmentMinOwnership: 0.9 },
    bootstrap: { cities: ['Sector-12', 'Atlantis'] },
    budgets: { reserveCap: 100, reserveFloor: 1e6 },
    people: { officeTargets: { materials: [9, 3] } },
  });
  const paths = errors.map(error => error.path);
  assert.ok(paths.includes('dryRun'));
  assert.ok(paths.includes('product.scienceFloor'));
  assert.ok(paths.includes('finance.minOwnership'));
  assert.ok(paths.includes('bootstrap.cities'));
  assert.ok(paths.includes('budgets.reserveCap'));
  assert.ok(paths.includes('people.officeTargets.materials'));
  assert.equal(config.dryRun, false);
  assert.equal(config.product.scienceFloor, 1.15);
  assert.equal(config.finance.minOwnership, 0.5);
  assert.deepEqual(config.bootstrap.cities, defaultCorporationConfig().bootstrap.cities);
  assert.ok(report.length >= 5);
});

test('unknown keys are warned about and ignored', () => {
  const { config, warnings } = validateCorporationConfig({ mystery: true, product: { unknownThing: 4 } });
  assert.equal(warnings.length, 2);
  assert.equal(config.mystery, undefined);
  assert.equal(config.product.unknownThing, undefined);
});

test('a newer schema version runs with defaults and reports it', () => {
  const { config, errors, report } = validateCorporationConfig({ schemaVersion: 99, dryRun: true });
  assert.equal(config.dryRun, false, 'defaults are used instead of a partial migration');
  assert.ok(errors.some(error => error.path === 'schemaVersion'));
  assert.ok(report.includes('config.unsupportedVersion'));
});

test('invalid JSON and a missing file both fall back to defaults without throwing', () => {
  const broken = loadCorporationConfig({ read: () => '{not json' });
  assert.ok(broken.errors.some(error => /not valid JSON/.test(error.message)));
  assert.equal(broken.config.product.scienceFloor, 1.15);

  const missing = loadCorporationConfig({ read: () => '' });
  assert.deepEqual(missing.errors, []);
  assert.equal(missing.config.enabled, true);

  const exploding = loadCorporationConfig({ read: () => { throw new Error('read failed'); } });
  assert.equal(exploding.config.schemaVersion, 1);
});

test('legacy flags override the file and invalid flags are ignored', () => {
  const { config, errors } = loadCorporationConfig({
    read: () => JSON.stringify({ dryRun: false, product: { developmentSpeed: false }, finance: { minOwnership: 0.6 } }),
    flags: {
      'development-speed': true,
      'min-ownership': '0.75',
      'investment-min-ownership': 0.2,
      'dry-run': 'true',
      'bribe-factions': 'false',
      'manage-shares': false,
      'expand-all-industries': true,
      'not-a-flag': true,
    },
  });
  assert.equal(config.product.developmentSpeed, true);
  assert.equal(config.finance.minOwnership, 0.75);
  assert.equal(config.finance.investmentMinOwnership, 0.2);
  assert.equal(config.dryRun, true);
  assert.equal(config.finance.bribeFactions, false);
  assert.equal(config.finance.manageShares, false);
  assert.equal(config.bootstrap.expandAllIndustries, true);
  assert.deepEqual(errors, []);

  const invalid = applyCorporationFlags(defaultCorporationConfig(), { 'min-ownership': 'lots' }, { errors: [], report: [] });
  assert.equal(invalid.finance.minOwnership, 0.5);
});

test('a flag cannot push investment ownership above the general floor', () => {
  const base = defaultCorporationConfig();
  const errors = [];
  const config = applyCorporationFlags(base, { 'min-ownership': 0.3, 'investment-min-ownership': 0.4 }, { errors, report: [] });
  assert.equal(config.finance.minOwnership, 0.3);
  assert.equal(config.finance.investmentMinOwnership, 0.1, 'the pair is restored when flags conflict');
  assert.ok(errors.some(error => error.path === 'finance.investmentMinOwnership'));
});

test('the budget ladder keeps a reserve and freezes discretionary spend in recovery', () => {
  const config = defaultCorporationConfig();
  const info = { funds: 50e9, revenue: 2e4, expenses: 1e4 };
  const ladder = corporationBudgetLadder(info, config, { growthBank: 1e9, cycleSeconds: 10 });
  assert.equal(ladder.reserve, 5e9, 'the reserve cap applies to a large treasury');
  assert.equal(ladder.free, 45e9);
  assert.equal(ladder.profit, 1e5);
  assert.equal(ladder.growth, 1e9 + 1e5 * 0.25, 'an idle growth bank only accrues profit');
  assert.ok(ladder.boost <= ladder.free);

  const developing = corporationBudgetLadder(info, config, { growthBank: 1e9, cycleSeconds: 10, developing: true });
  assert.ok(developing.growth >= 45e9 * 0.15, 'a developing corporation may use 15% of free cash');

  const frozen = corporationBudgetLadder(info, config, { growthBank: 1e9, cycleSeconds: 10, recovering: true });
  assert.equal(frozen.upkeep, 0);
  assert.equal(frozen.growth, 0);
  assert.equal(frozen.boost, 0);

  const small = corporationBudgetLadder({ funds: 1e4, revenue: 0, expenses: 0 }, config, { cycleSeconds: 10 });
  assert.equal(small.reserve, 1e6, 'the reserve floor applies to a tiny treasury');
  assert.equal(small.free, 0);
});
