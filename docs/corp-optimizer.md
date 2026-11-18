# Corporation optimisation loop

Status: implemented for kanban card `t_0976c067`; wired into a single daemon by `t_98440837`.
Spec: [`docs/corp-automation-spec.md`](corp-automation-spec.md) §4.3 (tick order), §6 (modules),
§7 (objectives and budgets), §8 (configuration), §9 (telemetry), §10 (edge cases).

This document covers the part of the corporation automation that runs every cycle:
**products, research, staffing, warehouse upgrades, material buying/selling and upgrade purchasing**.
Bootstrap/creation/city expansion live in `corporation-bootstrap.js`/`corporation-expansion.js`
(other card); finance, shares, dividends and splits live in `corporation-finance.js` (other card).

## 1. Shape of the implementation

The loop is a **library**, not a new running script. The corporation daemon (or
`corporation-manager.js` during migration) calls one synchronous tick per corporation cycle:

```js
import { createCorporationOptimizer, clearOptimizerBuyRates } from './corporation-optimizer.js';
import { loadCorporationConfig } from './corporation-config.js';

const { config, errors, report } = loadCorporationConfig({
  read: path => ns.read(path),
  flags: { 'development-speed': ns.args.includes('--development-speed'), 'dry-run': ns.args.includes('--dry-run') },
});

const optimizer = createCorporationOptimizer({
  api: ns.corporation,              // or a mock in tests
  config,
  cycleSeconds: ns.corporation.getConstants().secondsPerMarketCycle,
  clock: () => Date.now(),
  log: (level, message, data) => level === 'error' ? ns.tprint(message) : ns.print(message),
  state: restoredState,             // see restoreOptimizerState
  write: (path, contents) => ns.write(path, contents, 'w'),
  isAllowed: () => !isScriptPaused(ns, ns.getScriptName()) && !maintenanceRequested(ns),
  identity: { nodeReset: resetInfo.lastNodeReset, augReset: resetInfo.lastAugReset, corporation: corpName },
});

const result = optimizer.tick();    // { state, decisions, findings, telemetry, snapshot }
await ns.corporation.nextUpdate();
```

Why a library: one `ns.corporation` import costs 858.9 GB on the live save (spec §2.2). A second
entrypoint would double that. Every module below takes an injected `api` object, so the whole loop
is testable with a mock or the simulation fixture.

### Files

| File | Responsibility |
| --- | --- |
| `corporation-optimizer.js` | the tick: snapshot, recovery classification, budget ladder, module order, guarded execution, dry-run, telemetry, state persistence |
| `corporation-config.js` | config schema, defaults, validation, legacy flag merge, budget ladder maths |
| `corporation-product.js` | product design/develop/retire/discontinue, science gate, research priority |
| `corporation-people.js` | office sizing, hiring, job assignment, tea/party, global upgrades, AdVerts |
| `corporation-market.js` | material and product selling, pricing, recipe inputs, boosts, warehouse upgrades |
| `corporation-config.json` | the default configuration file (repo root, synced with the scripts) |
| `tests/corporation-*-optimizer.test.js`, `tests/corporation-optimizer*.test.js` | unit, edge-case and simulation tests |
| `tests/fixtures/corporation-sim.js` | deterministic corporation model used for the baseline comparison |

### Tick order (spec §4.3)

1. Guard: configuration enabled, `isAllowed()` (pause/maintenance/achievement), no corporation.
2. Read **one** snapshot: corporation, constants, unlocks, divisions, cities, offices, warehouses,
   materials, products, research ownership/costs, upgrade levels/costs.
3. Classify: `RECOVERY` when cash is under the treasury floor or the negative-margin streak reaches
   `budgets.recoveryMarginCycles`.
4. Budget ladder (below).
5. People: office size, hire, job mix, tea/party.
6. Research: priority order, package with prerequisites.
7. Products: create, develop (office staffing), retire, discontinue.
8. Market: sell first, then recipe inputs, boosts and warehouse upgrades.
9. Upgrades and AdVerts.
10. Telemetry + state file.

