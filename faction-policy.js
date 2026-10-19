/** Normalize flag values without changing faction names containing spaces. */
export function factionForcedJoins(value,node,gang,gangAvailable,karma,preferences={}) {
 const names=value==null?[...(node===10?['The Covenant']:[]),...(!gang&&gangAvailable&&(node===2||karma<=-53000)?planGangHost([],preferences).inviteOrder:[])]:[value].flat(Infinity);
 return [...new Set(names.filter(n=>typeof n==='string'&&n.trim()).map(n=>n.replaceAll('_',' ').trim()))];
}
/** Fresh native checks; serialized workers have no imported dependencies. */
export function factionControlAllowed(api,parent,script,focus=false,now=Date.now()) {
 if(!api.isRunning(parent)||api.read('remote-control/paused/'+script+'.txt').trim()==='true')return false;
 if(focus){
  for(const file of ['tasks/activity-lock.json','tasks/automation-maintenance.json'])try{
   const r=JSON.parse(api.read(file)),owner=r.ownerPid;
   if(r.expiresAt>now&&owner!==parent&&api.isRunning(owner))return false;
  }catch{}
  if(['GRAFTING','CREATE_PROGRAM'].includes(api.currentWork()?.type))return false;
 }
 return true;
}
/** Spend only fresh affordable amounts; native APIs enforce membership/prerequisites. */
export function factionPurchaseBatch(api,orders,allowed,reserve,donations=false,repMultiplier=1) {
 let successes=0;
 for(const o of orders){
  if(!allowed())break;
  const cash=api.player().money,keep=Math.max(0,Number(reserve())||0);
  if(donations){
   const gap=Math.max(0,o.targetRep-api.rep(o.faction));
   if(gap===0){successes++;continue;}
   const multiplier=api.player().mults.faction_rep*repMultiplier;
   if(!Number.isFinite(multiplier)||multiplier<=0)continue;
   const amount=Math.min(o.repDonation,Math.ceil(1e6*gap/multiplier));
   if(!Number.isFinite(amount)||amount<=0||amount>cash-keep)continue;
   if(api.donate(o.faction,amount))successes++;
  }else{
   const price=api.price(o.augmentation);
   if(!Number.isFinite(price)||price<0||price>cash-keep)continue;
   if(api.buy(o.faction,o.augmentation))successes++;
  }
 }
 return successes;
}


/** City membership is a strategic choice shared by all invitation handlers. */
export function planFactionCityGroup({joined=[],factions={}},preferred=[],skip=[]) {
 const groups=[['Aevum','Sector-12'],['Chongqing','New Tokyo','Ishima'],['Volhaven']];
 const existing=groups.find(group=>group.some(name=>joined.includes(name)));
 const chosen=preferred.find(name=>groups.some(group=>group.includes(name))&&!skip.includes(name));
 const weights={hacking_exp:4,hacking:3,hacking_speed:3,hacking_grow:1,hacking_money:1,hacking_chance:1,faction_rep:3,company_rep:1.5};
 const scores=groups.map(group=>{
  const augs=new Map();
  for(const name of group.filter(f=>!skip.includes(f)))for(const aug of factions[name]||[]){
   const special=aug.name==='Neuroreceptor Management Implant'?3:aug.name==='CashRoot Starter Kit' ? .5 : 0;
   const benefit=special+Object.entries(aug.stats||{}).reduce((sum,[key,mult])=>sum+(weights[key]||.1)*Math.log(Math.max(1,Number(mult)||1)),0);
   const value=benefit*(aug.covered ? .25 : 1)/(1+Math.log10(1+Math.max(0,Number(aug.rep)||0)));
   augs.set(aug.name,Math.max(augs.get(aug.name)||0,value));
  }
  return {group,score:[...augs.values()].reduce((sum,value)=>sum+value,0)};
 });
 const best=[...scores].sort((a,b)=>b.score-a.score)[0];
 const group=existing||groups.find(group=>group.includes(chosen))||(best?.score>0?best.group:null);
 return {group,preferred:chosen||null,scores,reason:existing?'Keep the compatible city group already joined':chosen?'Explicit city preference':group?'Remaining augmentation benefit, adjusted for reputation requirements and alternate suppliers':'No useful city augmentations remain'};
}

