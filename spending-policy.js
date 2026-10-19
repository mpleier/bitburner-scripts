import {augmentationSavingsTarget} from './progression-improvements-policy.js';
/** One-minute player-cash allowances. Corporation funds and stock capital remain separate. */
export function spendingPlan({money,reserve=0,homeRam=0,node=1,epoch=Date.now(),ownerPid,reset,signals={}}) {
 const weights = node===10 ? {home:20,servers:5,hacknet:5,gang:5,sleeves:10,graft:15,soa:10,sleeveExpansion:28,corporation:2} :
  {home:homeRam<128?50:35,servers:15,hacknet:10,gang:5,sleeves:5,graft:15,soa:13,sleeveExpansion:0,corporation:2};
 const reasons=[];
 if(Number.isFinite(signals.gangEquipmentPayback)&&signals.gangEquipmentPayback>0&&signals.gangEquipmentPayback<=900){weights.gang*=4;reasons.push('Profitable gang upgrades repay within fifteen minutes');}
 if(signals.gangStalled){weights.gang*=2;reasons.push('Gang equipment priority: territory is not advancing');}
 if(signals.sleeveShockHigh){weights.sleeves*=0.5;reasons.push('Hold sleeve augmentation spending while shock recovers');}
 if(signals.sleeveExpansionNeeded&&node===10){weights.sleeveExpansion*=1.5;reasons.push('Sleeve expansion priority');}
 const priorities={ram:{home:3,servers:.5,graft:.5},hacking:{home:2,servers:1.5,graft:1.5},reputation:{sleeves:2,soa:2,graft:1.25},combat:{sleeves:2,gang:1.25,graft:.75,home:.75},cash:{home:1.5,servers:2,hacknet:1.5,gang:1.5,graft:.5}};
 // Preserve cash for augmentation progress rather than increasing hash reinvestment during a cash shortage.
 if(signals.bottleneck==='cash'&&node!==9)priorities.cash.hacknet=.35;
 if(priorities[signals.bottleneck]){for(const [category,factor]of Object.entries(priorities[signals.bottleneck]))weights[category]*=factor;reasons.push('Progression bottleneck: '+signals.bottleneck);}
 for(const [category,active]of Object.entries(signals.activeCategories||{}))if(active===false&&category in weights)weights[category]=0;
 const total=Object.values(weights).reduce((a,b)=>a+b,0),free=Math.max(0,money-reserve);
 const startup=signals.corporationStartup&&free>=150e9?150e9:0;
 if(startup)reasons.push('Reserve an allowance for corporation creation');
 const allowances=Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,(free-startup)*v/total]));allowances.corporation+=startup;
 if(signals.bottleneck==='cash'&&node!==9){
  allowances.hacknet=Math.min(allowances.hacknet,free*.02);
  reasons.push('Limit Hacknet reinvestment to 2% of unreserved cash while augmentations need money');
 }

 const essentialRam=Number.isFinite(signals.essentialHomeRam?.target)&&signals.essentialHomeRam.target>homeRam&&signals.essentialHomeRam.target<=2**30;
 if(signals.route==='bladeburner'||signals.augmentationCashTarget){
  const saving=signals.augmentationCashTarget;
  if(homeRam>=128&&!essentialRam)allowances.home=Math.min(allowances.home,free*.02);
  allowances.servers=Math.min(allowances.servers,free*.02);
  allowances.hacknet=Math.min(allowances.hacknet,free*(saving?.cost>0?.02:.05));
  reasons.push(saving?'Save cash toward '+saving.name+' ('+saving.cost+')':'Limit infrastructure reinvestment while Bladeburner is the selected route');
 }
 if(essentialRam){
  // Fund one essential upgrade without increasing the total budget or taking corporation startup cash.
  const desired=Math.max(allowances.home,Math.min(free-startup,free*.5));
  const others=Object.entries(allowances).filter(([k])=>k!=='home').reduce((sum,[k,v])=>sum+Math.max(0,v-(k==='corporation'?startup:0)),0);
  const slack=Math.max(0,free-Object.values(allowances).reduce((sum,v)=>sum+v,0));
  const shift=Math.min(Math.max(0,desired-allowances.home),slack+others);
  const fromOthers=Math.max(0,shift-slack);
  if(others>0)for(const k of Object.keys(allowances))if(k!=='home'){
   const protectedCash=k==='corporation'?startup:0;
   allowances[k]=protectedCash+(allowances[k]-protectedCash)*(1-fromOthers/others);
  }
  allowances.home+=shift;
  reasons.push('Essential manager RAM and headroom target: '+signals.essentialHomeRam.target+' GB');
 }
 return {epoch,ownerPid,reset,homeRam,expiresAt:epoch+60000,reserve,reasons,signals,allowances};
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
 // Keep this guard self-contained: claimSpending is serialized into native purchase workers.
 const goal=plan.signals?.augmentationCashTarget;
 let saving=typeof goal?.name==='string'&&goal.name&&Number.isFinite(goal.cost)&&goal.cost>0&&Number.isFinite(plan.epoch)&&plan.epoch<=Date.now()&&plan.expiresAt<=Date.now()+120000&&ns.ps('home').some(p=>p.pid===plan.ownerPid&&p.filename?.replace(/^\//,'')==='autopilot.js')?goal.cost:0;
 // This function is serialized into workers: revalidate wait reservations locally.
 if(goal?.source==='augmentation-wait'){
  try{
   const wait=JSON.parse(ns.read('tasks/augmentation-wait-plan.json')),now=Date.now(),target=wait.plan;
   if(wait.active!==true||wait.schemaVersion!==1||wait.ownerPid!==plan.ownerPid||
    wait.augReset!==reset.lastAugReset||wait.nodeReset!==reset.lastNodeReset||
    !Number.isFinite(wait.at)||wait.at>now||now-wait.at>120000||
    wait.startedAt!==goal.startedAt||wait.startedAt<reset.lastAugReset||wait.startedAt>now||
    !Number.isFinite(wait.expiresAt)||wait.expiresAt<=now||wait.expiresAt-wait.startedAt>15*60000||
    target?.worthWaiting!==true||target.name!==goal.name||target.cashTarget!==goal.cost||
    !Number.isFinite(target.at)||target.at>now||now-target.at>120000||
    target.deadline!==goal.deadline||target.deadline<=now||target.deadline>wait.expiresAt)saving=0;
  }catch{saving=0;}
 }
 const essential=category==='home'&&Number.isFinite(plan.homeRam)&&plan.homeRam<128;
 if(category!=='augmentation'&&!essential&&ns.getPlayer().money<cost+Math.max(Number(ns.read('reserve.txt'))||0,saving))return false;

 let usage;try{usage=JSON.parse(ns.read('tasks/spending-usage.json'));}catch{}
 if(usage?.epoch!==plan.epoch||!usage.spent||typeof usage.spent!=='object'||Array.isArray(usage.spent))usage={epoch:plan.epoch,spent:{}};
 let limit=Number(plan.allowances[category])||0;
 // A cached emergency allowance ends as soon as native RAM reaches its target.
 if(category==='home'&&Number.isFinite(plan.signals?.essentialHomeRam?.target)&&
   ns.getServerMaxRam('home')>=plan.signals.essentialHomeRam.target&&
   (plan.signals.route==='bladeburner'||plan.signals.augmentationCashTarget))
  limit=Math.min(limit,Math.max(0,ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0))*.02);
 const spent=Number(usage.spent[category])||0;
 if(cost>limit-spent)return false;
 usage.spent[category]=spent+cost;
 ns.write('tasks/spending-usage.json',JSON.stringify(usage),'w');return true;
}

