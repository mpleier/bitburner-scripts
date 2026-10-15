import {readNodeRoutePlan} from './node-route-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {isBlackOp,nextSkill,raidCities,recoveryRequired,optionsError,requiredBladeburnerTeam,prepareBladeburnerTeam,bladeburnerRecruitmentBudget,bladeburnerRankRate,rankBladeburnerActions,spendBladeburnerSkills,bladeburnerRecruitmentDecision,planBladeburnerLevels,startBladeburnerPlannedAction,bladeburnerWorkAllowed} from './bladeburner-policy.js';
import {isScriptPaused} from './automation-control.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { activityBusy, markActivitySupport, activityGuard } from './activity-coordination.js';
import { log, disableLogs, getConfiguration, instanceCount, getNsDataThroughFile, getFilePath, getActiveSourceFiles, formatNumberShort, formatDuration } from './helpers.js'

const cityNames = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
const antiChaosOperation = "Stealth Retirement Operation"; // Note: Faster and more effective than Diplomacy at reducing city chaos
const simulacrumAugName = "The Blade's Simulacrum"; // This augmentation lets you do bladeburner actions while busy
// Recheck ownership in the temporary worker immediately before a mutation.
const bbMutationGuard=`!(${maintenanceRequested.toString()})(ns) && !${activityGuard} && ns.read("remote-control/paused/bladeburner.js.txt").trim()!=="true" && (${achievementActionAllowed.toString()})(ns,"bladeburner") && !/black/i.test(ns.bladeburner.getCurrentAction()?.type||"")`;


// In general, we buy the affordable skill upgrade with the lowest adjusted cost, but to tweak the priority of various skills,
// we use the following configuration to change their relative cost. Higher number means lower priority
// Note: Ideally we could emphasize Tracer "early-game" and Digital Observer "late-game", but this is too much of a pain to solve for
const costAdjustments = {
    "Overclock": 0.8, // Speed up contracts/operations. More important now that sleeves remove the operation count bottleneck
    "Reaper": 1.2, // Combat boost. Early effect is paltry (because stats are so low), will get plenty of points late game
    "Evasive Systems": 1.2, // Dex/Agi boost. Mildly deprioritized for same reasoning as above.
    "Cloak": 1.5, // Cheap, and stealth ends up with plenty of boost, so we don't need to invest in Cloak as much.
    "Hyperdrive": 2, // Improves stats gained, but not Rank gained. Less useful if training outside of BB
    "Tracer": 2, // Only boosts Contract success chance, which are relatively easy to begin with.
    "Cyber's Edge": 5, // Boosts stamina, but contract counts are much more limiting than stamina, so isn't really needed
    "Hands of Midas": 10 // Improves money gain. It is assumed that Bladeburner will *not* be a main source of income
};

// Some bladeburner info gathered at startup and cached
let skillNames, generalActionNames, contractNames, operationNames, remainingBlackOpsNames, blackOpsRanks;
let inFaction, haveSimulacrum, lastBlackOpComplete, lowStaminaTriggered, lowHealthTriggered, timesTrained, currentTaskEndTime, maxRankNeeded, lastAssignedTask;
let ownedSourceFiles;
let player = (/**@returns{Player}*/() => undefined)();
let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // Information about the current bitnode
let options,teamBudget,teamLastTick,lastAssignedCount,ownsRecruitment=false;
const teamStatusFile='tasks/bladeburner-team.json';

