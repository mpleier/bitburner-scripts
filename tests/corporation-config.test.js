import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  CITY_NAMES,
  loadConfig,
  mergeConfig,
  parseConfigText,
  parseFlags,
  validateConfig,
} from '../corporation-config.js';

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
