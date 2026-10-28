/** Recurring income excludes jackpots, stock liquidation, sales and gifts. */
export function recurringPlayerIncome(sources) {
  if (!sources || typeof sources !== 'object') return null;
  let total = 0;
  for (const key of ['bladeburner','codingcontract','corporation','crime','gang','hacking','hacknet','infiltration','sleeves','work','darknet']) {
    const value = sources[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

/** Keep a six-minute rolling quote. Ready empty networks qualify sooner; bounded
 * low-income trials bootstrap evidence without inventing a return forecast. */
export function darknetEconomics(previous, totalIncome, lastCacheAt, reset, now = Date.now(), evidence = {}, context = {}) {
  const valid = Number.isFinite(totalIncome) && totalIncome >= 0;
  const same = previous?.reset === reset && previous.augReset === context.augReset && previous?.at <= now && now - previous.at <= 90000;
  const playerValid = Number.isFinite(context.playerIncome) && context.playerIncome >= 0;
  let samples = same && Array.isArray(previous.samples) ? previous.samples.filter(s => Number.isFinite(s.at) && s.at <= now && Number.isFinite(s.income) && s.income >= 0) : [];
  if (!valid || !Number.isFinite(lastCacheAt) || lastCacheAt < 0 || lastCacheAt > now)
    return {reset,augReset:context.augReset,at:now,samples:[],allow:false,reason:'Waiting for native Dark Net income evidence'};
  if (samples.length && (totalIncome < samples.at(-1).income || playerValid && Number.isFinite(samples.at(-1).playerIncome) && context.playerIncome < samples.at(-1).playerIncome)) samples=[];
  // Coalesce rapid polls without discarding the oldest baseline.
  const current = {at:now,income:totalIncome,playerIncome:playerValid?context.playerIncome:null};
  if (samples.length > 1 && Math.floor(now/15000) === Math.floor(samples.at(-1).at/15000)) samples[samples.length-1]=current;
  else samples.push(current);
  while (samples.length > 1 && samples[1].at <= now-360000) samples.shift();
  samples=samples.slice(-32);
  const span=now-samples[0].at, rate=span>0?Math.max(0,totalIncome-samples[0].income)/(span/1000):0;
  const playerRate=playerValid && span>0 && samples.every(s=>Number.isFinite(s.playerIncome)) ? Math.max(0,context.playerIncome-samples[0].playerIncome)/(span/1000) : null;
  const cacheRecent=lastCacheAt>now-360000;
  const measured=evidence.ready===true&&evidence.samples===3&&[evidence.rebuildMs,evidence.netRate].every(Number.isFinite)&&evidence.rebuildMs>=30000&&evidence.rebuildMs<=2250000&&evidence.netRate>0;
  const rebuildMs=evidence.measuredRebuild===true&&Number.isFinite(evidence.rebuildMs)&&evidence.rebuildMs>=30000&&evidence.rebuildMs<=2250000?evidence.rebuildMs:330000;
  const horizonSeconds=1800,rebuildSeconds=rebuildMs/1000;
  const projectedAdvantage=measured?(evidence.netRate-rate)*Math.max(0,horizonSeconds-rebuildSeconds)-rate*rebuildSeconds:0;
  const ready=context.ready===true&&['cleared','stalled'].includes(context.mode);
  const negligible=ready&&playerRate>0&&rate>0&&rate<=playerRate*.01&&rate*rebuildSeconds<=playerRate*30;
  const trial=negligible&&rebuildSeconds<horizonSeconds&&span>=180000&&evidence.suspended!==true;
  const proven=measured&&evidence.suspended!==true&&rebuildSeconds<horizonSeconds&&evidence.netRate>=rate*2&&projectedAdvantage>rate*60;
  const allowLowIncome=rate>0&&(trial||span>=360000&&proven);
  const requiredMs=ready?(context.mode==='stalled'?180000:30000):360000;
  const rewards=context.rewardStatus;
  const rewardKnown=rewards===undefined||rewards?.known===true;
  const rewardProductive=rewards?.productive===true;
  const allow=rewardKnown&&!rewardProductive&&span>=requiredMs&&(rate===0||allowLowIncome)&&(!cacheRecent||trial);
  const reason=!rewardKnown?'Waiting for complete native cache reward reports':rewardProductive?rewards.reason||'Recent noncash Dark Net rewards':span<requiredMs?'Measuring Dark Net rewards':cacheRecent&&!trial?'Recent cache rewards; keep productive network':allow&&trial?'Bounded low-income trial refresh; rebuilding loss below thirty seconds of player income':allow&&allowLowIncome?'Three measured refresh windows justify replacing low income':rate>0&&evidence.suspended?'Low-income refresh suspended after repeated optimistic forecasts':rate>0?'Dark Net income is still productive':allow?'No income or recent cache rewards; refresh idle network':'Measuring Dark Net rewards';
  return {reset,augReset:context.augReset,at:now,samples,allow,moneyPerSecond:rate,playerMoneyPerSecond:playerRate,estimatedRebuildMs:rebuildMs,allowLowIncome:allow&&allowLowIncome,trial:allow&&trial,rewardStatus:rewards,projectedAdvantage,refreshEvidence:evidence,
    estimatedLostIncome:rate*rebuildSeconds,reason};
}
