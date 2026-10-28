/** A short growth detour must price rank sacrificed at the next rank gate. */
export function bladeburnerRankDetour(candidate,rankWork,{rankEtaMs,rankGap=null,statEtaMs=null,windowSeconds=30}={}){
 const no=reason=>({allowed:false,reason});
 if(!candidate||!rankWork||![candidate.score,rankWork.score,windowSeconds].every(Number.isFinite)||candidate.score<=0||rankWork.score<0||windowSeconds<=0||windowSeconds>30)return no('unknown-growth-value');
 if(candidate.name===rankWork.name&&candidate.level===rankWork.level)return {allowed:true,reason:'same-rank-work',rankDelayMs:0};
 const base=rankWork.rankRate,after=candidate.kind==='training'?0:candidate.rankRate;
 if(!Number.isFinite(base)||base<=0||!Number.isFinite(after)||after<0)return no('unknown-rank-cost');
 const rankRunwayMs=Number.isFinite(rankGap)&&rankGap>0?1000*rankGap/base:rankEtaMs;
 const rankDelayMs=Math.max(0,base-after)/base*windowSeconds*1000;
 if(!rankDelayMs)return {allowed:true,reason:'no-rank-sacrifice',rankDelayMs};
 if(!Number.isFinite(rankRunwayMs)||rankRunwayMs<=0)return no('unknown-rank-runway');
 if(Number.isFinite(statEtaMs)&&statEtaMs>=0&&rankWork.score>0){
  // Keep a local gain extrapolation bounded to this one short interval.
  const statAdvanceMs=Math.min(windowSeconds*1000,Math.max(0,candidate.score/rankWork.score-1)*windowSeconds*1000);
  const before=Math.max(rankRunwayMs,statEtaMs),afterEta=Math.max(rankRunwayMs+rankDelayMs,Math.max(0,statEtaMs-statAdvanceMs));
  return {allowed:before-afterEta>=1000,reason:'projected-black-op-readiness',rankDelayMs,statAdvanceMs,beforeEtaMs:before,afterEtaMs:afterEta};
 }
 // Without a reliable stat ETA, permit only a small bounded trade-off.
 return {allowed:after>=base*.95&&rankDelayMs<=Math.min(30000,rankRunwayMs*.05),reason:'bounded-rank-sacrifice',rankDelayMs};
}

/** Hysteresis prices partial repeat progress in the selected rank/growth units. */
export function bladeburnerSwitchWorthwhile({beforeScore,afterScore,timeMs,progressMs,switchSeconds=2,horizonSeconds=60,heldMs=0}={}){
 if(![beforeScore,afterScore,timeMs,progressMs,switchSeconds,horizonSeconds].every(Number.isFinite)||beforeScore<=0||afterScore<=0||timeMs<=0||progressMs<0||progressMs>timeMs||switchSeconds<0||horizonSeconds<=0)return true;
 const settled=Number.isFinite(heldMs)&&heldMs>=60000;
 const benefit=(afterScore-beforeScore)*(settled?Math.max(horizonSeconds,300):horizonSeconds);
 const cost=beforeScore*progressMs/1000+afterScore*switchSeconds;
 return afterScore>=beforeScore*(settled?1.01:1.1)&&benefit>cost;
}
