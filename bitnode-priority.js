/** Capability-first progression for a fresh save; completed stages are skipped. */
export const bitNodePriorities = Object.freeze([
  { node: 4, targetLevel: 3, reason: 'Singularity automation at its lowest RAM cost' },
  { node: 1, targetLevel: 2, reason: 'Broad multiplier improvements for early progression' },
  { node: 5, targetLevel: 1, reason: 'Intelligence, multiplier information and permanent Formulas.exe' },
  { node: 2, targetLevel: 1, reason: 'Gang income, reputation and augmentations' },
  { node: 9, targetLevel: 2, reason: 'Hacknet hashes and 128 GB starting home RAM' },
  { node: 10, targetLevel: 1, reason: 'Sleeves and grafting automation' },
  { node: 8, targetLevel: 2, reason: 'Permanent stock API and short selling' },
  { node: 13, targetLevel: 1, reason: 'Stanek access before automatic Bladeburner augmentation grants' },
  { node: 7, targetLevel: 3, reason: 'Bladeburner access, multipliers and automatic Blade’s Simulacrum' },
  { node: 3, targetLevel: 3, reason: 'Corporations with the full API permanently unlocked' },
  { node: 15, targetLevel: 1, reason: 'Full Dark Net access and permanent TOR/Darkscape' },
  { node: 11, targetLevel: 3, reason: 'Lower augmentation price scaling and company work bonuses' },
  { node: 10, targetLevel: 3, reason: 'Additional permanent sleeves; purchases and memory are automated' },
  { node: 14, targetLevel: 2, reason: 'IPvGO multipliers and automatic cheat access' },
  { node: 1, targetLevel: 3, reason: 'Finish broad multiplier improvements' },
  { node: 2, targetLevel: 3, reason: 'Improve crime income, success and charisma' },
  { node: 5, targetLevel: 3, reason: 'Improve hacking multipliers' },
  { node: 15, targetLevel: 3, reason: 'Charisma-based work/reputation benefits and better cache rewards' },
  { node: 9, targetLevel: 3, reason: 'Start new BitNodes with an upgraded Hacknet Server' },
  { node: 13, targetLevel: 3, reason: 'Larger Stanek grid' },
  { node: 6, targetLevel: 3, reason: 'Combat skill and experience multipliers' },
  { node: 14, targetLevel: 3, reason: 'Improve Go cheat success and faction favor rewards' },
  { node: 8, targetLevel: 3, reason: 'Complete stock features and growth multipliers' },
].map(stage => Object.freeze(stage)));

export function sourceFileLevels(owned) {
  const entries = owned instanceof Map ? [...owned] : Object.entries(owned || {});
  return Object.fromEntries(entries.filter(([node]) => Number.isInteger(Number(node)) && Number(node) >= 1 && Number(node) <= 15)
    .map(([node,level]) => [Number(node), Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0]));
}
/** Choose the next node assuming the current run completes successfully. */
export function planBitNodePriority(owned, currentNode, override = 0) {
  const projectedLevels = sourceFileLevels(owned);
  if (!Number.isInteger(currentNode) || currentNode < 1 || currentNode > 15) throw new Error('Invalid current BitNode');
  projectedLevels[currentNode] = currentNode === 12 ? (projectedLevels[currentNode] || 0) + 1 : Math.min(3, (projectedLevels[currentNode] || 0) + 1);
  const remaining = bitNodePriorities.filter(stage => (projectedLevels[stage.node] || 0) < stage.targetLevel);
  const recommended = remaining[0] || { node: 12, targetLevel: (projectedLevels[12] || 0) + 1, endless: true,
    reason: 'All finite Source Files complete; repeat Recursion for starting NeuroFlux levels' };
  const automatic = override === 0;
  return { currentNode, projectedLevels, recommended, remaining, nextBn: automatic ? recommended.node : override,
    overridden: !automatic, validOverride: automatic || (Number.isInteger(override) && override >= 1 && override <= 15) };
}
