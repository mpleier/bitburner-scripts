import {publishBackdoorCompletion} from '../backdoor-unlock-policy.js';
import {isScriptPaused} from '../automation-control.js';
import {maintenanceRequested} from '../runtime-policy.js';
import {activityBusy} from '../activity-coordination.js';
/** Confirm the requested connection before capturing it in the native installation call. */
export async function main(ns) {
 const [target,path,token,owner]=ns.args;let started=false;
 const receipt=async(state,error)=>{
  if(typeof path==='string'&&path.startsWith('/Temp/backdoor-start-')&&typeof token==='string')
   await ns.write(path,JSON.stringify({pid:ns.pid,target,token,state,error}),'w');
 };
 try{
  if(typeof target!=='string'||!target)throw Error('A target server is required');
  if(owner&&!ns.isRunning(Number(owner)))throw Error('Backdoor manager has stopped');
  if(isScriptPaused(ns,'Tasks/backdoor-all-servers.js')||isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)||activityBusy(ns))throw Error('Backdoor automation is paused or another activity owns control');
  const startedReset=ns.getResetInfo();
  const actual=ns.singularity.getCurrentServer();
  if(actual!==target)throw Error('Connected to '+actual+' instead of '+target);
  // Native installation captures the current server when invoked, before any await.
  const installation=ns.singularity.installBackdoor();
  // Attach a rejection handler immediately, including while the receipt write yields.
  const outcome=Promise.resolve(installation).then(()=>({ok:true}),error=>({ok:false,error}));
  started=true;await receipt('started');
  const result=await outcome;if(!result.ok)throw result.error;
  await publishBackdoorCompletion(ns,target,startedReset);
  ns.toast(`Backdoored ${target}`,'success');
 }catch(error){
  if(!started)await receipt('failed',String(error));
  ns.print(`WARN: Could not backdoor ${target}: ${String(error)}`);
  ns.toast(`Could not backdoor ${target}; will retry later.`,'warning');
 }
}
