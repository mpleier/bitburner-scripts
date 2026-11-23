export async function main(ns) {
  ns.disableLog('ALL');
  const host = 'darkweb';
  const out = { at: Date.now(), host, copied: {}, pid: 0, killed: null, error: '' };
  try {
    out.copied.probe = await ns.scp('dw-probe-neighbours.js', host, 'home');
    out.copied.connector = await ns.scp('darknet-labyrinth-connector.js', host, 'home');
    // darkweb's 16 GB is almost entirely occupied by Dark Net workers. Kill
    // them from home (where RAM is plentiful) instead of launching a RAM-heavy
    // cleanup script on the cramped darkweb host.
    const workers = ns.ps(host).filter((p) => /^(darknet-|stasis-|dw-)/.test(p.filename));
    out.killed = workers.map((p) => ({ filename: p.filename, args: (p.args || []).map(String), threads: p.threads, pid: p.pid }));
    for (const p of workers) {
      try { ns.kill(p.pid); } catch (e) { out.error += ' kill ' + p.filename + ': ' + String(e); }
    }
    await ns.sleep(500);
    await ns.write('tasks/dw-killed-procs.json', JSON.stringify({ at: Date.now(), host, killed: out.killed }), 'w');
  } catch (e) { out.error = String(e); }
  await ns.write('tasks/dw-darkweb-prep.json', JSON.stringify(out), 'w');
  ns.tprint('DW_PREP killed=' + out.killed.length + ' ' + out.error);
}
