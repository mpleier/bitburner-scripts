/** Reports older than a day are disposable observations, never credentials. */
export async function readDarknetReports(ns, now=Date.now()) {
 const surveys=[],heartbeats=[],navigators=[],processCache=new Map();let removed=0;
 for(const file of ns.ls('home','tasks/dnet-')){
  const survey=file.startsWith('tasks/dnet-survey-'),navigator=file.startsWith('tasks/dnet-navigator-');
  if(!survey&&!/^tasks\/dnet-[^/]+\.json$/.test(file))continue;
  try{
   const r=JSON.parse(ns.read(file));
   if(typeof r.host!=='string'||!Number.isSafeInteger(r.pid)||r.pid<=0||!Number.isFinite(r.at)||r.at>now||r.version!==((survey||navigator)?1:3))continue;
   const flight=navigator&&r.inFlight===true&&['position','radar','move'].includes(r.phase)&&Number.isFinite(r.expectedMs)&&r.expectedMs>=1000&&r.expectedMs<=600000;
   const overdue=flight&&now-r.at>r.expectedMs*3+120000;
   if(now-r.at>120000&&!flight){if(now-r.at>86400000&&removed<64){await ns.rm(file,'home');removed++;}continue;}
   if(!processCache.has(r.host)){try{processCache.set(r.host,ns.ps(r.host));}catch{processCache.set(r.host,[]);}}
   const processes=processCache.get(r.host);
   if(navigator){
    const worker=processes.find(p=>p.pid===r.pid&&p.filename==='darknet-maze.js'&&p.args?.[0]===r.target&&p.args?.[1]===JSON.stringify(r.scope));
    if(r.type!=='navigator'||!worker||!Array.isArray(r.neighbours)||!r.neighbours.includes(r.target)||!Array.isArray(r.scope)||r.scope[2]!==r.target){if(r.type==='navigator'&&!worker&&now-r.at>86400000&&removed<64){await ns.rm(file,'home');removed++;}continue;}
    if(overdue){ns.kill(r.pid);continue;}
    navigators.push({...r,navigator:true,live:true,reportedAt:r.at,at:now,mazeRequests:[{maze:r.target,scope:r.scope,at:now,progressAt:r.progressAt||0,expectedMs:r.expectedMs,active:flight}]});continue;
   }
   r.live=processes.some(p=>p.pid===r.pid&&p.filename==='darknet-node.js');
   // In-flight recovery is verified here, not trusted from a scout's claim.
   if(survey&&Array.isArray(r.mazeRequests))r.mazeRequests=r.mazeRequests.map(q=>({...q,active:q?.scope?.[3]==='(RAM Recovery)'&&processes.some(p=>p.filename==='darknet-ram.js'&&p.args?.[0]===q.maze&&p.args?.[1]===r.pid&&p.args?.[2]===JSON.stringify(q.scope))}));
   if(survey)surveys.push(r);else if(r.live)heartbeats.push(r);
  }catch{/* Disappearing hosts and incomplete writes are normal. */}
 }
 return {surveys,heartbeats,navigators};
}
export function rotatedTargets(hosts, turn) {
 const rows=[...hosts];if(!rows.length)return rows;
 const start=turn%rows.length;return rows.slice(start).concat(rows.slice(0,start));
}
/** Keep rotation within each priority class; native sessions deploy immediately.
 *  Locked targets with shorter passwords crack faster, so order them first while
 *  preserving rotation for unknown/equal lengths. */
