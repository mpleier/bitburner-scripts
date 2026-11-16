# Connecting to Bitburner Remote API

This repository contains Bitburner automation scripts plus the local Remote API client that deploys
them into the game and drives it from the command line.

Direction matters: the **local listener is the WebSocket server**, and the **game connects out to it**.
The game exposes no API port of its own to poll.

## 1. Start the game and the listener
The game is the Bitburner desktop/Steam build. The listener lives at
`C:/Users/mplei/Documents/Codex/bitburner-remote-api/`:

```
node listener.cjs
```

Only one process can hold the port, so check before starting another:

```
netstat -ano | grep 12525      # expect LISTENING plus an ESTABLISHED pair
cat status.json                # state / connected / workerOnline
```

## 2. Configure In-Game Remote API
In your Bitburner game, go to Options -> Remote API:
- Hostname: `127.0.0.1`
- Port: `12525` (from config.json)
- Use wss: `off`
- Reconnection delay: `2 seconds` — the game owns reconnection

A healthy connect appends `connect from <addr>` to `listener-events.log` and flips `status.json` to
`"state":"synced","connected":true`.

## 3. Set Up Local Tool
The command channel needs `remote-api-agent.js` running on your in-game home server:
```
run remote-api-agent.js
```

`status.json` reports `workerOnline` and `workerPid` from the worker heartbeat. Without it, commands
queue as `waiting-for-worker` and never execute. The autopilot maintains the worker after normal
restarts when RAM allows.

## 4. Use Control Commands
From the local Codex folder, run commands like:
```
node control.cjs getPlayer --wait 30
node control.cjs start '["corporation-manager.js"]' --wait 30
node control.cjs stop '["darknet-manager.js"]' --wait 30
node control.cjs automation.status --wait 30
node control.cjs --status <commandId> --wait 30
```

Receipt states are `completed`, `failed` (with `error`) and `uncertain` (outcome unknown — never
replayed). Requests expire after five minutes; results are also written to `results/<id>.json`.

Methods are whitelisted by `remote-api-command-policy.js` in this repository. Queries cover player,
servers, gang, corporation, sleeves, bladeburner, singularity and cloud; writes are limited to
`start`/`stop` of manifest entrypoints. Arbitrary code, purchases, resets and deletions are rejected
by design.

## 5. Deployment
The listener uploads this repository's deployable files (`.js`, `.ns`, `.script`) into the game on
save, audits them once a minute, and keeps replaced versions in `backups/`. Markdown docs, `tests/`,
`tasks/`, `pc-controller/` and dotfiles are never deployed.