/** Stable per-controller sequence; reset IDs disambiguate PID reuse. */
export function createHgwBatch(owner,reset,sequence,target,items){
 if(!Number.isSafeInteger(owner)||owner<=0||!Number.isSafeInteger(sequence)||sequence<=0||typeof target!=='string'||!target||target.length>100||![reset?.lastNodeReset,reset?.lastAugReset].every(n=>Number.isFinite(n)&&n>=0))return null;
 const batchPlan=items.filter(i=>i.threadsNeeded>0).map(i=>({step:i.description,tool:({weak:'weaken',hack:'hack',grow:'grow'})[i.toolShortName],threads:i.threadsNeeded,deadline:Number(i.end)})).sort((a,b)=>a.deadline-b.deadline);
 if(!batchPlan.length||batchPlan.length>5||new Set(batchPlan.map(p=>p.step)).size!==batchPlan.length||batchPlan.some(p=>!['hack','weak1','grow-from-zero','grow','weak2'].includes(p.step)||!p.tool||!Number.isSafeInteger(p.threads)||p.threads<=0||!Number.isFinite(p.deadline)||p.deadline<0))return null;
 return {batchVersion:1,batchId:[reset.lastNodeReset,reset.lastAugReset,owner,sequence].join(':'),batchTarget:target,batchPlan};
}
/** Keep the existing scheduling arguments and flags; only enrich the final metadata. */
export function withHgwBatch(args,batch,step){
 if(!batch||!batch.batchPlan.some(p=>p.step===step))return args;
 try{const meta=JSON.parse(args.at(-1));if(meta?.port!==20)return args;return [...args.slice(0,-1),JSON.stringify({...meta,...batch,batchStep:step})];}catch{return args;}
}
export function withHgwPiece(args,threads,workThreads=threads){
 if(!Array.isArray(args)||!Number.isSafeInteger(threads)||threads<=0)return args;
 if(!Number.isSafeInteger(workThreads)||workThreads<threads)return args;
 try{const meta=JSON.parse(args.at(-1));if(meta?.batchVersion!==1)return args;return [...args.slice(0,-1),JSON.stringify({...meta,pieceThreads:workThreads,physicalThreads:threads})];}catch{return args;}
}
/** Self-contained: verifies only observed, bounded non-looping batch receipts. */
export function summarizeHgwBatches(events,owner,now){
 const groups=new Map(),invalidKeys=new Set();
 for(const e of (Array.isArray(events)?events:[]).slice(-40)){
  if(!e||e.owner!==owner||e.batchVersion!==1||typeof e.batchId!=='string'||e.batchId.length>160||!e.batchId||typeof e.target!=='string'||e.target.length>100||!Number.isFinite(e.at)||e.at>now||now-e.at>120000)continue;
  const key=JSON.stringify([e.owner,e.target,e.batchId]);
  if(!Array.isArray(e.batchPlan)||!e.batchPlan.length||e.batchPlan.length>5){invalidKeys.add(key);continue;}
  const plan=e.batchPlan,stepTools={hack:'hack',weak1:'weaken','grow-from-zero':'grow',grow:'grow',weak2:'weaken'};
  if(new Set(plan.map(p=>p?.step)).size!==plan.length||plan.some((p,i)=>!p||stepTools[p.step]!==p.tool||!Number.isSafeInteger(p.threads)||p.threads<=0||!Number.isFinite(p.deadline)||p.deadline<0||i>0&&p.deadline<=plan[i-1].deadline)){invalidKeys.add(key);continue;}
  let g=groups.get(key);
  if(!g){g={batchId:e.batchId,owner,target:e.target,plan:plan.map(p=>({step:p.step,tool:p.tool,threads:p.threads,deadline:p.deadline})),signature:JSON.stringify(plan),receipts:new Map(),lastAt:e.at,inconsistent:false};groups.set(key,g);}
  g.lastAt=Math.max(g.lastAt,e.at);
  const expected=g.plan.find(p=>p.step===e.batchStep);
  if(g.signature!==JSON.stringify(plan)||!expected||e.tool!==expected.tool||e.deadline!==expected.deadline||!Number.isSafeInteger(e.pid)||e.pid<=0||!Number.isSafeInteger(e.pieceThreads)||e.pieceThreads<=0){g.inconsistent=true;continue;}
  if(e.physicalThreads!==undefined&&(!Number.isSafeInteger(e.physicalThreads)||e.physicalThreads<=0||e.physicalThreads>e.pieceThreads)){g.inconsistent=true;continue;}
  const receipt={pid:e.pid,step:e.batchStep,at:e.at,threads:e.pieceThreads,physicalThreads:e.physicalThreads??e.pieceThreads,error:!!e.error},old=g.receipts.get(e.pid);
  if(old&&JSON.stringify(old)!==JSON.stringify(receipt)){g.inconsistent=true;continue;}
  g.receipts.set(e.pid,receipt);
 }
 return [...groups.values()].sort((a,b)=>b.lastAt-a.lastAt).slice(0,8).map(g=>{
  const receipts=[...g.receipts.values()],failed=receipts.some(r=>r.error),steps=g.plan.map(p=>{
   const rows=receipts.filter(r=>r.step===p.step),observedThreads=rows.reduce((sum,r)=>sum+r.threads,0);
   if(observedThreads>p.threads)g.inconsistent=true;
   return {...p,observedThreads,observedWorkThreads:observedThreads,physicalThreads:rows.reduce((sum,r)=>sum+r.physicalThreads,0),threadUnits:'planned one-core work',pieces:rows.length,complete:observedThreads===p.threads,firstAt:rows.length?Math.min(...rows.map(r=>r.at)):null,lastAt:rows.length?Math.max(...rows.map(r=>r.at)):null};
  });
  let state=g.inconsistent||invalidKeys.has(JSON.stringify([g.owner,g.target,g.batchId]))?'inconsistent':failed?'failed':steps.some(p=>!p.complete)?'partial':'ordered';
  if(state==='ordered'){
   for(let i=1;i<steps.length;i++)if(steps[i-1].lastAt>steps[i].firstAt){state='inverted';break;}else if(steps[i-1].lastAt===steps[i].firstAt)state='timestamp-tie';
  }
  return {batchId:g.batchId,owner:g.owner,target:g.target,lastAt:g.lastAt,state,steps};
 });
}