/** Self-contained native-worker guard; native joinFaction validates the invitation itself. */
export function factionJoinAllowed(api,name) {
 const groups=[['Aevum','Sector-12'],['Chongqing','New Tokyo','Ishima'],['Volhaven']];
 const target=groups.find(group=>group.includes(name));
 if(!target)return true;
 const joined=api.joined();
 const existing=groups.find(group=>group.some(f=>joined.includes(f)));
 let plan;try{plan=JSON.parse(api.read('tasks/faction-join-plan.json'));}catch{}
 const reset=api.reset(),fresh=plan?.nodeReset===reset.lastNodeReset&&plan?.augReset===reset.lastAugReset;
 if(fresh&&(plan.skip||[]).includes(name))return false;
 if(existing)return existing.includes(name);
 try{
  return plan.nodeReset===reset.lastNodeReset&&plan.augReset===reset.lastAugReset&&
   Array.isArray(plan.group)&&plan.group.length===target.length&&target.every(f=>plan.group.includes(f))&&!(plan.skip||[]).includes(name);
 }catch{return false;}
}

export function rankFactionInvites(invites,gangNeeded=false,preferences={}) {
 const gang=planGangHost([],preferences).inviteOrder;
 const priority=name=>name==='Daedalus'?0:gangNeeded&&gang.includes(name)?1:2;
 return [...new Set(invites)].sort((a,b)=>priority(a)-priority(b));
}

/** One host policy for invitation work and creation. Membership alone never selects a gang type. */
export function planGangHost(joined=[], preferences={}, skip=[], metadata={}) {
 const combat=['Speakers for the Dead','The Dark Army','The Syndicate','Tetrads','Slum Snakes'];
 const hacking=['The Black Hand','NiteSec'];
 const all=[...combat,...hacking];
 const rawHost=preferences['gang-faction'];
 const host=typeof rawHost==='string'?rawHost.replaceAll('_',' ').trim():rawHost||null;
 const type=host?(hacking.includes(host)?'hacking':'combat'):(preferences['gang-type']||'combat');
 const excluded=[...skip,...(Array.isArray(preferences['gang-skip'])?preferences['gang-skip']:[])];
 const error=preferences.error||(!['combat','hacking'].includes(type)?'gang-type must be combat or hacking.':null)||
  (host&&!all.includes(host)?'gang-faction must name a gang-capable faction.':null)||
  (!Array.isArray(preferences['gang-skip']||[])?'gang-skip must be an array.':null)||
  (host&&excluded.includes(host)?'The requested gang faction is excluded.':null);
 if(error)return {error,type,host:null,ready:[],inviteOrder:[]};
 const candidates=(host?[host]:type==='hacking'?hacking:combat).filter(f=>!excluded.includes(f));
 const ready=candidates.filter(f=>joined.includes(f)).sort((a,b)=>
  (Number(metadata[b]?.favor)||0)-(Number(metadata[a]?.favor)||0)||
  (Number(metadata[b]?.unique)||0)-(Number(metadata[a]?.unique)||0)||candidates.indexOf(a)-candidates.indexOf(b));
 const easy=type==='hacking'?['NiteSec','The Black Hand']:['Slum Snakes','Tetrads','The Syndicate','The Dark Army','Speakers for the Dead'];
 return {error:null,type,host:ready[0]||null,ready,inviteOrder:host?candidates:easy.filter(f=>candidates.includes(f))};
}

