/** Observe native Dark Net income across a six-minute window (two native cache cooldowns).
 * This intentionally keeps productive networks: future replacement rewards are unknown.
 * Rebuild loss uses a conservative five-minute deployment allowance plus the 30-second storm. */
export function darknetEconomics(previous, totalIncome, lastCacheAt, reset, now = Date.now()) {
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
  const allow=span>=360000&&rate===0&&!cacheRecent;
  return {reset,at:now,samples,allow,moneyPerSecond:rate,estimatedRebuildMs:330000,
    estimatedLostIncome:rate*330,reason:span<360000?'Measuring six minutes of Dark Net rewards':cacheRecent?'Recent cache rewards; keep productive network':rate>0?'Dark Net income is still productive':'No income or cache rewards for six minutes'};
}
