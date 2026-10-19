/** Measured reset-to-casino-completion evidence; no game actions or assumed recurring profit. */
export function observeCasinoReset(saved,status,reset,now=Date.now()) {
 const valid=s=>s&&Number.isFinite(s.augReset)&&s.augReset>=reset.lastNodeReset&&s.augReset<=reset.lastAugReset&&
  Number.isFinite(s.at)&&s.at>=s.augReset&&s.at<=now&&Number.isFinite(s.earnings)&&s.earnings>=1e10&&
  s.at-s.augReset>0&&s.at-s.augReset<=4*60*60000;
 const samples=saved?.nodeReset===reset.lastNodeReset&&Array.isArray(saved.samples)?saved.samples.filter(valid):[];
 if(status?.mode==='complete'&&valid(status)&&!samples.some(s=>s.augReset===status.augReset))
  samples.push({augReset:status.augReset,at:status.at,earnings:status.earnings});
 return {schemaVersion:1,nodeReset:reset.lastNodeReset,at:now,samples:samples.sort((a,b)=>b.at-a.at).slice(0,3)};
}

export function forecastCasinoReset(evidence,{reset,now=Date.now(),enabled=true,paused=false,allowed=true,seedFundable=false,homeRam=0,casinoRam=0,status=null,incomePerSecond=0}={}) {
 const unavailable=reason=>({at:now,augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,available:false,reason});
 if(!enabled||paused||!allowed)return unavailable('Casino automation disabled, paused, or restricted');
 if(!seedFundable)return unavailable('Post-install casino seed funding is not established');
 if(!(casinoRam>0)||!Number.isFinite(casinoRam)||homeRam<casinoRam)return unavailable('Casino worker cannot fit');
 if(incomePerSecond>=5e9/60)return unavailable('Recurring income already exceeds the automatic casino threshold');
 if(status?.augReset===reset.lastAugReset&&Number.isFinite(status.at)&&status.at>=reset.lastAugReset&&status.at<=now&&['failed','paused','starting','playing','reloading'].includes(status.mode))return unavailable('Latest casino run is not a verified completion');
 const samples=observeCasinoReset(evidence,null,reset,now).samples;
 if(!samples.length)return unavailable('No successful casino timing evidence from this BitNode');
 // Include the entire measured time since reset (seed, travel, retries and play), plus 25% margin.
 const durationMs=Math.max(60000,...samples.map(s=>s.at-s.augReset))*1.25;
 const amount=Math.max(0,Math.min(1e10,...samples.map(s=>s.earnings))-300000);
 return {at:now,augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,available:true,amount,durationMs,samples:samples.length,reason:'Measured same-node casino payout, less seed/travel buffer; elapsed time includes a 25% margin'};
}