/** Config is shared even before gangs.js starts; live flags override it while its owner is running. */
export function gangHostPreferences(ns) {
 let config={};
 try {
  const raw=ns.read('gangs.js.config.txt');
  if(raw){config=JSON.parse(raw);if(Array.isArray(config))config=Object.fromEntries(config);
   if(!config||typeof config!=='object')throw new Error('Expected gang configuration object.');}
 }catch{return {error:'Cannot read gangs.js.config.txt; gang host selection is deferred.'};}
 try {
  const active=JSON.parse(ns.read('tasks/gang-host-preferences.json')),reset=ns.getResetInfo();
  if(active.nodeReset===reset.lastNodeReset&&active.augReset===reset.lastAugReset&&ns.isRunning(active.ownerPid))
   config={...config,...active.preferences};
 }catch{}
 try{const p=JSON.parse(ns.read('tasks/faction-join-plan.json')),r=ns.getResetInfo();
  if(p.nodeReset===r.lastNodeReset&&p.augReset===r.lastAugReset&&Array.isArray(p.skip)&&Array.isArray(config['gang-skip']||[]))
   config={...config,'gang-skip':[...new Set([...(config['gang-skip']||[]),...p.skip])]};
 }catch{}
 return config;
}


/** Fill a bounded cheap-augmentation budget; ordinary purchase ordering still enforces price scaling. */
export function augmentationCountCandidates(augmentations,owned,required,money,budgetFraction=.1) {
 const names=new Set(owned.filter(n=>n!=='NeuroFlux Governor'));
 const missing=Math.max(0,required-names.size),chosen=[];
 let budget=Math.max(0,money)*Math.max(0,Math.min(.2,budgetFraction));
 const remaining=augmentations.filter(a=>a.name!=='NeuroFlux Governor'&&!names.has(a.name)&&a.available&&Number.isFinite(a.price)&&a.price>=0)
  .sort((a,b)=>a.price-b.price||a.rep-b.rep);
 for(let pass=0;pass<remaining.length&&chosen.length<missing;pass++){
  let changed=false;
  for(const a of remaining){
   if(names.has(a.name)||!a.prereqs.every(p=>names.has(p))||a.price>budget)continue;
   chosen.push(a.name);names.add(a.name);budget-=a.price;changed=true;
   if(chosen.length>=missing)break;
  }if(!changed)break;
 }
 return chosen;
}

export function selectGangAugmentationGoal(augmentations,{owned=[],money=0,rep=0,cashRate=0,repRate=0}={}) {
 const names=new Set(owned);
 const candidates=augmentations.filter(a=>a.desired&&a.name!=='NeuroFlux Governor'&&!names.has(a.name)&&a.prereqs.every(p=>names.has(p))&&Number.isFinite(a.cost)&&a.cost>=0&&Number.isFinite(a.rep)&&a.rep>=0);
 const eta=(gap,rate)=>gap<=0?0:rate>0?gap/rate:Infinity;
 const scored=candidates.map(a=>({...a,eta:Math.max(eta(a.cost-money,cashRate),eta(a.rep-rep,repRate))}));
 scored.sort((a,b)=>a.eta-b.eta||a.cost-b.cost||a.rep-b.rep);
 const target=scored[0];return target?{name:target.name,cost:target.cost,rep:target.rep,etaSeconds:Number.isFinite(target.eta)?target.eta:null}:null;
}

/** Repeatedly remove missing prerequisite chains after any change to a purchase basket. */
export function pruneAugmentationPrerequisites(items,owned=[]) {
 const have=new Set(owned);let result=items.slice(),changed=true;
 while(changed){const names=new Set(result.map(a=>a.name)),next=result.filter(a=>(a.prereqs||[]).every(p=>have.has(p)||names.has(p)));changed=next.length!==result.length;result=next;}
 return result;
}

/** Exact minimum-price topological order up to 14 items; larger baskets get bounded valid insertions.
 * Preserve object identities and never return a more costly order than the old dependency-first baseline. */
