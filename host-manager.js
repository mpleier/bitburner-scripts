import {publishCloudPurchase} from './cloud-status-policy.js';
import {homeRamHeadroom} from './home-ram-policy.js';
import {cloudPurchaseSource,cloudCashBudget,cloudCandidates,cloudDemand,normalizeCloudOptions} from './cloud-server-policy.js';
import { claimSpending } from './spending-policy.js';
import { log, getConfiguration, instanceCount, getNsDataThroughFile, formatMoney, formatRam } from './helpers.js'

const argsSchema = [
    ['c', false], // Set to true to run continuously
    ['run-continuously', false], // Long-form alias for above flag
    ['interval', 10000], // Update interval (in milliseconds) when running continuously
    ['min-ram-exponent', 5], // the minimum amount of ram to purchase
    ['utilization-trigger', 0.80], // the percentage utilization that will trigger an attempted purchase
    ['absolute-reserve', null], // Set to reserve a fixed amount of money. Defaults to the contents of reserve.txt on home
    ['reserve-percent', 0.9], // Set to reserve a percentage of home money
    ['reserve-by-time', false], // Experimental exponential decay by time in the run. Starts willing to spend lots of money, falls off over time.
    ['reserve-by-time-decay-factor', 0.2], // Controls how quickly our % reserve increases from --reserve-percent to 100% over time. For example, if --reserve-percent is set to 0.05 (allow spending 95% of money), time to reduce spending to ~25% of money is ~6hrs at 0.2, ~4hrs at 0.3, ~2hrs at 0.5
    ['budget', Number.POSITIVE_INFINITY], // Yet another way to control spending, this budget will not be exceeded, regardless of player owned money. Reserves are still respected.
    ['allow-worse-purchases', false], // Set to true to allow purchase of servers worse than our current best purchased server
    ['compare-to-home-threshold', 0.25], // Do not bother buying servers unless they are at least this big compared to current home RAM
    ['compare-to-network-ram-threshold', 0.02], // Do not bother buying servers unless they are at least this big compared to total network RAM
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** Native cloud calls run in a transient worker so the manager can run on small home servers. */
export async function main(ns) {
 const configured=getConfiguration(ns,argsSchema);if(!configured)return;
 const options=normalizeCloudOptions(configured);
 if(!options)return log(ns,'ERROR: Invalid cloud server options: check budget, reserves, thresholds, interval, and RAM exponent.',true,'error');
 if(await instanceCount(ns)>1)return;
 ns.disableLog('ALL');
 const continuous=options.c||options['run-continuously'];let budget=options.budget,lastStatus='';
 do {
  try{
   const servers=await getNsDataThroughFile(ns,'scanAllServers(ns).filter(s=>ns.hasRootAccess(s))','/Temp/rooted-servers.txt');
   const result=await getNsDataThroughFile(ns,
    `(${cloudPurchaseSource})(ns,JSON.parse(ns.args[0]),(${claimSpending.toString()}),(${cloudCashBudget.toString()}),(${cloudCandidates.toString()}),(${cloudDemand.toString()}),(${homeRamHeadroom.toString()}))`,
    '/Temp/cloud-purchase.txt',[JSON.stringify({servers,options,budget:Number.isFinite(budget)?budget:null})]);
   publishCloudPurchase(ns,result);
   if(result.purchased){
    budget-=result.cost;
    log(ns,`SUCCESS: ${result.upgrade?'Upgraded':'Purchased'} server ${result.name} with ${formatRam(result.ram)} RAM for ${formatMoney(result.cost)} (budget was ${formatMoney(budget+result.cost)})`, false, 'success');
    lastStatus='';
   }else{
    const message=`${['purchase-failed','api-unavailable'].includes(result.reason)?'WARNING':'INFO'}: Cloud server purchase deferred: ${result.reason}${result.error?' ('+result.error+')':''}`;
    if(message!==lastStatus){ns.print(message);lastStatus=message;}
    if(['disabled','maximum-capacity','paused'].includes(result.reason))return;
   }
  }catch(error){
   publishCloudPurchase(ns,{purchased:false,reason:'api-unavailable',error:String(error)});
   const message='WARNING: Cloud server purchasing unavailable; will retry later: '+String(error);
   if(message!==lastStatus){ns.print(message);lastStatus=message;}
  }
  if(!continuous||budget<=0)return;
  await ns.sleep(options.interval);
 }while(continuous);
}
