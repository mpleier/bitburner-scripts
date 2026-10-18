import {publishInfrastructureCost} from '../early-game-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {isScriptPaused} from '../automation-control.js';
import {maintenanceRequested} from '../runtime-policy.js';
/** Purchase port openers once, or wait until all are owned with -c. */
export async function main(ns) {
 const programNames=['BruteSSH.exe','FTPCrack.exe','relaySMTP.exe','HTTPWorm.exe','SQLInject.exe'];
 const keepRunning=ns.args.includes('-c');
 do {
  if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)||!achievementActionAllowed(ns,'cashSpending'))return;
  let nextCost=Infinity;
  for(const program of programNames){
   if(ns.fileExists(program,'home'))continue;
   try{
    const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0),cost=ns.singularity.getDarkwebProgramCost(program);
    if(!(cost>0)||!Number.isFinite(cost))continue;
    if(ns.getPlayer().money-cost<reserve){nextCost=Math.min(nextCost,cost);continue;}
    if(ns.singularity.purchaseProgram(program))ns.toast('Purchased '+program,'success');
    else nextCost=Math.min(nextCost,cost);
   }catch(error){ns.print('Program purchase unavailable: '+String(error));return;}
  }
  publishInfrastructureCost(ns,'programs',nextCost);
  if(!keepRunning||programNames.every(p=>ns.fileExists(p,'home')))return;
  await ns.sleep(2000);
 }while(true);
}
