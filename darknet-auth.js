/** Threaded darknet authentication worker.
 * authenticate() completes faster with more script threads, and the speed is the calling
 * script's thread count. The scout keeps one thread so the loot helper keeps its RAM, so it
 * borrows this worker with the threads its free RAM can support.
 * Args: target, password or a JSON array of passwords, output file. The result is written there
 * because a child cannot return a value. A batch is tried in order within a single launch, which
 * removes one exec/file handoff per candidate. The granted session belongs to this worker, so the
 * scout re-authenticates (or calls connectToSession) when a password turns out to be correct. */
export async function main(ns) {
  const target = String(ns.args[0] || '');
  const raw = String(ns.args[1] ?? '');
  const output = String(ns.args[2] || '');
  let candidates = [raw];
  if (raw.trim().startsWith('[')) {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length) candidates = parsed.map(value => String(value)); } catch { candidates = [raw]; }
  }
  let result = null;
  let tried = 0;
  for (const password of candidates) {
    tried++;
    try { result = await ns.dnet.authenticate(target, password); }
    catch (error) { result = { success: false, code: 500, message: 'darknet-auth worker: ' + String(error) }; }
    if (result?.success) { result = { ...result, password }; break; }
    // A non-auth failure (timeout, lost access) must stop the batch so the scout can react.
    if (Number(result?.code) !== 401) break;
  }
  const payload = { ...(result || { success: false, code: 500 }), tried, candidates: candidates.length };
  try { await ns.write(output, JSON.stringify(payload), 'w'); } catch { /* caller falls back */ }
}
