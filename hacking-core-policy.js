/** Convert one-core work to physical threads without changing XP-loop capacity.
 * Grow uses a conservative zero-money bound, retaining the additive money term. */
export function coreAdjustedThreads(threads,tool,cores,logGrowth=0){
 if(!Number.isSafeInteger(threads)||threads<=0)return threads;
 if(!Number.isSafeInteger(cores)||cores<=1||cores>1024||!['grow','weak'].includes(tool))return threads;
 const bonus=1+(cores-1)/16;
 if(tool==='weak')return Math.max(1,Math.ceil(threads/bonus));
 if(!Number.isFinite(logGrowth)||logGrowth<=0)return threads;
 const goal=Math.log(threads)+threads*logGrowth;
 let lo=1,hi=threads;
 while(lo<hi){const mid=lo+Math.floor((hi-lo)/2);if(Math.log(mid)+mid*logGrowth*bonus>=goal)hi=mid;else lo=mid+1;}
 return lo;
}

/** Transactional resident-batch placement. No RAM is pooled across unsplittable legs.
 * Match dispatch order/preferences and use the same conservative core conversion. */
export function forecastCoreBatches(hosts,jobs,{maxBatches=1,workerLimit=Infinity,logGrowth=0,maxPlanningMs=10,now=Date.now,preserveOrder=false}={}){
 const started=now();let limited=false;
 if(!(workerLimit===Infinity||Number.isSafeInteger(workerLimit)&&workerLimit>=0))return null;
 if(!Array.isArray(hosts)||hosts.length>256||!Array.isArray(jobs)||!jobs.length||jobs.length>5||!Number.isFinite(maxBatches)||maxBatches<1)return null;
 if(hosts.some(h=>!h||typeof h.host!=='string'||!Number.isFinite(h.ram)||h.ram<0||!Number.isSafeInteger(h.cores)||h.cores<1)||new Set(hosts.map(h=>h.host)).size!==hosts.length||jobs.some(j=>!['hack','grow','weak'].includes(j.tool)||!Number.isSafeInteger(j.threads)||j.threads<0||!Number.isFinite(j.cost)||j.cost<=0))return null;
 let slots=hosts.map(h=>({...h})),cycles=0,workers=0,ram=0;const ceiling=Math.min(256,Math.floor(maxBatches));
 const order=preserveOrder?jobs:[...jobs.filter(j=>j.tool!=='weak').sort((a,b)=>b.threads-a.threads),...jobs.filter(j=>j.tool==='weak').sort((a,b)=>b.threads-a.threads)];
 while(cycles<ceiling){
  if(now()-started>=maxPlanningMs){limited=true;break;}
  const next=slots.map(h=>({...h}));let count=workers,spent=0,failed=false;
  for(const job of order){
   const split=job.tool==='weak'||job.split===true;
   let remaining=job.threads;
   const physical=(n,h)=>coreAdjustedThreads(n,job.tool,h.cores,logGrowth);
   const capacity=h=>{const n=Math.max(0,Math.floor(h.ram/job.cost));if(n>=remaining||h.cores===1||job.tool==='hack')return Math.min(n,remaining);let lo=Math.min(n,remaining),hi=remaining;while(lo<hi){const m=lo+Math.ceil((hi-lo)/2);if(physical(m,h)<=n)lo=m;else hi=m-1;}return lo;};
   const rooted=[...next].sort((a,b)=>b.ram-a.ram||a.host.localeCompare(b.host));
   const preferred=[...next].sort((a,b)=>{
    const rank=h=>h.host.startsWith('hacknet-')?2:h.host==='home'?(job.tool==='hack'?1:-1):0;
    return rank(a)-rank(b)||(b.maxRam??b.ram)-(a.maxRam??a.ram)||a.host.localeCompare(b.host);
   });
   if(!split&&!rooted.some(h=>capacity(h)>=remaining)){failed=true;break;}
   for(let h of rooted){
    let here=capacity(h);if(!here||!split&&here<remaining)continue;
    if(here===remaining){for(const p of preferred){if(p===h)break;if(capacity(p)>=remaining){h=p;break;}}}
    here=capacity(h);const actual=physical(here,h),cost=actual*job.cost;
    if(!here||cost>h.ram+1e-9||++count>workerLimit){failed=true;break;}
    h.ram=Math.max(0,h.ram-cost);spent+=cost;remaining-=here;if(!remaining)break;
   }
   if(failed||remaining){failed=true;break;}
  }
  if(failed)break;slots=next;workers=count;ram+=spent;cycles++;
 }
 limited ||= cycles===ceiling&&ceiling<Math.floor(maxBatches);
 return {cycles,workers,ram,limited,remaining:slots.map(h=>({host:h.host,ram:h.ram})),model:'Bounded resident placement with conservative core effects'};
}

