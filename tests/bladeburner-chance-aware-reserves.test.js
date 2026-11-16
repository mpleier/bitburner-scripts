import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bladeburnerRankSupply} from '../bladeburner-reserve-policy.js';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('population reserves gate rank farming only until the next Black Op is chance-ready', () => {
  const rank = 242468, maxRank = 250000;
  // Holding 200 in reserve leaves less than one whole action farmable at this rank.
  const reserved = {population: 200, maxRank, stealth: 20, guardReady: true};
  assert.equal(bladeburnerRankSupply('Tracking', 3, rank, reserved), 0);
  assert.equal(bladeburnerRankSupply('Investigation', 3, rank, reserved), 0);
  // Chance-ready: reserving population estimates is pointless, so every whole action supplies rank.
  const released = {population: 0, maxRank, stealth: 20, guardReady: true};
  assert.equal(bladeburnerRankSupply('Tracking', 3, rank, released), 3);
  assert.equal(bladeburnerRankSupply('Investigation', 3, rank, released), 3);
  assert.equal(bladeburnerRankSupply('Undercover Operation', 1, rank, released), 1);
  // Chaos protection is unaffected by releasing the population reserve.
  assert.equal(bladeburnerRankSupply('Stealth Retirement Operation', 5, rank, released), 0, 'stealth stock still needs its guard lease');
  assert.equal(bladeburnerRankSupply('Tracking', 0, rank, released), 0);
});

test('the manager reads the Black Op chance before choosing reserves', () => {
  const text = source('bladeburner.js');
  const chance = text.indexOf('getActionEstimatedSuccessChance(ns.args[0], ns.args[1])');
  const reserves = text.indexOf("const rankReserves={stealth:stockReserve,population:nextBlackOpChanceReady?0:");
  assert.ok(chance > 0, 'the Black Op chance must be measured');
  assert.ok(reserves > chance, 'the reserve choice must follow that measurement');
  assert.match(text, /blackOpChanceCache=\{name:nextBlackOp,at:Date\.now\(\),ready:Array\.isArray\(chance\)/);
  // The quote is cached: one RAM-dodged call per half minute, not per two-second tick.
  assert.match(text, /Date\.now\(\)-blackOpChanceCache\.at>30000/);
});
