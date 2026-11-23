export async function main(ns) {
  const host = ns.args[0] || 'smar7_d00rbell';
  const target = 'ub3r_l4byr1nth';
  const history = [];
  const stage = (s, extra) => { history.push({ host, stage: s, at: Date.now(), ...(extra || {}) }); return ns.write('tasks/dw-probe-stages.json', JSON.stringify(history), 'w'); };
  await stage('start');
  try {
    const entries = JSON.parse(ns.read('tasks/credentials-home.json')).entries || [];
    const hit = entries.find((e) => Array.isArray(e) && e[0] === host);
    await stage('creds', { pwLen: hit ? hit[1].length : -1 });
    const det = ns.dnet.getServerDetails(host) || {};
    await stage('details', { hasSession: det.hasSession, pwdLen: det.passwordLength, hint: det.passwordHint, format: det.passwordFormat, model: det.modelId, online: det.isOnline, stationary: det.isStationary });
    if (!(det && det.hasSession)) {
      for (const pw of [hit ? hit[1] : null, '']) {
        if (typeof pw !== 'string') continue;
        const r = await ns.dnet.connectToSession(host, pw);
        await stage('connect', { pwLen: pw.length, success: r && r.success, message: r && r.message });
        if (r && r.success) break;
      }
    }
    await stage('ram', { used: ns.getServerUsedRam(host), max: ns.getServerMaxRam(host), free: ns.getServerMaxRam(host) - ns.getServerUsedRam(host) });
    const copy = await ns.scp('dw-probe-neighbours.js', host, 'home');
    await stage('copy', { copy, exists: ns.fileExists('dw-probe-neighbours.js', host) });
    await stage('scriptRam', { ram: ns.getScriptRam('dw-probe-neighbours.js', host) });
    try { ns.rm('tasks/dw-adj-report.json', host); } catch (e) { await stage('rmErr', { err: String(e) }); }
    const pid = ns.exec('dw-probe-neighbours.js', host, 1, target);
    await stage('exec', { pid });
    for (let i = 0; i < 20 && !ns.fileExists('tasks/dw-adj-report.json', host); i++) await ns.sleep(250);
    const exists = ns.fileExists('tasks/dw-adj-report.json', host);
    await stage('poll', { exists });
    if (exists) {
      await ns.scp('tasks/dw-adj-report.json', 'home', host);
      await stage('report', { report: JSON.parse(ns.read('tasks/dw-adj-report.json')) });
    }
    await stage('done');
  } catch (e) {
    await stage('fatal', { err: String(e), stack: e && e.stack });
  }
}
