/** Pin darkweb itself so home can always exec there, regardless of darknet mutations. */
export async function main(ns) {
  const host = ns.getHostname();
  let result = null, error = null;
  try { result = await ns.dnet.setStasisLink(true); } catch (e) { error = String(e); }
  await ns.write('tasks/dw-stasis.json', JSON.stringify({ at: Date.now(), host: host, result: result, error: error }), 'w');
}
