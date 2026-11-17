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

/** Same reset and owner, but the workers report how late each launch was. */
const launches = (at, lags) => ({
  at, augReset: 11, nodeReset: 22, ownerPid: 7, blocked: false,
  counts: {operations: 0, deadlineOverruns: 0, unavoidableOverruns: 0},
  recent: lags.map((ms, i) => ({at: at - 1000 * (lags.length - i), owner: 7, startLateMs: ms})),
});
const PACE = {baseCycleMs: 4000, baseQueueMs: 1000};

test('a measured launch lag raises the start lead time above the baseline', () => {
  // Live evidence: 1,126 of 1,180 lateness events were already late at launch, and queueMs was a fixed 1 s that
  // nothing measured. The worst launch in the window decides the lead time, rounded up to a whole second.
  const state = adaptiveHgwTiming(null, launches(t0, [2600, 1800, 3200]), {now: t0, ...PACE});
  assert.equal(state.startLagMs, 3200);
  assert.equal(state.startLagSamples, 3);
  assert.equal(state.queueMs, 4000, '1.25x the worst launch lag');
  assert.match(state.queueReason, /launch lag/);
});

test('the lead time is capped, and a lag the baseline already covers changes nothing', () => {
  const wild = adaptiveHgwTiming(null, launches(t0, [30_000, 24_000, 41_000]), {now: t0, ...PACE});
  assert.equal(wild.queueMs, 8000, 'capped at twice the base cycle');
  const quiet = adaptiveHgwTiming(null, launches(t0, [200, 400, 600]), {now: t0, ...PACE});
  assert.equal(quiet.queueMs, 1000, 'a sub-second lag rounds down to the fixed lead time');
});

test('one late launch is not evidence, and stale or foreign events are ignored', () => {
  const single = adaptiveHgwTiming(null, launches(t0, [9000]), {now: t0, ...PACE});
  assert.equal(single.queueMs, 1000);
  assert.equal(single.startLagSamples, 1);
  const stale = {...launches(t0, []), recent: [0, 1, 2].map(i => ({at: t0 - 200_000 - i, owner: 7, startLateMs: 9000}))};
  assert.equal(adaptiveHgwTiming(null, stale, {now: t0, ...PACE}).queueMs, 1000, 'events older than the window are not evidence');
  const foreign = {...launches(t0, []), recent: [0, 1, 2].map(i => ({at: t0 - i, owner: 99, startLateMs: 9000}))};
  assert.equal(adaptiveHgwTiming(null, foreign, {now: t0, ...PACE}).queueMs, 1000, "another process's lag is not ours");
});

test('a raised lead time holds through a quiet window, then falls back', () => {
  const raised = adaptiveHgwTiming(null, launches(t0, [3200, 3200, 3200]), {now: t0, ...PACE});
  assert.equal(raised.queueMs, 4000);
  const quiet = adaptiveHgwTiming(raised, snapshot(t0 + 31_000, 0, 0, 0), {now: t0 + 31_000, ...PACE});
  assert.equal(quiet.queueMs, 4000, 'one quiet window must not flip the lead time back');
  const settled = adaptiveHgwTiming(quiet, snapshot(t0 + 400_000, 0, 0, 0), {now: t0 + 400_000, ...PACE});
  assert.equal(settled.queueMs, 1000, 'five quiet minutes restore the baseline');
});

