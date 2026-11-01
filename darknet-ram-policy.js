import {yieldDarknetLoot,clearLootYield} from './darknet-throughput-policy.js';
export const ramRecoveryFile='darknet-ram.js',ramRecoveryModel='(RAM Recovery)';
export function chooseRamRecoveryThreads(blocked,available,expected){
 const cap=Math.max(0,Math.min(8,Math.floor(available)));
 if(!(blocked>0)||!Number.isFinite(blocked)||!Number.isFinite(cap)||cap<1)return 0;
 try{for(let threads=1;threads<=cap;threads++){const amount=expected(threads);if(!(amount>0)||!Number.isFinite(amount))break;if(amount>=blocked)return threads;}}catch{/* Formulas.exe is optional. */}
 return cap;
}
/** One bounded recovery worker per source; callers supply a validated home grant. */
export async function scheduleRamRecovery(ns,host,details,scope,token){
 const self=ns.getHostname();
 if(!(details.blockedRam>0)||details.hasSession===false||!ns.fileExists(ramRecoveryFile,self)||ns.ps(self).some(p=>p.filename===ramRecoveryFile))return 0;
 const ram=ns.getScriptRam(ramRecoveryFile,self);
 if(!await yieldDarknetLoot(ns,ram,'recovery'))return 0;
 const free=ns.getServerMaxRam(self)-ns.getServerUsedRam(self);
 const threads=chooseRamRecoveryThreads(details.blockedRam,free/ram,n=>ns.formulas.dnet.getExpectedRamBlockRemoved(details,n,ns.getPlayer()));
 if(!threads)return 0;
 const pid=ns.exec(ramRecoveryFile,self,threads,host,ns.pid,JSON.stringify(scope),token);
 if(pid)await clearLootYield(ns,'recovery');
 return pid;
}
