/** Self-contained infrastructure worker, with fresh native prices and actual spending receipts. */
export function achievementInfrastructure(ns,missing,allowed,claim) {
 const wants=id=>missing.includes(id),result=[];
 const buy=(category,cost,fn)=>Number.isFinite(cost)&&cost>0&&claim(ns,category,cost)&&fn();
 if(allowed('homeRam')&&wants('MAX_RAM')){const cost=ns.singularity.getUpgradeHomeRamCost();if(buy('home',cost,()=>ns.singularity.upgradeHomeRam()))result.push('home RAM');}
 if(allowed('homeCores')&&wants('MAX_CORES')){const cost=ns.singularity.getUpgradeHomeCoresCost();if(buy('home',cost,()=>ns.singularity.upgradeHomeCores()))result.push('home cores');}
 if(allowed('hacknetExpense')) {
  let count;try{count=ns.hacknet.numNodes();}catch{return result;}
  const servers=count>0&&'hashCapacity' in ns.hacknet.getNodeStats(0),limit=ns.hacknet.maxNumNodes();
  const target=servers?limit:30;
  if((wants('ALL_HACKNET_SERVER')||wants('30_HACKNET_NODE')||wants('FIRST_HACKNET_NODE'))&&count<target){if(buy('hacknet',ns.hacknet.getPurchaseNodeCost(),()=>ns.hacknet.purchaseNode()>=0))result.push('Hacknet node');}
  if(count&& (wants('MAX_HACKNET_SERVER')||wants('MAX_HACKNET_NODE'))) {
   const i=0,candidates=[['level',()=>ns.hacknet.getLevelUpgradeCost(i,1),()=>ns.hacknet.upgradeLevel(i,1)],
    ['RAM',()=>ns.hacknet.getRamUpgradeCost(i,1),()=>ns.hacknet.upgradeRam(i,1)],['cores',()=>ns.hacknet.getCoreUpgradeCost(i,1),()=>ns.hacknet.upgradeCore(i,1)]];
   if(servers)candidates.push(['cache',()=>ns.hacknet.getCacheUpgradeCost(i,1),()=>ns.hacknet.upgradeCache(i,1)]);
   const ranked=candidates.map(([name,cost,fn])=>({name,cost:cost(),fn})).filter(c=>Number.isFinite(c.cost)&&c.cost>0).sort((a,b)=>a.cost-b.cost);
   for(const c of ranked)if(buy('hacknet',c.cost,c.fn)){result.push('Hacknet '+c.name);break;}
  }
 }
 return result;
}
export function achievementRunSnapshot(ns) {
 const home=ns.getServer('home'),reset=ns.getResetInfo();
 const s={ram:home.maxRam,cores:home.cpuCores,stanek:reset.ownedAugs?.has?.("Stanek's Gift - Genesis")??Object.hasOwn(reset.ownedAugs||{},"Stanek's Gift - Genesis")};
 try{s.gang=ns.gang.inGang();}catch{s.gang=false;}try{s.corporation=ns.corporation.hasCorporation();}catch{s.corporation=false;}
 try{s.bladeburner=ns.bladeburner.inBladeburner();}catch{s.bladeburner=false;}
 try{s.fourSigma=ns.stock.has4SData()||ns.stock.has4SDataTixApi();}catch{s.fourSigma=false;}
 try{const money=ns.getMoneySources().sinceStart;s.hacknetIncome=money.hacknet||0;s.hacknetExpenses=money.hacknet_expenses||0;}catch{}
 try{s.sleevesUnused=Array.from({length:ns.sleeve.getNumSleeves()},(_,i)=>({s:ns.sleeve.getSleeve(i),augs:ns.sleeve.getSleeveAugmentations(i)})).every(({s,augs})=>augs.length===0&&["hacking","strength","defense","dexterity","agility","charisma"].every(k=>s.exp?.[k]===0));}catch{s.sleevesUnused=false;}
 return s;
}
export function milestoneFocus(ns,goals) {
 const w=ns.singularity.getCurrentWork(),p=ns.getPlayer();
 if(w?.type==='GRAFTING'||w?.type==='CREATE_PROGRAM')return 'protected-work';
 if(goals.combat) {
  const stat=['strength','defense','dexterity','agility'].filter(s=>p.skills[s]<3000).sort((a,b)=>p.skills[a]-p.skills[b])[0];
  if(stat){if(p.city!=='Sector-12'&&!ns.singularity.travelToCity('Sector-12'))return 'travel-unaffordable';
   if(w?.type!=='CLASS'||!String(w.classType).toLowerCase().includes(stat.slice(0,3)))ns.singularity.gymWorkout('Powerhouse Gym',stat.slice(0,3),false);
   return 'training '+stat;}
 }
 if(goals.karma&&ns.heart.break()>-1e6){if(w?.type!=='CRIME'||w.crimeType!=='Homicide')ns.singularity.commitCrime('Homicide',false);return 'karma';}
 if(goals.reputation){const names=p.factions.filter(f=>!['Shadows of Anarchy','Bladeburners','Church of the Machine God'].includes(f));
  const target=names.map(name=>({name,rep:ns.singularity.getFactionRep(name),types:ns.singularity.getFactionWorkTypes(name)})).filter(f=>f.types.length).sort((a,b)=>b.rep-a.rep)[0];
  if(target&&target.rep<1e7){if(w?.type!=='FACTION'||w.factionName!==target.name)ns.singularity.workForFaction(target.name,target.types.includes('hacking')?'hacking':target.types[0],false);return 'reputation '+target.name;}}
 if(goals.intelligence){if(p.city!=='Volhaven'&&!ns.singularity.travelToCity('Volhaven'))return 'travel-unaffordable';
  if(w?.type!=='CLASS'||w.location!=='ZB Institute of Technology')ns.singularity.universityCourse('ZB Institute of Technology','Leadership',false);return 'intelligence study';}
 return 'idle';
}


