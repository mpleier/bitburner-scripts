# Bitburner Complete Automation

This package combines the supplied Bitburner scripts with corporation and current-version darknet managers. The original script collection is included with its license and subfolders intact; the supplied source folder was left unchanged.

## Achievement automation

Autopilot now supervises achievement progress and dedicated challenge runs. See [achievement controls and coverage](ACHIEVEMENTS.md) for the 109-entry catalog, campaign order, debt behavior, and version-specific/source-editing limits.

## Additional automation

Autopilot now supervises Shadows of Anarchy augmentation purchases. Empty Stanek grids use a bounded optimizer and saved layouts. Go selects opponents for useful bonuses and observed success. Cash purchases share one-minute allowances while respecting augmentation reserves. Resets claim the export bonus and request verified local saves through the connected Remote API service. Optional intelligence farming has reset, time, and intelligence limits and is disabled by default.

See [automation extensions](AUTOMATION-EXTENSIONS.md) for behavior, controls, and backup requirements.

## Install and start

### General BitNode progression

Autopilot uses the shared `bitnode-priority.js` plan for a fresh save or an existing save. Targets are integer Source File levels, and the current run's projected reward is counted before choosing the next node. Completed stages are skipped. The default targets are:

`4.3 â†’ 1.2 â†’ 5.1 â†’ 2.1 â†’ 9.2 â†’ 10.1 â†’ 8.2 â†’ 13.1 â†’ 7.3 â†’ 3.3 â†’ 15.1 â†’ 11.3 â†’ 10.3 â†’ 14.2 â†’ 1.3 â†’ 2.3 â†’ 5.3 â†’ 15.3 â†’ 9.3 â†’ 13.3 â†’ 6.3 â†’ 14.3 â†’ 8.3`

Here `9.2` means Source File 9 level 2, which may require multiple runs. This order prioritizes automation access and startup RAM, then income systems and concurrent progression, followed by remaining bonuses. Once every finite Source File is level 3, BN12 repeats indefinitely to increase starting NeuroFlux levels. This is a capability-focused default, not a prediction of the fastest completion time. `--next-bn` retains an explicit next-node override; invalid overrides prevent automatic departure. Recommendations and reasons appear in the autopilot log, `tasks/bitnode-priority.json`, and Remote API automation status.

Corporation material sales without Market-TA.II use `MP + quality/baseMarkup`, matching the game's additive markup limit. Product pricing keeps its separate adaptive policy. Warehouse expansion preserves operating reserves and pauses when unsold output is causing a backlog, allowing sales to recover before spending on more storage. Boost-material purchases stop during operating losses and use at most half of the previous cycle's profit, with a small initial allowance before the first sales cycle.

Copy the files and folders in `bitburner-scripts/` into your Bitburner home computer, keeping `Remote/` and `Tasks/` as folders. Import them using the file sync or editor workflow you normally use. Then start:

```text
run autopilot.js
```

`autopilot.js` starts `daemon.js`, which manages hacking and launches the included managers when their game unlocks and RAM requirements are met. For a manually started corporation manager, use `run corporation-manager.js`. The provided autopilot can automatically install augmentations and advance to other BitNodes when its conditions are met; review its options in `autopilot.js` before leaving it unattended.

Autopilot launches the standalone `corporation-manager.js` script in BitNode 3 or with Source-File 3 access when it is not already running and enough RAM is free on home. All corporation decisions remain in the manager. Its daemon is told to leave corporation startup to autopilot. Use `run autopilot.js --disable-corporation` to disable automatic corporation startup; this option is saved in autopilot's configuration and does not stop an already running manager. All automation runs inside Bitburner, and obsolete PC lease files cannot block startup.

## Read-only planning

Run `run autopilot.js --dry-run` (or `--preview`) to inspect startup without registering automation, saving configuration, launching scripts, buying anything, or resetting. It reads saved autopilot settings and applies explicit flags. `run automation-preview.js` is a separate inspection command; add `--json` for structured output. Remote API clients can request `automation.preview` without arguments.

The preview shows shared manager access gates, current home RAM/headroom, blocked launches, remaining current spending allowances, observed infrastructure quotes, and eligible remote share-worker capacity. Quotes require a live recheck before purchase; conditional casino, reset and parent-controller decisions are not simulated. Stateful managers remain on home to preserve authoritative status and quarantine files.

The module manifest in `remote-api-command-policy.js` is shared by autopilot startup, supervision, Remote API permissions and native QC. A diagnostic entry does not grant permission to start or stop that script. Native checks now include cloud buying, home RAM, contractor workers and the preview.

## Cloud decisions and remote contracts

Cloud buying publishes `tasks/cloud-purchase-status.json` after every completed check, including cost, capacity, utilization and a readable deferral reason. The dashboard, read-only preview and Remote API status show recent decisions from the current reset, even after the one-shot manager exits.

Contract collection and authoritative results stay on home. Validated solver batches of at most 64 contracts prefer rooted remote servers with enough native RAM; home is a fallback that respects its headroom reserve. Dependencies are copied from home before launch. Each worker must match a home-owned job lease and refresh home validation and quarantine before each submission.

Workers return only a unique inbox receipt. Home checks its job ID, PID, host, solver version, reset, counters and quarantine scope before merging. Failed uploads are retried by home. Confirmed receipts are removed after acknowledgement; uncertain evidence is retained. If a worker disappears without a valid receipt, its batch is quarantined for that solver version rather than spending contract attempts again. Inspect `tasks/contracts-active.json` and `tasks/contract-quarantine.json` when investigating uncertain outcomes.

## Manual augmentation changes

Manually purchased, grafted, installed and NeuroFlux augmentations are tracked through a synchronous native ownership snapshot. Its signature includes installed names and levels, queued names with repeated NeuroFlux levels, and the current resets. Faction plans are rejected when ownership changes; stale purchase countdowns, faction summaries and augmentation cash goals are cleared. Other cash allowances and reservations retain their normal guards.

Faction-manager checks ownership again before publishing a summary and before donation or purchase workers spend money. Changes defer the transaction for replanning. Faction work probes ownership during its ordinary five-second reputation polls and refreshes its targets and focus settings after a change. If the ownership API or worker RAM is unavailable, installs wait while autopilot retains its lightweight installed-augmentation refresh and continues other automation.

Augmentation summaries also carry native price, reputation requirement, membership, favor and donation-conversion observations. The planner, autopilot and spending workers recheck these inputs. Prices and unlock crossings invalidate immediately; ordinary reputation drift is tolerated below a 1% remaining-gap threshold (at least 1,000 reputation), widened to 10% while publishing and during the first five seconds of a fresh plan to avoid perpetual replanning. Extra reputation above every watched unlock does not change the donation bill. Successful native donations refresh the baseline before purchases. Stale economics release augmentation-specific cash goals while preserving other allowances, the existing install countdown and wait deadlines; unavailable native quotes defer installs safely.

## Capacity planning and casino recovery

