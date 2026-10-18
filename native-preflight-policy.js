/** Read-only native RAM preflight. Does not execute scripts or guarantee runtime API access. */
export function nativeScriptPreflight(ns,names,now=Date.now()) {
 const reset=ns.getResetInfo(),scripts=[...new Set(names)].map(script=>{
  try{
   if(!ns.fileExists(script,'home'))return {script,status:'missing',ram:0};
   const ram=ns.getScriptRam(script,'home');
   return {script,ram:Number.isFinite(ram)?ram:null,status:Number.isFinite(ram)&&ram>0?'ready':'invalid',reason:ram>0?undefined:'Native RAM calculation failed'};
  }catch(error){return {script,status:'unavailable',ram:null,reason:String(error).slice(0,256)};}
 });
 return {schemaVersion:1,at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,check:'native-ram',ok:scripts.length>0&&scripts.every(s=>s.status==='ready'),scripts,limitations:'Read-only RAM preflight; scripts are not run and runtime API access is not verified'};
}
/** One named managed script, at most four instances and ten bounded lines per instance. */
export function freshManagedLogs(ns,script,now=Date.now()) {
 const matches=ns.ps('home').filter(p=>p.filename.replace(/^\//,'')===script).sort((a,b)=>b.pid-a.pid);
 const logs=matches.slice(0,4).map(p=>{
  try{return {script,pid:p.pid,at:now,lines:ns.getScriptLogs(p.pid).slice(-10).map(line=>String(line).slice(0,256))};}
  catch(error){return {script,pid:p.pid,at:now,error:String(error).slice(0,256),lines:[]};}
 });
 return {at:now,source:'native',script,processCount:matches.length,omittedProcesses:Math.max(0,matches.length-logs.length),logs};
}