Every mutation is applied by the module's `apply*` function, which re-reads the authoritative value
immediately before acting: division product list, warehouse level, upgrade level and cost, office
size, corporation funds. A plan computed from a stale snapshot therefore cannot spend money it does
not have, and every `apply*` catches its own errors and returns `{state, reason}` instead of throwing.

## 2. Configuration

`corporation-config.json` at the repository root. Missing file, invalid JSON, invalid value or a
newer `schemaVersion` all fall back to the documented defaults and are reported through
`loadCorporationConfig(...).errors` / `.report` — nothing throws. Unknown keys are ignored with a
warning. Legacy CLI flags still work and win over the file (spec §8):

| Flag | Config path |
| --- | --- |
| `--development-speed` | `product.developmentSpeed` |
| `--min-ownership` | `finance.minOwnership` |
| `--investment-min-ownership` | `finance.investmentMinOwnership` |
| `--expand-all-industries` | `bootstrap.expandAllIndustries` |
| `--manage-shares` | `finance.manageShares` |
| `--bribe-factions` | `finance.bribeFactions` |
| `--dry-run` | `dryRun` |

### Keys this loop reads (defaults shipped)

| Key | Default | Effect |
| --- | --- | --- |
| `dryRun` | `false` | plan only, never mutate; writes `tasks/corporation-dry-run.json` |
| `enabled` | `true` | `false` makes the tick a no-op (`state: DISABLED`) |
| `product.scienceFloor` | `1.15` | minimum science multiplier to design a product |
| `product.scienceAbandonFloor` | `1.1` | below this an in-development product is discontinued |
| `product.allowProductRetirement` | `false` | opt-in replacement of the weakest mature product |
| `product.developmentSpeed` | `true` | use the faster development staffing/expansion profile |
| `product.maxProductsPerDivision` | `null` | extra cap under `Division.maxProducts` |
| `product.minimumInvestment` | `1e7` | smallest design/marketing cheque worth paying |
| `product.investmentCashFraction` | `0.02` | share of free cash that may seed a product while the growth bank is empty |
| `people.officeTargets.materials` | `[3,9,15,20,30,45,60]` | office targets by cash tier |
| `people.officeTargets.products` | `[30,60,80,100,120]` | office targets for product divisions |
| `people.cashTiers.materials/products` | `1e9…1e13` / `1e12…1e15` | cash boundaries that select a tier |
| `people.teaThreshold` | `2` | buy tea below `maxEnergy - teaThreshold` |
| `people.upgradeFraction` | `0.2` | max share of cash for one global upgrade |
| `people.storageUpgradeFraction` | `0.35` | same, for Smart Storage under pressure |
| `people.upgradePaybackCycles` | `600` | an upgrade may not cost more than this many cycles of profit (`0` disables) |
| `people.starvationTicks` | `3` | ticks without employees before a starvation finding |
| `research.affordableFraction` | `0.2` | a research package may use at most this share of the RP pool |
| `research.optionalAutomation` | `false` | also buy AutoBrew/AutoParty/HR/uPgrade research |
| `research.developmentReserveCycles` | `5` | do not drain RP a developing product cannot replace in this window |
| `market.advertSpendFraction` | `0.5` | max share of free cash for AdVerts |
| `market.maxAdVerts` | `{materials:8, products:20}` | hard AdVert caps per division |
| `market.advertPaybackSeconds` | `21600` | AdVert must repay its estimated sales gain inside this horizon |
| `market.boostWarehouseFraction` | `0.6` | share of warehouse space targeted by boost materials |
| `bootstrap.warehouseFullThreshold` | `0.7` | warehouse pressure that justifies an upgrade |
| `budgets.*` | see spec §8 | reserve floor/cap/fraction/expense-cycles, growth/development/upkeep/boost/input/office fractions, `recoveryMarginCycles` |
| `telemetry.stateFile` | `tasks/corporation-optimizer.json` | persisted optimiser state |
| `telemetry.debug` | `false` | log routine re-issues and every skip reason |