export function adaptiveBudgetSignals(ns,corporationStartup=false){
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},now=Date.now();
 const fresh=s=>{const at=s?.dataAt===undefined?s?.at:s.dataAt;return Number.isFinite(at)&&at>now-120000&&at<=now&&s.pid&&ns.isRunning(s.pid);};
 const growth=read('tasks/gang-growth.json');
 const gang=read('tasks/gang-status.json'),sleeves=read('tasks/sleeve-status.json'),saved=read('tasks/budget-progress.json'),nodeReset=ns.getResetInfo().lastNodeReset;
 const previous=saved?.nodeReset===nodeReset?saved:null;
 const info=fresh(gang)?gang.info:null,items=fresh(sleeves)&&Array.isArray(sleeves.sleeves)?sleeves.sleeves:[];
 const stable=previous?.nodeReset===ns.getResetInfo().lastNodeReset&&now-previous.at>=20*60000;
 const gangStalled=!!(info&&gang.memberCount===12&&info.territory<.999&&info.territory<=(previous?.territory??-1)+1e-6&&(stable||previous?.gangStalled));
 if(!previous||previous.nodeReset!==ns.getResetInfo().lastNodeReset||stable)ns.write('tasks/budget-progress.json',JSON.stringify({at:now,nodeReset:ns.getResetInfo().lastNodeReset,territory:info?.territory??0,gangStalled}),'w');
 const snapshot=read('/Temp/affordable-augs.txt')?.speedSnapshot,route=read('tasks/node-route-plan.json');
 const ram=read('tasks/essential-home-ram.json'),reset=ns.getResetInfo();
 const essentialHomeRam=ram&&Number.isFinite(ram.at)&&ram.at>=reset.lastAugReset&&ram.at<=now&&now-ram.at<=45000&&
  ram.augReset===reset.lastAugReset&&ram.nodeReset===nodeReset&&Number.isFinite(ram.target)&&ram.target>0&&ram.target<=2**30&&
  ns.ps('home').some(p=>p.pid===ram.ownerPid&&p.filename?.replace(/^\//,'')==='autopilot.js')?ram:null;
 const validRoute=route?.augReset===ns.getResetInfo().lastAugReset&&route?.nodeReset===nodeReset&&route?.at<=now&&now-route.at<45000&&ns.isRunning(route.ownerPid)?route.selected:null;
 return {route:validRoute,essentialHomeRam,augmentationCashTarget:augmentationCashReserve(ns,true)||augmentationSavingsTarget(snapshot,ns.getResetInfo(),snapshot?ns.getPlayer().money:0,validRoute,now),gangEquipmentPayback:fresh(growth)&&growth.schemaVersion===2&&growth.nodeReset===nodeReset&&growth.augReset===ns.getResetInfo().lastAugReset&&growth.equipmentOpportunity?.reason==='production'?growth.equipmentOpportunity.cashPaybackSeconds:null,gangStalled,sleeveShockHigh:items.length>0&&items.reduce((sum,s)=>sum+(Number(s.shock)||0),0)/items.length>25,sleeveExpansionNeeded:items.length>0&&(items.length<8||items.some(s=>s.memory<100)),corporationStartup};
}

/** Self-contained for stock workers. waitGoalOnly returns metadata for the budget planner.
 * Selected wait goals include the entire basket and only additional (not already budgeted) donations. */
export function augmentationCashReserve(ns,waitGoalOnly=false) {
 let waitGoal=null;
 try{
  const now=Date.now(),reset=ns.getResetInfo(),wait=JSON.parse(ns.read('tasks/augmentation-wait-plan.json')),target=wait?.plan;
  if(wait.schemaVersion===1&&wait.active===true&&
   Number.isFinite(reset.lastNodeReset)&&Number.isFinite(reset.lastAugReset)&&
   wait.nodeReset===reset.lastNodeReset&&wait.augReset===reset.lastAugReset&&
   ns.ps('home').some(p=>p.pid===wait.ownerPid&&p.filename?.replace(/^\//,'')==='autopilot.js')&&
   Number.isFinite(wait.at)&&wait.at<=now&&now-wait.at<=120000&&
   Number.isFinite(wait.startedAt)&&wait.startedAt>=reset.lastAugReset&&wait.startedAt<=now&&
   Number.isFinite(wait.expiresAt)&&wait.expiresAt>now&&wait.expiresAt-wait.startedAt<=15*60000&&
   target?.worthWaiting===true&&typeof target.name==='string'&&target.name&&
   Number.isFinite(target.at)&&target.at<=now&&now-target.at<=120000&&
   Number.isFinite(target.deadline)&&target.deadline>now&&target.deadline<=wait.expiresAt&&
   Number.isFinite(target.cashTarget)&&target.cashTarget>0)
    waitGoal={name:target.name,cost:target.cashTarget,source:'augmentation-wait',startedAt:wait.startedAt,deadline:target.deadline,nodeReset:wait.nodeReset};
 }catch{}
 if(waitGoalOnly)return waitGoal;
 if(waitGoal)return waitGoal.cost;
 try {
  const plan=JSON.parse(ns.read('tasks/spending-plan.json')),now=Date.now();
  if(plan.reset!==ns.getResetInfo().lastAugReset||!Number.isFinite(plan.epoch)||plan.epoch>now||!Number.isFinite(plan.expiresAt)||plan.expiresAt<=now||plan.expiresAt>now+120000)return 0;
  if(!ns.ps('home').some(p=>p.pid===plan.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js'))return 0;
  const goal=plan.signals?.augmentationCashTarget;
  // A cached wait signal must never outlive its current receipt.
  if(goal?.source==='augmentation-wait')return 0;
  return typeof goal?.name==='string'&&goal.name&&Number.isFinite(goal.cost)&&goal.cost>0?goal.cost:0;
 }catch{return 0;}
}
