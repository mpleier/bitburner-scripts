export async function main(ns) {
  ns.disableLog('ALL');
  const report = JSON.parse(ns.read('tasks/dw-killed-procs.json'));
  const host = report.host || 'darkweb';
  const restored = [];
  for (const p of report.killed || []) {
    if (!p?.filename || p.filename === 'dw-free-ram.js') continue;
    try {
      const pid = ns.exec(p.filename, host, p.threads || 1, ...(p.args || []).map(String));
      restored.push({ filename: p.filename, pid, args: p.args || [], threads: p.threads || 1 });
    } catch (e) { restored.push({ filename: p.filename, error: String(e) }); }
  }
  await ns.write('tasks/dw-darkweb-restore.json', JSON.stringify({ at: Date.now(), host, restored }), 'w');
  ns.tprint('DW_RESTORE ' + restored.length + '/' + (report.killed || []).length);
}
