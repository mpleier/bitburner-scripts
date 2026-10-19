import {currentCloudPurchase} from './cloud-status-policy.js';
import {collectControllerDiagnostics} from './diagnostic-cadence-policy.js';
import {upgradeRemoteWorker} from './remote-worker-policy.js';
import {commandPolicyVersion} from './remote-api-command.js';
import {boundedDiagnostics} from './diagnostics-policy.js';
import {hackingDrainActive} from './hacking-drain-policy.js';
import {collectHashSpendingStatus} from './hash-spending-policy.js';
import {homeRamReserve,reclaimHomeRam} from './home-ram-policy.js';
import {supervisorHandoffStatus,controllerReloadBlocked,automationReloadReady,maintenanceReloadJobs,supervisorUpdatePlan,handoffSupervisor,registerAutomation,automationHeartbeat,watchedScripts,statusFiles,runtimeHash,scriptSignature,recoveryDecision,dashboardRows} from './runtime-policy.js';
import {isScriptPaused} from './automation-control.js';
import {activityRecord} from './activity-coordination.js';
import {getNsDataThroughFile} from './helpers.js';
import {autopilotSourceFiles} from './autopilot-policy.js';
// Updates use a debounced self-handoff so the supervisor can adopt synchronized dependencies.
export async function main(ns){
 ns.disableLog('ALL');if(ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 registerAutomation(ns);
 const launchedSignature=scriptSignature(ns,ns.getScriptName());
 const reset=ns.getResetInfo(),access=autopilotSourceFiles(reset),seen=new Map(),failures=new Map(),pending=new Map();
 let fileAudit=null,diagnosticState=null;
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 ns.atExit(()=>{try{if(read('tasks/automation-maintenance.json')?.ownerPid===ns.pid)ns.rm('tasks/automation-maintenance.json');}catch{}});
 while(!isScriptPaused(ns,ns.getScriptName())){
  try{
   automationHeartbeat(ns);
   reclaimHomeRam(ns,0,homeRamReserve(ns));
   const now=Date.now(),processes=ns.ps('home'),sourceCache=new Map(),statusCache=new Map();
   const readStatus=file=>{if(!file)return null;if(!statusCache.has(file))statusCache.set(file,read(file));return statusCache.get(file);};
   const livePids=new Set(processes.map(p=>p.pid));for(const pid of seen.keys())if(!livePids.has(pid))seen.delete(pid);for(const [key,history]of failures)if(now-history.at>15*60000)failures.delete(key);
   const drainStatus=read('tasks/hgw-drain-status.json'),drainProtected=hackingDrainActive(drainStatus,reset,processes,now);
   let globalProtection=!!activityRecord(ns)||processes.some(p=>['casino.js','ascend.js'].includes(p.filename));
   const transition=read('tasks/progression-transition.json');globalProtection ||= transition?.expiresAt>now&&ns.isRunning(transition.ownerPid);
   let protectedWork=globalProtection,protectionKnown=true;
   if(access[4])try{const black=access[7]||access[6];protectedWork ||= await getNsDataThroughFile(ns,'["GRAFTING","CREATE_PROGRAM"].includes(ns.singularity.getCurrentWork()?.type)'+(black?' || (ns.bladeburner.inBladeburner()&&/black/i.test(ns.bladeburner.getCurrentAction()?.type||""))':''),'/Temp/reliability-protection.txt');}catch{protectedWork=true;protectionKnown=false;}
   const selfCandidate=supervisorUpdatePlan({previous:read('tasks/reliability-self-update.json'),launchedSignature,
    currentSignature:scriptSignature(ns,ns.getScriptName(),sourceCache),reset,now,protectedWork:globalProtection||!protectionKnown,pendingRestores:[...pending.values()].some(job=>job.stopped),paused:isScriptPaused(ns,ns.getScriptName())});
   const selfUpdate=supervisorHandoffStatus(ns,selfCandidate,{reserve:homeRamReserve(ns),blocked:!!activityRecord(ns)||isScriptPaused(ns,ns.getScriptName())});
   ns.write('tasks/reliability-self-update.json',JSON.stringify({...selfUpdate,pid:ns.pid}),'w');
   if(handoffSupervisor(ns,selfUpdate,{reserve:homeRamReserve(ns),blocked:!!activityRecord(ns)||isScriptPaused(ns,ns.getScriptName())}))return;
   const workerUpgrade=upgradeRemoteWorker(ns,{policy:commandPolicyVersion,signature:scriptSignature(ns,'remote-api-agent.js',sourceCache),reset,now,reserve:homeRamReserve(ns),blocked:globalProtection||!protectionKnown});
   const reloadBlocked=script=>controllerReloadBlocked(script,{protectedWork,globalProtection:globalProtection||!protectionKnown,drainProtected});
   const signatures=new Map(),rows=[];
   for(const p of processes.filter(p=>watchedScripts.includes(p.filename.replace(/^\//,'')))){
    const script=p.filename.replace(/^\//,'');if(!seen.has(p.pid)){let observed=now;if(script==='stats.js')try{observed=now-Math.max(0,ns.getRunningScript(p.pid)?.onlineRunningTime||0)*1000;}catch{}seen.set(p.pid,observed);}
    if(!signatures.has(script))signatures.set(script,scriptSignature(ns,p.filename,sourceCache));
    const key=script+JSON.stringify(p.args)+':'+signatures.get(script),history=failures.get(key)||{count:0,at:now};if(now-history.at>15*60000){history.count=0;history.at=now;}
    const status=readStatus(statusFiles[script]||(script==='stats.js'?'tasks/overview-status.json':null));
    const decision=recoveryDecision({record:read('tasks/runtime/'+p.pid+'.json'),signature:signatures.get(script),observedAt:seen.get(p.pid),now,paused:isScriptPaused(ns,p.filename),protectedWork:reloadBlocked(script),attempts:history.count,statusAt:(status?.pid===p.pid||status?.ownerPid===p.pid)?status.at:null,script});
    rows.push({script,pid:p.pid,decision});
    if(['reload','restart-stalled','deferred-protected-work'].includes(decision))pending.set(p.pid,{...p,key,signature:signatures.get(script),history});
    if(['paused','healthy','starting','recovery-limit'].includes(decision))pending.delete(p.pid);
   }
   for(const [pid,job]of pending){if(!processes.some(p=>p.pid===pid)&&!job.stopped)pending.delete(pid);}
   const workPending=maintenanceReloadJobs(ns,[...pending.values()].filter(job=>!drainProtected||job.filename.replace(/^\//,'')!=='daemon.js'),homeRamReserve(ns),protectedWork);
   if(workPending.length)ns.write('tasks/automation-maintenance.json',JSON.stringify({ownerPid:ns.pid,expiresAt:now+30000,scripts:workPending.map(p=>p.filename)}),'w');else ns.rm('tasks/automation-maintenance.json');
   for(const [pid,job]of [...pending].sort((a,b)=>Number(b[1].filename==='infiltration-manager.js')-Number(a[1].filename==='infiltration-manager.js'))){
    if(reloadBlocked(job.filename))continue;
    if(drainProtected&&job.filename.replace(/^\//,'')==='daemon.js')continue;
    if(job.stopped&&ns.ps('home').some(p=>p.filename===job.filename&&(job.filename!=='spend-hacknet-hashes.js'||JSON.stringify(p.args)===JSON.stringify(job.args)))){pending.delete(pid);continue;}
    if(activityRecord(ns)&&job.filename!=='stats.js')break;
    if(isScriptPaused(ns,job.filename)){pending.delete(pid);continue;}
    if(!automationReloadReady(ns,job,homeRamReserve(ns)))continue;
    if(!job.stopped&&!ns.kill(pid))continue;job.stopped=true;
    const replacement=ns.run(job.filename,job.threads,...job.args);job.history.count++;failures.set(job.key,job.history);
    if(replacement){pending.delete(pid);ns.print('Activated '+job.filename+' (pid '+replacement+').');}else if(job.history.count>=3){pending.delete(pid);ns.print('Could not restore '+job.filename+'; recovery limit reached.');}
    break; // One restart per pass leaves room for startup and priority work.
   }
   // Retain bounded native logs for API diagnostics, including caught errors hidden by health summaries.
   diagnosticState=collectControllerDiagnostics(ns,ns.ps('home').filter(p=>watchedScripts.includes(p.filename.replace(/^\//,''))||['remote-api-agent.js','stats.js','reliability-manager.js'].includes(p.filename.replace(/^\//,''))),diagnosticState,now);
   const logs=diagnosticState.logs;
   // Compare script contents without returning source code or runtime data over the status channel.
   if(!fileAudit||now-fileAudit.at>=60000){
    const names=ns.ls('home');
    const files=names.filter(name=>/\.(js|ns|script)$/.test(name)||name==='darknet-candidates.txt').filter(name=>!name.split('/').some(part=>['Temp','temp','tasks','remote-control','node_modules'].includes(part))).map(filename=>{const content=ns.read(filename);return {filename,length:content.length,hash:runtimeHash(content)};});
    fileAudit={at:now,host:'home',files,allNames:names};
   }
   const dashboard={cloud:currentCloudPurchase(read('tasks/cloud-purchase-status.json'),reset,now),diagnostics:{at:now,detailAt:diagnosticState.detailAt,nextDetailAt:diagnosticState.detailAt+60000,trackedProcesses:diagnosticState.trackedProcesses,omittedProcesses:diagnosticState.omittedProcesses,warnings:diagnosticState.warnings},workerUpgrade,hackingDrain:drainStatus,drainProtected,supervisorUpdate:selfUpdate,homeRamReclaim:(r=>r?.at<=now&&now-r.at<30000&&livePids.has(r.ownerPid)?r:null)(read('tasks/home-ram-reclaim.json')),hashSpending:collectHashSpendingStatus(ns,now),hgw:read('tasks/hgw-misfires.json'),logs,fileAudit,nodeRoute:read('tasks/node-route-plan.json'),overview:read('tasks/overview-status.json'),at:now,ownerPid:ns.pid,node:reset.currentNode,recovery:rows,pending:[...pending.values()].map(p=>p.filename),managers:dashboardRows(ns.ps('home'),readStatus,now),achievements:readStatus('tasks/achievement-status.json')&&{known:readStatus('tasks/achievement-status.json').known,unlocked:readStatus('tasks/achievement-status.json').unlocked?.length},contracts:{...read('tasks/contracts-status.json'),results:(r=>Number.isFinite(r?.at)&&r.at>=reset.lastAugReset&&r.at<=now?r:null)(read('tasks/contracts-results.json'))},validation:read('tasks/contract-validation.json'),speed:read('tasks/progression-speed.json'),budgets:read('tasks/spending-plan.json'),backup:read('tasks/reset-backup-status.json')};
   ns.rm('tasks/reliability-error.json');
   if(diagnosticState.detailDue)ns.write('tasks/dashboard.json',JSON.stringify(dashboard),'w');
   const summary=boundedDiagnostics({...dashboard,logs:undefined,fileAudit:undefined},false,30000);
   Object.assign(summary,{schemaVersion:1,at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset});
   ns.write('tasks/dashboard-summary.json',JSON.stringify(summary),'w');
  }catch(error){ns.write('tasks/reliability-error.json',JSON.stringify({at:Date.now(),error:String(error)}),'w');}
  await ns.sleep(10000);
 }
}
