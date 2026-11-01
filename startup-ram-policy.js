import {homeRamHeadroom} from './home-ram-policy.js';
/** Reserve pending managers and one productive worker without an impossible charging gate. */
export function startupChargeRamTarget({maximum,used,pending=0,configured=0,workerRam=8,ceiling=2048}){
 if(![maximum,used,pending,configured,workerRam,ceiling].every(Number.isFinite)||maximum<=0||used<0||used>maximum||pending<0||workerRam<=0)return null;
 let target=maximum;
 while(target<ceiling&&target<used+Math.max(configured,homeRamHeadroom(target)+pending)+workerRam+8)target*=2;
 return target>maximum?Math.min(target,ceiling):null;
}
/** Compile each quote before dispatch; optional API groups degrade independently. */
export async function affordableRouteSnapshot(ns,variants){
 const file='/Temp/node-route-ram-probe.js';
 for(const variant of variants){
  await ns.write(file,'export async function main(ns){const data='+variant.source+';await ns.write("/Temp/node-route-probe-result.txt",JSON.stringify(data),"w");}','w');
  const required=ns.getScriptRam(file,'home'),free=ns.getServerMaxRam('home')-ns.getServerUsedRam('home');
  if(Number.isFinite(required)&&required>0&&required+2<=free)return {...variant,required,free};
 }
 return null;
}

/** Release provisional reservations as soon as their managers actually start. */
export function startupPendingRam(rows,processes,base=0){
 const live=new Set(processes.map(p=>p.filename.replace(/^\//,'')));
 return Math.max(0,base)+rows.filter(r=>['waiting-for-ram','waiting-for-activity'].includes(r.state)&&!live.has(r.script.replace(/^\//,''))).reduce((sum,r)=>sum+(Number.isFinite(r.ram)&&r.ram>0?r.ram:0),0);
}
