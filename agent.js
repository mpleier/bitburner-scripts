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
  let socket = null;
  let reconnectTimer = null;
  let pumping = false;
  let stopped = false;

  function send(data) {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
    } catch {}
  }

  function connect() {
    if (stopped) return;
    try {
      socket = new WebSocket(URL);
    } catch {
      reconnectTimer = setTimeout(connect, 3000);
      return;
    }

    socket.onopen = () => send({
      type: "hello", role: "pc-agent", host: ns.getHostname(), pid: ns.pid,
    });

    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || !Number.isInteger(message.id) || typeof message.source !== "string") return;
      queue.push(message);
      void pumpQueue();
    };

    socket.onclose = () => {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close(); } catch {}
      }
      socket = null;
      if (!stopped) reconnectTimer = setTimeout(connect, 3000);
    };

    socket.onerror = () => {};
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

    send({ id, result, error });
  }

  async function pumpQueue() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && !stopped) await runCommand(queue.shift());
    } finally {
      pumping = false;
      if (queue.length && !stopped) void pumpQueue();
    }
  }

  connect();
  while (true) await ns.sleep(1000);
}
