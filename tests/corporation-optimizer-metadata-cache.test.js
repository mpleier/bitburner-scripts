import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import {
  createCorporationMetadataCache,
  createCorporationOptimizer,
  readCorporationSnapshot,
} from '../corporation-optimizer.js';
import { createCorporationSimulation, runSimulation } from './fixtures/corporation-sim.js';

const countCalls = (api, names) => {
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  for (const name of names) {
    const original = api[name];
    if (typeof original !== 'function') continue;
    api[name] = (...args) => { counts[name]++; return original(...args); };
  }
  return counts;
};

test('immutable metadata is quoted once per instance instead of once per tick', () => {
  const settings = defaultCorporationConfig();
  const sim = createCorporationSimulation({ config: settings });
  const reads = countCalls(sim.api, ['getMaterialData', 'getResearchCost', 'getUpgradeLevelCost']);
  const cache = createCorporationMetadataCache(sim.api);
  for (let tick = 0; tick < 3; tick++) {
    const snapshot = readCorporationSnapshot(sim.api, { metadata: cache });
    assert.equal(snapshot.divisions.length, 1);
  }
  assert.equal(reads.getMaterialData, 6, 'material metadata is quoted once per material');
  assert.equal(reads.getResearchCost, 17, 'research costs are quoted once per research item');
  assert.equal(reads.getUpgradeLevelCost, 8, 'upgrade quotes are cached by level');
  assert.equal(cache.materialData('Plants'), cache.materialData('Plants'));
  assert.equal(reads.getMaterialData, 6, 'repeat reads are served from the cache');
});

test('the uncached snapshot path still re-quotes metadata on every read', () => {
  const settings = defaultCorporationConfig();
  const sim = createCorporationSimulation({ config: settings });
  const reads = countCalls(sim.api, ['getMaterialData', 'getResearchCost', 'getUpgradeLevelCost']);
  for (let tick = 0; tick < 3; tick++) readCorporationSnapshot(sim.api);
  assert.equal(reads.getMaterialData, 18);
  assert.equal(reads.getResearchCost, 51);
  assert.equal(reads.getUpgradeLevelCost, 24);
});

test('upgrade quotes are level-keyed and research costs invalidate after a purchase', () => {
  const sim = createCorporationSimulation();
  let level = 0;
  let upgradeQuotes = 0;
  sim.api.getUpgradeLevelCost = () => { upgradeQuotes++; return (level + 1) * 100; };
  const cache = createCorporationMetadataCache(sim.api);

  assert.equal(cache.upgradeCost('Smart Factories', 0), 100);
  assert.equal(cache.upgradeCost('Smart Factories', 0), 100);
  assert.equal(upgradeQuotes, 1);
  level = 1;
  assert.equal(cache.upgradeCost('Smart Factories', 1), 200, 'a level change forces a fresh quote');
  assert.equal(upgradeQuotes, 2);

  const reads = countCalls(sim.api, ['getResearchCost']);
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000);
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000);
  assert.equal(reads.getResearchCost, 1);
  cache.invalidateResearch('Tobacco');
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000, 'invalidation re-quotes the division');
  assert.equal(reads.getResearchCost, 2);
  cache.invalidateResearch('Other Division');
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000);
  assert.equal(reads.getResearchCost, 2, 'invalidation is scoped to one division');
});

test('cached and uncached optimizers make identical decisions and reach the same outcome', () => {
  const settings = defaultCorporationConfig();
  const run = cacheMetadata => {
    const sim = createCorporationSimulation({ config: settings });
    const decisions = [];
    const optimizer = createCorporationOptimizer({
      api: sim.api, config: settings, cycleSeconds: 10, clock: () => sim.state.at,
      log: () => {}, write: () => {}, cacheMetadata, onDecision: row => decisions.push(row),
    });
    const metrics = runSimulation({ steps: 80, simulation: sim, optimizer });
    return { decisions, metrics, calls: sim.calls() };
  };
  const cached = run(true);
  const uncached = run(false);
  assert.deepEqual(cached.decisions, uncached.decisions, 'every decision matches the uncached path');
  assert.deepEqual(cached.calls, uncached.calls, 'every game action matches the uncached path');
  assert.deepEqual(cached.metrics.at(-1), uncached.metrics.at(-1), 'the final outcome is unchanged');
});

test('division-varying research quotes stay distinct under the cache', () => {
  const sim = createCorporationSimulation();
  sim.api.getResearchCost = division => (division === 'Tobacco' ? 100 : 200);
  const cache = createCorporationMetadataCache(sim.api);
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 100);
  assert.equal(cache.researchCost('Other', 'Drones'), 200, 'a different division gets its own quote');
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 100, 'each division quote is cached separately');
  assert.equal(cache.researchCost('Other', 'Drones'), 200);
});

test('a transient metadata quote failure is retried, not cached forever', () => {
  const sim = createCorporationSimulation();
  const cache = createCorporationMetadataCache(sim.api);
  const failFirstCall = name => {
    const original = sim.api[name];
    let calls = 0;
    sim.api[name] = (...args) => {
      calls++;
      if (calls === 1) throw new Error('transient API failure');
      return original(...args);
    };
    return () => calls;
  };

  const researchCalls = failFirstCall('getResearchCost');
  assert.ok(Number.isNaN(cache.researchCost('Tobacco', 'Drones')), 'the failed tick sees the uncached fallback');
  assert.equal(cache.failedQuotes, 1, 'the failure is counted');
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000, 'the recovered quote is re-quoted next tick');
  assert.equal(researchCalls(), 2);
  assert.equal(cache.researchCost('Tobacco', 'Drones'), 2000);
  assert.equal(researchCalls(), 2, 'the successful quote is cached from then on');

  const upgradeCalls = failFirstCall('getUpgradeLevelCost');
  assert.ok(Number.isNaN(cache.upgradeCost('Smart Factories', 0)));
  assert.equal(cache.upgradeCost('Smart Factories', 0), 2e9);
  assert.equal(upgradeCalls(), 2, 'a failed upgrade quote is retried too');

  const materialCalls = failFirstCall('getMaterialData');
  assert.equal(cache.materialData('Plants'), null);
  assert.deepEqual(cache.materialData('Plants'), { name: 'Plants', size: 0.05, baseMarkup: 5 });
  assert.equal(materialCalls(), 2, 'a failed material quote is retried too');
  assert.equal(cache.failedQuotes, 3);
});

test('one transient research-cost throw leaves cached decisions identical to uncached', () => {
  const settings = defaultCorporationConfig();
  const run = cacheMetadata => {
    const sim = createCorporationSimulation({ config: settings });
    const original = sim.api.getResearchCost;
    let thrown = false;
    sim.api.getResearchCost = (...args) => {
      if (!thrown) { thrown = true; throw new Error('transient API failure'); }
      return original(...args);
    };
    const decisions = [];
    const optimizer = createCorporationOptimizer({
      api: sim.api, config: settings, cycleSeconds: 10, clock: () => sim.state.at,
      log: () => {}, write: () => {}, cacheMetadata, onDecision: row => decisions.push(row),
    });
    const metrics = runSimulation({ steps: 80, simulation: sim, optimizer });
    return { decisions, metrics: metrics.at(-1), calls: sim.calls() };
  };
  assert.deepEqual(run(true), run(false), 'no decision/action/outcome drift after a recovered API failure');
});