const argsSchema = [
    ['disable-recruitment', false],
    ['disable-level-optimization',false], // Retain native action levels and autolevel settings.
    ['team-cap',30], // Maximum squad needed to bridge a Black Op success threshold.
    ['recruitment-budget-minutes',10], // At most this many minutes recruiting per rolling hour.
    ['success-threshold', 0.99], // Attempt the best action whose minimum chance of success exceeds this threshold
    ['chaos-recovery-threshold', 50], // Prefer to do "Stealth Retirement" operations to reduce chaos when it reaches this number
    ['max-chaos', 100], // If chaos exceeds this amount in every city, we will reluctantly resort to diplomacy to reduce it.
    ['toast-upgrades', false], // Set to true to toast each time a skill is upgraded
    ['toast-operations', false], // Set to true to toast each time we switch operations
    ['toast-relocations', false], // Set to true to toast each time we change cities
    ['low-stamina-pct', 0.5], // Switch to no-stamina actions when we drop below this stamina percent
    ['high-stamina-pct', 0.6], // Switch back to stamina-consuming actions when we rise above this stamina percent
    ['training-limit', 50], // Don't bother training more than this many times, since Training is slow and earns no rank
    ['update-interval', 2000], // How often to refresh bladeburner status
    ['ignore-busy-status', false], // If set to true, we will attempt to do bladeburner tasks even if we are currently busy and don't have The Blade's Simulacrum
    ['allow-raiding-highest-pop-city', false], // Set to true, we will allow Raid to be used even in our highest-population city (disabled by default)
    ['reserved-action-count', 200], // Some operation types are "reserved" for chaos reduction / population estimate increase. Start by reserving this many, reduced automatically as we approach maxRankNeeded
    ['disable-spending-hashes', false], // Set to true to not spawn spend-hacknet-hashes.js to spend hashes on bladeburner
];
export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
 registerAutomation(ns);
    if(isScriptPaused(ns,ns.getScriptName()))return;
    await markActivitySupport(ns);
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    const invalid=optionsError(runOptions);if(invalid)return log(ns,'ERROR: '+invalid,true,'error');
    ownsRecruitment=false;
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ['sleep'])
    player = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    let savedTeamBudget;try{savedTeamBudget=JSON.parse(ns.read(teamStatusFile));}catch{}
    const teamStartup=Date.now();
    teamLastTick=savedTeamBudget?.nodeReset===resetInfo.lastNodeReset&&savedTeamBudget.recruiting&&Number.isFinite(savedTeamBudget.at)&&savedTeamBudget.at<=teamStartup?savedTeamBudget.at:teamStartup;
    teamBudget=bladeburnerRecruitmentBudget(savedTeamBudget,resetInfo.lastNodeReset,teamStartup);
    ns.atExit(()=>{try{if(ownsRecruitment&&ns.bladeburner.getCurrentAction()?.name==='Recruitment')ns.bladeburner.stopBladeburnerAction();}catch{}});
    // Ensure we have access to bladeburner
    ownedSourceFiles = await getActiveSourceFiles(ns);
    if (!(7 in ownedSourceFiles) && !(6 in ownedSourceFiles))
        return log(ns, "ERROR: You have not yet unlocked the bladeburner API (need SF6/SF7 or to be in BN6/BN7)", true, 'error');
    if (resetInfo.currentNode == 8)
        return log(ns, "ERROR: Bladeburner is completely disabled in Bitnode 8 :`(\nHappy stonking", true, 'error');
    // Ensure we've joined bladeburners before proceeding further
    try {
        if(!await beingInBladeburner(ns))return;
        await gatherBladeburnerInfo(ns);
    } catch(err) { return log(ns,'WARNING: Bladeburner API unavailable or initialization failed: '+String(err),false,'warning'); }
    // Start the main loop which monitors stats and changes activities as needed
    while (!isScriptPaused(ns,ns.getScriptName()) && achievementActionAllowed(ns,'bladeburner')) {
 automationHeartbeat(ns);
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `WARNING: bladeburner.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        const nextTaskComplete = currentTaskEndTime - Date.now();
        await ns.sleep(Math.min(options['update-interval'], nextTaskComplete > 0 ? nextTaskComplete : Number.MAX_VALUE));
    }
}

// Calculate how long we've been in the current bitnode
function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

// Ram dodging helper to execute a parameterless bladeburner function
const getBBInfo = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(ns, `ns.bladeburner.${strFunction}`, null, args);
// Ram-dodging helper to get information for each item in a list (bit hacky). Temp script will be created such that
// the first argument recieved is an array of values to map, and any additional arguments are appended afterwards.
// The strFunction should contain a '%' sign indicating where the elements from the list should be mapped to a single call.
const getBBDict = async (ns, strFunction, elements, ...args) => await getNsDataThroughFile(ns,
    `Object.fromEntries(JSON.parse(ns.args[0]).map(e => [e, ns.bladeburner.${strFunction.replace('%', 'e')}]))`,
    `/Temp/bladeburner-${strFunction.split('(')[0]}-all.txt`, [JSON.stringify(elements), ...args]);
// Helper for dual-parameter bladeburner functions e.g. getActionCountRemaining(actionType, action)
const getBBDictByActionType = async (ns, strFunction, actionType, elements) =>
    await getBBDict(ns, `${strFunction}(ns.args[1], %)`, elements, actionType);

/** @param {NS} ns
 * Gather all one-time bladeburner info using ram-dodging scripts. */
async function gatherBladeburnerInfo(ns) {
    skillNames = await getBBInfo(ns, 'getSkillNames()');
    generalActionNames = await getBBInfo(ns, 'getGeneralActionNames()');
    contractNames = (await getBBInfo(ns, 'getContractNames()')).reverse(); // Reversed to put in order of highest rep to lowest
    operationNames = (await getBBInfo(ns, 'getOperationNames()')).reverse(); // Reversed to put in order of highest rep to lowest
    // Blackops data is a bit special, each can be completed one time, they should be done in order
    const blackOpsNames = await getBBInfo(ns, 'getBlackOpNames()');
    blackOpsRanks = await getBBDict(ns, 'getBlackOpRank(%)', blackOpsNames);
    const blackOpsToBeDone = await getBBDictByActionType(ns, 'getActionCountRemaining', "Black Operations", blackOpsNames);
    remainingBlackOpsNames = blackOpsNames.filter(n => blackOpsToBeDone[n] === 1)
        .sort((b1, b2) => blackOpsRanks[b1] - blackOpsRanks[b2]);
    log(ns, `There are ${remainingBlackOpsNames.length} remaining BlackOps operations to complete in order:\n` +
        remainingBlackOpsNames.map(n => `${n} (${blackOpsRanks[n]})`).join(", "));
    maxRankNeeded = Math.max(1,...Object.values(blackOpsRanks));
    // Check if we have the aug that lets us do bladeburner while otherwise busy
    haveSimulacrum = null; // Refreshed before work decisions, including after grafting.
    lastCanWorkCheckIdle = true;
    // Initialize some flags that may change over time
    lastAssignedTask = null;
    lastAssignedCount = null;
    lastBlackOpComplete = false; // Flag will track whether we've notified the user that the last black-op is ready
    lowHealthTriggered = false;
    lowStaminaTriggered = false; // Flag will track whether we've previously switched to stamina recovery to reduce noise
    timesTrained = 0; // Count of how many times we've trained (capped at --training-limit)
    currentTaskEndTime = 0; // When set to a date, we will not assign new tasks until that date.
    inFaction = player.factions.includes("Bladeburners"); // Whether we've joined the Bladeburner faction yet
}

// Helpers to determine the the dict keys with the lowest/highest value (returns an array [key, minValue] for destructuring)
const getMinKeyValue = (dict, filteredKeys = null) => (filteredKeys || Object.keys(dict)).reduce(([k, min], key) =>
    dict[key] < min ? [key, dict[key]] : [k, min], [null, Number.MAX_VALUE]);
const getMaxKeyValue = (dict, filteredKeys = null) => (filteredKeys || Object.keys(dict)).reduce(([k, max], key) =>
    dict[key] > max ? [key, dict[key]] : [k, max], [null, -Number.MAX_VALUE]);

/** @param {NS} ns
 * The main loop that decides what we should be doing in bladeburner. */
async function mainLoop(ns) {
    // Get player's updated rank
    const rank = await getBBInfo(ns, 'getRank()');
    // Ensure we're in the bladeburner faction ASAP
    if (!inFaction) await tryJoinFaction(ns, rank);
    // Spend any un-spent skill points
    await spendSkillPoints(ns);
    // Preserve every active Black Op before choosing a city or a replacement action.
    const observedAction=await getBBInfo(ns,'getCurrentAction()');
    const teamNow=Date.now();
    teamBudget=bladeburnerRecruitmentBudget(teamBudget,resetInfo.lastNodeReset,teamNow,teamLastTick,observedAction?.name==='Recruitment');
    teamLastTick=teamNow;
    // Persist accounting even while Black Ops, maintenance, or other activity owns the player.
    let previousTeamPlan;try{const saved=JSON.parse(ns.read(teamStatusFile));if(saved.nodeReset===resetInfo.lastNodeReset)previousTeamPlan=saved;}catch{}
    await ns.write(teamStatusFile,JSON.stringify({...previousTeamPlan,at:teamNow,pid:ns.pid,...teamBudget,state:isBlackOp(observedAction)?'protected-black-op':previousTeamPlan?.state||'observing',budgetMinutes:options['recruitment-budget-minutes'],recruiting:observedAction?.name==='Recruitment'}),'w');
    if(isBlackOp(observedAction)){lastAssignedTask=observedAction.name;return;}
    if(maintenanceRequested(ns)) {
        await ns.write(teamStatusFile,JSON.stringify({at:teamNow,pid:ns.pid,...teamBudget,state:'maintenance',reason:'Controller maintenance',budgetMinutes:options['recruitment-budget-minutes'],recruiting:observedAction?.name==='Recruitment'}),'w');
        if(ownsRecruitment&&observedAction?.name==='Recruitment')
            await getNsDataThroughFile(ns,'ns.isRunning(ns.args[0])&&ns.bladeburner.getCurrentAction()?.name==="Recruitment"?ns.bladeburner.stopBladeburnerAction():false','/Temp/bladeburner-stop-recruitment.txt',[ns.pid]);
        return;
    }
    // See if we are able to do bladeburner work
    if (!(await canDoBladeburnerWork(ns))) {
        // A prior recruitment target cannot reserve sleeves while player work prevents using the team.
        await ns.write(teamStatusFile,JSON.stringify({at:Date.now(),pid:ns.pid,...teamBudget,state:'waiting-for-player',reason:'Player activity prevents Bladeburner work',budgetMinutes:options['recruitment-budget-minutes'],recruiting:false}),'w');
        return;
    }

    // NEXT STEP: Gather data needed to determine what and where to work
    // If any blackops have been completed, remove them from the list of remaining blackops
    const blackOpsToBeDone = await getBBDictByActionType(ns, 'getActionCountRemaining', "Black Operations", remainingBlackOpsNames);
    remainingBlackOpsNames = remainingBlackOpsNames.filter(n => blackOpsToBeDone[n] === 1);
    const nextBlackOp = remainingBlackOpsNames.length === 0 ? null : remainingBlackOpsNames[0];
    // If we have completed the last bladeburner operation notify the user that they can leave the BN
    if (nextBlackOp == null && !lastBlackOpComplete) {
        const msg = `Bladeburner has completed the last BlackOp! (At ${formatDuration(getTimeInBitnode())}). ` +
            `You can destroy the Bitnode on the Bladeburner > BlackOps tab.`;
        log(ns, `SUCCESS: ${msg}`, true, 'success');
        // Autopilot handles departure; avoid a blocking completion popup.
        lastBlackOpComplete = true;
    }

    // Gather the count of available contracts / operations
    const contractCounts = await getBBDictByActionType(ns, 'getActionCountRemaining', "Contracts", contractNames);
    const operationCounts = await getBBDictByActionType(ns, 'getActionCountRemaining', "Operations", operationNames);
    // Define a helper that gets the count for an action based only on the name (type is auto-determined)
    const getCount = actionName => contractNames.includes(actionName) ? contractCounts[actionName] :
        operationNames.includes(actionName) ? operationCounts[actionName] :
            generalActionNames.includes(actionName) ? Number.POSITIVE_INFINITY :
                remainingBlackOpsNames.includes(actionName) ? 1 : 0;
    // Create some quick-reference collections of action names that are limited in count and/or reserved for special purpose
    const limitedActions = operationNames.concat(contractNames);
    if (nextBlackOp) limitedActions.unshift(nextBlackOp);
    const populationActions = ["Undercover Operation", "Investigation", "Tracking"];
    const reservedActions = ["Raid", "Stealth Retirement Operation"].concat(populationActions
        // Only reserve these actions if their count is below the configured reserve amount, scaled down as we approach our final rank (stop reserving at 99% of max rank)
        .filter(a => getCount(a) <= (options['reserved-action-count'] * (1 - rank / (0.99 * maxRankNeeded)))));
    if (nextBlackOp && rank < blackOpsRanks[nextBlackOp]) reservedActions.push(nextBlackOp); // Remove blackop from "available actions" if we have insufficient rank.
    const unreservedActions = limitedActions.filter(o => !reservedActions.includes(o));
    //log(ns, 'Unreserved Action Counts: ' + unreservedActions.map(a => `${a}: ${getCount(a)}`).join(", ")); // Debug log to see what unreserved actions remain
    //log(ns, 'Reserved Action Counts: ' + reservedActions.map(a => `${a}: ${getCount(a)}`).join(", ")); // Debug log to see what unreserved actions remain

    // NEXT STEP: Determine which city to work in
    // Get the population, communities, and chaos in each city
    const populationByCity = await getBBDict(ns, 'getCityEstimatedPopulation(%)', cityNames);
    const communitiesByCity = await getBBDict(ns, 'getCityCommunities(%)', cityNames);
    const chaosByCity = await getBBDict(ns, 'getCityChaos(%)', cityNames);
    let goToCity, population, travelReason, goingRaiding = false;

    // SPECIAL CASE: GO TO LOWEST-POPULATION CITY
    // If the only operations left to us are "Raid" (reduces population by a %, which, counter-intuitively, is bad for us),
    // thrash the city with the lowest population (but still having some communities to enable Raid).
    if (getCount("Raid") > 0 && unreservedActions.every(c => getCount(c) == 0)) {
        const raidableCities = raidCities(cityNames,populationByCity,communitiesByCity,options['allow-raiding-highest-pop-city']); // Cities with at least one community
        // Only allow Raid if we would not be raiding our highest-population city (need to maintain at least one)

        goingRaiding = raidableCities.length > 0;
        if (goingRaiding) { // Select the raid-able city with the smallest population
            [goToCity, population] = getMinKeyValue(populationByCity, raidableCities);
            travelReason = `Lowest population (${formatNumberShort(population)}) city with communities (${communitiesByCity[goToCity]}) to use up ${getCount("Raid")} Raid operations`;
        }// else log(ns, `INFO: Cannot use up raid operations because there are ${raidableCities.length} cities with communities. ` +
        //    `(--allow-raiding-highest-pop-city is set to ${options['allow-raiding-highest-pop-city']})`);
    }
    // SPECIAL CASE: GO TO HIGHEST-CHAOS CITY
    if (!goToCity && unreservedActions.every(c => getCount(c) == 0)) {
        let [maxChaosCity, maxChaos] = getMaxKeyValue(chaosByCity, cityNames);
        // If all we have left is "Stealth Retirement Operation", switch to the city with the most chaos (if it's a decent amount), and use them up.
        if (getCount("Stealth Retirement Operation") && maxChaos > options['chaos-recovery-threshold']) {
            goToCity = maxChaosCity;
            travelReason = `Highest-chaos (${maxChaos.toFixed(1)}) city to use up Stealth Retirement Operations`;
        } else if (maxChaos > options['max-chaos']) {
            goToCity = maxChaosCity;
            travelReason = `Nothing better to do, and city chaos ${maxChaos.toFixed(1)} is above --max-chaos threshold ${options['max-chaos']} - should use Diplomacy`;
        }
    } // Also, if we have nothing to do (even no Stealth Retirement), but chaos is above 'max-chaos' in some city, switch to it to do Diplomacy

    // GENERAL CASE: GO TO HIGHEST-POPULATION CITY
    if (!goToCity) { // Otherwise, cities with higher populations give better operation chances
        // Try to narrow down the cities we wish to work in to the ones with no chaos penalties
        let acceptableCities = cityNames.filter(city => chaosByCity[city] <= options['chaos-recovery-threshold']);
        // Pick the city (within chaos thresholds) with the highest population to maximize success chance.
        // If no city is within thresholds, the largest population city will be picked regardless of chaos
        [goToCity, population] = getMaxKeyValue(populationByCity, acceptableCities.length > 0 ? acceptableCities : cityNames);
        travelReason = `Highest population (${formatNumberShort(population)}) city, with chaos ${chaosByCity[goToCity].toFixed(1)}` +
            (acceptableCities.length == 0 ? ` (all cities above chaos threshold of ${options['chaos-recovery-threshold']})` : '');
    }

    let currentCity = await getBBInfo(ns, 'getCity()');
    // Change cities if we aren't blocked on our last task, and found a better city to work in
    if (currentCity != goToCity && Date.now() > currentTaskEndTime && (await switchToCity(ns, goToCity, travelReason)))
        currentCity = goToCity;

    let teamPlan={state:'not-needed',reason:!nextBlackOp?'All Black Ops are complete':options['team-cap']===0?'Team use disabled by team cap':rank<blackOpsRanks[nextBlackOp]?'More rank is required before the next Black Op':'No recruitment target'};
    if(options['team-cap']>0&&nextBlackOp&&rank>=blackOpsRanks[nextBlackOp]){
      try{teamPlan=await getNsDataThroughFile(ns,`ns.isRunning(ns.args[3])&&(${bbMutationGuard}) ? (${prepareBladeburnerTeam.toString()})({getTeamSize:(...a)=>ns.bladeburner.getTeamSize(...a),setTeamSize:(...a)=>ns.bladeburner.setTeamSize(...a),getActionEstimatedSuccessChance:(...a)=>ns.bladeburner.getActionEstimatedSuccessChance(...a)},ns.args[0],ns.args[1],ns.args[2],(${requiredBladeburnerTeam.toString()})) : {state:"protected-work"}`,'/Temp/bladeburner-team-plan.txt',[nextBlackOp,options['success-threshold'],options['team-cap'],ns.pid]);}
      catch(error){teamPlan={state:'unavailable',error:String(error)};}
    }
    await ns.write(teamStatusFile,JSON.stringify({at:Date.now(),pid:ns.pid,...teamBudget,...teamPlan,target:nextBlackOp,budgetMinutes:options['recruitment-budget-minutes'],recruiting:observedAction?.name==='Recruitment'}),'w');
    let levelPlans={};
    if(!options['disable-level-optimization'])try {
        const actions=limitedActions.filter(name=>getCount(name)>0&&name!==nextBlackOp).map(name=>[name,contractNames.includes(name)?'Contracts':'Operations']);
        levelPlans=await getNsDataThroughFile(ns,`(${planBladeburnerLevels.toString()})(ns.bladeburner,JSON.parse(ns.args[0]),ns.args[1],(${bladeburnerRankRate.toString()}),()=>ns.isRunning(ns.args[2])&&(${bbMutationGuard}))`,'/Temp/bladeburner-level-plan.txt',[JSON.stringify(actions),options['success-threshold'],ns.pid]);
    } catch(error) {ns.print('Level planning unavailable; retaining native levels: '+String(error));}
    await ns.write('tasks/bladeburner-levels.json',JSON.stringify({at:Date.now(),pid:ns.pid,city:currentCity,plans:levelPlans}),'w');

    // Gather the success chance of contracts (based on our current city)
    const contractChances = await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Contracts", contractNames);
    const operationChances = await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Operations", operationNames);
    for(const [name,plan]of Object.entries(levelPlans)) {
        if(contractNames.includes(name))contractChances[name]=plan.chance;
        else operationChances[name]=plan.chance;
    }
    const blackOpsChance = nextBlackOp === null || rank < blackOpsRanks[nextBlackOp] ? [0, 0] : // Insufficient rank for blackops means chance is zero
        (await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Black Operations", [nextBlackOp]))[nextBlackOp];
    // Define some helpers for determining min/max chance for each action
    const getChance = actionName => contractNames.includes(actionName) ? contractChances[actionName] :
        operationNames.includes(actionName) ? operationChances[actionName] :
            generalActionNames.includes(actionName) ? [1, 1] : nextBlackOp == actionName ? blackOpsChance : [0, 0];
    const minChance = actionName => getChance(actionName)[0];
    const maxChance = actionName => getChance(actionName)[1];

    // Fetch live action rewards and durations together. Older APIs can retain list-order selection.
    let actionMetrics={};
    try {
        const actions=limitedActions.map(name=>[name,name===nextBlackOp?'Black Operations':contractNames.includes(name)?'Contracts':'Operations']);
        actionMetrics=await getNsDataThroughFile(ns,
            'Object.fromEntries(JSON.parse(ns.args[0]).map(([name,type])=>[name,{time:ns.bladeburner.getActionTime(type,name),gain:ns.bladeburner.getActionRankGain(type,name),loss:ns.bladeburner.getActionRankLoss(type,name)}]))',
            '/Temp/bladeburner-action-metrics.txt',[JSON.stringify(actions)]);
    } catch { /* Reward APIs unavailable: keep the existing ordering. */ }
    for(const [name,plan]of Object.entries(levelPlans))actionMetrics[name]=plan.metrics;
    const actionChances={...contractChances,...operationChances,...(nextBlackOp?{[nextBlackOp]:blackOpsChance}:{})};

    // NEXT STEP: Pick the action we should be working on.
    let bestActionName, reason;
    const actionSummaryString = (action) => `Success Chance: ${(100 * minChance(action)).toFixed(1)}%` +
        (maxChance(action) - minChance(action) < 0.001 ? '' : ` to ${(100 * maxChance(action)).toFixed(1)}%`) + `, Remaining: ${getCount(action)}`

    // Trigger stamina recovery if we drop below our --low-stamina-pct configuration, and remain trigered until we've recovered to --high-stamina-pct
    const stamina = await getBBInfo(ns, `getStamina()`); // Returns [current, max];
    const staminaPct = stamina[0] / stamina[1];
    player=await getNsDataThroughFile(ns,'ns.getPlayer()');
    const recovery=recoveryRequired(player.hp.current/Math.max(1,player.hp.max),staminaPct,{health:lowHealthTriggered,stamina:lowStaminaTriggered},options['low-stamina-pct'],options['high-stamina-pct']);
    lowHealthTriggered=recovery.health;lowStaminaTriggered=recovery.stamina;
    // If we are suffering a stamina penalty, perform an action that consumes no stamina
    if(lowHealthTriggered) {
        bestActionName='Hyperbolic Regeneration Chamber';reason='Recovering health before combat';
    } else if (lowStaminaTriggered) {
        bestActionName = chaosByCity[currentCity] > options['max-chaos'] ? "Diplomacy" : "Hyperbolic Regeneration Chamber";
        reason = `Stamina is low: ${(100 * staminaPct).toFixed(1)}% < ${(100 * options['low-stamina-pct']).toFixed(1)}%`
    } else if(nextBlackOp&&rank>=blackOpsRanks[nextBlackOp]&&minChance(nextBlackOp)>=options['success-threshold']) {
        bestActionName=nextBlackOp;
        reason='Black Op ready: '+actionSummaryString(nextBlackOp);
    } // If current city chaos is greater than our threshold, keep it low with "Stealth Retirement" if odds are good
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.99) {
        bestActionName = antiChaosOperation;
        reason = `Chaos is high: ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} (--chaos-recovery-threshold) ${actionSummaryString(bestActionName)}`;
    } // If current city chaos is very high, we should be very wary of the snowballing effects, and try to reduce it.
    else if (chaosByCity[currentCity] > options['max-chaos']) {
        bestActionName = getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.8 ? antiChaosOperation : "Diplomacy";
        reason = `Out of ${antiChaosOperation}s, and chaos ${chaosByCity[currentCity].toFixed(2)} is higher than --max-chaos ${options['max-chaos']}`;
    } // If we've previously detemined we will be raiding the lowest-population city
    else if (goingRaiding && maxChance("Raid") > options['success-threshold']) { // Special-case: Ignore min-chance. Population estimate turns bad as we decimate it, but doesn't seem to affect success.
        bestActionName = "Raid";
        reason = `Only remaining Operations. ${actionSummaryString(bestActionName)}`;
    } else { // Prefer reliable actions with the highest expected net rank per second.
        let candidateActions = limitedActions;
        // We should deal with population uncertainty if its causing some mission to be on the verge of our success threshold
        let populationUncertain = unreservedActions.some(a => getCount(a)>0 && maxChance(a) >= options['success-threshold'] && minChance(a) < options['success-threshold']);
        // If current population uncertainty is such that some actions have a maxChance of ~100%, but not a minChance of ~100%,
        //   focus on actions that improve the population estimate, otherwise, reserve these actions for later
        // TODO: "Field Analysis" is the only population action that scales with player stats, so we should calculate and sort by
        //       "effectiveness per second" of each and see which is the most worthwhile way of improving the population estimate.
        candidateActions = populationUncertain ? populationActions : unreservedActions;
        // Filter out candidates with no contract counts remaining
        candidateActions = candidateActions.filter(a => getCount(a) > 0);
        //log(ns, `The following actions are available: ${candidateActions}`); // Debug log to see what candidate actions are

        const reliableCandidates=candidateActions.filter(a=>minChance(a)>=options['success-threshold']&&getCount(a)>=1);
        bestActionName=rankBladeburnerActions(reliableCandidates,actionChances,actionMetrics,nextBlackOp,bladeburnerRankRate)[0];
        // When estimates are uncertain, use Field Analysis rather than trusting the upper bound.
        if (!populationUncertain && !bestActionName)
            bestActionName = candidateActions.filter(a => a!==nextBlackOp && minChance(a) > 0.5 && maxChance(a) >= options['success-threshold'] && getCount(a) >= 1)[0];
        if (bestActionName) // If we found something to do, log details about its success chance range
            reason = actionSummaryString(bestActionName);

        // If there were no operations/contracts, resort to a "General" action which always have 100% chance, but take longer and gives less reward
        if (!bestActionName) {
            if (populationUncertain) { // Lower population uncertainty
                bestActionName = "Field Analysis";
                reason = `High population uncertainty in ${currentCity}`;
            } // If all (non-reserved) operation counts are 0, and chaos isn't too high, Incite Violence to get more work (logic above should subsequently reduce chaos)
            else if (unreservedActions.every(a => getCount(a) == 0) && cityNames.every(c => chaosByCity[c] < options['max-chaos'])) {
                bestActionName = "Incite Violence";
                let [maxChaosCity, maxChaos] = getMaxKeyValue(chaosByCity, cityNames);
                reason = `No work available, and max city chaos is ${maxChaos.toFixed(1)} in ${maxChaosCity}, ` +
                    `which is less than --max-chaos threshold ${options['max-chaos']}`;
            } // Otherwise, consider training
            else if (unreservedActions.some(a => maxChance(a) < options['success-threshold']) && // Only if we aren't at 100% chance for everything
                staminaPct > options['high-stamina-pct'] && timesTrained < options['training-limit']) { // Only if we have plenty of stamina and have barely trained
                timesTrained += options['update-interval'] / 30000; // Take into account the training time (30 seconds) vs how often this code is called
                bestActionName = "Training";
                reason = `Nothing better to do, times trained (${timesTrained.toFixed(0)}) < --training-limit (${options['training-limit']}), and ` +
                    `actions are below success threshold: ` + unreservedActions.filter(a => maxChance(a) < options['success-threshold'])
                        .map(a => `${a} (${(100 * maxChance(a)).toFixed(1)}%)`).join(", ");
            } else { // Otherwise, Field Analysis
                bestActionName = "Field Analysis"; // Gives a little rank, and improves population estimate. Best we can do when there's nothing else.
                reason = `Nothing better to do`;
            }
        }
        // Recruitment is reserved for a bounded, useful squad that unlocks a pending Black Op.

    }

    let recruitmentDecision={recruit:false,reason:teamPlan.reason||teamPlan.state};
    if(!options['disable-recruitment']&&teamPlan?.state==='needs-recruitment'&&!lowHealthTriggered&&!lowStaminaTriggered&&chaosByCity[currentCity]<=options['chaos-recovery-threshold']&&generalActionNames.includes('Recruitment')){
      const estimate=await getNsDataThroughFile(ns,'(() => {let supportingSleeves=null;try{supportingSleeves=Array.from({length:ns.sleeve.getNumSleeves()},(_,i)=>ns.sleeve.getTask(i)).filter(task=>task?.type==="SUPPORT").length;}catch{}return {chance:ns.bladeburner.getActionEstimatedSuccessChance("General","Recruitment"),duration:ns.bladeburner.getActionTime("General","Recruitment"),progress:ns.bladeburner.getCurrentAction()?.name==="Recruitment"?ns.bladeburner.getActionCurrentTime():0,supportingSleeves,bonusMs:ns.bladeburner.getBonusTime()};})()','/Temp/bladeburner-recruitment-estimate.txt');
      recruitmentDecision=bladeburnerRecruitmentDecision(teamPlan,estimate.chance,estimate.duration,options['recruitment-budget-minutes']*60000-teamBudget.spentMs,estimate.progress,estimate.supportingSleeves,estimate.bonusMs);
      if(recruitmentDecision.recruit){bestActionName='Recruitment';reason=recruitmentDecision.reason+' for '+nextBlackOp;}
    } else if(teamPlan?.state==='needs-recruitment')recruitmentDecision.reason=options['disable-recruitment']?'Recruitment disabled by option':'Waiting for health, stamina, or city chaos recovery';
    await ns.write(teamStatusFile,JSON.stringify({at:Date.now(),pid:ns.pid,...teamBudget,...teamPlan,target:nextBlackOp,budgetMinutes:options['recruitment-budget-minutes'],recruiting:observedAction?.name==='Recruitment',reason:recruitmentDecision.reason,expectedRecruitmentMs:recruitmentDecision.expectedMs}),'w');
    // Detect our current action (API returns an object like { "type":"Operations", "name":"Investigation" })
    const currentAction = await getBBInfo(ns, `getCurrentAction()`);
    // Special case: If the user has manually kicked off the last BlackOps, don't interrupt it, let it be our last task
    if(isBlackOp(currentAction)){lastAssignedTask=currentAction.name;return;}
    // Warn the user if it looks like a task was interrupted by something else (user activity or bladeburner automation). Ignore if our last assigned task has run out of actions.
    if (lastAssignedTask && lastAssignedTask != currentAction?.name && getCount(lastAssignedTask) > 0) {
        log(ns, `WARNING: The last task this script assigned was "${lastAssignedTask}", but you're now doing "${currentAction?.name || '(nothing)'}". ` +
            `Have you been using Bladeburner Automation? If so, try typing "automate dis" in the Bladeburner Console.`, false, 'warning');
    }
    if (currentAction?.name) {

        if (!lastAssignedTask) { // Leave a log acknowledging if we just started up and there was an activity already underway.
            log(ns, `INFO: At startup, Bladeburner was already doing "${currentAction?.name}", ` +
                (bestActionName != currentAction.name ? `but we would prefer to do "${bestActionName}", so we will be switching.` :
                    `which is what we were planning to do, so we will leave the current task alone.`));
            lastAssignedTask = currentAction.name;
        }
        // Preserve an assigned action until its first completion; recovery may interrupt ordinary combat.
        const interrupted=lastAssignedTask!==currentAction.name;
        const count=getCount(currentAction.name);
        if(!interrupted&&operationNames.includes(currentAction.name)&&Number.isFinite(lastAssignedCount)&&count<lastAssignedCount)currentTaskEndTime=0;
        lastAssignedCount=count;
        const urgent=lowHealthTriggered||lowStaminaTriggered||currentAction.name==='Recruitment'&&(teamBudget.spentMs>=options['recruitment-budget-minutes']*60000||bestActionName!=='Recruitment');
        const levelChange=levelPlans[bestActionName]&&(levelPlans[bestActionName].level!==levelPlans[bestActionName].currentLevel||levelPlans[bestActionName].autoLevel);
        if(bestActionName===currentAction.name&&!levelChange||!urgent&&!interrupted&&Date.now()<currentTaskEndTime)return;
    } // Otherwise prior action was stopped or ended and no count remain, so we should start a new one regardless of expected currentTaskEndTime

    // Change actions if we're not currently doing the desired action
    const bestActionType = nextBlackOp == bestActionName ? "Black Operations" : contractNames.includes(bestActionName) ? "Contracts" :
        operationNames.includes(bestActionName) ? "Operations" : "General";
    const success = await getNsDataThroughFile(ns, `(${startBladeburnerPlannedAction.toString()})(ns.bladeburner,ns.args[0],ns.args[1],JSON.parse(ns.args[6]),ns.args[3],ns.args[2],ns.args[4],()=>ns.isRunning(ns.args[5])&&(${bbMutationGuard})&&(${bladeburnerWorkAllowed.toString()})({getCurrentWork:()=>ns.singularity.getCurrentWork(),getOwnedAugmentations:q=>ns.singularity.getOwnedAugmentations(q)},ns.args[7]))`,null,[bestActionType,bestActionName,blackOpsRanks[bestActionName]||0,options['success-threshold'],teamPlan.required||0,ns.pid,JSON.stringify(levelPlans[bestActionName]||null),options['ignore-busy-status']]);
    const expectedDuration = await getBBInfo(ns, `getActionTime(ns.args[0], ns.args[1])`, bestActionType, bestActionName);
    log(ns, (success ? `INFO: Switched to Bladeburner ${bestActionType} "${bestActionName}" (${reason}${levelPlans[bestActionName]?', level '+levelPlans[bestActionName].level:''}). ETA: ${formatDuration(expectedDuration)}` :
        `ERROR: Failed to switch to Bladeburner ${bestActionType} "${bestActionName}" (Count: ${getCount(bestActionName)}, ` +
        `ETA: ${formatDuration(expectedDuration)}, Details: ${reason})`),
        !success, success ? (options['toast-operations'] ? 'info' : undefined) : 'error');
    // Ensure we perform this new action at least once before interrupting it
    lastAssignedTask = success ? bestActionName : null;
    lastAssignedCount = success ? getCount(bestActionName) : null;
    if(success)ownsRecruitment=bestActionName==='Recruitment';
    if(success)await ns.write(teamStatusFile,JSON.stringify({at:Date.now(),pid:ns.pid,...teamBudget,...teamPlan,target:nextBlackOp,budgetMinutes:options['recruitment-budget-minutes'],recruiting:bestActionName==='Recruitment',reason:recruitmentDecision.reason,expectedRecruitmentMs:recruitmentDecision.expectedMs}),'w');
    currentTaskEndTime = !success ? 0 : Date.now() + expectedDuration + 10; // Pad this a little to ensure we don't interrupt it.
}

