import {scriptSignature} from './runtime-policy.js';
import { commandFile, heartbeatFile, resultFile, validateCommand, renderCommandJob, commandPolicyVersion } from './remote-api-command.js';
/** File mailbox for state queries and named project script controls. */
export async function main(ns) {
 ns.disableLog('ALL');
 if (ns.getHostname() !== 'home') { ns.tprint('Run remote-api-agent.js on home.'); return; }
 if (ns.ps('home').some(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)) return;
 ns.print('Remote API command worker ready.');
 const signature=scriptSignature(ns,ns.getScriptName());
 const legacyIndex=ns.args.indexOf('--legacy-policy');let savedHeartbeat;
 try{savedHeartbeat=JSON.parse(ns.read(heartbeatFile));}catch{}
 const candidate=legacyIndex>=0?ns.args[legacyIndex+1]:savedHeartbeat?.policy;
 const legacyPolicy=Number.isSafeInteger(candidate)&&candidate>0&&candidate<=commandPolicyVersion?candidate:commandPolicyVersion;
 let lastHeartbeat = 0;
 while (true) {
  if (Date.now() - lastHeartbeat >= 2000) {
   lastHeartbeat = Date.now(); await ns.write(heartbeatFile, JSON.stringify({pid:ns.pid,at:lastHeartbeat,version:2,policy:legacyPolicy,activePolicy:commandPolicyVersion,signature}), 'w');
  }
  let command;
  try { command = JSON.parse(ns.read(commandFile) || 'null'); } catch { }
  if (command && /^[a-zA-Z0-9_-]{1,80}$/.test(command.id || '')) {
   const output = resultFile(command.id);
   let previous;
   try { previous = JSON.parse(ns.read(output) || 'null'); } catch { }
   if (previous?.state === 'running') {
    if (!ns.isRunning(previous.pid)) await ns.write(output, JSON.stringify({id:command.id,state:'uncertain',at:Date.now(),error:'Job stopped before reporting; command will not be replayed.'}), 'w');
   } else if (!previous) {
    try {
     validateCommand(command);
     const job = 'remote-control/job.js';
     await ns.write(job, renderCommandJob(command), 'w');
     const required = ns.getScriptRam(job, 'home');
     if (!(required > 0)) throw new Error('Command API is unavailable or could not be compiled');
     if (ns.getServerMaxRam('home') - ns.getServerUsedRam('home') >= required) {
      await ns.write(output, JSON.stringify({id:command.id,state:'running',pid:0,at:Date.now()}), 'w');
      const pid = ns.run(job, 1, JSON.stringify(command.args), output, command.id);
      if (!pid) await ns.write(output, JSON.stringify({id:command.id,state:'failed',at:Date.now(),error:'Unable to launch command job'}), 'w');
      else {
       while (ns.isRunning(pid)) {
        await ns.write(heartbeatFile, JSON.stringify({pid:ns.pid,at:Date.now(),version:2,policy:legacyPolicy,activePolicy:commandPolicyVersion,signature,commandId:command.id}), 'w');
        await ns.sleep(500);
       }
      }
     }
    } catch (error) { await ns.write(output, JSON.stringify({id:command.id,state:'failed',at:Date.now(),error:String(error)}), 'w'); }
   }
  }
  await ns.sleep(250);
 }
}
