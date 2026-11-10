import {reclaimStartupHelpers} from './core-startup-policy.js';
import {isScriptPaused} from './automation-control.js';
import {activityBusy} from './activity-coordination.js';
import {maintenanceRequested} from './runtime-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import {claimSpending} from './spending-policy.js';
/** Persistent post-reset recovery. Never yield the controller's place to optional helpers. */
export async function startupControllerTick(ns) {
 const processes=ns.ps('home'),reset=ns.getResetInfo();
 let transition;try{transition=JSON.parse(ns.read('tasks/progression-transition.json'));}catch{}
 const result={at:Date.now(),ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,controllers:[]};
 if(maintenanceRequested(ns)||activityBusy(ns)||transition?.expiresAt>Date.now()&&ns.isRunning(transition.ownerPid)||processes.some(p=>['casino.js','ascend.js'].includes(p.filename.replace(/^\//,''))))
  return {...result,state:'protected-activity'};
 for(const script of ['autopilot.js','reliability-manager.js']){
  const running=ns.ps('home').find(p=>p.filename.replace(/^\//,'')===script);
  if(running){result.controllers.push({script,pid:running.pid,state:'running'});continue;}
  if(isScriptPaused(ns,script)){result.controllers.push({script,state:'paused'});continue;}
  const required=ns.getScriptRam(script,'home');
  if(Number.isFinite(required)&&required>0)reclaimStartupHelpers(ns,required+16);
  const free=ns.getServerMaxRam('home')-ns.getServerUsedRam('home');
  if(!(required>0)||!Number.isFinite(required)){result.controllers.push({script,state:'missing-or-uncompiled'});break;}
  // Keep room for the small native workers used during controller initialization.
  if(required+16>free){result.controllers.push({script,state:'waiting-for-ram',required,free});break;}
  const pid=ns.run(script,1);
  result.controllers.push({script,pid,state:pid?'starting':'retrying'});
  // Observe the next native process list on the next pass; a PID alone is not readiness.
  break;
 }
 return {...result,state:result.controllers.length===2&&result.controllers.every(c=>c.state==='running'||c.state==='paused')?'monitoring':'recovering'};
}
export async function main(ns) {
 ns.disableLog('ALL');
 if(ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='bootstrap-start.js'&&p.pid!==ns.pid))return;
 while(!isScriptPaused(ns,'bootstrap-start.js')){
  try{
   const status=await startupControllerTick(ns);
   await ns.write('tasks/bootstrap-start.json',JSON.stringify(status),'w');
   const running=ns.ps('home');
   const reset=ns.getResetInfo();
   // Home RAM upgrades must continue even while an activity holds the player: buying RAM never
   // interrupts work, and the daemon (the other buyer) cannot start without the RAM in the first
   // place. Leaving this inside the protected-activity guard stranded nodes at 128 GB.
   try{
    if(!isScriptPaused(ns,'Tasks/ram-manager.js')&&!reset.bitNodeOptions?.restrictHomePCUpgrade&&achievementActionAllowed(ns,'homeRam')){
     const cost=ns.singularity.getUpgradeHomeRamCost(),reserve=Math.max(200000,Number(ns.read('reserve.txt'))||0);
     if(Number.isFinite(cost)&&cost>0&&ns.getServerMoneyAvailable('home')>=cost+reserve&&claimSpending(ns,'home',cost))ns.singularity.upgradeHomeRam();
    }
   }catch{/* Singularity may be unavailable. */}
   if(status.state!=='protected-activity'){
    if(!isScriptPaused(ns,'autopilot.js')&&!running.some(p=>p.filename.replace(/^\//,'')==='autopilot.js')){
     if(!isScriptPaused(ns,'daemon.js')&&achievementActionAllowed(ns,'hacking'))try{
      if(!ns.hasRootAccess('n00dles'))ns.nuke('n00dles');
      if(ns.getServerSecurityLevel('n00dles')>ns.getServerMinSecurityLevel('n00dles')+5)await ns.weaken('n00dles');
      else if(ns.getServerMoneyAvailable('n00dles')<ns.getServerMaxMoney('n00dles')*.5)await ns.grow('n00dles');
      else await ns.hack('n00dles');
     }catch{/* Missing target or access: retry controllers after a bounded sleep. */}
    }
   }
  }catch(error){ns.print('Startup recovery: '+String(error));}
  await ns.sleep(5000);
 }
}
