# Optional PC controller

This folder contains the Node.js companion that handles PC-side hacking/server planning and corporation decisions, supports PC-side darknet automation, and coordinates game actions through `agent.js`.

## Setup

1. Install Node.js, then launch `Start.bat`. It installs the locked dependencies on first run and starts the controller.
2. Alternatively, run `npm ci` once in this folder, then use `npm start`.
3. Run `Stop.bat` to stop the controller started from this folder.
4. In Bitburner, open Options → Remote API and connect to `127.0.0.1:12525`. The controller syncs the repository's game JavaScript files and `darknet-candidates.txt` to home when the Remote API connects. The API does not start scripts, so run `run agent.js` once in the Bitburner terminal to enable PC-controlled actions.
5. Keep the controller running while playing. Hacking/server management and corporation automation start on controller boot by default; `auto` and `corp-auto` toggle those loops. While PC hacking is active, it renews a game-side lease so `daemon.js` skips only its own target scheduling and purchased-server helper, while continuing other helpers and periodic managers. The game daemon resumes target scheduling and its server helper automatically if the PC controller disconnects or stops renewing its lease. Corporation ownership uses a separate lease in the same way. The game darknet manager remains part of daemon automation; use `dnet-auto` to additionally enable PC-side darknet management.

The controller binds only to `127.0.0.1:12525`. Stop any other local Bitburner bridge that uses this port before starting it. It reads the repository-root `darknet-candidates.txt`; edit that shared list to add exact candidate words for both the in-game and PC-side managers.

`darknet_pw.json` and `dnet_rewards.json` are created locally as needed and ignored by Git because they can contain credentials or play-specific data. Ollama integration is optional.
