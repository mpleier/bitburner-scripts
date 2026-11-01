# Connecting to Bitburner Remote API

This repository contains Bitburner automation scripts and a local Remote API client.
To connect your Bitburner game to this environment:

## 1. Start Bitburner Game
First ensure the Bitburner game is running. It should be accessible at http://localhost:3000 (or other port if custom dev server).

## 2. Configure In-Game Remote API
In your Bitburner game, go to Options -> Remote API:
- Hostname: `127.0.0.1`
- Port: `12525` (from config.json)
- Use wss: `off` (or `on` if using HTTPS)
- Reconnection delay: `2 seconds`

## 3. Set Up Local Tool
The local connection tool is at:
`C:/Users/mplei/Documents/Codex/bitburner-remote-api/`

Ensure `remote-api-agent.js` is running on your in-game home server:
```
run remote-api-agent.js
```

## 4. Use Control Commands
From the local Codex folder, run commands like:
```
node control.cjs status --wait 30
node control.cjs start '["corporation-manager.js"]' --wait 30
node control.cjs stop '["darknet-manager.js"]' --wait 30
```

## 5. Required Setup
Ensure the `remote-api-agent.js` script is in your game's home server (it should be part of this repo).
The local tool will connect to your in-game setup via WebSocket at port 12525.