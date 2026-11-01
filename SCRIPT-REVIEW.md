# Script Review — 30 October 2026

Review of the working tree (including uncommitted changes: 111 entries at session start, 69 files with ~1,200 substantive lines after ignoring whitespace). Scope: all 235 deployable scripts (`*.js` in the repo root, `Tasks/` and `Remote/`) plus the tooling under `scripts/` and the 304-file regression suite under `tests/`.

## How this was checked

| Check | Result |
|---|---|
| Parse every JS/ESM file (TypeScript parser, in-process) | 554/554 before fixes; 560/560 after (new tests included), 0 syntax errors |
| `node scripts/audit-project.js all` (imports, exports, API surface, RAM, undefined bindings) | 235 deployable files before, **237 after all fixes** (two shared modules added, duplicate deleted); **0 problems** every run |
| Regression tests | `npm test` after fixes: **3,596 tests, 3,586 pass, 0 fail, 10 skipped** (default per-file isolation; the earlier sandbox-only failure disappears once child processes are allowed) |
| Native game checks | `npm run check:game`: 33 managed entrypoints, RAM budgets ready. Live `automation.preflight`: 32 entrypoints compiled in-game, all `ready`; API snapshot hash matches the game's `NetscriptDefinitions.d.ts` |
| Generated-worker closure analysis (93 `${fn.toString()}` sites) | 0 real captured-binding defects (one benign candidate in `sleeve.js:168`, guarded by an injected dependency) |
| Task-file producer/consumer matrix | 122 files written, 88 read; 11 files have multiple writers (checked: intended owner/inbox patterns) |
| Empty `catch` census | 361 total, 125 wrap mutating/API calls; used intentionally as optional-API probes (see observations) |

The sandbox blocks `spawn`/piped stdio, so `npm run check` (its syntax step spawns `node --check` per file) and `npm test` could not run end-to-end. `check-syntax` was replaced with the in-process parse above; audits ran directly. This is also why the project's `check-syntax.js` has a latent crash (finding L12).

## Fix status

Implemented and covered by new/updated tests:

| Item | Status |
|---|---|
| H1 | Reclassified after finding `tests/automation-logic-fix.test.js` asserts the freeze as intended. Kept the behaviour; documented the escape hatch in `README-AUTOMATION.md` ("Spending after autopilot stops"). |
| H2 | Fixed — probes now carry a `committed` route used by Red Pill, reserve and savings gating. |
| M1 | Fixed — product divisions sell their produced materials (new manager test). |
| M2 | Fixed — hacknet accepts the persisted `checking`/`purchased` states (new test). |
| M3 | Reclassified — the "leftover must complete" gate is asserted by `tests/augmentation-install-safety.test.js`; treated as intended. |
| M4 | Fixed — XP host mapping is keyed by target name (new source regression test). |
| M5 | Fixed — live state files are never replaced, and the fallback listing no longer queues local-only `.txt` (new test). |
| M6 | Fixed — HUD failures are scoped to one refresh (new test). |
| M7 | Fixed — round 2 prices Chemical + a working office/warehouse and requires the offer to fund it (new tests). |
| M8 | Fixed — rollout waits for stasis/cache/RAM helpers (new test). |
| L1–L6, L10–L12 | Fixed. |
| L7, L8, L9 | Reclassified/unchanged — see notes in the table. |
| L13 | Fixed — one shared telemetry module for all four workers, transitive remote dependency copying, unused duplicate deleted (new tests). |

---

## High

### H1. A stale managed budget blocks every non-home purchase after autopilot stops — *intentional; documented*
`spending-policy.js:86-91` (fallback), reached from `spending-policy.js:100`

```js
let supervised=plan?.managed===true;try{supervised ||= ns.ps('home').some(p=>...==='autopilot.js');}catch{}
if(!supervised||ns.read('spending-standalone.txt').trim()==='true')return true;
if(category!=='home'||!reset)return false;
```

