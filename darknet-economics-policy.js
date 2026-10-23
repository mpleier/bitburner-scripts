/** Observe native Dark Net income across a six-minute window (two native cache cooldowns).
 * Productive networks are retained unless three comparable completed refreshes justify replacement.
 * Measured reward recovery replaces the fallback five-minute deployment allowance plus the storm. */
export function darknetEconomics(previous, totalIncome, lastCacheAt, reset, now = Date.now(), evidence = {}) {
  const valid = Number.isFinite(totalIncome) && totalIncome >= 0;
  const same = previous?.reset === reset && previous?.at <= now && now - previous.at <= 90000;
  let samples = same && Array.isArray(previous.samples) ? previous.samples.filter(s => Number.isFinite(s.at) && s.at <= now && Number.isFinite(s.income)) : [];
  if (!valid) return {reset,at:now,samples:[],allow:false,reason:'Waiting for native Dark Net income evidence'};
  if (samples.length && totalIncome < samples.at(-1).income) samples=[];
  samples.push({at:now,income:totalIncome});
  while (samples.length > 1 && samples[1].at <= now-360000) samples.shift();
  samples=samples.slice(-32);
  const span=now-samples[0].at, rate=span>0?Math.max(0,totalIncome-samples[0].income)/(span/1000):0;
  const cacheRecent=Number.isFinite(lastCacheAt)&&lastCacheAt>now-360000;
  const measured=evidence.ready===true&&evidence.samples===3&&[evidence.rebuildMs,evidence.netRate].every(Number.isFinite)&&evidence.rebuildMs>=30000&&evidence.rebuildMs<=2250000&&evidence.netRate>0;
  const rebuildMs=evidence.measuredRebuild===true&&Number.isFinite(evidence.rebuildMs)&&evidence.rebuildMs>=30000&&evidence.rebuildMs<=2250000?evidence.rebuildMs:330000;
  const horizonSeconds=1800,rebuildSeconds=rebuildMs/1000;
  const projectedAdvantage=measured?(evidence.netRate-rate)*Math.max(0,horizonSeconds-rebuildSeconds)-rate*rebuildSeconds:0;
  const allowLowIncome=rate>0&&measured&&rebuildSeconds<horizonSeconds&&evidence.netRate>=rate*2&&projectedAdvantage>rate*60;
  const allow=span>=360000&&(rate===0||allowLowIncome)&&!cacheRecent;
  return {reset,at:now,samples,allow,moneyPerSecond:rate,estimatedRebuildMs:rebuildMs,allowLowIncome:allow&&allowLowIncome,projectedAdvantage,refreshEvidence:evidence,
    estimatedLostIncome:rate*rebuildMs/1000,reason:span<360000?'Measuring six minutes of Dark Net rewards':cacheRecent?'Recent cache rewards; keep productive network':allow&&allowLowIncome?'Three measured refresh windows justify replacing low income':rate>0?'Dark Net income is still productive':'No income or cache rewards for six minutes'};
}