Autopilot publishes `tasks/manager-capacity.json` for enabled controller capacity, including managers whose normal startup waits for a larger home server. The plan excludes paused/disabled candidates, hacking workers and temporary jobs, counts existing controller instances, and includes a 16 GB helper slot plus declared sequential phase peaks. Missing native RAM costs make the plan incomplete. This is a capacity estimate, not a runtime RAM guarantee. Essential-manager demand retains its separate priority; a complete full-manager plan can lift the ordinary home allowance to a 10% floor within the same shared cash budget, preserving augmentation and corporation-startup reserves.

Daemon periodic jobs admit at most 1/2/3/6 launches per pass according to home capacity, reducing to one under RAM pressure or measured lag. Already-running jobs do not consume a slot. Deferred jobs retain their deadlines; oldest attempts run first.

Successful casino completion requests an infrastructure checkpoint before normal controllers restart: home RAM, TOR, port openers, then cloud capacity. Each purchase keeps its existing guards and reserves. Source-File restrictions and pauses are respected; failed starts have two attempts per step and the checkpoint releases startup after 60 seconds. Exits are observations, not proof of purchase success. Reports are in `tasks/post-casino-infrastructure.json`.

## Local checks

Routine faction reports, controller launches, contract successes, Dark Net worker results, sleeve purchases, and RAM upgrades go to script logs. Faction-manager terminal reports are opt-in with `--verbose` or `-v`; automatic launches pass `--log-only`, which overrides saved verbose settings. `--join-only` remains quiet. Configuration errors, actionable failures, and major reset/BitNode notices can still appear in the terminal. Interactive commands such as `scan.js`, `grep.js`, and `run-command.js` retain their command results.

Scripts do not open tail windows automatically. Use the Bitburner terminal command `tail autopilot.js`, `tail daemon.js`, or `tail corporation-manager.js` to open logs when you want them.

With Node.js installed, run `npm ci` once to install the pinned local audit parser. Run `npm test` for regression tests and `npm run check` for syntax, missing modules/exports, API references and dynamic-import RAM gaps. Game scripts do not require Node packages. They cover selected logic with mocked Bitburner APIs; they do not replace testing in a live save.

### Audit commands and limits

- `npm run check:imports`: parse imports/reexports and verify exported names and deployment paths.
- `npm run check:api`: check direct calls, namespace aliases and literal generated workers against the checked-in API snapshot. Intentional undocumented achievement APIs and guarded legacy fallbacks have file-specific reasons in `scripts/api-compatibility.json`.
- `npm run check:ram`: audit static/dynamic import differences and report documented SF4 RAM subtotals. Indirect calls and generated templates still require native checks; these estimates are not complete script allocations.
- `npm run check:game`: compile manifest entrypoints and verify the known cloud/contract parent-plus-worker scheduling budgets using current native parent allocations and active SF4 metadata. No gameplay scripts are executed by this check.
- `npm run audit:surface -- path/to/NetscriptDefinitions.d.ts`: regenerate API paths and documented costs after updating game definitions. The snapshot includes the definition hash for provenance.

Autopilot backs off persistent managers after two rapid exits. Retries start at 30 seconds and are capped at five minutes, with state scoped to script arguments, source signature and augmentation reset. Stable uptime or changed code clears the strikes. Explicit autopilot stops are excluded, and one-shot casino, faction purchase and reset hooks retain their existing scheduling. Current cooldowns appear in automation status and the read-only preview. Restarting autopilot clears its in-memory launch history.

`git-pull.js` now reports partial downloads accurately and skips cleanup until every requested file succeeds. It still updates successful files immediately; it does not provide an atomic whole-project rollback.

## Added automation

- **Corporation:** In BitNode 3 or with Source-File 3 access, waits until self-funding is allowed, creates Apex Holdings, grows Agriculture across cities, enables Smart Supply when affordable, and then adds a Restaurant product division. It uses cash reserves and incremental expansion thresholds. Start it manually if you want it running outside the daemon's memory threshold.
- **Darknet:** Probes the current network, reports server depth and password hints, attempts to buy TOR and `DarkscapeNavigator.exe` when Singularity access permits, and deploys scouts after authentication. It uses each server's password length and character format to skip impossible supplied guesses, and tries direct hint data when it fits those constraints. Authenticated scouts open cache files, run phishing attempts, reclaim blocked memory, inspect recent logs with non-destructive heartbleed peeks when Charisma allows, and continue probing as the network changes. Scouts at depth 2 or greater claim an available stasis link to keep a deep foothold reachable; the global link limit is respected.
- **Credentials:** The scripts try exact words from `darknet-candidates.txt` and known entries from `darknet-passwords.txt` (`hostname=password`). Successful matches are saved as individual `darknet-passwords-HOST.txt` reports, synchronized back to home by scouts, and propagated to new scouts so one discovery can help the whole network. Do not add credentials you do not want stored in your game save.

The storm-seed executable is never launched. All currently known password models have solver paths; network changes, Charisma requirements, and game version differences can postpone a solution.

## Included systems

Darknet NIL servers are solved from Heartbleed authentication feedback. The coordinator and scouts preserve positions marked `yes`, replace positions marked `yesn't`, and authenticate the resulting password. Feedback is matched to the exact attempted password, confirmed progress survives temporary network failures, and solving waits for sufficient Charisma. The shared `darknet-solvers.js` module must be synced alongside the scouts.

## Automatic progression additions

- **Corporation products:** Completed `Apex Dining` products are replaced at capacity, weakest rating first. Development waits for cash, a warehouse, and all existing products to complete, with a 15-minute cooldown saved across restarts. Custom product names are preserved.
- **Corporation production:** Boost targets use each industry's production factors and available warehouse space. Purchasing is budgeted after immediate expenses and shared across cities. Office jobs favor production while retaining research capacity. Before Market-TA.II, prices rise when stock clears and fall when stock builds. Upgrade selection uses estimated marginal benefit per dollar.
- **Darknet puzzles:** Includes NIL, DeepGreen, AccountsManager, timing, Spice Level, Roman ranges, and modulo feedback solvers, plus binary, XOR, base conversion, arithmetic, prime factor, CAPTCHA, echo, and buffer-overflow candidates. Probe work is bounded per pass and resumes after temporary failures. Solving complex feedback models requires sufficient Charisma for Heartbleed.
- **Darknet recovery:** Scouts publish heartbeat files and retry failed credential uploads. Adjacent managers restart scouts only after a matching PID's heartbeat is more than 30 minutes old. Failed deployments are retried, and missing workers are relaunched as RAM allows.
- **Sleeves:** `sleeve.js` synchronizes, recovers shock fully by default, trains within the global reserve without prompts, buys affordable augmentations after shock reaches zero, assigns distinct useful factions/companies, farms gang karma, and selects cash crimes by each sleeve's estimated success rate and income per second. Supported faction work types are ranked by sleeve skills. Three sleeves remain available for Bladeburner support when it is active; contracts require `--enable-bladeburner-contracts` because the exposed player chance is not a sleeve probability. Optional Singularity, Bladeburner and Hacknet features are gated by access. Actual tasks are checked and idle/changed tasks reassigned. Status is published to `tasks/sleeve-status.json` and the Remote API's automation status.
- **Sleeve expansion:** `sleeve-expansion.js` buys sleeves up to the SF10 capacity and upgrades memory to 100 in BitNode 10. By default it can spend all unreserved cash toward these permanent purchases, checked immediately before each purchase; `--budget-fraction` reduces that allowance. Affordable smaller memory increments are purchased when a full batch cannot fit. Autopilot and daemon supervise both sleeve workers; the old fixed sleeve-price reserve no longer blocks its own purchases.
- **Grafting:** `grafting-manager.js` checks installed prerequisites, travels to New Tokyo, and protects existing grafts, program creation, and Black Ops. Its allowance is 25% of unreserved cash. New grafts require positive weighted benefit after the 2% entropy penalty and estimated repayment within four hours, including unfocused graft time and interrupted cash income. It uses current script hacking income and income sources averaged since the last installation; skill/speed gains are not treated as guaranteed cash. Congruity is evaluated by recovering existing entropy, rather than receiving unconditional priority. Queued augmentations (including extra NeuroFlux levels) and autopilot's live reset plan block new grafts. Singularity and Grafting access are required. Configure `--budget-fraction` and `--max-payback-hours`; decisions are recorded in `tasks/grafting-status.json`. Repayment is an estimate, not a guaranteed return, and faction reputation opportunity cost is not monetized.

