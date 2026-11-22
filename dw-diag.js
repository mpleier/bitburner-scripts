export async function main(ns) {
  ns.disableLog('ALL');
  const out = { host: ns.getHostname(), at: Date.now(), stage: 'start' };
  await ns.write('tasks/dw-diag.json', JSON.stringify(out), 'w');
  try { out.links = ns.dnet.getStasisLinkedServers(); } catch (e) { out.linksErr = String(e); }
  out.stage = 'links'; await ns.write('tasks/dw-diag.json', JSON.stringify(out), 'w');
  try { out.limit = ns.dnet.getStasisLinkLimit(); } catch (e) { out.limitErr = String(e); }
  out.stage = 'limit'; await ns.write('tasks/dw-diag.json', JSON.stringify(out), 'w');
  try { out.ps = ns.ps(ns.getHostname()).map((p) => ({ f: p.filename, pid: p.pid, t: p.threads })); } catch (e) { out.psErr = String(e); }
  out.stage = 'done'; await ns.write('tasks/dw-diag.json', JSON.stringify(out), 'w');
}
