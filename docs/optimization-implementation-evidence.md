# Optimization implementation evidence — t_9c242683

Branch `wt/t_9c242683`, implementation commit recorded in the task thread.
Acceptance criteria: `docs/optimization-acceptance-criteria.md` (verbatim copy of commit `66cc663`
from `wt/t_8cbf34eb`; that commit was never promoted to the branch point `d6f2ab5`, so the
criteria document and `scripts/measure-optimization-baseline.mjs` are included here verbatim
to make §4 reproducible on this branch).

This branch is the review-fix branch: it applies the reviewed commit `7a1321a` (cherry-picked as
`5c761b1`) plus targeted fixes for the five findings on `t_b761d02c`. Dispositions are recorded on
`t_436f80b7`. The instrumented read-count command below was added so the primary metric is
reproducible as required by criteria §0.5.

## Change

`corporation-optimizer.js` now memoizes **only immutable game metadata** per optimizer instance:

| Read | Guard that makes caching safe |
|---|---|
| `getMaterialData(name)` | static material size/markup data |
| `getResearchCost(division, name)` | static point cost; cache invalidated for that division after any real research purchase |
| `getUpgradeLevelCost(name)` | keyed by the level just read, so a level change always re-quotes |

Mutable state (funds, office, warehouse, city materials/products, unlocks, research
*ownership*) is still read fresh on every tick by `readCorporationSnapshot`. The cache is
bound to one optimizer instance and one API object, never shared across saves.
`cacheMetadata: false` is exposed only as an A/B/rollback switch.

New test file: `tests/corporation-optimizer-metadata-cache.test.js` (7 tests) proves the call counts,
level-keyed and division-keyed re-quotes, scoped invalidation, full A/B decision/action/outcome
equivalence against the uncached path, retry-after-transient-failure, and absence of decision drift
under an injected API throw.

## Before → after (medians of 3 runs unless noted)

| Metric (criterion) | Before | After | Verdict |
|---|---|---|---|
| `ns.corporation` calls per 20-tick instrumented cycle (M10; all calls, reads + mutations) | 87.2/tick (1744 total) | 57.8/tick (1155 total) | **−33.7%** from the rounded per-tick figures; exact totals give −33.8%. Primary improvement. |
| Read-only calls in the same 20-tick sample | 81.25/tick (1625) | 51.8/tick (1036) | −589 calls; the 119 mutation calls are unchanged in both modes |
| `npm test` `duration_ms` (M1, median of 3) | 10,450.6 ms | 10,148.7 ms | −2.9%; below the 10,600 ms target |
| Harness `wallMs.medianPerCycle` (M2, median of 3 invocations) | 0.211 ms | 0.214 ms | +1.4% — within the ≤5% target; sim overhead/noise dominates, not a claimed gain |
| Tests (M5/M14) | 4050 / 4040 / 0 / 10 | 4057 / 4047 / 0 / 10 | +7 covering tests, 0 fail, 0 new skips |
| `check:syntax` files (M13) | 684 | 685 | new test file discovered |
| `check:imports/api/ram/bindings` (M6) | 268 files / 0 problems | 268 files / 0 problems | unchanged |
| 400-cycle fingerprint (M17) | locked baseline | exact match | green |
| `bench:go` (M3) | 10 pass, internal ratios | 10 pass, internal ratios | untouched code path, no regression |

Per-call detail after the change (reads/tick, 20-tick sample): `getResearchCost` 17 → 0.85,
`getUpgradeLevelCost` 8 → 0.40, `getMaterialData` 6 → 0.30. All remaining reads are mutable
state or intentional pre/post-mutation re-checks.

## Commands and outputs

```text
node scripts/measure-optimization-baseline.mjs --check
  fingerprintMatch: true   (revenue 2356823.482729898, profit 2344323.482729898,
  valuation 83799537281.51758, bestRating 1.8164556184142882, products 3)
  doNothingFingerprint: revenue 0, profit -4100, valuation 49998766000, products 0
  exit 0

node scripts/measure-metadata-reads.mjs --check
  uncached.totalCalls: 1744  (readCalls 1625, mutationCalls 119, 87.2/tick)
  cached.totalCalls:   1155  (readCalls 1036, mutationCalls 119, 57.75/tick)
  metadata reads uncached -> cached: getResearchCost 340 -> 17,
    getUpgradeLevelCost 160 -> 8, getMaterialData 120 -> 6
  delta.totalCalls: -589, delta.pct: -33.8, countsMatch: true
  exit 0

npm test
  ℹ tests 4057 / pass 4047 / fail 0 / skipped 10 / cancelled 0
  (final run: 10311.2 ms; earlier 3 runs: 10148.7, 9509.4, 10173.0 ms → median 10148.7 ms; exit 0)

node --test tests/corporation-*.test.js
  ℹ tests 399 / pass 399 / fail 0 / skipped 0  (includes the 7 new tests)

node --test tests/corporation-optimizer-metadata-cache.test.js
  ℹ tests 7 / pass 7 / fail 0 / skipped 0

node --test tests/corporation-optimizer-simulation.test.js
  ℹ tests 8 / pass 8 / fail 0 / skipped 0

npm run check
  Syntax check passed for 685 JavaScript files.
  all audit: 268 deployable files, 0 problems.
  91 indirect/generated-source observations require native compilation or runtime checks;
  no complete RAM guarantee is claimed.   (exit 0)

npm run check:imports / check:api / check:ram / check:bindings
  each: 268 deployable files, 0 problems  (exit 0)

npm run bench:go
  ℹ tests 10 / pass 10 / fail 0  (exit 0)

npm run check:game
  "Native RAM preflight passed for 34 managed entrypoints. Scripts were not executed."
  host-manager.js 13.7 GB / 16 GB (ready); Tasks/contractor.js 14.4 GB / 16 GB (ready)
  exit 0 in this tree. Earlier workers saw "Native preflight did not complete" (exit 1) on
  both pre- and post-change trees, so availability is environment-dependent. This command
  checks native RAM only — it does not verify live metadata quotes (see limitation below).
```

