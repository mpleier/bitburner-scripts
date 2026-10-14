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

`4.3 → 1.2 → 5.1 → 2.1 → 9.2 → 10.1 → 8.2 → 13.1 → 7.3 → 3.3 → 15.1 → 11.3 → 10.3 → 14.2 → 1.3 → 2.3 → 5.3 → 15.3 → 9.3 → 13.3 → 6.3 → 14.3 → 8.3`

Here `9.2` means Source File 9 level 2, which may require multiple runs. This order prioritizes automation access and startup RAM, then income systems and concurrent progression, followed by remaining bonuses. Once every finite Source File is level 3, BN12 repeats indefinitely to increase starting NeuroFlux levels. This is a capability-focused default, not a prediction of the fastest completion time. `--next-bn` retains an explicit next-node override; invalid overrides prevent automatic departure. Recommendations and reasons appear in the autopilot log, `tasks/bitnode-priority.json`, and Remote API automation status.

Corporation material sales without Market-TA.II use `MP + quality/baseMarkup`, matching the game's additive markup limit. Product pricing keeps its separate adaptive policy. Warehouse expansion preserves operating reserves and pauses when unsold output is causing a backlog, allowing sales to recover before spending on more storage. Boost-material purchases stop during operating losses and use at most half of the previous cycle's profit, with a small initial allowance before the first sales cycle.

Copy the files and folders in `bitburner-scripts/` into your Bitburner home computer, keeping `Remote/` and `Tasks/` as folders. Import them using the file sync or editor workflow you normally use. Then start:

```text
run autopilot.js
```

`autopilot.js` starts `daemon.js`, which manages hacking and launches the included managers when their game unlocks and RAM requirements are met. For a manually started corporation manager, use `run corporation-manager.js`. The provided autopilot can automatically install augmentations and advance to other BitNodes when its conditions are met; review its options in `autopilot.js` before leaving it unattended.

Autopilot launches the standalone `corporation-manager.js` script in BitNode 3 or with Source-File 3 access when it is not already running and enough RAM is free on home. All corporation decisions remain in the manager. Its daemon is told to leave corporation startup to autopilot. Use `run autopilot.js --disable-corporation` to disable automatic corporation startup; this option is saved in autopilot's configuration and does not stop an already running manager. All automation runs inside Bitburner, and obsolete PC lease files cannot block startup.

## Local checks

Scripts do not open tail windows automatically. Use the Bitburner terminal command `tail autopilot.js`, `tail daemon.js`, or `tail corporation-manager.js` to open logs when you want them.

With Node.js installed, run `npm test` for the local unit tests and `npm run check` to syntax-check all JavaScript scripts. The tests use Node's built-in test runner and need no dependency installation. They cover selected logic with mocked Bitburner APIs; they do not replace testing in a live save.

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

- `bitburner-scripts/` — complete script collection, including the added managers.
- `bitburner-scripts/darknet-passwords.txt` — optional known credential list.
- `bitburner-scripts/darknet-candidates.txt` — exact candidate words tried against visible servers.
- `bitburner-src-dev.zip` was used only as an API reference and is not included in the output bundle.

The supplied upstream collection is maintained at [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts). Its original README and license are included.

Casino automation has first priority in autopilot and may interrupt an active graft. BitNode completion also overrides grafts; augmentation installation waits for them to finish. Existing casino eligibility and disable settings still apply. Transition locks prevent the grafting worker from starting new grafts during casino or reset operations; stale locks are ignored when their owner is gone.

Hacking and Bladeburner victories share one departure path. Autopilot verifies auto-destroy settings, Singularity access, a valid next BitNode (1–15), and BN10 sleeve purchases/memory before interrupting active work. Only the hacking route runs daemon cracking. The optional completion hook runs after these checks; `tasks/bitnode-completion-hook.json` prevents replay within the same BitNode across retries or autopilot restarts. Failed launches remain retryable. A receipt recorded before an interrupted launch is treated as already attempted to avoid duplicate side effects. Augmentation resets and b1t_flum3 escapes remain separate from victory.

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
