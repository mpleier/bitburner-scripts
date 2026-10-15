import {readNodeRoutePlan} from './node-route-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { claimSpending } from './spending-policy.js';
import { chooseSleeveCrime } from './automation-policy.js';
import { isScriptPaused } from './automation-control.js';
import { bestSleeveCrime, sleeveCrimeChance, sleeveRepAssignments, purchaseSleeveAugBatch, sleeveTaskMatches, sleeveReserves, sleeveControlAllowed, sleeveOptionsError, sleeveAugSpendingBudget, sleeveBladeburnerSupport } from './sleeve-policy.js';
import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, formatMoney, formatDuration } from './helpers.js'

const argsSchema = [
    ['min-shock-recovery', 0], // Recover fully by default to unlock permanent sleeve augmentations.
    ['shock-recovery', 0.05], // Set to a number between 0 and 1 to devote that ratio of time to periodic shock recovery (until shock is at 0)
    ['crime', null], // If specified, sleeves will perform only this crime regardless of stats
    ['homicide-chance-threshold', 0.5], // Sleeves on crime will automatically start homicide once their chance of success exceeds this ratio
    ['disable-gang-homicide-priority', false], // By default, sleeves will do homicide to farm Karma until we're in a gang. Set this flag to disable this priority.
    ['aug-budget', 0.1], // Spend up to this much of current cash on augs per tick (Default is high, because these are permanent for the rest of the BN)
    ['buy-cooldown', 60 * 1000], // Must wait this may milliseconds before buying more augs for a sleeve
    ['min-aug-batch', 1], // Buy useful affordable augmentations without waiting for a large batch.
    ['reserve', null], // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
    ['disable-follow-player', false], // Set to true to disable having Sleeve 0 work for the same faction/company as the player to boost reputation gain rates
    ['disable-training', false], // Set to true to disable having sleeves workout at the gym (costs money)
    ['train-to-strength', 105], // Sleeves will go to the gym until they reach this much Str
    ['train-to-defense', 105], // Sleeves will go to the gym until they reach this much Def
    ['train-to-dexterity', 70], // Sleeves will go to the gym until they reach this much Dex
    ['train-to-agility', 70], // Sleeves will go to the gym until they reach this much Agi
    ['study-to-hacking', 25], // Sleeves will go to university until they reach this much Hak
    ['study-to-charisma', 25], // Sleeves will go to university until they reach this much Cha
    ['training-reserve', null], // Extra training reserve; the global reserve is always preserved.
    ['training-cap-seconds', 2 * 60 * 60 /* 2 hours */], // Time since the start of the bitnode after which we will no longer attempt to train sleeves to their target "train-to" settings
    ['disable-spending-hashes-for-gym-upgrades', false], // Set to true to disable spending hashes on gym upgrades when training up sleeves.
    ['disable-spending-hashes-for-study-upgrades', false], // Set to true to disable spending hashes on study upgrades when smarting up sleeves.
    ['disable-bladeburner-team-support',false], // Disable automatic healthy-sleeve support for a live Black Op team shortfall.
    ['enable-bladeburner-team-building', false], // Set to true to have one sleeve support the main sleeve, and another do recruitment. Otherwise, they will just do more "Infiltrate Synthoids"
    ['disable-bladeburner', false], // Disable all sleeve Bladeburner assignments.
    ['enable-bladeburner-contracts', false], // Opt in to contracts; the player probability does not describe sleeve safety.
    ['disable-auto-reputation', false], // Disable additional sleeves working for distinct useful factions/companies.
    ['failed-bladeburner-contract-cooldown', 30 * 60 * 1000], // Default 30 minutes: time to wait after failing a bladeburner contract before we try again
];

const interval = 1000; // Update (tick) this often to check on sleeves and recompute their ideal task
const rerollTime = 61000; // How often we re-roll for each sleeve's chance to be randomly placed on shock recovery
const statusUpdateInterval = 10 * 60 * 1000; // Log sleeve status this often, even if their task hasn't changed
const works = ['security', 'field', 'hacking']; // When doing faction work, we prioritize physical work since sleeves tend towards having those stats be highest
const trainStats = ['strength', 'defense', 'dexterity', 'agility'];
const trainSmarts = ['hacking', 'charisma'];
const sleeveBbContractNames = ["Tracking", "Bounty Hunter", "Retirement"];
const minBbContracts = 2; // There should be this many contracts remaining before sleeves attempt them
const minBbProbability = 0.99; // This sleeve's lower success estimate must meet the threshold.
const waitForContractCooldown = 60 * 1000; // 1 minute - Cooldown when contract count or probability gets too low

let cachedCrimeStats, workByFaction; // Cache of crime statistics and which factions support which work
let task, lastStatusUpdateTime, lastPurchaseTime, lastPurchaseStatusUpdate, availableAugs, cacheExpiry,
    shockChance, lastRerollTime, bladeburnerCooldown, lastSleeveHp, lastSleeveShock; // State by sleeve
