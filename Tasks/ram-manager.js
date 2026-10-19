import {publishInfrastructureCost} from '../early-game-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {claimSpending} from '../spending-policy.js';
import {formatMoney,formatRam,getConfiguration,getNsDataThroughFile,log} from '../helpers.js';

const max_ram=2**30;
const argsSchema=[['budget',0.2],['reserve',null]];
export function autocomplete(data,_) {data.flags(argsSchema);return [];}

/** Null-default flags may arrive as numeric text from ns.flags. Never coerce blanks or booleans to zero. */
export function normalizeRamOptions(options) {
 const numeric=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
 const budget=numeric(options.budget),reserve=options.reserve==null?null:numeric(options.reserve);
 return Number.isFinite(budget)&&budget>=0&&budget<=1&&
  (reserve===null||Number.isFinite(reserve)&&reserve>=0)?{budget,reserve}:null;
}

/** Serialized purchase transaction: quote, wallet, guards and purchase share one native tick. */
export function purchaseHomeRam(ns,budget,reserveOption,expectedRam,claim,allowed) {
 const stopped=reason=>({purchased:false,reason});
 if(!Number.isFinite(budget)||budget<0||reserveOption!==null&&(!Number.isFinite(reserveOption)||reserveOption<0))return stopped('invalid-budget');
 if(['Tasks/ram-manager.js','/Tasks/ram-manager.js','ram-manager.js'].some(name=>ns.read('remote-control/paused/'+name+'.txt').trim()==='true'))return stopped('paused');
 try{const m=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(m.expiresAt>Date.now()&&ns.isRunning(m.ownerPid))return stopped('maintenance');}catch{}
 if(!allowed(ns,'homeRam'))return stopped('restricted');
 try {
  if(ns.getResetInfo().bitNodeOptions?.restrictHomePCUpgrade)return stopped('restricted');
  const ram=ns.getServerMaxRam('home');
  if(ram!==expectedRam)return stopped('ram-changed');
  if(ram>=2**30)return stopped('maximum');
  const cost=ns.singularity.getUpgradeHomeRamCost();
  if(!Number.isFinite(cost)||cost<0)return stopped('invalid-cost');
  const reserve=reserveOption===null?Math.max(0,Number(ns.read('reserve.txt'))||0):reserveOption;
  if(cost>budget||ns.getPlayer().money-cost<reserve)return stopped('budget');
  if(!claim(ns,'home',cost))return stopped('shared-budget');
  if(!ns.singularity.upgradeHomeRam())return stopped('purchase-failed');
  return {purchased:true,cost,ram:ns.getServerMaxRam('home')};
 }catch(error){return {purchased:false,reason:'api-unavailable',error:String(error)};}
}

/** @param {NS} ns */
export async function main(ns) {
 if(!achievementActionAllowed(ns,'homeRam'))return;
 const configured=getConfiguration(ns,argsSchema);if(!configured)return;
 const options=normalizeRamOptions(configured);
 if(!options)return log(ns,'ERROR: budget must be between 0 and 1; reserve must be a nonnegative finite number. Received: '+JSON.stringify({budget:configured.budget,reserve:configured.reserve}),true,'error');
 try {
  const reserve=options.reserve===null?Math.max(0,Number(ns.read('reserve.txt'))||0):options.reserve;
  const money=await getNsDataThroughFile(ns,'ns.getPlayer().money');
  let spendable=Math.max(0,Math.min(money-reserve,money*options.budget));
  while(spendable>0) {
   const snapshot=await getNsDataThroughFile(ns,'({ram:ns.getServerMaxRam("home"),cost:ns.singularity.getUpgradeHomeRamCost()})');
   if(snapshot.ram>=max_ram)return;
   if(!Number.isFinite(snapshot.cost)||snapshot.cost<0)return;
   publishInfrastructureCost(ns,'ram',snapshot.cost,options.budget);
   if(snapshot.cost>spendable)return;
   const result=await getNsDataThroughFile(ns,
    `(${purchaseHomeRam.toString()})(ns,ns.args[0],ns.args[1],ns.args[2],(${claimSpending.toString()}),(${achievementActionAllowed.toString()}))`,
    '/Temp/home-ram-purchase.txt',[spendable,options.reserve,snapshot.ram]);
   if(!result.purchased){log(ns,'INFO: Home RAM upgrade deferred: '+result.reason+(result.error?' ('+result.error+')':''));return;}
   log(ns,`SUCCESS: Upgraded home RAM to ${formatRam(result.ram)} (cost: ${formatMoney(result.cost)})`,false,'success');
   spendable-=result.cost;
   if(result.ram!==snapshot.ram*2)return;
   await ns.sleep(100);
  }
 }catch(error){log(ns,'WARNING: Home RAM upgrade unavailable; will retry later: '+String(error),false,'warning');}
}