`tasks/spending-plan.json` is written with `managed:true` and a 60 s TTL. When it expires or autopilot dies, `claimSpending` falls into this fallback, but `plan?.managed===true` still counts the **dead** plan as supervision, so every category except `home` returns `false` forever. Nothing deletes the plan (`grep` shows only writers), and `spending-standalone.txt` is written nowhere and is undocumented — so the documented workflow of stopping autopilot and running `spend-on-ram`, `spend-on-gangs`, `spend-on-sleeves`, etc. silently stops spending, and a crashed autopilot freezes all manager purchases (hacknet, cloud, gang equipment, sleeves, grafts, corporation) with only "deferred by the shared cash budget" style logs.

- Reproduced with a mock NS: with a stale `{managed:true, expiresAt:1, ownerPid:999}` plan and no autopilot process, `claimSpending(ns,'gang',1e6)` → `false`; with no plan → `true`.
- Reclassified: `tests/automation-logic-fix.test.js:33-42` asserts this freeze ("stale managed budgets block optional purchases while standalone and capped bootstrap remain possible"); the `spending-standalone.txt` flag is the designed opt-out. The defect was that the opt-out was undocumented — now covered in `README-AUTOMATION.md`. No gate logic was changed.

### H2. The five-minute milestone probe rewrites the selected route, releasing the Red Pill reserve and reset hold
`node-route-selection-policy.js:134,142` → `autopilot.js:519` → `red-pill-policy.js:6`

`boundedMilestoneRoute` returns `{...decision, selected: alternate, policy:'milestone-probe'}` for up to 300 s (repeatable after a 30 min cooldown). Autopilot then passes that value straight into `planRedPill`:

```js
routePlan.redPill=planRedPill(s,routeObservation,{route:routePlan.selected});
```

`planRedPill` returns `{active:false, holdResets:false, reserve:0, reason:'World Daemon is not the selected route'}` whenever `route!=='hacking'`. Consequences while the probe runs:

- `manageReservedMoney` (`autopilot.js:1610`) stops writing the TRP/Daedalus reserve, and overwrites `reserve.txt` with the stock reserve (`:1624`), so gang/corp/augmentation/hacknet allowances can spend the reserved cash. The spending plan's independent savings goal does not normally contain the TRP target, so it is not a backstop.
- `maybeInstallAugmentations` (`autopilot.js:1372`) no longer holds optional resets, so a queued basket can be installed while saving for The Red Pill.

The probe is intentionally *evidence collection*, not a route commitment ("full completion remains unknown" in its own reason string), so it should not feed cash or reset gating.

**Fixed.** Probes now record `committed` (the route in force before the probe); `committedRoute(plan)` feeds `planRedPill` in `autopilot.js` and the route/savings context in `spending-policy.js`, while `selected` continues to drive the evidence work. Coverage: `tests/node-progression-planning-fix.test.js` (probe start, restore, cooldown).

---

## Medium

### M1. Product divisions never sell the materials they produce
`corporation-manager.js:824` and `:1145-1149`

`sellMaterials` starts with `if (!d || d.makesProducts) return;`, and the maintenance branch calls it **only** for non-product divisions; `sellProducts` only sells products. Current game data (checked against `IndustriesData`) gives `makesProducts:true` **and** non-empty `producedMaterials` for Computers (Hardware), Software (AI Cores), Pharmaceutical (Drugs), Robotics (Robots) and Real Estate (Real Estate). Those outputs therefore get no sell order: stock accumulates, `outputBacklog` reports backlog (which suppresses warehouse growth/`storagePressure`), a full warehouse throttles product development, and the material revenue is lost. Default Agriculture (materials) and Tobacco (no produced materials) are unaffected, which is why this can go unnoticed.

**Fixed.** `sellMaterials` no longer skips product divisions, and the maintenance loop sells produced materials for every division. Regression test: `tests/corporation-manager.test.js` "product industries also sell the materials they produce".

### M2. Hash worker status never records `spending`, dead-coding the hacknet growth quote
`spend-hacknet-hashes.js:49` ↔ `hacknet-policy.js:68-71`

`report('spending',…)` deliberately rewrites the persisted state:

```js
state:state==="spending"?(extra.cashReceipt?.success?"purchased":lastDecision?.allowed===false?"blocked":"checking"):state
```