Daemon starts the new progression workers automatically when their access and RAM requirements are met. All game scripts and their imports must be synced, including `automation-policy.js`, `darknet-solvers.js`, `sleeve-expansion.js`, `grafting-manager.js`, and `progression-coordination.js`. Individual workers can be disabled with daemon's `--disable-script` option.

The upstream suite provides the main hacking daemon plus helpers for root access and server management, companies and factions, gangs, sleeves, Bladeburner, stocks, Hacknet, Stanek, Go, coding contracts, and augmentation/reset workflows. Mechanics locked behind Source Files, API access, money, or player progress remain idle until they become available.

The corporation manager is based on the supplied optimizer's Agriculture-first, Restaurant-second plan. The source used older method names; this version uses the current API (`purchaseUnlock`, `getUnlockCost`, and `canCreateCorporation(true)`). The corporation manager has been run in the connected save. Its calculations and other-division maintenance are also covered by mocked API tests.

## Complete automation coverage

Start `autopilot.js` to supervise the available systems. No tails open automatically.

| System | Automatic work | Waits for |
| --- | --- | --- |
| Casino | Highest-priority earnings and restart workflow | Eligibility, seed cash, a supported game UI |
| Hacking | Rooting, batching, servers, programs, RAM and cores | Skill, cash and available RAM |
| Factions and companies | Invitations, jobs, reputation, augmentation purchases and installs | Singularity access and progression |
| BitNodes | Detect completion and advance using autopilot's configured sequence | Singularity access and completion requirements |
| Corporation | Agriculture/Chemical/Restaurant growth; upkeep, recipes, sales, research and managed products in other existing industries | Corporation API, funding and reserves |
| Dark Net | All 25 known model paths, dictionaries, scouts, caches, phishing, stasis, air-gap migration and stock promotion | Navigator, Charisma, direct connections and RAM |
| Infiltration | Enter a suitable location, solve all eight puzzle types, collect money or faction reputation | Singularity, compatible UI, healthy HP, market demand, no graft/Black Op |
| Health | Hospital recovery with reserve checks | Singularity and enough unreserved cash |
| Gang, sleeves, Bladeburner | Existing workers plus supervised recovery; sleeve purchases/memory in BN10 | Their API and gameplay unlocks |
| Stocks, Hacknet, Stanek, Go, contracts | Existing managers, forecasts, upgrades, charging, Go play and contract solving | Relevant access, money and RAM |
| Grafting | Beneficial graft selection and prerequisites | Grafting/Singularity access and budget |
| Recovery | Restart missing managers, preserve pause flags, reserve home RAM for pending priority managers | Enough total home RAM |

Infiltration uses the company entry callback, current UI stage handlers, and normal reward buttons. A complete run at SysCore Securities has been verified in the connected save, including collection of the cash reward. It cancels an unknown model instead of sending synthetic keyboard events, which the game rejects. It yields to casino and completed BitNodes, preserves grafts and Black Ops, pauses competing focus work during a run, and resumes that work afterward. Use autopilot's `--disable-infiltration` option to leave it manual. `infiltration-manager.js --money-only` always takes cash; its default trades for the previously worked faction only after verifying the selected faction, otherwise taking cash. `--faction CyberSec` selects a specific joined faction and ranks locations by reputation instead of cash. Location rankings learn completion times and failure rates; failed locations receive increasing cooldowns. History survives manager restarts within the same augmentation reset in `tasks/infiltration-history.json`. The default interval is 20 seconds; global market demand below two-thirds triggers a calculated recovery wait, configurable with `--interval` and `--min-demand`. A stuck puzzle cancels after 30 seconds.

Dark Net RMS and divisibility solvers reconstruct passwords from feedback; packet captures are intersected across attempts; hill searches verify the exact peak; labyrinth scouts use their own persistent position and backtrack through dead ends. Built-in dictionaries do not depend on manually supplying candidate files. Scouts refresh when their deployed code changes. Migration only targets populated frontier scouts and preserves stasis/story servers. Stock promotion raises volatility and only targets a currently held favorable position using fresh 4S forecasts; it waits without reliable signals.

Game unlocks are real limits: scripts cannot invoke locked APIs before the required Source Files or BitNodes are available. The first import and startup still require setup. Unsupported future UI/API changes are reported and retried gracefully. Custom corporation products are retained; only manager-created products are retired. Storm Seed and server freezing are excluded from normal progression because they destroy useful network resources.

Runtime status is available in `tasks/automation-status.json` and `tasks/infiltration-status.json`. The Remote API worker supports the read-only `automation.status` command. Infiltration reports its current level while running and its outcome afterward; it waits for older focus workers to be refreshed before taking control of the UI. Corporation logic remains in the standalone manager; autopilot only launches it.

## Files

- `bitburner-scripts/` â€” complete script collection, including the added managers.
- `bitburner-scripts/darknet-passwords.txt` â€” optional known credential list.
- `bitburner-scripts/darknet-candidates.txt` â€” exact candidate words tried against visible servers.
- `bitburner-src-dev.zip` was used only as an API reference and is not included in the output bundle.

The supplied upstream collection is maintained at [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts). Its original README and license are included.

Casino automation has first priority in autopilot and may interrupt an active graft. BitNode completion also overrides grafts; augmentation installation waits for them to finish. Existing casino eligibility and disable settings still apply. Transition locks prevent the grafting worker from starting new grafts during casino or reset operations; stale locks are ignored when their owner is gone.

Hacking and Bladeburner victories share one departure path. Autopilot verifies auto-destroy settings, Singularity access, a valid next BitNode (1â€“15), and BN10 sleeve purchases/memory before interrupting active work. Only the hacking route runs daemon cracking. The optional completion hook runs after these checks; `tasks/bitnode-completion-hook.json` prevents replay within the same BitNode across retries or autopilot restarts. Failed launches remain retryable. A receipt recorded before an interrupted launch is treated as already attempted to avoid duplicate side effects. Augmentation resets and b1t_flum3 escapes remain separate from victory.

