/** Compare the next AdVert alone against one Wilson level followed by that AdVert.
 * Only the next advertisement's estimated benefit is credited, not speculative future purchases. */
export function quoteCorporationAdvertisingCandidate({division,industry,level,wilsonCost,advertCost,benefit}={}){
 if(typeof division?.name!=='string'||!division.name||![division.awareness,division.popularity,wilsonCost,advertCost].every(Number.isFinite)||division.awareness<0||division.popularity<0||wilsonCost<=0||advertCost<=0||!Number.isSafeInteger(level)||level<0||!Number.isSafeInteger(level+1)||!Number.isSafeInteger(division.numAdVerts)||division.numAdVerts<0||!Number.isSafeInteger(division.numAdVerts+1)||typeof benefit!=='function')return null;
 try{
  const alone=benefit(division,industry,level),combined=benefit(division,industry,level+1),cost=wilsonCost+advertCost;
  if(![alone,combined,cost].every(Number.isFinite)||alone<=0||combined<=alone)return null;
  return {division:division.name,level,adverts:division.numAdVerts,wilsonCost,advertCost,cost,aloneBenefit:alone,benefit:combined,score:combined/cost,aloneScore:alone/advertCost,basis:'Estimated benefit of the next advertisement only'};
 }catch{return null;}
}
export function quoteCorporationAdvertisingBundle(args={}){
 const margin=args.minImprovement??.05,q=quoteCorporationAdvertisingCandidate(args);
 return Number.isFinite(margin)&&margin>=0&&margin<=1&&q&&q.score>q.aloneScore*(1+margin)?q:null;
}

/** Enumerate at most 92 subsets: eight priced divisions, up to three adverts each
 * sharing one Wilson level. Values already include division profit and timing discounts. */
export function planCorporationAdvertisingGroups(candidates,{level,wilsonCost,maxCost,maxCandidates=8,maxAds=3,minImprovement=.05}={}){
 if(!Array.isArray(candidates)||!Number.isSafeInteger(level)||level<0||!Number.isSafeInteger(level+1)||![wilsonCost,maxCost,minImprovement].every(Number.isFinite)||wilsonCost<=0||maxCost<=wilsonCost||minImprovement<0||minImprovement>1)return [];
 const limit=Number.isSafeInteger(maxCandidates)?Math.max(1,Math.min(8,maxCandidates)):8,count=Number.isSafeInteger(maxAds)?Math.max(1,Math.min(3,maxAds)):3;
 const unique=new Map();
 for(const q of candidates.slice(0,128)){
  if(typeof q?.division!=='string'||!q.division||q.level!==level||q.wilsonCost!==wilsonCost||!Number.isSafeInteger(q.adverts)||q.adverts<0||!Number.isSafeInteger(q.adverts+1)||![q.advertCost,q.aloneBenefit,q.benefit,q.aloneValue].every(Number.isFinite)||q.advertCost<=0||q.aloneBenefit<=0||q.benefit<=q.aloneBenefit||q.aloneValue<=0)continue;
  const combinedValue=q.aloneValue*q.benefit/q.aloneBenefit;if(!Number.isFinite(combinedValue)||combinedValue<=0)continue;
  const row={...q,combinedValue},old=unique.get(q.division);
  if(!old||row.combinedValue/row.advertCost>old.combinedValue/old.advertCost)unique.set(q.division,row);
 }
 const pool=[...unique.values()].sort((a,b)=>b.combinedValue/b.advertCost-a.combinedValue/a.advertCost||a.division.localeCompare(b.division)).slice(0,limit),groups=[];
 const visit=(start,rows,cost,alone,value)=>{
  const total=wilsonCost+cost;
  if(rows.length&&total<=maxCost&&Number.isFinite(total)&&Number.isFinite(alone)&&Number.isFinite(value)&&value/total>alone/cost*(1+minImprovement))
   groups.push({level,wilsonCost,cost:total,advertisements:rows,score:value/total,aloneScore:alone/cost,estimatedValue:value,aloneValue:alone,basis:'Sum of per-division planned advert values; Wilson charged once'});
  if(rows.length>=count)return;
  for(let i=start;i<pool.length;i++){const row=pool[i];if(wilsonCost+cost+row.advertCost<=maxCost)visit(i+1,[...rows,row],cost+row.advertCost,alone+row.aloneValue,value+row.combinedValue);}
 };
 visit(0,[],0,0,0);
 return groups.sort((a,b)=>b.score-a.score||b.estimatedValue-a.estimatedValue||a.cost-b.cost);
}

