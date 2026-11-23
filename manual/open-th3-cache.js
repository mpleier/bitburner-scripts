/** Open the stranded Labyrinth cache from home using the saved session credential. */
export async function main(ns) {
  const target = ns.args[0] || 'th3_l4byr1nth';
  const out = { at: Date.now(), target, steps: [] };
  const note = (s) => { out.steps.push(s); ns.tprint('TH3_CACHE ' + s); };
  try {
    const creds = JSON.parse(ns.read('tasks/credentials-home.json'));
    const src = Array.isArray(creds) ? creds : (creds.entries || creds.credentials || creds.creds || []);
    const entry = src.find((e) => e && (e.host === target || e.server === target || e[0] === target || String(e.hostname || '').includes('l4byr1nth')));
    if (!entry) { note('NO_CRED'); }
    else {
      const pass = Array.isArray(entry) ? entry[1] : (entry.password || entry.pass);
      note('connect ' + JSON.stringify(await ns.dnet.connectToSession(target, pass)));
      note('session ' + JSON.stringify(ns.dnet.getServerDetails(target).hasSession));
      const files = ns.ls(target, '.cache');
      out.files = files;
      note('caches ' + JSON.stringify(files));
      for (const f of files) {
        try { note('open ' + f + ' -> ' + JSON.stringify(await ns.dnet.openCache(f, true))); }
        catch (e) { note('open err ' + f + ' ' + String(e)); }
      }
    }
  } catch (e) { note('FATAL ' + String(e)); }
  await ns.write('tasks/th3-cache-open.json', JSON.stringify(out), 'w');
}
