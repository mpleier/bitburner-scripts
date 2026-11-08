/** Cash from the 10b casino win is reserved for the first augmentation basket. */
export const casinoWindfallFile = 'tasks/casino-augmentation-windfall.json';
export const casinoWindfallAmount = 1e10;
export const casinoWindfallMaxAgeMs = 2 * 60 * 60 * 1000;

export function casinoWindfallState(ns, reset = ns.getResetInfo(), now = Date.now()) {
  let saved;
  try { saved = JSON.parse(ns.read(casinoWindfallFile)); } catch { return null; }
  if (saved?.version !== 1 ||
      saved.nodeReset !== reset?.lastNodeReset ||
      saved.augReset !== reset?.lastAugReset ||
      !Number.isFinite(saved.at) ||
      saved.at > now ||
      now - saved.at > casinoWindfallMaxAgeMs ||
      !Number.isFinite(saved.amount) ||
      saved.amount <= 0) return null;
  const amount = Math.min(saved.amount, Math.max(0, Number(ns.getPlayer().money) || 0));
  return amount > 0 ? {...saved, amount} : null;
}

export async function recordCasinoWindfall(ns, reset, earnings) {
  const amount = Math.min(casinoWindfallAmount, Math.max(0, Number(earnings) || 0));
  if (!(amount > 0)) return null;
  const saved = {version: 1, at: Date.now(), nodeReset: reset.lastNodeReset, augReset: reset.lastAugReset, amount};
  await ns.write(casinoWindfallFile, JSON.stringify(saved), 'w');
  return saved;
}
