import {gangCorporationCapital} from './gang-safety-policy.js';
import {augmentationSavingsTarget} from './progression-improvements-policy.js';
/** One-minute player-cash allowances. Corporation funds and stock capital remain separate. */
export function spendingPlan({money,reserve=0,homeRam=0,node=1,epoch=Date.now(),ownerPid,reset,signals={}}) {
 const weights = node===10 ? {home:20,servers:5,hacknet:5,gang:5,sleeves:10,graft:15,soa:10,sleeveExpansion:28,corporation:2} :
  {home:homeRam<128?50:35,servers:15,hacknet:10,gang:5,sleeves:5,graft:15,soa:13,sleeveExpansion:0,corporation:2};
 weights.training=signals.route==='bladeburner'?2:0;
 const reasons=[];
 if(Number.isFinite(signals.gangEquipmentPayback)&&signals.gangEquipmentPayback>0&&signals.gangEquipmentPayback<=900){weights.gang*=signals.gangEquipmentPayback<=300?8:4;reasons.push(signals.gangEquipmentPayback<=300?'Prioritize gang equipment repaying within five minutes':'Profitable gang upgrades repay within fifteen minutes');}
 else if(Number.isFinite(signals.gangRecruitmentSecondsSaved)&&signals.gangRecruitmentSecondsSaved>=20){weights.gang*=3;reasons.push('Fund gang equipment that advances recruitment');}
 if(signals.gangStalled){weights.gang*=2;reasons.push('Gang equipment priority: territory is not advancing');}
 if(signals.sleeveShockHigh){weights.sleeves*=0.5;reasons.push('Hold sleeve augmentation spending while shock recovers');}
 if(signals.sleeveExpansionNeeded&&node===10){weights.sleeveExpansion*=1.5;reasons.push('Sleeve expansion priority');}
 const priorities={ram:{home:3,servers:.5,graft:.5},hacking:{home:2,servers:1.5,graft:1.5},reputation:{sleeves:2,soa:2,graft:1.25},combat:{sleeves:2,gang:1.25,graft:.75,home:.75},cash:{home:1.5,servers:2,hacknet:1.5,gang:1.5,graft:.5}};
 // Preserve cash for augmentation progress rather than increasing hash reinvestment during a cash shortage.
 if(signals.bottleneck==='cash'&&node!==9)priorities.cash.hacknet=.35;
 if(priorities[signals.bottleneck]){for(const [category,factor]of Object.entries(priorities[signals.bottleneck]))weights[category]*=factor;reasons.push('Progression bottleneck: '+signals.bottleneck);}
 for(const [category,active]of Object.entries(signals.activeCategories||{}))if(active===false&&category in weights)weights[category]=0;
 const total=Object.values(weights).reduce((a,b)=>a+b,0),free=Math.max(0,money-reserve);
 const gangCapital=gangCorporationCapital(signals,free);
 const startup=signals.corporationStartup&&free>=150e9?Math.min(150e9,free-gangCapital.protectedGangCash):0;
 if(gangCapital.protectedGangCash)reasons.push(gangCapital.reason);
 if(startup)reasons.push('Reserve an allowance for corporation creation');
 const allowances=Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,(free-startup)*v/total]));allowances.corporation+=startup;
 if(gangCapital.protectedGangCash&&weights.gang>0){const shift=Math.min(Math.max(0,gangCapital.protectedGangCash-allowances.gang),Math.max(0,allowances.corporation));allowances.gang+=shift;allowances.corporation-=shift;}
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
 const capacity=signals.fullHomeRam;
 if(!essentialRam&&signals.activeCategories?.home!==false&&!signals.augmentationCashTarget&&money>=300000&&capacity?.complete===true&&
  Number.isFinite(capacity.target)&&capacity.target>homeRam&&capacity.target<=2**30){
  const desired=Math.max(allowances.home,Math.min(free-startup,free*.1));
  const others=Object.entries(allowances).filter(([k])=>k!=='home').reduce((sum,[k,v])=>sum+Math.max(0,v-(k==='corporation'?startup:0)),0);
  const shift=Math.min(Math.max(0,desired-allowances.home),others);
  if(others>0)for(const k of Object.keys(allowances))if(k!=='home'){
   const protectedCash=k==='corporation'?startup:0;allowances[k]=protectedCash+(allowances[k]-protectedCash)*(1-shift/others);
  }
  allowances.home+=shift;reasons.push('Enabled manager capacity target: '+capacity.target+' GB');
 }
 return {gangCapital,epoch,ownerPid,reset,homeRam,expiresAt:epoch+60000,reserve,reasons,signals,allowances};
}
/** Self-contained for generated purchase workers. Native ns.write updates text synchronously.
 * Claim immediately before a synchronous purchase. Failed attempts conservatively consume allowance. */
