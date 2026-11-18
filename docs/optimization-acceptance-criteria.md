# Optimization acceptance criteria — Bitburner automation

**Status:** baseline locked 2026-11-18, before any optimization change. **Owner task:** `t_8cbf34eb`.
**Scope:** Corporation automation (`corporation-*.js`, `tasks/corporation-*`), scheduler/RAM budget, and shared helpers under `scripts/`.
**Purpose:** decide objectively whether an optimization is a success. An optimization is accepted only when every blocking guardrail is green **and** at least one latency/API/RAM metric improves; "it still works" is not enough.

> In this game-automation repo **cost means in-game resources**, not money: RAM (GB), Bitburner `ns.*` API calls per tick, and game currency (funds/research). No cloud billing is involved; downstream cards should not invent a dollar-cost metric.

## 0. Rules of interpretation

1. **Baseline** = measured value in §1, captured on the clean pre-change worktree. **Target** = threshold or directional goal. **Block** = promotion is rejected if violated, regardless of speed gains.
2. A pure performance change (caching, batching, dedup, parallelization, scheduling) must produce **zero** behavior drift: metric M17's fingerprint must match exactly.
3. An intentional behavior change is allowed, but only with an explicit rationale, updated tests, and a new locked fingerprint approved before merge. Changing the baseline to make a check pass is a block.
4. Wall-clock timings are noisy (the 400-cycle harness varied 67–138 ms across runs). Compare **medians of repeated runs**, never a single sample. CPU microbenchmarks are machine-dependent: compare **ratios within the same machine**.
5. Every reported metric must include the exact command and its output. A green claim without command output is not evidence.

## 1. Baseline snapshot (measured, not estimated)

| Area | Metric | Locked baseline | Source / command |
|---|---|---|---|
| Tests | total / pass / fail / skipped | **4050 / 4040 / 0 / 10** | live `npm test` at HEAD `d6f2ab5` (2026-11-18). `qc-tests-final.log` is an older log (3421 / 3411 / 0 / 10) and is **not** the baseline. |
| Tests | suite wall time | **10,522.4 ms** (`duration_ms`) | same live run; `npm test` |
| Syntax | files passing syntax check | **684** | `npm run check:syntax` → `Syntax check passed for 684 JavaScript files.` |
| Audits | problems per audit | **0 problems / 268 deployable files** | `npm run check:imports`, `check:api`, `check:ram`, `check:bindings` |
| RAM | direct/generated API subtotals | `host-manager.js` **1.65 GB** (SF4.1–4.3); `Tasks/ram-manager.js` **75.25 / 21.25 / 7.75 GB** (SF4.1/4.2/4.3); `Tasks/contractor.js.solver.js` **12.65 GB** (all SF4.x) | `npm run check:ram` (subtotal lines; *not* total native RAM) |
| CPU | Go-style microbench | **10 tests pass, 15,578.8 ms** total; per-scenario ratios in report | `npm run bench:go` (`BITBURNER_GO_BENCHMARKS=1`) |
| Corporation sim | optimized 400-cycle fingerprint | revenue **2,356,823.48**, profit **2,344,323.48**, valuation **83,799,537,281.52**, bestRating **1.816456**, products **3** | `node scripts/measure-optimization-baseline.mjs` |
| Corporation sim | do-nothing 400-cycle control | revenue **0**, profit **−4,100**, valuation **49,998,766,000**, bestRating **0**, products **0** | same script |
| Corporation sim | harness latency | median **71.9 ms** total / **0.18 ms per cycle** (observed range 67.8–137.8 ms) | same script, 7 runs |
| Repo | worktree state | clean (`git status --short` empty) at baseline | `git status --short` |

The simulation in `tests/fixtures/corporation-sim.js` is a **model**, not the game. It is deterministic: two consecutive 400-cycle runs produced byte-identical outcome metrics. It is the behavior-equivalence instrument; a live smoke check remains a separate manual step.

## 2. Metrics, targets and measuring commands

### 2.1 Runtime / latency

**M1 — Full test suite wall time.** Baseline 10,522.4 ms. Measure: `npm test` (median of 3 runs).
Target: median ≤ **10,600 ms**; stretch ≤ 9,500 ms (−10%). Block: median > **12,100 ms** (~1.15×) or any slowdown concentrated in a single test file without justification.

**M2 — Optimizer cycle cost.** Baseline 0.18 ms/cycle median (range to 0.34). Measure: `node scripts/measure-optimization-baseline.mjs`, field `wallMs.medianPerCycle` (7 runs). Target: ≤ baseline × **1.05**; stretch ≤ ×0.9. Block: > baseline × **1.2** sustained across two invocations. Also assert the tick stays below 5% of `secondsPerMarketCycle` for the configured cycle length.

