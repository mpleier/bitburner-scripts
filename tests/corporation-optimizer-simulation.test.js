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

test('Market-TA.II is enabled per order, so the researched technology actually prices the sale', () => {
  const { simulation, metrics } = runOptimised();
  const calls = simulation.calls();
  const productEnables = calls.filter(call => call.fn === 'setProductMarketTA2');
  const materialEnables = calls.filter(call => call.fn === 'setMaterialMarketTA2');
  assert.ok(productEnables.length > 0, 'setProductMarketTA2 is issued once Market-TA.II is owned');
  assert.ok(materialEnables.length > 0, 'setMaterialMarketTA2 is issued for produced materials');

  // Every sell order written after the research landed is paired with exactly one enable call.
  const researchAt = calls.find(call => call.fn === 'research' && call.args[0] === 'Market-TA.II')?.at;
  assert.equal(typeof researchAt, 'number', 'the run does research Market-TA.II');
  const productSells = calls.filter(call => call.fn === 'sellProduct' && call.at >= researchAt && call.args[2] === 'MP');
  const materialSells = calls.filter(call => call.fn === 'sellMaterial' && call.at >= researchAt && call.args[2] === 'MP');
  assert.equal(productEnables.length, productSells.length, 'one setProductMarketTA2 per MP product sale');
  assert.equal(materialEnables.length, materialSells.length, 'one setMaterialMarketTA2 per MP material sale');
  assert.ok(productEnables.every(call => call.args[1] === true), 'the enable call passes `true`');

  // The products the loop sells at MP are the ones flagged as TA.II-priced.
  const sold = new Set(productSells.map(call => call.args[0]));
  const end = metrics.at(-1);
  assert.deepEqual([...end.ta2Enabled.products].sort(), [...sold].sort());
  assert.ok(end.ta2Enabled.materials.includes('Drugs'));
  assert.ok(end.profit > 1e6, `profit ${Math.round(end.profit)} relies on TA.II pricing`);
});

test('the simulation only pays the TA.II price once the flag is set, never for the research alone', () => {
  const simulation = createCorporationSimulation();
  simulation.state.ta2 = true; // Market-TA.II researched, not enabled
  const product = {
    name: 'Tobacco 1', developmentProgress: 100, rating: 1.5, effectiveRating: 1.5,
    designInvestment: 1e9, marketingInvestment: 0, productionCost: 100, stored: 1e6,
    productionAmount: 0, actualSellAmount: 0, desiredSellPrice: 'MP', desiredSellAmount: 'MAX',
    createdResearch: 0, createdEmployees: 9,
  };
  simulation.state.products.push(product);
  simulation.state.materials.Plants.stored = 0; // isolate product revenue from the Drugs line
  simulation.advance();
  const blind = simulation.state.revenue;
  assert.equal(simulation.state.products[0].desiredSellPrice, 'MP');

  simulation.api.setProductMarketTA2('Tobacco', 'Tobacco 1', true);
  simulation.state.products[0].stored = 1e6;
  simulation.state.materials.Plants.stored = 0;
  simulation.advance();
  const enabled = simulation.state.revenue - simulation.state.materials.Drugs.actualSellAmount * simulation.state.materials.Drugs.marketPrice;
  assert.ok(enabled > blind, `TA.II revenue ${Math.round(enabled)} must beat literal market price ${Math.round(blind)}`);
  assert.ok(Math.abs(enabled / blind - 1.6) < 0.01, 'the model pays the flagged 1.6x optimum');

  // Without the research the enable call is refused, exactly like the game.
  const unowned = createCorporationSimulation();
  assert.equal(unowned.api.setProductMarketTA2('Tobacco', 'Tobacco 1', true), false);
  assert.equal(unowned.state.ta2Products.size, 0);
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