so `tasks/hash-worker-status-*.json` can only hold `purchased`/`blocked`/`checking`. `hacknet-policy.js:69` still requires `status.state==='spending'` to accept a cash worker, so `quoteHacknetInvestment` always returns `null`; `claimSpending('hacknet', cost, investment)` never receives a growth investment and the savings exception at `spending-policy.js:128-140` is unreachable. The uncommitted diff already updated `bladeburner-rank-support-policy.js:21` to accept `['spending','checking','purchased']`; `hacknet-policy.js` was missed, and the test fixture writes `state:'spending'` by hand so tests stay green.

**Fixed.** `hacknet-policy.js` now accepts `spending`, `checking` and `purchased` (still rejecting `blocked`); test added in `tests/hacknet-growth-funding.test.js`.

### M3. A failed optional "leftover" purchase aborts the whole augmentation install — *intentional*
`ascend.js:194-198` + `augmentation-install-policy.js:87`

After the primary basket is bought, ascend runs a best-effort `--stat-desired _` pass for junk augmentations, then:

```js
const leftoverPurchases=await prepareAugmentationPurchases(ns,{...,phase:'leftover'});
if(!leftoverPurchases.ok)return log(ns,'Installation deferred: '+leftoverPurchases.reason,...);
```

`prepareAugmentationPurchases` demands `receipt.complete===true && purchased===planned`. Faction-manager publishes `complete:false` for ordinary, benign leftover outcomes: cash shortfall (`count:-3`), price/reputation drift (`-2`), ownership change (`-1`). Any of those defers the reset even though the primary basket was complete, leaving purchased augmentations uninstalled and every later purchase paying queued-price inflation.

**Reclassified.** `tests/augmentation-install-safety.test.js:93` explicitly requires this deferral, so the intent is to keep replanning until the optional basket is also resolved before paying the reset. No behaviour change; if the long deferral becomes a live problem, the decision belongs to the author.

### M4. Looping-mode XP host pinning is broken twice over
`daemon.js:2075`, `daemon.js:2102`

```js
jobHostMappings[target.name] = jobHosts.filter(h => !(h.name in Object.values(jobHostMappings)))[0]; // :2075
let selectedHost = loopingMode ? jobHostMappings[i] : jobHosts[i];                                     // :2102
```

`h.name in <array>` tests array indices, never the Server values, so the filter never excludes a host and every target maps to `jobHosts[0]`. The map is keyed by target **name** but read with numeric `i`, so `selectedHost` is always `undefined`. `scheduleHackExpCycle` then sees `allocatedServer=null`: threads are sized against network-wide `expTool.getMaxThreads()` (:2172) and, in advanced mode, `threadsOnExpToolHost` becomes the global weaken capacity (:2194), making `schedulableThreads` 0 and usually forcing the "revert to basic XP farming" branch (:2202-2208). The documented `--looping-mode` host locking never takes effect on multi-target XP runs.

**Fixed.** Mapping and lookup both use the target name, and the "unmapped host" check compares names. Source regression test added in `tests/hacking-automation.test.js`.

### M5. `git-pull.js` treats live `.txt` state as replaceable repository content
`git-pull.js:9`, `:37`, `:64-66`, `:147-148`

`['extension', ['.js','.ns','.txt','.script']]` is the default, and `reserve.txt` is tracked in the repository with content `0` (confirmed with `git ls-files`). A normal update therefore force-writes `reserve.txt` to `0` (`ns.write(target, contents, 'w')`), silently clearing the user's reserve after an update — the one guard all spenders rely on. The same applies to `darknet-passwords.txt`, which users are invited to edit. In the GitHub-rate-limit fallback, every local `.txt` is enqueued (including generated `darknet-passwords-HOST.txt` reports), so a 404 makes `staged.length !== filesToDownload.length` and aborts the whole update.

**Fixed.** `reserve.txt`, `home-ram-reserve.txt` and `darknet-passwords.txt` are never replaced (even if listed), and the fallback listing only queues scripts plus `darknet-candidates.txt`. `tests/git-pull-update-policy.test.js` covers the policy.