**M3 — CPU microbenchmarks.** Baseline: 10 passing assertions, scenario ratios recorded by `npm run bench:go`. Measure: that command on the same machine. Target: no candidate scenario ratio regresses > **5%**. Block: > **10%** regression on any scenario whose implementation the change touches. Compare ratios, not absolute milliseconds.

**M4 — QA pipeline latency.** Measure: `time npm run check` (and `npm run check:game`). Directional: no regression > 15% without justification; block if the pipeline stops completing within its current timeout.

### 2.2 Reliability / failure rate

**M5 — Test result counts.** Baseline 4050 total / 4040 pass / 0 fail / 10 skipped. Measure: `npm test`. Target: **0 fail**, skipped ≤ **10**, pass rate 100% of executed tests. Block: any failure, any test that fails on a clean rerun (flake), or any new skip.

**M6 — Static audit cleanliness.** Measure: `npm run check:syntax`, `check:imports`, `check:api`, `check:ram`, `check:bindings`. Target: syntax pass; **0 problems** in every audit. Block: any problem. Indirect observations from generated-source files are informational and do not block.

**M7 — Config and edge-case handling.** Measure: `node --test tests/corporation-config.test.js tests/corporation-optimizer.test.js tests/corporation-daemon.test.js tests/corporation-daemon-fixes.test.js tests/corporation-lifecycle.test.js tests/corporation-remediation.test.js`. Target: 0 uncaught throws; unknown keys warn, invalid values fall back, `schemaVersion` variants handled. Block: any thrown exception on malformed config, or a lost fallback.

**M8 — Recovery / stall behavior.** Measure: `node --test tests/corporation-growth-stall.test.js tests/corporation-delayed-return.test.js tests/corporation-research-value.test.js tests/corporation-office-bank.test.js`. Target: all pass; RECOVERY still triggers on treasury below floor or two consecutive negative-margin cycles. Block: a stall that no longer recovers, or RECOVERY that fires with healthy margins.

### 2.3 Cost / API usage (in-game resources)

**M9 — RAM footprint.** Measure: `npm run check:ram` subtotal lines and `npm run check:game` for native RAM. Target: no entrypoint subtotal rises more than **0.5 GB**; directional goal is a reduction. Block: any entrypoint above its declared scheduler `minRamReq` (`checkNativeRamBudgets` must report `ready`) or any subtotal increase > **5%**.

**M10 — `ns.*` API calls per tick.** Measure: diff of `ns.corporation` call sites in the hot path plus `npm run check:api`; the optimizer must take **one** snapshot via `getCorporationSnapshot()` per tick (design spec §4.3). Target: no increase in distinct API calls per tick; directional goal fewer. Block: a duplicate full snapshot per tick, any new per-action `getCorporation`/`getIndustry` style read, or any mutating call on a read-only path.

**M11 — Currency spend discipline.** Measure: `node --test tests/corporation-config.test.js tests/corporation-boost-budget.test.js tests/corporation-advert-bundle.test.js tests/corporation-office-bank.test.js` plus the sim's end `funds`. Hard caps that must hold: `upgradeFraction` default 0.2 (cap 0.3), `officeFraction` 0.3, `warehouseFraction` 0.15, `advertFraction` 0.15, `loanRepaymentFraction` 0.2, `advertSpendFraction` ≤ 0.5, upgrade cost cap 2e9, and the 50% mandatory-spend reserve rule. Target: **0 cap violations**. Block: any single action exceeding a cap or breaching the reserve.

**M12 — Kill switches and dry run.** Measure: `node --test tests/corporation-daemon.test.js` (paused cycle spends nothing; `dryRun: true` reports `REPORT_ONLY` and mutates nothing). Target: `enabled: false` → **0 ticks**; `dryRun: true` → plans generated, **0 mutations**. Block: any mutation that leaks through either gate.

### 2.4 Maintainability

**M13 — New-file hygiene.** Measure: `npm run check:syntax` file count (684 → should rise when files are added) and `check:imports`/`check:api`/`check:bindings` on 268 deployable files. Target: every new `*.js` is discovered and passes all audits. Block: an un-audited or orphaned new file.

**M14 — Test inventory.** Measure: count of `npm test` total (baseline 4050). Target: never decrease; each new optimized behavior has a covering test. Block: a net reduction in test count without an equivalently covering replacement.

**M15 — Config/backward compatibility.** Measure: `node --test tests/corporation-config.test.js tests/corporation-boost-budget.test.js`. Target: old config files still load; unknown keys warn; invalid values fall back; budget fractions remain clamped. Block: a breaking config change without migration.

**M16 — Docs and defaults in sync.** Measure: manual diff review of `docs/corp-automation-spec.md`, `docs/corp-optimizer.md`, `docs/ram-budget.md`, and `corporation-config.json` defaults. Target: documented budgets, caps and defaults match code. Block: stale documented values or an undocumented new config key.

