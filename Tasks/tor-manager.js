import {publishInfrastructureCost} from '../early-game-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {isScriptPaused} from '../automation-control.js';
import {maintenanceRequested} from '../runtime-policy.js';
/** Buy TOR without consuming money reserved for progression. */
export async function main(ns) {
 const continuous=ns.args.includes('-c');
 do {
  if(ns.scan('home').includes('darkweb'))return;
  if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)||!achievementActionAllowed(ns,'cashSpending'))return;
  const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0);
  publishInfrastructureCost(ns,'tor',200000);
  try{if(ns.getPlayer().money-200000>=reserve&&ns.singularity.purchaseTor()){publishInfrastructureCost(ns,'tor',null);
   const reset=ns.getResetInfo();
   await ns.write('tasks/infrastructure-tor-ready.json',JSON.stringify({at:Date.now(),token:ns.pid+':'+Date.now(),augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset}),'w');
   return;}}
  catch(error){ns.print('TOR purchase unavailable: '+String(error));return;}
  if(!continuous)return;
  await ns.sleep(2000);
 }while(true);
}