## Deployment scope of the measured improvement

The −33.7% figure measures the optimiser path only; it is **not** a repo-wide or default-launch
saving:

- `autopilot.js:1177` launches `corporation-manager.js`, not `corporation-daemon.js`. The manager
  does not use `createCorporationMetadataCache`, so its `getResearchCost` / `getUpgradeLevelCost` /
  `getMaterialData` reads are unchanged.
- With that peer writer present, `corporation-daemon.js:443-459` returns `REPORT_ONLY` before the
  optimiser tick at `:514`, so no cached read happens in the default deployment.
- The long-running daemon main loop creates one optimiser for the whole run
  (`corporation-daemon.js:894-896`) and reuses it, so the cache does persist cycle-to-cycle when the
  daemon is the sole writer. One-shot `runCorporationCycle(ns, ...)` callers that do not pass
  `options.optimizer` build a fresh optimiser per call (`:509`, `buildOptimizer` at `:610`) and see
  no cross-cycle benefit.

Porting the memo into `corporation-manager.js` is a separate change with its own A/B equivalence
and guardrail work, out of scope for this fix. The measured claim is therefore explicitly scoped
to "the corporation daemon's optimiser instance", which is what the instrumented command above
measures.

## Equivalence instrument — scope and limitation

M17 uses the deterministic model in `tests/fixtures/corporation-sim.js`, not the live game. The
model's `getUpgradeLevelCost` is a pure function of level and `getResearchCost` ignores division —
the same invariants the cache relies on. That is a genuine limitation: the fingerprint cannot
detect a real-game quote that varies by some other state. Two mitigations are recorded here:

- The cache does not assume quote constancy: research quotes are keyed by `(division, research)`
  and upgrade quotes by `(name, level)`. A division-varying quote test and the existing level-keyed
  test prove distinct quotes stay separate; the fault-injection tests prove a transient throw is
  retried rather than cached.
- `npm run check:game` passed in this tree on 2026-11-18, but `scripts/check-native.js` only runs
  the native RAM preflight ("Scripts were not executed"); it does not read live metadata quotes.
  Earlier workers observed exit 1 with "Native preflight did not complete" on both pre- and
  post-change trees, so availability is environment-dependent. Capturing live-game quotes for the
  three APIs remains a deferred manual step; production equivalence of the cached reads is not
  claimed here beyond these invariants.

## Review finding dispositions (`t_436f80b7`)

| Finding | Disposition | Evidence / rationale |
| --- | --- | --- |
| F-1 (HIGH) — transient API throw permanently poisons cached metadata | **Fixed** | `memoize` stores only valid quotes; failed quotes are returned for the current tick, counted in `cache.failedQuotes`, and re-quoted next tick. Added loader-level fault injection and an optimiser-level A/B decision test. The two new tests fail on the pre-fix commit (4 pass / 2 fail from a `git archive` of `5c761b1`) and pass after (7/7). |
| F-2 (MEDIUM) — headline improvement inert in default deployment | **Fixed by scope disclosure; manager port deferred** | README and this document now state that only the daemon's persistent optimiser instance benefits, that autopilot launches `corporation-manager.js`, and that REPORT_ONLY returns before the tick. Porting the memo to `corporation-manager.js` is deferred: it needs its own A/B equivalence and guardrail work and is not a minimal fix to an inaccurate claim. |
| F-3 (MEDIUM) — primary metric has no reproducible command | **Fixed** | Added `scripts/measure-metadata-reads.mjs` with `--check`; exact command and output are quoted above. Counts 1744/1155, delta −589 (−33.8%), `countsMatch: true`, exit 0. |
| F-4 (MEDIUM) — equivalence proven only in a sim matching cache assumptions | **Fixed at the keying level; live capture deferred** | Added a division-varying quote test; the cache keys research by `(division, name)` and upgrades by `(name, level)`, so it does not assume quote constancy. Live-game quote capture remains deferred: `check:game` is a native-RAM preflight that executes no scripts, and its availability is environment-dependent (exit 0 here, exit 1 on both trees for earlier workers). Production equivalence beyond the documented invariants is not claimed. |
| F-5 (LOW) — design of record not updated | **Fixed** | `docs/corp-automation-spec.md` §7.9 and `docs/corp-optimizer.md` document the cached reads, keying/invalidation, failed-quote retry and the `cacheMetadata: false` rollback switch; README carries the deployment-scope note. |

## Guardrail review

- No new `getCorporation`/`getIndustryData` reads; snapshot count stays at one per tick.
- No mutating call added to a read path; dry-run/pause/REPORT_ONLY code untouched and covered
  by the unchanged corporation test suite.
- No spend cap, reserve rule, kill-switch precedence, or config default changed.
- Research-cost invalidation is scoped to the purchasing division and runs only after a
  successful purchase, so a stale cost cannot survive a mutation performed by this loop.
- Failed metadata quotes are never cached: a thrown API read yields the same `null`/`NaN` as the
  uncached path for that tick, increments `cache.failedQuotes`, and is re-quoted on the next read.
  Two fault-injection tests plus a division-keying test cover the loaders and the optimiser
  decision path.
- Rollback: pass `cacheMetadata: false` at the call site, or use the §3 rollback plan in the
  criteria doc. No tests or baselines were weakened.
