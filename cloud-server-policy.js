/** Fresh wallet limits; the shared allowance is claimed separately at the purchase boundary. */
export function cloudCashBudget(money,budget,reserve,percent) {
 if(!Number.isFinite(money)||money<0||!(Number.isFinite(budget)||budget===Infinity)||budget<0||
  !Number.isFinite(reserve)||reserve<0||!Number.isFinite(percent)||percent<0||percent>1)return 0;
 return Math.max(0,Math.min(budget,money-reserve,money*(1-percent)));
}

/** Compare useful added capacity, not the replacement size of an upgraded server. */
export function cloudCandidates(quotes,{budget,minRam,maxRam,homeRam,totalRam,homeThreshold,networkThreshold,bestRam=0,allowWorse=false}) {
 return quotes.filter(q=>Number.isFinite(q.ram)&&q.ram>=minRam&&q.ram<=maxRam&&
  Number.isFinite(q.oldRam)&&q.oldRam>=0&&q.ram>q.oldRam&&
  Number.isFinite(q.cost)&&q.cost>0&&q.cost<=budget&&
  (q.oldRam>0||allowWorse||q.ram>=bestRam)&&
  (q.ram===maxRam||(q.ram>=homeRam*homeThreshold&&q.ram-q.oldRam>=totalRam*networkThreshold)))
  .sort((a,b)=>b.ram-a.ram||a.cost-b.cost);
}

/** Reserved free home RAM cannot host more hacking work. Unused Hacknet stays dedicated to hashes. */
export function cloudDemand(servers,trigger,homeReserve=0) {
 if(!Number.isFinite(trigger)||trigger<0||trigger>1)return {needed:false,utilization:0,totalRam:0};
 const usingHacknet=servers.some(s=>s.hacknet&&s.used>0);
 let totalRam=0,usedRam=0;
 for(const s of servers){
  if(s.hacknet&&!usingHacknet)continue;
  if(!Number.isFinite(s.ram)||s.ram<0||!Number.isFinite(s.used)||s.used<0||s.used>s.ram)continue;
  totalRam+=s.ram-(s.name==='home'?Math.min(Math.max(0,homeReserve),s.ram-s.used):0);
  usedRam+=s.used;
 }
 const utilization=totalRam>0?usedRam/totalRam:0;
 return {needed:trigger===0||totalRam>0&&utilization>=trigger,utilization,totalRam,usedRam};
}

export function normalizeCloudOptions(config) {
 const options={...config};
 const ranges={'interval':[1,Infinity],'min-ram-exponent':[0,30],'reserve-percent':[0,1],
  'reserve-by-time-decay-factor':[0,1],'utilization-trigger':[0,1],
  'compare-to-home-threshold':[0,Infinity],'compare-to-network-ram-threshold':[0,1]};
 for(const [key,[min,max]]of Object.entries(ranges)){
  const n=Number(options[key]);if(!Number.isFinite(n)||n<min||n>max)return null;options[key]=n;
 }
 if(!Number.isInteger(options['min-ram-exponent']))return null;
 options.budget=Number(options.budget);
 if(!(Number.isFinite(options.budget)||options.budget===Infinity)||options.budget<0)return null;
 if(options['absolute-reserve']!==null){const n=Number(options['absolute-reserve']);if(!Number.isFinite(n)||n<0)return null;options['absolute-reserve']=n;}
 return options;
}

// Serialized native worker: APIs are charged to the generated worker rather than the manager.
// Everything through claim and native purchase is synchronous, with no interleaving yields.
export const cloudPurchaseSource=String.raw`function purchaseCloudCapacity(ns,request,claim,cashBudget,candidates,demand,headroom){
 const result=(reason,extra={})=>({purchased:false,reason,...extra});
 try{
  const now=Date.now(),o=request.options;
  if(ns.read('remote-control/paused/host-manager.js.txt').trim()==='true')return result('paused');
  try{const m=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(m.expiresAt>now&&ns.isRunning(m.ownerPid))return result('maintenance');}catch{}
  const limit=ns.cloud.getServerLimit();if(!(limit>0))return result('disabled');
  const maxRam=ns.cloud.getRamLimit();if(!Number.isFinite(maxRam)||maxRam<1)return result('invalid-limit');
  const purchased=ns.cloud.getServerNames(),servers=[...new Set(['home',...request.servers,...purchased])]
   .filter(name=>ns.serverExists(name)&&ns.hasRootAccess(name)).map(name=>({name,ram:ns.getServerMaxRam(name),used:ns.getServerUsedRam(name),hacknet:/^hacknet-(node|server)-/.test(name)}));
  const home=servers.find(s=>s.name==='home');if(!home)return result('home-unavailable');
  const utilization=demand(servers,o['utilization-trigger'],headroom(home.ram,Number(ns.read('home-ram-reserve.txt'))||0));
  if(!utilization.needed)return result('idle-capacity',utilization);
  let percent=o['reserve-percent'];
  if(o['reserve-by-time'])percent=1-(1-percent)*Math.pow(1-o['reserve-by-time-decay-factor'],Math.max(0,now-ns.getResetInfo().lastAugReset)/3600000);
  const globalReserve=Number(ns.read('reserve.txt')||0);
  if(!Number.isFinite(globalReserve)||globalReserve<0)return result('invalid-reserve');
  const reserve=Math.max(globalReserve,o['absolute-reserve']??0);
  // Infinity does not survive JSON transport; null represents an unlimited remaining budget.
  const budget=cashBudget(ns.getPlayer().money,request.budget===null?Infinity:request.budget,reserve,percent);
  if(!(budget>0))return result('reserved-cash');
  const ramByServer=purchased.map(name=>({name,ram:ns.getServerMaxRam(name)})).sort((a,b)=>a.ram-b.ram);
  const upgrade=purchased.length>=limit,worst=ramByServer[0];
  if(upgrade&&(!worst||worst.ram>=maxRam))return result('maximum-capacity');
  const quotes=[];
  const minRam=Math.min(2**o['min-ram-exponent'],maxRam);
  for(let ram=minRam;ram<=maxRam;ram*=2){
   if(upgrade&&ram<=worst.ram)continue;
   const cost=upgrade?ns.cloud.getServerUpgradeCost(worst.name,ram):ns.cloud.getServerCost(ram);
   quotes.push({ram,oldRam:upgrade?worst.ram:0,cost});
  }
  const eligible=candidates(quotes,{budget,minRam,maxRam,homeRam:home.ram,totalRam:utilization.totalRam,
   homeThreshold:o['compare-to-home-threshold'],networkThreshold:o['compare-to-network-ram-threshold'],
   bestRam:ramByServer.at(-1)?.ram||0,allowWorse:o['allow-worse-purchases']});
  for(const q of eligible){
   // Denied claims do not consume allowance. Fall back without a speculative purchase.
   if(!claim(ns,'servers',q.cost))continue;
   const name=upgrade?(ns.cloud.upgradeServer(worst.name,q.ram)?worst.name:''):ns.cloud.purchaseServer('daemon',q.ram);
   if(!name)return result('purchase-failed',{cost:q.cost,ram:q.ram,upgrade});
   return {purchased:true,name,ram:q.ram,addedRam:q.ram-q.oldRam,cost:q.cost,upgrade,utilization:utilization.utilization};
  }
  return result(eligible.length?'shared-budget':'no-affordable-capacity',{budget,cost:eligible[0]?.cost??null,ram:eligible[0]?.ram??null,addedRam:eligible[0]?eligible[0].ram-eligible[0].oldRam:null,upgrade,utilization:utilization.utilization});
 }catch(error){return result('api-unavailable',{error:String(error)});}
}`;