/** @param {NS} ns
 * Helper to switch cities. */
async function switchToCity(ns, city, reason) {
    const success = await getNsDataThroughFile(ns, `(${bbMutationGuard}) ? ns.bladeburner.switchCity(ns.args[0]) : false`,null,[city]);
    log(ns, (success ? 'INFO: Switched' : 'ERROR: Failed to switch') + ` to Bladeburner city "${city}" (${reason})`,
        !success, success ? (options['toast-relocations'] ? 'info' : undefined) : 'error');
    return success;
}

/** @param {NS} ns
 * Decides how to spend skill points. */
async function spendSkillPoints(ns) {
    try{const goal=JSON.parse(ns.read('tasks/achievement-goals.json'));if(goal.nodeReset===resetInfo.lastNodeReset&&goal.expiresAt>Date.now()&&ns.isRunning(goal.ownerPid)&&goal.bankBladeburnerPoints)return;}catch{}
    const purchased=await getNsDataThroughFile(ns,
        `(${spendBladeburnerSkills.toString()})(ns.bladeburner,JSON.parse(ns.args[1]),JSON.parse(ns.args[2]),(${nextSkill.toString()}),()=>ns.isRunning(ns.args[0])&&(${bbMutationGuard})&&(()=>{try{const goal=JSON.parse(ns.read("tasks/achievement-goals.json"));return !(goal.nodeReset===ns.args[3]&&goal.expiresAt>Date.now()&&ns.isRunning(goal.ownerPid)&&goal.bankBladeburnerPoints);}catch{return true;}})())`,
        '/Temp/bladeburner-skill-purchases.txt',[ns.pid,JSON.stringify(skillNames),JSON.stringify(costAdjustments),resetInfo.lastNodeReset]);
    if(purchased.length) {
        const summary=Object.entries(purchased.reduce((counts,name)=>(counts[name]=(counts[name]||0)+1,counts),{})).map(([name,count])=>`${name} +${count}`).join(', ');
        log(ns,'SUCCESS: Upgraded Bladeburner skills: '+summary,false,options['toast-upgrades']?'success':undefined);
    }
}

