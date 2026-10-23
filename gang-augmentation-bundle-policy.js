/** Bounded gang-only bundles. Quotes use current native prices, including queued inflation.
 * An expensive-first topological order is conservative; this planner never mutates purchases. */
export function gangAugmentationBundles(plan,{channels={},reputation=0,repRate=0,cashRate=0,worth=0}={}) {
 const invalid=[];
 if(!plan||typeof plan.faction!=='string'||!plan.faction||!Array.isArray(plan.catalog)||plan.catalog.length>256||!Array.isArray(plan.base)||plan.base.length>64||!Array.isArray(plan.owned)||
  ![plan.multiplier,plan.donations,reputation,repRate,cashRate,worth].every(Number.isFinite)||plan.multiplier<1||plan.donations<0||reputation<0||repRate<0||cashRate<0||worth<0)return invalid;
 const valid=a=>a&&typeof a.name==='string'&&a.name&&a.name!=='NeuroFlux Governor'&&Number.isFinite(a.price)&&a.price>=0&&Number.isFinite(a.rep)&&a.rep>=0&&Array.isArray(a.prereqs)&&a.prereqs.every(n=>typeof n==='string')&&a.stats&&typeof a.stats==='object'&&Object.values(a.stats).every(v=>Number.isFinite(v)&&v>0);
 // Repeatable NF entries in the committed basket retain their native incremental prices.
 const baseValid=a=>a&&typeof a.name==='string'&&Number.isFinite(a.price)&&a.price>=0&&Array.isArray(a.prereqs)&&a.prereqs.every(n=>typeof n==='string');
 if(!plan.catalog.every(valid)||!plan.base.every(baseValid)||plan.owned.some(n=>typeof n!=='string'))return invalid;
 const catalog=new Map(plan.catalog.map(a=>[a.name,a]));if(catalog.size!==plan.catalog.length)return invalid;
 const owned=new Set(plan.owned),baseNames=new Set(plan.base.map(a=>a.name));
 if(plan.base.some(a=>owned.has(a.name)&&a.name!=='NeuroFlux Governor')||plan.base.filter(a=>a.name!=='NeuroFlux Governor').length!==new Set(plan.base.filter(a=>a.name!=='NeuroFlux Governor').map(a=>a.name)).size)return invalid;
 const value=a=>Object.entries(channels).reduce((n,[k,w])=>n+(Number.isFinite(w)&&w>0?Math.max(0,Math.log(a.stats[k]??1))*w:0),0);
 const closure=names=>{
  const found=new Map(),visiting=new Set();
  const visit=name=>{if(owned.has(name)||baseNames.has(name)||found.has(name))return true;const a=catalog.get(name);
   if(!a||visiting.has(name)||found.size>=12)return false;visiting.add(name);
   for(const p of a.prereqs)if(!visit(p))return false;
   visiting.delete(name);found.set(name,a);return found.size<=12;};
  return names.every(visit)?[...found.values()]:null;
 };
 // Round-robin benefit, full prerequisite price, and time-to-unlock lanes.
 const seconds=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 const rows=plan.catalog.filter(a=>a.desired===true&&!owned.has(a.name)&&!baseNames.has(a.name)&&value(a)>0).map(a=>{
  const chain=closure([a.name]);if(!chain)return null;
  // Dependency-first append is valid and conservatively includes the committed basket.
  const price=chain.reduce((n,a,i)=>n+a.price*plan.multiplier**(plan.base.length+i),plan.base.reduce((n,a,i)=>n+a.price*plan.multiplier**i,plan.donations));
  const rep=Math.max(...chain.map(a=>a.rep));return {a,price,eta:Math.max(seconds(price-worth,cashRate),seconds(rep-reputation,repRate)),benefit:chain.reduce((n,a)=>n+value(a),0)};
 }).filter(r=>r&&Number.isFinite(r.price));
 const tie=(a,b)=>a.a.name.localeCompare(b.a.name),lanes=[
  [...rows].sort((a,b)=>b.benefit-a.benefit||a.price-b.price||tie(a,b)),
  [...rows].sort((a,b)=>a.price-b.price||b.benefit-a.benefit||tie(a,b)),
  [...rows].sort((a,b)=>a.eta-b.eta||b.benefit-a.benefit||tie(a,b))];
 const shortlist=[];for(let i=0;shortlist.length<6&&i<rows.length;i++)for(const lane of lanes){
  const a=lane[i]?.a;if(a&&!shortlist.some(b=>b.name===a.name))shortlist.push(a);if(shortlist.length===6)break;
 }
 const candidates=[],seen=new Set();
 const quote=names=>{
  const extra=closure(names);if(!extra||extra.length<2)return;
  const signature=extra.map(a=>a.name).sort().join('\0');if(seen.has(signature))return;seen.add(signature);
  const remaining=[...plan.base,...extra],have=new Set(owned),ordered=[];
  while(remaining.length){
   let index=-1;for(let i=0;i<remaining.length;i++){
    const a=remaining[i];if(!a.prereqs.every(p=>have.has(p)))continue;
    if(a.name==='NeuroFlux Governor'&&remaining.some((b,j)=>j!==i&&b.name===a.name&&b.price<a.price))continue;
    if(index<0||a.price>remaining[index].price||a.price===remaining[index].price&&a.name<remaining[index].name)index=i;
   }
   if(index<0)return;const [a]=remaining.splice(index,1);ordered.push(a);have.add(a.name);
  }
  const cost=ordered.reduce((n,a,i)=>n+a.price*plan.multiplier**i,plan.donations),rep=Math.max(...extra.map(a=>a.rep));
  const eta=Math.max(seconds(cost-worth,cashRate),seconds(rep-reputation,repRate))*1000;
  if(!Number.isFinite(cost)||!Number.isFinite(eta)||eta<=0||eta>900000)return;
  const stats={};for(const a of extra)for(const [k,v]of Object.entries(a.stats))stats[k]=(stats[k]??1)*v;
  if(Object.values(stats).some(v=>!Number.isFinite(v)))return;
  candidates.push({name:extra.map(a=>a.name).sort().join(' + '),eta,stats,cashTarget:cost,
   augmentations:extra.map(a=>({name:a.name,stats:a.stats})),gangBundle:{faction:plan.faction,ownershipSignature:plan.ownershipSignature,rep,cost,chain:extra.map(a=>a.name)},
   funding:{seconds:eta/1000,cashSeconds:seconds(cost-worth,cashRate),reputationSeconds:seconds(rep-reputation,repRate),donationCost:0,workByFaction:{},passiveByFaction:{[plan.faction]:seconds(rep-reputation,repRate)}}});
 };
 for(let i=0;i<shortlist.length;i++)for(let j=i+1;j<shortlist.length;j++){
  quote([shortlist[i].name,shortlist[j].name]);
  for(let k=j+1;k<shortlist.length;k++)quote([shortlist[i].name,shortlist[j].name,shortlist[k].name]);
 }
 return candidates;
}