/** Preflight the whole group before Wilson, then recheck every remaining native bill.
 * Receipts identify each unfinished advert so recovery never repeats the shared upgrade. */
export function executeCorporationAdvertisingGroup(api,quote,{cash,reserve,allowed=()=>true}={}){
 const receipt={state:'rejected',wilsonPurchased:false,advertPurchased:false,advertisementsPurchased:[],pending:[],reason:'Invalid group quote'};
 const ads=quote?.advertisements;
 if(!Array.isArray(ads)||!ads.length||ads.length>3||new Set(ads.map(a=>a?.division)).size!==ads.length||typeof cash!=='function'||typeof reserve!=='function'||!Number.isSafeInteger(quote.level)||quote.level<0||!Number.isSafeInteger(quote.level+1)||!Number.isFinite(quote.wilsonCost)||quote.wilsonCost<=0||!Number.isFinite(quote.cost)||
  ads.some(a=>typeof a?.division!=='string'||!a.division||!Number.isSafeInteger(a.adverts)||a.adverts<0||!Number.isSafeInteger(a.adverts+1)||!Number.isFinite(a.advertCost)||a.advertCost<=0)||quote.cost!==quote.wilsonCost+ads.reduce((s,a)=>s+a.advertCost,0))return receipt;
 receipt.pending=ads.map(a=>a.division);
 const result=reason=>({...receipt,state:receipt.wilsonPurchased?(receipt.pending.length?'partial':'purchased'):'rejected',advertPurchased:receipt.pending.length===0,reason});
 const funded=cost=>{const funds=cash(),hold=reserve();return Number.isFinite(funds)&&Number.isFinite(hold)&&hold>=0&&funds>hold+cost;};
 const remainingCost=()=>{
  let cost=0;
  for(const a of ads.filter(a=>receipt.pending.includes(a.division))){
   const price=api.getHireAdVertCost(a.division);
   if(api.getDivision(a.division).numAdVerts!==a.adverts||!Number.isFinite(price)||price<=0||price>a.advertCost)return null;
   cost+=price;
  }
  return Number.isFinite(cost)?cost:null;
 };
 try{
  if(!allowed())return result('Automation suspended');
  if(api.getUpgradeLevel('Wilson Analytics')!==quote.level)return result('Wilson level changed');
  const wilson=api.getUpgradeLevelCost('Wilson Analytics'),adCost=remainingCost();
  if(!Number.isFinite(wilson)||wilson<=0||wilson>quote.wilsonCost||adCost===null||!funded(wilson+adCost))return result('Group prices, native state or reserves changed');
  if(!allowed())return result('Automation suspended');
  api.levelUpgrade('Wilson Analytics');receipt.wilsonPurchased=api.getUpgradeLevel('Wilson Analytics')===quote.level+1;
  if(!receipt.wilsonPurchased)return result('Wilson upgrade was not confirmed');
  for(const a of ads){
   if(!allowed())return result('Automation suspended after Wilson');
   const cost=remainingCost();if(cost===null||!funded(cost))return result('Remaining advertising prices, state or reserves changed');
   if(!allowed())return result('Automation suspended after Wilson');
   api.hireAdVert(a.division);
   if(api.getDivision(a.division).numAdVerts!==a.adverts+1)return result('Advertisement was not confirmed');
   receipt.advertisementsPurchased.push(a.division);receipt.pending=receipt.pending.filter(n=>n!==a.division);
  }
  return result('Wilson upgraded before all planned advertisements');
 }catch{
  try{receipt.wilsonPurchased=api.getUpgradeLevel('Wilson Analytics')===quote.level+1;}catch{}
  for(const a of ads)try{if(api.getDivision(a.division).numAdVerts===a.adverts+1&&!receipt.advertisementsPurchased.includes(a.division)){receipt.advertisementsPurchased.push(a.division);receipt.pending=receipt.pending.filter(n=>n!==a.division);}}catch{}
  return result('Native purchase failed; confirmed steps retained');
 }
}

