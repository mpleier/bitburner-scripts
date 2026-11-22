export async function main(ns) {
  const files = ['dw-probe-neighbours.js', 'darknet-labyrinth-connector.js', 'darknet-stasis-link.js', 'darknet-adjacent.js', 'dw-auth-exec.js', 'dw-find-path.js', 'dw-open-session.js', 'darknet-scan.js', 'darknet-coverage.js', 'darknet-crawler.js', 'darknet-node.js', 'darknet-promote.js', 'darknet-loot.js'];
  const hosts = ['darkweb','An0r_L0nd0','ultra^org','revres_x0lp','arcade','smart_fridge','by7e_corp','acissej:citadel','zer0_day&🅱️lade','11gh7-sys7ems','dark-citadel','granny-s:net','hyper:matrix:3183','🅱️i7@solu7ions','nitesec','iker_molina_casino.systems','granny-s::industries','cell::citadel'];
  const results = [];
  for (const host of hosts) {
    const row = { host, ok: {}, err: {} };
    for (const file of files) {
      try {
        const ok = await ns.scp(file, host);
        row.ok[file] = ok;
      } catch (e) { row.err[file] = String(e); }
    }
    results.push(row);
  }
  await ns.write('tasks/dw-sync-files.json', JSON.stringify({ at: Date.now(), results }), 'w');
}
