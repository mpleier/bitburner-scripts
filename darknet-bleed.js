/** Threaded darknet heartbleed worker.
 * heartbleed() capture speed scales with script threads, and the scout keeps one thread so the
 * loot helper keeps its RAM. Args: target, options JSON, output file. */
export async function main(ns) {
  const target = String(ns.args[0] || '');
  let options = { peek: true, logsToCapture: 20 };
  try { if (typeof ns.args[1] === 'string' && ns.args[1]) options = { ...options, ...JSON.parse(ns.args[1]) }; } catch { }
  const output = String(ns.args[2] || '');
  let result;
  try { result = await ns.dnet.heartbleed(target, options); }
  catch (error) { result = { success: false, code: 500, message: 'darknet-bleed worker: ' + String(error), logs: [] }; }
  try { await ns.write(output, JSON.stringify(result), 'w'); } catch { /* caller falls back */ }
}
