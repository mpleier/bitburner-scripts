/** Piecewise wall-time quote: finite bonus pool, territory duty, external income once. */
export function gangFundingETA(gap,normal,bonus,external=0,bonusSeconds=0){
 if(![gap,normal,bonus,external,bonusSeconds].every(Number.isFinite)||Math.min(normal,bonus,external,bonusSeconds)<0)return Infinity;
 if(gap<=0)return 0;const fast=bonusSeconds/24,fastRate=bonus*25+external,earned=fast*fastRate;
 if(fastRate>0&&gap<=earned)return gap/fastRate;
 const rate=normal+external;return rate>0?fast+(gap-earned)/rate:Infinity;
}
/** Explicit reserve provenance must match the live amount, reset, owner and expiry. */
export function gangReserveOwnership(record,{amount,nodeReset,augReset,now,ownerRunning}){
 if(!record||record.amount!==amount||record.nodeReset!==nodeReset||record.augReset!==augReset||!ownerRunning||!Number.isFinite(record.at)||record.at>now||record.expiresAt<=now)return {purpose:amount>0?'unknown':'none',overlap:0};
 return {purpose:record.purpose,amount,goal:record.goal??null,overlap:0};
}
/** Import-free read-only diagnostic; reject stale previous-node or dead-owner records. */
export function readGangFunding(ns){
 let r;try{r=JSON.parse(ns.read('tasks/gang-funding.json'));}catch{return {state:'unavailable'};}
 const reset=ns.getResetInfo(),now=Date.now();
 if(r.nodeReset!==reset.lastNodeReset||r.augReset!==reset.lastAugReset||!Number.isFinite(r.at)||r.at>now||now-r.at>60000||!ns.isRunning(r.ownerPid))return {state:'stale',at:r.at};
 let pulses;try{pulses=JSON.parse(ns.read('tasks/gang-power-pulses.json'));}catch{}
 const powerPulses=pulses?.nodeReset===reset.lastNodeReset&&pulses.augReset===reset.lastAugReset&&now-pulses.at<=60000&&pulses.at<=now&&ns.isRunning(pulses.ownerPid)?{at:pulses.at,...pulses.summary}:null;
 return {state:'current',...r,powerPulses};
}