export function claimSpending(ns,category,cost,investment=null) {
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
 // Keep the explicit reserve absolute. Only a fresh native production quote may borrow from an ordinary savings goal.
 let growthException=false;
 let priorUsage;try{priorUsage=JSON.parse(ns.read('tasks/spending-usage.json'));}catch{}
 const funding=plan.signals?.augmentationFunding;
 const investmentScript=category==='gang'&&investment?.kind==='gang-equipment'?'gangs.js':category==='hacknet'&&investment?.kind==='hacknet-production'?'hacknet-upgrade-manager.js':null;
 const lastGrowth=priorUsage?.growthException;
 const growthCooling=!!lastGrowth&&(!Number.isFinite(lastGrowth.at)||lastGrowth.at>Date.now()||Date.now()-lastGrowth.at<60000);
 const canCollect=!lastGrowth||Number.isFinite(lastGrowth.at)&&lastGrowth.at<=Date.now()&&Date.now()-lastGrowth.at>=30000;
 let resetting=false;try{const r=JSON.parse(ns.read('tasks/augmentation-reset-plan.json'));resetting=r.pending===true&&r.augReset===reset.lastAugReset&&r.expiresAt>Date.now()&&r.expiresAt<=Date.now()+180000&&ns.ps('home').some(p=>p.pid===r.ownerPid&&p.filename?.replace(/^\//,'')==='autopilot.js');}catch{}
 if(!resetting&&Number.isFinite(reset.lastNodeReset)&&Number.isFinite(reset.lastAugReset)&&investmentScript&&saving>0&&goal?.source!=='augmentation-wait'&&ns.getPlayer().money<saving&&
  investment.at<=Date.now()&&Date.now()-investment.at<5000&&investment.nodeReset===reset.lastNodeReset&&investment.augReset===reset.lastAugReset&&
  Number.isSafeInteger(investment.ownerPid)&&investment.ownerPid>0&&ns.ps('home').some(p=>p.pid===investment.ownerPid&&p.filename?.replace(/^\//,'')===investmentScript)&&
  investment.cost===cost&&Number.isFinite(investment.gainPerSecond)&&investment.gainPerSecond>0&&
  Number.isFinite(investment.delaySeconds??0)&&(investment.delaySeconds??0)>=0&&(investment.delaySeconds??0)<=900&&
  Number.isFinite(investment.cashBatchSize??0)&&(investment.cashBatchSize??0)>=0&&(investment.cashBatchSize??0)<=1e6&&
  funding?.nodeReset===reset.lastNodeReset&&funding.augReset===reset.lastAugReset&&Number.isFinite(funding.at)&&funding.at<=Date.now()&&Date.now()-funding.at<=120000&&
  Number.isFinite(funding.rate)&&funding.rate>0&&canCollect){
   const money=ns.getPlayer().money,gain=investment.gainPerSecond*.5,baseline=(saving-money)/funding.rate;
   const delay=investment.delaySeconds??0,batch=investment.cashBatchSize??0;
   const accelerated=(saving-money+cost+batch)/(funding.rate+gain)+delay,payback=cost/gain+delay;
   growthException=cost<=money*.01&&payback<=Math.min(900,baseline*.5)&&baseline-accelerated-30>=Math.max(30,baseline*.1);
 }
 const essential=category==='home' &&Number.isFinite(plan.homeRam)&&plan.homeRam<128;
 if(category!=='augmentation'&&!essential&&!growthException&&ns.getPlayer().money<cost+Math.max(Number(ns.read('reserve.txt'))||0,saving))return false;

 let usage;try{usage=JSON.parse(ns.read('tasks/spending-usage.json'));}catch{}
 if(usage?.epoch!==plan.epoch||!usage.spent||typeof usage.spent!=='object'||Array.isArray(usage.spent))usage={epoch:plan.epoch,spent:{},...(lastGrowth?{growthException:lastGrowth}:{})};
 let limit=Number(plan.allowances[category])||0;
 // A cached emergency allowance ends as soon as native RAM reaches its target.
 if(category==='home'&&Number.isFinite(plan.signals?.essentialHomeRam?.target)&&
   ns.getServerMaxRam('home')>=plan.signals.essentialHomeRam.target&&
   (plan.signals.route==='bladeburner'||plan.signals.augmentationCashTarget))
  limit=Math.min(limit,Math.max(0,ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0))*.02);
 if(category==='home'&&plan.signals?.fullHomeRam?.complete===true&&Number.isFinite(plan.signals.fullHomeRam.target)&&
   ns.getServerMaxRam('home')>=plan.signals.fullHomeRam.target&&plan.signals.route==='bladeburner')
  limit=Math.min(limit,Math.max(0,ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0))*.02);
 const spent=Number(usage.spent[category])||0;
 if(cost>limit-spent)return false;
 // This board is advisory: only this call's fresh native quote may consume the grant.
 if(growthException){
  const now=Date.now(),scope=JSON.stringify([reset.lastNodeReset,reset.lastAugReset,plan.ownerPid,goal.name,goal.cost]);
  const file='tasks/growth-investment-auction.json';let board;try{board=JSON.parse(ns.read(file));}catch{}
  const valid=board?.schemaVersion===1&&board.state!=='claimed'&&board.scope===scope&&Number.isFinite(board.startedAt)&&board.startedAt<=now&&
   board.collectUntil===board.startedAt+30000&&board.expiresAt===board.collectUntil+30000&&now<board.expiresAt&&Array.isArray(board.bids);
  if(!valid)board={schemaVersion:1,scope,startedAt:now,collectUntil:now+30000,expiresAt:now+60000,bids:[]};
  const identity=b=>JSON.stringify([b.category,b.ownerPid,b.kind,b.member??null,b.equipment??null,b.upgrade??null,b.index??null]);
  const bid={category,kind:investment.kind,ownerPid:investment.ownerPid,at:investment.at,cost,gainPerSecond:investment.gainPerSecond,
   delaySeconds:investment.delaySeconds??0,cashBatchSize:investment.cashBatchSize??0,member:investment.member,equipment:investment.equipment,upgrade:investment.upgrade,index:investment.index};
  const key=identity(bid),processes=ns.ps('home'),money=ns.getPlayer().money,hold=Math.max(0,Number(ns.read('reserve.txt'))||0);
  const rows=board.bids.filter(b=>b&&identity(b)!==key).concat(bid).slice(-64),ranked=[];
  for(const b of rows){
   const script=b.category==='gang'&&b.kind==='gang-equipment'?'gangs.js':b.category==='hacknet'&&b.kind==='hacknet-production'?'hacknet-upgrade-manager.js':null;
   if(!script||!Number.isSafeInteger(b.ownerPid)||!processes.some(p=>p.pid===b.ownerPid&&p.filename?.replace(/^\//,'')===script)||ns.read('remote-control/paused/'+script+'.txt').trim()==='true'||
    !Number.isFinite(b.at)||b.at>now||now-b.at>=60000||![b.cost,b.gainPerSecond,b.delaySeconds,b.cashBatchSize].every(Number.isFinite)||
    b.cost<=0||b.cost>money*.01||b.cost>money-hold||b.gainPerSecond<=0||b.delaySeconds<0||b.delaySeconds>900||b.cashBatchSize<0||b.cashBatchSize>1e6)continue;
   const allowance=Number(plan.allowances[b.category])||0,used=Number(usage.spent[b.category])||0;
   if(b.cost>allowance-used)continue;
   const gain=b.gainPerSecond*.5,baseline=(saving-money)/funding.rate;
   const accelerated=(saving-money+b.cost+b.cashBatchSize)/(funding.rate+gain)+b.delaySeconds,saved=baseline-accelerated-30,payback=b.cost/gain+b.delaySeconds;
   if(payback>Math.min(900,baseline*.5)||saved<Math.max(30,baseline*.1))continue;
   ranked.push({...b,savedSeconds:saved});
  }
  ranked.sort((a,b)=>b.savedSeconds-a.savedSeconds||a.cost-b.cost||identity(a).localeCompare(identity(b)));
  // Keep the best sixteen, plus all later callers get a chance to replace an older quote.
  board.bids=ranked.slice(0,16);board.at=now;board.state=now<board.collectUntil?'collecting':'ready';
  board.winner=now<board.collectUntil?null:ranked[0]??null;
  ns.write(file,JSON.stringify(board),'w');
  if(now<board.collectUntil||growthCooling||priorUsage?.epoch===plan.epoch&&priorUsage.growthException||!board.winner||identity(board.winner)!==key)return false;
  investment={...investment,savedSeconds:board.winner.savedSeconds};
 }
 if(growthException)usage.growthException={at:Date.now(),cost,savedSeconds:investment.savedSeconds,category,kind:investment.kind,upgrade:investment.upgrade,index:investment.index,delaySeconds:investment.delaySeconds??0,cashBatchSize:investment.cashBatchSize??0,member:investment.member,equipment:investment.equipment,projectedGainPerSecond:investment.gainPerSecond*.5};
 usage.spent[category]=spent+cost;
 ns.write('tasks/spending-usage.json',JSON.stringify(usage),'w');
 if(growthException){try{const a=JSON.parse(ns.read('tasks/growth-investment-auction.json'));a.state='claimed';a.claimedAt=Date.now();ns.write('tasks/growth-investment-auction.json',JSON.stringify(a),'w');}catch{}}
 return true;
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
 const capacity=read('tasks/manager-capacity.json');
 const fullHomeRam=capacity?.complete===true&&capacity.needsUpgrade===true&&Number.isFinite(capacity.at)&&capacity.at>=reset.lastAugReset&&capacity.at<=now&&now-capacity.at<=45000&&
  capacity.augReset===reset.lastAugReset&&capacity.nodeReset===nodeReset&&Number.isFinite(capacity.target)&&capacity.target>0&&capacity.target<=2**30&&
  ns.ps('home').some(p=>p.pid===capacity.ownerPid&&p.filename?.replace(/^\//,'')==='autopilot.js')?capacity:null;
 const observation=read('tasks/speed-observation.json'),speed=read('tasks/progression-speed.json');
 const incomeFresh=!!observation&&observation.augReset===reset.lastAugReset&&Number.isFinite(observation.at)&&observation.at<=now&&now-observation.at<=120000&&
  Number.isFinite(observation.rateMeasuredAt)&&observation.rateMeasuredAt<=now&&now-observation.rateMeasuredAt<=120000&&
  observation.cashObservation?.mode==='sources-v1'&&Number.isFinite(observation.cashRate)&&observation.cashRate>0;
 const augmentationFunding=incomeFresh?{rate:observation.cashRate,at:observation.rateMeasuredAt,nodeReset,augReset:reset.lastAugReset}:null;
 const speedFresh=!!speed&&speed.augReset===reset.lastAugReset&&Number.isFinite(speed.at)&&speed.at<=now&&now-speed.at<=120000;
 const development=read('tasks/bladeburner-development.json');
 const combat=!!development&&development.nodeReset===nodeReset&&development.augReset===reset.lastAugReset&&development.chanceBlocked&&
  Number.isFinite(development.at)&&development.at<=now&&now-development.at<30000&&ns.isRunning(development.pid)?
  {metadata:development.metadata,player:ns.getPlayer(),effective:development.effective}:null;
 const economics=incomeFresh&&speedFresh?{cashRate:observation.cashRate,recoveryMs:speed.recoveryMs,rebuildMs:speed.resetEconomics?.rebuildMs,
  remainingMs:route&&route.augReset===reset.lastAugReset&&route.nodeReset===nodeReset&&route.at<=now&&now-route.at<45000&&ns.isRunning(route.ownerPid)?route?.routes?.[route.selected]?.etaMs:null,combat}:null;
 const validRoute=!!route&&route.augReset===ns.getResetInfo().lastAugReset&&route?.nodeReset===nodeReset&&route?.at<=now&&now-route.at<45000&&ns.isRunning(route.ownerPid)?route.selected:null;
 const capitalGrowth=fresh(growth)&&growth.schemaVersion===2&&growth.nodeReset===nodeReset&&growth.augReset===reset.lastAugReset&&growth.at>now-30000&&ns.ps('home').some(p=>p.pid===growth.pid&&p.filename?.replace(/^\//,'')==='gangs.js');
 return {gangCapitalQuote:capitalGrowth?growth.equipmentOpportunity:null,gangCapitalHorizon:capitalGrowth?growth.horizon?.seconds:null,route:validRoute,essentialHomeRam,fullHomeRam,augmentationCashTarget:augmentationCashReserve(ns,true)||augmentationSavingsTarget(snapshot,ns.getResetInfo(),snapshot?ns.getPlayer().money:0,validRoute,now,economics),augmentationFunding,gangEquipmentPayback:fresh(growth)&&growth.schemaVersion===2&&growth.nodeReset===nodeReset&&growth.augReset===ns.getResetInfo().lastAugReset&&growth.equipmentOpportunity?.reason==='production'?growth.equipmentOpportunity.cashPaybackSeconds:null,gangRecruitmentSecondsSaved:fresh(growth)&&growth.schemaVersion===2&&growth.nodeReset===nodeReset&&growth.augReset===ns.getResetInfo().lastAugReset&&growth.equipmentOpportunity?.reason==='recruitment'?growth.equipmentOpportunity.recruitSecondsSaved:null,gangStalled,sleeveShockHigh:items.length>0&&items.reduce((sum,s)=>sum+(Number(s.shock)||0),0)/items.length>25,sleeveExpansionNeeded:items.length>0&&(items.length<8||items.some(s=>s.memory<100)),corporationStartup};
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
