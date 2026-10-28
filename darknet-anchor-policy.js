export const anchorRequestFile='tasks/dnet-anchor-request.json',anchorReceiptFile='tasks/dnet-anchor-receipt.json';
export const anchorComparisonFile='tasks/dnet-anchor-comparison.json';
export const anchorIdentity=r=>JSON.stringify([r.host,r.modelId,r.depth,r.passwordLength,r.passwordFormat,r.data]);
function anchorCashSample(values,host,now,after=0){
 const v=values[host],rows=v?.windows;
 if(!v?.cashKnown||typeof v.identity!=='string'||typeof v.epoch!=='string'||!Array.isArray(rows)||rows.length>5||rows.length<3)return null;
 const usable=rows.filter(w=>w?.start?.at>=after);
 if(usable.length<3||usable.some((w,i)=>![w.start.at,w.end.at,w.start.money,w.end.money].every(Number.isFinite)||w.start.money<0||w.end.money<w.start.money||w.end.at-w.start.at<20000||w.end.at-w.start.at>120000||w.end.at>now||i>0&&(w.start.at!==usable[i-1].end.at||w.start.money!==usable[i-1].end.money)))return null;
 const start=usable[0].start.at,end=usable.at(-1).end.at;
 if(now-end>90000)return null;
 const rate=(usable.at(-1).end.money-usable[0].start.money)/((end-start)/1000);
 return Number.isFinite(rate)?{host,identity:v.identity,epoch:v.epoch,start,end,rate}:null;
}
/** Compare exact cache cash over overlapping windows. Other income is deliberately unknown. */
export function anchorComparisonBaseline(values,source,target,linked,now,after=0){
 const sample=host=>anchorCashSample(values,host,now,after);
 const a=sample(source),b=sample(target);
 if(!a||!b)return null;
 const control=linked.filter(h=>h!==source&&h!==target).map(sample).filter(Boolean).sort((a,b)=>a.host.localeCompare(b.host)).find(c=>Math.min(a.end,b.end,c.end)-Math.max(a.start,b.start,c.start)>=60000);
 return control?{goal:'exact-cache-cash',source:a,target:b,control,at:now}:null;
}
/** Retained anchor controls for common drift; observational comparison, not total-income causality. */
export function evaluateAnchorComparison(request,values,linked,now){
 const before=request?.comparison;
 if(!before||before.goal!=='exact-cache-cash'||!Number.isFinite(before.at)||before.at>now||!Number.isFinite(request.at)||request.at>now||['source','target','control'].some(k=>!before[k]||typeof before[k].host!=='string'||typeof before[k].identity!=='string'||typeof before[k].epoch!=='string'||!Number.isFinite(before[k].rate)||before[k].rate<0)||before.source.host!==request.source||before.target.host!==request.target||new Set([before.source.host,before.target.host,before.control.host]).size!==3)return null;
 const base={id:request.id,nodeReset:request.nodeReset,augReset:request.augReset,goal:before.goal,at:now,totalIncomeKnown:false,phishingIncomeKnown:false};
 if(request.phase!=='done')return {...base,state:'pending'};
 if(!linked.includes(request.target)||!linked.includes(before.control.host))return {...base,state:'inconclusive',reason:'Replacement or retained control is no longer linked'};
 const target=anchorCashSample(values,request.target,now,request.at),control=anchorCashSample(values,before.control.host,now,request.at);
 if(!target||!control)return {...base,state:now-request.at>=300000?'inconclusive':'sampling',reason:'Awaiting three post-transition cache windows'};
 if([['target',target],['control',control]].some(([key,v])=>v.identity!==before[key].identity||v.epoch!==before[key].epoch))return {...base,state:'inconclusive',reason:'Cache identity or reward epoch changed'};
 if(Math.min(target.end,control.end)-Math.max(target.start,control.start)<60000)return {...base,state:'sampling',reason:'Post-transition windows do not overlap for 60 seconds'};
 const drift=control.rate-before.control.rate,retainedRate=Math.max(0,before.source.rate+drift),replacementRate=target.rate,delta=replacementRate-retainedRate;
 if(![drift,retainedRate,replacementRate,delta].every(Number.isFinite))return {...base,state:'inconclusive',reason:'Invalid cache measurements'};
 return {...base,state:'measured',retainedRate,replacementRate,delta,controlDrift:drift,before,after:{target,control},reason:'Observed cache comparison adjusted by retained-anchor drift; other income and causal attribution unknown'};
}
export async function anchorControlAllowed(ns){
 for(const file of ['remote-control/paused/darknet-manager.js.txt','tasks/automation-maintenance.json']){
  if(!ns.fileExists(file,'home'))continue;
  if(!await ns.scp(file,ns.getHostname(),'home'))return false;
  const raw=ns.read(file);if(file.endsWith('.txt')&&raw.trim()==='true')return false;
  if(file.endsWith('.json'))try{const r=JSON.parse(raw);if(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return false;}catch{return false;}
 }return true;
}
/** Only replace a redundant anchor; retain the deepest and all story/stationary anchors. */
export function chooseAnchorReplacement(reports,linked,limit,passwords,now,values={}){
 if(!Number.isSafeInteger(limit)||limit<2||linked.length!==limit||new Set(linked).size!==linked.length)return null;
 const fresh=reports.filter(r=>r&&r.at<=now&&now-r.at<=90000&&r.live&&r.busy===false&&typeof r.host==='string'&&Number.isFinite(r.depth)&&r.depth>=0&&Array.isArray(r.neighbours));
 if(linked.some(h=>!fresh.some(r=>r.host===h)))return null;
 const live=new Set(fresh.map(r=>r.host));
 const evidence=r=>{const v=values[r.host];return v&&v.at<=now&&now-v.at<=90000&&Number.isFinite(v.cashRate)&&v.cashRate>=0&&Number.isFinite(v.discoveryRate)&&v.discoveryRate>=0?v:null;};
 const maxCash=Math.max(1,...fresh.map(r=>evidence(r)?.cashKnown?evidence(r).cashRate:0)),maxDiscoveries=Math.max(.001,...fresh.map(r=>evidence(r)?.discoveryKnown?evidence(r).discoveryRate:0));
 const score=r=>r.depth*10+Math.min(20,r.neighbours.filter(h=>!live.has(h)).length)*8+Math.log2(Math.max(1,r.maxRam||1))+Math.min(5,r.caches||0)*2+
  (evidence(r)?.cashKnown?Math.min(20,evidence(r).cashRate/maxCash*20):0)+(evidence(r)?.discoveryKnown?Math.min(20,evidence(r).discoveryRate/maxDiscoveries*20):0);
 const protectedAnchor=r=>r.isStationary!==false||/labyrinth|story/i.test(r.modelId||'')||r.seed||r.contracts>0||r.caches>0;
 const anchors=fresh.filter(r=>linked.includes(r.host)),deepest=Math.max(...anchors.map(r=>r.depth));
 const donor=anchors.filter(r=>!protectedAnchor(r)&&r.depth<deepest&&r.maxRam>=32).sort((a,b)=>score(a)-score(b)||a.host.localeCompare(b.host))[0];
 const target=fresh.filter(r=>!linked.includes(r.host)&&r.maxRam>=32&&passwords.has(r.host)&&typeof passwords.get(r.host)==='string'&&(r.hasSession===true||r.rooted===true)).sort((a,b)=>score(b)-score(a)||a.host.localeCompare(b.host))[0];
 if(!donor||!target||score(target)<score(donor)+20)return null;
 const a=evidence(donor),b=evidence(target),measured=a?.cashKnown&&b?.cashKnown,delta=measured?b.cashRate-a.cashRate:null;
 if(a?.cashKnown&&a.cashRate>0&&!b?.cashKnown)return null;
 const paybackMs=measured?(delta>0?a.cashRate*60000/delta:a.cashRate>0?Infinity:0):null;
 if(measured&&paybackMs>300000)return null;
 return {source:donor.host,target:target.host,sourceIdentity:anchorIdentity(donor),targetIdentity:anchorIdentity(target),scoreGain:score(target)-score(donor),cacheEconomics:measured?{sourceRate:a.cashRate,targetRate:b.cashRate,transitionMs:60000,paybackMs,horizonMs:600000}:null};
}
export function advanceAnchorRequest(request,receipt,linked,now){
 if(!request||request.phase==='done'||request.phase==='blocked')return request;
 const matched=receipt?.id===request.id&&receipt.phase===request.phase&&receipt.host===(['prepare','apply'].includes(request.phase)?request.target:request.source)&&receipt.at>=request.at&&receipt.at<=now;
 if(request.phase==='apply'&&linked.includes(request.target)||request.phase==='rollback'&&linked.includes(request.source))return {...request,phase:'done',at:now};
 if(now>request.expiresAt){return {...request,phase:linked.includes(request.source)?'done':request.phase==='rollback'?'blocked':'rollback',expiresAt:now+180000,at:now,reason:'Anchor transaction expired'};}
 if(!matched)return request;
 let phase;
 if(request.phase==='prepare'){if(receipt.success&&now-request.at<35000)return request;phase=receipt.success?'release':'done';}
 if(request.phase==='release')phase=!linked.includes(request.source)?receipt.success?'apply':'rollback':'done';
 if(request.phase==='apply')phase=receipt.success&&linked.includes(request.target)?'done':'rollback';
 if(request.phase==='rollback')phase=linked.includes(request.source)?'done':'blocked';
 return {...request,phase,at:now,expiresAt:now+180000,reason:receipt.message||phase};
}
/** Manager owns the lease. Scouts only execute the current phase on their own host. */
export async function coordinateDarknetAnchors(ns,reports,passwords,reset,values={}){
 const now=Date.now();let request=null,receipt=null;
 try{request=JSON.parse(ns.read(anchorRequestFile));receipt=JSON.parse(ns.read(anchorReceiptFile));}catch{}
 const linked=ns.dnet.getStasisLinkedServers();
 const scoped=request?.nodeReset===reset.lastNodeReset&&request.augReset===reset.lastAugReset;
 if(scoped&&request.comparison){
  const comparison=evaluateAnchorComparison(request,values,linked,now);
  let saved;try{saved=JSON.parse(ns.read(anchorComparisonFile));}catch{}
  if(comparison&&!(saved?.id===request.id&&['measured','inconclusive'].includes(saved.state)))try{await ns.write(anchorComparisonFile,JSON.stringify(comparison),'w');}catch(error){if(now-(coordinateDarknetAnchors.warningAt??-Infinity)>=60000){ns.print('Dark Net anchor comparison write deferred: '+String(error));coordinateDarknetAnchors.warningAt=now;}}
  if(request.phase==='done'&&comparison?.state==='sampling'&&!(saved?.id===request.id&&['measured','inconclusive'].includes(saved.state))&&now-request.at<300000)return;
 }
 if(scoped&&request.phase!=='done'&&request.phase!=='blocked'){
  // Native stasis operations yield for up to 30 seconds. Never overlap a phase
  // transition or owner takeover with a helper already completing that phase.
  const host=['prepare','apply'].includes(request.phase)?request.target:request.source;
  try{if(ns.ps(host).some(p=>p.filename==='darknet-stasis.js'))return;}catch{/* A lost host is reconciled by the lease timeout. */}
    if(request.owner!==ns.pid){await ns.write(anchorRequestFile,JSON.stringify({...request,owner:ns.pid,phase:linked.includes(request.target)||linked.includes(request.source)?'done':'rollback',at:now,expiresAt:now+180000}),'w');return;}
  const next=advanceAnchorRequest(request,receipt,linked,now);if(next!==request)await ns.write(anchorRequestFile,JSON.stringify(next),'w');return;
 }
 if(scoped&&(request.phase==='blocked'||now-request.at<120000))return;
 const plan=chooseAnchorReplacement(reports,linked,ns.dnet.getStasisLinkLimit(),passwords,now,values);if(!plan)return;
 const comparison=anchorComparisonBaseline(values,plan.source,plan.target,linked,now);
 await ns.write(anchorRequestFile,JSON.stringify({...plan,comparison,id:`${ns.pid}:${now}`,owner:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,phase:'prepare',at:now,expiresAt:now+180000}),'w');
}
export async function serviceDarknetAnchor(ns){
 const self=ns.getHostname();if(!ns.fileExists(anchorRequestFile,'home')||!await ns.scp(anchorRequestFile,self,'home'))return false;
 let r;try{r=JSON.parse(ns.read(anchorRequestFile));}catch{return false;}
 if(!['prepare','release','apply','rollback'].includes(r.phase)||Date.now()>r.expiresAt||r.at>Date.now()||!ns.isRunning(r.owner))return false;
 if((['prepare','apply'].includes(r.phase)?r.target:r.source)!==self)return false;
 let scope;try{scope=JSON.parse(ns.read('tasks/dnet-cache-context.json'));}catch{return false;}if(scope.nodeReset!==r.nodeReset||scope.augReset!==r.augReset||!await anchorControlAllowed(ns))return false;
 if(ns.ps(self).some(p=>p.filename==='darknet-stasis.js'))return true;
 let old;try{old=JSON.parse(ns.read(anchorReceiptFile));}catch{}
 if(old?.id===r.id&&old.phase===r.phase)return true;
 const ram=ns.getScriptRam('darknet-stasis.js',self);if(!(ram>0))return false;
 if(ns.getServerMaxRam(self)-ns.getServerUsedRam(self)<ram)for(const p of ns.ps(self))if(p.filename==='darknet-loot.js')ns.kill(p.pid);
 if(ns.getServerMaxRam(self)-ns.getServerUsedRam(self)>=ram)ns.exec('darknet-stasis.js',self,1,r.id,r.phase);
 return true;
}
