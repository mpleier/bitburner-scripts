/** Self-contained bounded diagnostics; callers receive explicit truncation metadata. */
export function boundedDiagnostics(value,compact=true,maxBytes=65536) {
 const omitted=[],dropped=[];
 let nodes=0,budget=2000,hit=false;const seen=new Set();
 const note=p=>{if(omitted.length<64)omitted.push(p);};
 const prune=(v,p,depth)=>{
  if(++nodes>budget||depth>6){hit=true;note(p);return {truncated:true};}
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
  if(depth)seen.delete(v);return out;
 };
 const bytes=text=>{let n=0;for(const c of text){const cp=c.codePointAt(0);n+=cp<=127?1:cp<=2047?2:cp<=65535?3:4;}return n;};
 // Fair node budget: measure what each top-level block wants, then divide the 2000-node ceiling in
 // proportion to that demand with a floor. One greedy walk in key order starved every block after the
 // first big ones (go+dashboard), so automation/sleeves/casino shipped as {"truncated":true}.
 const pruneRoot=(v,share,seedParent=false)=>{
  // A block that points back at the payload is circular, not a second copy of it.
  seen.clear();if(seedParent)seen.add(value);
  nodes=0;hit=false;budget=share;const out=prune(v,'root',0);return {out,used:nodes,capped:hit};
 };
 let result,droppedBlocks=[];
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  const allRoots=Object.keys(value),roots=allRoots.slice(0,32);
  for(const key of allRoots.slice(32))dropped.push(key);
  const measured=roots.map(key=>pruneRoot(value[key],2000,true));
  const total=measured.reduce((sum,m)=>sum+m.used,0);
  const built={},capped=[];
  roots.forEach((key,i)=>{
   const need=measured[i].used;
   const share=total<=2000?2000:Math.max(24,Math.floor(2000*need/Math.max(1,total)));
   if(share>=need)built[key]=measured[i].out;
   else{const r=pruneRoot(value[key],share,true);built[key]=r.out;if(r.capped)capped.push(key);}
  });
  result=built;droppedBlocks=capped;
 }else{
  const r=pruneRoot(value,2000);result=r.out;
  if(!result||Array.isArray(result)||typeof result!=='object')result={value:result};
 }
 result._diagnostics={truncated:omitted.length>0,droppedBlocks,omittedPaths:omitted,byteLimit:maxBytes,details:['automation.logs','automation.files']};
 // Hard UTF-8 limit includes JSON escaping and metadata, not just character counts.
 while(bytes(JSON.stringify(result))>maxBytes){
  const keys=Object.keys(result).filter(k=>k!=='_diagnostics');
  if(!keys.length)return {_diagnostics:{truncated:true,reason:'response-byte-limit'}};
  const key=keys.sort((a,b)=>bytes(JSON.stringify(result[b]))-bytes(JSON.stringify(result[a])))[0];
  delete result[key];dropped.push(key);note('root.'+key);result._diagnostics.truncated=true;
 }
 result._diagnostics.omitted=dropped;
 return result;
}

/** Self-contained stale-block gate: null anything written by a previous run, or older than maxAgeMs. */
export function freshValue(value,reset,maxAgeMs) {
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const lastAug=reset&&reset.lastAugReset,lastNode=reset&&reset.lastNodeReset;
 if(Number.isFinite(value.augReset)&&Number.isFinite(lastAug)&&value.augReset!==lastAug)return null;
 if(Number.isFinite(value.nodeReset)&&Number.isFinite(lastNode)&&value.nodeReset!==lastNode)return null;
 if(Number.isFinite(maxAgeMs)&&Number.isFinite(value.at)&&Date.now()-value.at>maxAgeMs)return null;
 return value;
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
