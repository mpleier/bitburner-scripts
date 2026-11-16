export const cacheContextFile='tasks/dnet-cache-context.json';
export function cacheRewardReset(text,now=Date.now()){const r=JSON.parse(text);if(!r||![r.nodeReset,r.augReset].every(Number.isFinite)||r.nodeReset<0||r.augReset<r.nodeReset||r.augReset>now)throw Error('Missing current cache context');return {lastNodeReset:r.nodeReset,lastAugReset:r.augReset};}
export const cacheRewardFile=host=>'tasks/dnet-cache-rewards-'+encodeURIComponent(host)+'.json';
export const rewardSummaryFile='tasks/dnet-cache-rewards-summary.json';
export const noncashRewardKeys=['shares','programs','stockAccess','dataFiles','contracts','augmentations','unknown'];
const keys=['money','shares','programs','stockAccess','dataFiles','contracts','augmentations','karma','unknown'];
const empty=()=>Object.fromEntries(keys.map(k=>[k,0]));
/** Native numeric amounts and counts only. No formatted-message parsing or dollar conversion. */
export function recordDarknetCache(previous,result,{host,pid,at,reset,modelId=null}){
 if(result?.success!==true)return previous;
 const same=previous?.host===host&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&typeof previous.epoch==='string'&&previous.at<=at;
 const totals=empty();for(const k of keys)if(same&&Number.isFinite(previous.totals?.[k])&&previous.totals[k]>=0)totals[k]=previous.totals[k];
 // Reward shapes keep only field names, so an "unknown" bucket can be explained without guessing.
 const shape=Object.keys(result||{}).filter(k=>k!=='message').sort().slice(0,16).join(',')||'(no fields)';
 const shapes=same&&previous.shapes&&typeof previous.shapes==='object'&&!Array.isArray(previous.shapes)?{...previous.shapes}:{};
 shapes[shape]=Math.min(1000000,(shapes[shape]||0)+1);
 if(Object.keys(shapes).length>16){for(const k of Object.keys(shapes).sort((a,b)=>shapes[a]-shapes[b]).slice(0,Object.keys(shapes).length-16))delete shapes[k];}
 const count=Array.isArray(result.contractFilePaths)?result.contractFilePaths.length:0,data=Array.isArray(result.dataFilePaths)?result.dataFilePaths.length:0;
 const delta={...empty(),money:Number.isFinite(result.money)&&result.money>0?result.money:0,shares:Number.isFinite(result.stockShares)&&result.stockShares>0?result.stockShares:0,
  programs:typeof result.programName==='string'&&result.programName?1:0,stockAccess:['wseAccount','tixApiAccess','fourSigmaData'].filter(k=>result[k]===true).length,
  dataFiles:data,contracts:count,augmentations:typeof result.augmentationName==='string'&&result.augmentationName?1:0,karma:Number.isFinite(result.karmaLoss)?Math.abs(result.karmaLoss):0};
 // A native $0 cash award is known, even when karma is its only nonzero field.
 if(!keys.filter(k=>k!=='karma'&&k!=='unknown').some(k=>delta[k]>0)&&!(Number.isFinite(result.money)&&result.money>=0))delta.unknown=1;
 for(const k of keys)totals[k]+=delta[k];
 return {schemaVersion:1,host,modelId:typeof modelId==='string'?modelId:previous?.modelId??null,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,epoch:same?previous.epoch:`${at}:${pid}`,at,opened:(same&&Number.isSafeInteger(previous.opened)?previous.opened:0)+1,totals,shapes};
}
/** Single home owner merges cumulative reports; duplicate surveys contribute zero. */
export function mergeDarknetRewards(previous,reports,reset,now=Date.now()){
 const same=previous?.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset;
 const seen=same&&previous.seen&&typeof previous.seen==='object'&&!Array.isArray(previous.seen)?{...previous.seen}:{};
 const totals=empty();for(const k of keys)if(same&&Number.isFinite(previous.totals?.[k])&&previous.totals[k]>=0)totals[k]=previous.totals[k];
 const lastNoncashAt=Object.fromEntries(noncashRewardKeys.map(k=>[k,same&&Number.isFinite(previous.lastNoncashAt?.[k])&&previous.lastNoncashAt[k]>=0&&previous.lastNoncashAt[k]<=now?previous.lastNoncashAt[k]:same&&previous.totals?.[k]>0&&Number.isFinite(previous.at)&&previous.at<=now?previous.at:0]));
 const accepted=new Map();
 let omitted=0;
 for(const report of reports){const r=report.cacheRewards;
  if(!r||r.host!==report.host||r.nodeReset!==reset.lastNodeReset||r.augReset!==reset.lastAugReset||typeof r.epoch!=='string'||!Number.isFinite(r.at)||r.at>now||r.at<reset.lastAugReset||!keys.every(k=>Number.isFinite(r.totals?.[k])&&r.totals[k]>=0))continue;
  const key=JSON.stringify([r.host,r.epoch]),prior=seen[key];
  if(!prior&&Object.keys(seen).length>=512){omitted++;continue;}
  if(prior&&keys.some(k=>r.totals[k]<prior[k]))continue;
  for(const k of keys){const delta=Math.max(0,r.totals[k]-(prior?.[k]||0));totals[k]+=delta;if(delta>0&&noncashRewardKeys.includes(k))lastNoncashAt[k]=Math.max(lastNoncashAt[k],r.at);}
  seen[key]={...r.totals};accepted.set(r.host,r);
 }
 // A collector timestamp alone does not prove it pulled each recent cache receipt.
 const live=reports.filter(r=>r.live===true),pending=live.filter(r=>!Number.isFinite(r.at)||r.at>now||now-r.at>90000||!Number.isFinite(r.lastCacheAt)||r.lastCacheAt<0||r.lastCacheAt>now||
  r.lastCacheAt>now-360000&&r.lastCacheAt>0&&(!accepted.has(r.host)||accepted.get(r.host).at<r.lastCacheAt));
 const coverage={complete:live.length>0&&pending.length===0&&omitted===0,liveHosts:live.length,pendingHosts:pending.length};
 // Field-name shapes from the accepted receipts explain an all-zero bucket without a raw dump.
 // Shapes are cumulative like totals: a pruned per-host receipt must not erase the explanation for an
 // unknown reward the totals already counted, or the bucket grows while its shapes stay behind.
 const shapes=same&&previous.shapes&&typeof previous.shapes==='object'&&!Array.isArray(previous.shapes)
  ? Object.fromEntries(Object.entries(previous.shapes).filter(([k,v])=>typeof k==='string'&&k.length>0&&Number.isFinite(v)&&v>0).map(([k,v])=>[k,Math.min(1000000,v)]))
  : {}; for(const r of accepted.values())if(r.shapes&&typeof r.shapes==='object'&&!Array.isArray(r.shapes))for(const [k,v] of Object.entries(r.shapes))if(typeof k==='string'&&k.length>0&&k.length<=200&&Number.isFinite(v)&&v>0)shapes[k]=Math.min(1000000,(shapes[k]||0)+v);
 const topShapes=Object.fromEntries(Object.entries(shapes).sort((a,b)=>b[1]-a[1]).slice(0,6));
 return {schemaVersion:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,totals,seen,omitted,lastNoncashAt,coverage,shapes:topShapes};
}

