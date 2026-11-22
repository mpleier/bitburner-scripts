export async function main(ns) {
  await ns.write('tasks/dw-probe-start.json', '{"stage":"start"}', 'w');
  try {
  const host = ns.args[0] || 'smar7_d00rbell';
  const target = ns.args[1] || 'ub3r_l4byr1nth';
  const out = { host, target };
  const entries = JSON.parse(ns.read('tasks/credentials-home.json')).entries || [];
  const hit = entries.find((e) => Array.isArray(e) && e[0] === host);
  const d = ns.dnet.getServerDetails(host);
  out.details = d && { hostname: d.hostname, passwordLength: d.passwordLength, hasSession: d.hasSession, requiredCharismaSkill: d.requiredCharismaSkill, status: d.status };
  for (const pw of [hit ? hit[1] : null, '']) {
    if (typeof pw !== 'string') continue;
    const r = await ns.dnet.connectToSession(host, pw);
    out.connect = { pwLen: pw.length, success: r && r.success, message: r && r.message };
    if (r && r.success) break;
  }
  out.ram = { used: ns.getServerUsedRam(host), max: ns.getServerMaxRam(host) };
  try { out.copy = await ns.scp('dw-probe-neighbours.js', host, 'home'); } catch (e) { out.copyErr = String(e); }
  out.exists = ns.fileExists('dw-probe-neighbours.js', host);
  try { out.scriptRam = ns.getScriptRam('dw-probe-neighbours.js', host); } catch (e) { out.scriptRamErr = String(e); }
  try { ns.rm('tasks/dw-adj-report.json', host); } catch {}
  try { out.pid = ns.exec('dw-probe-neighbours.js', host, 1, target); } catch (e) { out.execErr = String(e); }
  for (let i = 0; i < 20 && !ns.fileExists('tasks/dw-adj-report.json', host); i++) await ns.sleep(250);
  out.reportExists = ns.fileExists('tasks/dw-adj-report.json', host);
  if (out.reportExists) {
    try { out.copyBack = await ns.scp('tasks/dw-adj-report.json', 'home', host); } catch (e) { out.copyBackErr = String(e); }
    try { out.report = JSON.parse(ns.read('tasks/dw-adj-report.json')); } catch (e) { out.readErr = String(e); }
  }
  await ns.write('tasks/dw-probe-debug.json', JSON.stringify(out), 'w');
  ns.tprint('DW_PROBE_DEBUG ' + JSON.stringify({ host, ram: out.ram, pid: out.pid, reportExists: out.reportExists, adjacent: out.report && out.report.adjacent }));
  } catch (e) {
    await ns.write('tasks/dw-probe-debug.json', JSON.stringify({ fatal: String(e), stack: e && e.stack ? String(e.stack) : null }), 'w');
    ns.tprint('DW_PROBE_DEBUG_FATAL ' + String(e));
  }
}
