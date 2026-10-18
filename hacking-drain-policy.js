/** Drain owned looping workers in phases; recovery always follows the final attack. */
export function hackingWorker(p) {
 const name=p.filename.replace(/^\//,''),weak=name==='Remote/weak-target.js';
 if(!['Remote/hack-target.js','Remote/manualhack-target.js','Remote/grow-target.js','Remote/weak-target.js'].includes(name))return null;
 const args=p.args||[],loop=args[weak?5:6],owner=args[weak?6:7];
 if(!Number.isSafeInteger(owner)||owner<=0||typeof args[0]!=='string')return null;
 let meta;try{meta=JSON.parse(args[weak?7:8]);}catch{}
 return {...p,meta,target:args[0],owner,loop:loop===true||loop===1,tool:weak?'weaken':name==='Remote/grow-target.js'?'grow':'hack',protocol:meta?.drainProtocol===1};
}
export function hackingLoopWorker(p) {const worker=hackingWorker(p);return worker?.loop?worker:null;}
export function advanceHackingDrain(entry,workers,now) {
 const next={...entry};
 if(next.stage==='attack'&&!workers.some(w=>w.tool==='hack')){next.stage='grow';next.stageAt=now;}
 else if(next.stage==='grow'&&!workers.some(w=>w.tool==='grow')){next.stage='weaken';next.stageAt=now;}
 else if(next.stage==='weaken'&&!workers.length){next.stage='complete';next.stageAt=now;}
 return next;
}
/** Self-contained: copied into workers so remote execution needs no new imports. */
export function hackingLoopShouldStop(ns,owner,target,tool,lastCompleted,meta) {
 if(!owner||typeof ns.read!=='function')return false;
 let plan;try{plan=JSON.parse(ns.read('tasks/hgw-drain-'+owner+'.json'));}catch{return false;}
 if(plan?.ownerPid!==owner||plan.nodeReset!==meta?.nodeReset||plan.augReset!==meta?.augReset)return false;
 const entry=plan.targets?.[target];if(!entry||!Number.isFinite(entry.stageAt))return false;
 if(tool==='hack')return ['attack','grow','weaken','complete'].includes(entry.stage);
 if(tool==='grow')return ['grow','weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
 return tool==='weaken'&&['weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
}
export async function coordinateHackingDrain(ns,hosts,reset,now=Date.now(),{checkCapacity=false}={}) {
 if(typeof ns.getHostname==='function'&&ns.getHostname()!=='home')return null;
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},file='tasks/hgw-drain-'+ns.pid+'.json';
 const saved=read(file),valid=saved?.ownerPid===ns.pid&&saved.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset;
 const targets=valid?{...saved.targets}:{};
 const stockFile='tasks/hgw-stock-drain-'+ns.pid+'.json',stockRequest=read(stockFile);
 const stockTargets=stockRequest?.ownerPid===ns.pid&&stockRequest.nodeReset===reset.lastNodeReset&&stockRequest.augReset===reset.lastAugReset&&stockRequest.at<=now&&Array.isArray(stockRequest.targets)?stockRequest.targets.filter(t=>typeof t==='string').slice(0,128):[];
 const acknowledged=new Set(stockTargets.filter(t=>targets[t]));
 const request=read('tasks/home-ram-reclaim.json');
 const pressure=request?.at<=now&&now-request.at<30000&&!request.satisfied&&Number.isFinite(request.target)&&ns.isRunning(request.ownerPid)&&
  ns.getServerMaxRam('home')-ns.getServerUsedRam('home')<request.target;
 if(!pressure&&!stockTargets.length&&!Object.keys(targets).length&&!checkCapacity)return null;
 if(valid&&now>=saved.at&&now-saved.at<1000)return {...saved,completed:[]};
 const workers=[];let incomplete=false;
 for(const host of [...new Set(['home',...hosts])])try{for(const p of ns.ps(host)){const worker=hackingWorker({...p,host});if(worker?.owner===ns.pid)workers.push(worker);}}catch{incomplete=true;}
 let capacity=null;
 if(checkCapacity&&!incomplete){
  const capacityFile='tasks/hgw-capacity-'+ns.pid+'.json',old=read(capacityFile);
  const previous=old?.ownerPid===ns.pid&&old.nodeReset===reset.lastNodeReset&&old.augReset===reset.lastAugReset&&old.at<=now?old.jobs:{};
  capacity=hackingLoopCapacity(workers,ns.pid,reset,previous,Object.keys(targets));
  await ns.write(capacityFile,JSON.stringify({at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,jobs:capacity.jobs}),'w');
 }
 const damagedTargets=capacity?.targets||[];
 let unsupported=0;
 if((pressure||stockTargets.length||damagedTargets.length)&&!incomplete&&!Object.values(targets).some(t=>t.stage!=='complete')){
  const homeTargets=pressure?workers.filter(w=>w.host==='home'&&w.loop&&!targets[w.target]).map(w=>w.target):[];
  const choices=[...new Set([...damagedTargets.filter(t=>!targets[t]),...homeTargets,...stockTargets.filter(t=>!targets[t])])];
  for(const target of choices){const group=workers.filter(w=>w.target===target);if(!group.length){acknowledged.add(target);continue;}if(group.some(w=>w.loop&&(!w.protocol||w.meta?.nodeReset!==reset.lastNodeReset||w.meta?.augReset!==reset.lastAugReset))){unsupported++;continue;}
   acknowledged.add(target);
   targets[target]={stage:'attack',stageAt:now,startedAt:now,reason:damagedTargets.includes(target)?'missing-loop-capacity':stockTargets.includes(target)?'stock-transition':'home-ram',hosts:[...new Set(group.map(w=>w.host))]};break;}
 }
 const completed=[];
 if(!incomplete)for(const [target,entry]of Object.entries(targets)){
  const next=advanceHackingDrain(entry,workers.filter(w=>w.target===target),now);targets[target]=next;
  if(entry.stage!=='complete'&&next.stage==='complete')completed.push(target);
  if(next.stage==='complete'&&!pressure)targets[target]={...next,stage:'clearing'};
 }
 const capacitySummary=capacity?{observedGroups:capacity.observedGroups,untrackedGroups:capacity.untrackedGroups,unknownGroups:capacity.unknownGroups,damaged:capacity.damaged.slice(0,32),queuedTargets:damagedTargets.filter(t=>!targets[t])}:null;
 const plan={capacity:capacitySummary,at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,targets};
 await ns.write(file,JSON.stringify(plan),'w');
 const errors=[],changed=!valid||JSON.stringify(saved.targets)!==JSON.stringify(targets);
 // Never advance based on copies succeeding: native ps is the acknowledgement that workers exited.
 for(const host of new Set(Object.values(targets).flatMap(t=>t.hosts||[])))if(host!=='home'&&(changed||saved?.copyErrors?.includes(host)))try{if(!await ns.scp(file,host,'home'))errors.push(host);}catch{errors.push(host);}
 plan.copyErrors=errors;
 if(!incomplete&&!errors.length){for(const [target,entry]of Object.entries(targets))if(entry.stage==='clearing')delete targets[target];}
 await ns.write(file,JSON.stringify(plan),'w');
 if(acknowledged.size&&stockTargets.length){const current=read(stockFile);if(current?.ownerPid===ns.pid&&current.nodeReset===reset.lastNodeReset&&current.augReset===reset.lastAugReset&&Array.isArray(current.targets))await ns.write(stockFile,JSON.stringify({...current,targets:current.targets.filter(t=>!acknowledged.has(t))}),'w');}
 const result={...plan,completed,pressure,unsupported,incomplete,copyErrors:errors,stockQueued:stockTargets.filter(t=>!acknowledged.has(t))};
 await ns.write('tasks/hgw-drain-status.json',JSON.stringify(result),'w');return result;
}

/** Reloading the owner during a drain would strand its recovery phases. */
export function hackingDrainActive(record,reset,processes,now=Date.now()) {
 return !!(record?.nodeReset===reset.lastNodeReset&&record.augReset===reset.lastAugReset&&Number.isFinite(record.at)&&record.at<=now&&
  processes.some(p=>p.pid===record.ownerPid&&p.filename.replace(/^\//,'')==='daemon.js')&&
  Object.values(record.targets||{}).some(t=>['attack','grow','weaken'].includes(t?.stage)));
}

/** Stock reversals only affect this controller's requested attack tool. Recovery is never killed. */
export function stockHackingTransitions(processes,owner,targets,toolName) {
 const name=toolName.replace(/^\//,''),wanted=new Set(targets);
 return processes.map(hackingWorker).filter(w=>w&&w.owner===owner&&wanted.has(w.target)&&w.filename.replace(/^\//,'')===name&&
  (w.loop||w.args[4]===true||w.args[4]===1));
}
export async function requestStockHackingDrain(ns,processes,targets,toolName,reset,now=Date.now()) {
 const affected=stockHackingTransitions(processes,ns.pid,targets,toolName),file='tasks/hgw-stock-drain-'+ns.pid+'.json';
 if(!affected.length)return [];
 let saved;try{saved=JSON.parse(ns.read(file));}catch{}
 const prior=saved?.ownerPid===ns.pid&&saved.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset&&Array.isArray(saved.targets)?saved.targets:[];
 const names=[...new Set(affected.map(w=>w.target))];
 await ns.write(file,JSON.stringify({at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,targets:[...new Set([...prior,...names])].slice(0,128)}),'w');
 return names;
}
/** Reconcile native state instead of decrementing positional argument guesses. */
export function ownedHackingLoopCounts(processes,owner) {
 const hacks={},grows={},weakens={},groups=new Set();
 for(const process of processes){const w=hackingLoopWorker(process);if(!w||w.owner!==owner)continue;
  const key=JSON.stringify([w.target,w.tool,w.args[1],w.args[2],w.args[3]]);
  if(w.tool!=='hack'&&groups.has(key))continue;groups.add(key);
  const dict=w.tool==='hack'?hacks:w.tool==='grow'?grows:weakens;
  dict[w.target]=(dict[w.target]||0)+(w.tool==='hack'?Math.max(0,w.threads||0):1);
 }
 return {hacks,grows,weakens};
}

/** All fragments receive one immutable expected group size before any are launched. */
export function withHackingLoopCapacity(args,tool,threads,jobId) {
 if(!Array.isArray(args)||!['hack','manualhack','grow','weak'].includes(tool)||!Number.isSafeInteger(threads)||threads<=0||typeof jobId!=='string'||!jobId.length||jobId.length>120)return args;
 const weak=tool==='weak',index=weak?7:8;
 if(![true,1].includes(args[weak?5:6])||!Number.isSafeInteger(args[weak?6:7])||args[weak?6:7]<=0)return args;
 let meta;try{meta=JSON.parse(args[index]);}catch{return args;}
 if(meta?.drainProtocol!==1||!Number.isFinite(meta.nodeReset)||!Number.isFinite(meta.augReset))return args;
 const next=args.slice();next[index]=JSON.stringify({...meta,capacityVersion:1,jobId,expectedThreads:threads});return next;
}

/** Previous known groups reveal complete loss too; legacy jobs remain unmeasurable. */
export function hackingLoopCapacity(processes,owner,reset,previous={},ignoredTargets=[]) {
 const ignored=new Set(ignoredTargets),groups=new Map(),seen=new Set(),activeTargets=new Set();let unknownGroups=0;
 for(const p of processes){
  const w=hackingWorker(p);if(!w||w.owner!==owner)continue;activeTargets.add(w.target);if(!w.loop)continue;
  if(ignored.has(w.target))continue;
  const m=w.meta;
  if(!w.protocol||m?.capacityVersion!==1||typeof m.jobId!=='string'||!m.jobId.length||m.jobId.length>120||
   !Number.isSafeInteger(m.expectedThreads)||m.expectedThreads<=0||m.nodeReset!==reset.lastNodeReset||m.augReset!==reset.lastAugReset||!Number.isSafeInteger(w.threads)||w.threads<=0){unknownGroups++;continue;}
  const identity=JSON.stringify([w.host||'',w.pid]);if(seen.has(identity))continue;seen.add(identity);
  const g=groups.get(m.jobId)||{jobId:m.jobId,target:w.target,tool:w.tool,expectedThreads:m.expectedThreads,liveThreads:0,conflict:false};
  if(g.target!==w.target||g.tool!==w.tool||g.expectedThreads!==m.expectedThreads)g.conflict=true;
  g.liveThreads+=w.threads;groups.set(m.jobId,g);
 }
 for(const [id,old]of Object.entries(previous||{}))if(!groups.has(id)&&!ignored.has(old?.target)&&activeTargets.has(old?.target)&&
  old.jobId===id&&Number.isSafeInteger(old.expectedThreads)&&old.expectedThreads>0&&['hack','grow','weaken'].includes(old.tool))groups.set(id,{...old,liveThreads:0});
 const all=[...groups.values()],damaged=all.filter(g=>g.conflict||g.liveThreads!==g.expectedThreads);
 const damagedIds=new Set(damaged.map(g=>g.jobId));
 const jobs=Object.fromEntries([...damaged,...all.filter(g=>!damagedIds.has(g.jobId))].slice(0,2048).map(g=>[g.jobId,g]));
 return {jobs,damaged,unknownGroups,observedGroups:all.length,untrackedGroups:Math.max(0,all.length-Object.keys(jobs).length),targets:[...new Set(damaged.map(g=>g.target))]};
}

/** Commit only completely launched batches before the first inventory can lose a group. */
export async function commitHackingCapacity(ns,reset,jobs,now=Date.now()) {
 if(!jobs.length)return true;
 const file='tasks/hgw-capacity-'+ns.pid+'.json';let old;
 try{old=JSON.parse(ns.read(file));}catch{}
 const prior=old?.ownerPid===ns.pid&&old.nodeReset===reset.lastNodeReset&&old.augReset===reset.lastAugReset&&old.at<=now?old.jobs:{};
 const merged={...prior};
 for(const job of jobs){
  if(typeof job.jobId!=='string'||!job.jobId.length||job.jobId.length>120||typeof job.target!=='string'||!['hack','grow','weaken'].includes(job.tool)||!Number.isSafeInteger(job.expectedThreads)||job.expectedThreads<=0)return false;
  merged[job.jobId]={...job,liveThreads:job.expectedThreads,conflict:false};
 }
 // Refuse an untracked batch rather than silently losing its recovery contract.
 if(Object.keys(merged).length>2048)return false;
 await ns.write(file,JSON.stringify({at:now,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,jobs:merged}),'w');return true;
}