/** Presence and typed counts establish activity, never an invented dollar price.
 * Legacy or incomplete summaries are unknown until the collector renews them. */
export function darknetRewardProductivity(summary,reset,now=Date.now()) {
 const valid=summary?.schemaVersion===1&&summary.nodeReset===reset.lastNodeReset&&summary.augReset===reset.lastAugReset&&Number.isFinite(summary.at)&&summary.at<=now&&now-summary.at<=90000&&
  summary.coverage?.complete===true&&Number.isSafeInteger(summary.coverage.liveHosts)&&summary.coverage.liveHosts>0&&summary.coverage.pendingHosts===0&&summary.omitted===0&&
  keys.every(k=>Number.isFinite(summary.totals?.[k])&&summary.totals[k]>=0)&&noncashRewardKeys.every(k=>Number.isFinite(summary.lastNoncashAt?.[k])&&summary.lastNoncashAt[k]>=0&&summary.lastNoncashAt[k]<=summary.at);
 if(!valid)return {known:false,productive:false,reason:'Waiting for complete native cache reward reports'};
 const kinds=noncashRewardKeys.filter(k=>summary.lastNoncashAt[k]>0&&summary.lastNoncashAt[k]>now-360000);
 return {known:true,productive:kinds.length>0,kinds,reason:kinds.length?'Recent noncash Dark Net rewards: '+kinds.join(', '):'No recent noncash Dark Net rewards'};
}
