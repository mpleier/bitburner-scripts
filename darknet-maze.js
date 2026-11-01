import {navigatorReportFile,mazeCheckpointFile,mazeMovementReport,mazeResizePlan} from './darknet-navigator-policy.js';
import {restoreLabyrinthProgress,packLabyrinthProgress,observeLabyrinth,nextLabyrinthMove,labyrinthRadarDue,recordLabyrinthEdge,labyrinthRouteDistance,mazeRecoveryTransition} from './darknet-labyrinth-policy.js';
import {readMazeLease} from './darknet-development-policy.js';
/** A completed maze can leave reward caches on the labyrinth or the navigating host. */
export async function claimRewardCaches(ns,target,self){
 const cacheFile='darknet-cache.js';
 const dependencies=[cacheFile,'darknet-reward-policy.js','tasks/dnet-cache-context.json'];
 for(const host of [...new Set([target,self])]){
  let caches=[];try{caches=ns.ls(host,'.cache');}catch{}
  if(!caches.length)continue;
  // A newly solved labyrinth may not have the opener yet. Deploy it from home
  // before giving up and falling back to the local openCache call.
  try{
   if(!dependencies.every(file=>ns.fileExists(file,host))&&typeof ns.scp==='function'&&typeof ns.fileExists==='function')
    await ns.scp(dependencies,host,'home');
  }catch{}
  if(typeof ns.fileExists==='function'&&ns.fileExists(cacheFile,host)&&typeof ns.exec==='function'){
   try{if(ns.exec(cacheFile,host,1)>0)continue;}catch{}
  }
  if(host===self)for(const file of caches)try{ns.dnet.openCache(file,true);}catch{}
 }
}
/** Persistent per-PID navigation. Routine scout rollouts deliberately leave this worker alive. */
export async function main(ns){
 ns.disableLog('ALL');const [target,rawScope]=ns.args,self=ns.getHostname(),leasePid=Number(ns.args[3])||null;let scope;
 try{scope=JSON.parse(rawScope);}catch{return;}
 if(!Array.isArray(scope)||scope[2]!==target||scope[3]!=='(The Labyrinth)')return;
 const lastResize=Number(ns.args[2])||Date.now();let nextResizeCheck=lastResize+120000;
 const reportFile=navigatorReportFile(self,target),checkpoint=mazeCheckpointFile(target),threads=ns.getRunningScript()?.threads||1;
 let state={},report=null,owned=false,lastPublish=0,lastSaved='',progressAt=0,moves=0,batchMoves=0,batchAt=Date.now(),lastDuration=10000,lastRadar=-Infinity,radarMoves=-Infinity,lastCheckpointAt=0,savedMoves=0,savedEnd=null,phase='waiting',inFlight=false,expectedMs=0,firstPosition=true,recovery={noRoute:0,loop:0};
 const timing={startedAt:Date.now(),coordinationMs:0,actions:{position:{count:0,ms:0},radar:{count:0,ms:0},move:{count:0,ms:0}},radarCells:0};
 let coordinationDepth=0;
 const coordinate=async action=>{const outer=coordinationDepth++===0,at=Date.now();try{return await action();}finally{coordinationDepth--;if(outer)timing.coordinationMs+=Math.max(0,Date.now()-at);}};
 let permissionAt=-Infinity,permissionValue=false,leaseAt=-Infinity,leaseValue=null;
 const contextValid=()=>{try{const c=JSON.parse(ns.read('tasks/dnet-cache-context.json'));return c.nodeReset===scope[0]&&c.augReset===scope[1];}catch{return false;}};
 const publishImpl=async(force=false)=>{
  if(!force&&Date.now()-lastPublish<15000)return true;
  const at=Date.now(),value={version:1,type:'navigator',host:self,pid:ns.pid,target,scope,at,phase,inFlight,expectedMs,progressAt,moves,threads,timing,coords:report?.coords??null,neighbours:ns.dnet.probe()};
  await ns.write(reportFile,JSON.stringify(value),'w');if(!await ns.scp(reportFile,'home',self)){lastPublish=0;return false;}lastPublish=at;return true;
 };
 const publish=force=>coordinate(()=>publishImpl(force));
 const permittedImpl=async()=>{
  if(Date.now()-permissionAt<250)return permissionValue;
  permissionAt=-Infinity;permissionValue=false;
  for(const file of ['remote-control/paused/darknet-manager.js.txt','tasks/automation-maintenance.json','tasks/achievement-profile.json','tasks/dnet-storm-request.json']){
   if(ns.fileExists(file,'home')){if(!await ns.scp(file,self,'home'))return false;}else if(ns.read(file))await ns.rm(file);
  }
  if(ns.read('remote-control/paused/darknet-manager.js.txt').trim()==='true')return false;
  try{const m=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(m.expiresAt>Date.now()&&ns.isRunning(m.ownerPid))return false;}catch{}
  try{const p=JSON.parse(ns.read('tasks/achievement-profile.json'));if(p.active&&p.nodeReset===scope[0]&&p.disabledScripts?.some(s=>s.split('/').pop()==='darknet-manager.js'))return false;}catch{}
  try{const r=JSON.parse(ns.read('tasks/dnet-storm-request.json'));if(r.id&&r.at<=Date.now()&&Date.now()-r.at<30000)return false;}catch{}
  permissionAt=Date.now();permissionValue=true;return true;
 };
 const permitted=()=>coordinate(permittedImpl);
 const lease=()=>coordinate(async()=>{if(Date.now()-leaseAt<250&&leaseValue?.expiresAt>Date.now())return leaseValue;leaseValue=await readMazeLease(ns,scope);if(!leaseValue&&Number.isSafeInteger(leasePid)&&leasePid>0)leaseValue=await readMazeLease(ns,scope,{host:self,pid:leasePid});leaseAt=Date.now();return leaseValue;});
 const persistImpl=async(force=false)=>{
  if(!force&&state.labEnd===savedEnd&&moves-savedMoves<8&&Date.now()-lastCheckpointAt<30000)return;
  if(!await lease())return;
  const saved=packLabyrinthProgress(state,scope);if(!saved)return;
  const {at,...content}=saved,version=JSON.stringify(content);if(version===lastSaved)return;
  await ns.write(checkpoint,JSON.stringify(saved),'w');if(await ns.scp(checkpoint,'home',self)){lastSaved=version;lastCheckpointAt=Date.now();savedMoves=moves;savedEnd=state.labEnd;}
 };
 const persist=force=>coordinate(()=>persistImpl(force));
 const call=async(name,action)=>{
  if(!contextValid()||!await permitted()||!await lease())return null;
  phase=name;inFlight=true;
  try{expectedMs=ns.formulas.dnet.getAuthenticateTime(ns.dnet.getServerDetails(target),threads,ns.getPlayer());}catch{expectedMs=600000;}
  expectedMs=Math.max(1000,Math.min(600000,Number.isFinite(expectedMs)?expectedMs:60000));
  if(!await publish(true)){inFlight=false;phase='waiting';await ns.sleep(1000);return null;}if(!await lease()){inFlight=false;phase='waiting';await publish(true);return null;}const at=Date.now();
  try{return await action();}finally{lastDuration=Math.max(1,Date.now()-at);timing.actions[name].count++;timing.actions[name].ms+=lastDuration;inFlight=false;phase='navigating';await publish();}
 };
 try{expectedMs=ns.formulas.dnet.getAuthenticateTime(ns.dnet.getServerDetails(target),threads,ns.getPlayer());if(!Number.isFinite(expectedMs)||expectedMs<=0)expectedMs=0;}catch{}
 try{
  await publish(true);
  while(contextValid()){
   if(!ns.dnet.probe().includes(target))break;
   const details=ns.dnet.getServerDetails(target);
   if(ns.hasRootAccess(target)){
    phase='complete';
    await persist(true).catch(()=>{});
    await publish(true).catch(()=>{});
    await claimRewardCaches(ns,target,self);
    ns.print(target+': labyrinth already completed; reward caches checked.');
    return;
   }
   if(details.modelId!=='(The Labyrinth)'||JSON.stringify([scope[4],scope[5],scope[6]])!==JSON.stringify([details.passwordLength,details.passwordFormat,details.data]))break;
   if(ns.getPlayer().skills.charisma<details.requiredCharismaSkill||!await permitted()){phase='paused';await publish();await ns.sleep(1000);continue;}
   const grant=await lease();
   if(!grant){if(owned||Date.now()-timing.startedAt>120000){phase='yielding';await publish(true);return;}owned=false;report=null;phase='waiting';await publish();await ns.sleep(1000);continue;}
   if(!owned){
    state={};report=null;lastSaved='';
    if(ns.fileExists(checkpoint,'home')){if(!await ns.scp(checkpoint,self,'home')){await ns.sleep(1000);continue;}try{const raw=ns.read(checkpoint);if(raw.length<250000)state=restoreLabyrinthProgress(JSON.parse(raw),scope)||{};}catch{}}
    const saved=packLabyrinthProgress(state,scope);if(saved){const {at,...content}=saved;lastSaved=JSON.stringify(content);}owned=true;
   }
   if(!report){report=await call('position',()=>ns.dnet.labreport());if(!report?.success||!Array.isArray(report.coords)||report.coords.length!==2||!report.coords.every(Number.isSafeInteger)){report=null;await ns.sleep(1000);continue;}if(firstPosition){state.labEntrance=report.coords.join(',');firstPosition=false;}}
   const geometryBefore=JSON.stringify([state.labMap,state.labEnd]);
   const before=JSON.stringify([state.labMap,[...(state.labVisited||[])],state.labEnd]);
   observeLabyrinth(state,report);
   if(Date.now()>=nextResizeCheck&&typeof ns.spawn==='function'){
    nextResizeCheck=Date.now()+120000;
    try{
     const ram=ns.getScriptRam('darknet-maze.js',self),available=Math.min(64,Math.floor((ns.getServerMaxRam(self)-ns.getServerUsedRam(self)+ram*threads)/ram));
     const frontier=Object.keys(state.labMap||{}).filter(k=>!state.labVisited?.has(k)).length;
     let remainingMoves=0;
     if(state.labEnd){const end=state.labEnd.split(',').map(Number),knownRemaining=labyrinthRouteDistance(state,report.coords.join(','),state.labEnd);remainingMoves=Number.isInteger(knownRemaining)&&knownRemaining>0?knownRemaining:Math.ceil((Math.abs(end[0]-report.coords[0])+Math.abs(end[1]-report.coords[1]))/2);}
     else remainingMoves=frontier; // Each mapped-but-unvisited room needs at least one move.
     const retraceMoves=labyrinthRouteDistance(state,state.labEntrance,report.coords.join(','));
     const resize=mazeResizePlan({currentThreads:threads,available,quote:n=>ns.formulas.dnet.getAuthenticateTime(details,n,ns.getPlayer()),remainingMoves,retraceMoves});
     if(resize){await persist(true);const saved=packLabyrinthProgress(state,scope),{at,...content}=saved||{};const checkpointReady=!!saved&&JSON.stringify(content)===lastSaved&&lastCheckpointAt>0;if(checkpointReady&&await permitted()&&await lease()){phase='resizing';await publish(true);const spawned=ns.spawn('darknet-maze.js',{threads:resize.threads,spawnDelay:100},target,rawScope,Date.now(),ns.pid);if(spawned!==0)return;phase='navigating';await publish(true);}}
    }catch(error){ns.print('Maze resize deferred: '+String(error));}
   }
   let radar=null;
   const mean=name=>timing.actions[name].count?timing.actions[name].ms/timing.actions[name].count:0;
   if(labyrinthRadarDue(state,report.coords,Date.now(),lastRadar,moves-radarMoves,{moveMs:mean('move'),radarMs:mean('radar'),samples:timing.actions.radar.count,cellsPerScan:timing.actions.radar.count?timing.radarCells/timing.actions.radar.count:0})){radar=await call('radar',()=>ns.dnet.labradar());if(radar){lastRadar=Date.now();radarMoves=moves;}}
   const cellsBefore=Object.keys(state.labMap||{}).length;
   observeLabyrinth(state,report,radar);
   if(radar)timing.radarCells+=Math.max(0,Object.keys(state.labMap||{}).length-cellsBefore);
   if(JSON.stringify([state.labMap,[...(state.labVisited||[])],state.labEnd])!==before){progressAt=Date.now();state.labRecentEdges=[];}
   if(JSON.stringify([state.labMap,state.labEnd])!==geometryBefore)recovery=mazeRecoveryTransition(recovery,'progress');
   await persist();
   let direction=nextLabyrinthMove(state,report.coords);
   if(!direction){
    recovery=mazeRecoveryTransition(recovery,'no-route');if(recovery.stop){phase='stalled';await publish(true);break;}
    state.labVisited=new Set([report.coords.join(',')]);state.labEnd=null;lastRadar=-Infinity;radarMoves=-Infinity;await persist(true);continue;
   }
   // A batch limits dispatched moves, never blocks a move because earlier reads were slow.
   if(batchMoves>=8||Date.now()-batchAt>=Math.max(60000,lastDuration*4)){await persist();await ns.sleep(100);batchMoves=0;batchAt=Date.now();}
   const result=await call('move',()=>ns.dnet.authenticate(target,direction));if(!result){report=null;continue;}
   batchMoves++;
   if(result.success){
    if(typeof result.data==='string'){
     const file='tasks/credentials-report-navigator-'+ns.pid+'.json',at=Date.now();
     await ns.write(file,JSON.stringify({schema:1,version:at+':'+ns.pid,entries:[[target,result.data,at]]}),'w');await ns.scp(file,'home',self);
    }
    phase='complete';await persist(true);await publish(true);await claimRewardCaches(ns,target,self);ns.print(target+': labyrinth completed.');return;
   }
   const next=mazeMovementReport(result,report,direction);
   if(next&&next.coords.some((n,i)=>n!==report.coords[i])){moves++;progressAt=Date.now();}
   const loop=next?recordLabyrinthEdge(state,report.coords,next.coords,direction):null;
   if(loop?.refresh){recovery=mazeRecoveryTransition(recovery,'loop');await persist(true);report=null;lastRadar=-Infinity;radarMoves=-Infinity;if(recovery.stop){phase='stalled';await publish(true);break;}}else report=next;await ns.sleep(1);
  }
 }catch(error){phase='error';ns.print('Maze navigator deferred: '+String(error));}
 finally{inFlight=false;try{await persist(true);await publish(true);}catch{}}
}
