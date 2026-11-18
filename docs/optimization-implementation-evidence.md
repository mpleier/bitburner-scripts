# Optimization implementation evidence — t_9c242683

Branch `wt/t_9c242683`, implementation commit recorded in the task thread.
Acceptance criteria: `docs/optimization-acceptance-criteria.md` (verbatim copy of commit `66cc663`
from `wt/t_8cbf34eb`; that commit was never promoted to the branch point `d6f2ab5`, so the
criteria document and `scripts/measure-optimization-baseline.mjs` are included here verbatim
to make §4 reproducible on this branch).

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

New test file: `tests/corporation-optimizer-metadata-cache.test.js` (4 tests) proves the
call counts, level-keyed re-quote, scoped invalidation, and full A/B decision/action/outcome
equivalence against the uncached path.

## Before → after (medians of 3 runs unless noted)

| Metric (criterion) | Before | After | Verdict |
|---|---|---|---|
| `ns.corporation` reads per optimizer tick (M10, 20-tick instrumented sample) | 87.2 | 57.8 | **−33.7%**, primary improvement |
| Total instrumented reads / 20 ticks | 1744 | 1155 | −589 calls |
| `npm test` `duration_ms` (M1, median of 3) | 10,450.6 ms | 10,148.7 ms | −2.9%; below the 10,600 ms target |
| Harness `wallMs.medianPerCycle` (M2, median of 3 invocations) | 0.211 ms | 0.214 ms | +1.4% — within the ≤5% target; sim overhead/noise dominates, not a claimed gain |
| Tests (M5/M14) | 4050 / 4040 / 0 / 10 | 4054 / 4044 / 0 / 10 | +4 covering tests, 0 fail, 0 new skips |
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

npm test
  ℹ tests 4054 / pass 4044 / fail 0 / skipped 10 / cancelled 0
  (3 runs: 10148.7, 9509.4, 10173.0 ms → median 10148.7 ms; exit 0)

node --test tests/corporation-*.test.js
  ℹ tests 396 / pass 396 / fail 0 / skipped 0  (includes the 4 new tests)

node --test tests/corporation-optimizer-metadata-cache.test.js
  ℹ tests 4 / pass 4 / fail 0 / skipped 0

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
  "Native preflight did not complete" — exit 1.
  Verified identical failure on the clean pre-change tree (tracked edit stashed,
  same branch HEAD e586e06): pre-existing environment limitation, not introduced here.
  M9 audit coverage therefore rests on `check:ram` (0 problems) plus this comparison.
```

## Guardrail review

- No new `getCorporation`/`getIndustryData` reads; snapshot count stays at one per tick.
- No mutating call added to a read path; dry-run/pause/REPORT_ONLY code untouched and covered
  by the unchanged corporation test suite.
- No spend cap, reserve rule, kill-switch precedence, or config default changed.
- Research-cost invalidation is scoped to the purchasing division and runs only after a
  successful purchase, so a stale cost cannot survive a mutation performed by this loop.
- Rollback: pass `cacheMetadata: false` at the call site, or use the §3 rollback plan in the
  criteria doc. No tests or baselines were weakened.
