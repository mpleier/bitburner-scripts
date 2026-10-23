/** Ignore money and raw XP changes; detect manual skills, completed grafts, entropy and ownership changes. */
export function bladeburnerCapabilityKey(snapshot,reset,now=Date.now()) {
 if(snapshot?.complete!==true||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>=15000||
  ![snapshot.nodeReset,snapshot.augReset].every(v=>Number.isFinite(v)&&v>=0)||snapshot.nodeReset!==reset?.lastNodeReset||snapshot.augReset!==reset?.lastAugReset||
  !Number.isFinite(snapshot.entropy)||snapshot.entropy<0)return null;
 const pairs=(value,maximum,valid)=>{
  if(!Array.isArray(value)||value.length>maximum||value.some(p=>!Array.isArray(p)||p.length!==2||typeof p[0]!=='string'||!p[0]||!valid(p[1]))||new Set(value.map(p=>p[0])).size!==value.length)return null;
  return value.map(p=>[...p]).sort(([a],[b])=>a<b?-1:a>b?1:0);
 };
 const skills=pairs(snapshot.skills,128,v=>Number.isSafeInteger(v)&&v>=0);
 const owned=pairs(snapshot.owned,512,v=>Number.isSafeInteger(v)&&v>0);
 const multipliers=pairs(snapshot.multipliers,32,v=>Number.isFinite(v)&&v>=0);
 const required=[...['hacking','strength','defense','dexterity','agility','charisma'].flatMap(k=>[k,k+'_exp']),'bladeburner_success_chance','bladeburner_max_stamina','bladeburner_stamina_gain','bladeburner_analysis'];
 if(!skills?.length||!owned||!multipliers||required.length!==multipliers.length||required.some(k=>!multipliers.some(([name])=>name===k)))return null;
 return JSON.stringify([snapshot.nodeReset,snapshot.augReset,snapshot.entropy,skills,multipliers,owned]);
}

/** Stable maintenance inputs: whole stock, sleeve assignments/readiness and relative bonus speed. */
export function bladeburnerCityMaintenanceKey(snapshot) {
 if(snapshot?.complete!==true||typeof snapshot.accelerated!=='boolean')return null;
 const names=['Tracking','Investigation','Undercover Operation','Stealth Retirement Operation'];
 const stock=snapshot.stock;
 if(!Array.isArray(stock)||stock.length!==names.length||new Set(stock.map(p=>p?.[0])).size!==names.length||stock.some(p=>!Array.isArray(p)||p.length!==2||!names.includes(p[0])||!Number.isSafeInteger(p[1])||p[1]<0))return null;
 const sleeves=snapshot.sleeves;
 if(sleeves!==null){
  if(!Number.isInteger(sleeves?.count)||sleeves.count<0||sleeves.count>8||!Array.isArray(sleeves.entries)||sleeves.entries.length>sleeves.count)return null;
  const ids=new Set();
  for(const entry of sleeves.entries){
   if(!Array.isArray(entry)||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=sleeves.count||ids.has(entry[0]))return null;
   ids.add(entry[0]);
   if(entry[1]==='support'&&entry.length===2)continue;
   if(entry[1]!=='diplomacy'||entry.length!==6||!entry.slice(2).every(Number.isFinite)||entry[2]<0||entry[2]>100||entry[3]<0||entry[3]>100||entry[4]<0||entry[5]<=0)return null;
  }
 }
 const sorted=stock.map(p=>[...p]).sort(([a],[b])=>a<b?-1:1);
 return JSON.stringify([snapshot.accelerated,sorted,sleeves===null?null:[sleeves.count,[...sleeves.entries].sort((a,b)=>a[0]-b[0])]]);
}

/** Copy only eligible cities into a probe anchor; unknown inputs cannot authorize cache reuse. */
export function captureBladeburnerCityEnvironment(cities,population,chaos) {
 if(!Array.isArray(cities)||!cities.length||cities.length>6||new Set(cities).size!==cities.length||cities.some(c=>typeof c!=='string'||!c))return null;
 if(cities.some(c=>!Number.isFinite(population?.[c])||population[c]<0||!Number.isFinite(chaos?.[c])||chaos[c]<0))return null;
 return cities.map(c=>[c,population[c],chaos[c]]).sort(([a],[b])=>a<b?-1:a>b?1:0);
}

/** Compare with the last successful probe, not the last sample, so slow drift accumulates. */
export function bladeburnerCityEnvironmentChanged(previous,current) {
 const valid=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=6&&new Set(rows.map(r=>r?.[0])).size===rows.length&&rows.every(r=>Array.isArray(r)&&r.length===3&&typeof r[0]==='string'&&r[0]&&Number.isFinite(r[1])&&r[1]>=0&&Number.isFinite(r[2])&&r[2]>=0);
 if(!valid(previous)||!valid(current)||previous.length!==current.length)return true;
 const byCity=new Map(previous.map(([city,population,chaos])=>[city,[population,chaos]]));
 return current.some(([city,population,chaos])=>{
  const anchor=byCity.get(city);
  return !anchor||(anchor[0]===0?population!==0:Math.abs(population-anchor[0])>=anchor[0]*.01)||Math.abs(chaos-anchor[1])>=1;
 });
}

/** Copy the native player levels used by combat, action timing and maintenance estimates. */
export function captureBladeburnerStatAnchor(stats) {
 const names=['hacking','strength','defense','dexterity','agility','charisma','intelligence'];
 if(names.some(name=>!Number.isFinite(stats?.[name])||stats[name]<0))return null;
 return names.map(name=>stats[name]);
}

/** Integer level growth accumulates against the last completed city probe; raw XP is excluded. */
export function bladeburnerStatsChanged(previous,current) {
 const valid=values=>Array.isArray(values)&&values.length===7&&values.every(value=>Number.isFinite(value)&&value>=0);
 if(!valid(previous)||!valid(current))return true;
 return current.some((value,i)=>previous[i]===0?value!==0:Math.abs(value-previous[i])>=previous[i]*.01);
}

/** Team recruitment, casualties and per-operation assignments affect city planning inputs. */
export function bladeburnerSquadKey(snapshot) {
 if(snapshot?.complete!==true||!Number.isSafeInteger(snapshot.total)||snapshot.total<0)return null;
 const pair=p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='string'&&p[0]&&Number.isSafeInteger(p[1])&&p[1]>=0;
 const operations=snapshot.operations;
 if(!Array.isArray(operations)||!operations.length||operations.length>64||!operations.every(pair)||new Set(operations.map(p=>p[0])).size!==operations.length||snapshot.blackOp!==null&&!pair(snapshot.blackOp))return null;
 const sorted=operations.map(p=>[...p]).sort(([a],[b])=>a<b?-1:a>b?1:0);
 // Native per-action assignments may outlive team losses; do not assume they sum to the current total.
 return JSON.stringify([snapshot.total,sorted,snapshot.blackOp]);
}
