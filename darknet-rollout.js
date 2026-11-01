/** Hold replacement until in-flight one-shot helpers and native phishing work have finished. */
export async function prepareDarknetRollout(ns,host){
 const processes=ns.ps(host);
 // Stasis, cache and RAM helpers run one native call with no resumable receipt; killing them
 // would abandon the phase and force an anchor rollback. Wait for them to exit on their own.
 if(processes.some(p=>['darknet-stasis.js','darknet-cache.js','darknet-ram.js'].includes(p.filename)))return false;
 const loot=processes.find(p=>p.filename==='darknet-loot.js');
 if(!loot)return true;
 const at=Date.now(),file='tasks/dnet-loot-resize.json';
 await ns.write(file,JSON.stringify({pid:loot.pid,at,expiresAt:at+45000,reason:'navigator',purpose:'rollout'}),'w');
 await ns.scp(file,host,'home');
 return false;
}
// Home is the authority for code upgrades. Stop all observed outdated copies
// before launching replacements so peers cannot keep rolling each other back.
export async function refreshDarknetScouts(ns,files,revision,pending=new Set(),reports=null) {
 for(const entry of reports??ns.ls('home','tasks/dnet-')){
  try{
   const report=typeof entry==='string'?JSON.parse(ns.read(entry)):entry;
   if(report.version!==3||typeof report.host!=='string'||!report.pid||report.revision===revision)continue;
   const processes=ns.ps(report.host),scout=processes.find(p=>p.filename==='darknet-node.js');
   if(!scout||scout.pid!==report.pid)continue;
   if(!await prepareDarknetRollout(ns,report.host))continue;
   if(!await ns.scp(files,report.host,'home'))continue;
   for(const p of processes)if(files.includes(p.filename)&&p.filename!=='darknet-maze.js')ns.kill(p.pid);
   pending.add(report.host);
  }catch{ /* A disappearing server or incomplete report is retried next pass. */ }
 }
 for(const host of pending){
  try{
   if(ns.ps(host).some(p=>p.filename==='darknet-node.js')){pending.delete(host);continue;}
   // An old peer may have written while the first phase was stopping others.
   if(!await ns.scp(files,host,'home'))continue;
   const pid=ns.exec('darknet-node.js',host,1);
   if(pid)pending.delete(host);
   ns.print(host+': code upgrade '+(pid?'started':'waiting for RAM')+'.');
  }catch{ /* Normal discovery retries launch. */ }
 }
 return pending.size;
}