### 2.5 Safety / behavior-regression guardrails

**M17 — Decision and outcome equivalence (primary guardrail).** Measure: `node scripts/measure-optimization-baseline.mjs --check` and `node --test tests/corporation-optimizer-simulation.test.js`. A pure optimization must reproduce the §1 optimized fingerprint **exactly** (floating-point equality is meaningful here — the sim is deterministic) and must still beat the do-nothing control on profit, valuation and product quality. Block: `fingerprintMatch: false` without an approved behavior change. A change that improves outcomes is acceptable only with a new locked fingerprint and updated assertion tests.

**M18 — No destructive or unauthorized actions.** Measure: `node --test tests/corporation-optimizer.test.js tests/corporation-daemon-fixes.test.js`. Target: product retirement only with `allowProductRetirement: true` and a replacement ready; no `clearCorporationBuyRates` in REPORT_ONLY paths (known prior defect); no division/industry creation outside the configured allowlist. Block: any violation.

**M19 — Pause / maintenance / achievement gates.** Measure: `node --test tests/corporation-daemon.test.js` and `tests/corporation-lifecycle.test.js`. Target: `isAllowed() === false` suspends the cycle and spends nothing; maintenance mode forces `REPORT_ONLY`; achievement conditions honored. Block: any bypass.

**M20 — State persistence and identity scoping.** Measure: `node --test tests/corporation-optimizer.test.js tests/reload-state.test.js`; inspect `tasks/corporation-optimizer.json`. Target: valid JSON, keyed by node/corporation identity, stale state rejected, crash does not lose progress. Block: corrupt state adoption, cross-identity reuse, or unreadable telemetry.

### Blocking conditions at a glance

Any one of these rejects promotion: a failing or flaky test; any audit problem; M17 fingerprint drift without approval; outcomes at or below the do-nothing control; RAM above declared budget; a spend cap breach; a mutation through dry-run/pause/REPORT_ONLY; a test-count decrease; or an undocumented config break.

## 3. Rollback plan

**Triggers.** Any blocking condition in §2; a live smoke anomaly (crash, unexpected spend, no progress); or a measured regression beyond a Block threshold.

**Steps.**
1. Stop the automation without deleting anything: set `enabled: false` in `corporation-config.json` (or `dryRun: true` to keep observing). Both are verified no-op gates by M12.
2. Revert the offending commit on the feature branch (`git revert <sha>`); if several commits are involved, reset to the last verified-green commit. Do not roll back by deleting or weakening tests — that is itself a guardrail breach (M14).
3. Restore the prior config and telemetry state if the change modified them; remove only state files introduced by the change.
4. Re-verify against §1: `npm test`, `npm run check`, `npm run check:game`, `node --test tests/corporation-optimizer-simulation.test.js`, `node scripts/measure-optimization-baseline.mjs --check`.
5. Require 0 failures, 0 audit problems, a fingerprint match, and green native RAM budgets before resuming.
6. Record the rollback in the task thread with the reverted SHA and the verification output. Keep the failing report as evidence — do not discard it.

**Kill-switch precedence:** `enabled: false` > `dryRun: true` > maintenance/`isAllowed()` gate > normal operation. This ordering must be preserved by any scheduling optimization.

## 4. Evidence packet required from the implementer

For every metric the change can affect, report **before → after**, the exact command, and its output. At minimum:

```bash
npm test                                              # M1, M5, M14
npm run check                                         # M6, M9, M10, M13
npm run check:game                                    # M9 (native RAM)
npm run bench:go                                      # M3
node scripts/measure-optimization-baseline.mjs --check # M2, M11, M17
node --test tests/corporation-*.test.js               # M7, M8, M12, M18-M20
```

Include the commit SHA, the baseline command output from §1 (re-run `npm test` and save the result — do **not** cite the stale `qc-tests-final.log`), any fingerprint delta with an explicit approval rationale, and a note if rollback was triggered.

## 5. Downstream handoff

- **Implementer (`t_9c242683`):** optimize only after recording §1; keep M17 green; report using §4.
- **Adversarial reviewer (`t_b761d02c`):** attack the guardrails — look for caching that reads stale values before mutation, batched actions that exceed caps, parallel paths that double-spend, retries of non-idempotent actions, dry-run paths that mutate, and state files that survive a reset incorrectly.
- **Validator (`t_04970102`):** re-run every §4 command on the final branch and compare to §1; accept only if all blocking conditions are green and at least one latency/API/RAM metric improved.

## Appendix — re-baselining

Re-baselining is only legitimate when a behavior change is deliberately approved. Update §1 values, the `BASELINE` constants in `scripts/measure-optimization-baseline.mjs`, and the assertions in `tests/corporation-optimizer-simulation.test.js` in the **same commit**, with the rationale in the task thread. A baseline edit without an approved behavior change is a guardrail violation.
