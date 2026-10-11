# PC-controlled Bitburner automation

`pc.js` is the top-level automation controller. It makes the hacking, server, corporation, and darknet decisions on the PC, and starts `daemon.js` to manage the game's other helper systems as they unlock. The game scripts are workers because Bitburner exposes Netscript actions through its in-game runtime; the Remote API only syncs files.

## Start once

1. Run `Start.bat` from this folder. It installs the locked Node.js dependency if needed and starts `pc.js`.
2. In Bitburner, open **Options → Remote API** and connect to `127.0.0.1:12525`. The controller syncs game scripts to `home`.
3. In the Bitburner terminal, run `run agent.js` once. This small bridge lets `pc.js` issue Netscript actions. It reconnects automatically after a PC controller restart while the agent remains running.

After the agent connects, `pc.js` automatically starts hacking/server management, corporation management, darknet automation, and the game-side `daemon.js` helper suite. The game daemon defers hacking, corporation, and darknet ownership to the PC while their renewable leases are active, so those systems are not managed twice. The PC controller checks `daemon.js` periodically and starts it again if it exits.

The controller does not launch `autopilot.js`. That script has its own augmentation installation and BitNode-reset workflow. Start it separately only when you explicitly want that progression behavior.

## Controller commands

- `status` — show Remote API and agent connectivity plus the automation loop states.
- `all-auto` — start or stop the full PC-managed suite, including the game-side manager processes.
- `auto` — toggle PC hacking/server management.
- `corp-auto` / `corp-stop` — start or stop PC corporation management.
- `dnet-auto` — toggle PC darknet management.
- `game-suite` — ensure `daemon.js` is running under PC supervision.
- `sync` — sync repository scripts through the Remote API.
- `help` — list the other controller commands.

The corporation manager keeps the Agriculture-to-Restaurant growth plan, reserves cash before purchases, and places product sale orders only after product development reaches 100% and only in cities where the division operates. The same completion check is used by the game-side fallback manager.

`Stop.bat` stops the PC controller. Its leases expire automatically; the game daemon can then resume the game-side hacking, corporation, and darknet managers. Long-running worker processes already launched by the game may finish their current work.

The controller binds only to `127.0.0.1:12525`; stop another local bridge using that port before starting it. `darknet_pw.json` and `dnet_rewards.json` are local play data and remain ignored by Git. Ollama integration is optional.
