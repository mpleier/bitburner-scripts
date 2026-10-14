import { achievementActionAllowed } from './achievement-policy.js';
import { isScriptPaused } from './automation-control.js';
import { registerAutomation, automationHeartbeat, maintenanceRequested } from './runtime-policy.js';
import { hacknetProduction, hacknetServerMode, hacknetOptionsError } from './hacknet-policy.js';
import { claimSpending } from './spending-policy.js';
import { getConfiguration, disableLogs, formatDuration, formatMoney, tryGetBitNodeMultipliers, } from './helpers.js'

let haveHacknetServers = true; // Cached flag after detecting whether we do (or don't) have hacknet servers
const argsSchema = [
    ['max-payoff-time', '1h'], // Controls how far to upgrade hacknets. Can be a number of seconds, or an expression of minutes/hours (e.g. '123m', '4h')
    ['time', null], // alias for max-payoff-time
    ['c', false], // Set to true to run continuously, otherwise, it runs once
    ['continuous', false],
    ['interval', 1000], // Rate at which the program purchases upgrades when running continuously
    ['max-spend', Number.MAX_VALUE], // The maximum amount of money to spend on upgrades
    ['toast', false], // Set to true to toast purchases
    ['reserve', null], // Reserve this much cash (defaults to contents of reserve.txt if not specified)

];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    if(isScriptPaused(ns,ns.getScriptName()))return;
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const continuous = options.c || options.continuous;
    const interval = options.interval;
    let maxSpend = options["max-spend"];
    let maxPayoffTime = options['time'] ?? options['max-payoff-time'];
    // A little string parsing to be more user friendly
    if (maxPayoffTime && String(maxPayoffTime).endsWith("m"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("m", "")) * 60
    else if (maxPayoffTime && String(maxPayoffTime).endsWith("h"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("h", "")) * 3600
    else
        maxPayoffTime = Number.parseFloat(maxPayoffTime);
    const invalid=hacknetOptionsError(options,maxPayoffTime);if(invalid)return ns.tprint('Hacknet: '+invalid);
    options.productionMultiplier=(await tryGetBitNodeMultipliers(ns)).HacknetNodeMoney;
    registerAutomation(ns);
    haveHacknetServers=hacknetServerMode(ns.getResetInfo(),ns.hacknet.numNodes()?ns.hacknet.getNodeStats(0):null);
    disableLogs(ns, ['sleep', 'getServerUsedRam', 'getServerMoneyAvailable']);
    setStatus(ns, `Starting hacknet-upgrade-manager with purchase payoff time limit of ${formatDuration(maxPayoffTime * 1000)} and ` +
        (maxSpend == Number.MAX_VALUE ? 'no spending limit' : `a spend limit of ${formatMoney(maxSpend)}`) +
        `. Current fleet: ${ns.hacknet.numNodes()} nodes...`);
    do {
        if(isScriptPaused(ns,ns.getScriptName()))return;
        automationHeartbeat(ns);
        if(maintenanceRequested(ns)){if(!continuous)return;await ns.sleep(Math.max(100,interval));continue;}
        try {
            const moneySpent = upgradeHacknet(ns, maxSpend, maxPayoffTime, options);
            // Using this method, we cannot know for sure that we don't have hacknet servers until we have purchased one
            if (haveHacknetServers && ns.hacknet.numNodes() > 0 && ns.hacknet.hashCapacity() == 0)
                haveHacknetServers = false;
            if (maxSpend && moneySpent === false) {
                setStatus(ns, `Spending limit reached. Breaking...`);
                break; // Hack, but we return a non-number (false) when we've bought all we can for the current config
            }
            maxSpend -= moneySpent;
        }
        catch (err) {
            setStatus(ns, `WARNING: hacknet-upgrade-manager.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        if (continuous) await ns.sleep(interval);
    } while (continuous);
}

let lastUpgradeLog = "";
function setStatus(ns, logMessage) {
    if (logMessage != lastUpgradeLog) ns.print(lastUpgradeLog = logMessage);
}

// Will buy the most effective hacknet upgrade, so long as it will pay for itself in the next {payoffTimeSeconds} seconds.
/** @param {NS} ns **/
export function upgradeHacknet(ns,maxSpend,maxPayoffTimeSeconds=3600,options={}) {
 if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)||!achievementActionAllowed(ns,'hacknetExpense'))return 0;
 const count=ns.hacknet.numNodes(),servers=hacknetServerMode(ns.getResetInfo(),count?ns.hacknet.getNodeStats(0):null);
 const multiplier=ns.getPlayer().mults.hacknet_node_money*(options.productionMultiplier??1),hashValue=servers?250000:1;
 const reserve=Math.max(0,Number(options.reserve??ns.read('reserve.txt'))||0),funds=Math.min(maxSpend,ns.getPlayer().money-reserve);
 const candidates=[];
 const add=(candidate,gain)=>{if(Number.isFinite(candidate.cost)&&candidate.cost>0&&Number.isFinite(gain)&&gain>0){candidate.payoff=candidate.cost/(gain*hashValue);candidate.gain=gain;candidates.push(candidate);}};
 for(let i=0;i<count;i++){
  const stats=ns.hacknet.getNodeStats(i),current=hacknetProduction(stats,servers,multiplier);
  add({kind:'level',index:i,cost:ns.hacknet.getLevelUpgradeCost(i,1)},hacknetProduction({...stats,level:stats.level+1},servers,multiplier)-current);
  add({kind:'ram',index:i,cost:ns.hacknet.getRamUpgradeCost(i,1)},hacknetProduction({...stats,ram:stats.ram*2},servers,multiplier)-current);
  add({kind:'cores',index:i,cost:ns.hacknet.getCoreUpgradeCost(i,1)},hacknetProduction({...stats,cores:stats.cores+1},servers,multiplier)-current);
 }
 if(count<ns.hacknet.maxNumNodes())add({kind:'node',cost:ns.hacknet.getPurchaseNodeCost()},hacknetProduction({level:1,ram:1,cores:1,ramUsed:0},servers,multiplier));
 const useful=candidates.filter(c=>c.payoff<=maxPayoffTimeSeconds).sort((a,b)=>a.payoff-b.payoff);
 const best=useful.find(c=>c.cost<=funds);
 if(!best){setStatus(ns,useful.length?'Hacknet waiting for funds or spending limit.':'No production upgrades meet the payoff limit.');return useful.some(c=>c.cost<=maxSpend)?0:false;}
 if(!claimSpending(ns,'hacknet',best.cost))return 0;
 const success=best.kind==='node'?ns.hacknet.purchaseNode()>=0:best.kind==='level'?ns.hacknet.upgradeLevel(best.index,1):best.kind==='ram'?ns.hacknet.upgradeRam(best.index,1):ns.hacknet.upgradeCore(best.index,1);
 const message=success?`Purchased Hacknet ${best.kind} for ${formatMoney(best.cost)}; payoff ${formatDuration(best.payoff*1000)}`:'Hacknet purchase failed; will recheck costs and funds.';
 setStatus(ns,message);if(success&&options.toast)ns.toast(message,'success');
 return success?best.cost:0;
}
