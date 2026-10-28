import {sleeveRepHandoffFile,planSleeveRepHandoff,executeSleeveRepHandoff} from './sleeve-rep-handoff-policy.js';
import {readSupportInvestment} from './bladeburner-support-economics-policy.js';
import {startSleeveCombatGym,committedSleeveGymSeconds} from './bb-stat-development-policy.js';
import {sleeveKarmaTrainingPlan} from './sleeve-karma-training-policy.js';
import {combatXpValue,quoteSleeveCombatGyms,chooseSleeveCombatGym,combatCrimeCompleted} from './combat-growth-policy.js';
import {blackOpMetadata} from './bladeburner-action-data.js';
import {observeSleeveXp,incomingSleeveXp} from './sleeve-xp-policy.js';
import {sampleSleeveReputation,observeSleeveReputation,sleeveWorkOutput,planSleeveWorkAugPurchase} from './sleeve-work-policy.js';
import {hashSpendingDecision,spendHashesWithPolicy} from './hash-spending-policy.js';
import { allocateSleeveAugBudget,sleeveCombatCrime,planSleeveAugPurchase,sleeveAugRecoveryPlan,sleeveCombatWorkers, sleeveRecoveryObservation, sleeveDevelopmentActive } from './sleeve-development-policy.js';
import {readNodeRoutePlan} from './node-route-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { augmentationCashReserve,claimSpending } from './spending-policy.js';
import { chooseSleeveCrime } from './automation-policy.js';
import { isScriptPaused } from './automation-control.js';
import { factionWorkScores,bestFactionWork,sleeveFactionRepScore, sleeveReputationReservations,sleeveReputationTask, sleeveStartupPlan, bestSleeveCrime, sleeveCrimeChance, sleeveRepAssignments, purchaseSleeveAugBatch, sleeveTaskMatches, sleeveReserves, sleeveControlAllowed, sleeveOptionsError, sleeveAugSpendingBudget, sleeveBladeburnerTasks, sleeveBladeburnerSupport } from './sleeve-policy.js';
import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, formatMoney, formatDuration, tryGetBitNodeMultipliers } from './helpers.js'

