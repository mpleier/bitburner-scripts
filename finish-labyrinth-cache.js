/** @param {NS} ns */
export async function main(ns) {
  const out = { at: Date.now(), hosts: [] };
  let creds = [];
  try {
    creds = (JSON.parse(ns.read('tasks/credentials-home.json')).entries || [])
      .filter((e) => /l4byr1nth$/i.test(e[0] || ''));
  } catch (e) { out.credErr = String(e); }

  for (const [host, password] of creds) {
    const rec = { host };
    try {
      const sess = ns.dnet.connectToSession(host, password);
      rec.session = sess;
    } catch (e) { rec.sessionErr = String(e); out.hosts.push(rec); continue; }
    try { rec.copied = await ns.scp('labyrinth-cache-open.js', host, 'home'); }
    catch (e) { rec.copyErr = String(e); }
    try { rec.pid = ns.exec('labyrinth-cache-open.js', host, 1); }
    catch (e) { rec.execErr = String(e); out.hosts.push(rec); continue; }
    out.hosts.push(rec);
    for (let i = 0; i < 30; i++) {
      await ns.sleep(500);
      if (ns.fileExists('labyrinth-cache-open-result.json', host)) {
        try {
          await ns.scp('labyrinth-cache-open-result.json', 'home', host);
          rec.result = JSON.parse(ns.read('labyrinth-cache-open-result.json'));
        } catch (e) { rec.resultErr = String(e); }
        break;
      }
    }
    if (!rec.result) rec.noResult = true;
  }
  await ns.write('tasks/labyrinth-cache-finish.json', JSON.stringify(out), 'w');
  ns.tprint('LAB_CACHE_FINISH ' + JSON.stringify(out));
}
