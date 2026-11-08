/** A BN10 completion that is waiting only on sleeve memory outranks normal spending. */
export const sleeveMemoryPriorityFile = 'tasks/sleeve-memory-priority.json';

export function readSleeveMemoryPriority(ns, reset = ns.getResetInfo(), now = Date.now()) {
  let saved;
  try { saved = JSON.parse(ns.read(sleeveMemoryPriorityFile)); } catch { return null; }
  if (saved?.version !== 1 ||
      saved.nodeReset !== reset?.lastNodeReset ||
      saved.augReset !== reset?.lastAugReset ||
      !Number.isFinite(saved.at) ||
      saved.at > now ||
      now - saved.at > 2 * 60 * 1000 ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= now) return null;
  return saved;
}

export async function writeSleeveMemoryPriority(ns, reset, memories = []) {
  const saved = {version: 1, at: Date.now(), expiresAt: Date.now() + 2 * 60 * 1000,
    nodeReset: reset.lastNodeReset, augReset: reset.lastAugReset, memories};
  await ns.write(sleeveMemoryPriorityFile, JSON.stringify(saved), 'w');
  return saved;
}

export async function clearSleeveMemoryPriority(ns) {
  try { await ns.rm(sleeveMemoryPriorityFile, 'home'); } catch { }
}
