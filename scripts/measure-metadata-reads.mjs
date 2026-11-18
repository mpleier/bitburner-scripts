#!/usr/bin/env node
/**
 * Reproducible M10 measurement for the corporation metadata cache.
 *
 *   node scripts/measure-metadata-reads.mjs          # print JSON report
 *   node scripts/measure-metadata-reads.mjs --check  # exit 1 if counts drift
 *
 * Instruments every `ns.corporation` function on the deterministic simulation
 * fixture and runs the same 20-tick optimiser cycle twice on the SAME tree:
 * cacheMetadata:false (behaviour before the change) and cacheMetadata:true.
 * The simulation is a MODEL, not the live game (see the criteria doc §1); this
 * script reproduces the instrumented call-count metric only.
 */
import { defaultCorporationConfig } from '../corporation-config.js';
import { createCorporationOptimizer } from '../corporation-optimizer.js';
import { createCorporationSimulation, runSimulation } from '../tests/fixtures/corporation-sim.js';

const TICKS = 20;
const METADATA_READS = ['getMaterialData', 'getResearchCost', 'getUpgradeLevelCost'];

// Locked from the implementation commit's measurement; do not edit to make --check pass.
const EXPECTED = Object.freeze({ uncachedTotal: 1744, cachedTotal: 1155 });

const isRead = name => /^(get|has|can)/.test(name);

function instrument(api) {
  const counts = Object.create(null);
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== 'function') continue;
    counts[name] = 0;
    api[name] = (...args) => { counts[name]++; return fn(...args); };
  }
  return counts;
}

function measure(cacheMetadata) {
  const config = defaultCorporationConfig();
  const simulation = createCorporationSimulation({ config });
  const counts = instrument(simulation.api);
  const optimizer = createCorporationOptimizer({
    api: simulation.api, config, cycleSeconds: 10, clock: () => simulation.state.at,
    log: () => {}, write: () => {}, cacheMetadata,
  });
  runSimulation({ steps: TICKS, simulation, optimizer });
  const totalCalls = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const readCalls = Object.entries(counts).reduce((sum, [name, count]) => sum + (isRead(name) ? count : 0), 0);
  return {
    totalCalls,
    perTick: totalCalls / TICKS,
    readCalls,
    mutationCalls: totalCalls - readCalls,
    metadataReads: Object.fromEntries(METADATA_READS.map(name => [name, counts[name] ?? 0])),
  };
}

const uncached = measure(false);
const cached = measure(true);
const totalDelta = cached.totalCalls - uncached.totalCalls;
const report = {
  ticks: TICKS,
  lockedBaseline: EXPECTED,
  uncached,
  cached,
  delta: {
    totalCalls: totalDelta,
    perTick: totalDelta / TICKS,
    pct: +(100 * totalDelta / uncached.totalCalls).toFixed(1),
  },
  note: 'All ns.corporation calls on the deterministic sim (reads + mutations). '
    + 'runSimulation calls simulation.metrics() once per tick, which is included in both modes.',
};
const matched = uncached.totalCalls === EXPECTED.uncachedTotal && cached.totalCalls === EXPECTED.cachedTotal;
report.countsMatch = matched;
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--check') && !matched) {
  console.error('\nREAD-COUNT MISMATCH: instrumented call counts drifted from the locked baseline. '
    + 'Investigate before claiming the M10 improvement.');
  process.exit(1);
}
