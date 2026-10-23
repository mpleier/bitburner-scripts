/** Combine only already eligible quotes from one city's synchronous probes; no native API calls. */
export function scoreBladeburnerCityFallback(candidates,context,hyperdrive,weights,difficulty,growth,rankRate){
 if(!Array.isArray(candidates)||!context||typeof growth?.rank!=='function'||typeof rankRate!=='function')return null;
 const actions=[];
 for(const row of candidates){
  const m=row?.metrics,data=difficulty?.[row?.name],xp=weights?.[row?.name];
  if(!m||!data||!xp||!['Contracts','Operations'].includes(row.type)||!Number.isSafeInteger(m.level)||m.level<1||row.level!==m.level||!Number.isFinite(row.chance?.[0])||row.chance[0]<0||row.chance[0]>1)continue;
  const timing={};if(rankRate(row.chance,m,timing)===null)continue;
  const time=m.nativeTime??m.time;
  actions.push({name:row.name,level:m.level,time,difficulty:data.base*Math.pow(data.factor,m.level-1),chance:row.chance[0],weights:xp,duty:timing.duty*time/m.time,recovery:timing.regeneration,supply:context.growthSupply?(context.growthSupply[row.name]??null):undefined});
 }
 const result=growth.rank(actions,context,{hyperdrive}),best=result?.mission;
 if(!best?.fallback||!Number.isFinite(best.score)||best.score<=0)return null;
 const first=candidates.find(row=>row.name===best.name&&(best.level===undefined||row.level===best.level));if(!first)return null;
 return {score:best.score,action:best.name,level:first.level,fallback:best.fallback,fallbackPairs:result.fallbackPairs};
}