export function optimizeAugmentationOrder(items,multiplier=1.9) {
 if(!Number.isFinite(multiplier)||multiplier<1)throw Error('Invalid augmentation price multiplier');
 const nodes=items.slice().sort((a,b)=>(a.name==='NeuroFlux Governor'&&b.name===a.name?a.price-b.price:0)||b.price-a.price||a.name.localeCompare(b.name));
 if(nodes.some(a=>typeof a.name!=='string'||!Number.isFinite(a.price)||a.price<0))throw Error('Invalid augmentation data');
 const n=nodes.length,byName=new Map();
 nodes.forEach((a,i)=>{if(!byName.has(a.name))byName.set(a.name,i);else if(a.name!=='NeuroFlux Governor')throw Error('Duplicate augmentation '+a.name);});
 const deps=nodes.map(a=>[...new Set((a.prereqs||[]).map(p=>byName.get(p)).filter(i=>i!==undefined))]);
 let lastNf=null;
 nodes.forEach((a,i)=>{if(a.name==='NeuroFlux Governor'){if(lastNf!==null)deps[i].push(lastNf);lastNf=i;}});
 const state=new Uint8Array(n),baseline=[];
 const visit=i=>{if(state[i]===1)throw Error('Cyclic augmentation prerequisites');if(state[i]===2)return;state[i]=1;for(const d of deps[i])visit(d);state[i]=2;baseline.push(i);};
 for(let i=0;i<n;i++)visit(i);
 const cost=order=>order.reduce((sum,i,k)=>sum+nodes[i].price*Math.pow(multiplier,k),0);
 if(n<=14){
  const size=1<<n,dp=new Float64Array(size).fill(Infinity),previous=new Int32Array(size).fill(-1),chosen=new Int16Array(size).fill(-1);
  const masks=deps.map(ds=>ds.reduce((m,i)=>m|(1<<i),0));dp[0]=0;
  for(let mask=0;mask<size;mask++)if(Number.isFinite(dp[mask])){
   let count=0;for(let bits=mask;bits;bits&=bits-1)count++;
   const factor=Math.pow(multiplier,count);
   for(let i=0;i<n;i++)if(!(mask&(1<<i))&&(masks[i]&mask)===masks[i]){
    const next=mask|(1<<i),value=dp[mask]+nodes[i].price*factor;
    if(value<dp[next]){dp[next]=value;previous[next]=mask;chosen[next]=i;}
   }
  }
  if(Number.isFinite(dp[size-1])){const order=[];for(let m=size-1;m;m=previous[m])order.push(chosen[m]);return order.reverse().map(i=>nodes[i]);}
 }
 const greedy=[],remaining=new Set(nodes.map((_,i)=>i)),done=new Set();
 while(remaining.size){const next=[...remaining].find(i=>deps[i].every(d=>done.has(d)));if(next===undefined)throw Error('Cyclic augmentation prerequisites');greedy.push(next);done.add(next);remaining.delete(next);}
 let best=cost(greedy)<cost(baseline)?greedy:baseline,bestCost=cost(best),evaluations=0;
 const valid=order=>{const positions=new Int32Array(n);order.forEach((v,i)=>positions[v]=i);return deps.every((ds,i)=>ds.every(d=>positions[d]<positions[i]));};
 for(let pass=0;pass<4&&evaluations<4000;pass++){
  let improved=false;
  for(let from=0;from<n&&evaluations<4000;from++)for(let to=0;to<n&&evaluations<4000;to++){
   if(from===to)continue;evaluations++;
   const trial=best.slice(),item=trial.splice(from,1)[0];trial.splice(to,0,item);
   if(!valid(trial))continue;const value=cost(trial);
   if(value<bestCost){best=trial;bestCost=value;improved=true;}
  }
  if(!improved)break;
 }
 return best.map(i=>nodes[i]);
}

