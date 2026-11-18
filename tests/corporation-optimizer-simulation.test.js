import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import { createCorporationOptimizer, RESEARCH_PRIORITY } from '../corporation-optimizer.js';
import { createCorporationSimulation, runSimulation } from './fixtures/corporation-sim.js';

/**
 * Acceptance evidence for the optimisation loop (spec §11.6-§11.12).
 *
 * The comparison is run on the deterministic simulation in tests/fixtures/corporation-sim.js:
 * the same starting save, the same number of corporation cycles, one run with the optimiser
 * and one do-nothing baseline. The simulation is a model of the game, not the game itself;
 * the live smoke check stays a separate manual step (spec §11.17).
 */

const STEPS = 400;

function runOptimised(config = defaultCorporationConfig(), steps = STEPS) {
  const simulation = createCorporationSimulation({ config });
  const logs = [];
  const results = [];
  const optimizer = createCorporationOptimizer({
    api: simulation.api, config, cycleSeconds: 10, clock: () => simulation.state.at,
    log: (level, message) => logs.push({ level, message, at: simulation.state.at }),
    write: (path, contents) => { results.push({ path, contents }); },
  });
  const metrics = runSimulation({ steps, simulation, optimizer });
  return { simulation, optimizer, logs, metrics, writes: results };
}

test('the optimisation loop beats a do-nothing baseline on profit, valuation and product quality', () => {
  const config = defaultCorporationConfig();
  const optimised = runOptimised(config);
  const baselineSimulation = createCorporationSimulation({ config });
  const baseline = runSimulation({ steps: STEPS, simulation: baselineSimulation });

  const end = optimised.metrics.at(-1);
  const base = baseline.at(-1);

  // Product quality: the optimiser researches to the science floor, designs a product and develops it.
  assert.ok(end.products.length >= 1, 'the optimiser created at least one product');
  assert.ok(end.bestRating >= 1.5, `product quality ${end.bestRating.toFixed(2)} should beat a bare 1.0 product`);
  assert.equal(base.products.length, 0, 'the baseline never starts a product');
  assert.equal(base.bestRating, 0);

  // Profit: the product line and TA pricing turn a salary-burning shell into a profitable division.
  assert.ok(end.revenue > 1e5, `revenue ${Math.round(end.revenue)} per cycle should be substantial`);
  assert.ok(end.profit > 1e5, `profit ${Math.round(end.profit)} per cycle should be positive`);
  assert.ok(end.profit > base.profit + 1e5, 'profit must beat the baseline');

  // Valuation: cash plus a profit multiple, so investment only pays off if the run is productive.
  assert.ok(end.valuation > base.valuation, `valuation ${Math.round(end.valuation)} must beat ${Math.round(base.valuation)}`);

  // Research priority: the TA.I + TA.II package eventually lands.
  assert.equal(end.ta2, true, 'the optimiser buys the Market-TA pricing package');

  // Capital discipline: no purchase ever takes the corporation under its reserve, in either run.
  assert.ok(end.minReserveMargin >= 0, `reserve margin ${Math.round(end.minReserveMargin)} must stay non-negative`);
  const worst = optimised.metrics.reduce((min, row) => Math.min(min, row.minReserveMargin), Infinity);
  assert.ok(worst >= 0, 'the reserve invariant holds on every simulated cycle');
});

test('the loop is idempotent: research is bought once and product slots are never overrun', () => {
  const { simulation, optimizer, metrics } = runOptimised();
  const research = simulation.calls().filter(call => call.fn === 'research').map(call => call.args[0]);
  assert.equal(research.length, new Set(research).size, 'no research is purchased twice');
  assert.ok(research.length >= 2, 'the loop does buy research');
  assert.ok(research.includes('Market-TA.II'));

  const created = simulation.calls().filter(call => call.fn === 'makeProduct').map(call => call.args[0]);
  assert.equal(created.length, new Set(created).size, 'a product name is never reused');
  assert.ok(created.length <= 3, 'the division never exceeds its three product slots');
  assert.ok(metrics.every(row => row.products.length <= 3));

  const sizes = metrics.map(row => row.officeSize);
  assert.ok(sizes.every((size, index) => index === 0 || size >= sizes[index - 1]), 'offices never shrink');
  assert.ok(Math.max(...sizes) <= 120, 'office growth respects the configured product target');

  // A settled corporation performs no further purchases of the same research or product.
  const before = { research: simulation.callCount('research'), products: simulation.callCount('makeProduct') };
  optimizer.tick();
  assert.equal(simulation.callCount('research'), before.research);
  assert.equal(simulation.callCount('makeProduct'), before.products);
});

test('a 400-cycle unattended run has no persistent failures and no unhandled exceptions', () => {
  const config = defaultCorporationConfig();
  const simulation = createCorporationSimulation({ config });
  const optimizer = createCorporationOptimizer({ api: simulation.api, config, clock: () => simulation.state.at });
  const failures = [];
  assert.doesNotThrow(() => {
    for (let step = 0; step < STEPS; step++) {
      const result = optimizer.tick();
      failures.push(...result.telemetry.persistentFailures);
      simulation.advance();
    }
  });
  const serious = failures.filter(failure => failure.count >= 2);
  assert.deepEqual(serious, [], 'no operation failed twice in a row against a healthy API');
});

test('the optimiser is deterministic: the same save and config produce the same outcome', () => {
  const first = runOptimised(defaultCorporationConfig(), 120);
  const second = runOptimised(defaultCorporationConfig(), 120);
  const a = first.metrics.at(-1);
  const b = second.metrics.at(-1);
  assert.equal(a.funds, b.funds);
  assert.equal(a.bestRating, b.bestRating);
  assert.equal(a.products.length, b.products.length);
  assert.deepEqual(first.simulation.calls().map(call => call.fn), second.simulation.calls().map(call => call.fn));
});

test('recovery mode stops buying but keeps selling and never drains the reserve', () => {
  const config = defaultCorporationConfig();
  const simulation = createCorporationSimulation({ config });
  const optimizer = createCorporationOptimizer({ api: simulation.api, config, clock: () => simulation.state.at });
  // Force a loss-making corporation: the margin streak must trip recovery within ten cycles.
  for (let step = 0; step < 12; step++) {
    simulation.state.revenue = 10;
    simulation.state.expenses = 50000;
    optimizer.tick();
    simulation.state.revenue = 10;
    simulation.state.expenses = 50000;
    simulation.advance();
    simulation.state.revenue = 10;
    simulation.state.expenses = 50000;
  }
  const result = optimizer.tick();
  assert.equal(result.telemetry.state, 'RECOVERY');
  const expensive = result.decisions.filter(row => ['upgrade', 'advert', 'product', 'warehouse', 'boost'].includes(row.kind) && row.state === 'purchased');
  assert.deepEqual(expensive, []);
  assert.ok(result.decisions.some(row => row.kind === 'sell'), 'selling is a survival action and continues');
});

test('the research catalogue is ordered laboratory first and pricing second', () => {
  assert.equal(RESEARCH_PRIORITY[0], 'Hi-Tech R&D Laboratory');
  assert.ok(RESEARCH_PRIORITY.indexOf('Market-TA.I') < RESEARCH_PRIORITY.indexOf('Market-TA.II'));
  assert.ok(RESEARCH_PRIORITY.indexOf('Market-TA.II') < RESEARCH_PRIORITY.indexOf('Self-Correcting Assemblers'));
});
