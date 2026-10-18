/** Self-contained bounded diagnostics; callers receive explicit truncation metadata. */
export function boundedDiagnostics(value,compact=true,maxBytes=65536) {
 const omitted=[],seen=new Set();let nodes=0;
 const note=p=>{if(omitted.length<32)omitted.push(p);};
 const prune=(v,p,depth)=>{
  if(++nodes>2000||depth>6){note(p);return {truncated:true};}
  if(v===null||v===undefined)return null;
  if(typeof v==='string'){const limit=compact?256:512;if(v.length>limit)note(p);return v.slice(0,limit);}
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v==='boolean')return v;
  if(typeof v==='bigint')return String(v);
  if(typeof v!=='object')return null;
  if(seen.has(v)){note(p);return {truncated:true};}seen.add(v);
  let out;
  if(Array.isArray(v)){
   const limit=compact?8:128;if(v.length>limit)note(p);
   out=v.slice(0,limit).map((item,i)=>prune(item,p+'.'+i,depth+1));
  }else{
   out={};const entries=Object.entries(v);if(entries.length>32)note(p);
   for(const [key,item]of entries.slice(0,32)){
    if(compact&&['logs','fileAudit','allNames','recent'].includes(key)){note(p+'.'+key);continue;}
    // Bound keys too: game-generated names can grow independently of entry counts.
    if(key.length>128){note(p);continue;}
    Object.defineProperty(out,key,{value:prune(item,p+'.'+key,depth+1),enumerable:true,configurable:true,writable:true});
   }
  }
  seen.delete(v);return out;
 };
 const bytes=text=>{let n=0;for(const c of text){const cp=c.codePointAt(0);n+=cp<=127?1:cp<=2047?2:cp<=65535?3:4;}return n;};
 let result=prune(value,'root',0);if(!result||Array.isArray(result)||typeof result!=='object')result={value:result};
 result._diagnostics={truncated:omitted.length>0,omittedPaths:omitted,byteLimit:maxBytes,details:['automation.logs','automation.files']};
 // Hard UTF-8 limit includes JSON escaping and metadata, not just character counts.
 while(bytes(JSON.stringify(result))>maxBytes){
  const keys=Object.keys(result).filter(k=>k!=='_diagnostics');
  if(!keys.length)return {_diagnostics:{truncated:true,reason:'response-byte-limit'}};
  const key=keys.sort((a,b)=>bytes(JSON.stringify(result[b]))-bytes(JSON.stringify(result[a])))[0];delete result[key];note('root.'+key);result._diagnostics.truncated=true;
 }
 return result;
}

/** Self-contained query reader: avoid parsing the detailed dashboard while its summary is fresh. */
export function readDashboardSummary(ns,now=Date.now(),{requireManagers=false}={}) {
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}};
 const summary=read('tasks/dashboard-summary.json');
 try{
  const reset=ns.getResetInfo();
  if((!requireManagers||Array.isArray(summary?.managers)&&Array.isArray(summary?.pending))&&summary?.schemaVersion===1&&summary.at<=now&&now-summary.at<30000&&summary.nodeReset===reset.lastNodeReset&&summary.augReset===reset.lastAugReset&&
   ns.ps('home').some(p=>p.pid===summary.ownerPid&&p.filename.replace(/^\//,'')==='reliability-manager.js'))return summary;
 }catch{}
 return read('tasks/dashboard.json');
}
