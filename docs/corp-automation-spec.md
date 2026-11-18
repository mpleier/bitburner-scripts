# Bitburner Corporation Automation — Audit and Implementation Spec

Status: draft for implementation. Owner: corporation automation subtree.
Audience: a developer who has never opened this repository. Every claim below is
either linked to a file in this workspace or to a value read from the live game
through the Remote API on 2026-11-17.

How to use this document: sections 1-4 are context, 5-9 are the design that must
be implemented, 10-13 are the contract the implementation is graded against.

---

## 1. Scope

Automate and optimise a Bitburner corporation from "no corporation" to a mature,
profitable, optionally public corporation without manual intervention, while
never spending money the corporation needs to operate.

In scope:

- corporation creation and bootstrap (unlocks, first division, first city, staff)
- expansion (cities, divisions, warehouses, offices)
- products (creation, development, pricing, retirement) and research
- employees, job assignment, morale/energy upkeep, global upgrades
- investment rounds, IPO, dividends, share issue/sale/buyback
- material market: inputs, exports, boosts, selling, pricing
- a config surface, telemetry, failure handling, and a dry-run mode

Out of scope (owned elsewhere, do not duplicate):

- stock market trading — `stockmaster.js`, `stock-policy.js`
- Hacknet node/server operations — `hacknet-upgrade-manager.js`,
  `spend-hacknet-hashes.js` (the corporation may *request* hashes, see §6.6)
- faction/augmentation progression — `faction-manager.js`, `autopilot.js`
- UI/dashboard rendering — `automation-dashboard.js`, `stats.js`

## 2. Audit of the current workspace

### 2.1 Existing corporation code

| File | Lines | Role |
| --- | --- | --- |
| `corporation-manager.js` | 1,539 | The whole controller. One `main(ns)`, 45 nested arrow functions, one long `while` loop. All effects and decisions live here. |
| `corporation-policy.js` | 582 | Pure decision helpers: treasury/reserve, office scoring, product pricing, research affordability, growth scoring, boost targets, upkeep allocation. |
| `corporation-lifecycle.js` | 118 | Investment rounds, share issue/sale/buyback, dividend rate, liquidity target, input recipe planning, research parent map. |
| `corporation-priority-policy.js` | 52 | Growth-phase predicate, funding-goal selection, hash milestone quoting. |
| `corporation-calibration-policy.js` | 127 | Measures profit deltas around purchases to re-price future plans. |
| `corporation-advert-bundle-policy.js` | 122 | Wilson Analytics + AdVert bundle quoting/execution. |
| `corporation-delayed-return-policy.js` | 41 | Discounts plans whose payoff lands after the current BitNode/reset horizon. |
| `Tasks/corporation-diagnostic.js` | ~150 | Read-only snapshot tool (`run Tasks/corporation-diagnostic.js`). |
| `tests/corporation-*.test.js` | 28 files | Unit tests for the policy modules and several controller behaviours. |

Runtime integration:

- `daemon.js:414` launches `corporation-manager.js` when `reqRam(256)` and
  `currentNode == 3 || 3 in dictSourceFiles`.
- `autopilot.js` gates startup through `corporationControllerReady()`
  (`automation-manifest.js:12`) and reserves `scriptRam + 64` GB
  (`autopilot.js:1027-1032`); it tells `daemon.js` not to launch the controller
  itself (`--disable-script corporation-manager.js`).
- `remote-api-command-policy.js:14` registers it as a supervised, watched,
  home-only managed script with status file `tasks/corporation-status.json`.
- These links only run if SF3 is unlocked (`reqRam` is about home RAM).
- The flag `--disable-corporation` is persisted by autopilot; the manager also
  refuses to run when `resetInfo.currentNode !== 3` and SF3 is absent
  (`corporation-manager.js:176`).

### 2.2 RAM cost — measured, not estimated

`ns.getScriptRam('corporation-manager.js', 'home')` returned **858.9 GB** on the
live save. `automation-manifest.js` documents the same figure as "~860 GB".
This is a first-order design constraint: RAM is the sum of the *distinct*
`ns.corporation` functions the script references, so splitting the controller
into several concurrently running scripts multiplies that cost. See §4.1.

