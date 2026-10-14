# Bitburner Complete Automation

This package combines the supplied Bitburner scripts with corporation and current-version darknet managers. The original script collection is included with its license and subfolders intact; the supplied source folder was left unchanged.

## Install and start

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
- **Sleeve expansion:** `sleeve-expansion.js` buys sleeves and upgrades memory to 100 in BitNode 10, using a shared allowance of 10% of unreserved cash per minute. Existing `sleeve.js` continues task and augmentation management.
- **Grafting:** `grafting-manager.js` chooses beneficial, affordable grafts, checks installed prerequisites, ignores queued augmentations, travels to New Tokyo, and protects existing grafts, program creation, and Black Ops. Its allowance is 25% of unreserved cash; weak upgrades are skipped to account for entropy. Singularity and Grafting access are required.

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

Infiltration uses the company entry callback, current UI stage handlers, and normal reward buttons. A complete run at SysCore Securities has been verified in the connected save, including collection of the cash reward. It cancels an unknown model instead of sending synthetic keyboard events, which the game rejects. It yields to casino and completed BitNodes, preserves grafts and Black Ops, pauses competing focus work during a run, and resumes that work afterward. Use autopilot's `--disable-infiltration` option to leave it manual. `infiltration-manager.js --money-only` always takes cash; its default trades for the previously worked faction when that selection is available. Repeated runs wait when market demand falls below 65%.

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

## Remote API command worker

Run `remote-api-agent.js` once on home. Updated autopilot maintains it after normal restarts when RAM is available. The worker accepts state queries and start/stop for named project automation scripts; it does not expose arbitrary code, purchases, server deletion, or direct reset commands. Local commands are submitted with `control.cjs` in `C:/Users/mplei/Documents/Codex/bitburner-remote-api`. Expired commands fail; interrupted jobs are reported as uncertain and never replayed automatically. Missing Source Files and insufficient RAM are handled without killing other scripts.

Remote `stop` now persists a pause flag under `remote-control/paused/`; autopilot, daemon, and indirect launches honor it. Remote `start` clears that flag and reports failure if no live target starts. Start commands use each script's default arguments. The worker protocol is version 2; updated autopilot refreshes an older worker automatically. Casino and completed BitNodes retain priority over grafting, while daemon startup travel/study/cleanup protect active grafts. Corporation Hacknet budgets use unreserved player funds.

### Corporation cash recovery

The corporation manager makes growth decisions once per full corporation cycle, keeps two cycles of input/salary expenses in reserve, and suspends boost purchases and dividends during cash recovery. Office upkeep shares a 2% cash allowance capped at 25% of operating profit per cycle; parties are sized to the morale shortfall. Offices with at least six employees can temporarily use interns to recover morale and energy without paid upkeep while preserving production roles. Existing MP price multipliers survive manager restarts.

### Supervisor and worker updates

Autopilot reserves additional home RAM while priority managers or the faction worker are absent, so hacking batches can drain naturally and leave room for them. Infiltration also retains the paused faction worker's RAM allowance while it owns the UI. Daemon rechecks supervised managers every 30 seconds, with at least 60 seconds between launch attempts. Explicit pause flags and disabled scripts are honored. API workers keep protocol version 2 and publish command-policy version 3; autopilot refreshes an older policy automatically. Activity locks expire when their owner disappears, and augmentation installs wait for an active infiltration.
