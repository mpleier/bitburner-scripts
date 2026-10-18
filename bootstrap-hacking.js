import {isScriptPaused} from './automation-control.js';
import {maintenanceRequested} from './runtime-policy.js';
/** Small, one-thread cash fallback. It never changes the player's focus or spends cash. */
export async function main(ns) {
 const owner=Number(ns.args[0]);
 const allowed=()=>!isScriptPaused(ns,ns.getScriptName())&&!isScriptPaused(ns,'daemon.js')&&!isScriptPaused(ns,'autopilot.js')&&
  (!owner||ns.isRunning(owner))&&!maintenanceRequested(ns)&&!ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='daemon.js'||p.filename.replace(/^\//,'')==='casino.js');
 while(allowed()){
  const seen=new Set(['home']),pending=['home'],targets=[];
  while(pending.length){
   const host=pending.pop();
   for(const next of ns.scan(host))if(!seen.has(next)){seen.add(next);pending.push(next);}
   if(host==='home')continue;
   try{
    if(!ns.hasRootAccess(host)&&ns.getServerNumPortsRequired(host)===0)ns.nuke(host);
    if(!ns.hasRootAccess(host)||ns.getServerRequiredHackingLevel(host)>ns.getHackingLevel())continue;
    const maximum=ns.getServerMaxMoney(host);if(!(maximum>0))continue;
    const server={hostname:host,moneyMax:maximum,moneyAvailable:ns.getServerMoneyAvailable(host),
     hackDifficulty:ns.getServerSecurityLevel(host),minDifficulty:ns.getServerMinSecurityLevel(host)};
    targets.push({server,time:Math.max(1,ns.getHackTime(host))});
   }catch{/* Inaccessible hosts do not stop the fallback. */}
  }
  // Keep easy, fast targets ahead of large servers that need lengthy preparation.
  targets.sort((a,b)=>a.time-b.time||b.server.moneyAvailable-a.server.moneyAvailable);
  const server=targets[0]?.server;
  if(!server){await ns.sleep(1000);continue;}
  if(!allowed())return;
  try{
   if(server.hackDifficulty>server.minDifficulty+5)await ns.weaken(server.hostname);
   else if(server.moneyAvailable<server.moneyMax*.5)await ns.grow(server.hostname);
   else await ns.hack(server.hostname);
  }catch(error){ns.print('Bootstrap hacking: '+String(error));await ns.sleep(1000);}
 }
}
