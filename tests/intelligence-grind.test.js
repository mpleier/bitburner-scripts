import test from 'node:test';
import assert from 'node:assert/strict';
import {intelligenceLevelForExp,intelligenceExpForLevel,intelligencePerReset,neurofluxPlan,intelligenceGrindPlan,programIntExp,programWorkSeconds,PROGRAM_INT_PER_SECOND} from '../intelligence-grind-policy.js';

test('the level curve matches the game formula and the live save', () => {
  assert.equal(intelligenceLevelForExp(0), 1);
  // exp 118794 is this run's intelligence exp, which the game reports as level 174
  assert.equal(intelligenceLevelForExp(118794), 174);
  for (const level of [5, 20, 50, 100, 174]) assert.ok(Math.abs(intelligenceLevelForExp(intelligenceExpForLevel(level)) - level) <= 1, 'round trip at ' + level);
  assert.equal(intelligenceLevelForExp(intelligenceExpForLevel(200)) < 200, false);
});

test('one reset is worth the install plus every purchased augmentation', () => {
  assert.equal(intelligencePerReset(0), 15);
  assert.equal(intelligencePerReset(8), 135);
  assert.equal(intelligencePerReset(-3), 15);
});

test('neuroflux purchases are limited by the escalating price, not by the wallet alone', () => {
  const plan = neurofluxPlan({price: 1e6, money: 1e7});
  assert.equal(plan.affordable, 6);
  assert.equal(plan.exp, plan.affordable * 15);
  assert.ok(plan.cost <= 1e7);
  assert.ok(plan.dearest > plan.cheapest);
  assert.deepEqual(neurofluxPlan({price: 0, money: 1e9}).affordable, 0);
});

test('a plan converts a target level into resets and hours with no invented rates', () => {
  const plan = intelligenceGrindPlan({exp: 118794, targetLevel: 180, augsPerReset: 8, resetsPerHour: 1});
  assert.equal(plan.level, 174);
  assert.equal(plan.perReset, 135);
  assert.ok(plan.expToTarget > 0);
  assert.equal(plan.resetsNeeded, Math.ceil(plan.expToTarget / 135));
  assert.ok(Math.abs(plan.hoursToTarget - plan.expToTarget / 135) < 1e-9);
  // Without a measured cycle rate the plan must not invent one.
  assert.equal(intelligenceGrindPlan({exp: 1000, targetLevel: 20}).hoursToTarget, null);
});

test('create program pays a flat 0.1 int exp per second no matter which program or skill level', () => {
  assert.equal(PROGRAM_INT_PER_SECOND, 0.1);
  const ms = 4 * 3600 * 1000; // sqlInject's base work time
  for (const skillMult of [1, 1.2, 3]) {
    const exp = programIntExp({timeMs: ms, skillMult});
    const seconds = programWorkSeconds({timeMs: ms, skillMult});
    assert.ok(Math.abs(exp / seconds - 0.1) < 1e-12, 'rate is invariant at mult ' + skillMult);
  }
  assert.equal(programIntExp({timeMs: ms, skillMult: 1}), 1440);
  assert.equal(programIntExp({timeMs: ms, skillMult: 2}), 720);
  assert.equal(programIntExp({timeMs: 0}).valueOf(), 0);
  assert.equal(programIntExp({timeMs: NaN, skillMult: NaN}), 0);
});