API RAM costs come from `scripts/api-surface.json` (generated from the connected
game's definitions):

| Cost | Functions |
| --- | --- |
| 0 GB | `hasCorporation`, `canCreateCorporation`, `getConstants`, `getBonusTime`, `nextUpdate` |
| 10 GB (read) | `getCorporation`, `getDivision`, `getOffice`, `getWarehouse`, `getProduct`, `getMaterial`, `hasWarehouse`, `hasUnlock`, `getUnlockCost`, `getUpgradeLevel`, `getUpgradeLevelCost`, `getResearchCost`, `hasResearched`, `getOfficeSizeUpgradeCost`, `getUpgradeWarehouseCost`, `getInvestmentOffer`, `getIndustryData`, `getMaterialData`, `getHireAdVertCost`, `getHireAdVertCount` |
| 20 GB (mutate) | `createCorporation`, `expandIndustry`, `expandCity`, `purchaseUnlock`, `levelUpgrade`, `research`, `hireEmployee`, `upgradeOfficeSize`, `throwParty`, `buyTea`, `hireAdVert`, `setJobAssignment`, `purchaseWarehouse`, `upgradeWarehouse`, `makeProduct`, `buyMaterial`, `bulkPurchase`, `sellMaterial`, `sellProduct`, `discontinueProduct`, `setSmartSupply`, `setSmartSupplyOption`, `setMaterialMarketTA1/2`, `setProductMarketTA1/2`, `exportMaterial`, `cancelExportMaterial`, `limitMaterialProduction`, `limitProductProduction`, `acceptInvestmentOffer`, `goPublic`, `bribe`, `issueDividends`, `issueNewShares`, `buyBackShares`, `sellShares`, `sellDivision` |

### 2.3 Live corporation state (what the code is actually running against)

Read with `node control.cjs automation.corpStatus` and
`corporation.getDivision` on 2026-11-17:

```
corporation      Apex Holdings (private, ownership 100%)
funds            $2.064b          reserve          $407.7m
revenue          $14,599.9/s      expenses         $26,803.6/s   (net negative)
growthBank       $1.655b          mode             "growth"
divisions        Agri   : 1 city (Sector-12), RP 178.7, awareness 24.5, 8 AdVerts
                 Tobacco: 1 city (Sector-12), RP 167.5, awareness 40.4, 13 AdVerts,
                          makesProducts=true, maxProducts=3, products=[], lastCycleRevenue=0
growth goal      "Expand Agri to Aevum" cost $9.02b, cash gap $7.36b
research         Market-TA.II: 70,000 points needed, 128-134 available → "not affordable"
hash milestone   1x "Sell for Corporation Funds" (500 hashes) for the Agri expansion
funding reason   "Offer is too small relative to operating profit"
player wallet    $201.7b (≥ the $150b self-fund threshold; corp was created with seed money)
```

Three facts matter for the design: the corporation is **loss-making while in
"growth" mode**, its only product division **has zero products against three
slots**, and the next expansion is **5.4× the available growth budget**.

### 2.4 API coverage

56 of the 63 `ns.corporation` functions appear in the repository. Never called:

| Function | Consequence today |
| --- | --- |
| `sellDivision` | A stranded division can never be removed, even when a config asks for it. |
| `bulkPurchase` | Inputs are bought with per-cycle rates only; no single-shot bulk top-up for boosts. |
| `limitMaterialProduction` | A warehouse-full material division cannot be throttled; it relies on buy-rate zeroing. |
| `limitProductProduction` | Same for products; production cannot be capped to sell-through. |
| `setMaterialMarketTA1` | Materials can never use TA.I automated pricing (only TA.II or manual formulas). |
| `cancelExportMaterial` | Export routes are write-only: `exportRoutes` caches them for the session and `manageExports` never removes a route. |
| `getHireAdVertCount` | AdVert counts are read from `Division.numAdVerts` instead. Harmless, but the alternative is untested. |

### 2.5 Gap list (input to the design)

| # | Priority | Gap | Evidence |
| --- | --- | --- | --- |
| G1 | P0 | No explicit lifecycle state machine. "Phase" is a boolean (`growthPriority`) plus ad-hoc `recovering`; states cannot be enumerated, asserted, or driven by config. | `corporation-priority-policy.js:2-6`; status `mode` is a string literal |
| G2 | P0 | Spending continues into a negative-margin corporation. `treasuryPolicy.recovering` only triggers when cash is low (`cash < max(10e6, 1.5*reserve)`), so a $2b corporation losing $12k/s is not "recovering". | live revenue < expenses, advert purchased at $2.01b; `corporation-policy.js:31-39` |
| G3 | P0 | Product gaps are invisible. `Tobacco` has `maxProducts=3`, `products=[]`, zero revenue, while `tasks/corporation-product-metrics.json` still names `Tobacco Auto 1`. Nothing reconciles metrics with `Division.products` or alerts. | live division read; `corporation-manager.js:1076-1081` |
| G4 | P1 | City expansion is all-or-nothing: the $9.02b package is the only plan that unlocks a second city, and the growth bank holds $1.655b. Cheaper rungs exist only for non-product divisions. | live `growthDecisions`; `corporation-manager.js:297-333` |
| G5 | P1 | Product-slot exhaustion has no defined behaviour (no retirement, no `sellDivision`, no telemetry), and `makeProduct` is called without checking `Division.maxProducts`. | `corporation-manager.js:1076+`, `addProduct` path |
| G6 | P1 | Export routes cannot be cancelled or re-scoped; a route that dilutes target quality stays forever. | `corporation-manager.js:628-676`; `cancelExportMaterial` unused |
| G7 | P1 | Configuration is six CLI flags with hard-coded constants (`IPO_VALUATION=1e10`, `DIVIDEND_TIERS`, `PAY_DIVIDENDS=true`, `ACCEPT_INVESTMENT=true`, `MAX_HASH_COST_PER_PURCHASE=5000`). No config file, no dry-run, no per-module switches. | `corporation-manager.js:24-92` |
| G8 | P2 | State files have inconsistent keys and versions: 8 task files, only two carry `schemaVersion`, some keyed on `lastNodeReset` only, some also on `lastAugReset` and the corporation name. | `corporation-manager.js:1193-1504` |
| G9 | P2 | Pricing discovery state (`saleMultipliers`, `productMarkup`, `pricingObservations`) is in-memory only, so a restart re-discovers markups from scratch. | `corporation-manager.js:987-1023` |
| G10 | P2 | Failure counters (`safeFailures`) are in-memory: a permanently failing call re-announces after every restart. | `corporation-manager.js:148-164` |
| G11 | P2 | No status document while `hasCorporation()` is false: the creation loop runs before any `ns.write`, so a blocked bootstrap is invisible to the dashboard/Remote API. | `corporation-manager.js:204-215` |
| G12 | P2 | Zero-employee offices are silent: hiring breaks out of the loop, job assignment is skipped, and nothing records the starvation. | `corporation-manager.js:783-820` |
| G13 | P2 | `bitNodeOptions.disableCorporation` is honoured by autopilot but not by the manager; launched directly it will loop forever on `canCreateCorporation` returning `NoSf3OrDisabled`/`DisabledBySoftCap`. | `corporation-manager.js:176-214`; `automation-manifest.js:13` |
| G14 | P3 | Bonus time (`getBonusTime`, 0 GB) is never read, so offline-accumulated corporation time is not used to schedule expensive state transitions. | `getBonusTime` unused in corporation code |
| G15 | P3 | Share price is not an objective anywhere: dividends/sales/buybacks exist, but nothing targets valuation per share beyond "don't dilute". | `corporation-lifecycle.js:47-79` |

## 3. Constraints that shape the design

### 3.1 BitNode and Source-File gating

- The API exists only in **BitNode 3** or with **Source-File 3 > 0**
  (`corporation-manager.js:176`; `automation-manifest.js:14`).
- `canCreateCorporation(selfFund)` returns exactly one of `Success`,
  `NoSf3OrDisabled`, `CorporationExists`, `UseSeedMoneyOutsideBN3`,
  `DisabledBySoftCap` (game `NetscriptDefinitions.d.ts:10165-10174`). Treat these
  as the authoritative gate; `createCorporation` throws on the same conditions.
- `bitNodeOptions.disableCorporation === true` disables the mechanic per-node.
- Self-funding costs **$150b**; seed money only works in BN3. Creation is
  refused when `CorporationSoftcap < 0.15`.
- Per-BitNode division caps exist; `expandIndustry` throws when reached, and the
  current code deliberately treats a rejected expansion as "retry in 5 min"
  (`corporation-manager.js:1147-1163`).
- Singularity (SF4/BN4) is required for `bribe`; SF9/BN9 for Hacknet servers;
  the corporation may run without either.

### 3.2 RAM model

- One coordinator script costs **858.9 GB**. Every additional running script
  pays its own static cost; imports are free.
- `daemon.js` requires `reqRam(256)` to launch it; autopilot reserves
  `scriptRam + 64`. Neither is enough headroom for a *second* corporation script.
- Consequence: modules in §4 are **library imports**, not separate processes.
  Only the coordinator is a managed entrypoint.

### 3.3 Time model

- Game cycle = 200 ms; corporation state cycle = `gameCyclesPerCorpStateCycle`
  (5 cycles); market cycle = `constants.secondsPerMarketCycle` (10 s in the live
  save).
- Corporation states: `START → PURCHASE → PRODUCTION → EXPORT → SALE`; the
  controller must act once per full cycle and call `await ns.corporation.nextUpdate()`.
- Bonus time (offline/inactive) makes corporation time pass faster; read
  `getBonusTime()` before assuming wall-clock pacing.
- Augmentation installs and BitNode resets invalidate all cached state; every
  state file must be keyed on `lastNodeReset`, `lastAugReset` and corporation
  name.

### 3.4 Unlock preconditions

Buying a **warehouse** needs **Warehouse API**; without a warehouse a city can
hold no stock, so `sellMaterial`/`sellProduct` throw and inputs cannot be bought —
market work is effectively blocked until it is owned (price from
`getUnlockCost`). Offices and job assignment need **Office API**; recipe
automation needs **Smart Supply**; export routes need **Export**;
`demand`/`competition` fields are only present with **Market Research - Demand** /
**Market Data - Competition**. Missing access must degrade, never throw.

## 4. Target architecture

### 4.1 Single writer, extracted decisions

```
corporation-controller.js   (new, thin; registered entrypoint, same status file)
  ├─ corporation-state.js       state machine + persistence + telemetry assembly
  ├─ corporation-config.js      schema, defaults, validation, flag merging
  ├─ corporation-bootstrap.js   creation, unlocks, first division/city, staff
  ├─ corporation-expansion.js   cities, warehouses, industries
  ├─ corporation-product.js     product creation/development/retirement, research
  ├─ corporation-people.js      offices, employees, jobs, tea/party, upgrades
  ├─ corporation-finance.js     investment, IPO, dividends, shares, hashes, bribes
  ├─ corporation-market.js      inputs, boosts, exports, pricing, selling
  └─ existing policy modules    (corporation-policy.js etc.) reused unchanged
```

Rules:

- Decision functions are pure (`(state, config, constants) → plan`) and live in
  policy modules; effect functions take an injected `api` object
  (`{getDivision, makeProduct, ...}`) so tests can pass a mock — this is already
  the pattern in `corporation-advert-bundle-policy.js` and
  `corporation-lifecycle.js`.
- Every effect re-reads the authoritative value immediately before mutating and
  re-checks affordability (the `attempt()` + re-quote pattern at
  `corporation-manager.js:908-912`, `1077-1123`, `1412-1416`).
- One tick = one corporation cycle. Sub-steps run in the fixed order in §4.3.
- `corporation-manager.js` becomes a 5-line shim (`import {main} from
  './corporation-controller.js'`) or is renamed; the manifest, daemon and
  autopilot keep pointing at `corporation-manager.js` so no external file
  changes are required for the first cut.

### 4.2 Why not split into separate scripts

Splitting into 7 entrypoints would consume 7× the static RAM (≈ 6 TB — not
available) and would need manifest/daemon/autopilot changes plus per-script
status files. If a future board asks for it, the only viable split is
`bootstrap` (0 GB while no corporation exists, using only `hasCorporation`,
`canCreateCorporation`, `createCorporation` = 20 GB) as a separate tiny script.

### 4.3 Tick pipeline (fixed order)

1. **Guard** — pause flag, maintenance, achievement lock, single instance.
2. **Read** — `getCorporation`, divisions, offers, constants, bonus time (one
   snapshot per tick; cache within the tick).
3. **Classify** — state machine transition (§5); publish state.
4. **Finance first** — investment/IPO decisions, dividend rate, share actions
   (money in before money out).
5. **Budget ladder** — reserve → upkeep → growth bank → boost allowance (§7.2).
6. **Structural** — bootstrap/expansion: unlocks, industries, cities,
   warehouses (each re-checked immediately before purchase).
7. **People** — hire to target, assign jobs, tea/party, office upgrades.
8. **Product & research** — retire/create products, invest, research bundles.
9. **Market** — inputs/boost rates, sell prices, exports, smart supply.
10. **Upgrades** — global level upgrades, AdVerts, late unlocks.
11. **External** — hash requests, Hacknet carve-out, faction bribes.
12. **Persist** — status + state files, then `await nextUpdate()`.
13. **Failure handling** — per-operation counters, bounded retry, escalation.

## 5. Lifecycle state machine

### 5.1 States

| State | Meaning | Exits when |
| --- | --- | --- |
| `UNAVAILABLE` | API/gate absent, or `disableCorporation`, or creation refused permanently | never (terminal, exit with reason) |
| `NO_CORP` | No corporation; waiting for eligibility or funds | `hasCorporation()` true |
| `BOOTSTRAP` | Corporation exists; no division, or Warehouse/Office API missing with <9 staff | core division exists, Warehouse API + Office API owned, first office ≥9 staff |
| `FOUNDATION` | One division, one city; building the supply chain and research | first division profitable for 3 cycles **or** `Agri` warehouses complete |
| `EXPANDING` | Adding cities/warehouses/industries | all target cities have offices+warehouses, or next package unaffordable for >30 min (then `FOUNDATION`/`MONETIZING`) |
| `PRODUCT` | Product division has an in-development or unsold product, or slots empty | a product ≥100% and selling, TA.II owned |
| `MONETIZING` | Selling materials/products, pricing, exports, AdVerts | revenue > expenses for 10 cycles and pricing ready |
| `PUBLIC_GROWTH` | Investment rounds available, then IPO | public == true |
| `MATURE` | Public, profitable, dividends allowed, expansion still running | revenue ≤ expenses for 10 cycles → `RECOVERY`; or reset |
| `RECOVERY` | Cash or margin emergency; discretionary spending frozen | `funds ≥ 1.5×reserve` and margin ≥ 0 for 10 cycles |
| `SUSPENDED` | Paused / maintenance / achievement lock / another instance | guard clears |

`RECOVERY` and `SUSPENDED` are orthogonal-ish overrides: they are evaluated
before any money leaves the corporation, and the pre-recovery state is
remembered so exit returns there.

### 5.2 Transition rules

```
hasCorporation? ──no──> NO_CORP ──(canCreateCorporation Success & funded)──> BOOTSTRAP
UNAVAILABLE if canCreateCorporation ∈ {NoSf3OrDisabled, DisabledBySoftCap}
              or bitNodeOptions.disableCorporation   (exit, publish reason)
canCreateCorporation == UseSeedMoneyOutsideBN3 → NO_CORP (wait for $150b self-fund)
canCreateCorporation == CorporationExists      → BOOTSTRAP (re-read; corp exists)

BOOTSTRAP      → FOUNDATION : divisions.length > 0 && hasUnlock('Warehouse API') && hasUnlock('Office API')
                            && every office with a warehouse has size ≥ 9 and numEmployees ≥ 9
FOUNDATION     → EXPANDING  : lastCycleRevenue > lastCycleExpenses for the core division, 3 consecutive cycles
                            && every owned city of that division has a warehouse
EXPANDING      → PRODUCT    : a makesProducts division exists && science multiplier ≥ 1.15
PRODUCT        → MONETIZING : a product is at developmentProgress 100 in every city of its division
                            && hasResearched(name,'Market-TA.II')
MONETIZING     → PUBLIC_GROWTH : revenue > expenses × 1.1 on a 10-cycle moving average && offer.round ≥ 1
PUBLIC_GROWTH  → MATURE     : public == true
MATURE         → RECOVERY   : revenue ≤ expenses for 10 consecutive cycles
any            → RECOVERY   : funds < max(10e6, 1.5 × reserve)  OR  funds < expenses × cycleSeconds × 30
                            && revenue ≤ expenses
RECOVERY       → previous   : funds ≥ 1.5 × reserve && margin ≥ 0 for 10 consecutive cycles
any            → SUSPENDED  : isScriptPaused || maintenanceRequested || !achievementActionAllowed || second instance
```

Every transition is logged once with `{from, to, reason, at, funds, revenue,
expenses}` and mirrored into the status file. State must be derivable from the
live corporation snapshot alone (the persisted `previous` state is a hint, not a
requirement) so a restart cannot strand the machine.

### 5.3 Invariants

1. `funds ≥ reserve` after any discretionary action; `reserve` is recomputed from
   expenses every tick.
2. Ownership never drops below `minOwnership` (default 0.5) except during
   `RECOVERY` share issue, which must stay ≥ `minOwnership × totalShares`.
3. No product is discontinued and no division is sold unless the config enables
   it and the evidence gate passes (§6.2).
4. Buy rates are the only persistent side effect that costs money outside a call;
   every early return and `atExit` must zero them (`clearCorporationBuyRates`).
5. All mutations are preceded by an affordability/legality re-read within the
   same call frame.
6. Nothing is bought twice from two plans in one tick (`exclusive` claims in
   `executeCorporationGrowth`, `corporation-policy.js:207-227`).

## 6. Modules

Each module: purpose → inputs → actions → guards → telemetry → tests.

### 6.1 Bootstrap and expansion (`corporation-bootstrap.js`, `corporation-expansion.js`)

Purpose: take `NO_CORP` to a staffed multi-city corporation.

- **Create**: try seed money first (`createCorporation(name, false)`), then
  self-fund (`true`) only when wallet ≥ $150b + `reserve.txt` and
  `canCreateCorporation` returns `Success`. Name from config; never guess.
- **Industry chain** (default, config-overridable): Agriculture → Chemical →
  Tobacco (Tobacco produces products; Agriculture supplies Plants).
  `expand-all-industries` adds any industry whose `producedMaterials` fill a
  `requiredMaterials` gap of an existing division, cheapest first.
- **Unlocks in order**: `Warehouse API` → `Office API` → `Smart Supply`
  (each only while free cash covers it; the bootstrap buyer stops there).
  `Market Research - Demand` / `Market Data - Competition` stay with the market
  module, and `Export` is *not* bought: inputs are bought per city with
  `buyMaterial` rates (§6.1.1), so no export route exists to unlock. If a
  shared-input topology is ever adopted, that path must buy `Export` and add
  `exportMaterial`/`cancelExportMaterial` routes together.
- **City expansion**: for each division, for each of the six cities in config
  order, buy the package `officeInitialCost + warehouseInitialCost + 20e6` only
  when (a) every current city of that division already has a warehouse, (b) no
  office is understaffed (<9), (c) `funds > reserve + package`. Expansion is
  *staged*: publish the package price, the current free cash, the gap and an ETA
  from net profit; when the gap is >2× growthBank, also register cheaper
  alternatives (office increment, warehouse level, boost inventory) so the tick
  is never idle (fixes G4).
- **Warehouse**: only when `sizeUsed/size > 0.7` and no output backlog; one
  level per division/city per tick; never above level 5 without a full warehouse.
- **Division sale** (`sellDivision`): config `allowDivisionSale` (default
  `false`), requires a division with 0 cities or 0 revenue for 1,000 cycles and
  explicit config confirmation; never automatic.
- Guards: division cap errors are caught, recorded, retried in 5 min; already
  owned city/warehouse is a no-op; skipped when a critical office is unfunded.
- Telemetry: `bootstrap: {attempts, lastResult, blockedBy}`; every purchase is a
  growth decision with `{label, cost, state, basis}`.

#### 6.1.1 Implementation (bootstrap + expansion, this repository)

Files: `corporation-config.js`, `corporation-bootstrap.js`,
`corporation-expansion.js`, `corporation-bootstrap-daemon.js`,
`corporation-config.json` (§13), tests in `tests/corporation-bootstrap*.js`,
`tests/corporation-expansion*.js`, `tests/corporation-config.test.js`.

Contracts the integration card must respect:

- `readBootstrapSnapshot(api, config, context)` reads one authoritative snapshot
  through an injected `api` (the `ns.corporation` object) and returns
  `{gate, corp, divisions, offices, warehouses, warehouseInfo, unlocks,
  unlockCosts, industryData, constants, wallet, playerReserve, cycleSeconds,
  errors}`. Keys are `"<Division>/<City>"`. Every read is individually guarded;
  a failure is recorded in `errors` and the value is `null`.
- Decision functions are pure: `corporationGate`, `creationPlan`,
  `bootstrapDecisions`, `bootstrapProgress`, `materialSeedPlan`,
  `expansionDecisions`, `industryCandidates`, `nextCity`, `divisionComplete`,
  `divisionStaffed`, `staffingTarget`. They take `(snapshot, config, options)` and
  return decisions `{id, kind, label, cost, priority, state, detail, division, city,
  industry}` where `state ∈ ready|blocked`. `staffingTarget(config)` is the single
  source of `bootstrap.initialOfficeSize`, so the planner and the executor's
  pre-purchase re-check cannot disagree (a hardcoded 9 here disables every city
  expansion below the default office size).
- Effect functions take the same `api`: `runBootstrap(api, config, options)` and
  `runExpansion(api, config, options)` with
  `{dryRun, log, now, reserve, context, cooldowns, failures, maxActions}`. They
  return `{state, actions[{label,state,detail,at}], errors, blockedBy, quotes,
  cooldowns, funds, reserve, progress}`. `state` is one of
  `UNAVAILABLE|NO_CORP|BOOTSTRAP|READY|EXPANDING|FAILED`.
- Entrypoints: `runBootstrapExpansionCycle(ns, options)` (import this from the
  controller) and `main(ns)` (standalone loop). The cycle writes
  `tasks/corporation-bootstrap-status.json` and, in dry-run mode,
  `tasks/corporation-dry-run.json`. It never writes
  `tasks/corporation-status.json`; that file stays the controller's.

Behavioural decisions taken while implementing this section:

- **Staffing rule.** A city package is only bought when every office of that
  division already has `bootstrap.initialOfficeSize` (default 9) seats *and*
  that many employees, i.e. the same "staff existing offices first" rule the old
  controller encoded as `officesUnderstaffed()`. Without the Office API the
  check is skipped so expansion still works (edge 9).
- **Office growth belongs to bootstrap for the seed offices.** `bootstrap` grows
  every office that has a warehouse up to `initialOfficeSize` in 3-seat steps;
  `corporation-people.js` owns everything above that. Without this, the
  staffing rule above would deadlock a fresh save at a 3-seat office.
- **One division per industry, adopted by industry.** A hand-made division is
  adopted when its `industry` matches the configured chain instead of creating a
  duplicate the game would reject.
- **Status file split.** Bootstrap keeps its own status document so it can be
  run next to the existing controller without clobbering `mode/funds/reserve/
  divisions/growthPriority` that dashboards read from
  `tasks/corporation-status.json`.
- **RAM.** The four files reference four `ns.corporation` members directly
  (`hasCorporation`, `canCreateCorporation`, `getCorporation`, `nextUpdate`:
  11.6 GB static) plus 26 members through the injected `api` object, which the
  game's analyzer cannot see. Worst case, if every one of those 26 were counted,
  the entrypoint would cost 331.6 GB — still far below the controller's 858.9 GB,
  and the controller already pays for them because it calls `ns.corporation`
  directly. The integration card must keep the corporation calls in the
  controller (or a file it imports statically), not rely on the dynamic
  `api.foo()` shape to be charged.
- **Expansion quotes, not partial buys.** An unaffordable package publishes
  `{cost, gap, etaSeconds, longWait, alternatives[{kind:office|storage}]}`; the
  office alternative is quoted read-only because buying office size outside
  bootstrap belongs to the people module.
- **Unlocks stop at Smart Supply.** The buyer owns `Warehouse API`, `Office API`
  and `Smart Supply`; `Export` costs are read for reporting but never purchased,
  because inputs are bought per city with `buyMaterial` rates instead of export
  routes (`Market Research - Demand` / `Market Data - Competition` belong to the
  market module).
- **RAM preflight is reservation-aware.** `main(ns)` refuses to start only when
  home cannot host the script at all (`required > getServerMaxRam('home')`) or
  when the reservation still does not fit after adding this instance's own usage
  back to free RAM — the running script is already part of
  `getServerUsedRam`, so comparing `required` against bare free RAM would refuse
  any home whose *leftover* RAM is smaller than the daemon itself (the same rule
  as `autopilot.js:1105`).

### 6.2 Product and research (`corporation-product.js`)

Purpose: turn research points into saleable product quality and keep research
ahead of product generations.

- **Science gate**: `sciMult = 1 + RP^scienceFactor / 800` per division
  (`corporationProductScience`). Do not create a product below **1.15**
  (`corporationProductScienceMinimum`); abandon in-flight development below
  **1.1** (`corporationProductScienceHopeless`) rather than paying burn.
- **Slots**: `Division.maxProducts` is authoritative (live Tobacco: 3). With
  `products.length >= maxProducts`:
  1. if a slot holds a product at <100% progress and it is hopeless → discontinue;
  2. else if `allowProductRetirement` and `productReplacementReady` passes
     (settling ≥ max(10 cycles, 1.5 × observed dev time) and ≥1.2× design
     investment, or ≥1.25× research, or ≥1.2× employees) → discontinue weakest by
     `rating × sell-through`;
  3. else skip creation and publish `productSlots: "full"` plus the candidate's
     projected quality — never call `makeProduct` blind (fixes G5).
- **Create**: name `"<Division> <n>"` from a monotonic counter in state;
  design/marketing investment = `productInvestment(free, reserve, budget)`
  (`corporation-lifecycle.js:8-12`); city = the strongest development office
  (`corporationDevelopmentCity`).
- **Develop**: target office = 30/60/80/100/120 employees by cash tier; R&D +
  Engineering share ≥ 34% of the office while developing; office growth only
  when free cash funds the increment and no output backlog.
- **Research order**: `Hi-Tech R&D Laboratory` → `Market-TA.I` + `Market-TA.II`
  (bought as a package, `researchAffordable` = cost ≤ 20% of pooled RP) →
  branch bundles respecting `researchParents` (`corporation-lifecycle.js:1-6`) →
  optional (`HRBuddy-*`, `uPgrade: Dashboard`) last. Never spend the pool below
  the production-quality floor.
- **Research vs hash funding**: when TA.II is unaffordable, publish the RP gap
  and let the finance module quote a hash exchange (1,000 RP per purchase).
- Telemetry: per division `{productName, city, startedAt, research, employees,
  scienceMult, status}`; reconcile against `Division.products` every tick and
  clear stale entries (fixes G3).
- Tests: slot-full matrix (empty/developing/mature), science gate boundaries,
  replacement evidence, research bundle ordering, parent prerequisites.

### 6.3 Employees and upgrades (`corporation-people.js`)

- **Hire**: fill to `target` (cash tier: 3/9/15/20/30/45/60 for materials;
  30/60/80/100/120 for products; ≥9 before a second city). Loop
  `hireEmployee` until `numEmployees == size`, bounded by `size`.
- **Assign**: `optimizedOfficeJobs` (§7.6) with 120-step bounded local search;
  every role ≥ 1; Interns only while morale/energy is below `max − 2` and upkeep
  is unaffordable. `setJobAssignment(..., 'Unassigned', n)` is a no-op — do not
  use it.
- **Zero employees**: if `size > 0 && numEmployees == 0` for 3 ticks, raise a
  `people.starvation` finding with the quoted office cost and the exact API
  error, and stop reporting invented productivity (fixes G12).
- **Upkeep**: tea when `avgEnergy < max − 2` and `employees × teaCostPerEmployee
  ≤ officeUpkeep`; party sized by `partySpendPerEmployee` (skip < $100k/employee
  as wasted); zero during `RECOVERY`; AutoBrew/AutoPartyManager replace both.
- **Office size**: quote the increment actually needed, fall back to 3 then 1
  when unaffordable; raise the growth bank just enough for the increment
  (`growthBankForOffice`).
- **Global upgrades** (30 s cadence): rank by
  `upgradeReturn(upgrade, level, cost, storagePressure)` over
  `Smart Storage` (only under storage pressure), `Smart Factories`,
  `Nuoptimal`, `Speech Processor`, `Neural Accelerators`, `FocusWires`,
  `ABC SalesBots`, `Project Insight`; cap each at 20% of cash (35% for Smart
  Storage under pressure) and require `funds > reserve + cost`.
- **AdVerts**: bundle Wilson Analytics with same-level AdVert purchases
  (`corporation-advert-bundle-policy.js`); cap the bundle at 50% of cash;
  skip when awareness and popularity are `Number.MAX_VALUE`.
- Telemetry: per office `{division, city, size, employees, jobs, energy, morale,
  target, starvation}`; per upgrade `{name, level, cost, score, decision}`.

### 6.4 Investment, dividends, shares (`corporation-finance.js`)

- **Investment rounds**: `getInvestmentOffer()` gives `{funds, shares, round≤4}`.
  Accept only when all hold (`investmentDecision`,
  `corporation-lifecycle.js:21-46`):
  - `offer.funds > max(1e9, 300 × (revenue − expenses))` — a real premium;
  - `(numShares − offer.shares)/totalShares ≥ investmentMinOwnership` (default 0.1;
    general `minOwnership` 0.5 applies to all other actions);
  - stage readiness: round ≤2 needs Agri warehouses + (Chemical|Tobacco) for
    round 2; rounds 3-4 need a completed product;
  - waiting rules: accept when valuation growth settles (10 cycles without
    improvement), after a 30-minute bounded wait, or immediately when
    `funds ≤ 1e6` / margin-negative and `funds < expenses × 2 cycles`.
  Never accept across an ownership floor; never re-use a stale offer (`round`
    changed ⇒ reset the history).
- **IPO**: `goPublic(0)` when `valuation ≥ ipoValuationFloor` (default 1e10),
  not during `RECOVERY`, and no investment round is still improving. Issuing 0
  shares keeps 100% ownership; issuing shares is config-gated and must respect
  `minOwnership`.
- **Dividends**: rate 0 while `growthPriority` (pre-IPO growth), `RECOVERY`, or
  `revenue ≤ expenses`; otherwise tiered by funds: ≥$1e21 → 20%, ≥$1e18 → 10%,
  ≥$1e15 → 5%, ≥$1e13 → 2%, else 0; clamp to `constants.dividendMaxRate`. Net
  income uses the tribute exponent: `((profit × cycles × rate × own/total)^(1−tribute))/cycles`
  (`corporationDividendRate`). Only call `issueDividends` when the rate changed.
- **Share issue** (only in `RECOVERY`): `rescueShareIssue` — requires public,
  cooldown 0, `funds < 1.5 × reserve`, negative margin, price > 0; cap
  `min(20% of totalShares, numShares/minOwnership − totalShares, 1e14)`.
- **Share sale** (player liquidity only): `shareSale` — only for a fresh
  augmentation milestone snapshot (`corporationLiquidityTarget`), cooldown 0,
  cap 1% of totalShares and never below `minOwnership`, skip when a dividend
  would cover the gap within 300 cycles.
- **Buyback**: `shareBuyback` — only when `numShares/totalShares < minOwnership +
  0.15`, spend ≤1% of unreserved wallet, ≤1e6 shares, price headroom 1.25×, not
  during `growthPriority`/`RECOVERY`.
- **Bribes**: require SF4/BN4, `valuation ≥ constants.bribeThreshold`,
  amount ≤ min(deficit × bribeAmountPerReputation, 0.1% free cash, 5% cycle
  profit) and ≥ $1e9; 60 s cadence.
- Telemetry: `financing` reason string, `offer.round/funds/shares`,
  `ownership`, `dividendRate`, `estimatedDividendIncome`,
  `shareActions: [{kind, shares, at, reason}]`.

### 6.5 Market trading (`corporation-market.js`)

Scope: materials and products, not stocks.

- **Inputs**: with Smart Supply → `buyMaterial(...,0)` + `setSmartSupplyOption
  (..., 'leftovers')` so exports are consumed before purchases; without it →
  `recipeInputPlan` rates sized to observed production × `cycleSeconds × 1.1`,
  scaled to the input budget (≤50% of free cash) and skipped when the warehouse
  is >95% full. Every rate must be re-issued each tick or zeroed.
- **Boosts**: `Real Estate`, `Hardware`, `Robots`, `AI Cores` toward
  `optimalBoostTargets` at 60% of warehouse size; buy-rate commits are reserved
  immediately (`reserve += committed`); zero the rates for materials that are
  recipe inputs and on every early return.
- **Selling**: with `Market-TA.II` → `sellMaterial(..., "MAX", "MP")` +
  `setMaterialMarketTA2(true)`, and `sellProduct(..., "MAX", "MP", true)` +
  `setProductMarketTA2(true)` (all cities). Without it:
  - materials: `MP + quality/baseMarkup` (`materialSalePrice`);
  - products: formula price `MP + markupLimit × sqrt(potential/target)` where
    `markupLimit = effectiveRating / inferredMarkup`, target =
    `production + stored/cycles`; fall back to geometric discovery
    (`productPriceStep`) with a stateful low/high bracket;
  - persist the bracket and inferred markup in state (fixes G9).
- **Exports**: create a route only when the source quality exceeds the target's
  by ≥5% (`materialExportWorthwhile`); formula `"(EPROD+EINV/10)"` per second,
  because a negative formula exports nothing silently. Inspect existing
  `Material.exports`; when a route no longer passes the quality test, cancel it
  with `cancelExportMaterial` (fixes G6) — bounded to one cancellation per tick.
- **Warehouse-full handling**: when an output backlog persists two ticks, stop
  production growth, prefer price reduction (drain over 3 cycles), and only then
  consider `limitProductProduction` to throttle (new capability, G5/G6).
- Telemetry: per division/city `{sellThrough, backlog, pressure, price,
  multiplier, routeCount}`; pricing observations for calibration.

### 6.6 External dependencies (inside `corporation-finance.js`)

- **Hashes** (SF9/BN9): quote a milestone, then spend — `Sell for Corporation
  Funds` at $1b per 500 hashes, `Exchange for Corporation Research` at 1,000 RP
  per purchase; bound to 5,000 hashes/16 purchases (20,000/32 when a staged
  funding goal exists); publish the target so `spend-hacknet-hashes.js` reserves
  it instead of competing.
- **Hacknet carve-out**: while a hash milestone exists, allow a bounded share of
  the player wallet (reserve floored at $1b) to buy hash production.
- **Singularity**: absent ⇒ bribes and augmentation snapshots are skipped, not
  failed.

## 7. Optimisation objectives and heuristics

### 7.1 Objective hierarchy

1. **Solvency** — never let `funds` fall below `reserve` (2 cycles of expenses,
   floor $1e6, cap $5e9, or 10% of cash).
2. **Profit per cycle** (`revenue − expenses`) on a 3-cycle minimum-of-samples
   basis, so one lucky cycle cannot justify a purchase.
3. **Valuation** (`CorporationInfo.valuation`) — drives investment offers and
   share price; proxy for every structural investment.
4. **Product quality** (`Product.rating`/`effectiveRating`) and research depth —
   the compounding term for late-game revenue.
5. **Ownership-adjusted player income** — dividends × ownership minus tribute;
   share price is a *derived* signal, never a target on its own.

### 7.2 Budget ladder (all numbers configurable, defaults from current code)

```
reserve       = max(1e6, min(5e9, 0.10 × funds), expenses × cycleSeconds × 2)
free          = max(0, funds − reserve)
upkeepBudget  = 0                                        if recovering
              = min(free, 0.02 × funds, dev ? max(0.25 × profit × cyc, 0.01 × free) : 0.25 × profit × cyc)
growthBank    = min(free, max(bank + profit × cyc × (dev ? 0.75 : 0.25), dev ? 0.15 × free : 0))
boostBudget   = min(0.20 × funds, free, allowance)
allowance     = (revenue == 0 && expenses == 0) ? min(10e6, 0.01 × funds)
                                                : max(0, revenue − expenses) × cyc × 0.5
```

`profit = max(0, revenue − expenses)`; `cyc = constants.secondsPerMarketCycle`.
`RECOVERY` zeroes upkeep, boost, growth, dividends, shares and product invest,
and only permits survival actions (sell everything at MP, buy nothing).

### 7.3 Scoring: benefit per dollar

Every structural plan is `{label, cost, score, priority, exclusive?, run()}`
where `score ≈ (estimated fractional benefit) / cost`. The existing pipeline
must be preserved:

1. Base score from the heuristic (§7.4-7.7), then
2. multiplied by observed profit of the scoped division/city relative to the
   reference (`scoreCorporationGrowth`), with bottlenecks: production plans score
   `sellThrough`, storage plans score `pressure > 0.8`, sales plans score `1.5`
   when backlogged and `0.5` when sell-through is > 95%;
3. discounted for payoff beyond the current reset horizon
   (`planCorporationDelayedReturns`);
4. calibrated by measured profit deltas after comparable purchases
   (`calibrateCorporationGrowth`), and
5. executed greedily by score, skipping plans that lose an `exclusive` claim
   (Wilson+AdVert bundles, "one upgrade per cycle").

If a plan's measured basis is missing, label it `Comparable heuristic` in
telemetry — never present an estimate as measured.

### 7.4 Pricing heuristics

- TA.II ⇒ `"MP"`, always.
- Materials ⇒ `MP + quality/baseMarkup` (additive dollars per `Material.baseMarkup`).
- Products ⇒ exponential search over the markup multiplier with a low/high
  bracket; invert the native square-root markup penalty from observed
  sell-through; drain large inventories over three cycles; infer the immutable
  markup coefficient from a capped sale (`inferProductMarkup`). Floor = 1.0×,
  ceiling = 1e6×.
- Sell amount is `"MAX"` everywhere; a backlog implies a price problem, not an
  amount problem.

### 7.5 Research priority

`Hi-Tech R&D Laboratory` → `Market-TA.I` + `.II` as a package → branch bundles
(parent-respecting) → `Self-Correcting Assemblers` / `Drones*` / `Overclock` /
`Sti.mu` → optional HR/unlock research. Buy only when
`cost ≤ 20% of pooled RP`; prefer bundles when their combined benefit/discount
beats single purchases. Never buy research that costs more RP than the division
can replace in ~5 cycles while a product is in development.

### 7.6 Employee allocation

Score a job mix `(op, en, bus, mg, rnd)` with
`output = (op^0.4 + en^0.3) × (1 + mg/(1.2 × (op+en+mg)))` for materials,
`development = (en^0.34 + op^0.2) × managementFactor` for products, then
`× businessFactor^exponent × (1 + rnd)^researchWeight × quality^0.35`.
Per-worker productivity from `Office.employeeProductionByJob / employeeJobs`
when available, else the skill-weighted fallback. Requirements: every role ≥ 1,
research preserved while `protectResearch`, engineering preserved in material
divisions, ≤120 improvement steps.

### 7.7 Valuation, share price, products

- Valuation drivers, in the order they should be funded: profitable cities →
  products with a science multiplier above 1.15 → research bundles → AdVerts
  (benefit measured via `corporationAdvertBenefit`) → global upgrades → optional
  industries.
- Share price = valuation / totalShares: raise it by growing valuation and
  avoiding dilution; never issue shares to fund growth that a dividend pause
  would fund.
- Product quality levers, in order: research points at creation time (frozen
  thereafter), design investment, employee count/experience, AdVerts.

### 7.8 Success measurement

Per tick, persist: funds, revenue/cycle, expenses/cycle, profit, valuation,
share price, ownership, research points/division, product ratings, sell-through,
backlog, warehouse pressure, growth bank, decisions, and the state name.
Success for a run: (a) 10-cycle median profit ≥ 2× the pre-change baseline on the
same save, (b) no action ever takes `funds` below `reserve`, (c) ownership ≥
floor, (d) zero unhandled exceptions in a 4-hour unattended run.

## 8. Configuration schema

File: `corporation-config.json` at the repository root (synced to the game like
any other file). Read with `ns.read`, parse defensively; **any** invalid field
falls back to the default and is reported once. CLI flags override the file.

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "dryRun": false,
  "corporation": { "name": "Apex Holdings", "selfFund": true, "seedFirst": true },
  "bootstrap": {
    "industryChain": ["Agriculture", "Chemical", "Tobacco"],
    "cities": ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"],
    "expandAllIndustries": false,
    "allowDivisionSale": false,
    "warehouseFullThreshold": 0.7,
    "expediteStagedExpansion": true,
    "initialOfficeSize": 9,
    "setupReserve": 20000000,
    "materialCashFraction": 0.05
  },
  "product": {
    "scienceFloor": 1.15,
    "scienceAbandonFloor": 1.1,
    "allowProductRetirement": false,
    "developmentSpeed": true,
    "maxProductsPerDivision": null
  },
  "people": {
    "officeTargets": { "materials": [3, 9, 15, 20, 30, 45, 60], "products": [30, 60, 80, 100, 120] },
    "teaThreshold": 2,
    "upgradeFraction": 0.2,
    "storageUpgradeFraction": 0.35
  },
  "finance": {
    "minOwnership": 0.5,
    "investmentMinOwnership": 0.1,
    "acceptInvestment": true,
    "ipoValuationFloor": 1e10,
    "ipoShares": 0,
    "payDividends": true,
    "dividendTiers": [[1e21, 0.2], [1e18, 0.1], [1e15, 0.05], [1e13, 0.02]],
    "manageShares": true,
    "bribeFactions": true
  },
  "market": {
    "advertSpendFraction": 0.5,
    "boostWarehouseFraction": 0.6,
    "exportQualityMargin": 0.05,
    "priceCeiling": 1e6,
    "throttleProductionOnBacklog": false
  },
  "budgets": {
    "reserveFloor": 1e6, "reserveCap": 5e9, "reserveCashFraction": 0.1,
    "reserveExpenseCycles": 2, "growthFraction": 0.25, "developmentGrowthFraction": 0.75,
    "upkeepCashFraction": 0.02, "boostCashFraction": 0.2, "recoveryMarginCycles": 30
  },
  "research": { "affordableFraction": 0.2, "optionalAutomation": false },
  "telemetry": { "statusFile": "tasks/corporation-status.json", "cadenceMs": 60000, "debug": false }
}
```

Validation rules (implement in `corporation-config.js`, unit-tested):

- every numeric is finite and within `(0, …]` ranges; `0 ≤ f ≤ 1` for fractions;
  `minOwnership ∈ (0, 1]`; `investmentMinOwnership ≤ minOwnership`;
- `ipoValuationFloor ≥ 1e9`; `scienceFloor > scienceAbandonFloor ≥ 1`;
- cities ⊆ `["Sector-12","Aevum","Volhaven","Chongqing","New Tokyo","Ishima"]`;
- unknown keys are ignored with a warning; unknown `schemaVersion` runs with
  defaults and reports `config.unsupportedVersion`;
- `dryRun: true` ⇒ no mutating API call is allowed; plans are still computed and
  written to `tasks/corporation-dry-run.json`.

Flag mapping (backwards compatible, must keep working):

| Flag | Config path | Default |
| --- | --- | --- |
| `--development-speed` | `product.developmentSpeed` | `true` |
| `--min-ownership` | `finance.minOwnership` | `0.5` |
| `--investment-min-ownership` | `finance.investmentMinOwnership` | `0.1` |
| `--expand-all-industries` | `bootstrap.expandAllIndustries` | `false` |
| `--manage-shares` | `finance.manageShares` | `true` |
| `--bribe-factions` | `finance.bribeFactions` | `true` |
| `--dry-run` (new) | `dryRun` | `false` |

## 9. Logging, telemetry, failure handling

### 9.1 Status document (`tasks/corporation-status.json`)

Fixed top-level keys, additive changes only, `schemaVersion: 2`:

```
schemaVersion, at, pid, nodeReset, augReset, corporation, state,
stateSince, stateReason, mode (kept for compatibility), funds, reserve,
revenue, expenses, profitPerCycle, valuation, sharePrice, public, ownership,
minOwnership, dividendRate, estimatedDividendIncome, growthBank, growthGoal,
growthDecisions[], fundingDiagnostics[], researchDecisions{}, productMetrics{},
productSlotsPerDivision{}, staffingGoals{}, offices[], upgradeDecisions[],
shareActions[], hashMilestone, bootstrap{}, persistentFailures[], dryRun,
configErrors[], lastActionAt, cyclesManaged
```

`automation.status` and any dashboard read this file; keep `mode`, `funds`,
`reserve`, `divisions`, `growthPriority` unchanged for compatibility
(`README-AUTOMATION.md:223-225`).

### 9.2 State files

All corporation state lives under `tasks/` with `schemaVersion` and the triple
key `{nodeReset, augReset, corporation}`. Mismatch ⇒ discard, never migrate
blindly.

| File | Content |
| --- | --- |
| `tasks/corporation-state.json` | state machine: `{state, since, previous, cyclesInState, transitionCounters}` |
| `tasks/corporation-lifecycle.json` | growth bank, last expansion, advertising recovery |
| `tasks/corporation-product-metrics.json` | per division: developing product, start, science, employees |
| `tasks/corporation-product-cycle.json`, `corporation-other-product-cycles.json` | product creation timers |
| `tasks/corporation-upgrade-calibration.json` | calibration samples, pending quotes |
| `tasks/corporation-growth-market.json` | per-location profit/sell-through samples |
| `tasks/corporation-finance.json` | offer history, liquidity decision, last share sale |
| `tasks/corporation-research.json` | RP samples, upkeep history |
| `tasks/corporation-hash-goal.json` | published hash milestone (`schemaVersion: 2`) |
| `tasks/corporation-pricing.json` | **new** price brackets + inferred markups (fixes G9) |
| `tasks/corporation-status.json` | status document (§9.1) |
| `tasks/corporation-dry-run.json` | dry-run plan log |

Writes are synchronous (`ns.write`), one file per concern, and must never be
larger than ~64 KB (cap arrays: 128 decisions, 32 offices, 16 divisions).

### 9.3 Failure classes and escalation

| Class | Example | Handling |
| --- | --- | --- |
| Transient | `nextUpdate` rejected, remote file read | retry next tick, counter reset on success |
| Expected/illegal | `sellMaterial` without warehouse, `makeProduct` with full slots, `expandIndustry` at cap | pre-check, skip, record `blocked` reason once per state |
| Persistent | same call throws 5 cycles in a row | announce once, repeat every 10 min, keep counter across restarts (fixes G10) |
| Fatal | no API access, `disableCorporation`, config unusable | publish reason, exit non-zero, do not busy-loop (fixes G11/G13) |

Every failure: `{operation, message, count, firstAt, lastAt, announced}` in
`persistentFailures`. `atExit` always calls `clearCorporationBuyRates(c)` so a
crash cannot leave paid buy rates behind.

### 9.4 Idempotency and restart safety

- Re-read before mutate; a second instance exits at startup
  (`ns.ps('home')` check, already present).
- Purchases are keyed by observable state, not by "did I run already":
  unaffordable ⇒ wait, already-owned ⇒ no-op, cooldown ⇒ wait.
- No wall-clock-only decision except: pricing tuning cadence, upgrade cadence
  (30 s), bribe cadence (60 s), stall notices, and status printing. Those must
  tolerate being late.
- State files are written after actions, before `nextUpdate`; a crash between
  action and write must be recoverable from the live corporation snapshot.

### 9.5 Dry-run

`dryRun: true` computes the full plan and writes intended actions with
`{label, cost, target, guard, wouldDo}`; it must not call any mutating function.
Acceptance: a dry run over one full cycle produces a plan identical to the
`growthDecisions` of a real run on the same save (compare labels/order).

## 10. Edge cases (required behaviour + acceptance test)

| # | Case | Detection | Required behaviour |
| --- | --- | --- | --- |
| 1 | No corporation | `hasCorporation() === false` | `NO_CORP`; try seed then self-fund; publish status even here (fix G11); if `canCreateCorporation` ∉ {`Success`,`UseSeedMoneyOutsideBN3`,`CorporationExists`} → `UNAVAILABLE`, exit with reason |
| 2 | Insufficient funds to create | wallet < $150b + reserve and seed unavailable | wait, publish `bootstrap.blockedBy = "funds"` with gap; sleep 60 s; never spam |
| 3 | BitNode restrictions | `currentNode !== 3 && !SF3`, `bitNodeOptions.disableCorporation`, `DisabledBySoftCap` | exit immediately with the exact enum reason; no API mutations; test asserts no calls |
| 4 | Unlocks missing | `hasUnlock('Warehouse API'/'Office API'/'Smart Supply')` false | buy in order when free cash allows; skip warehouse/office/export code paths entirely; never throw |
| 5 | Zero divisions | `corp.divisions.length === 0` | create the chain's first industry when `free > startingCost + setupReserve`; publish quoted cost |
| 6 | Division with zero cities | `division.cities.length === 0` | expand to the first configured city; treat as blocking for all other division work |
| 7 | Insufficient funds for expansion | package cost > free | stage it: publish gap + ETA; register cheaper alternatives; no partial city purchase without warehouse |
| 8 | Zero employees | `office.size > 0 && numEmployees === 0` for 3 ticks | retry hire once per tick; after 3 ticks raise `people.starvation`, include quoted cost and error; do not assign jobs or claim production |
| 9 | Zero employees, no Office API | `hasUnlock('Office API') === false` | skip all office logic; report `blocked: "Office API"`; expansion still allowed |
| 10 | Full product slots | `division.products.length >= division.maxProducts` | no `makeProduct`; report `productSlots: "full"`; retire only per config + evidence gate; never throw |
| 11 | Product vanished / stalled | metrics name ∉ `division.products`, or `developmentProgress` unchanged for 10 cycles | clear stale metric entry, log, and either restart development or switch to material sales |
| 12 | Warehouse full / backlog | `sizeUsed/size > 0.9` or 2-cycle backlog | stop production growth and boosts; drain via price; optional `limit*Production` throttle |
| 13 | City without warehouse | `hasWarehouse === false` | never `sellMaterial`/`buyMaterial`/`getProduct` for that city; expand warehouse first |
| 14 | Investment offer unavailable | `getInvestmentOffer()` throws or `round` > 4 | `holdIPO` false; proceed to IPO check; never call `acceptInvestmentOffer` |
| 15 | Offer violates ownership floor | `(numShares − shares)/totalShares < min` | reject, log `ownership floor`, keep waiting; never accept "just this round" |
| 16 | Stale/duplicate offer | offer `round` changed or `funds` decreased | reset history; re-evaluate; never accept from cached values |
| 17 | Public cooldowns | `issueNewSharesCooldown > 0` / `shareSaleCooldown > 0` | wait; do not spam; count as `expected` not `error` |
| 18 | Insufficient player wallet for buyback | `wallet − reserve < 1e9` | skip buyback; never fund from corporation cash |
| 19 | Division cap reached | `expandIndustry` throws | catch, record `division cap`, retry in 5 min, do not retry in the same tick |
| 20 | Research unaffordable | `cost > 0.2 × points` | keep the pool, publish gap and the RP rate; offer a hash exchange |
| 21 | Negative margin with large cash | `revenue ≤ expenses` for 10 cycles | `RECOVERY` regardless of cash; freeze bonus/advert/product/upgrade spend; no forced share sales |
| 22 | Reset during run | `nodeReset`/`augReset` changed | discard all state, re-derive state, re-enter at the right state; zero buy rates |
| 23 | Restart / save-reload | fresh process, stale task files | same as 22 within the same reset; no duplicate purchase, no leaked buy rate |
| 24 | Second instance / pause / maintenance / achievement lock | `ns.ps`, `isScriptPaused`, `maintenanceRequested`, `achievementActionAllowed` | `SUSPENDED`; zero buy rates; exit (second instance) or sleep (pause) |
| 25 | RAM starvation | `getScriptRam > free home RAM` | fail fast with a message naming required GB (858.9); never partially initialise |
| 26 | Missing market data unlocks | `product.demand`/`competition` undefined | fall back to `MP`/heuristic pricing; never NaN prices |
| 27 | No hashes / no Singularity | `hacknet` throws, SF4 absent | skip those modules, report `unavailable`, continue |
| 28 | API throws repeatedly | same label 5× consecutive | announce once, back off 10 min, persist the counter |
| 29 | Bonus time available | `getBonusTime() > 0` | schedule expensive transitions (product invest, `nextUpdate` fights) to use it; never assume 200 ms cycles |
| 30 | NaN/Infinity anywhere | non-finite input | reject the plan, log, keep the safe default (all policy helpers already return 0/null on non-finite input — keep that rule) |

## 11. Acceptance criteria

Spec-level (this card):

1. `docs/corp-automation-spec.md` exists and defines every area listed in the
   task: lifecycle states/transitions, the five modules, optimisation
   objectives/heuristics, config schema with defaults, telemetry/failure
   handling, acceptance criteria, edge cases, and the file list.
2. Every edge case in §10 is explicit, with detection, required behaviour, and a
   test hook.
3. All claims about current behaviour are traceable to a file/line or to a live
   read documented in §2.3.
4. API claims match the connected game's `NetscriptDefinitions.d.ts` and
   `scripts/api-surface.json`.
5. A developer with no prior context can implement any module from §6 alone
   (inputs, actions, guards, telemetry, tests named).

Implementation-level (for the child cards):

6. State machine: unit tests drive every transition in §5.2 from synthetic
   snapshots, including `NO_CORP → BOOTSTRAP → FOUNDATION`, `MATURE →
   RECOVERY → MATURE`, and `UNAVAILABLE` terminal exits.
7. Guards: a mock API that throws on every mutation produces zero unhandled
   exceptions and a complete `persistentFailures` report.
8. Reserve invariant: property test over random snapshots — after a tick,
   `funds ≥ reserve` and no plan with `cost > free` is executed.
9. Idempotency: running two consecutive ticks on an unchanged mock snapshot
   performs no second purchase and issues no duplicate `hireAdVert`/`research`.
10. Buy-rate hygiene: every early return path ends with all boost rates zeroed;
    `atExit` clears them.
11. Edge cases 1-30 each have a passing test in `tests/corporation-*.test.js`.
12. Dry-run produces a plan identical to the real run's decisions on the same
    snapshot.
13. Config: invalid JSON, invalid ranges, and unknown schema versions fall back
    to defaults with a reported error and never throw.
14. Telemetry: `tasks/corporation-status.json` validates against the §9.1 key
    set and keeps the legacy keys (`mode`, `funds`, `reserve`, `divisions`,
    `growthPriority`).
15. Existing suite stays green: `npm test`, `npm run check:syntax`, and
    `node scripts/audit-project.js api` (no new unsupported API use).
16. RAM: `ns.getScriptRam('corporation-manager.js','home')` must not exceed the
    current 858.9 GB by more than the cost of the new API functions used
    (`cancelExportMaterial` +20, `limit*Production` +40, `sellDivision` +20,
    `setMaterialMarketTA1` +20 ⇒ ≈ 959 GB worst case, still within a
    documented budget; update `scripts/api-surface.json` consumers only if it
    grows past the daemon/autopilot reservation).
17. Live smoke: with a real save, one full cycle logs the state, publishes the
    status document, and takes no forbidden action (verified via Remote API
    `automation.corpStatus` before/after).
18. No regression in the `--disable-corporation` path: the controller does not
    start, autopilot's reservation is unchanged.

### 11.1 Covered by the bootstrap/expansion card

- Criteria 7 (a mock API throwing on every mutation produces zero unhandled
  exceptions and a failure report), 9 (idempotency), 12 (dry-run parity of the
  planned actions), 13 (config fallbacks), 14 (status document keys, legacy keys
  kept) and 15 (`npm test`, `npm run check:syntax`, `audit-project.js api`) are
  asserted by `tests/corporation-bootstrap*.test.js`,
  `tests/corporation-expansion.test.js` and
  `tests/corporation-bootstrap-daemon.test.js`.
- Edge cases 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 19, 20 (RP gap is only quoted),
  24, 25, 26, 28, 30 have a dedicated test in those files.
- Criterion 17 (live smoke) is covered as far as a read-only Remote API allows:
  `tests/fixtures/corporation-live-snapshot.json` is a real capture of the live
  corporation and `corporation-expansion.test.js` replays it through the planner
  (no throw, warehouse first, the $9.02b package staged with its gap, no
  discretionary industry for a loss-making corporation). A mutating live run is
  left to the controller card, because the entrypoint is not in the manifest.
- Criteria 6, 8, 10, 11 (state machine transitions, reserve property test,
  buy-rate hygiene on every path) belong to the controller and people/product
  cards; bootstrap/expansion keep the reserve invariant and expose
  `bootstrapProgress` for the state machine.

## 12. Test plan

- Unit (pure policy): `node --test tests/corporation-*.test.js` — state machine
  transitions, budget ladder, pricing brackets, research bundles, product slots,
  share/investment rules, config validation.
- Bootstrap/expansion: `node --test tests/corporation-config.test.js
  tests/corporation-bootstrap.test.js tests/corporation-expansion.test.js
  tests/corporation-bootstrap-daemon.test.js` drives the modules against
  `tests/corporation-test-game.mjs`, an in-memory game that enforces unlocks,
  funds, warehouses, city uniqueness, office capacity and division caps, from
  "no corporation" to a multi-city corporation, and replays the captured live
  snapshot in `tests/fixtures/corporation-live-snapshot.json`.
- Mock controller: a fake `api` implementing the 61 functions with recorded calls;
  assert ordering, no-mutation-on-failure, idempotency, dry-run parity.
- Property tests: reserve invariant, NaN handling, monotonic state counters.
- Static: `npm run check:syntax`, `node scripts/audit-project.js api|ram|imports`,
  `node scripts/check-native.js` (native RAM preflight through the Remote API).
- Live: one full cycle in a real save with `dryRun` first, then a monitored run;
  compare `automation.corpStatus` snapshots before/after, verify no
  `persistentFailures` and no funds below reserve.

## 13. Files to create / modify

Create:

1. `docs/corp-automation-spec.md` — this document.
2. `corporation-controller.js` — tick loop, guards, wiring (or keep
   `corporation-manager.js` as the entrypoint shim).
3. `corporation-state.js` — state machine, transitions, persistence, status doc.
4. `corporation-config.js` — schema, defaults, validation, flag merge.
5. `corporation-bootstrap.js` — creation, unlocks, first division/city. **Done.**
6. `corporation-expansion.js` — cities, warehouses, industries. **Done.**
7. `corporation-product.js` — products, research, science gate.
8. `corporation-people.js` — offices, jobs, upkeep, upgrades, AdVerts.
9. `corporation-finance.js` — investment, IPO, dividends, shares, hashes, bribes.
10. `corporation-market.js` — inputs, boosts, pricing, selling, exports.
11. `corporation-config.json` — default configuration file. **Done.**
12. `tests/corporation-state.test.js`, `-config.test.js`, `-bootstrap.test.js`,
    `-expansion.test.js`, `-product.test.js`, `-people.test.js`,
    `-finance.test.js`, `-market.test.js`, `-edge-cases.test.js`,
    `-dry-run.test.js`. **Done:** `-config`, `-bootstrap`, `-expansion` and
    `-bootstrap-daemon` (plus the shared fake game in
    `tests/corporation-test-game.mjs` and the live capture in
    `tests/fixtures/corporation-live-snapshot.json`).
13. `corporation-bootstrap-daemon.js` — config-driven bootstrap/expansion
    entrypoint (`runBootstrapExpansionCycle` + `main`). **Done.**

Modify (only as needed):

- `corporation-manager.js` → thin wrapper; keep the filename for `daemon.js:414`,
  `remote-api-command-policy.js:14`, and `automation-manifest.js`.
- `automation-manifest.js` — only if a second entrypoint is added (not planned).
- `README-AUTOMATION.md` §"Corporation lifecycle" — document the new flags,
  config file, and state names.
- `AUTOMATION-EXTENSIONS.md` — add a "Corporation automation spec" pointer.

Do not add: new running scripts, new manifest entries, or changes to
`autopilot.js`/`daemon.js` RAM reservations for the first implementation.

## 14. Open decisions (defaults chosen; change only with a reason)

1. **Single process** with library modules (default) vs split scripts — chosen
   for RAM; revisit only if home RAM > 2 TB.
2. **Product retirement off by default** (`allowProductRetirement: false`) —
   retirement destroys revenue history; require explicit opt-in.
3. **Division sale off by default** — same reason; `sellDivision` exists but is
   manual-first.
4. **Config file at the repo root** (`corporation-config.json`) — it is synced
   with the scripts and diffable in git; `tasks/` stays for runtime state.
5. **IPO floor 1e10** kept (current code) but configurable — the old 1e12 gate
   was effectively permanent.
6. **Legacy flags keep working** and override the config file, so existing
   autopilot invocations are unaffected.
7. **Bootstrap owns the seed office size** (`bootstrap.initialOfficeSize`,
   default 9): the staffing-before-expansion guard needs a floor, and the people
   module owns growth above it. Without a floor on a fresh save the first office
   is 3 seats and expansion would never unlock.
8. **Bootstrap keeps its own status file**
   (`tasks/corporation-bootstrap-status.json`) until the controller lands, so the
   two can run side by side without fighting over `tasks/corporation-status.json`.
9. **`bootstrap.setupReserve` (20m) and `bootstrap.materialCashFraction` (0.05)**
   are new leaves: the first is the setup buffer the old controller hard-coded in
   the city package, the second bounds what one material-seeding pass may commit
   to persistent `buyMaterial` rates.

---

## Appendix A — `ns.corporation` reference (connected game)

Types (`NetscriptDefinitions.d.ts`):

- `CorpStateName = "START" | "PURCHASE" | "PRODUCTION" | "EXPORT" | "SALE"`
- `CorpEmployeePosition = "Operations" | "Engineer" | "Business" | "Management"
  | "Research & Development" | "Intern" | "Unassigned"`
- `CorpIndustryName`: Water Utilities, Agriculture, Fishing, Mining, Refinery,
  Restaurant, Tobacco, Chemical, Pharmaceutical, Computer Hardware, Robotics,
  Software, Healthcare, Real Estate
- `CorpMaterialName`: Minerals, Ore, Water, Food, Plants, Metal, Hardware,
  Chemicals, Drugs, Robots, AI Cores, Real Estate
- `CorpUnlockName`: Export, Smart Supply, Market Research - Demand,
  Market Data - Competition, Shady Accounting, Government Partnership,
  Warehouse API, Office API
- `CorpUpgradeName`: Smart Factories, Smart Storage, Wilson Analytics,
  Nuoptimal Nootropic Injector Implants, Speech Processor Implants, Neural
  Accelerators, FocusWires, ABC SalesBots, Project Insight
- `CorpResearchName`: Hi-Tech R&D Laboratory, AutoBrew, AutoPartyManager,
  Automatic Drug Administration, CPH4 Injections, Drones, Drones - Assembly,
  Drones - Transport, Go-Juice, HRBuddy-Recruitment, HRBuddy-Training,
  Market-TA.I, Market-TA.II, Overclock, Self-Correcting Assemblers, Sti.mu,
  uPgrade: Capacity.I, uPgrade: Capacity.II, uPgrade: Dashboard,
  uPgrade: Fulcrum
- `CorpSmartSupplyOption = "leftovers" | "imports" | "none"`
- `CreatingCorporationCheckResult = "Success" | "NoSf3OrDisabled" |
  "CorporationExists" | "UseSeedMoneyOutsideBN3" | "DisabledBySoftCap"`

Key read shapes:

- `CorporationInfo`: name, funds, revenue, expenses, public, totalShares,
  numShares, investorShares, issuedShares, sharePrice, shareSaleCooldown,
  issueNewSharesCooldown, dividendRate, tributeModifier, dividendEarnings,
  nextState, prevState, divisions[], valuation
- `Division`: name, industry, awareness, popularity, productionMult,
  researchPoints, lastCycleRevenue/Expenses, thisCycleRevenue/Expenses,
  numAdVerts, cities[], products[], makesProducts, maxProducts
- `Office`: city, size, maxEnergy, maxMorale, numEmployees, avgEnergy, avgMorale,
  totalExperience, employeeProductionByJob, employeeJobs
- `Warehouse`: level, city, size, sizeUsed, smartSupplyEnabled
- `Product`: name, demand?, competition?, rating, effectiveRating, stats{},
  productionCost, desiredSellPrice/Amount, stored, productionAmount,
  actualSellAmount, developmentProgress, advertisingInvestment, designInvestment,
  size, productionLimit
- `Material`: name, stored, quality, demand?, competition?, buyAmount,
  actualSellAmount, productionAmount, importAmount, marketPrice,
  desiredSellPrice/Amount, exports[], productionLimit
- `InvestmentOffer`: funds, shares, round (≤4)
- `CorpConstants`: stateNames, employeePositions, industryNames, materialNames,
  unlockNames, upgradeNames, researchNames*, initialShares,
  sharesPerPriceUpdate, cooldowns, teaCostPerEmployee, gameCyclesPer*,
  secondsPerMarketCycle, warehouse*/office* costs and sizes, bribeThreshold,
  bribeAmountPerReputation, baseProductProfitMult, dividendMaxRate,
  employeeSalaryMultiplier, marketCyclesPerEmployeeRaise, employeeRaiseAmount,
  maxProductsBase, minEmployeeDecay, smartSupplyOptions
- `CorpIndustryData`: startingCost, description, product?, recommendStarting,
  requiredMaterials, realEstateFactor, scienceFactor, hardwareFactor,
  robotFactor, aiCoreFactor, advertisingFactor, producedMaterials,
  makesMaterials, makesProducts

`expanded`/`office`/`warehouse` API signatures used by the modules
(`NetscriptDefinitions.d.ts:9648-10180`): `hireEmployee(d, city, position?=),
upgradeOfficeSize(d, city, size), throwParty(d, city, costPerEmployee),
buyTea(d, city), hireAdVert(d), research(d, name), getOffice(d, city),
getHireAdVertCost(d), getHireAdVertCount(d), getResearchCost(d, name),
hasResearched(d, name), setJobAssignment(d, city, job, amount),
getOfficeSizeUpgradeCost(d, city, size), sellMaterial(d, city, material, amt,
price), sellProduct(d, city, product, amt, price, all), discontinueProduct(d,
product), setSmartSupply(d, city, on), setSmartSupplyOption(d, city, material,
option), buyMaterial(d, city, material, amt), bulkPurchase(d, city, material,
amt), getWarehouse(d, city), getProduct(d, city, product), getMaterial(d, city,
material), setMaterialMarketTA1/2(d, city, material, on),
setProductMarketTA1/2(d, product, on), exportMaterial(srcDiv, srcCity, dstDiv,
dstCity, material, amt), cancelExportMaterial(same), purchaseWarehouse(d, city),
upgradeWarehouse(d, city, amt?=1), makeProduct(d, city, product, designInvest,
marketingInvest), limitMaterialProduction(d, city, material, qty),
limitProductProduction(d, city, product, qty), getUpgradeWarehouseCost(d, city,
amt?=1), hasWarehouse(d, city)`.

## Appendix B — Audit evidence (reproducible)

```bash
# RAM of the controller (live game)
node control.cjs getScriptRam '["corporation-manager.js","home"]'      # → 858.9

# Current corporation snapshot (live game)
node control.cjs automation.corpStatus '[]'
node control.cjs corporation.getDivision '["Tobacco"]'                 # maxProducts 3, products []
node control.cjs corporation.getDivision '["Agri"]'

# API surface + RAM costs (offline, from the connected game)
grep -c '"corporation\.' scripts/api-surface.json                       # → 127 lines
grep -n '"corporation\.' scripts/api-surface.json | head               # names + costs

# Policy/controller structure
grep -nE "^export function" corporation-policy.js corporation-lifecycle.js
wc -l corporation-manager.js corporation-policy.js
ls tests | grep -ci corp                                               # → 28
```

Cross-references: `README-AUTOMATION.md:203-225` (documented behaviour),
`PROJECT-QA.md:151` (native RAM 853 GB at QA time),
`automation-manifest.js:12-19` (startup gate), `daemon.js:414` (launch
condition), `remote-api-command-policy.js:14` (managed-script registration).
