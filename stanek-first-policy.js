/** Stanek's Gift must be accepted before any non-NeuroFlux augmentation is purchased. */
export const stanekGiftName = "Stanek's Gift - Genesis";
export const neuroFluxName = 'NeuroFlux Governor';

export function stanekFirstState(ns) {
  const reset = ns.getResetInfo();
  const sf13 = Number(reset?.ownedSF?.[13] ?? reset?.ownedSF?.get?.(13) ?? 0);
  if (reset.currentNode === 8)
    return {eligible: false, installed: false, canAccept: false, blockers: [], reason: 'Stanek is unavailable in BN8'};
  if (!(sf13 > 0))
    return {eligible: false, installed: false, canAccept: false, blockers: [], reason: 'Stanek requires SF13'};
  let owned, installed;
  try {
    owned = ns.singularity.getOwnedAugmentations(true);
    installed = ns.singularity.getOwnedAugmentations(false);
  } catch {
    return {eligible: false, installed: false, canAccept: false, blockers: [], reason: 'Augmentation ownership unavailable'};
  }
  if (!Array.isArray(owned) || !Array.isArray(installed))
    return {eligible: false, installed: false, canAccept: false, blockers: [], reason: 'Invalid augmentation ownership'};
  if (installed.includes(stanekGiftName))
    return {eligible: true, installed: true, canAccept: false, blockers: [], reason: 'Stanek already installed'};
  const blockers = owned.filter(name => name !== neuroFluxName && name !== stanekGiftName);
  return {eligible: true, installed: false, canAccept: blockers.length === 0, blockers,
    reason: blockers.length ? 'Other augmentations already block the Church' : 'Ready to accept Stanek first'};
}

export function ensureStanekFirst(ns) {
  const state = stanekFirstState(ns);
  if (!state.eligible || state.installed || !state.canAccept) return state;
  try {
    return {...state, accepted: ns.stanek.acceptGift() === true};
  } catch (error) {
    return {...state, accepted: false, reason: String(error)};
  }
}
