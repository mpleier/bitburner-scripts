/** Self-contained read-only worker. Watch only the catalogue used by the current planner. */
export function captureAugmentationEconomics(ns,watch) {
 try{
  if(!watch||!Array.isArray(watch.augmentations)||watch.augmentations.length>256||!Array.isArray(watch.factions)||watch.factions.length>64)throw Error('Invalid watch list');
  const reset=ns.getResetInfo(),player=ns.getPlayer(),quotes={},factions={};
  const valid=n=>Number.isFinite(n)&&n>=0;
  for(const name of [...new Set(watch.augmentations)].sort()){
   if(typeof name!=='string'||!name)throw Error('Invalid augmentation');
   const price=ns.singularity.getAugmentationPrice(name),rep=ns.singularity.getAugmentationRepReq(name);
   if(!valid(price)||!valid(rep))throw Error('Invalid augmentation quote');quotes[name]={price,rep};
  }
  const joined=[...new Set(player.factions||[])].sort(),favorToDonate=ns.getFavorToDonate(),repMultiplier=player.mults?.faction_rep;
  if(!valid(favorToDonate)||!Number.isFinite(repMultiplier)||repMultiplier<=0)throw Error('Invalid donation inputs');
  for(const item of watch.factions){
   if(typeof item.name!=='string'||!item.name||!Array.isArray(item.augmentations)||item.augmentations.some(n=>!quotes[n]))throw Error('Invalid faction watch');
   const rep=ns.singularity.getFactionRep(item.name),favor=ns.singularity.getFactionFavor(item.name);
   if(!valid(rep)||!valid(favor))throw Error('Invalid faction quote');
   factions[item.name]={rep,favor,joined:joined.includes(item.name),thresholds:[...new Set(item.augmentations.map(n=>quotes[n].rep))].sort((a,b)=>a-b)};
  }
  return {version:1,complete:true,at:Date.now(),nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,watch,quotes,factions,joined,favorToDonate,repMultiplier};
 }catch(error){return {version:1,complete:false,reason:String(error).slice(0,160)};}
}

/** Prices and unlocks invalidate immediately. Small natural rep drift does not starve planning. */
export function augmentationEconomicsChange(before,after,{allowRepDrift=false}={}) {
 const changed=reason=>({changed:true,reason});
 try{
  if(before?.version!==1||after?.version!==1||!before.complete||!after.complete)return changed('Native augmentation quotes unavailable');
  if(before.nodeReset!==after.nodeReset||before.augReset!==after.augReset)return changed('Reset changed');
  if(!Number.isFinite(before.at)||!Number.isFinite(after.at)||after.at<before.at)return changed('Invalid quote time');
  if(JSON.stringify(before.watch)!==JSON.stringify(after.watch))return changed('Watched catalogue changed');
  const sameNumber=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>=0&&Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
  if(JSON.stringify(before.joined)!==JSON.stringify(after.joined))return changed('Faction membership changed');
  if(!sameNumber(before.favorToDonate,after.favorToDonate)||!sameNumber(before.repMultiplier,after.repMultiplier))return changed('Donation conversion changed');
  if(JSON.stringify(Object.keys(before.quotes).sort())!==JSON.stringify(Object.keys(after.quotes).sort()))return changed('Augmentation catalogue changed');
  for(const [name,q]of Object.entries(before.quotes)){
   const current=after.quotes[name];if(!current||!sameNumber(q.price,current.price)||!sameNumber(q.rep,current.rep))return changed('Augmentation price or reputation requirement changed: '+name);
  }
  if(JSON.stringify(Object.keys(before.factions).sort())!==JSON.stringify(Object.keys(after.factions).sort()))return changed('Faction catalogue changed');
  for(const [name,f]of Object.entries(before.factions)){
   const current=after.factions[name];
   if(!current||!sameNumber(f.favor,current.favor)||f.joined!==current.joined)return changed('Faction favor or availability changed: '+name);
   if(!Number.isFinite(f.rep)||f.rep<0||!Number.isFinite(current.rep)||current.rep<0||!Array.isArray(f.thresholds)||f.thresholds.some(t=>!Number.isFinite(t)||t<0))return changed('Invalid faction reputation');
   if(!f.joined)continue;
   if(f.thresholds.some(t=>(f.rep>=t)!==(current.rep>=t)))return changed('Augmentation reputation unlock changed: '+name);
   const gaps=f.thresholds.filter(t=>t>Math.min(f.rep,current.rep)).map(t=>t-Math.min(f.rep,current.rep));
   // Once every watched offer is unlocked, extra reputation changes no donation bill.
   if(!gaps.length)continue;
   const tolerance=Math.max(1000,Math.min(...gaps)*(allowRepDrift && current.rep>=f.rep ? .1 : .01));
   if(Math.abs(current.rep-f.rep)>=tolerance)return changed('Donation funding changed materially: '+name);
  }
  return {changed:false,reason:'Prices, unlocks and funding remain usable'};
 }catch{return changed('Malformed augmentation quotes');}
}

/** Release obsolete augmentation cash goals without opening other shared cash allowances. */
export async function invalidateAugmentationFunding(ns,ownerPid,reset,summaryFile,now=Date.now()) {
 await ns.write(summaryFile,'','w');let inactiveWait=null;
 try{
  const wait=JSON.parse(ns.read('tasks/augmentation-wait-plan.json'));
  if(wait.ownerPid===ownerPid&&wait.augReset===reset.lastAugReset&&wait.nodeReset===reset.lastNodeReset){
   inactiveWait={...wait,active:false,at:now};await ns.write('tasks/augmentation-wait-plan.json',JSON.stringify(inactiveWait),'w');
  }
 }catch{}
 try{
  const plan=JSON.parse(ns.read('tasks/spending-plan.json'));
  if(plan.ownerPid===ownerPid&&plan.reset===reset.lastAugReset)
   await ns.write('tasks/spending-plan.json',JSON.stringify({...plan,signals:{...plan.signals,augmentationCashTarget:null}}),'w');
 }catch{}
 await ns.write('tasks/augmentation-reset-plan.json',JSON.stringify({pending:false,ownerPid,augReset:reset.lastAugReset,expiresAt:now+30000}),'w');
 return inactiveWait;
}