## Remote API command worker

Run `remote-api-agent.js` once on home. Updated autopilot maintains it after normal restarts when RAM is available. The worker accepts state queries and start/stop for named project automation scripts; it does not expose arbitrary code, purchases, server deletion, or direct reset commands. Local commands are submitted with `control.cjs` in `C:/Users/mplei/Documents/Codex/bitburner-remote-api`. Expired commands fail; interrupted jobs are reported as uncertain and never replayed automatically. Missing Source Files and insufficient RAM are handled without killing other scripts.

Remote `stop` now persists a pause flag under `remote-control/paused/`; autopilot, daemon, and indirect launches honor it. Remote `start` clears that flag and reports failure if no live target starts. Start commands use each script's default arguments. The worker protocol is version 2; updated autopilot refreshes an older worker automatically. Casino and completed BitNodes retain priority over grafting, while daemon startup travel/study/cleanup protect active grafts. Corporation Hacknet budgets use unreserved player funds.

### Corporation cash recovery

The corporation manager makes growth decisions once per full corporation cycle, keeps two cycles of input/salary expenses in reserve, and suspends boost purchases and dividends during cash recovery. Office upkeep shares a 2% cash allowance capped at 25% of operating profit per cycle; parties are sized to the morale shortfall. Offices with at least six employees can temporarily use interns to recover morale and energy without paid upkeep while preserving production roles. Existing MP price multipliers survive manager restarts.

### Supervisor and worker updates

Autopilot reserves additional home RAM while priority managers or the faction worker are absent, so hacking batches can drain naturally and leave room for them. Infiltration also retains the paused faction worker's RAM allowance while it owns the UI. Daemon rechecks supervised managers every 30 seconds, with at least 60 seconds between launch attempts. Explicit pause flags and disabled scripts are honored. API workers keep protocol version 2 and publish command-policy version 3; autopilot refreshes an older policy automatically. Activity locks expire when their owner disappears, and augmentation installs wait for an active infiltration.

## Gang management

`gangs.js` prioritizes respect until the roster reaches 12 members, then balances cash and useful faction reputation. Explicit money/reputation focus flags remain available. Reputation goals refresh after augmentation purchases; The Red Pill is included in BN2 and NeuroFlux is excluded from the finite goal. Tasks use native gang formulas when Formulas.exe is available, with the source-based formulas as a fallback.

Ascensions evaluate the geometric mean of primary stat gains, allow at most one member per management cycle, and retain recruitment progress: no ascension when within 20% of the next recruitment threshold; otherwise respect losses are capped at 10% before a full roster and 25% afterward. Wanted recovery chooses the least production loss per unit of wanted reduction. The default tolerated production penalty is 1%.

Warfare requires at least 75% chance against every active rival (`--warfare-win-chance`), and turns off when the controller exits. Member tasks are assigned independently so one rejected assignment does not block the rest. Equipment and augmentation budgets are independent, share a wallet cap, honor explicit zero budgets, and recheck actual prices and reserved cash at purchase time. `tasks/gang-status.json` and Remote API automation status report the current gang and assignments.

### Corporation lifecycle

Autopilot launches the standalone `corporation-manager.js`; it never opens a tail automatically.
The controller now supplies every industry's recipe, expands existing divisions to six cities,
reuses persistent export routes, researches prerequisites and the complete available research list,
and starts affordable products before late-game wealth. Custom products remain protected.

Profitable corporations gradually add missing industries when startup plus a $25b setup allowance
fits within 10% of cash after operating reserves. The game's BitNode division cap still applies;
rejected expansion attempts retry after five minutes. Disable with `--expand-all-industries false`.
Ads, global upgrades and optional unlocks share a saved growth allowance seeded from 20% of available
cash and replenished by 25% of cycle profit, preserving funds for supplies and expansion.

Investment rounds and emergency public financing preserve at least 50% ownership by default
(`--min-ownership`). Public share sales rescue a low player wallet only during unprofitable operation;
buybacks use at most 1% of unreserved player cash with price headroom. Disable with `--manage-shares false`.
Dividends stop during operating losses or cash recovery. Eligible faction bribes target outstanding
augmentation reputation, require Singularity access, and spend at most 5% of cycle profit.
Disable with `--bribe-factions false`. Missing optional access waits gracefully.

`tasks/corporation-status.json` reports finances, ownership, reserves and mode through
the Remote API's fixed `automation.status` query. Stopping the manager clears its recurring
recipe and boost purchase orders. Files sync when the game Remote API is connected.

### Standalone player crimes

`run crime.js` keeps the existing balanced progression from Mug to Homicide, Assassination and Heist
as success chances improve. `run crime.js --fast-crimes-only` restricts automatic choices to six-second
crimes. Explicit names work quoted or split, for example `run crime.js Grand Theft Auto`.
Optional `--goal money`, `--goal karma`, `--goal kills`, or `--goal stats` ranks expected reward per
second; player karma and experience include quarter rewards on failure. `--focus` opts into focused
work. The default runs without focus and never opens tails.

Requires BN4 or SF4. The controller waits for other player work, activity locks, casino and reset
transitions. It protects Bladeburner actions without Simulacrum and always protects Black Ops.
Repeating crimes are retained, automatic changes wait for a completed crime cycle, and a fresh
guard prevents races with new protected work. `tasks/crime-status.json` records current decisions.

### Stanek charging safeguards

`stanek.js` requires installed Genesis; SF4 is optional for reputation tracking. Charging uses the
worker's measured RAM cost, preserves configured and active task RAM reserves, confirms actual
charge or peak-power gains, and uses exact fractional charge targets. It can upgrade a fragment's
peak power when more threads become available. Booster-only or missing layouts never report success.
Owned charge workers are cleaned up on exit. Autopilot retries failed launches and releases its
temporary daemon RAM reservation after Stanek stops. `automation.status` includes the fixed Stanek
status report. Layout selection preserves saved definitions and handles unsupported sizes safely.

### Casino reliability

Casino controls use their current React handlers and refresh after each round. Travel confirmation,
dealer ranks, soft-hand decisions, integer wagers and blackjack payouts have regression coverage.
Repeated failures are bounded; failed runs that stopped automation resume the configured autopilot
with a one-minute casino retry delay. Successful completion still runs the configured completion
hook, with decoded forwarded arguments. Remote files are preserved by default, and script cleanup
retains the casino controller, its helper and the Remote API worker. Logs open only with
`--enable-logging`. Save/reload behavior is retained; `tasks/casino-status.json` records the run.

### Autopilot review safeguards

Autopilot reads Source Files and installed augmentations from native reset information, so limited
Singularity access cannot block startup. It validates configuration, awaits reserve/config writes,
keeps augmentation countdowns visible to grafting, and retries failed purchase-helper launches.
An active casino pauses other progression, and augmentation installs wait for Black Ops and grafts.
Daemon argument comparison tracks numeric RAM reservations and removed flags without restarting
for every recovery-padding change. Startup spending remains possible before the stock API unlock.
Corporation management remains in the standalone controller launched by autopilot.