Additions beyond the spec's sample schema: `product.minimumInvestment`,
`product.investmentCashFraction`, `people.upgradePaybackCycles`, `people.starvationTicks`,
`people.cashTiers`, `market.maxAdVerts`, `market.advertPaybackSeconds`,
`budgets.inputCashFraction`, `budgets.officeCashFraction`, `telemetry.stateFile`. Each has a
conservative default; the loop reads them through the validated config only.

## 3. Budget ladder (spec §7.2)

```
reserve  = min(reserveCap, max(reserveFloor, reserveCashFraction × funds, expenses × cycle × reserveExpenseCycles))
free     = max(0, funds − reserve)
profit   = max(0, revenue − expenses) × cycle
upkeep   = recovering ? 0 : min(free, upkeepCashFraction × funds, developing ? max(0.25 × profit, 0.01 × free) : 0.25 × profit)
growth   = recovering ? 0 : min(free, max(bank + profit × growthFraction, developing ? developmentGrowthFraction × free : 0))
boost    = recovering ? 0 : min(boostCashFraction × funds, free, allowance)
allowance= (revenue == 0 && expenses == 0) ? min(1e7, 1% of funds) : max(0, revenue − expenses) × cycle × 0.5
```

Two operating budgets sit beside the growth bank because they are not discretionary:

- `product` = `max(growth, free × product.investmentCashFraction)` — a product cannot wait for a
  growth bank that only fills from profit (a fresh corporation has profit ≈ 0 for a while).
- `input`  = `free × budgets.inputCashFraction` — recipe inputs are cost of goods, not expansion.
- Office growth of an **understaffed or development** office may draw
  `free × budgets.officeCashFraction` even when the growth bank is empty, capped by the quoted
  increment (spec §6.1 note: staffing gates every other plan).

`RECOVERY` zeroes upkeep, growth, boost, upgrade and advert budgets and allows only selling and
free actions. It triggers on the treasury floor (`funds < max(1e7, 1.5 × reserve)`) or a negative
margin streak (`budgets.recoveryMarginCycles`, default 10) — the live save was losing $12.2k/s
while still spending, which is exactly gap G2 in the spec.

## 4. Decisions and heuristics

### Products (`corporation-product.js`)

- `science = 1 + RP^scienceFactor / 800` (game formula, frozen at creation). Below `1.15` no design
  starts and the plan publishes the RP gap; below `1.10` an in-development product is discontinued
  because its remaining burn is a pure loss.
- Slots: `Division.maxProducts` is authoritative. When full, the loop **never** calls
  `makeProduct`; it reports `productSlots` and, only if `allowProductRetirement` is on *and*
  `productReplacementReady` finds stronger research/staffing/investment evidence, retires the
  weakest mature product first (then creates on the next tick).
- A pending product is "develop" — the people module keeps the development office staffed with
  R&D/Engineers — never a second design.
- Names are monotonic: `<Division> <n>` from a persisted counter, never reusing an index.

### Research (`corporation-product.js`)

Priority: `Hi-Tech R&D Laboratory` → `Market-TA.I` + `Market-TA.II` **as one package** →
`Self-Correcting Assemblers` → `Drones*` → `Overclock` → `Sti.mu` → `uPgrade: Fulcrum`
→ `uPgrade: Capacity.I/II` → optional upkeep/HR research.

Each purchase is the missing prerequisite closure of the highest-priority affordable target, and
must satisfy `researchAffordable(points, cost, affordableFraction)`: cost ≤ 20% of the pool, so the
production-quality floor stays funded. While a product is in development the loop also refuses
research whose cost the division cannot replace within `developmentReserveCycles` cycles at the
observed RP rate. All-research-owned is reported as `complete`; nothing is re-bought.

### People (`corporation-people.js`)

- Office target from the configured cash tiers; product divisions staff one full development office
  and half-target the rest; a one-city material division keeps the nine-employee expansion gate.
