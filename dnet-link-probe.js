/** @param {NS} ns */
export async function main(ns) {
  const target = 'th3_l4byr1nth';
  const out = { at: Date.now(), host: ns.getHostname(), probe: [], details: null, linked: null, limit: null, sessions: [], error: null };
  try { out.probe = ns.dnet.probe(); } catch (e) { out.error = 'probe: ' + String(e); }
  try { out.details = ns.dnet.getServerDetails(target); } catch (e) { out.error += ' details: ' + String(e); }
  try { out.linked = ns.dnet.getStasisLinkedServers(); out.limit = ns.dnet.getStasisLinkLimit(); } catch (e) { out.error += ' stasis: ' + String(e); }
  await ns.write('tasks/dnet-link-probe.json', JSON.stringify(out), 'w');
}
