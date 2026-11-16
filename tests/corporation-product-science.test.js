import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corporationProductScience,corporationProductScienceMinimum,corporationProductScienceHopeless} from '../corporation-policy.js';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('product science uses the game formula and stays a rounding error at the live research level', () => {
  // src/Corporation/Product.ts:147 — sciMult = 1 + researchPoints^scienceFactor / 800
  assert.equal(corporationProductScience({points: 0}), 1);
  assert.equal(corporationProductScience({points: 10000, scienceFactor: 0.5}), 1.125);
  assert.equal(corporationProductScience({points: 40000, scienceFactor: 0.5}), 1.25);
  // The live Tobacco division sits at 87 research points: a 1.2% product cannot repay a $36.6m design cheque.
  assert.ok(corporationProductScience({points: 87, scienceFactor: 0.5}) < 1.02);
  assert.ok(corporationProductScience({points: 87, scienceFactor: 0.5}) < corporationProductScienceHopeless);
  assert.ok(corporationProductScienceHopeless < corporationProductScienceMinimum);
  assert.equal(corporationProductScience({points: NaN, scienceFactor: NaN}), 1);
});

test('the manager will not start or keep a product whose science cannot repay it', () => {
  const manager = source('corporation-manager.js');
  const gate = manager.indexOf('if(science<corporationProductScienceMinimum){');
  const start = manager.indexOf("capitalPurchase('Develop '+division+'/'+name");
  assert.ok(gate > 0, 'the product start must be gated on science');
  assert.ok(start > gate, 'the gate must run before makeProduct is scheduled');
  assert.match(manager, /if\(science<corporationProductScienceHopeless\)\{/);
  assert.match(manager, /discontinueProduct\(division,pending\.name\)/);
  // The frozen-at-creation warning must point at the real formula, not an invented number.
  assert.match(manager, /sciMult = 1 \+ RP\^scienceFactor\/800/);
});

test('the product science gate sits at a reachable level, not an aspirational one', () => {
  // The engine has no science floor; this constant is our quality bar, so pin it and the points it implies.
  assert.equal(corporationProductScienceMinimum, 1.15);
  const factor = 0.642; // Tobacco, derived from the live 1.113 reading at 1,113 points.
  const pointsFor = mul => Math.round((800 * (mul - 1)) ** (1 / factor));
  // 1.15 must be reachable from the live research level, and 1.10 stays the hopeless line.
  assert.ok(pointsFor(corporationProductScienceMinimum) < 2000, 'gate needs more than 2,000 points');
  assert.ok(corporationProductScienceMinimum > corporationProductScienceHopeless);
  assert.ok(corporationProductScience({points: 1113, scienceFactor: factor}) > 1.1);
  assert.ok(corporationProductScience({points: 1750, scienceFactor: factor}) >= corporationProductScienceMinimum);
});