/** Missing prerequisite closure, excluding owned and already-ready augmentations.
 * Unavailable, excluded, repeatable or cyclic chains cannot justify delaying an install. */
export function augmentationPrerequisiteChain(target,catalog,{owned=[],ready=[],allowed=()=>true}={}) {
 const have=new Set([...owned,...ready]),visiting=new Set(),done=new Set(),chain=[];
 const visit=name=>{
  if(have.has(name)||done.has(name))return true;
  const item=catalog[name];
  if(!item||name==='NeuroFlux Governor'||visiting.has(name)||!allowed(item)||
   !Number.isFinite(item.price)||item.price<0||!Array.isArray(item.prereqs))return false;
  visiting.add(name);
  for(const prerequisite of item.prereqs)if(!visit(prerequisite))return false;
  visiting.delete(name);done.add(name);chain.push(item);return true;
 };
 return typeof target==='string'&&visit(target)&&chain.length?chain:null;
}

/** Price a future basket at current native prices (already including queued inflation).
 * Retain the committed donation budget and never mutate the live purchase order. */
export function futureAugmentationBasketCost(items,candidate,{owned=[],multiplier=1.9,donations=0}={}) {
 if(!Array.isArray(items)||!candidate||!Array.isArray(owned)||!Number.isFinite(donations)||donations<0)return null;
 try {
  const basket=[...items,candidate],have=new Set(owned);
  if(have.has(candidate.name)||pruneAugmentationPrerequisites(basket,owned).length!==basket.length)return null;
  const ordered=optimizeAugmentationOrder(basket,multiplier);
  const price=list=>list.reduce((sum,a,i)=>sum+a.price*multiplier**i,0);
  // Large-basket search is bounded: keep the valid existing order if it is cheaper.
  const seen=new Set(owned);
  const appendValid=basket.every(a=>{
   if(!(a.prereqs||[]).every(name=>seen.has(name)))return false;
   seen.add(a.name);return true;
  });
  const cost=Math.min(price(ordered),appendValid?price(basket):Infinity)+donations;
  return Number.isFinite(cost)?cost:null;
 } catch { return null; }
}

/** Native installed levels plus explicit queued NF entries; SoA never changes this count. */
export function neuroFluxLevels(reset,queued=[]) {
 const owned=reset?.ownedAugs;
 if(!owned||typeof owned!=='object'||!Array.isArray(queued)||queued.some(n=>typeof n!=='string'))return null;
 const level=(typeof owned.get==='function'?owned.get('NeuroFlux Governor'):owned['NeuroFlux Governor'])??0;
 if(!Number.isSafeInteger(level)||level<0)return null;
 const pending=queued.filter(name=>name==='NeuroFlux Governor').length;
 if(!Number.isSafeInteger(level+pending))return null;
 return {installed:level,queued:pending,purchased:level+pending};
}

/** Per-level provider selection: use existing reputation, then minimum additional donation. */
export function chooseNeuroFluxFaction(factions,requiredRep,plannedDonations={}) {
 if(!Number.isFinite(requiredRep)||requiredRep<0)return null;
 const choices=[];
 for(const f of factions){
  if(typeof f.name!=='string'||!Number.isFinite(f.rep)||f.rep<0)continue;
  const free=f.rep>=requiredRep,total=free?0:f.donationCost;
  if(!Number.isFinite(total)||total<0)continue;
  const saved=Number.isFinite(plannedDonations[f.name])?Math.max(0,plannedDonations[f.name]):0;
  choices.push({faction:f.name,totalDonation:total,additionalDonation:Math.max(0,total-saved),free,rep:f.rep});
 }
 choices.sort((a,b)=>a.additionalDonation-b.additionalDonation||Number(b.free)-Number(a.free)||b.rep-a.rep||a.faction.localeCompare(b.faction));
 return choices[0]||null;
}

