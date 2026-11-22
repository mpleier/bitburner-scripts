/** @param {NS} ns */
export async function main(ns) {
  const host = ns.getHostname();
  const result = await ns.dnet.setStasisLink(true);
  const report = { host, at: Date.now(), result: result === undefined ? null : result, hasStasisLink: ns.getServer(host).hasStasisLink };
  await ns.write('stasis-link-result.txt', JSON.stringify(report), 'w');
  ns.tprint(`STASIS_LINK ${host} ${JSON.stringify(report)}`);
}
