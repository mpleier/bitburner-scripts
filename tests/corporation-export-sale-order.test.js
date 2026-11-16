import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manager = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');

test('export runs before sale, so exported material is still sold as surplus', () => {
  // stateNames = ["START", "PURCHASE", "PRODUCTION", "EXPORT", "SALE"] (Corporation/data/Constants.ts:25):
  // the route takes its share first, and the SALE state only sees what is left. Suppressing the sale would
  // throw revenue away, so the source division keeps selling at MAX.
  assert.doesNotMatch(manager, /materialIsExported/);
  const loop = manager.indexOf('const item = safe(`Read ${material} sale`');
  const sell = manager.indexOf('c.sellMaterial(division, city, material, "MAX", price)', loop);
  assert.ok(loop > 0 && sell > loop, 'the sale must still run for every material in the list');
});

test('the export formula still evaluates to a positive rate the game will act on', () => {
  const formula = manager.match(/const EXPORT_FORMULA = "([^"]+)";/)?.[1];
  assert.ok(formula, 'export formula must exist');
  const evaluate = new Function('EPROD', 'EINV', 'IPROD', 'IINV', `return ${formula};`);
  assert.ok(evaluate(100, 0, 0, 0) > 0, 'production is exported');
  assert.ok(evaluate(0, 500, 0, 0) > 0, 'a stocked warehouse drains');
  assert.equal(evaluate(0, 0, 999, 999), 0, 'an idle empty source exports nothing');
});
