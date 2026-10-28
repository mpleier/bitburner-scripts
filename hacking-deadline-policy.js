/** Piggyback on the existing synchronous process inventory; never scans hosts itself. */
export function recordHackingDeadline(snapshot,p){
 const match=/^\/?Remote\/(hack|grow|weak|manualhack)-target\.js$/.exec(p.filename||'');if(!match)return;
 const args=p.args||[],target=args[0];if(typeof target!=='string'||!target||target.length>100){snapshot.complete=false;return;}
 let row=snapshot.targets[target];
 if(!row){if(Object.keys(snapshot.targets).length>=64){snapshot.complete=false;return;}row=snapshot.targets[target]={workers:0,known:0,latestDeadline:null,uncertain:false};}
 row.workers++;
 try{
  const weak=match[1]==='weak',owner=args[weak?6:7],loop=args[weak?5:6],raw=args[weak?7:8];
  if(match[1]==='manualhack'||owner!==snapshot.ownerPid||![false,0].includes(loop)||typeof raw!=='string'||raw.length>30000)throw Error('Unclassified worker');
  const meta=JSON.parse(raw),tool=weak?'weaken':match[1],deadline=args[1]+args[2];
  const prefix=[snapshot.nodeReset,snapshot.augReset,snapshot.ownerPid].join(':')+':';
  if(meta?.batchVersion!==1||meta.port!==20||meta.nodeReset!==snapshot.nodeReset||meta.augReset!==snapshot.augReset||typeof meta.batchId!=='string'||meta.batchId.length>160||!meta.batchId.startsWith(prefix)||meta.batchTarget!==target||!Array.isArray(meta.batchPlan)||meta.batchPlan.length<1||meta.batchPlan.length>5||!Number.isSafeInteger(p.pid)||p.pid<=0||!Number.isSafeInteger(p.threads)||p.threads<=0||(meta.physicalThreads??meta.pieceThreads)!==p.threads||!Number.isSafeInteger(meta.pieceThreads)||meta.pieceThreads<p.threads||!Number.isFinite(args[1])||!Number.isFinite(args[2])||args[2]<=0||!Number.isFinite(deadline)||deadline<=snapshot.at)throw Error('Invalid deadline identity');
  const tools={hack:'hack',weak1:'weaken','grow-from-zero':'grow',grow:'grow',weak2:'weaken'};
  if(new Set(meta.batchPlan.map(step=>step?.step)).size!==meta.batchPlan.length||meta.batchPlan.some((step,i)=>!step||tools[step.step]!==step.tool||!Number.isSafeInteger(step.threads)||step.threads<=0||!Number.isFinite(step.deadline)||step.deadline<0||i>0&&step.deadline<=meta.batchPlan[i-1].deadline))throw Error('Invalid batch plan');
  const step=meta.batchPlan.find(step=>step.step===meta.batchStep);
  if(!step||step.tool!==tool||step.deadline!==deadline||step.threads<meta.pieceThreads)throw Error('Mismatched batch step');
  row.known++;row.latestDeadline=Math.max(row.latestDeadline??0,deadline);
 }catch{row.uncertain=true;}
}