- Increment quoting tries the full gap, then 3, then 1 seat, so an affordable small step is never
  blocked by an unaffordable big one. An office with a size but no employees is never grown: hire
  into the space first.
- Job mix from `optimizedOfficeJobs` (bounded local search, every role ≥ 1, research protected while
  the division still needs it). After hiring, the mix is recomputed for the new headcount.
- Upkeep: tea when `avgEnergy < maxEnergy − teaThreshold`; a party sized by
  `partySpendPerEmployee` (≥ $100k/employee) from the upkeep budget; both zero in recovery and when
  `AutoBrew`/`AutoPartyManager` is owned.
- Global upgrades: one per tick, ranked by `upgradeReturn(name, level, cost, storagePressure)`,
  capped at `upgradeFraction × cash` (Smart Storage: `storageUpgradeFraction` under pressure) and by
  `upgradePaybackCycles × profit`. A loss-making corporation buys none (fixes G2).
- AdVerts: capped per division (`maxAdVerts`) and only when
  `cost / (estimated benefit × revenue per second) ≤ advertPaybackSeconds`; material divisions stop
  at the support limit.

### Market (`corporation-market.js`)

- Selling is re-issued every tick (the game does not persist sell orders): materials at
  `MP + quality/baseMarkup`, or `MAX`/`MP` **with** `Market-TA.II`; products at a formula price when
  an inferred markup is known, otherwise `MP × multiplier` from the bracketed `productPriceStep`
  search. Price state is persisted (`tasks/corporation-optimizer.json` → `pricing`), fixing G9.
- `Market-TA.II` is an opt-in flag per material and per product, not a property of the price string:
  `applySales` issues `setMaterialMarketTA2(division, city, material, true)` once per material order
  and `setProductMarketTA2(division, product, true)` once per product order whenever the division
  owns the research, and re-reads `hasResearched(division, 'Market-TA.II')` immediately before the
  first enable call so a stale plan cannot ask for an illegal mutation. A sale at `MP` without the
  flag sells at literal market price (spec §6.5).
- A city without a warehouse is skipped, never asked to sell (the API throws there).
- Inputs: `Smart Supply` → clear the manual rate and prefer `leftovers`; otherwise
  `recipeInputPlan` sized to observed production × `cycleSeconds × 1.1`, scaled into the input
  budget, paused when the warehouse is > 95% full, and restarted with a warehouse-sized batch if
  production collapsed to zero (otherwise nothing would ever be bought again).
- Boosts: factor-weighted `optimalBoostTargets` at `boostWarehouseFraction × warehouse size`,
  charged against the boost budget, zeroed on a backlog or full warehouse, and every unset rate is
  zeroed after the pass.
- Warehouse: one level per city per tick, only above `warehouseFullThreshold` pressure, never with
  an output backlog and never past level 5 unless the warehouse is ≥ 95% full.

## 5. Logging, telemetry, state

`log(level, message, data)` levels: `action` (a purchase), `plan` (dry-run intent), `warn`/`error`
(rejected or repeatedly failing operations), `info` (skip reasons, only with `telemetry.debug`),
`debug` (routine re-issues of sell/buy rates, only with debug).

`tick()` returns:

```js
{
  state,                    // RUNNING | RECOVERY | SUSPENDED | NO_CORP | BOOTSTRAP | DISABLED
  decisions: [{ kind, label, state, cost, reason, target, at, routine? }],
  findings:  [{ kind, label, reason }],      // e.g. people.starvation, Office API unavailable
  telemetry: { schemaVersion, at, state, dryRun, corporation, funds, reserve, revenue, expenses,
               profitPerCycle, valuation, sharePrice, public, growthBank, budgets, divisions,
               offices, decisions, findings, persistentFailures, cyclesManaged, statePersisted },
  snapshot,                 // the tick's read model, for other modules
}
```

Decision states: `purchased`, `planned` (dry-run), `budget-wait`, `blocked`, `no-op`, `rejected`,
`partial`, `complete` (research), `develop` (product in progress).

