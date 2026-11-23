export async function main(ns) {
  const arg = typeof ns.args[0] === 'string' ? JSON.parse(ns.args[0]) : {};
  const host = arg.host || ns.getHostname();
  const pids = (arg.pids || []).map(Number).filter(Number.isFinite);
  const out = pids.map((pid) => {
    try { return { pid, killed: ns.kill(pid, host) }; }
    catch (e) { return { pid, error: String(e) }; }
  });
  let launched = null;
  if (arg.then && arg.then.script) {
    try {
      const t = arg.then;
      launched = { pid: ns.exec(t.script, t.host || host, t.threads || 1, ...(t.args || [])), script: t.script, host: t.host || host };
    } catch (e) { launched = { error: String(e) }; }
  }
  await ns.write('tasks/dw-kill-pids.json', JSON.stringify({ at: Date.now(), host, out, launched }), 'w');
}
