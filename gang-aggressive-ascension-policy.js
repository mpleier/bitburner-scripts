/** Bounded aggressive recovery pipeline; native mutation checks remain independent. */
export function aggressiveAscensionGate({enabled,gang,members,recoveries={},measurements,now=Date.now()}){
 if(!enabled)return {active:false,limit:null,reason:'Standard ascension policy'};
 if(Object.keys(members||{}).length!==12||gang?.territoryWarfareEngaged||gang?.territoryClashChance!==0)return {active:false,limit:null,reason:'Aggressive mode requires twelve members and no clash exposure'};
 const rows=Array.isArray(measurements?.completed)?measurements.completed.filter(r=>r.at<=now&&now-r.at<=900000&&r.state==='measured'&&Number.isFinite(r.statRatio)).slice(-3):[];
 if(rows.some(r=>r.statRatio<.9))return {active:false,limit:0,reason:'Measured recovery below ninety percent of forecast'};
 for(const [name,r]of Object.entries(recoveries))if(r.until<=now&&now-r.until<=30000&&r.expected&&members[name]){
  const keys=['hack','str','def','dex','agi','cha'],expected=keys.reduce((s,k)=>s+(r.expected[k]||0),0),actual=keys.reduce((s,k)=>s+(members[name][k]||0),0);
  if(expected>0&&actual<expected*.9)return {active:false,limit:0,reason:'Current recovery is behind forecast'};
 }
 const limit=rows.length?3:2,active=Object.values(recoveries).filter(r=>r.until>now).length;
 return {active:active<limit,limit,reason:active<limit?'Aggressive pipeline ready':'Recovery pipeline full'};
}
