/** Test probe signature and labyrinth adjacency from home. */
export async function main(ns) {
  const out = { at: Date.now(), host: ns.getHostname() };
  try { out.probe0 = ns.dnet.probe(); } catch (e) { out.probe0err = String(e); }
  try { out.probeHost = ns.dnet.probe('th3_l4byr1nth'); } catch (e) { out.probeHostErr = String(e); }
  try { out.details = ns.dnet.getServerDetails('th3_l4byr1nth'); } catch (e) { out.detailsErr = String(e); }
  await ns.write('tasks/probe-signature.json', JSON.stringify(out), 'w');
}