/** Synchronous, ordered native purchases. Partial spending cannot be rolled back;
 * the receipt lets the controller resume advertising without buying Wilson again. */
export function executeCorporationAdvertisingBundle(api,quote,{cash,reserve,allowed=()=>true}={}){
 const receipt={state:'rejected',wilsonPurchased:false,advertPurchased:false,reason:'Invalid bundle quote'};
 const fail=reason=>({...receipt,state:receipt.wilsonPurchased?'partial':'rejected',reason});
 if(!quote||typeof quote.division!=='string'||!quote.division||![quote.wilsonCost,quote.advertCost,quote.cost].every(Number.isFinite)||quote.wilsonCost<=0||quote.advertCost<=0||quote.cost!==quote.wilsonCost+quote.advertCost||!Number.isSafeInteger(quote.level)||quote.level<0||!Number.isSafeInteger(quote.level+1)||!Number.isSafeInteger(quote.adverts)||quote.adverts<0||!Number.isSafeInteger(quote.adverts+1)||typeof cash!=='function'||typeof reserve!=='function')return receipt;
 const funded=cost=>{const funds=cash(),hold=reserve();return Number.isFinite(funds)&&Number.isFinite(hold)&&hold>=0&&funds>hold+cost;};
 try{
  if(!allowed())return fail('Automation suspended');
  if(api.getUpgradeLevel('Wilson Analytics')!==quote.level||api.getDivision(quote.division).numAdVerts!==quote.adverts)return fail('Native state changed');
  const wilson=api.getUpgradeLevelCost('Wilson Analytics'),advert=api.getHireAdVertCost(quote.division);
  if(![wilson,advert].every(v=>Number.isFinite(v)&&v>0)||wilson>quote.wilsonCost||advert>quote.advertCost||!funded(wilson+advert))return fail('Native prices or reserves changed');
  if(!allowed())return fail('Automation suspended');
  api.levelUpgrade('Wilson Analytics');
  receipt.wilsonPurchased=api.getUpgradeLevel('Wilson Analytics')===quote.level+1;
  if(!receipt.wilsonPurchased)return fail('Wilson upgrade was not confirmed');
  if(!allowed())return fail('Automation suspended after Wilson');
  const next=api.getHireAdVertCost(quote.division);
  if(api.getDivision(quote.division).numAdVerts!==quote.adverts||!Number.isFinite(next)||next<=0||next>quote.advertCost||!funded(next))return fail('Advertisement quote or reserves changed after Wilson');
  if(!allowed())return fail('Automation suspended after Wilson');
  api.hireAdVert(quote.division);
  receipt.advertPurchased=api.getDivision(quote.division).numAdVerts===quote.adverts+1;
  if(!receipt.advertPurchased)return fail('Advertisement was not confirmed');
  return {...receipt,state:'purchased',reason:'Wilson upgraded before advertising'};
 }catch{
  try{receipt.wilsonPurchased=api.getUpgradeLevel('Wilson Analytics')===quote.level+1;receipt.advertPurchased=api.getDivision(quote.division).numAdVerts===quote.adverts+1;}catch{}
  return receipt.wilsonPurchased&&receipt.advertPurchased?{...receipt,state:'purchased',reason:'Native changes confirmed after an error'}:fail('Native purchase failed');
 }
}

/** Keep a paid Wilson upgrade from repeating while its advertisement is outstanding. */
export function refreshCorporationAdvertisingRecovery(previous,divisions){
 const active=new Map();if(!Array.isArray(previous)||!Array.isArray(divisions))return active;
 for(const row of previous.slice(0,20)){
  if(!Array.isArray(row)||typeof row[0]!=='string'||!Number.isSafeInteger(row[1]?.adverts)||row[1].adverts<0||!Number.isSafeInteger(row[1].level)||row[1].level<1)continue;
  const live=divisions.find(d=>d?.name===row[0]);
  if(live&&(!Number.isSafeInteger(live.numAdVerts)||live.numAdVerts<=row[1].adverts))active.set(row[0],{adverts:row[1].adverts,level:row[1].level});
 }
 return active;
}