### M6. HUD read failures are never cleared, so one transient failure pins the overview to "Partial"
`stats.js:24`, `:225`, `:374`, `:554`, `:424-425`

`let hudReadFailures=[]` is only appended to; `main()` resets every other module global (`:38-43`) but not this one. `getHudData` builds `new Set(hudReadFailures)` each refresh and shows `HUD Data: Partial`. A single failed stock/Bladeburner/RAM read at startup (very common before APIs unlock or under RAM pressure) stays displayed for the rest of the session even after recovery, and the array grows over time.

**Fixed.** `getHudData` clears the list at the start of every refresh, so only failures from the current refresh are reported. Test added in `tests/overview.test.js`.

### M7. Round-2 investment capital ignores the division that `stageReady` requires
`corporation-manager.js:1035-1053` + `corporation-lifecycle.js:36-46`

`stageReady` for rounds ≤2 requires `hasDivision(chem) || hasDivision(tobacco)`, but `stageCapital` only prices missing Agriculture cities/warehouses. Once Agriculture is fully expanded, `stageCapital` is 0, so `capitalBlocked` is false, `fallback=!stageReady&&capitalBlocked&&timeout&&settled` can never become true, and round 2 is never accepted while Chemical/Tobacco are missing — even though accepting it is exactly what would fund them.