State file `tasks/corporation-optimizer.json` (schema 2) holds `cyclesManaged`, margin streak,
product counters/metrics/history, pricing brackets, inferred markups, research samples, starvation
counters, the growth bank, last action time and failure counters. It is keyed to
`{nodeReset, augReset, corporation}`: anything else is discarded by `restoreOptimizerState`, never
migrated. `write` is injected so tests do not touch the filesystem.

Failures are counted per operation label. The first repeat (count ≥ 2) is announced once through
`log('error', …)`; counts survive restarts through the state file. A failed call never throws out of
the tick: `apply*` catches, the executor records `rejected`, and the failure list is bounded to 32.

## 6. Dry-run and idempotency

`dryRun: true` (or `--dry-run`) computes the full plan and records it as `planned` decisions with
`{label, cost, target, budget}`, consumes the same budgets, writes `tasks/corporation-dry-run.json`
and **calls no mutating API**. A test asserts the dry-run decision labels and order equal a real
tick's decision labels on the same snapshot (spec acceptance 12) and that no mutating call happens.

Idempotency comes from keying every purchase on observable state, never on "did I already run":
research is skipped once `hasResearched` is true, a product is only created while a slot is free and
the science floor holds, an office upgrade is only quoted while `size < target`, a warehouse upgrade
only above the pressure threshold, an upgrade only at the level it was planned from. A second tick on
an unchanged corporation therefore performs no duplicate purchase (test evidence below).

## 7. Edge cases (spec §10) and where they are handled

| # | Case | Handling in this loop | Test |
| --- | --- | --- | --- |
| 1 | No corporation | `state: NO_CORP`, no calls, bootstrap owns creation | `no corporation is a clean no-op` |
| 3 | BitNode disabled / no SF3 | controller guard returns `UNAVAILABLE` before the tick (integration) | spec-level, bootstrap card |
| 4 | Unlocks missing | Office API → staffing/research/product skipped with a finding; Warehouse API → no market work | snapshot `unlocks` |
| 8 | Zero employees | hire retried each tick, no job assignment invented, `people.starvation` after `starvationTicks`, office not grown | `an office with no employees is reported…` |
| 10 | Full product slots | no `makeProduct`, `productSlots` published, retirement only opt-in + evidence | `full product slots stop makeProduct…` |
| 11 | Product vanished / stalled | metrics reconciled against the live product list, stale entries cleared, completed development timed | `productTelemetry`, simulation tick |
| 12 | Warehouse full / backlog | boosts paused, production input paused > 95%, no storage spend while backlogged | `warehouse upgrades need pressure…` |
| 13 | City without a warehouse | every market call skips the city | `sales are applied only where a warehouse exists…` |
| 19 | Division cap | owned by the expansion module (sibling card) | — |
| 20 | Research unaffordable | cost ≤ 20% of pool, gap published, no purchase | `research buys the TA package…` |
| 21 | Negative margin, large cash | `RECOVERY` after the streak, discretionary budgets zeroed, selling continues | `a negative-margin streak freezes…` |
| 22/23 | Reset / restart | state discarded on a reset-key mismatch, plans re-derived from the snapshot | `state is persisted, restored only for the same node…` |
| 24 | Pause / maintenance | `SUSPENDED`, buy rates cleared, no mutation | `a paused controller suspends the tick…` |
| 26 | Missing market data | prices fall back to `MP`/markup strings, never `NaN` | `without TA.II materials use additive quality markup…` |
| 28 | API throws repeatedly | per-operation counters, announced once, bounded, tick survives | `a tick survives an API that throws…` |
| 30 | NaN/Infinity | every policy helper rejects non-finite input; plans skip rather than compute | policy unit tests |

## 8. Test evidence

```
npm test                        # 3942 tests, 0 failures (includes the new files)
npm run check:syntax            # 661 files
node scripts/audit-project.js all   # 254 deployable files, 0 problems
node --test tests/corporation-optimizer-simulation.test.js
```