/** A selected bundle changes production goals only with matching, fresh validated ownership. */
export function readSelectedGangBundleGoal(ns,faction,reset,now=Date.now()){
 try{
  const wait=JSON.parse(ns.read('tasks/augmentation-wait-plan.json')),summary=JSON.parse(ns.read('/Temp/affordable-augs.txt')),
   target=wait.plan,b=target?.gangBundle,p=summary.speedSnapshot?.gangBundlePlan;
  if(wait.schemaVersion!==1||wait.active!==true||wait.nodeReset!==reset.lastNodeReset||wait.augReset!==reset.lastAugReset||
   !Number.isFinite(wait.at)||wait.at>now||now-wait.at>120000||!Number.isFinite(wait.startedAt)||wait.startedAt<reset.lastAugReset||wait.startedAt>now||
   !Number.isFinite(wait.expiresAt)||wait.expiresAt<=now||wait.expiresAt-wait.startedAt>900000||
   !ns.ps('home').some(p=>p.pid===wait.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js')||
   target?.worthWaiting!==true||typeof target.name!=='string'||!target.name||!Number.isFinite(target.at)||target.at>now||now-target.at>120000||!Number.isFinite(target.deadline)||target.deadline<=now||target.deadline>wait.expiresAt||
   summary.schemaVersion!==1||summary.nodeReset!==reset.lastNodeReset||summary.augReset!==reset.lastAugReset||!Number.isFinite(summary.at)||summary.at>now||now-summary.at>120000||
   typeof b?.ownershipSignature!=='string'||!b.ownershipSignature||b.ownershipSignature!==summary.ownershipSignature||p?.ownershipSignature!==b.ownershipSignature||p?.faction!==faction||b.faction!==faction||
   !Array.isArray(b.chain)||b.chain.length<2||b.chain.length>12||b.chain.some(n=>typeof n!=='string'||n==='NeuroFlux Governor')||new Set(b.chain).size!==b.chain.length||
   !Array.isArray(p.catalog)||!Array.isArray(p.base)||!Array.isArray(p.owned)||![b.rep,b.cost,target.cashTarget].every(Number.isFinite)||b.rep<0||b.cost<0||b.cost!==target.cashTarget)return null;
  const catalog=new Map(p.catalog.map(a=>[a.name,a])),have=new Set([...p.owned,...p.base.map(a=>a.name),...b.chain]);
  const items=b.chain.map(n=>catalog.get(n));if(items.some(a=>!a||!Number.isFinite(a.rep)||a.rep<0||!Array.isArray(a.prereqs)||!a.prereqs.every(n=>have.has(n))))return null;
  const pending=[...items],complete=new Set([...p.owned,...p.base.map(a=>a.name)]);
  while(pending.length){const i=pending.findIndex(a=>a.prereqs.every(n=>complete.has(n)));if(i<0)return null;complete.add(pending.splice(i,1)[0].name);}
  if(Math.max(...items.map(a=>a.rep))!==b.rep)return null;
  return {name:target.name,chain:[...b.chain],rep:b.rep,cost:b.cost,source:'selected-gang-bundle',deadline:target.deadline};
 }catch{return null;}
}