const argsSchema = [
    ['disable-combat-xp-support', false], // Keep every shocked sleeve recovering even when a Black Op is chance-blocked.
    ['disable-adaptive-startup', false], // Restore strict synchronization/recovery-first behavior.
    ['min-shock-recovery', 0], // Recovery threshold outside adaptive opening milestones; custom values restore strict ordering.
    ['shock-recovery', 0.05], // Set to a number between 0 and 1 to devote that ratio of time to periodic shock recovery (until shock is at 0)
    ['crime', null], // If specified, sleeves will perform only this crime regardless of stats
    ['homicide-chance-threshold', 0.5], // Sleeves on crime will automatically start homicide once their chance of success exceeds this ratio
    ['disable-gang-homicide-priority', false], // By default, sleeves will do homicide to farm Karma until we're in a gang. Set this flag to disable this priority.
    ['aug-budget', 0.1], // Spend up to this much of current cash on augs per tick (Default is high, because these are permanent for the rest of the BN)
    ['disable-adaptive-augmentations', false], // Explicit budget-only purchases, without projected skill-rebuild checks.
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
let combatGymCommitments={};
let combatLevelMultipliers={},crimeExpMultiplier=1,crimeMoneyMultiplier=1,crimeNodeMultiplier=1,repContext={shareBonus:1,sf15Level:0};
let trainingReserve = 0;
let reputationTargets = [], reputationAssignments = {}, nextRepRefresh = 0;
let bladeburnerSupportSleeves = new Set();
let adaptiveBladeburnerTasks={},bladeburnerDevelopmentPlan=null,combatGymQuotes=[],combatGymProgress={},combatGymAt=0,combatGymKey=null;
let startupPlan={stage:'normal',assignments:{},workers:[]};
let sleeveXpObservation=null,sleeveReputationObservation=null;
const recoveryForecastCache=new Map(),recoverySearches=new Map(),recoveryPlanningState={cursor:0};
let recoveryOffers=null,recoveryOffersAt=0,combatCompletionHolds={},sleevePurchasePlans={},sleevePurchaseCheckedAt={};

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
    workByFaction = {}, cachedCrimeStats = {};sleeveXpObservation=null;sleeveReputationObservation=null;
    reputationTargets = [], reputationAssignments = {}, nextRepRefresh = 0;
    bladeburnerSupportSleeves = new Set();
    startupPlan={stage:'normal',assignments:{},workers:[]};
    playerInGang = playerInBladeburner = false;worldDaemonPriority=false;
    // Ensure we have access to sleeves
    ownedSourceFiles = await getActiveSourceFiles(ns);
    const nodeMultipliers=await tryGetBitNodeMultipliers(ns);
    crimeExpMultiplier=Number.isFinite(nodeMultipliers.CrimeExpGain)&&nodeMultipliers.CrimeExpGain>=0?nodeMultipliers.CrimeExpGain:1;
    combatLevelMultipliers=Object.fromEntries(['hacking','strength','defense','dexterity','agility','charisma'].map(stat=>[stat,Number(nodeMultipliers[stat[0].toUpperCase()+stat.slice(1)+'LevelMultiplier']??1)]));
    crimeMoneyMultiplier=Number.isFinite(nodeMultipliers.CrimeMoney)&&nodeMultipliers.CrimeMoney>=0?nodeMultipliers.CrimeMoney:1;
    crimeNodeMultiplier=Number.isFinite(nodeMultipliers.CrimeSuccessRate)&&nodeMultipliers.CrimeSuccessRate>=0?nodeMultipliers.CrimeSuccessRate:1;
    repContext={shareBonus:1,sf15Level:Number(ownedSourceFiles[15])||0};
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
async function quoteSleeveAugs(ns, i, budget, reserve, sleeve, actualTask) {
    const critical=worldDaemonPriority&&reputationAssignments[i]?.priority===0?reputationAssignments[i]:null;
    if(!options['disable-adaptive-augmentations']&&critical&&(actualTask?.type!==critical.type||(actualTask.factionName||actualTask.companyName)!==critical.name))return null;
    budget=sleeveAugSpendingBudget(ns,Math.min(budget,Math.max(0,ns.getPlayer().money-Math.max(reserve,augmentationCashReserve(ns)))));
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
        if(!options['disable-adaptive-augmentations']&&Date.now()-(sleevePurchaseCheckedAt[i]||0)<30000)return 0;
        let offers=availableAugs[i];
        if(!options['disable-adaptive-augmentations']){
            try{const stats=await getNsDataThroughFile(ns,'Object.fromEntries(ns.args.map(name=>{try{return [name,ns.singularity.getAugmentationStats(name)];}catch{return [name,null];}}))','/Temp/sleeve-purchase-stats.txt',offers.map(a=>a.name));offers=offers.map(a=>({...a,stats:stats[a.name]}));}catch{offers=offers.map(a=>({...a,stats:null}));}
        }
        const route=readNodeRoutePlan(ns),crimeChoices=options.crime?{[options.crime]:cachedCrimeStats[options.crime]}:cachedCrimeStats;
        const objective=actualTask?.type==='CRIME'?(startupPlan.assignments[i]==='karma'?'karma':route?.selected==='bladeburner'?'xp':'money'):
            ['RECOVERY','SYNCHRO'].includes(actualTask?.type)||!actualTask?route?.selected==='bladeburner'?'xp':'money':'unpriced';
        const xpKeys=['hacking','strength','defense','dexterity','agility','charisma'];
        const crime=actualTask?.type==='CRIME'?cachedCrimeStats[actualTask.crimeType]:null;
        const burstFactor=crime?.time>0?Math.max(1,...(sleeveXpObservation?.samples||[]).filter(s=>s.seconds>0).map(s=>(Math.ceil(s.seconds/(crime.time/1000))+1)*(crime.time/1000)/s.seconds)):1;
        const ownXp=crime?.time>0?Object.fromEntries(xpKeys.map(k=>[k,Math.max(0,crime[k+'_exp']||0)*(sleeve.mults[k+'_exp']??1)*crimeExpMultiplier*burstFactor/(crime.time/1000)])):
            !actualTask||['RECOVERY','SYNCHRO'].includes(actualTask.type)?Object.fromEntries(xpKeys.map(k=>[k,0])):null;
        const externalXpPerSecond=incomingSleeveXp(sleeveXpObservation,sleeve,ownXp,ns.getResetInfo(),ns.pid);
        const externalXpSeconds=Math.max(0,Math.min(90,((sleeveXpObservation?.observedAt??0)+90000-Date.now())/1000));
        let plan=planSleeveAugPurchase({sleeve,offers,budget,crimes:crimeChoices,objective,nodeMultiplier:crimeNodeMultiplier,
            context:{crimeExpMultiplier,crimeMoneyMultiplier,levelMultipliers:combatLevelMultipliers,externalXpPerSecond,externalXpSeconds},minBatch:options['min-aug-batch'],manual:options['disable-adaptive-augmentations'],includeAlternatives:true});
        if(objective==='unpriced'&&!options['disable-adaptive-augmentations']){
            try{plan=await getNsDataThroughFile(ns,`(() => { const sleeveWorkOutput=${sleeveWorkOutput.toString()}; const incomingSleeveXp=${incomingSleeveXp.toString()}; const planSleeveAugPurchase=${planSleeveAugPurchase.toString()}; return (${planSleeveWorkAugPurchase.toString()})(ns,ns.args[0],JSON.parse(ns.args[1]),ns.args[2],JSON.parse(ns.args[3]),planSleeveAugPurchase,sleeveWorkOutput,incomingSleeveXp); })()`,
                '/Temp/sleeve-work-purchase-plan.txt',[i,JSON.stringify(offers),budget,JSON.stringify({task:actualTask,ownerPid:ns.pid,xpObservation:sleeveXpObservation,levelMultipliers:combatLevelMultipliers,minBatch:options['min-aug-batch'],includeAlternatives:true})]);}
            catch(error){plan={names:[],cost:0,reason:'Work forecast unavailable; preserving sleeve skills: '+String(error)};}
        }
        sleevePurchasePlans[i]=plan;sleevePurchaseCheckedAt[i]=Date.now();
        if(!plan.names.length){ns.print('Sleeve '+i+' augmentation purchase deferred: '+plan.reason);return 0;}
        return plan;
    }
    return null;
}