/** A padded estimate, never a guarantee that native operations have completed. */
export function estimateHackingDrain(snapshot,target,{now,ownerPid,reset,fallbackMs,paddingMs=250}){
 const fallback=Number.isFinite(fallbackMs)&&fallbackMs>=0?fallbackMs:null;
 const pad=Number.isFinite(paddingMs)&&paddingMs>=250?paddingMs:250;
 const fail=(reason,knownDeadline=null)=>{const knownFloorMs=Number.isFinite(knownDeadline)&&knownDeadline>now?knownDeadline-now+pad:0;return {drainMs:fallback===null?null:Math.max(fallback,knownFloorMs),basis:'full-weaken-fallback',reason,snapshotAt:snapshot?.at??null,paddingMs:pad,knownFloorMs};};
 if(!snapshot||snapshot.schemaVersion!==1||!Number.isSafeInteger(snapshot.hostCount)||snapshot.hostCount<1||!snapshot.targets||typeof snapshot.targets!=='object'||Array.isArray(snapshot.targets)||snapshot.ownerPid!==ownerPid||snapshot.nodeReset!==reset.lastNodeReset||snapshot.augReset!==reset.lastAugReset||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>7500||snapshot.complete!==true||snapshot.invalidated!==false)return fail('Missing, stale, incomplete or invalidated deadline inventory');
 const row=snapshot.targets?.[target];
 if(!row)return {drainMs:0,basis:'empty-inventory',reason:'No HGW workers observed for this target',snapshotAt:snapshot.at,paddingMs:0,workers:0};
 if(row.uncertain||!Number.isSafeInteger(row.workers)||row.workers<1||row.known!==row.workers||!Number.isFinite(row.latestDeadline)||row.latestDeadline<=now)return fail('Uncertain, foreign, looping, legacy or overdue worker',row.latestDeadline);
 return {drainMs:Math.max(0,row.latestDeadline-now)+pad,basis:'worker-deadlines',reason:'All observed target workers have matching future batch deadlines',snapshotAt:snapshot.at,paddingMs:pad,workers:row.workers};
}

/** Bounded current-owner evidence; split workers never inflate the batch sample count. */
export function hackingDrainPadding(data,{now,ownerPid,reset,baseMs=250}){
 const base=Number.isFinite(baseMs)?Math.max(250,baseMs):250;
 const fallback={paddingMs:base,basis:'configured-minimum',batches:0,maxLateMs:null};
 if(!data||data.blocked||data.ownerPid!==ownerPid||data.nodeReset!==reset.lastNodeReset||data.augReset!==reset.lastAugReset||!Number.isFinite(data.at)||data.at>now||now-data.at>15000||!Array.isArray(data.recent))return fallback;
 const samples=mergeHgwDelaySamples(data.delaySamples,data.recent,{now:data.at,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid}).filter(e=>now-e.at<=120000);
 if(samples.length<5||Math.max(...samples.map(e=>e.at))-Math.min(...samples.map(e=>e.at))<1000)return {...fallback,batches:samples.length};
 const maxLateMs=Math.max(...samples.map(e=>e.lateMs));
 return {paddingMs:Math.max(base,Math.ceil(maxLateMs+250)),basis:'observed-batch-delays',batches:samples.length,maxLateMs};
}

/** Bounded representative receipts; a batch maximum keeps its actual observation time. */
export function mergeHgwDelaySamples(prior,events,{now,nodeReset,augReset,ownerPid=null}){
 const batches=new Map();
 for(const e of [...(Array.isArray(prior)?prior.slice(0,64):[]),...(Array.isArray(events)?events.slice(-64):[])]){
  if(!e||!Number.isSafeInteger(e.owner)||e.owner<=0||ownerPid!==null&&e.owner!==ownerPid||e.error||e.batchVersion!==1||typeof e.batchId!=='string'||e.batchId.length>160||!e.batchId.startsWith([nodeReset,augReset,e.owner].join(':')+':')||!['hack','grow','weaken'].includes(e.tool)||!Number.isSafeInteger(e.pid)||e.pid<=0||!Number.isFinite(e.at)||e.at>now||now-e.at>120000||!Number.isFinite(e.deadline)||!Number.isFinite(e.lateMs)||e.lateMs<0||Math.abs(Math.max(0,e.at-e.deadline)-e.lateMs)>2)continue;
  const old=batches.get(e.batchId);
  if(!old||e.lateMs>old.lateMs||e.lateMs===old.lateMs&&e.at>old.at)batches.set(e.batchId,{batchVersion:1,batchId:e.batchId,owner:e.owner,pid:e.pid,tool:e.tool,at:e.at,deadline:e.deadline,lateMs:e.lateMs});
 }
 return [...batches.values()].sort((a,b)=>b.at-a.at||a.batchId.localeCompare(b.batchId)).slice(0,64);
}
