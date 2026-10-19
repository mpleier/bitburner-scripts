import {homeRamHeadroom} from './home-ram-policy.js';
import {contractKey} from './contract-policy.js';
const leaseFile='tasks/contracts-active.json';
const read=(ns,file,fallback=null)=>{try{return JSON.parse(ns.read(file))??fallback;}catch{return fallback;}};
export function contractReceiptPath(id){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Invalid contract job ID');return 'Temp/contracts-inbox/'+id+'.json';}
export function contractJobCurrent(job,reset,now=Date.now()){
 return job?.schemaVersion===1&&job.nodeReset===reset.lastNodeReset&&job.augReset===reset.lastAugReset&&
  typeof job.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(job.id)&&typeof job.host==='string'&&
  Number.isFinite(job.expiresAt)&&job.expiresAt>job.at&&job.expiresAt-job.at<=600000&&
  Number.isSafeInteger(job.workerPid)&&job.workerPid>0&&['running','applied','uncertain'].includes(job.state)&&
  typeof job.version==='string'&&Array.isArray(job.keys)&&job.keys.length>0&&job.keys.length<=64&&new Set(job.keys).size===job.keys.length&&
  job.keys.every(k=>typeof k==='string')&&Number.isFinite(job.at)&&job.at>=reset.lastAugReset&&job.at<=now;
}
/** Every path is read from home; the remote copy cannot grant itself permission to submit. */
export async function refreshContractDelivery(ns,delivery,version,key){
 if(!delivery||typeof delivery.id!=='string')return false;
 try{
  contractReceiptPath(delivery.id);
  const host=ns.getHostname();
  if(host!=='home'&&!await ns.scp([leaseFile,'tasks/contract-validation.json','tasks/contract-quarantine.json'],host,'home'))return false;
  const job=read(ns,leaseFile),reset=ns.getResetInfo(),now=Date.now();
  return !!(contractJobCurrent(job,reset,now)&&job.id===delivery.id&&job.host===host&&job.workerPid===ns.pid&&
   job.expiresAt>now&&job.keys.includes(key)&&job.version===version&&delivery.version===version&&read(ns,'tasks/contract-validation.json')?.version===version);
 }catch{return false;}
}
/** Only the unique inbox receipt is copied home. Never copy canonical status or quarantine files back. */
export async function deliverContractReceipt(ns,delivery,receipt){
 const file=contractReceiptPath(delivery.id);
 await ns.write(file,JSON.stringify({...receipt,schemaVersion:1,id:delivery.id,workerPid:ns.pid,host:ns.getHostname()}),'w');
 if(ns.getHostname()==='home')return true;
 try{return !!await ns.scp(file,'home',ns.getHostname());}catch{return false;}
}
export function validContractReceipt(receipt,job){
 if(receipt?.schemaVersion!==1||receipt.id!==job.id||receipt.host!==job.host||receipt.workerPid!==job.workerPid||
  receipt.version!==job.version||receipt.nodeReset!==job.nodeReset||receipt.augReset!==job.augReset||
  !Number.isFinite(receipt.at)||receipt.at<job.at||receipt.at>job.expiresAt+60000||receipt.total!==job.keys.length)return false;
 const names=['total','attempted','solved','failed','deferred','unsupported'];
 if(names.some(k=>!Number.isSafeInteger(receipt[k])||receipt[k]<0||receipt[k]>receipt.total))return false;
 if(receipt.solved+receipt.failed+receipt.deferred+receipt.unsupported!==receipt.total||receipt.solved>receipt.attempted||receipt.attempted>receipt.solved+receipt.failed)return false;
 if(!receipt.quarantine||typeof receipt.quarantine!=='object'||Array.isArray(receipt.quarantine)||!Array.isArray(receipt.notified))return false;
 const keys=new Set(job.keys);
 return Object.entries(receipt.quarantine).every(([key,value])=>keys.has(key)&&value?.version===job.version&&Number.isFinite(value.at)&&value.at>=job.at&&value.at<=receipt.at)&&receipt.notified.every(k=>keys.has(k));
}
/** Home is the sole merger. A missing result quarantines the batch instead of spending attempts again. */
export async function reconcileContractDelivery(ns,now=Date.now()){
 const job=read(ns,leaseFile),reset=ns.getResetInfo();
 if(!contractJobCurrent(job,reset,now)||job.state==='applied'||job.state==='uncertain')return {busy:false};
 const running=Number.isSafeInteger(job.workerPid)&&ns.isRunning(job.workerPid);
 const file=contractReceiptPath(job.id);
 if(job.host!=='home'&&!ns.fileExists(file,'home'))try{await ns.scp(file,'home',job.host);}catch{}
 const receipt=read(ns,file);
 if(validContractReceipt(receipt,job)&&receipt.at<=now){
  // Wait until no process can append another outcome before acknowledging this batch.
  if(running)return {busy:true,reason:'delivering'};
  const quarantine=read(ns,'tasks/contract-quarantine.json',{}),safe=quarantine&&typeof quarantine==='object'&&!Array.isArray(quarantine)?quarantine:{};
  for(const [key,value]of Object.entries(receipt.quarantine))if(!safe[key]||safe[key].at<=value.at)safe[key]=value;
  await ns.write('tasks/contract-quarantine.json',JSON.stringify(safe),'w');
  let notified=read(ns,'/Temp/unsolved-contracts.txt',[]);if(!Array.isArray(notified))notified=[];
  await ns.write('/Temp/unsolved-contracts.txt',JSON.stringify([...new Set([...notified,...receipt.notified])]),'w');
  const {quarantine:ignored,notified:ignoredNotifications,...summary}=receipt;
  await ns.write('tasks/contracts-results.json',JSON.stringify(summary),'w');
  await ns.write(leaseFile,JSON.stringify({...job,state:'applied',appliedAt:now}),'w');
  // Acknowledged receipts are disposable; keep uncertain evidence for investigation.
  if(typeof ns.rm==='function'){ns.rm(file,'home');if(job.host!=='home')try{ns.rm(file,job.host);}catch{}}
  return {busy:false,applied:true};
 }
 if(running)return {busy:true,reason:job.expiresAt<=now?'expired-worker-finishing':'running'};
 const quarantine=read(ns,'tasks/contract-quarantine.json',{}),safe=quarantine&&typeof quarantine==='object'&&!Array.isArray(quarantine)?quarantine:{};
 for(const key of job.keys)safe[key]={version:job.version,at:now,error:'Worker ended without a verified receipt; submission outcome is uncertain'};
 await ns.write('tasks/contract-quarantine.json',JSON.stringify(safe),'w');
 await ns.write(leaseFile,JSON.stringify({...job,state:'uncertain',resolvedAt:now}),'w');
 ns.print('WARNING: Contract worker ended without a verified receipt; affected contracts quarantined to prevent duplicate attempts.');
 return {busy:false,uncertain:true};
}

/** Import closure is copied from authoritative home; no remote scripts are copied back. */
export function contractWorkerFiles(ns,entry){
 const files=[],seen=new Set();
 function visit(file){
  if(seen.has(file))return;seen.add(file);
  if(!ns.fileExists(file,'home'))throw Error('Missing contract worker dependency: '+file);
  files.push(file);if(files.length>128)throw Error('Contract worker dependency limit exceeded');
  for(const m of ns.read(file).matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)){
   const parts=(m[1].startsWith('.')?file.split('/').slice(0,-1).join('/')+'/'+m[1]:m[1]).split('/'),out=[];
   for(const part of parts){if(part==='..'){if(!out.length)throw Error('Dependency escapes home');out.pop();}else if(part&&part!=='.')out.push(part);}
   visit(out.join('/'));
  }
 }
 visit(entry.replace(/^\//,''));return files;
}
export async function dispatchContractDelivery(ns,entry,contracts,servers,now=Date.now()){
 const reset=ns.getResetInfo(),validation=read(ns,'tasks/contract-validation.json'),quarantine=read(ns,'tasks/contract-quarantine.json',{});
 const active=read(ns,leaseFile);
 if(contractJobCurrent(active,reset,now)&&!['applied','uncertain'].includes(active.state))return {pid:0,reason:'pending-result-delivery'};
 if(typeof validation?.version!=='string')return {pid:0,reason:'waiting-for-validation'};
 const seen=new Set(),batch=contracts.filter(c=>{const key=contractKey(c);if(seen.has(key))return false;seen.add(key);return validation.types?.[c.type]?.state==='passed'&&quarantine?.[key]?.version!==validation.version;}).slice(0,64);
 if(!batch.length)return {pid:0,reason:'no-validated-contracts'};
 const files=contractWorkerFiles(ns,entry),ram=ns.getScriptRam(entry,'home');
 if(!(ram>0)||!Number.isFinite(ram))return {pid:0,reason:'invalid-worker'};
 const hosts=[...new Set([...servers,'home'])].filter(h=>h==='home'||ns.hasRootAccess(h));
 // Existing workers without a lease must finish before this dispatcher can assume ownership.
 if(hosts.some(h=>ns.ps(h).some(p=>p.filename.replace(/^\//,'')===entry.replace(/^\//,''))))return {pid:0,reason:'worker-already-running'};
 const targets=hosts.map(host=>({host,free:ns.getServerMaxRam(host)-ns.getServerUsedRam(host)-(host==='home'?homeRamHeadroom(ns.getServerMaxRam(host),Number(ns.read('home-ram-reserve.txt'))||0):0)})).filter(h=>h.free>=ram)
  .sort((a,b)=>(a.host==='home')-(b.host==='home')||b.free-a.free);
 const id='contracts-'+ns.pid+'-'+now,jobBase={schemaVersion:1,id,at:now,expiresAt:now+600000,version:validation.version,
  nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,keys:batch.map(contractKey)};
 for(const target of targets){
  try{if(target.host!=='home'&&!await ns.scp(files,target.host,'home'))continue;}catch{continue;}
  // Seed empty quarantine on home only when absent, so snapshot scp has an actual file to copy.
  if(!ns.read('tasks/contract-quarantine.json'))ns.write('tasks/contract-quarantine.json','{}','w');
  const job={...jobBase,host:target.host,state:'starting',workerPid:0};
  ns.write(leaseFile,JSON.stringify(job),'w');
  let pid=0;try{pid=ns.exec(entry,target.host,{temporary:true},JSON.stringify(batch),JSON.stringify({id,version:job.version,at:job.at}));}catch{}
  if(pid){ns.write(leaseFile,JSON.stringify({...job,state:'running',workerPid:pid}),'w');return {pid,host:target.host,jobId:id,count:batch.length};}
 }
 // No launched worker can have submitted anything. Do not create an uncertain batch on the next scan.
 const ending=read(ns,leaseFile);if(ending?.id===id&&ending.workerPid===0)ns.write(leaseFile,JSON.stringify({...ending,state:'applied'}),'w');
 return {pid:0,reason:'waiting-for-worker-ram'};
}
