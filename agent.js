/**
 * Bitburner-side WebSocket agent for pc-controller/pc.js.
 * Run on home with: run agent.js
 * The PC controller only binds to localhost.
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const twins = ns.ps("home").filter(p => p.filename === "agent.js" && p.pid !== ns.pid);
  if (twins.length) {
    ns.tprint("Another PC agent.js is already running on home; stopping this copy.");
    return;
  }

  const URL = "ws://127.0.0.1:12525";
  const RESULT_FILE = "tasks/__result.json";
  const MAX_TASK_MS = 270000;
  const queue = [];
  const socketEvents = [];
  let socket = null;
  let socketStartedAt = 0;
  let nextConnectAt = 0;
  let greetedSocket = null;
  let observedSocket = null;
  let observedState = -1;
  let connectionAttempts = 0;
  const stateNames = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];

  ns.tprint(`PC agent starting (pid ${ns.pid}); connecting to ${URL}`);

  if (typeof WebSocket !== "function") {
    ns.tprint("PC agent cannot start: this Bitburner runtime does not expose WebSocket.");
    return;
  }

  function send(data) {
    try {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(data));
      return true;
    } catch {}
    return false;
  }

  function connect() {
    connectionAttempts++;
    try {
      const ws = new WebSocket(URL);
      socket = ws;
      socketStartedAt = Date.now();
      observedSocket = null;
      observedState = -1;
      // Event handlers only enqueue data. All Netscript calls stay in the
      // main loop, avoiding concurrent API calls from browser callbacks.
      ws.onmessage = event => socketEvents.push({ type: "message", ws, data: event.data });
      ws.onerror = () => socketEvents.push({ type: "error", ws });
      ws.onclose = () => socketEvents.push({ type: "close", ws });
    } catch (error) {
      if (connectionAttempts === 1 || connectionAttempts % 10 === 0)
        ns.tprint(`PC agent WebSocket creation failed (attempt ${connectionAttempts}): ${error?.message || error}`);
      socket = null;
      nextConnectAt = Date.now() + 3000;
    }
  }

  async function runCommand(message) {
    const { id, source, host = "home", threads = 1, args = [] } = message;
    const taskFile = `__pc_agent_task_${ns.pid}_${id}.js`;
    let error = null;
    let result;
    let pid = 0;
    try {
      if (host !== "home" && !ns.hasRootAccess(host)) throw new Error(`No root access on ${host}`);
      ns.rm(taskFile, "home");
      ns.rm(RESULT_FILE, "home");
      await ns.write(taskFile, source, "w");

      if (host !== "home") {
        const copied = await ns.scp(taskFile, host, "home");
        if (!copied) throw new Error(`Could not copy generated task to ${host}`);
        ns.rm(RESULT_FILE, host);
      }

      pid = ns.exec(taskFile, host, { threads: Math.max(1, Number(threads) || 1) }, ...args);
      if (!pid) throw new Error(`Could not start generated task on ${host}; check free RAM`);

      const started = Date.now();
      while (ns.isRunning(taskFile, host, ...args)) {
        if (Date.now() - started > MAX_TASK_MS) {
          ns.kill(pid, host);
          throw new Error(`Generated task timed out on ${host}`);
        }
        await ns.sleep(100);
      }

      if (host !== "home") {
        const copied = await ns.scp(RESULT_FILE, "home", host);
        if (!copied) throw new Error(`Task finished on ${host} but its result could not be copied home`);
      }
      const raw = ns.read(RESULT_FILE);
      if (!raw) throw new Error(`Generated task on ${host} exited without writing a result`);
      const packet = JSON.parse(raw);
      result = packet.result;
      error = packet.error || null;
    } catch (cause) {
      error = cause?.message || String(cause);
    } finally {
      try { ns.rm(taskFile, host); } catch {}
      try { ns.rm(taskFile, "home"); } catch {}
      if (host !== "home") { try { ns.rm(RESULT_FILE, host); } catch {} }
      try { ns.rm(RESULT_FILE, "home"); } catch {}
    }

    const sent = send({ id, result, error });
    if (error) ns.print(`pc.js command ${id} failed: ${error}`);
    else ns.print(`pc.js command ${id} completed.`);
    if (!sent) ns.print(`pc.js command ${id} result could not be sent because the socket is not open.`);
  }

  connect();
  while (true) {
    await ns.sleep(250);

    for (const event of socketEvents.splice(0)) {
      if (event.ws !== socket) continue;
      if (event.type === "message") {
        let message;
        try { message = JSON.parse(event.data); } catch { continue; }
        if (!message || !Number.isInteger(message.id) || typeof message.source !== "string") continue;
        ns.print(`pc.js command ${message.id} received (${message.source.length} chars).`);
        queue.push(message);
      } else if (event.type === "error") {
        ns.tprint(`PC agent WebSocket error; will retry in 3 seconds. Check pc.js at ${URL}.`);
        try { event.ws.close(); } catch {}
        socket = null;
        greetedSocket = null;
        nextConnectAt = Date.now() + 3000;
      } else if (event.type === "close") {
        ns.tprint("PC agent disconnected; retrying in 3 seconds.");
        socket = null;
        greetedSocket = null;
        nextConnectAt = Date.now() + 3000;
      }
    }

    const ws = socket;
    if (ws) {
      const state = ws.readyState;
      if (ws !== observedSocket || state !== observedState) {
        ns.tprint(`PC agent WebSocket state: ${stateNames[state] || `UNKNOWN (${state})`}`);
        observedSocket = ws;
        observedState = state;
      }

      if (state === WebSocket.OPEN && greetedSocket !== ws) {
        if (send({ type: "hello", role: "pc-agent", host: ns.getHostname(), pid: ns.pid })) {
          greetedSocket = ws;
          ns.tprint(`PC agent connected to ${URL}; waiting for pc.js commands.`);
        }
      } else if (state === 0 && Date.now() - socketStartedAt >= 5000) {
        ns.tprint(`PC agent connection timed out after 5 seconds (WebSocket state ${state}).`);
        try { ws.close(); } catch {}
        socket = null;
        greetedSocket = null;
        nextConnectAt = Date.now() + 3000;
      } else if (state >= 2) {
        socket = null;
        greetedSocket = null;
        nextConnectAt = Date.now() + 3000;
      }
    }

    if (!socket && Date.now() >= nextConnectAt) connect();
    if (socket?.readyState === WebSocket.OPEN && queue.length) await runCommand(queue.shift());
  }
}
