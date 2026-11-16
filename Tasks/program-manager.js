import {publishInfrastructureCost} from '../early-game-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {isScriptPaused} from '../automation-control.js';
import {maintenanceRequested} from '../runtime-policy.js';
/** Purchase port openers once, or wait until all are owned with -c. */
export async function main(ns) {
 const programNames=['BruteSSH.exe','FTPCrack.exe','relaySMTP.exe','HTTPWorm.exe','SQLInject.exe'];
 // Formulas.exe ($5b, Dark Web) unlocks ns.formulas across the fleet: HGW timing projection, bladeburner
 // support economics, combat XP value, gang production quotes and darknet thread sizing all degrade or
 // bail without it. Bought like any other program, but only with a 25% margin so it can never undercut
 // the augmentation basket on a quiet pass.
 const optionalPrograms=['Formulas.exe'];
 const keepRunning=ns.args.includes('-c');
 do {
  if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)||!achievementActionAllowed(ns,'cashSpending'))return;
  let nextCost=Infinity;
  for(const program of [...programNames,...optionalPrograms]){
   if(ns.fileExists(program,'home'))continue;
   try{
    const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0),cost=ns.singularity.getDarkwebProgramCost(program);
    if(!(cost>0)||!Number.isFinite(cost))continue;
    const margin=optionalPrograms.includes(program)?cost*0.25:0;
    if(ns.getPlayer().money-cost-margin<reserve){nextCost=Math.min(nextCost,cost+margin);continue;}
    if(ns.singularity.purchaseProgram(program))ns.toast('Purchased '+program,'success');
    else nextCost=Math.min(nextCost,cost);
   }catch(error){ns.print('Program purchase unavailable: '+String(error));return;}
  }
  publishInfrastructureCost(ns,'programs',nextCost);
  if(!keepRunning||[...programNames,...optionalPrograms].every(p=>ns.fileExists(p,'home')))return;
  await ns.sleep(2000);
 }while(true);
}
