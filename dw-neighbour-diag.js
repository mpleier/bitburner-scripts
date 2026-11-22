/** Report darkweb-neighbour session state without printing any credential value. */
export async function main(ns) {
  ns.disableLog('ALL');
  const out = [];
  const creds = new Map();
  try {
    for (const row of JSON.parse(ns.read('tasks/credentials-home.json')).entries || []) {
      if (Array.isArray(row) && typeof row[1] === 'string') creds.set(row[0], row[1].length);
    }
  } catch (e) { out.push({ error: 'creds: ' + String(e) }); }
  let neighbours = [];
  try { neighbours = ns.dnet.probe(); } catch (e) { out.push({ error: 'probe: ' + String(e) }); }
  for (const host of neighbours) {
    const entry = { host, savedLen: creds.has(host) ? creds.get(host) : null };
    try {
      const d = ns.dnet.getServerDetails(host) || {};
      entry.online = d.isOnline;
      entry.pwdLen = d.passwordLength;
      entry.hint = d.passwordHint;
      entry.model = d.modelId;
      entry.hasSession = d.hasSession;
    } catch (e) { entry.detailError = String(e); }
    out.push(entry);
  }
  await ns.write('tasks/dw-neighbour-diag.json', JSON.stringify(out), 'w');
}
