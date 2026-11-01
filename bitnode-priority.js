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

export const bitNodeHistoryFile='data/bitnode-run-history.json';
export function recordBitNodeRun(previous,run){
 const valid=r=>r&&Number.isInteger(r.node)&&r.node>=1&&r.node<=15&&Number.isFinite(r.nodeReset)&&Number.isFinite(r.at)&&r.at>r.nodeReset&&Number.isFinite(r.durationMs)&&r.durationMs>0&&r.durationMs<=366*86400000&&typeof r.challenge==='boolean';
 const rows=Array.isArray(previous?.runs)?previous.runs.filter(valid):[];
 if(!valid(run))return {version:1,runs:rows.slice(-96)};
 return {version:1,runs:[...rows.filter(r=>r.nodeReset!==run.nodeReset),run].sort((a,b)=>a.at-b.at).slice(-96)};
}
/** Keep essential unlocks fixed; time history may reorder only the next three optional upgrades. */
export function rankOptionalBitNodes(plan,history,now=Date.now()){
 const base=plan.recommended,eligible=bitNodePriorities.indexOf(base)>=11;
 if(!eligible||!Array.isArray(history?.runs))return {...plan,historyRanking:{used:false,reason:'Essential unlock order or insufficient history'}};
 const rows=recordBitNodeRun(history,null).runs.filter(r=>r.challenge===false&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=180*86400000&&Number.isFinite(r.durationMs)&&r.durationMs>0&&r.durationMs<=366*86400000);
 const median=node=>{const samples=[...new Map(rows.filter(r=>r.node===node&&Number.isFinite(r.nodeReset)).map(r=>[r.nodeReset,r])).values()].sort((a,b)=>b.at-a.at).slice(0,3).map(r=>r.durationMs).sort((a,b)=>a-b);return samples.length>=2?samples[Math.floor(samples.length/2)]:null;};
 // Retain the earliest incomplete target for each node, not its later target level.
 const seen=new Set(),ordered=plan.remaining.filter(r=>!seen.has(r.node)&&seen.add(r.node)).slice(0,3);
 const baseline=median(base.node);if(!baseline)return {...plan,historyRanking:{used:false,reason:'Need two normal runs for the baseline node'}};
 const scored=ordered.map((stage,i)=>({stage,medianMs:median(stage.node),priorityPenalty:1+i*.25})).filter(r=>r.medianMs!==null).map(r=>({...r,score:r.medianMs*r.priorityPenalty})).sort((a,b)=>a.score-b.score);
 const best=scored[0],use=best&&best.stage.node!==base.node&&best.score<baseline*.75;
 const recommended=use?{...best.stage,reason:best.stage.reason+'; measured normal-run cost favors this nearby optional upgrade'}:base;
 return {...plan,recommended,nextBn:plan.overridden?plan.nextBn:recommended.node,historyRanking:{used:!!use,baselineNode:base.node,baselineMs:baseline,candidates:scored.map(r=>({node:r.stage.node,targetLevel:r.stage.targetLevel,medianMs:r.medianMs,score:r.score})),reason:use?'At least 25% lower weighted historical cost; this is not a completion forecast':'History does not justify changing capability order'}};
}

export function restrictedBitNodeRun(reset,profile){
 const o=reset?.bitNodeOptions||{},overrides=o.sourceFileOverrides;
 return profile?.active===true||Object.values(o).some(v=>v===true)||Number.isFinite(o.intelligenceOverride)||
  (overrides instanceof Map?overrides.size>0:Array.isArray(overrides)?overrides.length>0:overrides&&typeof overrides==='object'?Object.keys(overrides).length>0:false);
}