### Network map

`run scan.js` builds a home-rooted map, scanning each reachable server once. Click a server to
navigate or a backdoor link to connect and start its installation. Links use the current terminal
handlers after React state updates. Hostnames containing command separators are displayed without
navigation links. Server and contract names are escaped for HTML. `--hide-stats` hides detailed
statistics; when the terminal UI is unavailable the script prints a text map instead.


## Maintenance utilities

`sync-scripts.js` copies game scripts from home to rooted servers using cycle-safe discovery. Runtime data and Node tooling are excluded. Running scripts continue until their normal restart; use `run sync-scripts.js --restart` only when restarting remote work is intended. Thread counts and arguments are retained, and failed copies never terminate workers.

`cleanup.js` removes only the actual Temp directory and defers while other home scripts are active. `git-pull.js` excludes runtime files, tests and Node tooling from normal repository discovery, preserves local configuration files in fallback listings, and deduplicates downloads.

See PROJECT-QA.md for the latest project check and its coverage limits.


## Background job health and scheduling

`run automation-dashboard.js` shows recent daemon-managed job dispatches: launches, already-running jobs, expected blocking reasons, failures, and average dispatch time. Each job retains at most 64 observations from the last five minutes. Observed execution durations are ranges; seeing a process exit does not confirm it completed successfully. The reset-scoped report is saved in `tasks/background-jobs.json` and included in the supervisor dashboard.

Ordinary periodic work receives a small deterministic delay to spread bursts. RAM, compilation, activity, maintenance, and launch failures retry with bounded backoff. Infrastructure affordability, faction invitations, and backdoor unlocks retain their immediate wakeups.

Daemon publishes its complete discovered host list every ten seconds. Contract collection reuses it only on home while its owner is alive, the reset matches, and it is under fifteen seconds old; otherwise collection scans normally. Contract files, permissions, money, and RAM are still read live. Disappearing hosts are skipped.


## Measured optimization controls

- Daemon's `--max-hacking-processes` defaults to 2048 live HGW workers across the observed network. Threads do not count as separate processes. A complete inventory is refreshed every five seconds; locally admitted workers consume slots immediately. Three sustained scheduling delays of at least 250 ms reduce new-worker admission, and clean samples restore capacity gradually. Existing workers are never killed to meet the cap. The dashboard shows observed counts and scheduling lag. Other scripts can still launch independently between samples.
- Automatic hash investments in server money/security require native hacking formulas, current owned income workers, and recent profitability analysis. Projections use rounded one-core HWGW batches before and after the upgrade, fixed allocated RAM, cash opportunity cost, and one batch-cycle allowance for retuning. These are projections, not measured income gains. Upgrades are requoted individually; unavailable formulas defer the investment. Explicit manual spending remains available.
- `tasks/hacking-income.json` records owner-scoped hack receipts per sampled RAM-second. Qualified windows need at least 120 seconds, 30 hack completions, stable player/target settings and allocation, and clean hack/grow/weaken timing. Fresh observed throughput can only reduce hash server-upgrade projections; missing evidence retains the native estimate. Samples expire after ten minutes and invalidate on reset, owner changes, telemetry gaps, counter rollback, allocation changes, or timing errors. Successful boosts are journaled in `tasks/hash-server-upgrades.json`; comparable post-retuning windows include explicitly observational before/after rates, without claiming isolated upgrade gains. Manual-hack allocations are excluded.
- IPvGO defaults to `--search-mode shadow`: a bounded two-ply challenger proposes a move every eighth eligible turn while the current tactical solver keeps playing. `--search-mode off` removes this measurement cost. `--search-mode play` is experimental; it can choose search proposals after urgent tactical moves, with final native legality checks. Search defaults to a 5 ms cooperative budget and 64 hypothetical moves (`--search-ms`, `--search-nodes`). Achievement streak/failure tasks skip search. Search-play performance history is isolated from tactical history. Shadow comparisons measure cost and agreement, not reward improvements.

### Bladeburner progression spending

During reliable Contract/Operation grinding, skill spending compares predicted sustained rank gain per skill point using native action timing and amortized stamina recovery. It respects Overclock's level cap and whole-second duration floor; missing estimates retain the weighted fallback. Combat skill estimates conservatively omit their extra success-chance benefit. At 90% of the next Black Op rank gate, spending starts preparing its chance and maximum-stamina requirements rather than buying unrelated upgrades. This forecast does not start Black Ops before their native rank and safety checks pass.

Ordinary stamina recovery retains the configured recovery floor and raises its exit target when native-level action estimates show that an expensive useful action needs more stamina, with a bounded repeat buffer. Unknown, depleted, changed-level, or impossible action estimates cannot set this target. Existing health, Black Op, and activity guards remain in force. These are predicted improvements; live gains require connected-game measurements.

Bladeburner city selection samples native chances and rewards across safe action levels in one synchronous worker, restores levels and the original city in `finally`, and compares rank rates including stamina recovery. Sampling is cached for at most 15 seconds; a move needs more than a 3% advantage over the current eligible city. Raid and chaos-recovery routing retain priority, and final action starts still recheck native safety. If sampling is unavailable or no reliable work exists, the population-based fallback remains available. The joint search uses at most 96 distinct level probes per action per city; large level ranges use a bounded candidate search rather than exhaustive enumeration. `--disable-level-optimization` retains current-level city comparisons. The ordinary level planner is capped at 128 probes per action and retains the best measured safe candidate.

Skill spending evaluates all currently available, unreserved Contracts and Operations, rather than only the running action. A success upgrade can win by unlocking a better action, but that action must reach the configured safety threshold. It compares the best rate available after each upgrade, without adding rates from mutually exclusive actions; depleted work is excluded and quotes refresh after each purchase.

Cloak and Short-Circuit participate in throughput skill spending only for actions explicitly flagged as stealth or kill actions in the official [Contract definitions](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/data/Contracts.ts) and [Operation definitions](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/data/Operations.ts). Forecasts apply the marginal multiplier at the current skill level, respect success caps, and require newly unlocked work to meet the safety threshold. Missing or non-boolean flags cannot grant a bonus.

### Bladeburner maintenance costs

City, level and action rank scores now charge expected operation-team losses using native Recruitment duration and its conservative success estimate. City probes refresh that quote for each city, and squad comparisons charge it only once. Missing replacement estimates cannot make assigned squads appear free. Existing human-team and support-sleeve reserves remain protected by the action-start guards.

Chaos scores price fixed success-only increases, unconditional increases, and a conservative reserve for positive random changes using the official [completion rules](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/Bladeburner.ts). Assassination's reserve prices positive random outcomes; it is not a claim that its average signed chaos change is positive. The estimate amortizes player Diplomacy near the configured chaos ceiling, includes passive chaos decay, and credits passive stamina regeneration during both recruitment and cleanup. Native snapshots also credit confirmed healthy, synchronized sleeve Diplomacy at a conservative relative speed, and compare finite, safe solo Stealth Retirement cleanup against player Diplomacy. Combat cleanup includes its rank, expected losses, time and extra stamina; whole-attempt stock and combined stamina must cover the forecast. These remain projections rather than measured completion ETAs. Black Ops retain their immediate progression priority and are not taxed with recurring ordinary-operation maintenance.

