import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import { autopilotSourceFiles } from './autopilot-policy.js';
import { claimSpending } from './spending-policy.js';
import { isScriptPaused } from './automation-control.js';
export function soaCandidates(items,owned,rep) {
 const have=new Set(owned);
 return items.filter(a=>!have.has(a.name)&&a.prerequisites.every(p=>have.has(p))&&a.rep<=rep&&Number.isFinite(a.price)&&a.price>=0)
  .sort((a,b)=>a.price-b.price||a.name.localeCompare(b.name));
}
export function soaTick(ns) {
 const reset=ns.getResetInfo(),sf=autopilotSourceFiles(reset);
 if(!Number(sf[4]))return {status:'unavailable'};
 const faction='Shadows of Anarchy';
 if(ns.singularity.checkFactionInvitations().includes(faction))ns.singularity.joinFaction(faction);
 if(!ns.getPlayer().factions.includes(faction))return {status:'waiting-for-infiltration'};
 const bought=[];
 // Every purchase changes SoA's special money/rep prices. Read them again each time.
 for(let count=0;count<20;count++) {
  const owned=ns.singularity.getOwnedAugmentations(true),rep=ns.singularity.getFactionRep(faction);
  const items=ns.singularity.getAugmentationsFromFaction(faction).map(name=>({name,price:ns.singularity.getAugmentationPrice(name),
   rep:ns.singularity.getAugmentationRepReq(name),prerequisites:ns.singularity.getAugmentationPrereq(name)}));
  const missing=items.filter(a=>!owned.includes(a.name));
  const choice=soaCandidates(items,owned,rep).find(a=>a.price<=ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0));
  if(!choice)return {status:missing.length?'waiting-for-reputation-or-money':'complete',bought,missing};
  if(!claimSpending(ns,'soa',choice.price))return {status:'waiting-for-budget',bought,next:choice};
  if(!ns.singularity.purchaseAugmentation(faction,choice.name))return {status:'purchase-rejected',bought,next:choice};
  bought.push(choice.name);
 }
 return {status:'purchased',bought};
}
export async function main(ns) {
 registerAutomation(ns);
 if(isScriptPaused(ns,ns.getScriptName())||ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 ns.disableLog('ALL');
 while(!isScriptPaused(ns,ns.getScriptName())){
 automationHeartbeat(ns);try{const result=soaTick(ns);await ns.write('tasks/soa-status.json',JSON.stringify({at:Date.now(),pid:ns.pid,...result}),'w');
  if(result.status==='unavailable')return;if(result.bought?.length)ns.print('Queued infiltration upgrades: '+result.bought.join(', '));
 }catch(error){ns.print('SoA waiting: '+String(error));}await ns.sleep(30000);}
}