The baseline comparison (`tests/corporation-optimizer-simulation.test.js`) runs the same
deterministic starting corporation (`tests/fixtures/corporation-sim.js`: Tobacco division, one city,
9 staff, $50b, no products, science factor 0.642) for 400 corporation cycles twice — once driven by
the optimiser, once doing nothing:

| Metric (end of run) | Optimiser | Baseline |
| --- | --- | --- |
| products (mature) | 3 (all three slots) | 0 |
| best product effective rating | 1.82 | — |
| revenue per cycle | 2,356,823 | 0 |
| profit per cycle | +2,344,323 | −4,100 |
| cumulative profit | +296,592,098 | −1,234,000 |
| valuation proxy | 83,799,537,282 | 49,998,766,000 |
| `Market-TA.II` owned | yes (cycle 378) | no |
| `Market-TA.II` enabled (flag calls) | 66 product + 22 material | 0 |
| worst reserve margin | +33,152,740,941 | +44,998,889,400 |

`Market-TA.II`'s price effect is modelled the way the game implements it — the flag, not the research
or the `MP` string, is what pays. The same 400 cycles with both enable calls stubbed to return
`false` (so the flag never lands) give revenue 1,473,765, profit +1,461,265, cumulative +277,164,805
and valuation 66,118,933,867: the rows above are worth about +883k revenue per cycle, which is why
`applySales` issuing the flag is covered by its own test (`applySales enables TA.II once per order…`)
rather than only by a planner assertion.

The simulation is a model (its mechanics are documented in the fixture), so these numbers show the
loop is coherent and profitable under a consistent economy, not that the live save will move by the
same amount. The live smoke check (spec §11.17) is still a manual, read-only comparison of
`automation.corpStatus` before and after one dry-run cycle.

Also asserted: research is never bought twice, products never exceed the three slots, offices never
shrink, a settled corporation performs no further purchases, the 400-cycle run raises no persistent
failure, and two identical runs produce identical calls (determinism).

## 9. Integration notes for the single daemon (`t_98440837`)

1. Load the config once with `loadCorporationConfig`, keep `config.errors`/`report` in the status
   document, and pass `config` into the optimiser; call `optimizer.configure(next)` after a reload.
2. Restore state with `restoreOptimizerState(JSON.parse(ns.read(stateFile) || '{}'), identity)`; the
   tick persists it through the injected `write`, so the daemon only has to supply one.
3. Pass `api: ns.corporation`, `cycleSeconds: constants.secondsPerMarketCycle`, `identity`, and an
   `isAllowed` that reflects pause/maintenance/achievement state.
4. Call `optimizer.tick()` **before** `await ns.corporation.nextUpdate()`; the tick is synchronous
   and reads one snapshot, so it cannot interleave with a cycle.
5. Register `ns.atExit(() => clearOptimizerBuyRates(ns.corporation))` (and the existing
   `clearCorporationBuyRates` call) so a crash cannot leave paid buy rates behind.
6. The optimiser returns `snapshot` for the finance/expansion modules in the same tick, and
   `telemetry` for the status document; merge it under the §9.1 key names rather than writing a
   second status file.
7. Ordering with the other modules: expansion/warehouses of new cities first, then this tick
   (people → research → product → market → upgrades), then finance/shares. City creation is not
   performed here by design.

## 10. Limitations

- The science gate (1.15) is a heuristic: the engine has no floor, and a division below it can still
  sell materials profitably.
- Retirement, division sale, exports and TA.II hash funding remain opt-in or out of scope here.
- The economy figures above come from a deterministic model, not the live save; a live dry-run cycle
  and a 4-hour unattended run are still required for spec §11.17/§11.8 sign-off.
- `getMaterial` is read for every produced/required/boost material in every warehoused city each
  tick. RAM is static (10 GB for the function) but CPU grows with cities × materials; if a mature
  six-city empire shows tick time above the corporation cycle, read materials only for cities with a
  warehouse and cache the rest across ticks.
