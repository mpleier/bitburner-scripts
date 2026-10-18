import {getNsDataThroughFile} from './helpers.js';
import {planFactionCityGroup} from './faction-policy.js';

/** Choose once per augmentation reset; every invitation handler shares the result. */
export async function ensureFactionJoinPlan(ns, preferred=[], skip=[]) {
  const reset=ns.getResetInfo();
  let saved;try{saved=JSON.parse(ns.read('tasks/faction-join-plan.json'));}catch{}
  const explicit=preferred.find(name=>['Aevum','Sector-12','Chongqing','New Tokyo','Ishima','Volhaven'].includes(name));
  if(saved?.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset&&
    (!explicit||saved.preferred===explicit)&&skip.every(name=>(saved.skip||[]).includes(name)))return saved;
  if(saved?.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset){
    skip=[...new Set([...(saved.skip||[]),...skip])];
    if(!explicit&&saved.preferred)preferred=[saved.preferred,...preferred];
  }
  const snapshot=await getNsDataThroughFile(ns,`(() => {
    const p=ns.getPlayer(),r=ns.getResetInfo(),owned=ns.singularity.getOwnedAugmentations(true);
    const cities=['Aevum','Sector-12','Chongqing','New Tokyo','Ishima','Volhaven'];
    const covered=new Set(p.factions.filter(f=>!cities.includes(f)).flatMap(f=>ns.singularity.getAugmentationsFromFaction(f)));
    const factions=Object.fromEntries(cities.map(f=>[f,ns.singularity.getAugmentationsFromFaction(f).filter(a=>a!=='NeuroFlux Governor'&&!owned.includes(a)).map(name=>({name,covered:covered.has(name),rep:ns.singularity.getAugmentationRepReq(name),stats:ns.singularity.getAugmentationStats(name)}))]));
    return {joined:p.factions,factions,nodeReset:r.lastNodeReset,augReset:r.lastAugReset};
  })()`,'/Temp/faction-city-options.txt');
  const plan={at:Date.now(),...planFactionCityGroup(snapshot,preferred,skip),nodeReset:snapshot.nodeReset,augReset:snapshot.augReset,skip};
  await ns.write('tasks/faction-join-plan.json',JSON.stringify(plan),'w');
  ns.print('Faction city plan: '+(plan.group?.join(' + ')||'defer city membership')+'. '+plan.reason+'.');
  return plan;
}
