/** One-minute player-cash allowances. Corporation funds and stock capital remain separate. */
export function spendingPlan({money,reserve=0,homeRam=0,node=1,epoch=Date.now(),ownerPid,reset,signals={}}) {
 const weights = node===10 ? {home:20,servers:5,hacknet:5,gang:5,sleeves:10,graft:15,soa:10,sleeveExpansion:28,corporation:2} :
  {home:homeRam<128?50:35,servers:15,hacknet:10,gang:5,sleeves:5,graft:15,soa:13,sleeveExpansion:0,corporation:2};
 const reasons=[];
 if(signals.gangStalled){weights.gang*=2;reasons.push('Gang equipment priority: territory is not advancing');}
 if(signals.sleeveShockHigh){weights.sleeves*=0.5;reasons.push('Hold sleeve augmentation spending while shock recovers');}
 if(signals.sleeveExpansionNeeded&&node===10){weights.sleeveExpansion*=1.5;reasons.push('Sleeve expansion priority');}
 const priorities={ram:{home:3,servers:.5,graft:.5},hacking:{home:2,servers:1.5,graft:1.5},reputation:{sleeves:2,soa:2,graft:1.25},cash:{home:1.5,servers:2,hacknet:1.5,gang:1.5,graft:.5}};
 if(priorities[signals.bottleneck]){for(const [category,factor]of Object.entries(priorities[signals.bottleneck]))weights[category]*=factor;reasons.push('Progression bottleneck: '+signals.bottleneck);}
 for(const [category,active]of Object.entries(signals.activeCategories||{}))if(active===false&&category in weights)weights[category]=0;
 const total=Object.values(weights).reduce((a,b)=>a+b,0),free=Math.max(0,money-reserve);
 const startup=signals.corporationStartup&&free>=150e9?150e9:0;
 if(startup)reasons.push('Reserve an allowance for corporation creation');
 const allowances=Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,(free-startup)*v/total]));allowances.corporation+=startup;
 return {epoch,ownerPid,reset,expiresAt:epoch+60000,reserve,reasons,signals,allowances};
}
/** Self-contained for generated purchase workers. Native ns.write updates text synchronously.
 * Claim immediately before a synchronous purchase. Failed attempts conservatively consume allowance. */
export function claimSpending(ns,category,cost) {
 if(!Number.isFinite(cost)||cost<0)return false;
 try{const p=JSON.parse(ns.read('tasks/achievement-profile.json'));if(p.active&&p.nodeReset===ns.getResetInfo().lastNodeReset&&p.deniedActions?.includes('cashSpending'))return false;}catch{}
 if(ns.getPlayer().money<cost+Math.max(0,Number(ns.read('reserve.txt'))||0))return false;
 let plan;try{plan=JSON.parse(ns.read('tasks/spending-plan.json'));}catch{return true;}
 if(!plan||!Number.isFinite(plan.expiresAt)||!plan.allowances||plan.expiresAt<=Date.now()||!ns.ps('home').some(p=>p.pid===plan.ownerPid))return true;
 const reset=ns.getResetInfo();if(plan.reset!==reset.lastAugReset)return true;
 let usage;try{usage=JSON.parse(ns.read('tasks/spending-usage.json'));}catch{}
 if(usage?.epoch!==plan.epoch||!usage.spent||typeof usage.spent!=='object'||Array.isArray(usage.spent))usage={epoch:plan.epoch,spent:{}};
 const spent=Number(usage.spent[category])||0,limit=Number(plan.allowances[category])||0;
 if(cost>limit-spent)return false;
 usage.spent[category]=spent+cost;
 ns.write('tasks/spending-usage.json',JSON.stringify(usage),'w');return true;
}

export function adaptiveBudgetSignals(ns,corporationStartup=false){
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},now=Date.now();
 const fresh=s=>s?.at>now-120000&&s.pid&&ns.isRunning(s.pid);
 const gang=read('tasks/gang-status.json'),sleeves=read('tasks/sleeve-status.json'),saved=read('tasks/budget-progress.json'),nodeReset=ns.getResetInfo().lastNodeReset;
 const previous=saved?.nodeReset===nodeReset?saved:null;
 const info=fresh(gang)?gang.info:null,items=fresh(sleeves)&&Array.isArray(sleeves.sleeves)?sleeves.sleeves:[];
 const stable=previous?.nodeReset===ns.getResetInfo().lastNodeReset&&now-previous.at>=20*60000;
 const gangStalled=!!(info&&gang.memberCount===12&&info.territory<.999&&info.territory<=(previous?.territory??-1)+1e-6&&(stable||previous?.gangStalled));
 if(!previous||previous.nodeReset!==ns.getResetInfo().lastNodeReset||stable)ns.write('tasks/budget-progress.json',JSON.stringify({at:now,nodeReset:ns.getResetInfo().lastNodeReset,territory:info?.territory??0,gangStalled}),'w');
 return {gangStalled,sleeveShockHigh:items.length>0&&items.reduce((sum,s)=>sum+(Number(s.shock)||0),0)/items.length>25,sleeveExpansionNeeded:items.length>0&&(items.length<8||items.some(s=>s.memory<100)),corporationStartup};
}
