import test from 'node:test';
import assert from 'node:assert/strict';
import {redPillInfiltrationChoices} from '../red-pill-policy.js';

test('reputation trades are capped by the reputation gap, not by cash-convertible reputation', () => {
  const plan = {active: true, stage: 'fund-and-work', canDonate: true, remainingRep: 500, targetCash: 1000, worth: 0, repPerDollar: 0.001};
  const choices = redPillInfiltrationChoices([{name: 'X', reward: {tradeRep: 4000, sellCash: 1e6}}], plan);
  const reputation = choices.find(c => c.redPillReward === 'reputation');
  const money = choices.find(c => c.redPillReward === 'money');
  assert.equal(reputation.reward.tradeRep, 500, 'rep trade must not be limited to the cash-funded rep gap');
  assert.equal(money.reward.tradeRep, 1, 'money trade remains limited to what the remaining cash can buy');
});

test('unknown or inactive plans never offer infiltration rewards', () => {
  const plan = {active: false, stage: 'fund-and-work', remainingRep: 500};
  assert.deepEqual(redPillInfiltrationChoices([{name: 'X', reward: {tradeRep: 1}}], plan), []);
  assert.deepEqual(redPillInfiltrationChoices([{name: 'X', reward: {tradeRep: 1}}], {...plan, active: true, stage: 'buy'}), []);
});
