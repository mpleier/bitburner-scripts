# Game-source compatibility review — 23 November 2026

Reference: [`bitburner-official/bitburner-src`](https://github.com/bitburner-official/bitburner-src/tree/dev/src) `dev` @ `0c65cfb1` (19 Nov 2026).
Scope: all deployable scripts (`*.js` in the root, `Tasks/`, `Remote/`) plus the audit inputs under `scripts/`. Hand-run diagnostics now live in `manual/`, which the sync policy skips, so the deployable set is 264 files.

Status: the findings below are fixed or retracted. See "Verification" for the checks run afterwards.

## How this was checked

| Check | Result |
|---|---|
| `npm run check` (syntax + imports/exports/API/RAM/bindings audits) | every file parsed; 264 deployable files, **0 problems** |
| Differential API audit: `NetscriptDefinitions.d.ts` parsed with the TypeScript compiler API, every `ns.*(...)` call site checked for existence and arity | 0 unknown paths, 2 arity deviations (both verified by reading the implementation) |
| Property/enum reads (`ns.enums.*`, `ns.read`, object fields) | all enum keys exist; 1 redundant field (below) |
| Removed APIs registered through `setRemovedFunctions` (classGains, getSleeveStats, corporation.getExpand*Cost, gang.getOtherGangInformation, stock.hasWSEAccount, singularity.getAugmentationCost, …) | **0 usages** |
| `scripts/api-surface.json` vs the game's definitions | was 23 paths behind, 0 stale — regenerated |
| Targeted mechanic/formula comparison (hacking, gang, bladeburner, corporation, stock, casino, go, hacknet, sleeve, darknet, infiltration) | matches, except the items below |

Initial hits from a plain text scan included `ns.args.map(...)`, a doc-comment example and one `ns.exit(),` inside a string literal; those were discarded after reading the call sites.

## Findings

### M1 — Stasis/backdoor reachability never fired — **fixed**

`darknet-throughput-policy.js` treated a host as reachable when `details.hasStasisLink` or `details.backdoorInstalled` was set, but every caller passes `ns.dnet.getServerDetails(host)`, whose object (`NetscriptFunctions/Darknet.ts:383-416`, `DarknetServerDetails` in `NetscriptDefinitions.d.ts:4727-4762`) contains neither field. `ns.setStasisLink()` (`DarkNet/effects/effects.ts:242-260`) sets both flags, and the API docs say a stasis link uses a backdoor to allow remote `exec()` (`NetscriptDefinitions.d.ts:4919`), so the intended check was simply starved of data.

Fix: `ns.dnet.getStasisLinkedServers()` (documented, 0 GB) is now read in `darknet-node.js` and `darknet-manager.js`, and `stasisLinkedDetails()` merges the flag into the details object before the existing `darknetDirectlyReachable()` gate. `darknet-manager.js` enriches the `details` passed to `authenticate()` as well, so the saved-password/feedback paths see the same answer. The gate keeps its signature and ordering, so `tests/darknet-reachability.test.js` still describes the rule; one case was added for the new helper.

Note: `ns.getServer(host).hasStasisLink` would also expose the flag (as a deprecated property, `NetscriptFunctions/Darknet.ts:708-721`), but it costs 2 GB and re-reads the server, which matters on the 16 GB darknet hosts these workers run on.

### M2 — `details.hostname` / `details.ip` — **retracted**

The first pass flagged these as always `undefined`, based on the function definitions. The callers already supply the host: `solveFeedbackPassword({...info, hostname: host, …})` (`darknet-node.js:403`), `candidatePasswordTurn({...info, hostname: host}, …)` (`darknet-node.js:415`), and the same two forms in `darknet-manager.js:222,235`. `darknet-advanced.js` receives that enriched object, so the packet-sniffer host marker works.

One cosmetic leftover: `details.ip` in `feedbackSignature()` (`darknet-feedback.js:62`) is still `undefined`; `hostname` already disambiguates the signature, so no change was made.

### L1 — Stale `codingcontract.attempt` signature — **fixed**

`Tasks/contractor.js.solver.js` passed `{returnReward:true}` as a fourth argument. `dev` defines `attempt(answer, filename, host?)` (`NetscriptDefinitions.d.ts:4198`, `NetscriptFunctions/CodingContract.ts:90-94`) and always returns the reward string or `""`, so behaviour is unchanged — the dead argument is removed.

### L2 — `ns.read()` cannot read from another server — **fixed**

`manual/copy-dw-debug.js` called `ns.read(f, 'darkweb')`; `read` takes one filename and reads from `ctx.workerScript.getServer()` (`NetscriptFunctions.ts:1089-1091`), so it read the path locally and wrote `NULL`. The script now runs on `darkweb` directly when it is started there, and otherwise `scp`s each file from `darkweb` to the current host before reading it, leaving `NULL` for genuinely missing files.

### L3 — Class-work focus penalty no longer exists — **fixed**

`darknet-charisma.js` multiplied quoted study XP by `0.8` when the character was not focused. At `dev` HEAD `calculateClassEarnings()` (`Work/Formulas.ts`) applies no `Player.focusPenalty()`, and `ClassWork.process()` (`Work/ClassWork.tsx:105-110`) applies `applyWorkStats` without one; tuition is unaffected too. `focusPenalty()` is used only by company, faction, crime, program-creation and grafting work. The factor is removed; the `focus` flag passed to `ns.singularity.universityCourse` is unchanged.

### L4 — `scripts/api-surface.json` was behind `dev` — **fixed**

Regenerated from the `dev` definitions with the project's own generator:

```
node scripts/generate-api-surface.js path/to/NetscriptDefinitions.d.ts
```

The snapshot now has 580 paths and 492 documented RAM costs (previously 557 paths), adding 23 and removing none — including `port` and its whole namespace, `format.money`, `ui.alias/unalias/getAllAliases/createConnectLink/openCodeEditor/renderPage`, `dnet.freezeServer`, `formulas.dnet.getExpectedMigrationCharge`, `formulas.gang.reputationGain`, `singularity.hasExportGameBonus` and `heart.break`. The `heart.break` entries in `scripts/api-compatibility.json` are now redundant; they were left in place because unused exceptions have no effect.

### L5 — `ns.clearLog(1)` / `ns.exit(1)` — **retracted**

Both were text-scan artefacts: `go.js` already calls `ns.clearLog()`, and the `ns.exit(),` hit in `darknet-solvers.js` is inside a string being rewritten by `replaceAll`. No change was needed.

## Verified equivalent to `dev` (sampled)

| Area | Script | Game source |
|---|---|---|
| Hacking fallback (no formulas.exe) | `analyze-hack.js`: `3 + minDifficulty*0.3` exp, `weakenTime/4` hack time, caps | `Hacking.ts` `calculateHackingExpGain`, `calculateHackTime` (3.2× grow, 4× weaken) |
| Hacking batch constants | `0.002/0.05`, `0.004/0.05`, `hackFactor 1.75`, `balanceFactor 240` | `Hacking.ts` (`calculateHackingChance`, `calculatePercentMoneyHacked`) and `Server` security deltas |
| Gang ascension | `gang-policy.js:813-824` `max(exp-1000,0)`, `max(sqrt(points/2000),1)` | `Gang/formulas/formulas.ts` `calculateAscensionPointsGain/Mult` |
| Gang economy | `ns.formulas.gang.*` called with `{respect, territory, wantedLevel}`, member, task | same interface; wanted penalty and territory soft-cap stay in-game |
| Bladeburner stamina | `.285*(difficulty^.28 + difficulty/650)` | `Bladeburner/data/Constants.ts:5,15,16`, `Bladeburner.ts:913-921` |
| Go komi | `go-policy.js:131` incl. `'????????????': 9.5` | `Go/Constants.ts`, `Go/Enums.ts:9` |
| Stock commission | `stockmaster.js:13` 100,000 | `StockMarket/data/Constants.ts:11` (`StockMarketCommission: 100e3`) |
| Casino blackjack | `casino-policy.js:20-31` blackjack pays 1.5×, S17 basic strategy (hit soft 18 vs 9+) | `Casino/Blackjack.tsx:163,218` (dealer stands on soft 17, blackjack pays 1.5×) |
| Infiltration rewards | `infiltration-manager.js:203`, `infiltration-solvers.js:56` use `reward.tradeRep` / `sellCash` | `InfiltrationReward` (`NetscriptDefinitions.d.ts:7126-7130`) |
| Corporation pricing | `corporation-policy.js:116-129` `premium = markupLimit*sqrt(potential/target)` | `Corporation/helpers.ts:167-187` penalty `(markupLimit/(price-MP))²` + `Corporation/Division.ts:407-419`; the quote sells exactly `target` |
| Darknet auth time | all `expectedMs` consumers | `DarkNet/effects/effects.ts` `calculateAuthenticationTime` returns **milliseconds** |
| Darknet models | model names, formats, `Pr0verFl0` mask-overflow, `BigMo%od` CRT over divisors ≤ 32, `2G_cellular` mismatch index, spice/timing feedback parsing | `DarkNet/Enums.ts:15-41`, `DarkNet/effects/authentication.ts` |
| Labyrinth | `report.coords`, `north/east/south/west`; radar 7×7 with `'@'` centre and `'X'` goal | `DarkNet/effects/labyrinth.ts:188-234` (`WALL='█'`, `PATH=' '`), `NetscriptFunctions/Darknet.ts:640-704` |
| Enums | `CityName.Sector12`, `LocationName.*`, `GymType[stat]`, `UniversityClassType.{algorithms,leadership}`, `CrimeType`, `FactionWorkType` | `Locations/Enums.ts`, `Work/Enums.ts` — all keys/values match |
| Hash upgrades | `'Improve Studying'` | `Hacknet/Enums.ts:6` |
| Sleeves | shock and sync applied to quoted XP (`sleeve-work-policy.js:13-25`) | `PersonObjects/Sleeve/Work/Work.ts` (`shockBonus()`) |

## Verification

| Check | Result |
|---|---|
| `node scripts/check-syntax.js` | 736 files, pass |
| `node scripts/audit-project.js all` (imports, exports, API, RAM, bindings against the regenerated surface) | 264 deployable files, 0 problems |
| `node --test tests/darknet-*.test.js tests/*contract*.test.js` | 337 tests, 337 pass, 0 fail |
| `node --test tests/` (whole suite) | 4071 tests, 0 fail |
| `node --test` on the tests that name the touched files (`maintenance-scope`, `project-integration`, `review-regressions`, `automation-logic-fix`, `native-improvements`, `labyrinth-priority`, `output-routing`, `automation-manifest-preview`, `complete-automation`, `darknet-reachability`) | 111 tests, 111 pass, 0 fail |

## Coverage and limitations

- API existence/arity and removed-API usage were checked for **every** deployable file; mechanic checks were targeted at the subsystems the scripts hard-code, not line-by-line against every policy module.
- No in-game verification: `npm run check:game` needs a live Bitburner instance, so native compilation, RAM accounting and timing were not exercised here. The stasis-reachability fix in particular has only been unit-tested with a synthetic stasis list.
- The reference tree was `dev` at `0c65cfb1`; the stable branch may differ, particularly for the Darknet namespace, `ui.alias`, `port.*` and `hasExportGameBonus`, which are recent additions.
