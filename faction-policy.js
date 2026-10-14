/** Normalize flag values without changing faction names containing spaces. */
export function factionForcedJoins(value,node,gang,gangAvailable,karma) {
 const names=value==null?[...(node===10?['The Covenant']:[]),...(!gang&&gangAvailable&&karma<=-53000?['Slum Snakes','Tetrads','The Black Hand','The Syndicate','The Dark Army','Speakers for the Dead']:[])]:[value].flat(Infinity);
 return [...new Set(names.filter(n=>typeof n==='string'&&n.trim()).map(n=>n.replaceAll('_',' ').trim()))];
}
/** Fresh native checks; serialized workers have no imported dependencies. */
export function factionControlAllowed(api,parent,script,focus=false,now=Date.now()) {
 if(!api.isRunning(parent)||api.read('remote-control/paused/'+script+'.txt').trim()==='true')return false;
 if(focus){
  for(const file of ['tasks/activity-lock.json','tasks/automation-maintenance.json'])try{
   const r=JSON.parse(api.read(file)),owner=r.ownerPid;
   if(r.expiresAt>now&&owner!==parent&&api.isRunning(owner))return false;
  }catch{}
  if(['GRAFTING','CREATE_PROGRAM'].includes(api.currentWork()?.type))return false;
 }
 return true;
}
/** Spend only fresh affordable amounts; native APIs enforce membership/prerequisites. */
export function factionPurchaseBatch(api,orders,allowed,reserve,donations=false,repMultiplier=1) {
 let successes=0;
 for(const o of orders){
  if(!allowed())break;
  const cash=api.player().money,keep=Math.max(0,Number(reserve())||0);
  if(donations){
   const gap=Math.max(0,o.targetRep-api.rep(o.faction));
   if(gap===0){successes++;continue;}
   const multiplier=api.player().mults.faction_rep*repMultiplier;
   if(!Number.isFinite(multiplier)||multiplier<=0)continue;
   const amount=Math.min(o.repDonation,Math.ceil(1e6*gap/multiplier));
   if(!Number.isFinite(amount)||amount<=0||amount>cash-keep)continue;
   if(api.donate(o.faction,amount))successes++;
  }else{
   const price=api.price(o.augmentation);
   if(!Number.isFinite(price)||price<0||price>cash-keep)continue;
   if(api.buy(o.faction,o.augmentation))successes++;
  }
 }
 return successes;
}
