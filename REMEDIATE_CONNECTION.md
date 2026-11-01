# Remediating Bitburner Remote API Connection

## Current State
From the game UI, I see the following:
- Status: "Reconnecting" 
- Hostname: localhost
- Port: 12525
- Error with websocket ws://localhost:12525

The Bitburner game is attempting to connect to the local Remote API listener at `ws://localhost:12525` but cannot establish a connection.

## Solution

The problem is that the local Remote API listener is not currently running. Here's how to fix it:

### Step 1: Run the Local Listener
Open a terminal/command prompt and navigate to:
```
C:/Users/mplei/Documents/Codex/bitburner-remote-api
```

Then run:
```
node listener.cjs
```

This will start the local WebSocket server on port 12525 that Bitburner can connect to.

### Step 2: Verify Connection
Once the listener is running, the game should show "Connected" status. You may need to restart your Bitburner game if it doesn't automatically reconnect.

## Troubleshooting
If the connection still fails:
1. Check if port 12525 is already in use by another process
2. Ensure Node.js is available on your system with `node --version`
3. Confirm there are no firewall issues blocking localhost connections

## Configuration Verification
The current configuration file (`config.json`) shows the listener should run on:
```
{
  "port": 12525,
  "timeoutMs": 15000,
  ...
}
```

This matches what's being requested by the game.