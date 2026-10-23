/** Self-contained native worker: all ownership reads finish synchronously in one game tick. */
export function captureAugmentationOwnership(ns,canSingularity=true) {
 try{
  const reset=ns.getResetInfo(),entries=reset.ownedAugs instanceof Map?[...reset.ownedAugs]:Object.entries(reset.ownedAugs||{});
  const levels=entries.filter(([name,level])=>typeof name==='string'&&Number.isFinite(Number(level))&&Number(level)>0)
   .map(([name,level])=>[name,Number(level)]).sort(([a],[b])=>a.localeCompare(b));
  let installed=levels.map(([name])=>name),owned=null,queued=null,complete=false;
  if(canSingularity)try{
   installed=ns.singularity.getOwnedAugmentations(false);owned=ns.singularity.getOwnedAugmentations(true);
   if(!Array.isArray(installed)||!Array.isArray(owned)||[...installed,...owned].some(n=>typeof n!=='string'))throw Error('Invalid ownership lists');
   const remaining=new Map();for(const name of installed)remaining.set(name,(remaining.get(name)||0)+1);
   queued=[];for(const name of owned){if(remaining.get(name)>0)remaining.set(name,remaining.get(name)-1);else queued.push(name);}
   if([...remaining.values()].some(n=>n!==0))throw Error('Installed ownership is not contained in purchased ownership');
   if(installed.includes('NeuroFlux Governor')&&!levels.some(([name])=>name==='NeuroFlux Governor'))throw Error('Installed NeuroFlux level unavailable');
   complete=true;
  }catch{installed=levels.map(([name])=>name);owned=null;queued=null;}
  const signature=JSON.stringify([reset.lastNodeReset,reset.lastAugReset,[...installed].sort(),queued===null?null:[...queued].sort(),levels]);
  return {version:1,at:Date.now(),nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,complete,installed,owned,queued,levels,signature};
 }catch{return null;}
}