/** Extra donation needed beyond the existing basket's committed faction budgets.
 * Providers with existing reputation supply a zero requirement even when donations are disabled. */
export function augmentationDonationTopUp(providers,plannedDonations={}) {
 let best=Infinity;
 for(const provider of providers){
  const required=provider.requiredDonation,committed=plannedDonations[provider.faction]??0;
  if(typeof provider.faction!=='string'||!Number.isFinite(required)||required<0||
   !Number.isFinite(committed)||committed<0)continue;
  best=Math.min(best,Math.max(0,required-committed));
 }
 return Number.isFinite(best)?best:null;
}

/** Donations buy shared faction reputation: charge the maximum requirement, never the sum.
 * The caller snapshots selected providers so hypothetical cuts cannot change purchase routing. */
export function sharedAugmentationDonationCost(items,requirements) {
 const totals=new Map();
 for(const item of items){
  const requirement=requirements.get(item);
  if(!requirement||typeof requirement.faction!=='string'||!Number.isFinite(requirement.amount)||requirement.amount<0)
   throw Error('Invalid augmentation donation requirement');
  totals.set(requirement.faction,Math.max(totals.get(requirement.faction)||0,requirement.amount));
 }
 return [...totals.values()].reduce((sum,amount)=>sum+amount,0);
}

/** Select a safe marginal basket cut; prerequisite closures and priority milestones remain intact.
 * Savings use the valid retained order, before a subsequent optimizer can lower its cost further. */
export function selectAugmentationBasketDrop(items,{owned=[],priority=[],route='hacking',multiplier=1.9,countWeight=0,donationCost=()=>0}={}) {
 if(!Number.isFinite(multiplier)||multiplier<1)return null;
 const weights=route==='bladeburner'?{strength:1,defense:1,dexterity:1,agility:1,strength_exp:.4,defense_exp:.4,dexterity_exp:.4,agility_exp:.4,bladeburner_success_chance:4,bladeburner_max_stamina:2,bladeburner_stamina_gain:2,bladeburner_analysis:.5,faction_rep:.2}:
  {hacking:3,hacking_exp:2,hacking_speed:2,hacking_chance:1,hacking_money:1,hacking_grow:1,faction_rep:1,company_rep:.5,company_rep_exp:.1};
 const value=a=>Math.max(0,Object.entries(a.stats||{}).reduce((sum,[key,v])=>Number.isFinite(v)&&v>0?sum+(weights[key]||0)*Math.log(v):sum,0))+
  (a.name!=='NeuroFlux Governor'?Math.max(0,Number(countWeight)||0):0);
 const cost=list=>list.reduce((sum,a,i)=>sum+a.price*Math.pow(multiplier,i),0)+donationCost(list),before=cost(items),protectedNames=new Set(priority);
 if(!Number.isFinite(before))return null;
 let best=null;
 for(const item of items){
  if(protectedNames.has(item.name))continue;
  const remaining=pruneAugmentationPrerequisites(items.filter(a=>a!==item),owned),names=new Set(remaining.map(a=>a.name));
  const removed=items.filter(a=>!names.has(a.name));
  if(removed.some(a=>protectedNames.has(a.name)))continue;
  const savings=before-cost(remaining);if(!(savings>=0&&Number.isFinite(savings)))continue;
  const lostBenefit=removed.reduce((sum,a)=>sum+value(a),0),ratio=savings>0?lostBenefit/savings:Infinity;
  if(!best||ratio<best.ratio||ratio===best.ratio&&savings>best.savings)best={name:item.name,remaining,removed:removed.map(a=>a.name),savings,lostBenefit,ratio};
 }
 return best;
}

/** Terminal tables are explicitly requested; automated faction planning stays in logs. */
export function factionTerminalOutput(options={}) {
 const yes=value=>value===true||value==='true';
 return !yes(options['log-only'])&&!options['join-only']&&(yes(options.v)||yes(options.verbose));
}
