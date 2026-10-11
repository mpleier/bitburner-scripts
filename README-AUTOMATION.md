# Bitburner Complete Automation

This package combines the supplied Bitburner scripts with corporation and current-version darknet managers. The original script collection is included with its license and subfolders intact; the supplied source folder was left unchanged.

## Install and start

Copy the files and folders in `bitburner-scripts/` into your Bitburner home computer, keeping `Remote/` and `Tasks/` as folders. Import them using the file sync or editor workflow you normally use. Then start:

```text
run autopilot.js
```

`autopilot.js` starts `daemon.js`, which manages hacking and launches the included managers when their game unlocks and RAM requirements are met. For a manually started corporation manager, use `run corporation-manager.js`. The provided autopilot can automatically install augmentations and advance to other BitNodes when its conditions are met; review its options in `autopilot.js` before leaving it unattended.

## Added automation

- **Corporation:** In BitNode 3 or with Source-File 3 access, waits until self-funding is allowed, creates Apex Holdings, grows Agriculture across cities, enables Smart Supply when affordable, and then adds a Restaurant product division. It uses cash reserves and incremental expansion thresholds. Start it manually if you want it running outside the daemon's memory threshold.
- **Darknet:** Probes the current network, reports server depth and password hints, attempts to buy TOR and `DarkscapeNavigator.exe` when Singularity access permits, tries supplied exact-match candidates on discovered servers, and deploys scouts after authentication. Authenticated scouts open local cache files, attempt phishing, reclaim blocked memory, and continue probing as the network changes.
- **Credentials:** The scripts try exact words from `darknet-candidates.txt` and then known entries from `darknet-passwords.txt` (`hostname=password`). Successful matches are added to the local credential file and passed to newly deployed scouts. These are exact matches only; the scripts do not generate combinations from clues. Do not add credentials you do not want stored in your game save.

The storm-seed executable is never launched. Passwords absent from the candidate list and clue-based variants may still require manual investigation.

## Included systems

The upstream suite provides the main hacking daemon plus helpers for root access and server management, companies and factions, gangs, sleeves, Bladeburner, stocks, Hacknet, Stanek, Go, coding contracts, and augmentation/reset workflows. Mechanics locked behind Source Files, API access, money, or player progress remain idle until they become available.

The corporation manager is based on the supplied optimizer's Agriculture-first, Restaurant-second plan. The source used older method names; this version uses the current API (`purchaseUnlock`, `getUnlockCost`, and `canCreateCorporation(true)`). It has not been run inside a Bitburner save, so check the in-game log on first launch.

## Manual or partial areas

- **Darknet passwords:** The candidate list only checks exact supplied words and may take time to exhaust, especially with low Charisma; it does not generate clue-based variants. It also does not use heartbleed, stock promotion, stasis links, or server migration. `STORM_SEED.exe` is intentionally never launched.
- **Corporations:** Automation is a conservative Agriculture and Restaurant strategy, not a full optimizer. It does not tune boost-material inventories, exports, research, every industry, or all share/dividend actions.
- **Sleeves:** Sleeve tasks and augmentation purchases are managed, but this package does not buy additional sleeves or upgrade sleeve memory. The game API supports both in BN10, so this is an implementation gap.
- **Grafting and infiltration:** The package protects ongoing grafting from resets but does not choose and start grafts. It has no infiltration automation.
- **Singularity-locked play:** Without Singularity access (BN4/SF4), faction work, augmentation purchases/installs, and BitNode progression need manual actions. Other managers can still run when their own unlocks are met.
- **Setup and choices:** You still need to import the scripts, start `autopilot.js`, and review darknet candidate words. Review autopilot's automatic augmentation and BitNode reset options before running unattended.

## Files

- `bitburner-scripts/` — complete script collection, including the added managers.
- `bitburner-scripts/darknet-passwords.txt` — optional known credential list.
- `bitburner-scripts/darknet-candidates.txt` — exact candidate words tried against visible servers.
- `bitburner-src-dev.zip` was used only as an API reference and is not included in the output bundle.

The supplied upstream collection is maintained at [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts). Its original README and license are included.