Sleeve cleanup credit comes only from native Diplomacy tasks with valid cycle lengths; planned tasks, unavailable Source Files, unknown relative speed, and unhealthy/unsynchronized sleeves earn no credit. Player bonus time reduces relative sleeve credit fivefold; sleeve acceleration is ignored. Combat cleanup must meet both the configured success threshold and the controller's strict greater-than-99% cleanup gate. City probes refresh combat quotes per city, while maintenance cache signatures quantize fractional stock/stamina noise. Fractional cleanup cycles amortize rank/time only; availability checks cover whole attempts. Native action starts still recheck safety before dispatch.

### Surplus Stealth Retirement rank work

`bladeburner.js` now permits Stealth Retirement Operation to compete for ordinary rank work when whole available stock exceeds `--stealth-retirement-reserve` (default 20). Existing safety, rank-rate comparisons, health/stamina recovery and Black Op priorities still select the action; surplus availability never forces farming over better work. Chaos recovery can use the reserve itself.

Surplus farming requires an acknowledged, parent-owned temporary worker that checks stock at native Bladeburner updates and stops auto-repeat at the reserve floor. Starts recheck both whole stock and guard liveness in the native transaction. Leases expire after 30 seconds, reset/controller ownership changes are respected, startup retries are bounded, and unavailable APIs/RAM defer farming. The worker's documented API costs fit the existing 16 GB helper slot; native RAM verification remains pending when disconnected. Deferred nonurgent switches renew the farming lease so a partial mission is not cancelled merely because a better future action was found. Expected boundary stops are not reported as unexpected interruptions, and fractional stock cannot start cleanup missions.

### BitNode ETA reserve handling

Bladeburner completion estimates share the controller's rank-supply rules: Raid is excluded, Stealth Retirement counts only whole missions above its configured cleanup reserve with a live acknowledged guard, and Tracking/Investigation/Undercover Operation retain the configured population reserve. The population reserve shrinks as projected rank rises, including rank earned from ordered Black Ops. Finite stock is consumed only once across stages. Estimates read a fresh, current-reset snapshot from the live controller; missing or stale evidence excludes special-purpose stock. If usable supply cannot cover the remaining rank gates, the ETA stays unknown rather than spending the reserve in its projection. These remain current-capability estimates and do not predict future mission regeneration.

### Combat capability growth

Bladeburner planners use the native `Evasive System` skill name. While the next Black Op is rank-ready but chance-blocked, development compares estimated competence gained per second from safe, unreserved missions against bounded Training. Native difficulty/XP allocation and Hyperdrive are included; failed missions grant half XP. Mission duty uses the existing recovery, chaos and squad-maintenance timing. Health, stamina, chaos cleanup, recruitment and Black Op priority guards continue to apply. When the next Black Op is rank-ready, the bounded level/team probes optimize estimated combat XP value rather than rank. Unsafe and unmeasured levels remain excluded; the disable-level-optimization option retains native levels.

Healthy, synchronized sleeves compare their best crime with current-city gym quotes from Formulas.exe. Quotes use native enum arguments, per-cycle rates and costs, with a ten-second cache. Gym work needs a greater-than-10% competence advantage, an affordable bounded interval, a shared sleeve spending allowance and the training reserve. Invested crime work waits for an observed completion before switching; unavailable formulas keep the crime fallback. Explicit training/XP restrictions remain respected. Black Op combat development is not cut off by the general early-node conditioning time limit.

When trimming an unaffordable augmentation basket for the Bladeburner route, fresh blocked-operation metadata weights stat, XP and success bonuses. Generic weighting remains the fallback. Purchase order, prerequisites, priority augmentations, donation costs and install/rebuild checks keep their existing safeguards. These local marginal capability estimates are not measured speedups or promises of completion time.

### XP levels and Hyperdrive tradeoffs

The XP objective reuses the existing synchronous level and squad probes, restoration, short cache and native action-start checks. It charges actual recovery/maintenance duty and uses each mission's native XP weights, including the separate 0.003 intelligence coefficient. Rank earning remains the objective below the next Black Op rank gate.

`--growth-horizon-seconds` defaults to 300 and accepts 30â€“900 seconds. While rank-ready and chance-blocked, Hyperdrive competes with direct success/effective-stat upgrades by projected incremental capability per skill point. It receives half credit for benefits that arrive gradually. A direct upgrade which opens the Black Op immediately takes priority. Forecasts require fresh same-reset evidence for the active repeatable mission, a matching Hyperdrive/effective-stat quote, and observed shared XP when sleeves are available. Unknown evidence keeps the direct-upgrade fallback. Observed shared XP is not added to player mission XP twice. The horizon is bounded by unreserved mission supply, with the current attempt excluded conservatively; Training receives no Hyperdrive benefit. Existing maximum-stamina priorities remain ahead of these comparisons.

These are bounded local projections. The growth forecasts have not been validated as measured end-to-end speedups.

### Combat-growth city selection

Once the next Black Op rank gate is met, city comparisons use the same target-weighted competence/sec objective as XP mission selection. Below that rank gate they retain rank/sec. Cities compare safe native levels, per-city cleanup/recruitment costs and actual recovery duty; disabling level optimization keeps the current-level XP comparison. The original city and levels are restored after probes, including errors or cancelled work. Reserved actions remain excluded, raids/chaos handling keep their routing priority, and the three-percent switching margin is retained. The cache key includes the objective target and optimization mode so a rank result cannot be reused as an XP result. City switch logs label the selected objective.

### Training as a city baseline

The XP city worker also obtains an optional native Training quote for the pending Black Op. City selection raises only the current eligible city's score to that baseline, then applies the existing three-percent switching margin. A better mission city can still win. If all missions are weaker than available Training, the controller stays put instead of entering the population fallback.

Training eligibility is reevaluated outside the cached city scores on every pass using the action selector's existing development policy and rolling budget. Exhausted training limits, insufficient budget, health/stamina recovery, a safe Black Op, and a population-estimate interval needing Field Analysis disable the baseline. A city excluded by chaos filters is not reintroduced. Missing native quotes retain ordinary city comparisons. The city baseline does not dispatch Training or interrupt other activity; fresh action-start guards still decide what runs.

### Planning refresh after Bladeburner skill purchases

Confirmed skill purchases immediately invalidate the city cache (including Training quotes) and the level/squad cache before purchase reporting. An empty purchase result or an achievement request to bank points retains usable caches. Failed or malformed purchase responses invalidate both caches conservatively because the worker may have committed upgrades before losing its reply; the error remains visible through the existing controller error handling. The next eligible planning pass refreshes native quotes while retaining action, safety and probe guards.

### Manual skills and completed grafts