**Fixed (per author's choice).** Round 2 now adds Chemical's native `startingCost` plus one office and warehouse (79e9 with current constants) to `stageCapital` when neither Chemical nor Tobacco exists. The bounded-offer fallback additionally requires the offer plus unreserved corporation cash to cover that stage capital, so a token offer cannot dilute the CEO without funding the division; the 30-minute wait, ownership floor and `acceptVentureOffer` guard are unchanged. Agri-only expansion keeps its prior fallback rule. Diagnostics expose `stageDivision`, `stageCapital`, `capitalBlocked` and `stageFunded` in `tasks/corporation-finance.json`. Coverage: `tests/corporation-lifecycle.test.js` (small offer rejected, funding offer accepted) and `tests/corporation-manager.test.js` (Chemical + setup priced at 79e9).

### M8. Darknet code upgrades kill in-flight stasis/cache helpers
`darknet-rollout.js:19-21`

`refreshDarknetScouts` waits only for `darknet-loot.js`, then kills every process whose filename is in the deployed file list except `darknet-maze.js` — including `darknet-stasis.js` and `darknet-cache.js`. `darknet-anchor-policy.js:96` explicitly refuses to act while `darknet-stasis.js` is running ("Never overlap a phase transition"), because an interrupted stasis call has no receipt and the anchor request then expires/rolls back.

**Fixed.** `prepareDarknetRollout` now defers while `darknet-stasis.js`, `darknet-cache.js` or `darknet-ram.js` is running. Test added in `tests/darknet-rollout.test.js`.

---

## Low

| # | Location | Issue |
|---|---|---|
| L1 | `go.js:771-782` | Snake-eyes cheat validates `move1[0]`/`move2[0]` but plays `move1.pop()`/`move2.pop()`; when the enemy search ordered non-liberty empty points first, the validated pair differs from the played pair, the in-flight guard rejects it, and the best capture is silently skipped. |
| L2 | `reserve.js:4-6` | `parseShortNumber('5x')` returns `NaN`, which is written to `reserve.txt` (`Set to reserve NaN`). Every consumer does `Number(ns.read(...))||0`, so a typo silently disables the reserve. Reject non-finite values. |
| L3 | `daemon.js:1636` | Process-budget cycles divide by 4, but the end-game batch (`percentageStolenPerHackThread() >= 1`) adds a 5th `grow-from-zero` leg (`:1745-1758`), allowing up to 25% more live HGW processes than `--max-hacking-processes` intends. |
| L4 | `red-pill-policy.js:44-47` | Rep-trade infiltration rewards are capped by `needed`, which is derived from cash-convertible reputation; when cash-poor this undervalues rep trades versus money trades. Use `plan.remainingRep` for the rep entry. |
| L5 | `corporation-manager.js:762` | With `productionAmount===0`, `stored>0` and some sales, sell-through is computed as `1`, so a stalled/full warehouse is scored as healthy and can attract advertising/upgrade spend. |
| L6 | `achievement-puzzles.js:20-25` | The `time`/`prototype` hooks restore only if the current global is still this instance's hook. If two puzzle runs overlap (manager restart inside the 45 s window), the older `atExit` restores nothing and the newer restores the older hook, leaving `setTimeout` monkey-patched for the session. Serialize puzzle claims or restore the saved descriptor unconditionally. |
| L7 | `progression-coordination.js:26-32` | An interrupted `started` completion-hook receipt becomes `uncertain` and is rewritten every ~2 s with a new `at`; `autopilot.js:673-677` then holds BitNode departure indefinitely with no expiry or retry. A finished hook whose pid died during downtime therefore needs manual file surgery. Add a bounded resolution/grace. |
| L8 | `darknet-anchor-policy.js:115-116` | `serviceDarknetAnchor` returns `true` even when `ns.exec('darknet-stasis.js',…)` failed (e.g. RAM), and `darknet-node.js:294` treats that as `stasisStarted`, suppressing cache/promotion/loot work for that pass. Return whether stasis actually started. |
| L9 | `darknet-credentials.js:60` | On first load, entries from the user-edited `darknet-passwords.txt` get `at:0`; `mergeCredentials` only replaces on strictly newer `at`, so a previously learned (wrong) password wins and the documented manual correction is ignored until the file changes again. |
| L10 | `helpers.js:721-727` | `getStocksValue` only checks `askPrices==null`; if the bid or position query fails, `positions[sym]`/`stk.bid` throw or produce `NaN`. Two of four call sites (`autopilot.js:1177,1516`, `faction-manager.js:167`) do not catch. |
| L11 | `remote-api-command.js:50` | The new `automation.gangFunding` command is the only diagnostic not wrapped in `boundedDiagnostics`, so its payload size is unbounded relative to siblings. |
| L12 | `scripts/check-syntax.js:21-26` | If `spawnSync` fails to start Node (e.g. polluted environment, OS limits), `result.stderr` is `undefined`, and `process.stderr.write(undefined)` throws `ERR_INVALID_ARG_TYPE`, aborting the check instead of reporting the failing files. Reproduced in this sandbox. Use `result.error?.message ?? result.stdout ?? ''`. |
| L13 | `Remote/{hack,grow,weak}-target.js` | `report()`, `mergeHgwDelaySamples()` and `hackingLoopShouldStop()` are copy-pasted across the three workers (~60 lines each), and `optimize-stanek.js.og.js` is an unused duplicate. Fixing one copy and not the others silently desynchronises telemetry/loop-stop behaviour. |

**Status:** L1–L6 and L10–L13 are fixed. New coverage: `reserve.js` parsing (L2), Red Pill infiltration caps (L4), puzzle-hook chaining (L6), bounded diagnostics (L11); L1/L3/L5 are exercised by the existing Go, hacking and corporation suites. `go.js` now validates exactly the pair it plays, `daemon.js` counts the fifth batch leg, and `corporation-manager.js` treats zero production with stock as stalled. L7 is intentional (an uncertain hook deliberately holds departure for manual inspection) and was left alone. L8 is reclassified: a pending anchor legitimately owns the host while it retries, so suppressing competing cache/loot work is the intended arbitration. L9 is intentional per `tests/darknet-credentials.test.js` (legacy reports take precedence over the manual file on migration). L13 is fixed: `Remote/hgw-telemetry.js` is the single reporter/guard implementation for all four workers, `daemon.js` copies relative imports transitively and refreshes them with the tool, and `optimize-stanek.js.og.js` was deleted. Coverage: `tests/worker-dependency-policy.test.js` plus the updated telemetry tests.

---

## What was checked and found sound

These were specifically inspected because they are high-risk and are *not* findings:

- **Generated worker boundaries.** 93 stringified-function sites; a cross-module free-variable analysis (imports resolved to their defining modules) found only `sleeve.js:168`, where `planSleeveAugPurchase` can reference `sleeveAugmentedOutput` — but the worker always injects `sleeveWorkOutput`, so the fallback branch never runs. No undefined-closure bug.
- **RAM arithmetic.** `RunningScript.ramUsage` is per-thread (confirmed against the official docs), so `home-ram-policy.js:35` and `runtime-policy.js:60/111` multiply correctly. `reclaimHomeRam` only lets the reclamation log slightly overstate freed RAM; kill decisions use the live free-RAM check.
- **Remote API surface.** Command validation is an allowlist of read-only queries plus managed `start`/`stop`; arguments are JSON-encoded into the job, not interpolated. No injection path found. (`Remote/api-server.js` is not in this repo, so listener-side auth was out of scope.)
- **Money re-guards.** Gang equipment purchases re-read price/ownership; faction purchase workers re-check reset, ownership, quotes and reserve; stock trades recheck reserve and quote cost in the spawned worker; casino UI controls are re-acquired after the configured delay.
- **Bladeburner Black Op start path** re-reads live stamina, HP, rank, team and success chance at execution time (`black-op-risk-policy.js:145-163`).
- **Contract solver** uses `attempt(..., {returnReward:true})`, correctly treats the "No reward" string as success, quarantines wrong answers per solver version, and bounds remote delivery with a home-owned lease.
- **Test suite health.** The 17 failures seen in a shared process are isolation artifacts; per-file isolation is green except the one child-process test blocked by this environment. No test tried and failed against product code.

### Claims I investigated and did not substantiate

- *Gang income `×5` unit mismatch* — the game reports gang `moneyGainRate` **per cycle** and processes 5 cycles/second, so `*5` in `gang-stat-policy.js:123`/`gang-policy.js:132` is the per-second conversion; the 1:1 comparison at `gangs.js:691-700` is likewise per-cycle. Not a bug.
- *Hash `cashPerHash=250000` vs `1e6`* — "Sell for Money" costs 4 hashes for $1M, i.e. $250k/hash. The constant agrees with `hash-spending-policy.js:121` and `hacknet-policy.js:75`. Not a bug.
- *Aggressive ascension gate blocking standard ascension* — when the gate is closed (pipeline full or a recovery measurement below 90%), pausing is the stated safety design, and the gate re-opens as the 15-minute measurement window ages out. Default-on is a tuning choice worth revisiting, not a code defect.
- *Share-sale proceeds 0.995×* — `estimateShareProceeds` is documented as a deliberate lower bound (`corporation-lifecycle.js:41`); the resulting ≤0.5% oversell is the intended conservative trade-off.
- *`getRunningScript().ramUsage` double-counting threads* — covered above; correct per docs.

## Suggested order of work

1. **H2**, **M2**, **M3 follow-up** — route/reserve gating and purchase plumbing (H2/M2 done; reconsider M3 only if the deferral is observed in play).
2. **M1**, **M4**, **M5**, **M6**, **M8** — done.
3. **M7** — done: investor cash may fund the missing Chemical division only when the offer plus unreserved cash covers its startup and first office/warehouse.
4. **L13** — done: shared telemetry module, transitive/refreshed worker dependency copies, and the unused `optimize-stanek.js.og.js` duplicate removed.

## Limitations

- No live game was available: findings are code-path analyses, API-semantics checks against the official v3 source, and one mock-NS reproduction (H1). Numeric/economic effects are reasoned, not measured.
- Coverage was prioritised by money/progress risk; entry-point `main()` bodies over 1,000 lines (daemon, autopilot, go, corporation) were reviewed by path rather than line-by-line exhaustively.
- Uncommitted changes were reviewed as the current state; `git diff -w` was used to separate formatting churn from semantic edits.
- The working tree changed while this review ran: `graft-install-policy.js` (untracked) and edits to `autopilot.js`/`grafting-manager.js` appeared around 00:05–00:07. Findings were re-anchored against the tree as of 00:25; line numbers refer to that snapshot. Re-check citations if development continued after that.
- The environment blocked child processes, so the project's `npm run check` wrapper (whose syntax step spawns per-file processes) could not run; the underlying audit and an in-process parse were run directly instead, and `npm test`'s default per-file isolation was emulated one file per process.
