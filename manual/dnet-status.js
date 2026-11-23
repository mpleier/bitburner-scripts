/** @param {NS} ns */
export async function main(ns) {
  const host = ns.getHostname();
  const out = { at: Date.now(), host };
  const t = (label, fn) => { try { out[label] = fn(); } catch (e) { out[label + 'Err'] = String(e); } };
  t('probe', () => ns.dnet.probe());
  t('links', () => ns.dnet.getStasisLinkedServers());
  t('limit', () => ns.dnet.getStasisLinkLimit());
  t('caches', () => ns.ls(host, '.cache'));
  t('clientCaches', () => ns.ls('home', '.cache'));
  t('myDetails', () => ns.dnet.getServerDetails());
  await ns.write('tasks/dnet-status-' + host + '.json', JSON.stringify(out), 'w');
  ns.tprint('DNET_STATUS ' + JSON.stringify(out));
}