/** @param {NS} ns
 * Helper to try and join the Bladeburner faction ASAP. */
async function tryJoinFaction(ns, rank) {
    if (inFaction) return;
    if (rank >= 25 && await getBBInfo(ns, 'joinBladeburnerFaction()')) {
        log(ns, 'SUCCESS: Joined the Bladeburner Faction!', false, 'success');
        inFaction = true;
    } else if (rank >= 25)
        log(ns, `WARNING: Failed to join the Bladeburner faction despite rank of ${rank.toFixed(1)}`, false, 'warning');
}

let lastCanWorkCheckIdle = true;

/** @param {NS} ns
 * Helper to see if we are able to do bladeburner work */
async function canDoBladeburnerWork(ns) {
    if (activityBusy(ns)) return false;
    let state={known:false,installed:null,busy:null,queued:null};
    if(4 in ownedSourceFiles)try {
        state=await getNsDataThroughFile(ns,'(() => {const installed=ns.singularity.getOwnedAugmentations(false).includes("The Blade\'s Simulacrum");return {known:true,installed,busy:!!ns.singularity.getCurrentWork()?.type,queued:!installed&&ns.singularity.getOwnedAugmentations(true).includes("The Blade\'s Simulacrum")};})()','/Temp/bladeburner-work-state.txt');
    }catch{}
    haveSimulacrum=state.installed;
    if(state.known&&!state.installed&&readNodeRoutePlan(ns)?.selected==='hacking') {
        // The main loop preserves active BlackOps before reaching this decision.
        await getNsDataThroughFile(ns,`ns.isRunning(ns.args[0])&&(${bbMutationGuard}) ? ns.bladeburner.stopBladeburnerAction():false`,
            '/Temp/bladeburner-route-yield.txt',[ns.pid]);
        await ns.write('tasks/bladeburner-work.json',JSON.stringify({at:Date.now(),pid:ns.pid,...state,allowed:false,reason:'World Daemon route priority'}),'w');
        return false;
    }
    const allowed=options['ignore-busy-status']||state.known&&(!state.busy||state.installed);
    await ns.write('tasks/bladeburner-work.json',JSON.stringify({at:Date.now(),pid:ns.pid,...state,allowed:!!allowed}),'w');
    if(allowed)return lastCanWorkCheckIdle=true;
    if(lastCanWorkCheckIdle)log(ns,state.known?
        `INFO: Bladeburner waiting for player work; ${simulacrumAugName} is ${state.queued?'purchased but not installed':'not installed'}.`:
        'INFO: Bladeburner cannot verify player work without Singularity access; waiting. --ignore-busy-status explicitly permits overriding this check.',false,'info');
    return lastCanWorkCheckIdle=false;
}