/** Commit only a selected quote; native guards recheck prices, shock, cash and controls. */
async function purchaseSleeveAugs(ns,i,budget,reserve,plan) {
    if(!plan?.names?.length)return 0;
    budget=sleeveAugSpendingBudget(ns,Math.min(budget,Math.max(0,ns.getPlayer().money-Math.max(reserve,augmentationCashReserve(ns)))));
        const receipt = await getNsDataThroughFile(ns,
            `(() => { const claimSpending=${claimSpending.toString()}; return (${purchaseSleeveAugBatch.toString()})(ns,ns.args[0],JSON.parse(ns.args[1]),ns.args[2],ns.args[3],claimSpending,()=>(${sleeveControlAllowed.toString()})(ns,ns.args[4],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve"),true,ns.args[5]); })()`,
            '/Temp/sleeve-purchase.txt', [i, JSON.stringify(plan.names), Math.min(budget,plan.cost), reserve,ns.pid,!options['disable-adaptive-augmentations']]);
        availableAugs[i] = null;recoveryOffers=null;
        if (receipt.purchased.length) {
            log(ns, `SUCCESS: Sleeve ${i} purchased ${receipt.purchased.length} augmentations for ${formatMoney(receipt.spent)}.`, false, 'success');
            [lastSleeveHp[i], lastSleeveShock[i]] = [undefined, undefined]; // Sleeve stats are reset on installation of augs, so forget saved health info
        } else {
            const reasons=[...new Set((receipt.skipped||[]).map(s=>s.reason))].join('; ')||'no augmentation purchased';
            const rejected=(receipt.skipped||[]).some(s=>s.reason==='native purchase rejected');
            log(ns, `${rejected?'WARNING: Native rejection':'INFO: Deferred'} sleeve ${i} augmentation purchase: ${reasons}.`,false,rejected?'warning':undefined);
        }
        if(receipt.purchased.length)lastPurchaseTime[i] = Date.now();
        sleevePurchasePlans[i]={...plan,at:Date.now(),state:receipt.purchased.length?'purchased':'deferred',receipt};
        return receipt.spent;
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
    const adaptiveStartup = !options['disable-adaptive-startup'] && !options.crime &&
        options['min-shock-recovery'] === 0 && options['shock-recovery'] === 0.05;
    let casinoPending = !isScriptPaused(ns, 'casino.js');
    try {
        const config = JSON.parse(ns.read('autopilot.js.config.txt'));
        if ((Array.isArray(config) ? Object.fromEntries(config) : config)?.['disable-casino']) casinoPending=false;
    } catch { }
    if(ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='autopilot.js'&&p.args.includes('--disable-casino')))casinoPending=false;
    if(casinoPending)try{casinoPending=(await getNsDataThroughFile(ns,'ns.getMoneySources().sinceInstall.casino','/Temp/sleeve-casino-earned.txt'))<=1e10;}catch{}
    const needsKarma=reset.currentNode!==2&&!!ownedSourceFiles[2]&&!playerInGang&&!options['disable-gang-homicide-priority']&&achievementActionAllowed(ns,'gang')&&ns.heart.break()>-54000;
    const startupUrgent=adaptiveStartup&&(casinoPending&&playerInfo.money<300000||needsKarma);
    if(startupUrgent){canTrain=false;budget=0;}
    const augmentationReserve = canTrain ? trainingReserve + costByNextLoop : reserve;
    budget = startupUrgent ? 0 : Math.max(0, playerInfo.money - augmentationReserve) * Math.max(0,Math.min(1,Number(options['aug-budget'])||0));
    if ((9 in ownedSourceFiles) && canTrain && task.some(t => t?.startsWith("study")) && !options['disable-spending-hashes-for-study-upgrades'])
        if (await getNsDataThroughFile(ns, `(${sleeveControlAllowed.toString()})(ns,ns.args[0],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&(${achievementActionAllowed.toString()})(ns,"hashSpending") && (()=>{const hashSpendingDecision=${hashSpendingDecision.toString()};return (${spendHashesWithPolicy.toString()})(ns,"Improve Studying",undefined,1,{ownerPid:ns.args[0],script:"sleeve.js",trainingSeconds:900},hashSpendingDecision).success;})()`, '/Temp/spend-hashes-on-study.txt',[ns.pid]))
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
        if (sleeveInfo[i].shock == 0 && sleeveInfo[i].sync >= 100 )
            followPlayerSleeve ??= i; // Skips assignment if previously assigned
    followPlayerSleeve ??= 0; // If all have shock, use the first sleeve
    if ((4 in ownedSourceFiles) && !options['disable-auto-reputation'] && Date.now() >= nextRepRefresh) {
        try { reputationTargets = await getNsDataThroughFile(ns,
            '(() => { const p=ns.getPlayer(), owned=new Set(ns.singularity.getOwnedAugmentations(true)), targets=[]; let gang=null; try{gang=ns.gang.inGang()?ns.gang.getGangInformation().faction:null;}catch{} for(const name of p.factions){if(name===gang)continue; const types=ns.singularity.getFactionWorkTypes(name); if(!types.length)continue; const augs=ns.singularity.getAugmentationsFromFaction(name).filter(a=>a!=="NeuroFlux Governor"&&!owned.has(a)); const rep=ns.singularity.getFactionRep(name), needed=Math.max(0,...augs.map(a=>ns.singularity.getAugmentationRepReq(a))); if(needed>rep)targets.push({type:"FACTION",name,workTypes:types,deficit:needed-rep,requiredRep:needed,priority:augs.includes("The Red Pill")?0:1});} for(const name of Object.keys(p.jobs)){const rep=ns.singularity.getCompanyRep(name);if(rep<400000)targets.push({type:"COMPANY",name,deficit:400000-rep,priority:2});} return targets.sort((a,b)=>a.priority-b.priority||a.deficit-b.deficit); })()', '/Temp/sleeve-reputation-targets.txt'); } catch { reputationTargets = []; }
        nextRepRefresh = Date.now() + 60000;
    }
    let actualTasks = await getNsDataThroughFile(ns, 'ns.args.map(i=>ns.sleeve.getTask(i))', '/Temp/sleeve-tasks.txt', [...Array(numSleeves).keys()]);
    sleeveXpObservation=observeSleeveXp(sleeveXpObservation,sleeveInfo,actualTasks,Date.now(),reset,ns.pid);
    await ns.write('tasks/sleeve-xp-observation.json',JSON.stringify(sleeveXpObservation),'w');
    if(!sleeveReputationObservation||Date.now()-sleeveReputationObservation.at>=10000){
        try{
            const auditing=(4 in ownedSourceFiles)&&actualTasks.some(t=>['FACTION','COMPANY'].includes(t?.type));
            const quotes=auditing?await getNsDataThroughFile(ns,`(${sampleSleeveReputation.toString()})(ns)`,'/Temp/sleeve-reputation-audit.txt'):[{index:-1,eligible:false,reason:(4 in ownedSourceFiles)?'no-reputation-work':'singularity-unavailable'}];
            sleeveReputationObservation=observeSleeveReputation(sleeveReputationObservation,quotes,Date.now(),reset,ns.pid);
        }catch{ sleeveReputationObservation={at:Date.now(),results:[{reason:'audit-helper-unavailable'}]}; }
    }
    let teamPlan=null;
    if(!worldDaemonPriority&&playerInBladeburner&&!options['disable-bladeburner']&&!options['disable-bladeburner-team-support']&&!options.crime)
        try{const saved=JSON.parse(ns.read('tasks/bladeburner-team.json'));if(saved.nodeReset===reset.lastNodeReset&&saved.at<=Date.now()+5000&&Date.now()-saved.at<30000&&ns.ps('home').some(p=>p.pid===saved.pid&&p.filename.replace(/^\//,'')==='bladeburner.js'))teamPlan=saved;}catch{}
    bladeburnerSupportSleeves=new Set(sleeveBladeburnerSupport(sleeveInfo,actualTasks,teamPlan));
    adaptiveBladeburnerTasks={};bladeburnerDevelopmentPlan=null;
    if(playerInBladeburner&&!worldDaemonPriority&&!options['disable-bladeburner'])try{
        const saved=JSON.parse(ns.read('tasks/bladeburner-sleeve-plan.json'));
        if(saved.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset&&saved.at<=Date.now()&&Date.now()-saved.at<30000&&ns.ps('home').some(p=>p.pid===saved.pid&&p.filename.replace(/^\//,'')==='bladeburner.js')){
            bladeburnerDevelopmentPlan=readSupportInvestment(ns,saved)||saved;
            adaptiveBladeburnerTasks=sleeveBladeburnerTasks(sleeveInfo,actualTasks,bladeburnerDevelopmentPlan,[...bladeburnerSupportSleeves],!options['disable-combat-xp-support']&&!reset.bitNodeOptions?.disableSleeveExpAndAugmentation);
        }
    }catch{}

    if(bladeburnerDevelopmentPlan?.target&&!options['disable-training']&&!options['disable-combat-xp-support']&&!reset.bitNodeOptions?.disableSleeveExpAndAugmentation&&achievementActionAllowed(ns,'cashSpending')){
        const gymKey=JSON.stringify(sleeveInfo.map(s=>[s.city,s.mults]));
        if(gymKey!==combatGymKey||Date.now()-combatGymAt>=10000)try{combatGymAt=Date.now();combatGymKey=gymKey;combatGymQuotes=await getNsDataThroughFile(ns,`(${quoteSleeveCombatGyms.toString()})(ns,JSON.parse(ns.args[0]),true)`,'/Temp/sleeve-combat-gyms.txt',[JSON.stringify(sleeveInfo)]);}catch{combatGymQuotes=[];}
    }else combatGymQuotes=[];
    const explicitReservations=[];
    if(playerInBladeburner&&!worldDaemonPriority&&!options['disable-bladeburner'])for(let i=0;i<numSleeves;i++)if(!adaptiveBladeburnerTasks[i]){
        if(options['enable-bladeburner-team-building']&&(i===0||i===7))explicitReservations.push(i);
        if(options['enable-bladeburner-contracts']&&i>=1&&i<=3&&Date.now()>(bladeburnerCooldown[i]||0)&&
          (bladeburnerContractChances[i]?.[sleeveBbContractNames[i-1]]??0)>=minBbProbability&&(bladeburnerContractCounts[sleeveBbContractNames[i-1]]??0)>=minBbContracts)explicitReservations.push(i);
    }
    repContext={...repContext,reservedSleeves:sleeveReputationReservations(adaptiveBladeburnerTasks,[...bladeburnerSupportSleeves],explicitReservations)};
    followPlayerSleeve=options['disable-follow-player']?-1:sleeveInfo.findIndex((s,i)=>s.shock===0&&s.sync>=100&&!repContext.reservedSleeves.includes(i));
    let followTarget = null;
    if ((4 in ownedSourceFiles) && followPlayerSleeve >= 0 && ['FACTION','COMPANY'].includes(playerWorkInfo.type)) {
        if (playerWorkInfo.type === 'COMPANY') followTarget = {type:'COMPANY',name:playerWorkInfo.companyName};
        else try {
            const types = await getNsDataThroughFile(ns, '(() => { const f=ns.args[0]; try { if(ns.gang.inGang()&&ns.gang.getGangInformation().faction===f)return []; }catch{} return ns.singularity.getFactionWorkTypes(f); })()', '/Temp/sleeve-follow-types.txt', [playerWorkInfo.factionName]);
            if (types.length) followTarget = {type:'FACTION',name:playerWorkInfo.factionName,workTypes:types};
        } catch { }
    }
    try{const share=await getNsDataThroughFile(ns,'ns.getSharePower()','/Temp/sleeve-share-power.txt');if(Number.isFinite(share)&&share>=1)repContext.shareBonus=share;}catch{repContext.shareBonus=1;}
    const assignReputation=()=>sleeveRepAssignments(sleeveInfo.map((s,i)=>bladeburnerSupportSleeves.has(i)||bladeburnerDevelopmentPlan?.investmentWorkers?.includes(i)&&!['FACTION','COMPANY'].includes(actualTasks[i]?.type)?{...s,shock:100}:s), options['disable-auto-reputation'] ? [] : reputationTargets,
        playerWorkInfo, followPlayerSleeve, playerInBladeburner&&!worldDaemonPriority, actualTasks, followTarget, worldDaemonPriority,repContext);
    reputationAssignments=assignReputation();
    if(worldDaemonPriority&&!options.crime&&!options['disable-auto-reputation']&&!startupUrgent&&achievementActionAllowed(ns,'sleeve')){
        let history=null,valid=true;try{history=JSON.parse(ns.read(sleeveRepHandoffFile)||'null');}catch{valid=false;}
        const reserved=[...repContext.reservedSleeves,...(bladeburnerDevelopmentPlan?.investmentWorkers||[])];
        const proposal=valid?planSleeveRepHandoff(sleeveInfo,actualTasks,reputationAssignments,history,{...repContext,reservedSleeves:reserved,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid:ns.pid}):null;
        if(proposal){
            try{
                const receipt=await getNsDataThroughFile(ns,`(() => {const factionWorkScores=${factionWorkScores.toString()};const bestFactionWork=${bestFactionWork.toString()};const score=${sleeveFactionRepScore.toString()};return (${executeSleeveRepHandoff.toString()})(ns,JSON.parse(ns.args[0]),score,()=>(${sleeveControlAllowed.toString()})(ns,ns.args[1],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&(${readNodeRoutePlan.toString()})(ns)?.selected==="hacking");})()`,
                    '/Temp/sleeve-rep-handoff.txt',[JSON.stringify(proposal),ns.pid]);
                ns.print('Sleeve reputation handoff: '+receipt.reason+(receipt.blocked?' (rollback unresolved; further handoffs blocked)':''));
            }catch(error){ns.print('Sleeve reputation handoff deferred: '+String(error));}
            // The native transaction owns the ledger; refresh reality even if its reply was lost.
            sleeveInfo=await getAllSleeves(ns,numSleeves);
            actualTasks=await getNsDataThroughFile(ns,'ns.args.map(i=>ns.sleeve.getTask(i))','/Temp/sleeve-tasks-after-handoff.txt',[...Array(numSleeves).keys()]);
            reputationAssignments=assignReputation();
        }
    }
    if ((4 in ownedSourceFiles) && !Object.keys(cachedCrimeStats).length) {
        try { cachedCrimeStats = await getNsDataThroughFile(ns, 'Object.fromEntries(Object.values(ns.enums.CrimeType).map(name=>[name,ns.singularity.getCrimeStats(name)]))', '/Temp/sleeve-crime-stats.txt'); } catch { }
    }

    if (!(4 in ownedSourceFiles) && sleeveInfo.length) {
        await calculateCrimeChance(ns,sleeveInfo[0],'Mug');
        await calculateCrimeChance(ns,sleeveInfo[0],'Homicide');
    }
    let previousRecovery;try{previousRecovery=JSON.parse(ns.read('tasks/sleeve-recovery-observation.json'));}catch{}
    const recoveryObservation=sleeveRecoveryObservation(previousRecovery,sleeveInfo,actualTasks,Date.now(),reset,ns.pid);
    startupPlan=sleeveStartupPlan({sleeves:sleeveInfo,tasks:actualTasks,crimes:cachedCrimeStats,money:playerInfo.money,
        casinoPending,gangAvailable:needsKarma,inGang:playerInGang,karma:ns.heart.break(),intelligence:playerInfo.skills.intelligence,
        nodeMultiplier:crimeNodeMultiplier,previousWorkers:startupPlan.stage==='gang-karma'?startupPlan.workers:[],enabled:adaptiveStartup});
    if(adaptiveStartup&&startupPlan.stage==='gang-karma'){
        const planningStarted=performance.now();
        startupPlan.karmaTraining=sleeveKarmaTrainingPlan({sleeves:sleeveInfo,tasks:actualTasks,crimes:cachedCrimeStats,workers:startupPlan.workers,assignments:startupPlan.assignments,karma:ns.heart.break(),nodeMultiplier:crimeNodeMultiplier,crimeExpMultiplier,levelMultipliers:combatLevelMultipliers,recoveryRates:recoveryObservation.sleeves.map(s=>s.rate),enabled:!options['disable-training']&&!reset.bitNodeOptions?.disableSleeveExpAndAugmentation,canEvaluate:()=>performance.now()-planningStarted<20});
    }
    if (adaptiveStartup && startupPlan.stage === 'conditioning' && !options['disable-combat-xp-support'] &&
        !options['disable-bladeburner'] && playerInBladeburner && readNodeRoutePlan(ns)?.selected === 'bladeburner' &&
        !reset.bitNodeOptions?.disableSleeveExpAndAugmentation) {
        try {
            const record = JSON.parse(ns.read('tasks/bladeburner-development.json'));
            if (sleeveDevelopmentActive(record, reset, ns.ps('home'))) {
                if(!recoveryOffers||Date.now()-recoveryOffersAt>60000){
                    recoveryOffersAt=Date.now();recoveryOffers=null;
                    try{recoveryOffers=await getNsDataThroughFile(ns,'(()=>{const offers=Array.from({length:ns.args[0]},(_,i)=>ns.sleeve.getSleevePurchasableAugs(i)),stats={};for(const name of new Set(offers.flat().map(a=>a.name)))try{stats[name]=ns.singularity.getAugmentationStats(name);}catch{stats[name]=null;}return offers.map(list=>list.map(a=>({...a,stats:stats[a.name]})));})()','/Temp/sleeve-recovery-offers.txt',[numSleeves]);}catch{}
                }
                const context={metadata:record.metadata,player:playerInfo,speedWeight:.25,levelMultipliers:combatLevelMultipliers,crimeExpMultiplier};
                const recoveryBudget=achievementActionAllowed(ns,'sleeve')&&achievementActionAllowed(ns,'cashSpending')?sleeveAugSpendingBudget(ns,Math.min(budget,Math.max(0,ns.getPlayer().money-Math.max(augmentationReserve,augmentationCashReserve(ns))))):0;
                const augmentationPlan=sleeveAugRecoveryPlan(sleeveInfo,recoveryOffers,cachedCrimeStats,recoveryObservation,recoveryBudget,crimeNodeMultiplier,context,900,{maxPlanningMs:40,state:recoveryPlanningState,cache:recoveryForecastCache,searches:recoverySearches,cacheScope:[reset.lastNodeReset,reset.lastAugReset,ns.pid],cacheStats:(startupPlan.recoveryForecastCache={hits:0,misses:0}),minBatch:options['min-aug-batch'],cooldowns:sleeveInfo.map((_,i)=>Math.max(0,(lastPurchaseTime[i]||0)+options['buy-cooldown']-Date.now())/1000)});
                startupPlan.augmentationRecovery=augmentationPlan;
                const workers = sleeveCombatWorkers(sleeveInfo, cachedCrimeStats, actualTasks, crimeNodeMultiplier, context,recoveryObservation,900,augmentationPlan,combatCompletionHolds);
                if (workers.length) {
                    for(const worker of workers)startupPlan.assignments[worker.index] = 'combat-xp';
                    startupPlan.combatWorker = workers[0];
                    startupPlan.combatWorkers = workers;
                    startupPlan.workers = workers.map(worker=>worker.index);
                    startupPlan.stage = 'combat-development';
                }
            }
        } catch { /* Missing or stale development evidence keeps recovery authoritative. */ }
    }


    // Quote every healthy sleeve before committing any shared augmentation cash.
    const augmentationQuotes=[];
    if(!options['disable-adaptive-augmentations']&&!reset.bitNodeOptions?.disableSleeveExpAndAugmentation&&budget>0){
        for(let i=0;i<numSleeves;i++){
            if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns))return;
            if(sleeveInfo[i].shock!==0)continue;
            const plan=await quoteSleeveAugs(ns,i,budget,augmentationReserve,sleeveInfo[i],actualTasks[i]);
            if(plan?.names?.length)augmentationQuotes.push({index:i,plan});
        }
    }
    const augmentationAllocation=allocateSleeveAugBudget(augmentationQuotes,sleeveAugSpendingBudget(ns,budget));
    for (let i = 0; i < numSleeves; i++) {
        if(isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns))return;
        let sleeve = sleeveInfo[i]; // For convenience, merge all sleeve stats/info into one object
        // Manage sleeve augmentations (if available)
        if (sleeve.shock == 0 && !reset.bitNodeOptions?.disableSleeveExpAndAugmentation) // No augs are available augs until shock is 0
        {
            const selected=options['disable-adaptive-augmentations']?await quoteSleeveAugs(ns,i,budget,augmentationReserve,sleeve,actualTasks[i]):augmentationAllocation.plan[i];
            const spent = await purchaseSleeveAugs(ns,i,budget,augmentationReserve,selected);
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
    const gymTargets={};
    if(canTrain)for(let i=0;i<numSleeves;i++)if(task[i]?.startsWith('train')&&currentTasks[i]?.type==='CLASS'){
        const stat=Object.keys(ns.enums.GymType).find(key=>ns.enums.GymType[key]===currentTasks[i].classType);
        if(stat)gymTargets[i]={stat,target:options['train-to-'+stat],gym:currentTasks[i].location,gymType:currentTasks[i].classType};
    }
    const gymPlan={targets:gymTargets,at:Date.now(),ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,commitments:combatGymCommitments};
    await ns.write('tasks/sleeve-gym-plan.json',JSON.stringify(gymPlan),'w');
    if((9 in ownedSourceFiles)&&!options['disable-spending-hashes-for-gym-upgrades']&&achievementActionAllowed(ns,'hashSpending'))try{
        const upgraded=await getNsDataThroughFile(ns,`(${sleeveControlAllowed.toString()})(ns,ns.args[0],"sleeve.js")&&(${achievementActionAllowed.toString()})(ns,"sleeve")&&(${achievementActionAllowed.toString()})(ns,"hashSpending")&&(()=>{const plan=JSON.parse(ns.read("tasks/sleeve-gym-plan.json")),seconds=(${committedSleeveGymSeconds.toString()})(ns,plan);if(seconds<60)return false;const hashSpendingDecision=${hashSpendingDecision.toString()};return (${spendHashesWithPolicy.toString()})(ns,"Improve Gym Training",undefined,1,{ownerPid:ns.args[0],script:"sleeve.js",trainingSeconds:seconds},hashSpendingDecision).success;})()`,'/Temp/spend-hashes-on-gym.txt',[ns.pid]);
        if(upgraded){combatGymAt=0;log(ns,'SUCCESS: Improved gym training for native-confirmed sleeve sessions.');}
    }catch{}
    await ns.write('tasks/sleeve-recovery-observation.json',JSON.stringify({...recoveryObservation,sleeves:recoveryObservation.sleeves.map((s,i)=>({...s,recovering:currentTasks[i]?.type==='RECOVERY'}))}),'w');
    await ns.write('tasks/sleeve-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,state:'managing',reputationAccuracy:sleeveReputationObservation,reputationAssignments,xpObservation:{reason:sleeveXpObservation?.reason,observedAt:sleeveXpObservation?.observedAt,pool:sleeveXpObservation?.pool},startup:{karmaTraining:startupPlan.karmaTraining||null,stage:startupPlan.stage,workers:startupPlan.workers,assignments:startupPlan.assignments,combatWorker:startupPlan.combatWorker||null,combatWorkers:startupPlan.combatWorkers||[],augmentationRecovery:startupPlan.augmentationRecovery||{}},route:worldDaemonPriority?'hacking':'normal',bladeburnerSupport:[...bladeburnerSupportSleeves],sleeves:sleeveInfo.map((s,i)=>({index:i,shock:s.shock,sync:s.sync,memory:s.memory,task:task[i]||'waiting',actualTask:currentTasks[i]})),purchaseAllocation:{cost:augmentationAllocation.cost,gain:augmentationAllocation.gain,metric:augmentationAllocation.metric,states:augmentationAllocation.states,selected:Object.keys(augmentationAllocation.plan)},purchasePlans:sleevePurchasePlans,remainingAugBudget:budget,sharedAugBudgetRemaining:sleeveAugSpendingBudget(ns,budget)}), 'w');
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
    const openingTask=startupPlan.assignments[i];
    if(openingTask==='money'||openingTask==='karma')
        return await crimeTask(ns,(openingTask==='karma'?startupPlan.karmaTraining?.choices?.[i]:null)||bestSleeveCrime(sleeve,cachedCrimeStats,openingTask,crimeNodeMultiplier),i,sleeve,
            openingTask==='money'?'funding the $300,000 casino seed':startupPlan.karmaTraining?.best?.index===i?'free crime conditioning projects an earlier gang unlock':'unlocking the gang while other sleeves recover');
    if(openingTask==='combat-xp')return await crimeTask(ns,(startupPlan.combatWorkers?.find(w=>w.index===i)||startupPlan.combatWorker).name,i,sleeve,'transferring combat XP while the next Black Op is chance-blocked; recovery compared over a fifteen-minute horizon');
    if(openingTask==='recovery')return shockRecoveryTask(sleeve,i,'other sleeves handle immediate startup milestones');
    if(openingTask==='sync')return ['synchronize','ns.sleeve.setToSynchronize(ns.args[0])',[i],'synchronizing for useful karma, XP and reputation gains'];
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

    // A planned WD milestone must outrank optional generic conditioning.
    if(worldDaemonPriority&&reputationAssignments[i]?.priority===0)return sleeveReputationTask(reputationAssignments[i],i);
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
        return await crimeTask(ns, bestSleeveCrime(sleeve, cachedCrimeStats, 'karma',crimeNodeMultiplier), i, sleeve, 'we want gang karma');
    }
    const rep = reputationAssignments[i];
    if (rep) return rep.type === 'FACTION' ?
        [`work for faction '${rep.name}' (${rep.workType})`, 'ns.sleeve.setToFactionWork(ns.args[0],ns.args[1],ns.args[2])', [i,rep.name,rep.workType], `earning useful reputation with ${rep.name}`] :
        [`work for company '${rep.name}'`, 'ns.sleeve.setToCompanyWork(ns.args[0],ns.args[1])', [i,rep.name], `earning company reputation with ${rep.name}`];
    // If the player is in bladeburner, and has already unlocked gangs with Karma, generate contracts and operations
    if (playerInBladeburner && !worldDaemonPriority) {
        // Hack: Without paying much attention to what's happening in bladeburner, pre-assign a variety of tasks by sleeve index
        const adaptive=adaptiveBladeburnerTasks[i];
        if(adaptive==='combat-xp'){
            const context={metadata:blackOpMetadata[bladeburnerDevelopmentPlan?.target],player:playerInfo,speedWeight:.25,levelMultipliers:combatLevelMultipliers,crimeExpMultiplier};
            const actual=await getNsDataThroughFile(ns,'ns.sleeve.getTask(ns.args[0])','/Temp/sleeve-combat-task.txt',[i]);
            const invested=actual?.type==='CRIME'&&actual.cyclesWorked>0&&actual.cyclesNeeded>actual.cyclesWorked&&cachedCrimeStats[actual.crimeType];
            const crime=sleeveCombatCrime(sleeve,invested?{[actual.crimeType]:cachedCrimeStats[actual.crimeType]}:cachedCrimeStats,crimeNodeMultiplier,context);
            const completed=combatCrimeCompleted(combatGymProgress[i],actual);combatGymProgress[i]=actual;
            const reserve=Math.max(trainingReserve,augmentationCashReserve(ns))+costByCombatLoop(),old= combatGymCommitments[i];
            const held=old?.until>Date.now()&&old.target===bladeburnerDevelopmentPlan.target&&actual?.type==='CLASS'&&actual.location===old.gym&&actual.classType===old.gymType&&sleeve.city===old.city&&sleeve.shock===0&&sleeve.sync===100&&ns.getPlayer().money-reserve>=old.cost*Math.max(1,(old.until-Date.now())/1000);
            const enabled=!options['disable-training']&&achievementActionAllowed(ns,'cashSpending');
            let gym=enabled&&held?old:chooseSleeveCombatGym(sleeve,enabled?combatGymQuotes[i]:[],crime,context,{money:ns.getPlayer().money,reserve,seconds:30,task:completed?null:actual});
            if(gym&&(held||claimSpending(ns,'sleeves',gym.budget))){
                if(completed&&actual?.type==='CRIME'&&Number.isFinite(actual.tasksCompleted)&&actual.tasksCompleted>=1)gym={...gym,completionCredit:{at:Date.now(),crimeType:actual.crimeType,tasksCompleted:actual.tasksCompleted}};
                if(!held)combatGymCommitments[i]={...gym,until:Date.now()+30000,target:bladeburnerDevelopmentPlan.target};
                return ['combat gym '+gym.stat+' ('+gym.gym+')',`(${startSleeveCombatGym.toString()})(ns,ns.args[0],JSON.parse(ns.args[3]),ns.args[4])`,[i,gym.gym,gym.gymType,JSON.stringify(gym),reserve],'training '+gym.stat+' for '+bladeburnerDevelopmentPlan.target+'; verified gym payback'];
            }
            delete combatGymCommitments[i];
            if(crime)return await crimeTask(ns,crime.name,i,sleeve,'developing stats for '+bladeburnerDevelopmentPlan.target);
        }
        let [action,contractName]=adaptive&&adaptive!=='combat-xp'?[adaptive]:['Infiltrate Synthoids'];
        // Explicit optional contract/team preferences remain available when no adaptive plan exists.
        if(!adaptive){
            if(options['enable-bladeburner-team-building']&&i===0)action='Support main sleeve';
            else if(options['enable-bladeburner-team-building']&&i===7)action='Recruitment';
            else if(options['enable-bladeburner-contracts']&&i>=1&&i<=3)[action,contractName]=['Take on contracts',sleeveBbContractNames[i-1]];
        }
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
    var crime = options.crime || (4 in ownedSourceFiles ? bestSleeveCrime(sleeve,cachedCrimeStats,'money',crimeNodeMultiplier) : chooseSleeveCrime(null, await calculateCrimeChance(ns, sleeve, 'Homicide'), options['homicide-chance-threshold']));
    return await crimeTask(ns, crime, i, sleeve, `there appears to be nothing better to do`);
}

/** Helper to prepare the shock recovery task
 * @param {SleevePerson} sleeve */
function shockRecoveryTask(sleeve, i, reason) {
    return [`recover from shock`, `ns.sleeve.setToShockRecovery(ns.args[0])`, [i],
    /*   */ `recovering from shock (${sleeve.shock.toFixed(2)}%) because ${reason}...`];
}

function costByCombatLoop(){return 12000*numSleeves*Math.max(1,interval/1000);}

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
            log(ns, `WARN: Failed to ${strAction}. None of the ${works.length} work types appear to be supported. Will loop back and try again.`, false, 'warning');
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
    return sleeveCrimeChance(sleeve,crimeStats,crimeNodeMultiplier);
}
