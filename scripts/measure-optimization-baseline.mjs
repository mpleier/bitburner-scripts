#!/usr/bin/env node
/**
 * Reproducible acceptance-criteria measurement for Corporation automation.
 *
 * Usage (from repo root or anywhere):
 *   node scripts/measure-optimization-baseline.mjs          # print JSON report
 *   node scripts/measure-optimization-baseline.mjs --check  # exit 1 on fingerprint drift
 *
 * The deterministic 400-cycle simulation in tests/fixtures/corporation-sim.js is a MODEL,
 * not the live game; this script measures decision/outcome equivalence and harness latency.
 * Live smoke remains a separate manual step.
 */
import { performance } from 'node:perf_hooks';
import { defaultCorporationConfig } from '../corporation-config.js';
import { createCorporationOptimizer } from '../corporation-optimizer.js';
import { createCorporationSimulation, runSimulation } from '../tests/fixtures/corporation-sim.js';

const STEPS = 400;
const RUNS = 7;

// Locked pre-change baseline (2026-11-18, task t_8cbf34eb). Do not edit to make --check pass.
const BASELINE = Object.freeze({
  revenue: 2356823.482729898,
  profit: 2344323.482729898,
  valuation: 83799537281.51758,
  bestRating: 1.8164556184142882,
  products: 3,
});
const DO_NOTHING = Object.freeze({
  revenue: 0, profit: -4100, valuation: 49998766000, bestRating: 0, products: 0,
});

function runOptimised(config) {
  const simulation = createCorporationSimulation({ config });
  const optimizer = createCorporationOptimizer({
    api: simulation.api, config, cycleSeconds: 10, clock: () => simulation.state.at,
    log: () => {}, write: () => {},
  });
  const t0 = performance.now();
  const metrics = runSimulation({ steps: STEPS, simulation, optimizer });
  return { metrics, ms: performance.now() - t0 };
}

function runDoNothing(config) {
  const simulation = createCorporationSimulation({ config });
  const t0 = performance.now();
  const metrics = runSimulation({ steps: STEPS, simulation });
  return { metrics, ms: performance.now() - t0 };
}

const fingerprint = (m) => ({
  revenue: m.revenue, profit: m.profit, valuation: m.valuation,
  bestRating: m.bestRating, products: m.products.length,
});

const config = defaultCorporationConfig();
const samples = Array.from({ length: RUNS }, () => runOptimised(config).ms).sort((a, b) => a - b);
const optimized = runOptimised(config);
const doNothing = runDoNothing(config);
const actual = fingerprint(optimized.metrics.at(-1));
const match = Object.keys(BASELINE).every((key) => Object.is(actual[key], BASELINE[key]));
const median = samples[Math.floor(RUNS / 2)];

console.log(JSON.stringify({
  steps: STEPS, runs: RUNS,
  optimizedFingerprint: actual,
  lockedBaseline: BASELINE,
  fingerprintMatch: match,
  doNothingFingerprint: fingerprint(doNothing.metrics.at(-1)),
  lockedDoNothing: DO_NOTHING,
  wallMs: {
    medianTotal: +median.toFixed(2),
    minTotal: +samples[0].toFixed(2),
    maxTotal: +samples.at(-1).toFixed(2),
    medianPerCycle: +(median / STEPS).toFixed(3),
  },
}, null, 2));

if (process.argv.includes('--check') && !match) {
  console.error('\nFINGERPRINT MISMATCH: deterministic outcomes changed. '
    + 'An optimization must reproduce the baseline unless a behaviour change is explicitly approved '
    + '(docs/optimization-acceptance-criteria.md, metric M17).');
  process.exit(1);
}
