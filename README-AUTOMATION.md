# Bitburner Complete Automation

This package combines the supplied Bitburner scripts with corporation and current-version darknet managers. The original script collection is included with its license and subfolders intact; the supplied source folder was left unchanged.

## Install and start

Import the repository's script files and folders into your Bitburner home computer, keeping `Remote/` and `Tasks/` as folders. For PC-controlled automation:

```text
pc-controller\Start.bat
```

Connect Bitburner's **Options → Remote API** to `127.0.0.1:12525`, then run `run agent.js` once on `home`. The Remote API syncs files; `agent.js` is the one-time in-game bridge that lets the PC controller issue Netscript actions. After the bridge connects, `pc.js` automatically starts and supervises the PC hacking/server manager, corporation manager, darknet automation, and `daemon.js` for the remaining game-side helper systems. `daemon.js` yields hacking, corporation, and darknet ownership while the corresponding PC lease is active.

`pc.js` does not start `autopilot.js`. That script has a separate augmentation and BitNode-reset workflow. Keep it stopped unless you intend to use that reset behavior. See [`pc-controller/README.md`](pc-controller/README.md) for controller commands and connection details.

## Added automation

- **Corporation:** In BitNode 3 or with Source-File 3 access, waits until self-funding is allowed, creates Apex Holdings, grows Agriculture across cities, enables Smart Supply when affordable, and then adds a Restaurant product division. It uses cash reserves and incremental expansion thresholds. `pc.js` makes the decisions and applies them through the agent.
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
- **Setup and choices:** You need to import the scripts, start `pc-controller/Start.bat`, connect the Remote API, and run `agent.js` once. Review the darknet candidate words. The PC controller does not install augmentations or reset BitNodes automatically.

## Files

- The repository root — Bitburner scripts and the added managers.
- `darknet-passwords.txt` — optional known credential list.
- `darknet-candidates.txt` — exact candidate words tried against visible servers.
- `pc-controller/` — optional Node.js companion and its setup instructions. Its local credential/reward data is ignored by Git.
- `bitburner-src-dev.zip` was used only as an API reference and is not included in the output bundle.

The supplied upstream collection is maintained at [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts). Its original README and license are included.
