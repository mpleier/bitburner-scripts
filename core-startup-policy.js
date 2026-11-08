import {isScriptPaused} from './automation-control.js';
export const startupControllers=['bootstrap-start.js','autopilot.js','reliability-manager.js'];
/** Small machines must fund controllers before optional resident helpers. */
export function coreStartupReservation(ns,requester,processes=ns.ps('home')) {
 const name=requester.replace(/^\//,'');
 if(startupControllers.includes(name)||ns.getServerMaxRam('home')<128)return 0;
 const live=new Set(processes.map(p=>p.filename.replace(/^\//,'')));
 return startupControllers.filter(s=>!live.has(s)&&!isScriptPaused(ns,s))
  .reduce((sum,s)=>{const ram=ns.getScriptRam(s,'home');return sum+(Number.isFinite(ram)&&ram>0?ram:0);},0);
}

/** Only disposable non-focus helpers may yield to core initialization or seed funding. */
export function reclaimStartupHelpers(ns,required) {
 const free=()=>ns.getServerMaxRam('home')-ns.getServerUsedRam('home');
 if(!Number.isFinite(required)||required<=0||required>ns.getServerMaxRam('home'))return false;
 for(const script of ['hacknet-upgrade-manager.js','health-manager.js','stats.js']){
  if(free()>=required)return true;
  for(const p of ns.ps('home'))if(p.filename.replace(/^\//,'')===script&&p.pid!==ns.pid)ns.kill(p.pid);
 }
 return free()>=required;
}