export function debtMilestone(ns) {
 const p=ns.getPlayer(),w=ns.singularity.getCurrentWork();if(['GRAFTING','CREATE_PROGRAM'].includes(w?.type))return 'protected-work';
 if(p.city!=='Volhaven'&&!ns.singularity.travelToCity('Volhaven'))return 'waiting-for-travel';
 if(w?.type!=='CLASS'||w.location!=='ZB Institute of Technology')if(!ns.singularity.universityCourse('ZB Institute of Technology','Leadership',false))return 'waiting-for-course';
 // Long positions preserve recoverable assets; covering short positions could incur unintended losses.
 if(p.money>500000)for(const symbol of ns.stock.getSymbols()){
  const price=ns.stock.getAskPrice(symbol),position=ns.stock.getPosition(symbol);
  const shares=Math.max(0,Math.min(ns.stock.getMaxShares(symbol)-position[0],Math.floor((ns.getPlayer().money-300000)/price)));
  if(shares>0)ns.stock.buyStock(symbol,shares);
 }
 return ns.getPlayer().money<=-1e9?'native-debt-threshold':'studying-toward-debt';
}
export function recoverDebt(ns) {
 const w=ns.singularity.getCurrentWork();if(w?.type==='CLASS'&&w.location==='ZB Institute of Technology')ns.singularity.stopAction();
 for(const symbol of ns.stock.getSymbols()){const p=ns.stock.getPosition(symbol);if(p[0]>0)ns.stock.sellStock(symbol,p[0]);}
 return ns.getPlayer().money;
}


export function achievementCashBank(ns) {
 for(const symbol of ns.stock.getSymbols()){const position=ns.stock.getPosition(symbol);if(position[0]>0)ns.stock.sellStock(symbol,position[0]);}
 return ns.getPlayer().money;
}