Before city-cache reuse, one read-only worker captures city data and a stable capability signature: native Bladeburner skills, relevant stat/XP/Bladeburner multipliers, owned augmentation counts and entropy. Manual skill purchases and completed grafts therefore clear both city/Training and level/squad plans on the next eligible controller pass. Stable capabilities preserve caching; money and raw XP drift do not cause repeated city probes. Unknown, malformed, stale or reset-mismatched signatures clear caches conservatively. The worker uses base ownership data rather than optional Singularity or grafting APIs, and batches the previous population, community, chaos and current-city reads into one request. Active Black Ops and player activity guards still precede this work. Native start guards continue to recheck safety after planning.

### City maintenance cache refresh
The city snapshot also captures whole reserved-operation stock, Diplomacy and support sleeve assignments, Diplomacy readiness/charisma/duration, and the player's bonus-speed regime. Changes refresh city estimates on the next eligible controller pass. Effective rank supply and reserve settings are part of the key, as is the current city. Fractional stock regeneration and task progress do not force new city probes. Missing optional sleeve APIs discard all partial sleeve evidence; malformed maintenance snapshots disable cache reuse. The existing 15-second expiry and native start guards remain in force.

### Fresh Training safety gates
Every eligible Bladeburner pass collects current health, stamina and native chances for the pending rank-ready Black Op in the existing city snapshot worker. The cached Training score is rebased onto those fresh safety inputs before applying its city baseline. Damage, healing, stamina recovery, analysis changes and a newly viable Black Op therefore affect the baseline immediately, without forcing expensive city probes. Stale, malformed, reset/target/city-mismatched or unavailable vitals omit the Training baseline. Ordinary city scores retain their bounded cache; native action-start guards remain authoritative.

### Population and chaos cache anchors
Eligible cities' population estimates and chaos are copied into the city cache after a successful probe. Before reuse, a population change of at least 1% in either direction, or an absolute chaos change of at least one point, triggers fresh city scores. These are planning tolerances, not claims about an equivalent success-chance or speed gain. Small changes accumulate against the last probe rather than reanchoring each sample. Zero population transitions, changed eligible city sets, missing anchors and malformed data also invalidate reuse. Existing candidate eligibility checks, 15-second expiry, Black Op protection and native start guards remain in force. This comparison uses existing city reads and adds no native worker calls.

Cancelled, partial, duplicate-city or invalid-score probe results are not cached as successful observations. The controller falls back for that pass and can retry on the next eligible pass; a complete probe with legitimate zero-score cities remains cacheable.

### Player stat growth and city scores
The existing city snapshot now also copies native player levels for hacking, strength, defense, dexterity, agility, charisma and intelligence. A change of at least 1% in any level since the last completed city probe invalidates its scores, in either direction. Small level changes accumulate against that anchor; raw XP gain alone does not trigger repeated probes. Zero-to-positive changes and missing or malformed stat anchors also invalidate reuse. The stat anchor is replaced only alongside a complete city result. This adds no worker calls, preserves the 15-second expiry and active Black Op guards, and complements immediate skill/augmentation invalidation. The threshold is a planning tolerance, not a measured speed gain.

### Squad changes and city scores
The existing city snapshot reads total team size, all ordinary-operation team assignments and the pending rank-ready Black Op's assignment. Recruitment, casualties, manual reassignment and changed operation sets therefore invalidate cached city scores on the next eligible planning pass. Stable assignments preserve caching, including reordered native operation lists. Unknown, partial or malformed squad observations cannot authorize cache reuse. Reads neither assign teams nor interrupt actions; active Black Op guards still run first, and native start guards remain authoritative. The key does not assume per-operation assignments sum to the current total.

### Snapshot RAM limits
City snapshot readers are now separate from controller policy imports. Production loads a generated source catalog, checked against the native readers by regression tests. With less than 64 GB currently free on home (or unknown capacity), the controller awaits five small readers sequentially; otherwise it retains the batched read. Each result carries its city, reset IDs and time. Partial, duplicate, stale or conflicting results abort the pass rather than publishing mixed state. Fixed native QC command `automation.bladeburnerSnapshotPreflight` compiles and removes probes without executing them, enforcing a 24 GB worker limit. Regenerate changed readers with `node scripts/generate-bladeburner-snapshot.js`; check drift with `--check`. This bounds snapshot children, not the complete Bladeburner RAM requirement: other controller imports and planners still need separate low-RAM review.

### Adaptive Black Op attempts
Normal operations keep `--success-threshold` (default 99%). For the next rank-ready Black Op only, adaptive decisions can accept a conservative post-stamina probability down to `--black-op-min-success` (default 90%). `--disable-black-op-risk` restores the ordinary threshold throughout. Unknown or stale economics also retain that threshold.

The local expected-time model charges a failure for restoring the rank gate (using 110% native rank loss, observed/sustained rank rates and sufficient unreserved stock), worst-case assigned-team replacement, and HRC healing/stamina recovery. HP and stamina recovery overlap; passive regeneration and parallel sleeve recruitment receive no credit. Lethal damage uses instant hospital recovery with the smaller of 10% of cash and the damage-based medical bill; expected hospital spending must stay below 1% of current cash. Assigned teams cannot expose supporting sleeves to worst-case casualties. HP must be at least 90%, and stamina at least 99%. A shared bonus-time balance is consumed across attempts, failures and recovery. Failure branches are priced separately so retries cannot reuse depleted bonus time. Attempt-now timing includes conservative tick and burst allowances; waiting uses optimistic continuous timing.

Waiting alternatives use either at least 30 seconds of observed improvement (forecast at twice the fastest observed rate, normalized for observed bonus depletion while retaining an optimistic external-XP wall-rate bound), or optimistic recruitment with no recruitment failures. Waiting receives 50% credit for developing later-operation capability, and its projected retries receive zero recovery cost. Attempting now must beat this favorable waiting estimate by at least 30 seconds and 20%. These are conservative heuristics for the next operation, not a full BitNode completion guarantee. Missing improvement ETA, replacement estimates, rank recovery or stock evidence prevents adaptive risk. Quote and history are refreshed after each native one-shot attempt; rank/chance drops reset history.

A five-second ticket binds owner, target, city and reset. Immediately before native start, changed odds, rank, funds, health, stamina, team/support assignments deny the adaptive start. The live bonus balance and elapsed preparation time are used to recalculate the expected advantage before dispatch. The existing protected-action, player-work and post-stamina guards remain authoritative. No active Black Op is interrupted. `tasks/bladeburner-risk.json` records the decision and its time estimates. Official failure HP data matches the supplied v3.0.1 game source.

Remote `automation.status` includes `bladeburnerRisk`, with the decision, fallback reason and quoted chance, so the policy can be inspected without starting an operation. Final adaptive start also rechecks duration, rank-loss amount, HRC time and applicable recruitment costs.

Below the configured adaptive probability floor, the controller skips the risk-quote worker entirely and records that reason. Eligible probabilities collect fresh improvement history before accepting risk.

### Hospitalization opportunity cost

Adaptive Black Ops now add expected cash-replacement delay to the completion comparison. A paid lethal failure requires at least 30 seconds of reset-scoped observations: recurring income (hacking, Hacknet, gangs, corporation, crime, work and sleeves) is capped by actual wallet growth, and the lowest observed rate is halved. Casino wins, stock sales, contracts, infiltration and other windfalls cannot establish that rate. Spending, missing data, reset changes or stalled cash growth can prevent an adaptive attempt. Free and nonlethal failures do not require an income estimate.