/** @param {NS} ns
 * Ensure we're in the Bladeburner division */
async function beingInBladeburner(ns) {
    // Ensure we're in the Bladeburner division. If not, wait until we've joined it.
    while (!(await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()'))) {
        if(isScriptPaused(ns,ns.getScriptName())||!achievementActionAllowed(ns,'bladeburner'))return false;
        try {
            if (player.skills.strength < 100 || player.skills.defense < 100 || player.skills.dexterity < 100 || player.skills.agility < 100)
                log(ns, `Waiting for physical stats >=100 to join bladeburner ` +
                    `(Currently Str: ${player.skills.strength}, Def: ${player.skills.defense}, Dex: ${player.skills.dexterity}, Agi: ${player.skills.agility})`);
            else if (achievementActionAllowed(ns,'bladeburner') && await getBBInfo(ns, 'joinBladeburnerDivision()')) {
                let message = `SUCCESS: Joined Bladeburner (At ${formatDuration(getTimeInBitnode())} into BitNode)`;
                if (9 in ownedSourceFiles && options['disable-spending-hashes'])
                    message += ' --disable-spending-hashes is set, but consider running the following command to give it a boost:\n' +
                        'run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_Rank --spend-on Exchange_for_Bladeburner_SP --liquidate';
                log(ns, message, true, 'success');
                break;
            } else
                log(ns, 'WARNING: Failed to join Bladeburner despite physical stats. Will try again...', false, 'warning');
            player = await getNsDataThroughFile(ns, 'ns.getPlayer()');
        }
        catch (err) {
            log(ns, `WARNING: bladeburner.js Caught (and suppressed) an unexpected error while waiting to join bladeburner, but will keep going:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(5000);
    }
    log(ns, "INFO: We are in Bladeburner. Starting main loop...")
    // If not disabled, launch an external script to spend hashes on bladeburner rank
    if (!(9 in ownedSourceFiles)) return true; // Hacknet not unlocked
    if (options['disable-spending-hashes'])
        {log(ns, `INFO: Not spending hashes on bladeburner (--disable-spending-hashes flag is set)`);return true;}
    if(!achievementActionAllowed(ns,'hashSpending'))return true;
    const fPath = getFilePath('spend-hacknet-hashes.js');
    const args = ['--spend-on', 'Exchange_for_Bladeburner_Rank', '--spend-on', 'Exchange_for_Bladeburner_SP', '--liquidate'];
    if (ns.run(fPath, { preventDuplicates: true }, ...args))
        log(ns, `INFO: Launched '${fPath}' to gain Bladeburner Rank and Skill Points more quickly (Can be disabled with --disable-spending-hashes)`)
    else
        log(ns, `WARNING: Failed to launch '${fPath}' (already running?)`)
    return true;
}