/** Serial preparation waves with fresh capacity each wave. Grow may split as in prepServer.
 * Current-security durations and separate growth recovery deliberately overestimate overlap.
 * Incomplete/budget-limited forecasts are rejected instead of pooling fractional host RAM. */
export function forecastCorePreparation(hosts,{securityThreads,growThreads,costs,weakenPower,weakMs,growMs,queueMs,workerLimit,logGrowth=0,maxPlanningMs=10,now=Date.now}){
 const started=now();
 if(![securityThreads,growThreads].every(n=>Number.isSafeInteger(n)&&n>=0)||![weakMs,growMs,queueMs].every(n=>Number.isFinite(n)&&n>=0)||!Number.isFinite(weakenPower)||weakenPower<=0)return null;
 let waves=0,securityWaves=0,growthWaves=0,ramSeconds=0,durationMs=0,workers=0;
 if(!Array.isArray(hosts)||!hosts.length||hosts.length>256||!hosts.every(h=>Number.isFinite(h?.ram)&&h.ram>=0)||!costs||![costs.weak,costs.grow].every(n=>Number.isFinite(n)&&n>0))return null;
 const requestCap=grow=>Math.min(Number.MAX_SAFE_INTEGER,hosts.reduce((sum,h)=>sum+Math.floor(h.ram/(grow?costs.grow:costs.weak)),0));
 const place=(n,grow)=>forecastCoreBatches(hosts,grow?[{tool:'weak',threads:Math.ceil(n*.004/weakenPower),cost:costs.weak},{tool:'grow',threads:n,cost:costs.grow,split:true}]:[{tool:'weak',threads:n,cost:costs.weak}],{workerLimit,logGrowth,maxPlanningMs:Math.max(0,maxPlanningMs-(now()-started)),now,preserveOrder:true});
 for(const grow of [false,true]){
  let remaining=grow?growThreads:securityThreads;
  while(remaining>0){
   if(waves>=256||now()-started>=maxPlanningMs)return null;
   let lo=0,hi=Math.min(remaining,requestCap(grow)),best=null;
   while(lo<hi){
    const mid=lo+Math.ceil((hi-lo)/2),p=place(mid,grow);
    if(!p||p.limited)return null;
    if(p.cycles===1){lo=mid;best=p;}else hi=mid-1;
   }
   if(!lo)return null;
   if(!best||lo!==remaining){best=place(lo,grow);if(!best||best.limited||best.cycles!==1)return null;}
   remaining-=lo;waves++;workers+=best.workers;
   if(grow){growthWaves++;durationMs+=growMs+weakMs+queueMs;ramSeconds+=best.ram*(growMs+weakMs)/1000;}
   else{securityWaves++;durationMs+=weakMs+queueMs;ramSeconds+=best.ram*weakMs/1000;}
  }
 }
 return {waves,securityWaves,growthWaves,workers,durationMs,ramSeconds,model:'Host-specific serial prep waves; split grow, weaken first; stalls excluded'};
}
