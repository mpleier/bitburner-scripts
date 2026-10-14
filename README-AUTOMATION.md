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

The storm-seed executable is never launched. Unrecognized puzzle models and passwords absent from supplied dictionaries may still require investigation.

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

The corporation manager is based on the supplied optimizer's Agriculture-first, Restaurant-second plan. The source used older method names; this version uses the current API (`purchaseUnlock`, `getUnlockCost`, and `canCreateCorporation(true)`). It has not been run inside a Bitburner save, so check the in-game log on first launch.

## Manual or partial areas

- **Darknet passwords:** Supported models are solved automatically. Unknown models and incomplete dictionaries remain partial. Stock promotion is not automatic because it requires TIX access and a deliberate stock selection. `STORM_SEED.exe` is never launched. The automation avoids freezing servers because that removes their RAM and experience benefits.
- **Corporations:** Agriculture, Chemical, and Restaurant are managed. Upgrade returns are estimates, and arbitrary industries and all share-trading strategies are outside this plan.
- **Sleeves:** Tasks and augmentations are managed with Sleeve access. Additional purchases and memory upgrades wait for BitNode 10 as required by the game.
- **Grafting and infiltration:** Grafting is automated with access and sufficient unreserved cash. Infiltration minigames remain manual.
- **Singularity-locked play:** Without Singularity access (BN4/SF4), faction work, augmentation purchases/installs, and BitNode progression need manual actions. Other managers can still run when their own unlocks are met.
- **Setup and choices:** You still need to import the scripts, start `autopilot.js`, and review darknet candidate words. Review autopilot's automatic augmentation and BitNode reset options before running unattended.

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
