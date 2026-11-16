import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveHgwTiming} from '../progression-improvements-policy.js';

const t0 = 1_700_000_000_000;
const snapshot = (at, operations, late, unavoidable) => ({
  at, augReset: 11, nodeReset: 22, ownerPid: 7, blocked: false, recent: [],
  counts: {operations, deadlineOverruns: late, unavoidableOverruns: unavoidable},
});

/** Two 31 s windows of 100% lateness; only `unavoidable` changes between runs. */
function run(unavoidablePerWindow) {
  let state = adaptiveHgwTiming(null, snapshot(t0, 0, 0, 0), {now: t0});
  state = adaptiveHgwTiming(state, snapshot(t0 + 31_000, 100, 100, unavoidablePerWindow), {now: t0 + 31_000});
  state = adaptiveHgwTiming(state, snapshot(t0 + 62_000, 200, 200, unavoidablePerWindow * 2), {now: t0 + 62_000});
  return state;
}

test('overruns the fleet cannot avoid do not stretch the cycle', () => {
  // Live evidence: 1,014 deadline overruns, 854 of them flagged unavoidable by the worker. Pacing to those
  // pinned the multiplier at its 4x cap (32 s cycles) with zero clean windows, so the run paid throughput
  // for lateness that more spacing could not remove.
  const state = run(90);
  assert.equal(state.multiplier, 1, 'an unavoidable-dominated window holds the current pacing');
  assert.equal(state.cycleMs, 4000);
});

test('preventable overruns still escalate the pacing', () => {
  const state = run(0);
  assert.ok(state.multiplier > 1, 'lateness with no unavoidable share must back off');
  assert.ok(state.cycleMs > 4000);
});

test('the escalation gate needs a meaningful preventable share', () => {
  // 70 of 100 overruns unavoidable is under a third preventable: hold, do not escalate.
  const held = run(70);
  assert.equal(held.multiplier, 1);
  // 60 of 100 unavoidable leaves 40% preventable: escalate.
  const escalated = run(60);
  assert.ok(escalated.multiplier > 1);
});

test('a cycle stretched by unavoidable overruns recovers instead of pinning forever', () => {
  // Live evidence: riskFraction 0.15, unavoidable 87% of overruns, multiplier pinned at 3.2x with zero
  // clean windows. Lengthening the cycle cannot schedule a leg the fleet cannot start, so after five
  // minutes of holding, recover one bounded step.
  const stretched = {
    augReset: 11, nodeReset: 22, ownerPid: 7, baseCycleMs: 4000, multiplier: 3.2, cleanWindows: 0,
    windowAt: t0, operations: 0, late: 0, unavoidable: 0, spacingSamples: 0, spacingRisks: 0,
    changedAt: t0 - 400_000, at: t0, cycleMs: 12_800, queueMs: 320, latencyFloorMs: 12_800,
  };
  const next = adaptiveHgwTiming(stretched, snapshot(t0 + 31_000, 100, 88, 86), {now: t0 + 31_000});
  assert.ok(next.multiplier < 3.2, 'the held multiplier must decay when overruns are unavoidable-only');
  assert.equal(next.multiplier, 2.56);
  assert.ok(next.latencyFloorMs < 12_800, 'the learned latency floor must recover with the multiplier');
  assert.match(next.reason, /Recovering cycle/);
  // A fresh hold is respected: no recovery inside the five minute window.
  const fresh = adaptiveHgwTiming({...stretched, changedAt: t0 - 1000}, snapshot(t0 + 31_000, 100, 88, 86), {now: t0 + 31_000});
  assert.equal(fresh.multiplier, 3.2);
});
