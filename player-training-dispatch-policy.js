import {claimActivity,releaseActivity} from './activity-coordination.js';
import {automationHeartbeat} from './runtime-policy.js';
import {homeRamReserve} from './home-ram-policy.js';
/** One real worker with native RAM accounting; parent keeps its heartbeat while waiting. */
export async function dispatchPlayerCombatTraining(ns,input){
 const script='Tasks/bladeburner-training.js',ram=ns.getScriptRam(script,'home');
 if(!Number.isFinite(ram)||ram<=0||ram+homeRamReserve(ns)>ns.getServerMaxRam('home')-ns.getServerUsedRam('home'))return {started:false,reason:'worker-ram'};
 if(ns.ps('home').some(p=>p.filename.replace(/^\//,'')===script))return {started:false,reason:'worker-active'};
 if(!await claimActivity(ns,'Bladeburner combat conditioning'))return {started:false,reason:'activity-owned'};
 try{
  const pid=ns.run(script,1,JSON.stringify(input));if(!pid)return {started:false,reason:'launch-failed'};
  while(ns.isRunning(pid)){automationHeartbeat(ns);await ns.sleep(200);}
  let result;try{result=JSON.parse(ns.read('tasks/bladeburner-external-training-'+ns.pid+'.json'));}catch{}
  return result?.workerPid===pid&&result.parent===ns.pid&&result.requestAt===input.at?result:{started:false,reason:'missing-worker-receipt'};
 }finally{releaseActivity(ns);}
}
