// Home is the authority for code upgrades. Stop all observed outdated copies
// before launching replacements so peers cannot keep rolling each other back.
export async function refreshDarknetScouts(ns,files,revision,pending=new Set()) {
 for(const file of ns.ls('home','tasks/dnet-')){
  try{
   const report=JSON.parse(ns.read(file));
   if(report.version!==3||typeof report.host!=='string'||!report.pid||report.revision===revision)continue;
   const processes=ns.ps(report.host),scout=processes.find(p=>p.filename==='darknet-node.js');
   if(!scout||scout.pid!==report.pid)continue;
   if(!await ns.scp(files,report.host,'home'))continue;
   for(const p of processes)if(files.includes(p.filename))ns.kill(p.pid);
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
