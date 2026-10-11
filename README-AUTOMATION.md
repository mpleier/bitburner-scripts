# Bitburner Complete Automation

This package combines the supplied Bitburner scripts with corporation and current-version darknet managers. The original script collection is included with its license and subfolders intact; the supplied source folder was left unchanged.

## Install and start

Import the repository's script files and folders into your Bitburner home computer, keeping `Remote/` and `Tasks/` as folders. Use the file sync or editor workflow you normally use. Then start:

```text
run autopilot.js
```

`autopilot.js` starts `daemon.js`, which manages hacking and starts supported managers as their game unlocks and RAM requirements are met. Start the in-game corporation manager manually with `run corporation-manager.js`, or use the optional PC controller described below for PC-side corporation management. The provided autopilot can automatically install augmentations and advance to other BitNodes when its conditions are met; review its options in `autopilot.js` before leaving it unattended.

For PC-side coordination, see [`pc-controller/README.md`](pc-controller/README.md). The PC controller starts hacking/server management and corporation decisions on boot; its darknet autopilot can also be enabled with `dnet-auto`. The in-game [`agent.js`](agent.js) carries out requests. Start the controller and run `agent.js` on home after importing it. Renewable ownership leases let the game daemon yield target scheduling and the game-side corporation manager yield corporation actions while their respective PC loops are active; both game-side systems resume automatically if the PC controller stops renewing the leases. The daemon keeps managing its other in-game helpers and periodic systems while PC owns hacking.

## Added automation

- **Corporation:** In BitNode 3 or with Source-File 3 access, waits until self-funding is allowed, creates Apex Holdings, grows Agriculture across cities, enables Smart Supply when affordable, and then adds a Restaurant product division. It uses cash reserves and incremental expansion thresholds. Start it manually if you want it running outside the daemon's memory threshold.
- **Darknet:** Probes the current network, reports server depth and password hints, attempts to buy TOR and `DarkscapeNavigator.exe` when Singularity access permits, and deploys scouts after authentication. It uses each server's password length and character format to skip impossible supplied guesses, and tries direct hint data when it fits those constraints. Authenticated scouts open cache files, run phishing attempts, reclaim blocked memory, inspect recent logs with non-destructive heartbleed peeks when Charisma allows, and continue probing as the network changes. Scouts at depth 2 or greater claim an available stasis link to keep a deep foothold reachable; the global link limit is respected.
- **Credentials:** The scripts try exact words from `darknet-candidates.txt` and known entries from `darknet-passwords.txt` (`hostname=password`). Successful matches are saved as individual `darknet-passwords-HOST.txt` reports, synchronized back to home by scouts, and propagated to new scouts so one discovery can help the whole network. Do not add credentials you do not want stored in your game save.

The storm-seed executable is never launched. Passwords absent from the candidate list and clue-based variants may still require manual investigation.

## Included systems

The upstream suite provides the main hacking daemon plus helpers for root access and server management, companies and factions, gangs, sleeves, Bladeburner, stocks, Hacknet, Stanek, Go, coding contracts, and augmentation/reset workflows. Mechanics locked behind Source Files, API access, money, or player progress remain idle until they become available.

The corporation manager is based on the supplied optimizer's Agriculture-first, Restaurant-second plan. The source used older method names; this version uses the current API (`purchaseUnlock`, `getUnlockCost`, and `canCreateCorporation(true)`). It has not been run inside a Bitburner save, so check the in-game log on first launch.

## Manual or partial areas

- **Darknet passwords:** The candidate list checks exact supplied words and may take time to exhaust, especially with low Charisma. Heartbleed logs are displayed as clues but are not converted into guessed password variants, and arbitrary passwords are not synthesized. Stock promotion is not automatic because it requires TIX access and a deliberate stock selection. `STORM_SEED.exe` is intentionally never launched; it can catastrophically damage the darknet. The automation also avoids freezing servers because that removes their RAM and experience benefits.
- **Corporations:** Automation is a conservative Agriculture and Restaurant strategy, not a full optimizer. It does not tune boost-material inventories, exports, research, every industry, or all share/dividend actions.
- **Sleeves:** Sleeve tasks and augmentation purchases are managed, but this package does not buy additional sleeves or upgrade sleeve memory. The game API supports both in BN10, so this is an implementation gap.
- **Grafting and infiltration:** The package protects ongoing grafting from resets but does not choose and start grafts. It has no infiltration automation.
- **Singularity-locked play:** Without Singularity access (BN4/SF4), faction work, augmentation purchases/installs, and BitNode progression need manual actions. Other managers can still run when their own unlocks are met.
- **Setup and choices:** You still need to import the scripts, start `autopilot.js` (and the optional PC controller plus `agent.js`, if desired), and review darknet candidate words. Review autopilot's automatic augmentation and BitNode reset options before running unattended.

## Files

- The repository root — Bitburner scripts and the added managers.
- `darknet-passwords.txt` — optional known credential list.
- `darknet-candidates.txt` — exact candidate words tried against visible servers.
- `pc-controller/` — optional Node.js companion and its setup instructions. Its local credential/reward data is ignored by Git.
- `bitburner-src-dev.zip` was used only as an API reference and is not included in the output bundle.

The supplied upstream collection is maintained at [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts). Its original README and license are included.
