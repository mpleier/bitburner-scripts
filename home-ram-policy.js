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
/** Identify safe reclamation without canceling a scheduled leg or its recovery. */
export function homeRamWorkerKind(process) {
 const name=process.filename.replace(/^\//,''),args=process.args||[];
 if(name==='Remote/share.js')return 'share';
 if(name==='Temp/stanek.js.charge.js')return 'charge';
 if(!['Remote/hack-target.js','Remote/manualhack-target.js','Remote/grow-target.js','Remote/weak-target.js'].includes(name))return 'protected';
 const weak=name==='Remote/weak-target.js',owner=args[weak?6:7];
 const scheduled=/^Batch\b/.test(String(args[3]||''))||Number(args[1])>0&&Number(args[2])>0||Number(owner)>0;
 // Keep grow/weaken recovery even if an older or third-party caller lacks timing metadata.
 return scheduled||name==='Remote/grow-target.js'||weak?'batch':'standalone-hack';
}

/** Let scheduled batches finish. Headroom reservations prevent allocating their RAM again. */
export function reclaimHomeRam(ns,required=0,reserve=0) {
 if(typeof ns.disableLog==='function'){ns.disableLog('disableLog');ns.disableLog('getServerMaxRam');ns.disableLog('getServerUsedRam');}
 const maximum=ns.getServerMaxRam('home'),target=Math.max(0,required,reserve);
 if(!Number.isFinite(target)||target>maximum)return false;
 const free=()=>maximum-ns.getServerUsedRam('home');
 if(free()>=target)return true;
 const priorities={share:0,charge:1,'standalone-hack':2};
 const processes=ns.ps('home').filter(p=>p.pid!==ns.pid);
 const protectedBatches=processes.filter(p=>homeRamWorkerKind(p)==='batch');
 const workers=processes.map(p=>({...p,kind:homeRamWorkerKind(p)})).filter(p=>p.kind in priorities)
  .map(p=>({...p,priority:priorities[p.kind],ram:(typeof ns.getRunningScript==='function'?ns.getRunningScript(p.pid)?.ramUsage:undefined)??ns.getScriptRam(p.filename,'home')}))
  .map(p=>({...p,ram:p.ram*p.threads})).sort((a,b)=>a.priority-b.priority||b.ram-a.ram);
 const canceled=[];
 for(const worker of workers){if(free()>=target)break;if(ns.kill(worker.pid))canceled.push({pid:worker.pid,filename:worker.filename,kind:worker.kind,ram:worker.ram});}
 const available=free(),satisfied=available>=target;
 if(typeof ns.write==='function'){
  const now=Date.now();let old;try{old=JSON.parse(ns.read('tasks/home-ram-reclaim.json'));}catch{}
  // Repeated allocation attempts must not generate an unbounded stream of state writes.
  if(canceled.length||!old||now-old.at>=5000)ns.write('tasks/home-ram-reclaim.json',JSON.stringify({at:now,ownerPid:ns.pid,target,available,satisfied,
   reason:satisfied?'Headroom recovered':protectedBatches.length?'Waiting for scheduled hacking work to finish':'No safe disposable RAM',
   canceled,protectedCount:protectedBatches.length,protected:protectedBatches.slice(0,40).map(p=>({pid:p.pid,filename:p.filename,target:p.args?.[0]??null,batch:String(p.args?.[3]||'').slice(0,120)}))}),'w');
 }
 return satisfied;
}

/** Minimum capacity for current persistent processes, missing essential managers and headroom. */
export function essentialManagerRamTarget(ns,managers=[],processes=ns.ps('home')) {
 const essential=new Set(['remote-api-agent.js','reliability-manager.js','health-manager.js','bladeburner.js','sleeve.js','work-for-factions.js','spend-hacknet-hashes.js']);
 const running=new Set(processes.map(p=>p.filename.replace(/^\//,'')));
 const missing=[...new Set(managers.filter(m=>essential.has(m.script)&&['waiting-for-ram','needs-home-ram'].includes(m.state)&&!running.has(m.script)).map(m=>m.script))];
 const persistent=processes.filter(p=>!p.temporary&&!/^(Temp|remote-control)\//.test(p.filename.replace(/^\//,''))&&homeRamWorkerKind(p)==='protected');
 const footprint=persistent.reduce((sum,p)=>sum+Math.max(0,ns.getScriptRam(p.filename,'home'))*p.threads,0);
 const required=footprint+missing.reduce((sum,name)=>sum+Math.max(0,ns.getScriptRam(name,'home')),0);
 const maximum=ns.getServerMaxRam('home');let target=maximum;
 if(!Number.isFinite(required)||!Number.isFinite(maximum)||maximum<=0)return null;
 const configured=Number(ns.read('home-ram-reserve.txt'))||0;
 while(target<2**30&&target<required+homeRamHeadroom(target,configured))target*=2;
 return target>maximum?{target,required,missing}:null;
}
