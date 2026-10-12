/**
 * One-shot: stasis-links the server this runs on, so it can't move or go
 * offline and stays reachable from a distance. setStasisLink costs 12 GB of
 * RAM, so it lives in its own script and exits as soon as it is done.
 */
export async function main(ns) {
  const self = ns.getHostname();
  const linked = ns.dnet.getStasisLinkedServers();
  const limit = ns.dnet.getStasisLinkLimit();
  if (linked.includes(self)) return;
  if (linked.length >= limit) {
    ns.print(`${self}: stasis link limit reached (${linked.length}/${limit}).`);
    return;
  }
  const result = await ns.dnet.setStasisLink(true);
  const after = ns.dnet.getStasisLinkedServers();
  ns.tprint(`${self}: stasis link ${result?.success ? "set" : `not set (${result?.code}: ${result?.message})`} (${after.length}/${limit}).`);
}