let numSleeves, ownedSourceFiles, playerInGang, playerInBladeburner, bladeburnerCityChaos, bladeburnerContractChances, bladeburnerContractCounts, followPlayerSleeve;
let options, worldDaemonPriority=false;
let trainingReserve = 0;
let reputationTargets = [], reputationAssignments = {}, nextRepRefresh = 0;
let bladeburnerSupportSleeves = new Set();

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    const invalid=sleeveOptionsError(runOptions);if(invalid)return ns.tprint('Sleeves: '+invalid);
    if(runOptions.crime){const name=String(runOptions.crime).replaceAll('_',' ').toLowerCase();const crime=Object.values(ns.enums.CrimeType).find(c=>c.toLowerCase()===name);if(!crime)return ns.tprint('Sleeves: unknown crime '+runOptions.crime);runOptions.crime=crime;}
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ['getServerMoneyAvailable']);
    // Ensure the global state is reset (e.g. after entering a new bitnode)
    task = [], lastStatusUpdateTime = [], lastPurchaseTime = [], lastPurchaseStatusUpdate = [], availableAugs = [],
        cacheExpiry = [], shockChance = [], lastRerollTime = [], bladeburnerCooldown = [], lastSleeveHp = [], lastSleeveShock = [];
    workByFaction = {}, cachedCrimeStats = {};
    reputationTargets = [], reputationAssignments = {}, nextRepRefresh = 0;
    bladeburnerSupportSleeves = new Set();
    playerInGang = playerInBladeburner = false;worldDaemonPriority=false;
    // Ensure we have access to sleeves
    ownedSourceFiles = await getActiveSourceFiles(ns);
    if (!(10 in ownedSourceFiles))
        return ns.tprint("WARNING: You cannot run sleeve.js until you do BN10.");
    // Start the main loop
    while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
        if(maintenanceRequested(ns)){await ns.write('tasks/sleeve-status.json',JSON.stringify({at:Date.now(),pid:ns.pid,state:'waiting',reason:'Automation maintenance'}),'w');await ns.sleep(interval);continue;}
        try { await mainLoop(ns); }
        catch (err) {
            await ns.write('tasks/sleeve-status.json',JSON.stringify({at:Date.now(),pid:ns.pid,state:'recovering',error:String(err)}),'w');
            log(ns, `WARNING: sleeve.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(interval);
    }
}

/** @param {NS} ns
 * Purchases augmentations for sleeves */
async function manageSleeveAugs(ns, i, budget, reserve) {
    budget=sleeveAugSpendingBudget(ns,budget);
    // Retrieve and cache the set of available sleeve augs (cached temporarily, but not forever, in case rules around this change)
    if (availableAugs[i] == null || Date.now() > cacheExpiry[i]) {
        cacheExpiry[i] = Date.now() + 60000;
        availableAugs[i] = (await getNsDataThroughFile(ns, `ns.sleeve.getSleevePurchasableAugs(ns.args[0])`,  // list of { name, cost }
            null, [i])).sort((a, b) => a.cost - b.cost);
    }
    if (availableAugs[i].length == 0) return 0;

    const cooldownLeft = Math.max(0, options['buy-cooldown'] - (Date.now() - (lastPurchaseTime[i] || 0)));
    const [batchCount, batchCost] = availableAugs[i].reduce(([n, c], aug) => c + aug.cost <= budget ? [n + 1, c + aug.cost] : [n, c], [0, 0]);
    const purchaseUpdate = `sleeve ${i} can afford ${batchCount.toFixed(0).padStart(2)}/${availableAugs[i].length.toFixed(0).padEnd(2)} remaining augs ` +
        `(cost ${formatMoney(batchCost)} of ${formatMoney(availableAugs[i].reduce((t, aug) => t + aug.cost, 0))}).`;
    if (lastPurchaseStatusUpdate[i] != purchaseUpdate)
        log(ns, `INFO: With budget ${formatMoney(budget)}, ${(lastPurchaseStatusUpdate[i] = purchaseUpdate)} ` +
            `(Min batch size: ${options['min-aug-batch']}, Cooldown: ${formatDuration(cooldownLeft)})`);
    if (cooldownLeft == 0 && batchCount > 0 && ((batchCount >= availableAugs[i].length - 1) || batchCount >= options['min-aug-batch'])) { // Don't require the last aug it's so much more expensive
        let strAction = `Purchase ${batchCount}/${availableAugs[i].length} augmentations for sleeve ${i} at total cost of ${formatMoney(batchCost)}`;
        const toPurchase = availableAugs[i].slice(0, batchCount);
        const receipt = await getNsDataThroughFile(ns,
            `(() => { const claimSpending=${claimSpending.toString()}; return (${purchaseSleeveAugBatch.toString()})(ns,ns.args[0],JSON.parse(ns.args[1]),ns.args[2],ns.args[3],claimSpending,()=>(${sleeveControlAllowed.toString()})(ns,ns.args[4],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve"),true); })()`,
            '/Temp/sleeve-purchase.txt', [i, JSON.stringify(toPurchase.map(a => a.name)), budget, reserve,ns.pid]);
        availableAugs[i] = null;
        if (receipt.purchased.length) {
            log(ns, `SUCCESS: Sleeve ${i} purchased ${receipt.purchased.length} augmentations for ${formatMoney(receipt.spent)}.`, true, 'success');
            [lastSleeveHp[i], lastSleeveShock[i]] = [undefined, undefined]; // Sleeve stats are reset on installation of augs, so forget saved health info
        } else {
            const reasons=[...new Set((receipt.skipped||[]).map(s=>s.reason))].join('; ')||'no augmentation purchased';
            const rejected=(receipt.skipped||[]).some(s=>s.reason==='native purchase rejected');
            log(ns, `${rejected?'WARNING: Native rejection':'INFO: Deferred'} sleeve ${i} augmentation purchase: ${reasons}.`,false,rejected?'warning':undefined);
        }
        if(receipt.purchased.length)lastPurchaseTime[i] = Date.now();
        return receipt.spent;
    }
    return 0;
}

/** @param {NS} ns
 * @returns {Promise<Player>} the result of ns.getPlayer() */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 * @returns {Promise<Task>} */
async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {};
}

/** @param {NS} ns
 * @param {number} numSleeves
 * @returns {Promise<SleevePerson[]>} */
async function getAllSleeves(ns, numSleeves) {
    return await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`,
        `/Temp/sleeve-getSleeve-all.txt`, [...Array(numSleeves).keys()]);
}

/** @param {NS} ns
 * Main loop that gathers data, checks on all sleeves, and manages them. */
async function mainLoop(ns) {
    // Update info
    numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
    const playerInfo = await getPlayerInfo(ns);
    const reset=await getNsDataThroughFile(ns,'ns.getResetInfo()');
    const previousWdPriority=worldDaemonPriority;
    worldDaemonPriority=readNodeRoutePlan(ns)?.selected==='hacking';
    if(previousWdPriority!==worldDaemonPriority)nextRepRefresh=0;
    // If we have not yet detected that we are in bladeburner, do that now (unless disabled)
    if (!options['disable-bladeburner'] && ((6 in ownedSourceFiles)||(7 in ownedSourceFiles)||[6,7].includes(reset.currentNode)) && !playerInBladeburner)
        try { playerInBladeburner = await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()'); } catch { }
    let playerWorkInfo = {};
    if (4 in ownedSourceFiles) try { playerWorkInfo = await getCurrentWorkInfo(ns); } catch { }
    if (!playerInGang) playerInGang = !(2 in ownedSourceFiles) ? false : await getNsDataThroughFile(ns, 'ns.gang.inGang()');
    const reserveState = sleeveReserves(options, ns.read('reserve.txt'));
    const reserve = reserveState.reserve;
    trainingReserve = reserveState.trainingReserve;
    let budget = Math.max(0, playerInfo.money - reserve) * Math.max(0,Math.min(1,Number(options['aug-budget'])||0));
    // Estimate the cost of sleeves training over the next time interval to see if (ignoring income) we would drop below our reserve.
    const costByNextLoop = interval / 1000 * numSleeves * 12000;
    // Get time in current bitnode (to cap how long we'll train sleeves)
    const timeInBitnode = Date.now() - reset.lastNodeReset;
    let canTrain = !reset.bitNodeOptions?.disableSleeveExpAndAugmentation && !options['disable-training'] &&
        // To avoid training forever when mults are crippling, stop training if we've been in the bitnode a certain amount of time
        (options['training-cap-seconds'] * 1000 > timeInBitnode) &&
        // Don't train if we have no money (unless player has given permission to train into debt)
        (playerInfo.money - costByNextLoop - numSleeves * 200000) > trainingReserve;
    const augmentationReserve = canTrain ? trainingReserve + costByNextLoop : reserve;
    budget = Math.max(0, playerInfo.money - augmentationReserve) * Math.max(0,Math.min(1,Number(options['aug-budget'])||0));
    // If any sleeve is training at the gym, see if we can purchase a gym upgrade to help them
    if ((9 in ownedSourceFiles) && canTrain && task.some(t => t?.startsWith("train")) && !options['disable-spending-hashes-for-gym-upgrades'])
        if (await getNsDataThroughFile(ns, `(${sleeveControlAllowed.toString()})(ns,ns.args[0],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&(${achievementActionAllowed.toString()})(ns,"hashSpending") && ns.hacknet.spendHashes("Improve Gym Training")`, '/Temp/spend-hashes-on-gym.txt',[ns.pid]))
            log(ns, `SUCCESS: Bought "Improve Gym Training" to speed up Sleeve training.`, false, 'success');
    if ((9 in ownedSourceFiles) && canTrain && task.some(t => t?.startsWith("study")) && !options['disable-spending-hashes-for-study-upgrades'])
        if (await getNsDataThroughFile(ns, `(${sleeveControlAllowed.toString()})(ns,ns.args[0],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&(${achievementActionAllowed.toString()})(ns,"hashSpending") && ns.hacknet.spendHashes("Improve Studying")`, '/Temp/spend-hashes-on-study.txt',[ns.pid]))
            log(ns, `SUCCESS: Bought "Improve Studying" to speed up Sleeve studying.`, false, 'success');
    if (playerInBladeburner && ((6 in ownedSourceFiles)||(7 in ownedSourceFiles)||[6,7].includes(reset.currentNode))) {
        const bladeburnerCity = await getNsDataThroughFile(ns, `ns.bladeburner.getCity()`);
        bladeburnerCityChaos = await getNsDataThroughFile(ns, `ns.bladeburner.getCityChaos(ns.args[0])`, null, [bladeburnerCity]);
        try {bladeburnerContractChances = await getNsDataThroughFile(ns,
            'Object.fromEntries(Array.from({length:ns.args[0]},(_,i)=>[i,Object.fromEntries(ns.args.slice(1).map(c=>[c,ns.bladeburner.getActionEstimatedSuccessChance("Contracts",c,i)[0]]))]))',
            '/Temp/sleeve-bladeburner-success-chances.txt',[numSleeves,...sleeveBbContractNames]);}
        catch {bladeburnerContractChances={};} // Missing sleeve probability data never authorizes a contract.
        bladeburnerContractCounts = await getNsDataThroughFile(ns,
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionCountRemaining("Contracts", c)]))',
            '/Temp/sleeve-bladeburner-contract-counts.txt', sleeveBbContractNames);
    } else
        bladeburnerCityChaos = 0, bladeburnerContractChances = {}, bladeburnerContractCounts = {};

    // Update all sleeve information and loop over all sleeves to do some individual checks and task assignments
    let sleeveInfo = await getAllSleeves(ns, numSleeves);

    // If not disabled, set the "follow player" sleeve to be the first sleeve with 0 shock
    followPlayerSleeve = options['disable-follow-player'] ? -1 : undefined;
    for (let i = 0; i < numSleeves; i++) // Hack below: Prioritize sleeves doing bladeburner contracts, don't have them follow player
        if (sleeveInfo[i].shock == 0 && sleeveInfo[i].sync >= 100 && (i === 0 || i > 3 || !playerInBladeburner || worldDaemonPriority))
            followPlayerSleeve ??= i; // Skips assignment if previously assigned
    followPlayerSleeve ??= 0; // If all have shock, use the first sleeve
    if ((4 in ownedSourceFiles) && !options['disable-auto-reputation'] && Date.now() >= nextRepRefresh) {
        try { reputationTargets = await getNsDataThroughFile(ns,
            '(() => { const p=ns.getPlayer(), owned=new Set(ns.singularity.getOwnedAugmentations(true)), targets=[]; let gang=null; try{gang=ns.gang.inGang()?ns.gang.getGangInformation().faction:null;}catch{} for(const name of p.factions){if(name===gang)continue; const types=ns.singularity.getFactionWorkTypes(name); if(!types.length)continue; const augs=ns.singularity.getAugmentationsFromFaction(name).filter(a=>a!=="NeuroFlux Governor"&&!owned.has(a)); const rep=ns.singularity.getFactionRep(name), needed=Math.max(0,...augs.map(a=>ns.singularity.getAugmentationRepReq(a))); if(needed>rep)targets.push({type:"FACTION",name,workTypes:types,deficit:needed-rep,priority:augs.includes("The Red Pill")?0:1});} for(const name of Object.keys(p.jobs)){const rep=ns.singularity.getCompanyRep(name);if(rep<400000)targets.push({type:"COMPANY",name,deficit:400000-rep,priority:2});} return targets.sort((a,b)=>a.priority-b.priority||a.deficit-b.deficit); })()', '/Temp/sleeve-reputation-targets.txt'); } catch { reputationTargets = []; }
        nextRepRefresh = Date.now() + 60000;
    }
    const actualTasks = await getNsDataThroughFile(ns, 'ns.args.map(i=>ns.sleeve.getTask(i))', '/Temp/sleeve-tasks.txt', [...Array(numSleeves).keys()]);
    let teamPlan=null;
    if(!worldDaemonPriority&&playerInBladeburner&&!options['disable-bladeburner']&&!options['disable-bladeburner-team-support']&&!options.crime)
        try{const saved=JSON.parse(ns.read('tasks/bladeburner-team.json'));if(saved.nodeReset===reset.lastNodeReset&&saved.at<=Date.now()+5000&&Date.now()-saved.at<30000&&ns.ps('home').some(p=>p.pid===saved.pid&&p.filename.replace(/^\//,'')==='bladeburner.js'))teamPlan=saved;}catch{}
    bladeburnerSupportSleeves=new Set(sleeveBladeburnerSupport(sleeveInfo,actualTasks,teamPlan));

    let followTarget = null;
    if ((4 in ownedSourceFiles) && followPlayerSleeve >= 0 && ['FACTION','COMPANY'].includes(playerWorkInfo.type)) {
        if (playerWorkInfo.type === 'COMPANY') followTarget = {type:'COMPANY',name:playerWorkInfo.companyName};
        else try {
            const types = await getNsDataThroughFile(ns, '(() => { const f=ns.args[0]; try { if(ns.gang.inGang()&&ns.gang.getGangInformation().faction===f)return []; }catch{} return ns.singularity.getFactionWorkTypes(f); })()', '/Temp/sleeve-follow-types.txt', [playerWorkInfo.factionName]);
            if (types.length) followTarget = {type:'FACTION',name:playerWorkInfo.factionName,workTypes:types};
        } catch { }
    }
    reputationAssignments = sleeveRepAssignments(sleeveInfo.map((s,i)=>bladeburnerSupportSleeves.has(i)?{...s,shock:100}:s), options['disable-auto-reputation'] ? [] : reputationTargets,
        playerWorkInfo, followPlayerSleeve, playerInBladeburner&&!worldDaemonPriority, actualTasks, followTarget, worldDaemonPriority);
    if ((4 in ownedSourceFiles) && !Object.keys(cachedCrimeStats).length) {
        try { cachedCrimeStats = await getNsDataThroughFile(ns, 'Object.fromEntries(Object.values(ns.enums.CrimeType).map(name=>[name,ns.singularity.getCrimeStats(name)]))', '/Temp/sleeve-crime-stats.txt'); } catch { }
    }

    for (let i = 0; i < numSleeves; i++) {
        if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns))return;
        let sleeve = sleeveInfo[i]; // For convenience, merge all sleeve stats/info into one object
        // Manage sleeve augmentations (if available)
        if (sleeve.shock == 0 && !reset.bitNodeOptions?.disableSleeveExpAndAugmentation) // No augs are available augs until shock is 0
        {
            const spent = await manageSleeveAugs(ns, i, budget, augmentationReserve);
            budget = Math.max(0, budget - spent);
            if (spent > 0) sleeveInfo[i] = sleeve = await getNsDataThroughFile(ns, 'ns.sleeve.getSleeve(ns.args[0])', null, [i]);
        }
        // Augmentations and other managers can change cash after the initial snapshot.
        const freshReserves = sleeveReserves(options, ns.read('reserve.txt'));
        trainingReserve = freshReserves.trainingReserve;
        const trainThisSleeve = canTrain && ns.getPlayer().money - costByNextLoop - numSleeves * 200000 > trainingReserve;

        // Decide what we think the sleeve should be doing for the next little while
        let [designatedTask, command, args, statusUpdate] =
            await pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, trainThisSleeve);

        // After picking sleeve tasks, take a note of the sleeve's health at the end of the prior loop so we can detect failures
        [lastSleeveHp[i], lastSleeveShock[i]] = [sleeve.hp.current, sleeve.shock];

        // Set the sleeve's new task if it's not the same as what they're already doing.
        let assignSuccess = undefined;
        if (task[i] != designatedTask || !sleeveTaskMatches(actualTasks[i], command, args))
            assignSuccess = await setSleeveTask(ns, i, designatedTask, command, args);

        // For certain tasks, log a periodic status update.
        if (statusUpdate && (assignSuccess === true || (
            assignSuccess === undefined && (Date.now() - (lastStatusUpdateTime[i] ?? 0)) > statusUpdateInterval))) {
            log(ns, `INFO: Sleeve ${i} is ${assignSuccess === undefined ? '(still) ' : ''}${statusUpdate} `);
            lastStatusUpdateTime[i] = Date.now();
        }
    }
    const currentTasks = await getNsDataThroughFile(ns,'ns.args.map(i=>ns.sleeve.getTask(i))','/Temp/sleeve-tasks-final.txt',[...Array(numSleeves).keys()]);
    await ns.write('tasks/sleeve-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,state:'managing',route:worldDaemonPriority?'hacking':'normal',bladeburnerSupport:[...bladeburnerSupportSleeves],sleeves:sleeveInfo.map((s,i)=>({index:i,shock:s.shock,sync:s.sync,memory:s.memory,task:task[i]||'waiting',actualTask:currentTasks[i]})),remainingAugBudget:budget,sharedAugBudgetRemaining:sleeveAugSpendingBudget(ns,budget)}), 'w');
}

/** Picks the best task for a sleeve, and returns the information to assign and give status updates for that task.
 * @param {NS} ns
 * @param {Player} playerInfo
 * @param {{ type: "COMPANY"|"FACTION"|"CLASS"|"CRIME", cyclesWorked: number, crimeType: string, classType: string, location: string, companyName: string, factionName: string, factionWorkType: string }} playerWorkInfo
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} a 4-tuple of task name, command, args, and status message */
async function pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain) {
    // Initialize sleeve dicts on first loop
    if (lastSleeveHp[i] === undefined) lastSleeveHp[i] = sleeve.hp.current;
    if (lastSleeveShock[i] === undefined) lastSleeveShock[i] = sleeve.shock;
    // Must synchronize first iif you haven't maxed memory on every sleeve
    if (sleeve.sync < 100)
        return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `syncing... ${sleeve.sync.toFixed(2)}%`];
    // Opt to do shock recovery if above the --min-shock-recovery threshold
    if (sleeve.shock > options['min-shock-recovery'])
        return shockRecoveryTask(sleeve, i, `shock is above ${options['min-shock-recovery'].toFixed(0)}% (--min-shock-recovery)`);
    // To time-balance between being useful and recovering from shock more quickly - sleeves have a random chance to be put
    // on shock recovery. To avoid frequently interrupting tasks that take a while to complete, only re-roll every so often.
    if (sleeve.shock > 0 && options['shock-recovery'] > 0) {
        if (Date.now() - (lastRerollTime[i] || 0) >= rerollTime) {
            shockChance[i] = Math.random();
            lastRerollTime[i] = Date.now();
        }
        if (shockChance[i] < options['shock-recovery'])
            return shockRecoveryTask(sleeve, i, `there is a ${(options['shock-recovery'] * 100).toFixed(1)}% chance (--shock-recovery) of picking this task every minute until fully recovered.`);
    }
    if (options.crime) return await crimeTask(ns, options.crime, i, sleeve, 'explicit crime override');
    if(bladeburnerSupportSleeves.has(i))return ['Bladeburner Support main sleeve','ns.sleeve.setToBladeburnerAction(ns.args[0],ns.args[1],ns.args[2])',[i,'Support main sleeve',''],'supporting the pending Black Op team requirement'];

    // Train if our sleeve's physical stats aren't where we want them
    if (canTrain) {
        const univClasses = {
            "hacking": ns.enums.UniversityClassType.algorithms,
            "charisma": ns.enums.UniversityClassType.leadership
        };
        let untrainedStats = trainStats.filter(stat => sleeve.skills[stat] < options[`train-to-${stat}`]);
        let untrainedSmarts = trainSmarts.filter(smart => sleeve.skills[smart] < options[`study-to-${smart}`]);

        // prioritize physical training
        if (untrainedStats.length > 0) {
            if (sleeve.city != ns.enums.CityName.Sector12) {
                log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Sector-12 so that they can study at Powerhouse Gym.`);
                const traveled = await getNsDataThroughFile(ns, `(${sleeveControlAllowed.toString()})(ns,ns.args[3],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&ns.getPlayer().money>=200000+Math.max(0,Number(ns.read("reserve.txt"))||0,Number(ns.args[2])||0) ? ns.sleeve.travel(ns.args[0],ns.args[1]) : false`, null, [i,ns.enums.CityName.Sector12,trainingReserve,ns.pid]);
                if (!traveled) return await crimeTask(ns,'Mug',i,sleeve,'training travel is unaffordable');
            }
            var trainStat = untrainedStats.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedStats[0]);
            var gym = ns.enums.LocationName.Sector12PowerhouseGym;
            return [
                `train ${trainStat} (${gym})`,
                `ns.sleeve.setToGymWorkout(ns.args[0], ns.args[1], ns.args[2])`,
                [i, gym, trainStat.slice(0, 3)], // Gym expects the short form stat names ('str', 'def', 'dex', 'agi')
                `training ${trainStat}... ${sleeve.skills[trainStat]}/${(options[`train-to-${trainStat}`])}`
            ];
            // if we're tough enough, flip over to studying to improve the mental stats
        } else if (untrainedSmarts.length > 0) {
            if (sleeve.city != ns.enums.CityName.Volhaven) {
                log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Volhaven so that they can study at ZB Institute.`);
                const traveled = await getNsDataThroughFile(ns, `(${sleeveControlAllowed.toString()})(ns,ns.args[3],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&ns.getPlayer().money>=200000+Math.max(0,Number(ns.read("reserve.txt"))||0,Number(ns.args[2])||0) ? ns.sleeve.travel(ns.args[0],ns.args[1]) : false`, null, [i,ns.enums.CityName.Volhaven,trainingReserve,ns.pid]);
                if (!traveled) return await crimeTask(ns,'Mug',i,sleeve,'study travel is unaffordable');
            }
            var trainSmart = untrainedSmarts.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedSmarts[0]);
            var univ = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
            var course = univClasses[trainSmart];
            return [
                `study ${trainSmart} (${univ})`,
                `ns.sleeve.setToUniversityCourse(ns.args[0], ns.args[1], ns.args[2])`,
                [i, univ, course],
                `studying ${trainSmart}... ${sleeve.skills[trainSmart]}/${(options[`study-to-${trainSmart}`])}`
            ];
        }
    }
    // If player is currently working for faction or company rep, a sleeve can help him out (Note: Only one sleeve can work for a faction)
    if (i == followPlayerSleeve && playerWorkInfo.type == "FACTION" && reputationAssignments[i]?.name === playerWorkInfo.factionName) {
        const faction = playerWorkInfo.factionName;
        const work = reputationAssignments[i]?.workType || works[workByFaction[faction] || 0];
        return [
            `work for faction '${faction}' (${work})`,
            `ns.sleeve.setToFactionWork(ns.args[0], ns.args[1], ns.args[2])`,
            [i, faction, work],
            `helping earn rep with faction ${faction} by doing ${work} work.`
        ];
    } // Same as above if player is currently working for a megacorp
    if (i == followPlayerSleeve && playerWorkInfo.type == "COMPANY" && reputationAssignments[i]?.name === playerWorkInfo.companyName) {
        const companyName = playerWorkInfo.companyName;
        return [
            `work for company '${companyName}'`,
            `ns.sleeve.setToCompanyWork(ns.args[0], ns.args[1])`,
            [i, companyName],
            `helping earn rep with company ${companyName}.`
        ];
    }
    // If gangs are available, prioritize homicide until we've got the requisite -54K karma to unlock them
    if (!playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000) {
        // Failed sleeve crimes yield no karma. Rank expected karma per second.
        if (!(4 in ownedSourceFiles)) {
            await calculateCrimeChance(ns, sleeve, 'Homicide');
            await calculateCrimeChance(ns, sleeve, 'Mug');
        }
        return await crimeTask(ns, bestSleeveCrime(sleeve, cachedCrimeStats, 'karma'), i, sleeve, 'we want gang karma');
    }
    const rep = reputationAssignments[i];
    if (rep) return rep.type === 'FACTION' ?
        [`work for faction '${rep.name}' (${rep.workType})`, 'ns.sleeve.setToFactionWork(ns.args[0],ns.args[1],ns.args[2])', [i,rep.name,rep.workType], `earning useful reputation with ${rep.name}`] :
        [`work for company '${rep.name}'`, 'ns.sleeve.setToCompanyWork(ns.args[0],ns.args[1])', [i,rep.name], `earning company reputation with ${rep.name}`];
    // If the player is in bladeburner, and has already unlocked gangs with Karma, generate contracts and operations
    if (playerInBladeburner && !worldDaemonPriority) {
        // Hack: Without paying much attention to what's happening in bladeburner, pre-assign a variety of tasks by sleeve index
        const bbTasks = [
            // Note: Sleeve 0 might still be used for faction work (unless --disable-follow-player is set), so don't assign them a 'unique' task
            /*0*/options['enable-bladeburner-team-building'] ? ["Support main sleeve"] : ["Infiltrate Synthoids"],
            // Note: Each contract type can only be performed by one sleeve at a time (similar to working for factions)
            /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
            // Other bladeburner work can be duplicated, but tackling a variety is probably useful. Overrides occur below
            /*4*/["Infiltrate Synthoids"], /*5*/["Diplomacy"], /*6*/["Field Analysis"],
            /*7*/options['enable-bladeburner-team-building'] ? ["Recruitment"] : ["Infiltrate Synthoids"]
        ];
        let [action, contractName] = bbTasks[i] || ["Infiltrate Synthoids"];
        if (contractName && !options['enable-bladeburner-contracts']) [action,contractName]=['Infiltrate Synthoids',undefined];
        const contractChance = contractName ? (bladeburnerContractChances[i]?.[contractName] ?? 0) : 1;
        const contractCount = contractName ? (bladeburnerContractCounts[contractName] ?? 0) : Infinity;
        const onCooldown = () => Date.now() <= bladeburnerCooldown[i]; // Function to check if we're on cooldown
        // Detect if the sleeve recently failed the task. If so, put them on a "cooldown" before trying again
        if (sleeve.hp.current < lastSleeveHp[i] || sleeve.shock > lastSleeveShock[i]) {
            bladeburnerCooldown[i] = Date.now() + options['failed-bladeburner-contract-cooldown'];
            log(ns, `Sleeve ${i} appears to have recently failed its designated bladeburner task '${action} - ${contractName}' ` +
                `(HP ${lastSleeveHp[i].toFixed(1)} -> ${sleeve.hp.current.toFixed(1)}, ` +
                `Shock: ${lastSleeveShock[i].toFixed(2)} -> ${sleeve.shock.toFixed(2)}). ` +
                `Will try again in ${formatDuration(options['failed-bladeburner-contract-cooldown'])}`);
        } // If the contract success chance appears too low, or there are insufficient contracts remaining, smaller cooldown
        else if (!onCooldown() && (contractChance < minBbProbability || contractCount < minBbContracts)) {
            bladeburnerCooldown[i] = Date.now() + waitForContractCooldown;
            log(ns, `Delaying sleeve ${i} designated bladeburner task '${action} - ${contractName}' - ` +
                (contractCount < minBbContracts ? `Insufficient contract count (${contractCount} < ${minBbContracts})` :
                    `Sleeve chance is too low (${(contractChance * 100).toFixed(2)}% < ${(minBbProbability * 100)}%). `) +
                `Will try again in ${formatDuration(waitForContractCooldown)}`);
        }
        // As current city chaos gets progressively bad, assign more and more sleeves to Diplomacy to help get it under control
        if (bladeburnerCityChaos > (10 - i) * 10) // Later sleeves are first to get assigned, sleeve 0 is last at 100 chaos.
            [action, contractName] = ["Diplomacy"];
        // If the sleeve is on cooldown ,do not perform their designated bladeburner task
        else if (onCooldown()) { // When on cooldown from a failed task, recover shock if applicable, or else add contracts
            if (sleeve.shock > 0) return shockRecoveryTask(sleeve, i, `bladeburner task is on cooldown`);
            [action, contractName] = ["Infiltrate Synthoids"]; // Fall-back to something long-term useful
        }
        return [`Bladeburner ${action} ${contractName || ''}`.trimEnd(),
        /*   */ `ns.sleeve.setToBladeburnerAction(ns.args[0], ns.args[1], ns.args[2])`, [i, action, contractName ?? ''],
        /*   */ `doing ${action}${contractName ? ` - ${contractName}` : ''} in Bladeburner.`];
    }
    // If there's nothing more productive to do (above) and there's still shock, prioritize recovery
    if (sleeve.shock > 0)
        return shockRecoveryTask(sleeve, i, `there appears to be nothing better to do`);
    // Earn cash when no useful reputation target remains; explicit crime overrides stay authoritative.
    var crime = options.crime || (4 in ownedSourceFiles ? bestSleeveCrime(sleeve,cachedCrimeStats) : chooseSleeveCrime(null, await calculateCrimeChance(ns, sleeve, 'Homicide'), options['homicide-chance-threshold']));
    return await crimeTask(ns, crime, i, sleeve, `there appears to be nothing better to do`);
}

/** Helper to prepare the shock recovery task
 * @param {SleevePerson} sleeve */
function shockRecoveryTask(sleeve, i, reason) {
    return [`recover from shock`, `ns.sleeve.setToShockRecovery(ns.args[0])`, [i],
    /*   */ `recovering from shock (${sleeve.shock.toFixed(2)}%) because ${reason}...`];
}

/** Helper to prepare the crime task
 * @param {NS} ns
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} a 4-tuple of task name, command, args, and status message */
async function crimeTask(ns, crime, i, sleeve, reason) {
    const successChance = await calculateCrimeChance(ns, sleeve, crime);
    return [`commit ${crime}`, `ns.sleeve.setToCommitCrime(ns.args[0], ns.args[1])`, [i, crime],
    /*   */ `committing ${crime} with chance ${(successChance * 100).toFixed(2)}% because ${reason}` +
    /*   */ (options.crime || crime == "Homicide" ? '' : // If auto-criming, user may be curious how close we are to switching to homicide
    /*   */     ` (Note: Homicide chance would be ${((await calculateCrimeChance(ns, sleeve, "Homicide")) * 100).toFixed(2)}%)`)];
}


/** Sets a sleeve to its designated task, with some extra error handling logic for working for factions.
 * @param {NS} ns
 * @param {number} i - Sleeve number
 * @param {string} designatedTask - string describing the designated task
 * @param {string} command - dynamic command to initiate this work
 * @param {any[]} args - arguments consumed by the dynamic command
 * */
async function setSleeveTask(ns, i, designatedTask, command, args) {
    let strAction = `Set sleeve ${i} to ${designatedTask}`;
    if (/setToGymWorkout|setToUniversityCourse/.test(command))
        command = `ns.getPlayer().money>Math.max(0,Number(ns.read("reserve.txt"))||0,${trainingReserve})+${12000*numSleeves} ? (${command}) : false`;
    const parentIndex=args.length;
    command = `(${sleeveControlAllowed.toString()})(ns,ns.args[${parentIndex}],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve") ? (${command}) : false`;
    try { // Assigning a task can throw an error rather than simply returning false. We must suppress this
        if (await getNsDataThroughFile(ns, command, '/Temp/sleeve-set-task.txt', [...args,ns.pid])) {
            task[i] = designatedTask;
            log(ns, `SUCCESS: ${strAction}`);
            return true;
        }
    } catch { }
    // If assigning the task failed...
    lastRerollTime[i] = 0;
    // If working for a faction, it's possible he current work isn't supported, so try the next one.
    if (designatedTask.startsWith('work for faction')) {
        const faction = args[1]; // Hack: Not obvious, but the second argument will be the faction name in this case.
        let nextWorkIndex = (workByFaction[faction] || 0) + 1;
        if (nextWorkIndex >= works.length) {
            log(ns, `WARN: Failed to ${strAction}. None of the ${works.length} work types appear to be supported. Will loop back and try again.`, true, 'warning');
            nextWorkIndex = 0;
        } else
            log(ns, `INFO: Failed to ${strAction} - work type may not be supported. Trying the next work type (${works[nextWorkIndex]})`);
        workByFaction[faction] = nextWorkIndex;
    } else if (designatedTask.startsWith('Bladeburner')) { // Bladeburner action may be out of operations
        bladeburnerCooldown[i] = Date.now() + waitForContractCooldown;
    } else
        log(ns, `ERROR: Failed to ${strAction}`, true, 'error');
    return false;
}

/** @param {NS} ns
 * @param {SleevePerson} sleeve
 * Calculate the chance a sleeve has of committing homicide successfully. */
async function calculateCrimeChance(ns, sleeve, crimeName) {
    // If not in the cache, retrieve this crime's stats
    const crimeStats = cachedCrimeStats[crimeName] ?? (cachedCrimeStats[crimeName] = (4 in ownedSourceFiles ?
        await getNsDataThroughFile(ns, `ns.singularity.getCrimeStats(ns.args[0])`, null, [crimeName]) :
        // Hack: To support players without SF4, hard-code values as of the current release
        crimeName == "Homicide" ? { time: 3000, karma: 3, money: 45000, difficulty: 1, strength_success_weight: 2, defense_success_weight: 2, dexterity_success_weight: 0.5, agility_success_weight: 0.5 } :
            crimeName == "Mug" ? { time: 4000, karma: 0.25, money: 36000, difficulty: 0.2, strength_success_weight: 1.5, defense_success_weight: 0.5, dexterity_success_weight: 1.5, agility_success_weight: 0.5, } :
                undefined));
    return sleeveCrimeChance(sleeve,crimeStats);
}