The source-derived hospital bill cap is priced as wall time per failure, outside Bladeburner bonus acceleration. This is a conservative opportunity-cost penalty, not a claim that the player must stop all work to replenish cash. The existing 1% expected-cash-loss cap remains. The native start rechecks the five-second ticket and reprices the cash penalty against the current wallet. A separate small read worker collects money sources so the risk quote stays at 31.1 GB.

The bill is `min(10% of cash, (maximum HP - current HP + adverse damage) * $100,000)` for lethal damage; nonlethal damage has no hospital bill. Adverse damage includes the existing 10% damage allowance and rounding. Damage below zero HP is billed by the game and is included. The native start checks the bound again against current health and cash; the nonfatal recovery bound also covers healing that changes a lethal failure into a surviving hit. Diagnostics expose adverse damage, the capped bill and expected cash loss/delay. This follows `src/Hospital/Hospital.ts` and `HospitalCostPerHp` in the supplied v3.0.1 source.

Damage rolls that straddle the lethal boundary include both the adverse hospital bill and an upper bound on surviving-hit HRC recovery. The bound covers the largest integer damage below maximum HP, provided a nonlethal roll is possible, and still overlaps HP/stamina recovery. Guaranteed lethal rolls need no HP healing. This deliberately charges mutually exclusive adverse outcomes together to avoid assuming every failure receives instant hospital healing.

### Growth-aware augmentation saving
With fresh recurring-income observations and install/rebuild estimates, the ordinary savings selector ranks eligible reputation-ready augmentations by estimated route gain per hour of cash wait plus recovery. Fresh Black Op metadata weights combat gains when available; otherwise it uses conservative route weights. Red Pill and Simulacrum priorities remain authoritative. Missing timing evidence retains the price-based fallback. Known route completion time excludes goals whose wait and rebuild would arrive too late. This selects savings goals, not purchases or permission to reset.

Ordinary savings may fund one individually profitable gang equipment purchase per budget epoch, with a sixty-second cooldown that survives budget renewal. The worker requires Formulas.exe, recomputes current-task money/wanted effects from native gang/member/equipment data, and rejects worsening wanted gain. The shared spending guard discounts the money gain by 50%, requires payback within fifteen minutes and half the baseline funding wait, and requires at least thirty seconds and 10% faster augmentation funding. Cost is limited to 1% of the current wallet and the existing gang allowance. Explicit cash reserves, active install-wait plans and imminent reset plans remain protected. Bundles, unknown income, unavailable formulas and unmeasurable purchases cannot use this exception. The consumed exception is recorded in spending usage even if the game rejects the purchase. These are bounded forecasts, not measured speed guarantees.

### Hacknet investments while saving
The same shared funding-time exception now supports existing Hacknet production upgrades. Native current production and the selected upgrade ratio determine marginal income; purchase price is rechecked. Money nodes may upgrade level, RAM or cores. Hash servers may upgrade level or cores only: a live, unpaused hash worker must have a recent successful Sell for Money receipt and a fresh cash-priority status. Current RAM occupancy is respected; native hash cost and capacity must permit a cash sale. The estimate includes a full $1m cash-batch buffer and conversion delay. Hash RAM, cache and new-server purchases cannot borrow from augmentation savings.

Gang and Hacknet investments share the same sixty-second cooldown, one exception per budget epoch, 1% wallet cap, 50% gain discount, minimum projected funding improvement, explicit reserves and category allowances. Active install waits and pending resets stay protected. The manager considers at most eight affordable candidates so a smaller eligible upgrade can proceed after a higher-ranked candidate is deferred. Existing payoff horizons, spending limits, pauses and achievement restrictions still apply. Future production and task allocation can change; this is a bounded forecast, not a measured return guarantee.

### Shared growth-investment selection
Qualifying gang and Hacknet savings exceptions now submit bids to `tasks/growth-investment-auction.json`. A fixed thirty-second collection period lets the controllers compare opportunities; changing budget epochs cannot extend it. The forecast charges the collection delay before applying the existing minimum time-saving and payback requirements. The highest projected funding-time reduction wins; lower price and stable identity break ties. Only the winning caller's fresh native quote can spend.

Bids are repriced against current cash, funding rate, category allowances, explicit reserves, live owners and pause state. Price/gain changes replace the same investment's older bid. Dead, paused, expired or unaffordable bids are removed. There are at most sixteen stored bids, with a thirty-second execution period after collection; an unclaimed stale winner cannot block future rounds indefinitely. Scope changes (reset, goal or budget owner) restart selection. Existing shared cooldowns, install-wait and reset protections remain authoritative. Ordinary spending that already preserves the savings goal does not wait for selection.

The next collection round may start in the latter thirty seconds of the existing cooldown. This overlaps planning with the spending lock rather than adding thirty seconds after every cooldown. Dispatch still requires both the full sixty-second cooldown and a renewed budget epoch; collecting bids never consumes or releases an allowance.

### Gang planning horizons
The configured growth horizon is now a baseline. Fresh, live-owner route ETA or the next recruitment milestone may extend equipment, training and ascension evaluation to at most one hour automatically. Known route completion and a selected active augmentation install-wait ETA cap payback with a 20% buffer; an imminent verified reset stops discretionary adaptive equipment/ascensions. A queued augmentation alone does not predict a reset. Unknown or stale evidence retains the baseline. `--disable-adaptive-horizon` disables extension while preserving deadline caps; explicit larger baselines are retained. `tasks/gang-horizon.json` reports the selected window and reason. Mandatory training, wanted recovery and existing crew/recruitment safeguards remain authoritative.

### Sleeve augmentation bundle search
The purchase planner retains the old combined basket and single-offer candidates, then searches combinations using a small beam over cheap and promising offers. It evaluates at most 128 candidate bundles for crime forecasts or 64 for native work forecasts; this is a bounded heuristic, not an exhaustive optimizer. Candidate states include low-cost and high-output alternatives so individually weak augmentations can be considered together. Budget limits, a shared purchase allowance, minimum batch size, skill-reset rebuilding and the required benefit margin still apply. Invalid multipliers and duplicate offers are excluded. Search counts and bounds accompany successful plans.

### Corporation capital scoring from sales evidence
The manager records completed-cycle observations in `tasks/corporation-growth-market.json`, using the sales and warehouse reads it already performs. Three recent observations are required. Native division revenue/expenses are already per-second rates; the estimated city share divides division profit equally among its cities. The lower observed profit baseline scales an upgrade's existing estimated fractional benefit. Sell-through and persistent unsold stock suppress additional discretionary production/storage; clearing output and high warehouse occupancy favor storage, while sales bottlenecks favor sales upgrades.

Unknown/new markets retain comparable heuristic scores; foundation and development priorities, growth budgets, treasury reserves and native purchase checks remain intact. Evidence is scoped to the corporation and BitNode and expires after gaps. Decisions report their scoring basis and bottleneck factor. Observed profit is the baseline, not proof of a causal or measured marginal return from the upgrade.
