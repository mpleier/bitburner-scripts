/** Ensure this darknet server keeps a stasis link and report its state. */
export async function main(ns) {
  const out = { at: Date.now(), host: ns.getHostname() };
  try {
    out.before = { links: ns.dnet.getStasisLinkedServers(), limit: ns.dnet.getStasisLinkLimit() };
    if (!out.before.links.includes(out.host)) {
      out.result = await ns.dnet.setStasisLink(true);
    }
    out.after = { links: ns.dnet.getStasisLinkedServers(), limit: ns.dnet.getStasisLinkLimit() };
  } catch (e) { out.err = String(e); }
  try { out.probe = ns.dnet.probe(); } catch (e) { out.probeErr = String(e); }
  await ns.write('tasks/dw-stasis-report.json', JSON.stringify(out), 'w');
  try { await ns.scp('tasks/dw-stasis-report.json', 'home', out.host); } catch (e) { out.scpErr = String(e); }
  ns.tprint('DW_STASIS ' + JSON.stringify(out));
}
