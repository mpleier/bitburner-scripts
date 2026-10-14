import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSleeves } from '../sleeve-expansion.js';
import { graftTick } from '../grafting-manager.js';
import { graftEconomics } from '../automation-policy.js';

test('sleeve purchase and memory upgrades share the reserved-wallet budget', () => {
  let money = 100;
  const sleeves = [{ memory: 99 }];
  const ns = {
    getResetInfo: () => ({ currentNode: 10 }), read: () => '20', getPlayer: () => ({ money }),
    sleeve: {
      getNumSleeves: () => sleeves.length, getSleeve: i => sleeves[i], getSleeveCost: () => 12,
      purchaseSleeve: () => { money -= 12; sleeves.push({ memory: 1 }); },
      getMemoryUpgradeCost: () => 3,
      upgradeMemory: (i, amount) => { money -= 3; sleeves[i].memory += amount; },
    },
  };
  const result = expandSleeves(ns, 0.2);
  assert.equal(result.bought, 1);
  assert.equal(result.upgraded, 1);
  assert.equal(money, 85);
  assert.equal(sleeves[0].memory, 100);
});

test('sleeve expansion does nothing outside BN10', () => {
  assert.equal(expandSleeves({ getResetInfo: () => ({ currentNode: 1 }) }).available, false);
});

function graftFixture(work = null) {
  const started = [], traveled = [];
  return { started, traveled, ns: {
    getResetInfo: () => ({ currentNode: 10, ownedSF: new Map([[4, 1]]), lastAugReset: Date.now() - 3600_000 }),
    getTotalScriptIncome: () => [1e6, 0], getMoneySources: () => ({ sinceInstall: {} }),
    ps: () => [], read: () => '10000000', getPlayer: () => ({ money: 100e6, city: 'Sector-12' }),
    singularity: {
      getCurrentWork: () => work,
      getOwnedAugmentations: () => ['Base', 'Queued'],
      getAugmentationPrereq: name => name === 'Blocked' ? ['Missing'] : ['Base'],
      getAugmentationStats: () => ({ hacking_money: 1.5 }),
      travelToCity: city => { traveled.push(city); return true; },
    },
    grafting: {
      getGraftableAugmentations: () => ['Queued', 'Blocked', 'Target'],
      getAugmentationGraftPrice: () => 20e6, getAugmentationGraftTime: () => 1000,
      graftAugmentation: name => { started.push(name); return true; },
    },
  } };
}

test('grafting selects eligible upgrades, respects prerequisites and ignores owned augmentations', () => {
  const f = graftFixture();
  assert.equal(graftTick(f.ns).status, 'started');
  assert.deepEqual(f.started, ['Target']);
  assert.deepEqual(f.traveled, ['New Tokyo']);
});

test('grafting preserves existing grafts and program creation', () => {
  for (const type of ['GRAFTING', 'CREATE_PROGRAM']) {
    const f = graftFixture({ type });
    assert.equal(graftTick(f.ns).status, 'busy');
    assert.equal(f.started.length, 0);
    assert.equal(f.traveled.length, 0);
  }
});

test('grafting waits for money and unavailable Source Files', () => {
  const f = graftFixture();
  assert.equal(graftTick(f.ns, 0).status, 'waiting');
  assert.equal(f.started.length, 0);
  assert.equal(graftTick({ getResetInfo: () => ({ currentNode: 1, ownedSF: new Map() }) }).status, 'unavailable');
});

test('grafting preserves a running Black Op', () => {
  const f = graftFixture();
  f.ns.bladeburner = { inBladeburner: () => true, getCurrentAction: () => ({ type: 'BlackOps' }) };
  assert.equal(graftTick(f.ns).status, 'busy');
  assert.equal(f.started.length, 0);
});

test('grafting rechecks cash after travel', () => {
  const f = graftFixture();
  let money = 100e6;
  f.ns.getPlayer = () => ({ money, city: 'Sector-12' });
  f.ns.singularity.travelToCity = () => { money = 1; return true; };
  assert.equal(graftTick(f.ns).status, 'waiting');
  assert.equal(f.started.length, 0);
});

test('grafting waits while casino or ascend is running', () => {
  for (const filename of ['casino.js', '/ascend.js']) {
    const f = graftFixture(); f.ns.ps = () => [{ filename, pid: 42 }];
    assert.equal(graftTick(f.ns).status, 'busy'); assert.equal(f.started.length, 0);
  }
});
test('grafting honors a live transition owner but ignores stale locks', () => {
  const f = graftFixture(); f.ns.ps = () => [{ filename: 'autopilot.js', pid: 42 }];
  let ownerPid = 42; f.ns.read = file => file.endsWith('.json') ? JSON.stringify({ ownerPid, expiresAt: Date.now() + 60000 }) : '10000000';
  assert.equal(graftTick(f.ns).status, 'busy'); ownerPid = 99;
  assert.equal(graftTick(f.ns).status, 'started');
});

test('grafting waits for queued augmentation installs and live reset plans', () => {
  const f = graftFixture();
  f.ns.singularity.getOwnedAugmentations = purchased => purchased ? ['Base', 'Queued'] : ['Base'];
  assert.equal(graftTick(f.ns).status, 'reset-pending');
  assert.equal(f.started.length, 0);
  f.ns.singularity.getOwnedAugmentations = purchased => purchased ? ['Base', 'NeuroFlux Governor', 'NeuroFlux Governor'] : ['Base', 'NeuroFlux Governor'];
  assert.equal(graftTick(f.ns).status, 'reset-pending');
  f.ns.singularity.getOwnedAugmentations = () => ['Base'];
  f.ns.ps = () => [{ pid: 42 }];
  f.ns.read = file => file === 'tasks/augmentation-reset-plan.json' ? JSON.stringify({ pending: true, ownerPid: 42, expiresAt: Date.now()+60000 }) : '';
  assert.equal(graftTick(f.ns).status, 'reset-pending');
  f.ns.ps = () => [];
  assert.equal(graftTick(f.ns).status, 'started');
});

test('grafting requires income evidence, valid budgets and bounded repayment', () => {
  const f = graftFixture();
  assert.equal(graftTick(f.ns, NaN).status, 'waiting');
  assert.equal(graftTick(f.ns, 0.25, 1).status, 'waiting');
  f.ns.getTotalScriptIncome = () => [0, 0];
  assert.equal(graftTick(f.ns).status, 'waiting');
});

test('graft economics charges entropy, focus time and interrupted cash income', () => {
  const input = { stats: { hacking_money: 1.25 }, cost: 1.35e9, duration: 1800_000, hackingIncome: 1e6 };
  const result = graftEconomics(input);
  assert.ok(Math.abs(result.incrementalIncome - 225000) < 1e-6);
  assert.equal(result.duration, 2250_000);
  assert.equal(result.eligible, true);
  const costly = graftEconomics({ ...input, rates: { infiltration: 1e6 } });
  assert.equal(costly.lostIncome, 2.25e9);
  assert.equal(costly.eligible, false);
  assert.ok(graftEconomics({ ...input, immune: true, focusImmune: true }).payback < result.payback);
  assert.equal(graftEconomics({ ...input, stats: { hacking_money: 1.03 } }).eligible, false);
});

test('Congruity pays back through entropy removal instead of an arbitrary priority', () => {
  const input = { stats: {}, congruity: true, cost: 150e12, duration: 900_000, hackingIncome: 1e12 };
  assert.equal(graftEconomics({ ...input, entropy: 0 }).eligible, false);
  assert.equal(graftEconomics({ ...input, entropy: 7 }).eligible, true);
});
