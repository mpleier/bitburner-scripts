import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyCorporationFlags,
  CITY_NAMES,
  CONFIG_PATH,
  CORPORATION_CONFIG_PATH,
  corporationBudgetLadder,
  defaultCorporationConfig,
  DEFAULT_CONFIG,
  loadConfig,
  loadCorporationConfig,
  mergeConfig,
  parseConfigText,
  parseFlags,
  validateConfig,
  validateCorporationConfig,
} from '../corporation-config.js';

const shipped = JSON.parse(readFileSync(new URL(`../${CORPORATION_CONFIG_PATH}`, import.meta.url), 'utf8'));

test('empty input yields the documented defaults without errors', () => {
  const { config, errors, warnings } = validateConfig({});
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(config.enabled, true);
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.bootstrap.cities, CITY_NAMES);
  assert.deepEqual(config.bootstrap.industryChain, ['Agriculture', 'Chemical', 'Tobacco']);
  assert.equal(config.bootstrap.initialOfficeSize, 9);
  assert.equal(config.finance.minOwnership, 0.5);
  assert.equal(config.budgets.reserveExpenseCycles, 2);
});

test('invalid JSON falls back to defaults and reports one error', () => {
  const { config, errors } = validateConfig('{"enabled": tru');
  assert.equal(config.enabled, DEFAULT_CONFIG.enabled);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'config.invalidJson');
});

test('a non-object root is rejected without throwing', () => {
  const { config, errors } = validateConfig('[1,2,3]');
  assert.equal(errors[0].code, 'config.invalid');
  assert.deepEqual(config.bootstrap.cities, CITY_NAMES);
  assert.deepEqual(parseConfigText('"text"').errors[0].code, 'config.invalid');
});

test('an unknown schemaVersion runs with defaults and reports it', () => {
  const { config, errors } = validateConfig({ schemaVersion: 99, enabled: false, bootstrap: { cities: ['Aevum'] } });
  assert.equal(config.enabled, true, 'unsupported version values are ignored');
  assert.deepEqual(config.bootstrap.cities, CITY_NAMES);
  assert.equal(errors[0].code, 'config.unsupportedVersion');
});

test('out-of-range values fall back per field and are reported', () => {
  const { config, errors } = validateConfig({
    bootstrap: { warehouseFullThreshold: 7, cities: ['Aevum', 'Nowhere'] },
    finance: { minOwnership: 0, ipoValuationFloor: 1 },
    telemetry: { cadenceMs: 5 },
  });
  assert.equal(config.bootstrap.warehouseFullThreshold, DEFAULT_CONFIG.bootstrap.warehouseFullThreshold);
  assert.deepEqual(config.bootstrap.cities, CITY_NAMES);
  assert.equal(config.finance.minOwnership, DEFAULT_CONFIG.finance.minOwnership);
  assert.equal(config.finance.ipoValuationFloor, DEFAULT_CONFIG.finance.ipoValuationFloor);
  assert.equal(config.telemetry.cadenceMs, DEFAULT_CONFIG.telemetry.cadenceMs);
  for (const error of errors) assert.equal(error.code, 'config.invalidField');
  assert.equal(errors.length, 5, 'threshold, cities, minOwnership, ipoValuationFloor, cadenceMs');
});

test('cross-field rules are repaired: investment floor cannot exceed minOwnership', () => {
  const { config, errors } = validateConfig({ finance: { minOwnership: 0.2, investmentMinOwnership: 0.6 } });
  assert.equal(config.finance.minOwnership, 0.2);
  assert.equal(config.finance.investmentMinOwnership, DEFAULT_CONFIG.finance.investmentMinOwnership);
  assert.ok(errors.some((error) => error.path === 'finance.investmentMinOwnership'));
});

test('science floor must exceed the abandon floor', () => {
  const { config, errors } = validateConfig({ product: { scienceFloor: 1.05, scienceAbandonFloor: 1.2 } });
  assert.equal(config.product.scienceFloor, DEFAULT_CONFIG.product.scienceFloor);
  assert.equal(config.product.scienceAbandonFloor, DEFAULT_CONFIG.product.scienceAbandonFloor);
  assert.ok(errors.some((error) => error.path === 'product.scienceFloor'));
});

test('unknown keys are ignored with a warning, nested ones included', () => {
  const { config, warnings } = validateConfig({ mystery: 1, bootstrap: { teleport: true } });
  assert.equal('mystery' in config, false);
  assert.equal('teleport' in config.bootstrap, false);
  assert.deepEqual(warnings.map((warning) => warning.path).sort(), ['bootstrap.teleport', 'mystery']);
});

test('flags map onto config paths and override the file', () => {
  const parsed = parseFlags(['--min-ownership=0.75', '--dry-run', '--expansion-speed']);
  assert.deepEqual(parsed.values, { 'finance.minOwnership': 0.75, dryRun: true });
  assert.deepEqual(parsed.unknown, ['--expansion-speed']);
  const { config, errors } = validateConfig({ dryRun: false, finance: { minOwnership: 0.5 } }, { flags: parsed.values });
  assert.equal(config.dryRun, true);
  assert.equal(config.finance.minOwnership, 0.75);
  assert.deepEqual(errors, []);
});

test('flags accept a separate value token and boolean strings', () => {
  const parsed = parseFlags(['--manage-shares', 'false', '--expand-all-industries', 'true', '--bribe-factions']);
  assert.equal(parsed.values['finance.manageShares'], false);
  assert.equal(parsed.values['bootstrap.expandAllIndustries'], true);
  assert.equal(parsed.values['finance.bribeFactions'], true);
});

test('an invalid flag value keeps the default and reports the path', () => {
  const { config, errors } = validateConfig({}, { flags: { 'finance.minOwnership': 4 } });
  assert.equal(config.finance.minOwnership, DEFAULT_CONFIG.finance.minOwnership);
  assert.equal(errors[0].code, 'config.invalidField');
  assert.equal(errors[0].path, 'finance.minOwnership');
});

test('mergeConfig deep merges without mutating the base', () => {
  const base = { a: { b: 1, c: 2 }, list: [1] };
  const merged = mergeConfig(base, { a: { c: 3 }, list: [2, 3] });
  assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [2, 3] });
  assert.deepEqual(base, { a: { b: 1, c: 2 }, list: [1] });
});

test('loadConfig reads the in-game file, tolerates a missing one, and never throws', () => {
  const files = {};
  const ns = {
    args: [],
    read: (path) => files[path] ?? '',
    write: (path, data) => {
      files[path] = data;
      return true;
    },
  };
  const missing = loadConfig(ns);
  assert.deepEqual(missing.errors, []);
  assert.equal(missing.config.bootstrap.initialOfficeSize, 9);

  files[CONFIG_PATH] = JSON.stringify({ dryRun: true, bootstrap: { cities: ['Aevum', 'Sector-12'] } });
  const loaded = loadConfig(ns);
  assert.equal(loaded.config.dryRun, true);
  assert.deepEqual(loaded.config.bootstrap.cities, ['Aevum', 'Sector-12']);

  const throwing = loadConfig({ args: [], read: () => { throw new Error('file system error'); } });
  assert.deepEqual(throwing.errors, []);
  assert.ok(throwing.warnings.some((warning) => warning.code === 'config.unreadable'));
});

test('loadConfig applies argv flags over the file', () => {
  const ns = { args: ['--dry-run'], read: () => JSON.stringify({ dryRun: false }) };
  const result = loadConfig(ns);
  assert.equal(result.config.dryRun, true);
});

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
