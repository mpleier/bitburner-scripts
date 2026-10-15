/** Reserve helper headroom without starving the first small home server. GB throughout. */
export function homeRamHeadroom(maximum,configured=0) {
 if(!Number.isFinite(maximum)||maximum<=0)return 0;
 const adaptive=Math.min(maximum*.25,Math.max(128,Math.min(2048,maximum*.02)));
 return Math.min(maximum,Math.max(adaptive,Number.isFinite(configured)?Math.max(0,configured):0));
}
export function homeRamReserve(ns) {
 if(typeof ns.disableLog==='function'){ns.disableLog('disableLog');ns.disableLog('getServerMaxRam');}
 return homeRamHeadroom(ns.getServerMaxRam('home'),Number(ns.read('home-ram-reserve.txt'))||0);
}
/** Reclaim only known disposable workers on home. Never stop controllers or connectivity. */
export function reclaimHomeRam(ns,required=0,reserve=0) {
 if(typeof ns.disableLog==='function'){ns.disableLog('disableLog');ns.disableLog('getServerMaxRam');ns.disableLog('getServerUsedRam');}
 const maximum=ns.getServerMaxRam('home'),target=Math.max(0,required,reserve);
 if(!Number.isFinite(target)||target>maximum)return false;
 const free=()=>maximum-ns.getServerUsedRam('home');
 if(free()>=target)return true;
 const priority=name=>{
  name=name.replace(/^\//,'');
  if(name==='Remote/share.js')return 0;
  if(name==='Temp/stanek.js.charge.js')return 1;
  if(['Remote/hack-target.js','Remote/manualhack-target.js','Remote/grow-target.js','Remote/weak-target.js'].includes(name))return 2;
  return -1;
 };
 const workers=ns.ps('home').filter(p=>p.pid!==ns.pid&&priority(p.filename)>=0)
  .map(p=>({...p,priority:priority(p.filename),ram:ns.getScriptRam(p.filename,'home')*p.threads}))
  .sort((a,b)=>a.priority-b.priority||b.ram-a.ram);
 for(const worker of workers){if(free()>=target)break;ns.kill(worker.pid);}
 return free()>=target;
}
