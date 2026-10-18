export const runtimeScripts=['autopilot.js','daemon.js','corporation-manager.js','gangs.js','sleeve.js','go.js','bladeburner.js','grafting-manager.js','health-manager.js','infiltration-manager.js','soa-manager.js','achievement-manager.js','darknet-manager.js','stanek.js','sleeve-expansion.js','hacknet-upgrade-manager.js','work-for-factions.js','stockmaster.js','spend-hacknet-hashes.js','contract-validation.js'];
export const statusFiles={'hacknet-upgrade-manager.js':'tasks/hacknet-upgrade-status.json','spend-hacknet-hashes.js':'tasks/hacknet-hash-status.json','work-for-factions.js':'tasks/faction-work-status.json','stanek.js':'tasks/stanek-status.json','stockmaster.js':'tasks/stock-status.json','corporation-manager.js':'tasks/corporation-status.json','gangs.js':'tasks/gang-status.json','sleeve.js':'tasks/sleeve-status.json','go.js':'tasks/go-status.json','infiltration-manager.js':'tasks/infiltration-status.json','soa-manager.js':'tasks/soa-status.json','achievement-manager.js':'tasks/achievement-status.json','autopilot.js':'tasks/automation-status.json','grafting-manager.js':'tasks/grafting-status.json','contract-validation.js':'tasks/contract-validation.json'};
export function runtimeHash(text){let n=2166136261;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619);return (n>>>0).toString(16);}
function resolvePath(base,dependency){const parts=(dependency.startsWith('.')?base.split('/').slice(0,-1).join('/')+'/'+dependency:dependency).split('/'),out=[];for(const p of parts){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return out.join('/');}
/** Pass a fresh cache for each supervisor check; never reuse it across updates. */
export function scriptSignature(ns,script,sourceCache=new Map()){
 const visited=new Set(),parts=[];
 function read(name){
  if(visited.has(name))return;visited.add(name);
  let source=sourceCache.get(name);
  if(!source){const text=ns.read(name);source={text,dependencies:[...text.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(m=>resolvePath(name,m[1]))};sourceCache.set(name,source);}
  parts.push(name+'\n'+source.text);for(const dependency of source.dependencies)read(dependency);
 }
 read(script.replace(/^\//,''));return runtimeHash(parts.sort().join('\n'));
}
const registrations=new Map();
export function registerAutomation(ns){const key=ns.pid;registrations.set(key,{pid:key,script:ns.getScriptName(),signature:scriptSignature(ns,ns.getScriptName()),startedAt:Date.now()});automationHeartbeat(ns);}
export function automationHeartbeat(ns){
 const record=registrations.get(ns.pid),now=Date.now();
 if(record&&(record.at===undefined||now-record.at>=10000)){record.at=now;ns.write('tasks/runtime/'+ns.pid+'.json',JSON.stringify(record),'w');}
}
export function maintenanceRequested(ns){try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));return r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid);}catch{return false;}}
export function recoveryDecision({record,signature,observedAt,now,paused=false,protectedWork=false,attempts=0,statusAt,script}){
 if(paused)return 'paused';
 const startedAt=Number.isFinite(record?.startedAt)&&record.startedAt>0&&record.startedAt<=now?record.startedAt:observedAt;
 const grace=now-startedAt<120000;
 const limit=script==='go.js'?20*60000:script==='contract-validation.js'?15*60000:4*60000;
 if(grace)return 'starting';
 const changed=record?.signature&&record.signature!==signature;
 const stale=record?.at&&now-record.at>limit||statusAt&&now-statusAt>limit;
 const unknown=!record||!Number.isFinite(record.at)||record.at<=0||record.at>now||typeof record.signature!=='string'||!record.signature;
 if(!changed&&!stale&&!unknown)return grace?'starting':'healthy';
 if(protectedWork)return 'deferred-protected-work';
 if(attempts>=3)return 'recovery-limit';
 return changed||unknown?'reload':'restart-stalled';
}
export function dashboardRows(processes,read,now=Date.now()){
 return runtimeScripts.map(script=>{
  const matching=processes.filter(p=>p.filename.replace(/^\//,'')===script),saved=read(statusFiles[script]);
  const owner=saved?.pid??saved?.ownerPid;
  const status=matching.length&&(!owner||matching.some(p=>p.pid===owner))?saved:null;
  return {script,pids:matching.map(p=>p.pid),state:matching.length?(status?.status||status?.state||status?.mode||'running'):'not-running',reason:status?.reason||status?.error||(matching.length&&saved&&owner?'Waiting for status from the current process':''),updatedAt:status?.at||null,ageMs:status?.at?now-status.at:null};
 });
}

/** Old processes retain their launch-time RAM cost when files change. */
export function automationReloadFits({free,newRam,oldRam=0,threads=1,reserve=0,stopped=false}) {
 if(![free,newRam,oldRam,threads,reserve].every(Number.isFinite)||free<0||newRam<=0||oldRam<0||!Number.isInteger(threads)||threads<1||reserve<0)return false;
 return free+(stopped?0:oldRam*threads)>=newRam*threads+reserve;
}

/** Debounce code sync and bound self-update attempts across supervisor instances. */
export function supervisorUpdatePlan({previous,launchedSignature,currentSignature,reset,now,protectedWork=false,pendingRestores=false,paused=false}) {
 const valid=previous?.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.at<=now;
 const old=valid?previous:null;
 const attempts=old?.signature===currentSignature&&Number.isFinite(old.windowAt)&&now-old.windowAt<15*60000?Math.max(0,Number(old.attempts)||0):0;
 const candidateAt=old?.signature===currentSignature&&Number.isFinite(old.candidateAt)&&old.candidateAt<=now?old.candidateAt:now;
 const record={at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,signature:currentSignature,candidateAt,attempts,windowAt:attempts?old.windowAt:now};
 const changed=typeof currentSignature==='string'&&currentSignature&&currentSignature!==launchedSignature;
 const state=!changed?'current':paused?'paused':protectedWork||pendingRestores?'deferred':attempts>=3?'retry-limit':now-candidateAt<10000?'settling':'ready';
 return {...record,state,reason:!changed?'Current code is active':paused?'Supervisor is paused':protectedWork?'Waiting for protected activity':pendingRestores?'Waiting for stopped controllers to be restored':attempts>=3?'Update retry limit reached':state==='settling'?'Waiting for files to settle':'Ready to activate'};
}

/** ns.spawn replaces this process only after native RAM and activity checks pass. */
export function handoffSupervisor(ns,plan,{reserve=0,blocked=false}={}) {
 if(plan.state!=='ready'||blocked)return false;
 const activation=supervisorHandoffStatus(ns,plan,{reserve,blocked});if(activation.state!=='ready')return false;
 const script=ns.getScriptName(),old=ns.getRunningScript(ns.pid);
 ns.write('tasks/reliability-self-update.json',JSON.stringify({...plan,pid:ns.pid,state:'handoff',attempts:plan.attempts+1}),'w');
 ns.spawn(script,{threads:old.threads,spawnDelay:0},...ns.args);
 return true;
}

/** A waiting reload must not globally pause automation until its replacement can fit. */
export function automationReloadReady(ns,job,reserve=0) {
 const oldRam=job.stopped?0:ns.getRunningScript(job.pid)?.ramUsage;
 if(!job.stopped&&!Number.isFinite(oldRam))return false;
 return automationReloadFits({free:ns.getServerMaxRam('home')-ns.getServerUsedRam('home'),newRam:ns.getScriptRam(job.filename,'home'),oldRam,threads:job.threads,reserve,stopped:job.stopped});
}
export function maintenanceReloadJobs(ns,jobs,reserve=0,protectedWork=false) {
 return protectedWork?[]:jobs.filter(job=>job.filename.replace(/^\//,'')!=='stats.js'&&automationReloadReady(ns,job,reserve));
}

/** Only independent controllers may reload during soft protected work. Hard locks remain global. */
export function controllerReloadBlocked(script,{protectedWork=false,globalProtection=false,drainProtected=false}={}) {
 const name=script.replace(/^\//,'');
 if(name==='stats.js')return false;
 if(globalProtection||name==='daemon.js'&&drainProtected)return true;
 return protectedWork&&!['stockmaster.js','gangs.js','corporation-manager.js'].includes(name);
}

/** Explain native activation checks without stopping anything or relaxing reserved RAM. */
export function supervisorHandoffStatus(ns,plan,{reserve=0,blocked=false}={}) {
 if(plan.state!=='ready')return plan;
 if(blocked)return {...plan,state:'waiting-activity',reason:'Waiting for an activity lock or pause to clear'};
 try{
  const old=ns.getRunningScript(ns.pid);if(!old)return {...plan,state:'waiting-process',reason:'Cannot verify the supervisor RAM usage'};
  const free=ns.getServerMaxRam('home')-ns.getServerUsedRam('home'),newRam=ns.getScriptRam(ns.getScriptName(),'home');
  const fits=automationReloadFits({free,newRam,oldRam:old.ramUsage,threads:old.threads,reserve});
  const availableRam=free+old.ramUsage*old.threads,requiredRam=newRam*old.threads+reserve;
  return {...plan,state:fits?'ready':'waiting-ram',reason:fits?'Ready to activate':'Waiting for home RAM while preserving helper headroom',availableRam,requiredRam,shortfallRam:Math.max(0,requiredRam-availableRam)};
 }catch{return {...plan,state:'waiting-process',reason:'Cannot verify native RAM requirements'};}
}