export function prioritizeDarknetTargets(hosts, turn, details) {
 const rows=rotatedTargets(hosts,turn).map((host,index)=>{
  try{const info=details(host);return {host,index,ready:info?.hasSession===true,length:Number.isFinite(info?.passwordLength)?info.passwordLength:Infinity};}
  catch{return {host,index,ready:false,length:Infinity};}
 });
 const ready=rows.filter(r=>r.ready);
 const locked=rows.filter(r=>!r.ready).sort((a,b)=>a.length-b.length||a.index-b.index);
 return ready.concat(locked).map(r=>r.host);
}
export const darknetDeploymentFile='tasks/dnet-deployment.json';
export function readDarknetDeployment(raw,now=Date.now()){
 try{if(raw.length>20000)return null;const r=JSON.parse(raw);
  if(r.version!==1||!Number.isFinite(r.at)||r.at>now||now-r.at>120000||!Array.isArray(r.files)||r.files.length>64||!r.files.includes('darknet-node.js')||!r.files.every(f=>typeof f==='string'&&(/^darknet-[a-z0-9-]+\.(js|txt)$/.test(f)||f==='tasks/dnet-cache-context.json')))return null;
  return [...new Set(r.files)];
 }catch{return null;}
}
export const phishingReportFile=host=>'tasks/dnet-phishing-'+encodeURIComponent(host)+'.json';
/** Native result status only: unrelated income cannot masquerade as phishing revenue. */
export function recordPhishingAttempt(previous,result,{host,pid,threads,reset,started,at}){
 const same=previous?.version===1&&previous.host===host&&previous.pid===pid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.at<=at;
 const old=same?previous:null,valid=n=>Number.isFinite(n)&&n>=0?n:0;
 const code=String(Number.isInteger(result?.code)?result.code:'exception');
 const failures={...(old?.failures||{})};if(result?.success!==true){const key=Object.hasOwn(failures,code)||Object.keys(failures).length<16?code:'other';failures[key]=valid(failures[key])+1;}
 return {version:1,host,pid,threads,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,since:old?.since??started,at,attempts:valid(old?.attempts)+1,successes:valid(old?.successes)+(result?.success===true?1:0),durationMs:valid(old?.durationMs)+Math.max(0,at-started),failures};
}
/** Preserve solver Sets, Maps and integer arithmetic without leaking across puzzles. */
export function packSolverProgress(scope,state){
 const raw=JSON.stringify({version:1,scope,state},(_k,v)=>typeof v==='bigint'?{$dnet:'bigint',v:String(v)}:v instanceof Set?{$dnet:'set',v:[...v]}:v instanceof Map?{$dnet:'map',v:[...v]}:v);
 return raw.length<=250000?raw:null;
}
export function restoreSolverProgress(raw,scope){
 if(typeof raw!=='string'||raw.length>250000)return null;
 try{const saved=JSON.parse(raw,(_k,v)=>v?.$dnet==='bigint'?BigInt(v.v):v?.$dnet==='set'?new Set(v.v):v?.$dnet==='map'?new Map(v.v):v);
  return saved.version===1&&JSON.stringify(saved.scope)===JSON.stringify(scope)&&saved.state&&typeof saved.state==='object'&&!Array.isArray(saved.state)?saved.state:null;
 }catch{return null;}
}
export function createAttemptBudget(limit=8,milliseconds=10000,now=()=>Date.now()){
 let used=0;const deadline=now()+milliseconds;
 return ()=>used<limit&&now()<deadline?(used++,true):false;
}
export const lootYieldFile='tasks/dnet-loot-resize.json';
const yieldPriorities={anchor:5,navigator:4,recovery:3,cache:2,promotion:2,migration:1};
export function readLootYield(raw,now=Date.now()){
 try{const r=JSON.parse(raw);return Number.isSafeInteger(r.pid)&&r.pid>0&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=45000&&Number.isFinite(r.expiresAt)&&r.expiresAt>now&&r.expiresAt<=r.at+45000&&Object.hasOwn(yieldPriorities,r.reason)?r:null;}catch{return null;}
}
/** Ask even a single loot thread to finish its current payout before freeing RAM. */
export async function yieldDarknetLoot(ns,requiredRam,reason,now=Date.now()){
 if(!(requiredRam>0)||!Object.hasOwn(yieldPriorities,reason))return false;
 const prior=readLootYield(ns.read(lootYieldFile),now);
 if(prior&&yieldPriorities[prior.reason]>yieldPriorities[reason])return false;
 const self=ns.getHostname(),free=ns.getServerMaxRam(self)-ns.getServerUsedRam(self);
 if(free>=requiredRam)return true;
 const loot=ns.ps(self).find(p=>p.filename==='darknet-loot.js');
 if(!loot||free+loot.threads*ns.getScriptRam('darknet-loot.js',self)<requiredRam)return false;
 await ns.write(lootYieldFile,JSON.stringify({pid:loot.pid,at:now,expiresAt:now+45000,reason}),'w');
 return false;
}
export async function clearLootYield(ns,reason){
 const request=readLootYield(ns.read(lootYieldFile));if(request?.reason===reason)await ns.rm(lootYieldFile);
}
/** Administrative checkpoint timestamps never count as solver movement. */
export function solverProgressFingerprint(state){
 return JSON.stringify(state,(key,value)=>['checkpointAt','mazeProgressAt','labReports','labPath'].includes(key)?undefined:typeof value==='bigint'?{$dnet:'bigint',v:String(value)}:value instanceof Set?{$dnet:'set',v:[...value]}:value instanceof Map?{$dnet:'map',v:[...value]}:value);
}
