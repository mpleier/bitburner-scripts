/** Validate the reset-scoped install hold published while a gang host is being qualified.
 *  A malformed, expired or foreign record must never block a legitimate augmentation install, and a
 *  hold is a delay rather than a veto: chasing a gang host for tens of hours cost 27 h without an install
 *  and starved the multiplier compounding that route progress depends on, so the window is capped at 45 min. */
export function gangQualificationHold(record,{now=Date.now(),ownerAlive=false,gang=true,nodeReset=null,augReset=null,maxAgeMs=30*60*1000,maxHoldMs=45*60*1000}={}) {
 if(gang||!ownerAlive||!record||record.schemaVersion!==2)return null;
 if(typeof record.host!=='string'||!record.host.trim()||record.host.length>64)return null;
 if(!Number.isFinite(record.at)||record.at>now||now-record.at>maxAgeMs)return null;
 if(record.nodeReset!==nodeReset||record.augReset!==augReset)return null;
 const since=Number(record.since);
 if(!Number.isFinite(since)||now-since>maxHoldMs)return null;
 return {host:record.host,at:record.at,since};
}
