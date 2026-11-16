import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('a formula that can go negative exports nothing, so the route must be positive', () => {
  // Division.ts: amt = evaluateCorpFormula(...) * secondsPerMarketCycle * marketCycles; then `if (amt <= 0) continue;`
  const src = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  const formula = src.match(/const EXPORT_FORMULA = "([^"]+)";/)?.[1];
  assert.ok(formula, 'export formula must exist');
  assert.doesNotMatch(formula, /\)\s*\*\s*\(-1\)|^-/, 'a negated export formula is silently skipped by the game');
  assert.match(formula, /\bEPROD\b/, 'export must be driven by this division\'s own production');
  const evaluate = new Function('EPROD', 'EINV', 'IPROD', 'IINV', `return ${formula};`);
  assert.ok(evaluate(100, 0, 0, 0) > 0, 'steady production must export');
  assert.ok(evaluate(0, 500, 0, 0) > 0, 'a stocked warehouse must drain');
  assert.equal(evaluate(0, 0, 999, 999), 0, 'an idle, empty source exports nothing');
});

