import {readSelectedGangBundleGoal} from './gang-augmentation-bundle-policy.js';
import {gangComparisonBudget,recordGangComparisonTiming} from './gang-policy.js';
import {gangCommittedTraining,gangTrainingScheduleTask} from './gang-stat-policy.js';
import {gangPowerSpendingFraction,gangTraineePulse,gangPowerPurchaseAllowed,gangPowerAscensionWeights} from './gang-power-policy.js';
import {gangManualTasks,gangTerritoryRecovery} from './gang-safety-policy.js';
import {gangWarfarePowerPerTick,gangWarfareReadyDelay} from './gang-policy.js';
import {planGangHost,gangHostPreferences} from './faction-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {autopilotSourceFiles} from './autopilot-policy.js';
import { claimSpending } from './spending-policy.js';
import { isScriptPaused } from './automation-control.js';
import {restoreGangWantedPreparation,gangEquipmentLifetime,gangAscensionTaskWeights,forecastGangEquipmentDevelopment,gangTrainingTaskName,gangWarfareWorkFractions,gangWarfareProductionFactor,gangPurchasePlanTiming,gangReportedWantedRate,gangWarfareContext,gangWarfareMemberEligible,gangAscensionAvailability,forecastGangCrewAscensions,forecastGangCrewTraining,restoreGangTrainingBursts,planGangTrainingBursts,gangEquipmentBudgets,gangEquipmentReadiness,gangPurchaseFocus} from './gang-policy.js';
import { gangTerritorySample,gangTerritoryDeadline,gangWallSeconds,gangPlanningHorizon,gangMaintenanceStatus,planGangWantedCrew,planMarginalGangEquipment,gangTerritoryTiming,restoreGangProductiveTasks,gangObjectiveValue,gangObjectiveWeight,gangWantedTolerance,applyGangWorkOrders,projectGangMember,gangFocus, warfareDecision, chooseGangAscensions, gangTaskTotals, wantedRecoveryOrder, purchaseGangEquipment, gangMutationAllowed, gangOptionsError, gangTrainingRequired, nextWantedDowngrade, largestWantedDowngrade, improveGangPlan, betterGangPlan, ascendGangMemberSafely, restoreGangTraining, suspendGangWarfare } from './gang-policy.js';
import {
    log, getConfiguration, instanceCount, getNsDataThroughFile, getActiveSourceFiles, runCommand, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration
} from './helpers.js'

// Global config
const updateInterval = 200; // We can improve our timing by updating more often than gang stats do (which is every 2 seconds for stats, every 20 seconds for territory)
const wantedPenaltyThreshold = 0.01; // Don't let the wanted penalty get worse than this
const offStatCostPenalty = 50; // Equipment that doesn't contribute to our main stats suffers a percieved cost penalty of this multiple
const defaultMaxSpendPerTickTransientEquipment = 0.002; // If the --equipment-budget is not specified, spend up to this percent of non-reserved cash on temporary upgrades (equipment)
const defaultMaxSpendPerTickPermanentEquipment = 0.2; // If the --augmentation-budget is not specified, spend up to this percent of non-reserved cash on permanent member upgrades

// Territory-related variables
// Host selection is shared with faction work; NPC power is only a final tie breaker.
let territoryTickDetected = false;
let territoryTickTime = 20000; // Est. milliseconds until territory *ticks*. Can vary if processing offline time
let territoryTickWaitPadding = 200; // Start waiting this many milliseconds before we think territory will tick, in case it ticks early (increases automatically after misfires)
let missedTerritoryTicks=0,lastTerritoryWarningAt=0;
let consecutiveTerritoryDetections = 0; // Used to reduce padding if things get back on track.
let territoryNextTick = null;
let nextWarfareCheck=0; // The next time territory will tick
let isReadyForNextTerritoryTick = false;
let warfareFinished = false;
let lastTerritoryPower = 0;
let lastOtherGangInfo = null;
let gangRivalsSnapshot=null;
let lastLoopTime = null;

// Crime activity-related variables
const crimes = ["Mug People", "Deal Drugs", "Strongarm Civilians", "Run a Con", "Armed Robbery", "Traffick Illegal Arms", "Threaten & Blackmail", "Human Trafficking", "Terrorism",
    "Ransomware", "Phishing", "Identity Theft", "DDoS Attacks", "Plant Virus", "Fraud & Counterfeiting", "Money Laundering", "Cyberterrorism"];
let pctTraining = 0.20;
let multGangSoftcap = 0.0;
let allTaskNames = (/**@returns{string[]}*/() => undefined)();
let allTaskStats = (/**@returns{{[taskName: string]: GangTaskStats;}}*/() => undefined)();
let assignedTasks = (/**@returns{{[gangMemberName: string]: string;}}*/() => ({}))(); // Each member will independently attempt to scale up the crime they perform until they are ineffective or we start generating wanted levels
let lastMemberReset = {}; // Tracks when each member last ascended

// Global state
let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // Information about the current bitnode
let ownedSourceFiles;
let myGangFaction = "";
let isHackGang = false;
let nextRecruitCheck = 0;
let strWantedReduction;
let requiredRep = 0;
let myGangMembers = (/**@returns{string[]}*/() => [])();
let equipments = (/**@returns{{name: string;type: string;cost: number;stats: EquipmentStats;}[]};*/() => [])();
let importantStats = [];

let options;
let growthHorizon={seconds:900,reason:"Configured growth window"};
let nextRepRefresh = 0;
let postTickRestoreMs=0,forecastWantedLimits={};
let equipmentValuationCursor=0,equipmentValuationItems={};
let gangFactionFavor=null,purchaseFocusQuote=null,purchaseFocusContext=null,purchaseTimingContext=null;
let ascensionRecoveries={};
let wantedPreparation=null,expectedAscensions={},trainingReference=[],trainingEpisodes={},trainingValuationCursor=0,trainingDiagnostics=null,ascensionDiagnostics=null,ascensionValuationCursor=0;
let equipmentPurchaseCursor=null,comparisonTiming=[];
let ascensionComparisonQuotes={};
const developmentSignature=m=>JSON.stringify([m.earnedRespect,...['hack','str','def','dex','agi','cha'].flatMap(k=>[m[k+'_exp'],m[k+'_mult'],m[k+'_asc_mult']]),m.upgrades,m.augmentations]);
let purchaseGoal=null,growthFocus='respect',trainingPlans={},trainingForecasts={},plannedAscensions=new Set(),equipmentOpportunity=null,equipmentDiagnostics=null;
const argsSchema = [
    ['manual-task-overrides', '{}'], // Optional JSON member-to-task map. Clear it to resume full automation.
    ['gang-type', 'combat'], // Choose combat or hacking when creating a gang. Does not change an existing gang.
    ['gang-faction', null], // Optional exact host; implies its gang type and waits for this faction.
    ['gang-skip', []], // Factions that must not be used as a gang host.

    ['power-focus', true], // Lead development with power until territory is complete; false restores balanced planning.
    ['disable-adaptive-growth', false], // Use legacy training, ascension thresholds and price-ordered equipment.
    ['growth-horizon-minutes', 15], // Baseline modeled payback window; fresh route/recruitment evidence can extend it to an hour.
    ['disable-adaptive-horizon',false], // Keep the configured baseline; verified reset/route deadlines still cap it.
    ['training-percentage', 0.05], // Spend this percent of time randomly training gang members versus doing crime
    ['no-training', false], // Don't train unless all other tasks generate no gains or the member ascended recently (--min-training-ticks)
    ['no-auto-ascending', false], // Don't ascend members
    ['ascend-multi-threshold', 1.05], // Ascend member #12 if a primary stat multi would increase by more than this amount
    ['ascend-multi-threshold-spacing', 0.05], // Members will space their acention multis by this amount to ensure they are ascending at different rates
    // Note: given the above two defaults, members would ascend at multis [1.6, 1.55, 1.50, ..., 1.1, 1.05] once you have 12 members.
    ['min-training-ticks', 10], // Require this many ticks of training after ascending or recruiting to rebuild stats
    ['reserve', null], // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
    ['augmentations-budget', null], // Percentage of non-reserved cash to spend per tick on permanent member upgrades (If not specified, uses defaultMaxSpendPerTickPermanentEquipment)
    ['equipment-budget', null], // Percentage of non-reserved cash to spend per tick on permanent member upgrades (If not specified, uses defaultMaxSpendPerTickTransientEquipment)
    ['money-focus', false], // Always optimize gang crimes for maximum monetary gain. Is otherwise balanced.
    ['warfare-win-chance', 0.75], // Minimum chance against every active rival.
    ['reputation-focus', false], // Always optimize gang crimes for maximum reputation gain. Is otherwise balanced.
];

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
    assignedTasks = {}, lastMemberReset = {}, nextRepRefresh = 0, nextRecruitCheck = 0;
    gangRivalsSnapshot=null;ascensionRecoveries={};wantedPreparation=null;expectedAscensions={};trainingReference=[];trainingEpisodes={};trainingValuationCursor=0;trainingDiagnostics=null;ascensionDiagnostics=null;ascensionValuationCursor=0;equipmentValuationItems={};equipmentValuationCursor=0;trainingPlans={};trainingForecasts={};purchaseGoal=null;purchaseFocusQuote=null;purchaseFocusContext=null;purchaseTimingContext=null;growthFocus='respect';plannedAscensions=new Set();equipmentOpportunity=null;equipmentDiagnostics=null;
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    const invalid=gangOptionsError(options)||planGangHost([],options).error||(!Number.isFinite(options['growth-horizon-minutes'])||options['growth-horizon-minutes']<=0?'growth-horizon-minutes must be positive.':null);if(invalid)return ns.tprint(invalid);
    try{resetInfo=await getNsDataThroughFile(ns,'ns.getResetInfo()');ownedSourceFiles=resetInfo.ownedSF?autopilotSourceFiles(resetInfo):await getActiveSourceFiles(ns);}catch(err){return log(ns,'WARNING: Cannot read gang API access: '+String(err),false,'warning');}
    const sf2Level = ownedSourceFiles[2] || 0;
    if (sf2Level == 0)
        return log(ns, "ERROR: You have no yet unlocked gangs. Script should not be run...");

    ns.atExit(() => suspendGangWarfare(ns,assignedTasks));
    try {if(!await initialize(ns))return;}catch(err){return log(ns,'WARNING: Gang initialization unavailable: '+String(err),false,'warning');}
    log(ns, "Starting main loop...");
    await renewWarfareLease(ns);
    while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
        try { await mainLoop(ns); await renewWarfareLease(ns); }
        catch (err) {
            log(ns, `WARNING: gangs.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(updateInterval);
    }
}

/** @param {NS} ns
 * One-time setup actions. **/
async function initialize(ns) {
    ns.disableLog('ALL');
    pctTraining = options['no-training'] ? 0 : options['training-percentage'];

    const preferences=Object.fromEntries(['gang-type','gang-faction','gang-skip'].map(key=>[key,options[key]]));
    const reset=ns.getResetInfo();
    await ns.write('tasks/gang-host-preferences.json',JSON.stringify({ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,preferences}),'w');
    let loggedWaiting = false;
    nextRecruitCheck = 0;
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    let haveJoinedAGang = false;
    while (!haveJoinedAGang) {
        automationHeartbeat(ns);
        if(isScriptPaused(ns,ns.getScriptName()))return false;
        try {
            haveJoinedAGang = await getNsDataThroughFile(ns, 'ns.gang.inGang()');
            if (haveJoinedAGang) break;
            if (!loggedWaiting) {
                log(ns, `Waiting for a ${planGangHost([],preferences).type} gang host. Creation uses available hosts; no waiting for harder invitations.`);
                loggedWaiting = true;
            }
            if (bitNode == 2 || ns.heart.break() <= -54000) {
                const policy=gangHostPreferences(ns);
                const joined=await getNsDataThroughFile(ns,'ns.getPlayer().factions');
                const plan=planGangHost(joined,policy);
                if(plan.error){ns.print('Gang creation deferred: '+plan.error);await ns.sleep(5000);continue;}
                if(!plan.host){await ns.sleep(1000);continue;}
                let metadata={};
                if(ownedSourceFiles[4]&&plan.ready.length)try {
                    metadata=await getNsDataThroughFile(ns,`(() => {
                        const owned=ns.singularity.getOwnedAugmentations(true);
                        return Object.fromEntries(ns.args.map(f=>[f,{favor:ns.singularity.getFactionFavor(f),rep:ns.singularity.getFactionRep(f),
                            unique:ns.singularity.getAugmentationsFromFaction(f).filter(a=>a!=='NeuroFlux Governor'&&!owned.includes(a)&&ns.singularity.getAugmentationFactions(a).length===1).length}]));
                    })()`,'/Temp/gang-host-benefits.txt',plan.ready);
                }catch{ns.print('Host augmentation/favor data unavailable; using deterministic available-host order.');}
                const result=await getNsDataThroughFile(ns,`(() => {
                    if(!(${gangMutationAllowed.toString()})(ns,ns.args[0])||ns.gang.inGang())return null;
                    const m=JSON.parse(ns.args[1]);
                    const p=(${planGangHost.toString()})(ns.getPlayer().factions,(${gangHostPreferences.toString()})(ns),[],m);
                    if(!p.host)return null;
                    return ns.gang.createGang(p.host)?{host:p.host,type:p.type,lostRep:m[p.host]?.rep??null}:null;
                })()`,'/Temp/gang-createGang.txt',[ns.pid,JSON.stringify(metadata)]);
                if(result)log(ns,`Created ${result.type} gang with ${result.host}. Host reputation reset: ${result.lostRep===null?'unknown':formatNumberShort(result.lostRep)}. Favor retained.`);
            }
        }
        catch (err) {
            log(ns, `WARNING: gangs.js Caught (and suppressed) an unexpected error while waiting to join a gang:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(1000);
    }
    const playerData = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    log(ns, "Collecting gang information...");
    const myGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    myGangFaction = myGangInfo.faction;
    if (loggedWaiting)
        log(ns, `SUCCESS: Created gang ${myGangFaction} (At ${formatDuration(Date.now() - resetInfo.lastNodeReset)} into BitNode)`, false, 'success');
    isHackGang = myGangInfo.isHacking;
    strWantedReduction = isHackGang ? "Ethical Hacking" : "Vigilante Justice";
    importantStats = isHackGang ? ["hack"] : ["str", "def", "dex", "agi"];
    territoryNextTick = lastTerritoryPower = lastOtherGangInfo = null;
    territoryTickDetected = isReadyForNextTerritoryTick = warfareFinished = false;
    territoryTickWaitPadding = updateInterval;missedTerritoryTicks=0;lastTerritoryWarningAt=0;

    // If possible, determine how much rep we would need to get the most expensive unowned augmentation
    const sf4Level = ownedSourceFiles[4] || 0;
    requiredRep = 2.5e6;
    if (sf4Level == 0)
        log(ns, `INFO: SF4 required to get gang augmentation info. Defaulting to assuming ~2.5 million rep is desired.`);
    else {
        try {
            if (sf4Level < 3)
                log(ns, `WARNING: This script makes use of singularity functions, which are quite expensive before you have SF4.3. ` +
                    `Unless you have a lot of free RAM for temporary scripts, you may get runtime errors.`);
            const augmentationNames = await getNsDataThroughFile(ns, `ns.singularity.getAugmentationsFromFaction(ns.args[0])`, null, [myGangFaction]);
            const ownedAugmentations = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(true)`, '/Temp/player-augs-purchased.txt');
            const dictAugRepReqs = await getDict(ns, augmentationNames, 'singularity.getAugmentationRepReq', '/Temp/aug-repreqs.txt');
            // Due to a bug, gangs appear to provide "The Red Pill" even when it's unavailable (outside of BN2), so ignore this one.
            requiredRep = augmentationNames.filter(aug => !ownedAugmentations.includes(aug) && aug !== "NeuroFlux Governor" && (aug !== "The Red Pill" || bitNode === 2)).reduce((max, aug) => Math.max(max, dictAugRepReqs[aug]), 0);
            log(ns, `Highest augmentation reputation cost is ${formatNumberShort(requiredRep)}`);
        } catch {
            log(ns, `WARNING: Failed to get augmentation info despite having SF4.${sf4Level}. This may be due to you having insufficient RAM to launch the temporary scripts. ` +
                `Proceeding with the default assumption that ~2.5 million rep is desired.`);
        }
    }

    // Initialize equipment information
    // This is done in an extremely convoluted way so that we can ram-dodge while retaining type informatin
    const equipmentNames = await (/**@returns{Promise<string[]>}*/() =>
        getNsDataThroughFile(ns, 'ns.gang.getEquipmentNames()'))();
    const dictEquipmentTypes = await (/**@returns{Promise<{[gangMember: string]: string;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentType'))();
    const dictEquipmentCosts = await (/**@returns{Promise<{[gangMember: string]: number;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentCost'))();
    const dictEquipmentStats = await (/**@returns{Promise<{[gangMember: string]: EquipmentStats;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentStats'))();
    equipments = equipmentNames.map((equipmentName) => ({
        name: equipmentName,
        type: dictEquipmentTypes[equipmentName],
        cost: dictEquipmentCosts[equipmentName],
        stats: dictEquipmentStats[equipmentName],
    })).sort((a, b) => a.cost - b.cost);
    //log(ns, JSON.stringify(equipments));
    // Initialize information about gang members and crimes
    allTaskNames = await getNsDataThroughFile(ns, 'ns.gang.getTaskNames()')
    try{options.manualTasks=gangManualTasks(options['manual-task-overrides']??'{}',allTaskNames);}catch(error){log(ns,'ERROR: '+error.message);return false;}
    allTaskStats = await getGangInfoDict(ns, allTaskNames, 'getTaskStats');
    multGangSoftcap = (await tryGetBitNodeMultipliers(ns)).GangSoftcap;
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const dictMembers = await (/**@returns{Promise<{[gangMember: string]: GangMemberInfo;}>}*/() =>
        getGangInfoDict(ns, myGangMembers, 'getMemberInformation'))();
    try{
     const saved=JSON.parse(ns.read('tasks/gang-training.json'));
     lastMemberReset=restoreGangTraining(saved,resetInfo,myGangMembers);
     trainingEpisodes=restoreGangTrainingBursts(saved,resetInfo,myGangMembers);
     ascensionRecoveries=restoreGangTrainingBursts({...saved,episodes:saved.ascensionRecoveries},resetInfo,myGangMembers);
     wantedPreparation=restoreGangWantedPreparation(saved,resetInfo,myGangMembers,lastMemberReset);
     if(Object.values(ascensionRecoveries).some(e=>e.until>Date.now()))wantedPreparation=null;
    }catch{}
    try{const saved=JSON.parse(ns.read('tasks/gang-growth.json'));
        if(saved.nodeReset===resetInfo.lastNodeReset&&saved.augReset===resetInfo.lastAugReset&&typeof saved.equipmentDiagnostics?.nextPurchaseCursor==='string'&&saved.equipmentDiagnostics.nextPurchaseCursor.length<=1024)equipmentPurchaseCursor=saved.equipmentDiagnostics.nextPurchaseCursor;
        if(saved.nodeReset===resetInfo.lastNodeReset&&saved.augReset===resetInfo.lastAugReset)comparisonTiming=gangComparisonBudget(saved.equipmentDiagnostics?.comparisonTiming).history;
    }catch{}
    for (const member of Object.values(dictMembers)) // Initialize the current activity of each member
        assignedTasks[member.name] = (member.task && member.task !== "Unassigned") ? member.task : ("Train " + (isHackGang ? "Hacking" : "Combat"));
    while (myGangMembers.length < 3) {if(isScriptPaused(ns,ns.getScriptName()))return false;if(!await doRecruitMember(ns))await ns.sleep(1000);} // We should be able to recruit our first three members immediately (for free)
    // Peform all updates / actions normally performed on territory tick (every 20 seconds) once before starting the main loop
    lastLoopTime = Date.now()
    const initialCycle=await getNsDataThroughFile(ns,'({gang:ns.gang.getGangInformation(),rivals:ns.gang.getAllGangInformation(),bonusMs:ns.gang.getBonusTime(),at:Date.now()})','/Temp/gang-initial-cycle.txt');
    await onTerritoryTick(ns, initialCycle.gang, {observed:false,at:initialCycle.at,bonusMs:initialCycle.bonusMs},initialCycle.rivals);
    lastTerritoryPower = initialCycle.gang.power;
    return true;
}

/** @param {NS} ns
 * Executed every `interval` **/
async function mainLoop(ns) {
    if(maintenanceRequested(ns)){
        suspendGangWarfare(ns,assignedTasks);isReadyForNextTerritoryTick=false;territoryTickDetected=false;territoryNextTick=null;lastOtherGangInfo=null;
        let saved;try{saved=JSON.parse(ns.read('tasks/gang-status.json'));}catch{}
        await ns.write('tasks/gang-status.json',JSON.stringify(gangMaintenanceStatus(saved,ns.pid,resetInfo)),'w');return;
    }
    // Update gang information (specifically monitoring gang power to see when territory ticks)
    const cycle = await getNsDataThroughFile(ns, '({info:ns.gang.getGangInformation(),others:ns.gang.getAllGangInformation(),bonusMs:ns.gang.getBonusTime(),at:Date.now()})');
    const myGangInfo=cycle.info;
    const thisLoopStart = Date.now();
    const territorySample=gangTerritorySample(lastOtherGangInfo,cycle.others,myGangFaction,cycle.at,cycle.bonusMs);
    const tickObserved=territorySample.changed;
    lastOtherGangInfo=territorySample;
    // Recruitment is independent of the slower territory clock. Fill every available slot.
    if (!isReadyForNextTerritoryTick && myGangMembers.length < 12 && thisLoopStart >= nextRecruitCheck &&
        (!Number.isFinite(territoryNextTick) || thisLoopStart + 2000 < territoryNextTick)) {
        await recruitAvailableMembers(ns);
        nextRecruitCheck = Date.now() + 2000;
    }
    if(myGangInfo.territoryWarfareEngaged&&thisLoopStart>=nextWarfareCheck){await enableOrDisableWarfare(ns,myGangInfo);nextWarfareCheck=thisLoopStart+2000;}
    if(tickObserved){
        territoryNextTick=gangTerritoryDeadline(cycle.at,cycle.bonusMs,territoryTickTime);
        territoryTickDetected=true;
    }
    // If territory is close to ticking, quick - set everyone to do "territory warfare"! Once we hit 100% territory, there's no need to keep swapping members to warfare
    const timing=gangTerritoryTiming({detected:territoryTickDetected,nextTick:territoryNextTick,now:thisLoopStart,
        ready:isReadyForNextTerritoryTick,finished:warfareFinished,padding:territoryTickWaitPadding,interval:updateInterval});
    if(!tickObserved&&!timing.prepare&&!timing.management&&!timing.overdue&&!isReadyForNextTerritoryTick){
        let switched=false;
        for(const [name,episode]of Object.entries({...trainingEpisodes,...ascensionRecoveries})){
            const task=gangTrainingScheduleTask(episode,thisLoopStart);
            if(task&&trainingPlans[name]&&!options.manualTasks?.[name]&&assignedTasks[name]!==task){assignedTasks[name]=task;episode.task=task;switched=true;}
        }
        if(switched){await updateMemberActivities(ns);await saveGangTraining(ns);}
    }
    // Training deadlines use the fast management loop, not the twenty-second territory clock.
    const preparationDue=wantedPreparation&&wantedPreparation.until<=thisLoopStart&&!wantedPreparation.expiredHandled;
    const trainingDue=!options['disable-adaptive-growth']&&(preparationDue||Object.entries(trainingEpisodes).some(([name,episode])=>trainingPlans[name]&&episode.until<=thisLoopStart)||
        Object.entries(ascensionRecoveries).some(([name,recovery])=>trainingPlans[name]&&recovery.until<=thisLoopStart));
    if(trainingDue&&!tickObserved&&!timing.prepare&&!timing.management&&!timing.overdue&&!isReadyForNextTerritoryTick){
        if(preparationDue)wantedPreparation.expiredHandled=true;
        await optimizeGangCrime(ns,myGangInfo);
        await updateMemberActivities(ns);
    }
    if (!tickObserved&&timing.prepare) {
        isReadyForNextTerritoryTick = true;
        await prepareGangPowerPulse(ns,myGangInfo);
    }
    // Detect if territory power has been updated in the last tick (or if we have no power, assume it has ticked and we just haven't generated power yet)
    if (tickObserved || (isReadyForNextTerritoryTick && myGangInfo.power != lastTerritoryPower) || timing.overdue || timing.management) {
        await onTerritoryTick(ns, myGangInfo, {observed:tickObserved,at:cycle.at,bonusMs:cycle.bonusMs},cycle.others); //Do most things only once per territory tick
        isReadyForNextTerritoryTick = false;
        lastTerritoryPower = myGangInfo.power;
    } else if (isReadyForNextTerritoryTick)
        log(ns, `INFO: Waiting for territory to tick. (Waiting for gang power to change from ${formatNumberShort(lastTerritoryPower)}. ETA: ${formatDuration(territoryNextTick - thisLoopStart)}`);
    lastLoopTime = thisLoopStart; // Due to periodic lag, we must track the last time we checked, can't assume it was `updateInterval` ago.
}

/** @param {NS} ns
 * Do some things only once per territory tick **/
async function onTerritoryTick(ns, myGangInfo, tick={observed:false,at:Date.now(),bonusMs:0},rivals=null) {
    if(rivals)gangRivalsSnapshot={at:tick.at,faction:myGangFaction,gangs:rivals};
    // Release surviving members from warfare before any slow development work.
    const restoreStarted=Date.now();
    const restored=await getNsDataThroughFile(ns,`(${restoreGangProductiveTasks.toString()})(ns,JSON.parse(ns.args[0]),(${gangMutationAllowed.toString()}),ns.args[1])`,
        '/Temp/gang-restore-productive.txt',[JSON.stringify(assignedTasks),ns.pid]);
    postTickRestoreMs=Date.now()-restoreStarted;
    if(restored.deferred)return;
    if(restored.failed.length)log(ns,`WARNING: Could not restore productive tasks for: ${restored.failed.join(', ')}`);
    territoryNextTick = gangTerritoryDeadline(tick.at,tick.bonusMs,territoryTickTime);
    if (tick.observed || lastTerritoryPower != myGangInfo.power || lastTerritoryPower == null) {
        log(ns, lastTerritoryPower===myGangInfo.power?`Territory tick confirmed; power unchanged at ${formatNumberShort(myGangInfo.power)}.`:`Territory power updated from ${formatNumberShort(lastTerritoryPower)} to ${formatNumberShort(myGangInfo.power)}.`)
        consecutiveTerritoryDetections++;missedTerritoryTicks=0;
        if (consecutiveTerritoryDetections > 5 && territoryTickWaitPadding > updateInterval)
            territoryTickWaitPadding = Math.max(updateInterval, territoryTickWaitPadding - updateInterval);
    } else if (!warfareFinished) {
        missedTerritoryTicks++;
        const repeated=missedTerritoryTicks>=3&&Date.now()-lastTerritoryWarningAt>=60000;
        if(repeated)lastTerritoryWarningAt=Date.now();
        log(ns, `${repeated?'WARNING':'INFO'}: Gang power did not change at the expected territory tick; resynchronizing timing (${missedTerritoryTicks} consecutive misses).`,false,repeated?'warning':null);
        consecutiveTerritoryDetections = 0;
        territoryTickWaitPadding = Math.min(2000, territoryTickWaitPadding + updateInterval); // Start waiting earlier to account for observed lag.
        territoryNextTick = null; // Wait for a fresh observed phase before assigning warfare again.
        territoryTickDetected = false;
        lastOtherGangInfo = null;
    }

    if(restored.restored>0)myGangInfo=await waitForGameUpdate(ns,myGangInfo);
    if (ownedSourceFiles[4] > 0 && Date.now() >= nextRepRefresh) {
        try { requiredRep = await getNsDataThroughFile(ns,
            '(() => { const owned=new Set(ns.singularity.getOwnedAugmentations(true)); return Math.max(0,...ns.singularity.getAugmentationsFromFaction(ns.args[0]).filter(a=>!owned.has(a)&&a!=="NeuroFlux Governor"&&(a!=="The Red Pill"||ns.args[1]===2)).map(a=>ns.singularity.getAugmentationRepReq(a))); })()',
            '/Temp/gang-reputation-goal.txt', [myGangFaction,resetInfo.currentNode]); } catch {}
        nextRepRefresh = Date.now() + 60000;
    }
    purchaseGoal=null;try{const p=JSON.parse(ns.read('tasks/gang-purchase-goal.json'));
        if(p.nodeReset===resetInfo.lastNodeReset&&p.augReset===resetInfo.lastAugReset&&p.faction===myGangFaction&&p.at>Date.now()-120000&&p.at<=Date.now())purchaseGoal=p.goal;}catch{}
    purchaseGoal=readSelectedGangBundleGoal(ns,myGangFaction,resetInfo)||purchaseGoal;
    // Update gang members in case someone died in a clash
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const liveNames=new Set(myGangMembers);
    for(const name of Object.keys(assignedTasks))if(!liveNames.has(name)){delete assignedTasks[name];delete lastMemberReset[name];}
    await recruitAvailableMembers(ns);
    let dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    for(const [name,task]of Object.entries(options.manualTasks||{}))if(dictMembers[name])assignedTasks[name]=task;
    await updateGrowthFocus(ns,myGangInfo,dictMembers);
    const readGrowth=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},now=Date.now(),processes=ns.ps('home');
    const ownedGrowth=p=>p&&p.nodeReset===resetInfo.lastNodeReset&&p.augReset===resetInfo.lastAugReset&&Number.isFinite(p.at)&&p.at<=now&&now-p.at<=120000&&processes.some(o=>o.pid===p.ownerPid&&o.filename.replace(/^\//,'')==='autopilot.js');
    const route=readGrowth('tasks/node-route-plan.json'),wait=readGrowth('tasks/augmentation-wait-plan.json'),pending=readGrowth('tasks/augmentation-reset-plan.json');
    const remaining=ownedGrowth(route)&&now-route.at<=45000?route.routes?.[route.selected]?.etaMs:null;
    const install=ownedGrowth(wait)&&wait.active===true&&wait.schemaVersion===1&&wait.expiresAt>now&&wait.plan?.worthWaiting===true&&
      Number.isFinite(wait.plan.at)&&wait.plan.at<=now&&now-wait.plan.at<=120000&&Number.isFinite(wait.plan.etaMs)&&wait.plan.etaMs>=0?
      Math.max(0,(wait.plan.etaMs-(now-wait.plan.at))/1000):null;
    const resetPending=pending?.pending===true&&pending.augReset===resetInfo.lastAugReset&&pending.expiresAt>now&&pending.expiresAt<=now+180000&&processes.some(p=>p.pid===pending.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js');
    let bonusSeconds=0;try{const bonus=ns.gang.getBonusTime();if(Number.isFinite(bonus))bonusSeconds=Math.max(0,bonus/1000-2);}catch{}
    const recruitSeconds=myGangMembers.length<12&&myGangInfo.respectGainRate>0?Math.max(0,myGangInfo.respectForNextRecruit-myGangInfo.respect)/(myGangInfo.respectGainRate*5):null;
    const recruitWallSeconds=recruitSeconds===null?null:gangWallSeconds(recruitSeconds,bonusSeconds);
    growthHorizon=gangPlanningHorizon({baseSeconds:options['growth-horizon-minutes']*60,adaptive:!options['disable-adaptive-horizon']&&!options['disable-adaptive-growth'],remainingMs:remaining,recruitSeconds:recruitWallSeconds,installSeconds:install,resetPending,development:true,powerPriority:options['power-focus']===true,memberCount:myGangMembers.length,developmentAgeSeconds:Math.max(0,(now-resetInfo.lastNodeReset)/1000)});
    growthHorizon.bonusSeconds=bonusSeconds;growthHorizon.recruitmentRate=myGangInfo.respectGainRate*5;growthHorizon.productiveUpdateObserved=myGangInfo.updateObserved===true;
    await ns.write('tasks/gang-horizon.json',JSON.stringify({at:now,pid:ns.pid,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,...growthHorizon,recruitSeconds}),'w');
    refreshForecastWantedLimits(dictMembers,myGangInfo);
    plannedAscensions=new Set();ascensionComparisonQuotes={};
    // Preserve existing bursts, but compare newly proposed training with ascension at a boundary.
    if(wantedPreparation&&!activeWantedPreparation()){wantedPreparation=null;await saveGangTraining(ns);}
    const trainingLocks=trainingEpisodes;
    await refreshTrainingPlans(ns,dictMembers,myGangInfo);
    if (!options['no-auto-ascending']) {
        const recoveryBefore=JSON.stringify(ascensionRecoveries);
        await tryAscendMembers(ns, myGangInfo,trainingLocks); dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
        if(JSON.stringify(ascensionRecoveries)!==recoveryBefore){
            myGangInfo=await getNsDataThroughFile(ns,'ns.gang.getGangInformation()');
            await refreshTrainingPlans(ns,dictMembers,myGangInfo);
        }
    }
    await tryUpgradeMembers(ns, dictMembers); // Upgrade members if possible
    await enableOrDisableWarfare(ns, await getNsDataThroughFile(ns,'ns.gang.getGangInformation()')); // Update whether we should be participating in gang warfare
    // There's a chance we do training instead of work for this next tick. If training, we primarily train our main stat, with a small chance to train less-important stats
    const task = !options['disable-adaptive-growth'] || Math.random() >= pctTraining ? null : "Train " + (Math.random() < 0.1 ? "Charisma" : Math.random() < (isHackGang ? 0.1 : 0.9) ? "Combat" : "Hacking")
    const changedWork=await updateMemberActivities(ns, dictMembers, task); // Set everyone working on the next activity
    if (!task) await optimizeGangCrime(ns, changedWork?await waitForGameUpdate(ns, myGangInfo):await getNsDataThroughFile(ns,'ns.gang.getGangInformation()'));  // Finally, see if we can improve rep gain rates by micro-optimizing individual member crimes
    const status = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    const actualMembers=await getGangInfoDict(ns,myGangMembers,'getMemberInformation');
    const completedAt=Date.now();
    await ns.write('tasks/gang-status.json', JSON.stringify({at:completedAt,dataAt:completedAt,status:'managing',pid:ns.pid,memberCount:myGangMembers.length,requiredRep,
        nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,growthFocus,purchaseGoal,purchaseFocus:purchaseFocusQuote?{...purchaseFocusQuote,assignments:undefined}:null,trainingPlans,trainingForecasts,trainingEpisodes,trainingDiagnostics,ascensionDiagnostics,ascensionRecoveries,equipmentOpportunity,equipmentDiagnostics,
        equipmentOwnership:Object.fromEntries(Object.values(actualMembers).map(m=>[m.name,{upgrades:m.upgrades,augmentations:m.augmentations}])),
        manualTasks:options.manualTasks,territoryRecovery:gangRecoveryStatus(status,actualMembers),
        postTickRestoreMs,warfareThreshold:options['warfare-win-chance'],info:status,tasks:assignedTasks,actualTasks:Object.fromEntries(Object.values(actualMembers).map(m=>[m.name,m.task]))}), 'w');
}

/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMemberInfo
 * @param {string} forceTask
 * @param {GangGenInfo} myGangInfo
 * Consolidated logic for telling members what to do **/
async function updateMemberActivities(ns, dictMemberInfo = null, forceTask = null, myGangInfo = null) {
    const dictMembers = dictMemberInfo || (await getGangInfoDict(ns, myGangMembers, 'getMemberInformation'));
    const workOrders = [];
    const maxMemberDefense = Math.max(...Object.values(dictMembers).map(m => m.def));
    for (const member of Object.values(dictMembers)) { // Set the desired activity of each member
        let task = forceTask ? forceTask : assignedTasks[member.name];
        if (forceTask == "Territory Warfare" && !gangWarfareMemberEligible(member,maxMemberDefense,myGangInfo.territoryWarfareEngaged?1:myGangInfo.territoryClashChance))
            task = assignedTasks[member.name]; // Hack: Spare low-defense members from engaging in in warfare since they have a higher chance of dying
        const protectedTask=memberProtectedTask(member.name);if(protectedTask&&!(forceTask==='Territory Warfare'&&myGangInfo?.pulseTraining?.[member.name]===true))task=protectedTask;
        task ||= 'Train '+(isHackGang?'Hacking':'Combat');
        if (member.task != task) workOrders.push({ name: member.name, task,...(protectedTask&&forceTask==='Territory Warfare'&&myGangInfo?.pulseTraining?.[member.name]===true?{trainingPulse:true}:{}) }); // Only bother with the API call if this isn't their current task
    }
    if (workOrders.length == 0) return false;
    // Set the activities in bulk using a ram-dodging script
    const result=await getNsDataThroughFile(ns, `(${applyGangWorkOrders.toString()})(ns,JSON.parse(ns.args[0]),(${gangMutationAllowed.toString()}),ns.args[1])`,
        '/Temp/gang-set-member-tasks.txt', [JSON.stringify(workOrders),ns.pid]);
    if(result.deferred){ns.print('INFO: Gang task assignment deferred by pause, maintenance, or protected activity.');return false;}
    if(!result.failed.length)
        log(ns, `INFO: Assigned ${workOrders.length}/${Object.keys(dictMembers).length} gang member tasks (${workOrders.map(o => o.task).filter((v, i, self) => self.indexOf(v) === i).join(", ")})`)
    else
        log(ns, `ERROR: Failed to set member task of one or more members: ` + JSON.stringify(result.failed), false, 'error');
    return result.assigned>0;
}

/** @param {NS} ns
 * @param {GangGenInfo} myGangInfo
 * Logic to assign tasks that maximize rep gain rate without wanted gain getting out of control **/
async function optimizeGangCrime(ns, myGangInfo) {
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    // Tolerate our wanted level increasing, as long as reputation increases several orders of magnitude faster and we do not currently have a penalty more than -0.01%
    const wantedGainTolerance=gangWantedTolerance(myGangInfo,wantedPenaltyThreshold);
    let optStat=await updateGrowthFocus(ns,myGangInfo,dictMembers);
    refreshForecastWantedLimits(dictMembers,myGangInfo);
    await refreshTrainingPlans(ns,dictMembers,myGangInfo);
    // Pre-compute how every gang member will perform at every task
    let memberTaskRates = Object.fromEntries(Object.values(dictMembers).map(m => [m.name, allTaskNames.map(taskName => ({
        name: taskName,
        respect: computeRepGains(myGangInfo, taskName, m),
        money: calculateMoneyGains(myGangInfo, taskName, m),
        wanted: computeWantedGains(myGangInfo, taskName, m),
    })).filter(task => task.wanted <= 0 || task.money > 0 || task.respect > 0)])); // Completely remove tasks that offer no gains, but would generate wanted levels
    if (ns.fileExists('Formulas.exe', 'home')) try {
        memberTaskRates = await getNsDataThroughFile(ns,
            '(() => { const [g,members,tasks]=ns.args.map(JSON.parse); return Object.fromEntries(Object.values(members).map(m=>[m.name,Object.values(tasks).map(t=>({name:t.name,respect:ns.formulas.gang.respectGain(g,m,t),money:ns.formulas.gang.moneyGain(g,m,t),wanted:ns.formulas.gang.wantedLevelGain(g,m,t)})).filter(t=>t.wanted<=0||t.money>0||t.respect>0)])); })()',
            '/Temp/gang-formula-rates.txt', [JSON.stringify(myGangInfo),JSON.stringify(dictMembers),JSON.stringify(allTaskStats)]);
    } catch { /* Built-in source-based formulas remain available without Formulas.exe. */ }
    // Reprice the focus choice using native Formulas rates when available.
    if(purchaseFocusContext){
        purchaseFocusContext.locked=myGangMembers.filter(n=>memberProtectedTask(n));
        if(purchaseFocusContext.workFractions){
            purchaseFocusContext.workFractions=gangWarfareWorkFractions(dictMembers,purchaseFocusContext.warfare,purchaseFocusContext.locked);
            try{purchaseFocusContext.bonusSeconds=Math.max(0,ns.gang.getBonusTime()/1000-2);}catch{purchaseFocusContext.bonusSeconds=0;}
        }
        purchaseFocusContext.assignments=Object.fromEntries(myGangMembers.map(n=>[n,memberProtectedTask(n)||assignedTasks[n]]));
        purchaseFocusQuote=gangPurchaseFocus({...purchaseFocusContext,rates:memberTaskRates,previous:purchaseFocusQuote});
        if(purchaseFocusQuote)growthFocus=optStat=purchaseFocusQuote.focus;
    }
    // Forecasts and the actual wanted-constrained planner share one objective.
    const objectiveWeight=(purchaseFocusQuote?.weight??gangObjectiveWeight(purchaseGoal));
    for(const rates of Object.values(memberTaskRates)){
        rates.forEach(rate=>rate[optStat]=gangObjectiveValue(rate,optStat,objectiveWeight));
        rates.sort((a,b)=>b[optStat]-a[optStat]);
    }
    //ns.print(memberTaskRates);

    // Run "the algorithm"
    const start = Date.now(); // Time the algorithms
    let bestTaskAssignments = null, bestWanted = myGangInfo.wantedLevelGainRate;
    let bestTotalGain = myGangInfo.wantedLevelGainRate > wantedGainTolerance ? 0 : // Forget our past achievements, we're gaining wanted levels too fast right now
        optStat == "respect" ? myGangInfo.respectGainRate : optStat == 'money' ? myGangInfo.moneyGainRate :
            gangObjectiveValue({money:myGangInfo.moneyGainRate,respect:myGangInfo.respectGainRate},optStat,objectiveWeight); // Compare the same objective used for proposed tasks.
    if(purchaseFocusQuote){
        const candidate=Object.fromEntries(myGangMembers.map(name=>[name,memberTaskRates[name]?.find(t=>t.name===purchaseFocusQuote.assignments[name]?.name)]));
        if(Object.values(candidate).every(Boolean)){
            const totals=gangTaskTotals(candidate),value=Object.values(candidate).reduce((sum,t)=>sum+t[optStat],0);
            if(betterGangPlan(totals.wanted,value,bestWanted,bestTotalGain,wantedGainTolerance))
                [bestTaskAssignments,bestTotalGain,bestWanted]=[candidate,value,totals.wanted];
        }
    }
    const crewPlan=planGangWantedCrew(memberTaskRates,Object.fromEntries(myGangMembers.map(m=>[m,memberProtectedTask(m)||assignedTasks[m]])),wantedGainTolerance,optStat,myGangMembers.filter(m=>memberProtectedTask(m)));
    if(crewPlan&&betterGangPlan(crewPlan.wanted,crewPlan.value,bestWanted,bestTotalGain,wantedGainTolerance))
        [bestTaskAssignments,bestTotalGain,bestWanted]=[crewPlan.assignments,crewPlan.value,crewPlan.wanted];
    for (let shuffle = 0; shuffle < 100; shuffle++) { // We can discover more optimal results by greedy-optimizing gang members in a different order. Try a few.
        let proposedTasks = {}, totalWanted = 0, totalGain = 0;
        shuffleArray(myGangMembers.slice()).forEach((member, index) => {
            const taskRates = memberTaskRates[member];
            // "Greedy" optimize one member at a time, but as we near the end of the list, we can no longer expect future members to make for wanted increases
            const sustainableTasks = (index < myGangMembers.length - 2) ? taskRates : taskRates.filter(c => (totalWanted + c.wanted) <= wantedGainTolerance);
            // Find the crime with the best gain (If we can't generate value for any tasks, then we should only be training)
            const protectedTask=memberProtectedTask(member);
            const bestTask = protectedTask ? taskRates.find(t=>t.name===protectedTask) : taskRates[0][optStat] == 0 ?
                taskRates.find(t => t.name === gangTrainingTaskName(assignedTasks[member],isHackGang)) :
                (totalWanted > wantedGainTolerance || sustainableTasks.length == 0) ? taskRates.find(t => t.name === strWantedReduction) : sustainableTasks[0];
            [proposedTasks[member], totalWanted, totalGain] = [bestTask, totalWanted + bestTask.wanted, totalGain + bestTask[optStat]];
        });
        // Compare both recovery paths. A ratio-only greedy repair can overshoot and sacrifice too much production.
        const trainingMembers=myGangMembers.filter(m=>memberProtectedTask(m));
        for(const selectDowngrade of [nextWantedDowngrade,largestWantedDowngrade]) {
            const candidateTasks={...proposedTasks};
            let candidateWanted=totalWanted,candidateGain=totalGain;
            for(let steps=0;candidateWanted>wantedGainTolerance&&steps<myGangMembers.length*allTaskNames.length;steps++) {
                const change=selectDowngrade(candidateTasks,memberTaskRates,trainingMembers,optStat);
                if(!change)break;
                const old=candidateTasks[change.name],next=change.task;
                candidateWanted+=next.wanted-old.wanted;candidateGain+=next[optStat]-old[optStat];candidateTasks[change.name]=next;
            }
            if(betterGangPlan(candidateWanted,candidateGain,bestWanted,bestTotalGain,wantedGainTolerance))
                [bestTaskAssignments,bestTotalGain,bestWanted]=[candidateTasks,candidateGain,candidateWanted];
        }
    }
    if(bestTaskAssignments) {
        const trainingMembers=myGangMembers.filter(m=>memberProtectedTask(m));
        bestTaskAssignments=improveGangPlan(bestTaskAssignments,memberTaskRates,optStat,wantedGainTolerance,trainingMembers);
    }
    // Linear-objective improvements can trade away the limiting resource. Keep
    // the selected feasible plan if the final allocation delays joint readiness.
    if(purchaseFocusQuote&&purchaseFocusContext){
        const current=Object.fromEntries(myGangMembers.map(n=>[n,memberTaskRates[n]?.find(t=>t.name===assignedTasks[n])||memberTaskRates[n]?.find(t=>t.name===dictMembers[n]?.task)]));
        const basis=bestTaskAssignments||(Object.values(current).every(Boolean)?current:null);
        const totals=basis?gangTaskTotals(basis):{money:0,respect:0,wanted:Infinity},c=purchaseFocusContext;
        const eta=gangPurchasePlanTiming(c,basis||{})?.etaSeconds??Infinity;
        const selected=Object.fromEntries(myGangMembers.map(n=>[n,memberTaskRates[n]?.find(t=>t.name===purchaseFocusQuote.assignments[n]?.name)]));
        if((eta>purchaseFocusQuote.etaSeconds||totals.wanted>wantedGainTolerance)&&Object.values(selected).every(Boolean)&&gangTaskTotals(selected).wanted<=wantedGainTolerance)
            bestTaskAssignments=selected;
    }
    const elapsed = Date.now() - start;
    // Determine whether any changes need to be made
    if (bestTaskAssignments != null && myGangMembers.some(m => assignedTasks[m] !== bestTaskAssignments[m].name)) {
        myGangMembers.forEach(m => assignedTasks[m] = bestTaskAssignments[m].name); // Update work orders for all members
        const oldGangInfo = myGangInfo;
        await updateMemberActivities(ns, dictMembers);
        const {wanted:optWanted,respect:optRespect,money:optMoney} = gangTaskTotals(bestTaskAssignments);
        if (optWanted != oldGangInfo.wantedLevelGainRate || optRespect != oldGangInfo.respectGainRate || optMoney != oldGangInfo.moneyGainRate)
            myGangInfo = await waitForGameUpdate(ns, oldGangInfo);
        log(ns, `SUCCESS: Optimized gang member crimes for ${optStat} with wanted gain tolerance ${wantedGainTolerance.toPrecision(2)} (${elapsed} ms). ` +
            `Wanted: ${oldGangInfo.wantedLevelGainRate.toPrecision(3)} -> ${myGangInfo.wantedLevelGainRate.toPrecision(3)}, ` +
            `Rep: ${formatNumberShort(oldGangInfo.respectGainRate)} -> ${formatNumberShort(myGangInfo.respectGainRate)}, Money: ${formatMoney(oldGangInfo.moneyGainRate)} -> ${formatMoney(myGangInfo.moneyGainRate)}`);
        // Compare native adjusted wanted with adjusted wanted, rather than raw task totals.
        const expectedWanted=myGangInfo.updateObserved!==false?gangReportedWantedRate(optWanted,
            Object.values(bestTaskAssignments).filter(t=>allTaskStats[t.name]?.baseWanted<0).length,myGangInfo.wantedLevel,myGangInfo.updateCycles):null;
        if (myGangInfo.updateObserved!==false&&((expectedWanted!==null&&Math.abs(myGangInfo.wantedLevelGainRate - expectedWanted) / Math.max(1e-9,Math.abs(expectedWanted)) > 0.01) || (Math.abs(myGangInfo.respectGainRate - optRespect) / Math.max(1e-9,Math.abs(optRespect)) > 0.01) || (Math.abs(myGangInfo.moneyGainRate - optMoney) / Math.max(1e-9,Math.abs(optMoney)) > 0.01)))
            log(ns, `WARNING: Calculated new rates would be Rep:${formatNumberShort(optRespect)} Wanted: ${expectedWanted===null?'unverified (floor or batch unavailable)':expectedWanted.toPrecision(3)} Money: ${formatMoney(optMoney)}` +
                `but they are Rep:${formatNumberShort(myGangInfo.respectGainRate)} Wanted: ${myGangInfo.wantedLevelGainRate.toPrecision(3)} Money: ${formatMoney(myGangInfo.moneyGainRate)}`, false, 'warning');
    } else
        log(ns, `INFO: Determined all ${myGangMembers.length} gang member assignments need no improvement in this pass for ${optStat} with wanted gain tolerance ${wantedGainTolerance.toPrecision(2)} (${elapsed} ms).`);
    // Fail-safe: Recover using the least costly members if observed wanted exceeds the plan.
    if (myGangInfo.updateObserved!==false&&myGangInfo.wantedLevelGainRate > wantedGainTolerance) await fixWantedGainRate(ns, myGangInfo, wantedGainTolerance, memberTaskRates, optStat);
}

/** @param {NS} ns
 * Logic to reduce crime tiers when we're generating a wanted level **/
async function fixWantedGainRate(ns, myGangInfo, wantedGainTolerance = 0, rates = {}, focus = "respect") {
    let lastWantedLevelGainRate = myGangInfo.wantedLevelGainRate;
    log(ns, `WARNING: Generating wanted levels (${lastWantedLevelGainRate.toPrecision(3)}/sec > ${wantedGainTolerance.toPrecision(3)}/sec), assigning the least costly members to wanted reduction...`, false, 'warning');
    for (const member of wantedRecoveryOrder(myGangMembers,assignedTasks,rates,strWantedReduction,focus)) {
        if(memberProtectedTask(member))continue;
        if (assignedTasks[member] === strWantedReduction) continue; // This member isn't doing crime, so they aren't contributing to wanted
        assignedTasks[member] = strWantedReduction;
        await updateMemberActivities(ns);
        const wantedLevelGainRate = (myGangInfo = await waitForGameUpdate(ns, myGangInfo)).wantedLevelGainRate;
        if(myGangInfo.updateObserved===false)return; // Do not repair additional members using unverified rates.
        if (wantedLevelGainRate <= wantedGainTolerance) return;
        if (lastWantedLevelGainRate == wantedLevelGainRate)
            log(ns, `Warning: Attempt to rollback crime of ${member} to ${assignedTasks[member]} resulted in no change in wanted level gain rate ` +
                `(${lastWantedLevelGainRate.toPrecision(3)})`, false, 'warning');
        lastWantedLevelGainRate=wantedLevelGainRate;
    }
}

/** @param {NS} ns
 * Recruit new members if available **/
async function recruitAvailableMembers(ns) {
    for(let slots=0;slots<12&&myGangMembers.length<12;slots++) {
        if(!gangMutationAllowed(ns,ns.pid))return;
        if(!await getNsDataThroughFile(ns,'ns.gang.canRecruitMember()'))return;
        if(!await doRecruitMember(ns))return;
    }
}

async function doRecruitMember(ns) {
    let i = 0, newMemberName;
    do { newMemberName = `Thug ${++i}`; } while (myGangMembers.includes(newMemberName) || myGangMembers.includes(newMemberName + " Understudy"));
    if (i < myGangMembers.length) newMemberName += " Understudy"; // Pay our respects to the deceased
    if (await getNsDataThroughFile(ns, `(${gangMutationAllowed.toString()})(ns,ns.args[1]) && ns.gang.canRecruitMember() && (() => {if(!ns.gang.recruitMember(ns.args[0]))return false;ns.gang.setMemberTask(ns.args[0],ns.args[2]);return true;})()`, '/Temp/gang-recruit-member.txt', [newMemberName,ns.pid,'Train '+(isHackGang?'Hacking':'Combat')])) {
        myGangMembers.push(newMemberName);
        assignedTasks[newMemberName] = "Train " + (isHackGang ? "Hacking" : "Combat");
        lastMemberReset[newMemberName] = Date.now();
        await saveGangTraining(ns);
        log(ns, `SUCCESS: Recruited a new gang member "${newMemberName}"!`, false, 'success');
        return true;
    } else {
        log(ns, `ERROR: Failed to recruit a new gang member "${newMemberName}"!`, false, 'error');
        return false;
    }
}

/** @param {NS} ns
 * Check if any members are deemed worth ascending to increase a stat multiplier **/
async function tryAscendMembers(ns, gangInfo,trainingLocks=trainingEpisodes) {
    ascensionDiagnostics={reason:'No eligible candidates'};expectedAscensions={};
    if(activeWantedPreparation()){ascensionDiagnostics={reason:'Wanted preparation in progress'};return;}
    const dictAscensionResults=await getGangInfoDict(ns,myGangMembers,'getAscensionResult');
    const eligibilityMembers=options['disable-adaptive-growth']?null:await getGangInfoDict(ns,myGangMembers,'getMemberInformation');
    const powerContext=gangWarfareContext(gangInfo,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now(),{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true});
    const crimeStats=eligibilityMembers?gangAscensionTaskWeights(eligibilityMembers,dictAscensionResults,allTaskStats,(m,task)=>memberBestValue(m,gangInfo,null,task),importantStats):importantStats;
    const ascensionStats=gangPowerAscensionWeights(eligibilityMembers||{},crimeStats,!options['disable-adaptive-growth']&&powerContext.powerFocus);
    const candidates=chooseGangAscensions(dictAscensionResults,gangInfo,myGangMembers,ascensionStats,
        options['ascend-multi-threshold'],options['ascend-multi-threshold-spacing'],options['disable-adaptive-growth']?1:12,!options['disable-adaptive-growth']).filter(c=>!options.manualTasks?.[c.name]);
    const plans=[];
    if(options['disable-adaptive-growth'])plans.push(...candidates.map(c=>({name:c.name,economics:null})));
    else if(candidates.length){
        const members=eligibilityMembers;
        const sampledAt=Date.now(),values=Object.fromEntries(Object.values(members).map(m=>[m.name,memberBestValue(m,gangInfo)]));
        const ascensions={},availability={},training=allTaskStats['Train '+(isHackGang?'Hacking':'Combat')];
        for(const candidate of candidates){
            const member=candidate.name,ascResult=dictAscensionResults[member],original=members[member];
            if(Date.now()-(lastMemberReset[member]||0)<(options['power-focus']&&!options['disable-adaptive-growth']?2000:60000))continue;
            const ready=gangAscensionAvailability({name:member,members,values,lastReset:lastMemberReset,episodes:trainingLocks,recoveries:ascensionRecoveries,
                now:sampledAt,maximumMs:options['min-training-ticks']*territoryTickTime,allowConcurrent:options['power-focus']===true});
            availability[member]=ready;if(!ready.allowed)continue;
            const retained={...original};
            const keep=Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,original.augmentations.reduce((m,a)=>m*(equipments.find(e=>e.name===a)?.stats[k]||1),1)]));
            for(const k of ['hack','str','def','dex','agi','cha']){retained[k+'_exp']=0;retained[k+'_mult']=keep[k];retained[k+'_asc_mult']=(original[k+'_asc_mult']||1)*(ascResult[k]||1);}
            ascensions[member]={member:retained,respectLoss:Math.max(0,ascResult.respect||0)};
        }
        ascensionComparisonQuotes=Object.fromEntries(Object.entries(ascensions).map(([name,quote])=>[name,{at:Date.now(),signature:developmentSignature(members[name]),quote}]));
        const context=purchaseTimingContext||purchaseFocusContext,goals=[];
        if(myGangMembers.length<12&&gangInfo.respectForNextRecruit>gangInfo.respect)
            goals.push({name:'recruit',resource:'respect',gangRespect:true,amount:gangInfo.respectForNextRecruit-gangInfo.respect});
        if(context){
            const cash=Math.max(0,context.goal.cost-context.money),rep=Math.max(0,context.goal.rep-context.factionRep);
            if(cash>0)goals.push({name:'augmentationCash',group:'augmentation',resource:'money',amount:cash});
            if(rep>0&&context.respectToRep>0)goals.push({name:'augmentationReputation',group:'augmentation',resource:'respect',amount:rep/context.respectToRep});
        }
        const cashAtQuote=context?ns.getServerMoneyAvailable('home'):null;
        const warfare=gangWarfareContext(gangInfo,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now(),{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true});
        const committedTraining=gangCommittedTraining({...trainingLocks,...ascensionRecoveries},members,lastMemberReset,sampledAt);
        const recoveryUntil=Object.fromEntries(Object.entries(ascensionRecoveries).filter(([,r])=>r.until>sampledAt).map(([n,r])=>[n,(r.until-sampledAt)/1000]));
        const recoveryTasks=Object.fromEntries(Object.entries(ascensionRecoveries).map(([n,r])=>[n,r.task]));
        const crew=Object.keys(ascensions).length?forecastGangCrewAscensions({members,gang:gangInfo,training,tasks:allTaskStats,assignments:assignedTasks,fixedTasks:options.manualTasks||{},
            evaluate:(m,g,task)=>memberBestValue(m,g,null,task),names:Object.keys(ascensions),ascensions,goals,warfare,committedTraining,recoveryUntil,recoveryTasks,mixedTraining:options['power-focus']===true,repeatAscensions:options['power-focus']===true,referenceTraining:trainingReference,developmentCycles:!options['no-training'],wantedPreparation:true,trainingOptions:['Train Combat','Train Hacking','Train Charisma'],
            otherCashRate:context?.otherCashRate||0,horizonSeconds:growthHorizon.seconds,bonusSeconds:growthHorizon.bonusSeconds,
            windows:options['no-training']?[2,20,60,120,200,300].filter(seconds=>seconds<=options['min-training-ticks']*territoryTickTime/1000):null,
            ascensionEligible:(m,state,reset)=>chooseGangAscensions({[m.name]:reset.result},state,myGangMembers,ascensionStats,
                options['ascend-multi-threshold'],options['ascend-multi-threshold-spacing'],12,true).some(candidate=>candidate.name===m.name),
            waitWindows:[20,60,120],maxPlanningMs:150,maxSimulations:60,valuationOffset:ascensionValuationCursor}):{plans:[],diagnostics:{simulations:0},nextOffset:ascensionValuationCursor};
        ascensionValuationCursor=crew.nextOffset;ascensionDiagnostics={...crew.diagnostics,availability,forecasts:crew.forecasts,waitingForecasts:crew.waitingForecasts,trainingAlternatives:crew.trainingAlternatives,deferred:crew.deferred};
        const quotedAt=Date.now();
        for(const plan of crew.deferred||[])if(Number.isFinite(plan.waitSeconds)&&plan.waitSeconds>0&&plan.waitSeconds<=120&&Number.isFinite(plan.production))expectedAscensions[plan.name]={at:quotedAt,until:quotedAt+plan.waitSeconds*1000};
        for(const plan of crew.plans){
            const member=plan.name,ascResult=dictAscensionResults[member],original=members[member];
            const economics={...plan,adaptive:true,restoreEquipment:false,name:member,member:original,ascension:ascResult,
                gang:gangInfo,crewNames:myGangMembers.slice(),crewSnapshot:members,cashAtQuote,warfare,
                respectLoss:Math.max(0,ascResult.respect||0),expiresAt:sampledAt+5000};
            plans.push({name:member,economics});
        }
        if(!plans.length){
            const cycle=crew.deferred?.filter(p=>!options.manualTasks?.[p.preparationMember]&&((p.preTrainingSeconds>0&&Number.isFinite(p.preTrainingSeconds)&&p.preTrainingSeconds<=120)||(p.preWantedSeconds>0&&Number.isFinite(p.preWantedSeconds)&&p.preWantedSeconds<=120&&myGangMembers.includes(p.preparationMember)))&&Number.isFinite(p.production))
                .sort((a,b)=>b.production-a.production)[0];
            if(cycle&&!Object.values(trainingLocks).some(e=>e.until>Date.now())&&!Object.values(ascensionRecoveries).some(e=>e.until>Date.now())){
                const at=Date.now(),until=at+(cycle.preWantedSeconds||cycle.preTrainingSeconds)*1000;
                if(cycle.preWantedSeconds){
                    wantedPreparation={member:cycle.preparationMember,target:cycle.name,resetAt:lastMemberReset[cycle.preparationMember]??0,startedAt:at,until,task:'Vigilante Justice'};
                    trainingEpisodes={};trainingReference=[];trainingPlans=Object.fromEntries(myGangMembers.map(n=>[n,false]));
                    for(const name of myGangMembers)assignedTasks[name]=name===cycle.preparationMember?'Vigilante Justice':members[name].task;
                    trainingForecasts=Object.fromEntries(myGangMembers.map(n=>[n,{train:false,window:0,reason:n===cycle.preparationMember?'Wanted reduction before ascension':'Productive work during wanted preparation'}]));
                }else{
                trainingEpisodes={[cycle.name]:{resetAt:lastMemberReset[cycle.name]??0,startedAt:at,until,workUntil:until,task:cycle.trainingTask,growthFirst:true,developmentCycle:true}};
                trainingPlans=Object.fromEntries(myGangMembers.map(n=>[n,n===cycle.name]));assignedTasks[cycle.name]=cycle.trainingTask;
                trainingForecasts=Object.fromEntries(myGangMembers.map(n=>[n,n===cycle.name?{train:true,window:cycle.preTrainingSeconds,trainingTask:cycle.trainingTask,model:'development-cycle',reason:'Training before ascension improves crew value'}:{train:false,window:0,reason:'Productive work during development cycle'}]));
                }
                await saveGangTraining(ns);
            }
        }
        plannedAscensions=new Set(plans.map(p=>p.name));
    }
    for(const {name:member,economics} of plans){
        const ascResult=dictAscensionResults[member];
        if(await getNsDataThroughFile(ns,`(${ascendGangMemberSafely.toString()})(ns,ns.args[0],JSON.parse(ns.args[2]),ns.args[3],ns.args[4],(${chooseGangAscensions.toString()}),ns=>(${gangMutationAllowed.toString()})(ns,ns.args[1]),JSON.parse(ns.args[5]))`,
            '/Temp/gang-ascend-member.txt',[member,ns.pid,JSON.stringify(ascensionStats),options['ascend-multi-threshold'],options['ascend-multi-threshold-spacing'],JSON.stringify(economics)])){
            log(ns,`SUCCESS: Ascended member ${member}: ${importantStats.map(k=>k+' -> '+ascResult[k].toFixed(2)+'x').join(', ')}.`);
            delete trainingEpisodes[member];trainingReference=trainingReference.filter(p=>p.name!==member);trainingPlans[member]=true;wantedPreparation=null;delete expectedAscensions[member];
            lastMemberReset[member]=Date.now();assignedTasks[member]=gangTrainingTaskName(economics?.trainingTask,isHackGang);
            if(economics){const resetAt=lastMemberReset[member],until=resetAt+economics.trainingSeconds*1000;
                ascensionRecoveries[member]={resetAt,startedAt:resetAt,until,workUntil:until,task:assignedTasks[member],...(economics.mixedTraining?{mixedTraining:true,trainingSchedule:economics.trainingSchedule}:{})};}
            plannedAscensions.delete(member); // Buying equipment after the reset cannot discard it in that reset.
            await saveGangTraining(ns);break;
        }
    }
}

/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMembers
 * Upgrade any missing equipment / augmentations of members if we have the budget for it **/
async function tryUpgradeMembers(ns, dictMembers) {
    if(growthHorizon.seconds<=20&&!options['disable-adaptive-growth'])return;
    // Update equipment costs to take into account discounts
    const dictEquipmentCosts = await getGangInfoDict(ns, equipments.map(e => e.name), 'getEquipmentCost');
    equipments.forEach(e => e.cost = dictEquipmentCosts[e.name])
    // Upgrade members, spending no more than x% of our money per tick (and respecting the global reseve)
    const purchaseOrder = [];
    const playerData = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    const reserve = Math.max(0, Number(options["reserve"])||0, Number(ns.read("reserve.txt"))||0);
    const homeMoney = Math.max(0, playerData.money - reserve);
    let sharedBudget = homeMoney * 0.99;
    const maxBudget = 0.99; // Note: To avoid rounding issues and micro-spend race-conditions, only allow budgeting up to 99% of money per tick
    let budget = Math.min(maxBudget, Math.max(0,options['equipment-budget'] ?? defaultMaxSpendPerTickTransientEquipment)) * homeMoney;
    let augBudget = Math.min(maxBudget, Math.max(0,options['augmentations-budget'] ?? defaultMaxSpendPerTickPermanentEquipment)) * homeMoney;
    // BN8 has no gang income. Explicit user budgets still take precedence.
    // Stock API ownership does not determine gang equipment productivity.
    if (resetInfo.currentNode === 8) {
        if (options['equipment-budget'] === null) budget /= 100;
        if (options['augmentations-budget'] === null) augBudget /= 100;
    }
    // Find out what outstanding equipment can be bought within our budget
    for (const equip of equipments) {
        if (sharedBudget <= 0) break;
        for (const member of Object.values(dictMembers)) { // Get this equip for each member before considering the next most expensive equip
            if (sharedBudget <= 0) break;
            // Bit of a hack: Inflate the "cost" of equipment that doesn't contribute to our main stats so that we don't purchase them unless we have ample cash
            let percievedCost = equip.cost * (Object.keys(equip.stats).some(stat => importantStats.some(i => stat.includes(i))) ? 1 : offStatCostPenalty);
            if (equip.type === "Augmentation" && percievedCost > augBudget) continue;
            if (equip.cost > sharedBudget) continue;
            if (equip.type != "Augmentation" && percievedCost > budget) continue;
            if (!member.upgrades.includes(equip.name) && !member.augmentations.includes(equip.name)) {
                purchaseOrder.push({ member: member.name, type: equip.type, equipmentName: equip.name, cost: equip.cost });
                if (equip.type === "Augmentation") augBudget -= equip.cost; else budget -= equip.cost;
                sharedBudget -= equip.cost;
            }
        }
    }
    let orders=purchaseOrder;
    if(!options['disable-adaptive-growth']&&resetInfo.currentNode!==8){
        const shadow=(purchaseFocusQuote?.weight??gangObjectiveWeight(purchaseGoal));
        const gang=await getNsDataThroughFile(ns,'ns.gang.getGangInformation()');
        const locked=myGangMembers.filter(name=>memberProtectedTask(name));
        const workTask=name=>memberProtectedTask(name)||assignedTasks[name]||dictMembers[name].task;
        const warfare=gangWarfareContext(gang,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now(),{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true});
        let equipmentBonus=0;try{equipmentBonus=Math.max(0,ns.gang.getBonusTime()/1000-2);}catch{}
        const cache=new WeakMap();
        const rawRatesFor=member=>{
            if(cache.has(member))return cache.get(member);
            const names=locked.includes(member.name)?[workTask(member.name)]:allTaskNames.filter(t=>!t.startsWith('Train ')&&t!=='Territory Warfare');
            const rates=names.map(name=>{const money=calculateMoneyGains(gang,name,member)*5,respect=computeRepGains(gang,name,member)*5,wanted=computeWantedGains(gang,name,member)*5;
                return {name,money,respect,wanted,value:gangObjectiveValue({money,respect},growthFocus,shadow)};});
            cache.set(member,rates);return rates;
        };
        const fractionCache=new WeakMap(),rateCache=new WeakMap();
        const fractionsFor=crew=>{if(!fractionCache.has(crew))fractionCache.set(crew,gangWarfareWorkFractions(crew,warfare,locked));return fractionCache.get(crew);};
        const ratesFor=(member,crew)=>{
            let rows=rateCache.get(crew);if(!rows){rows=new WeakMap();rateCache.set(crew,rows);}if(rows.has(member))return rows.get(member);
            const factor=gangWarfareProductionFactor(fractionsFor(crew)[member.name],Math.max(1,growthHorizon.seconds),equipmentBonus);
            const rates=rawRatesFor(member).map(t=>({...t,money:t.money*factor,respect:t.respect*factor,value:t.value*factor}));rows.set(member,rates);return rates;
        };
        let previousCrew=[],baselineTeam=null,baselineRates=null;
        const quoteCache=new Map();let developmentChecks=0;
        const developmentStarted=Date.now();
        const evaluate=(member,equip,crew=dictMembers)=>{
            if(equip.type!=='Augmentation'&&plannedAscensions.has(member.name))return null;
            const ascensionAt=expectedAscensionAt(member.name),lifetimeSeconds=gangEquipmentLifetime(equip.type,growthHorizon.seconds,ascensionAt===null?null:Math.max(0,(ascensionAt-Date.now())/1000));
            if(lifetimeSeconds===null||lifetimeSeconds<=0)return null;
            const upgraded=projectGangMember(member,null,0,equip.stats);
            const values=Object.values(crew);
            if(values.length!==previousCrew.length||values.some((m,i)=>m!==previousCrew[i])){
                previousCrew=values;quoteCache.clear();baselineRates=Object.fromEntries(values.map(m=>[m.name,ratesFor(m,crew)]));
                baselineTeam=planGangWantedCrew(baselineRates,Object.fromEntries(values.map(m=>[m.name,workTask(m.name)])),gangWantedTolerance(gang,wantedPenaltyThreshold)*5,'value',locked);
            }
            const quoteKey=JSON.stringify([member.name,equip.stats]);
            if(quoteCache.has(quoteKey))return quoteCache.get(quoteKey);
            const base=baselineTeam;
            const upgradedCrew={...crew,[member.name]:upgraded};
            const next=planGangWantedCrew(Object.fromEntries(Object.values(upgradedCrew).map(m=>[m.name,ratesFor(m,upgradedCrew)])),Object.fromEntries(values.map(m=>[m.name,workTask(m.name)])),gangWantedTolerance(gang,wantedPenaltyThreshold)*5,'value',locked);
            // Payback uses current feasible work across the crew, including changed defense eligibility.
            const total=(team,key)=>Object.values(team).reduce((sum,m)=>sum+(ratesFor(m,team).find(t=>t.name===workTask(m.name))?.[key]||0),0);
            const moneyGain=Math.max(0,total(upgradedCrew,'money')-total(crew,'money'));
            const respectGain=Math.max(0,total(upgradedCrew,'respect')-total(crew,'respect'));
            const objectiveGain=base&&next?Math.max(0,next.value-base.value)*(growthFocus==='money'?1:shadow):0;
            const quote={lifetimeSeconds:equip.type==='Augmentation'||ascensionAt===null?null:Math.max(0,(ascensionAt-Date.now())/1000),lifetimeExpiresAt:equip.type==='Augmentation'?null:ascensionAt,moneyGain,objectiveGain,respectGain:base&&next?Math.max(0,next.respect-base.respect):respectGain,relativeObjectiveGain:base?.value>0&&next?(next.value-base.value)/base.value:0};
            if(!activeWantedPreparation()&&locked.includes(member.name)&&developmentChecks<2&&Date.now()-developmentStarted<80){
                const at=Date.now(),plannedTraining=gangCommittedTraining({...trainingEpisodes,...ascensionRecoveries},crew,lastMemberReset,at).filter(p=>locked.includes(p.name));
                if(plannedTraining.some(p=>p.name===member.name&&p.window>1)){
                    developmentChecks++;
                    const development=forecastGangEquipmentDevelopment({members:crew,name:member.name,stats:equip.stats,plannedTraining,gang,fixedTasks:options.manualTasks||{},training:allTaskStats['Train '+(isHackGang?'Hacking':'Combat')],tasks:allTaskStats,
                        assignments:assignedTasks,evaluate:(m,g,task)=>memberBestValue(m,g,shadow,task),horizonSeconds:lifetimeSeconds,bonusSeconds:equipmentBonus,warfare,
                        maxPlanningMs:20,maxSimulations:2});
                    if(development?.verified&&(development.objectiveGain>0||development.powerObjective===true)){
                        quote.moneyGain=Math.max(0,development.moneyGain);quote.respectGain=Math.max(0,development.respectGain);
                        quote.objectiveGain=development.objectiveGain*(growthFocus==='money'?1:shadow);quote.relativeObjectiveGain=development.baseline>0?(development.production-development.baseline)/development.baseline:0;
                        quote.development={horizonSeconds:development.horizonSeconds,production:development.production,baseline:development.baseline,powerGain:development.powerGain};
                        if(development.powerObjective&&equip.name&&equip.cost<=homeMoney*.01){
                            const game=development.horizonSeconds+Math.min(equipmentBonus,development.horizonSeconds*24);
                            quote.powerObjective=true;quote.powerGainPerTick=development.powerGain/Math.max(1,game/20);quote.powerPaybackSeconds=development.powerPaybackSeconds;
                            quote.powerQuote={at:Date.now(),horizon:lifetimeSeconds,reserve,faction:gang.faction,power:gang.power,territory:gang.territory,rivalPower:warfare.rivalPower,threshold:warfare.threshold,powerPriority:warfare.powerPriority===true,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,trainingTask:workTask(member.name)};
                        }
                    }
                }
            }
            if(warfare.powerFocus&&equip.name&&equip.cost<=Math.max(0,homeMoney)*.05){
                const before=gangWarfarePowerPerTick(crew,gang.territory,warfare.clashChance,locked),after=gangWarfarePowerPerTick(upgradedCrew,gang.territory,warfare.clashChance,locked);
                const eta=rate=>{const game=gangWarfareReadyDelay(gang.power,rate/20,warfare);return Number.isFinite(game)?gangWallSeconds(game,equipmentBonus):Infinity;};
                const beforeETA=eta(before),afterETA=eta(after),payback=gangWallSeconds(20,equipmentBonus),useful=lifetimeSeconds;
                const fraction=gangPowerSpendingFraction({powerPriority:warfare.powerPriority,beforeSeconds:beforeETA,afterSeconds:afterETA,horizon:useful,clashChance:warfare.clashChance});
                if(equip.cost<=homeMoney*fraction&&Number.isFinite(before)&&Number.isFinite(after)&&after>before&&payback<=useful&&
                  ((afterETA<=useful&&beforeETA-afterETA>=Math.max(2,Number.isFinite(beforeETA)?beforeETA*.02:2))||after-before>=Math.max(.001,before*.05))){
                    quote.powerObjective=true;quote.powerGainPerTick=after-before;quote.powerPaybackSeconds=payback;
                    quote.powerQuote={at:Date.now(),horizon:useful,reserve,faction:gang.faction,power:gang.power,territory:gang.territory,rivalPower:warfare.rivalPower,threshold:warfare.threshold,powerPriority:warfare.powerPriority===true,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset};
                    if(fraction>.01)quote.powerQuote.largerPurchase={beforeSeconds:beforeETA,afterSeconds:afterETA,powerGainPerTick:after-before};
                }
            }
            quoteCache.set(quoteKey,quote);return quote;
        };
        const {available,equipmentLimit,augLimit,bootstrapBudget}=gangEquipmentBudgets({money:homeMoney,sharedAllowance:sharedGangAllowance(ns,homeMoney*.5),
            equipmentFraction:options['equipment-budget'],augmentationFraction:options['augmentations-budget'],moneyFocus:options['money-focus']&&!options['power-focus']});
        // Reprice only a bounded affordable shortlist, including all prior batch spend.
        const readinessGuard=purchaseFocusContext&&myGangMembers.length>=12?((candidate,crew,spent)=>{
            const items=candidate.items||[equipments.find(e=>e.name===candidate.equipmentName)];
            if(items.some(e=>!e))return {allowed:false,reason:'missing-equipment-data'};
            const stats={};for(const item of items)for(const [key,mult]of Object.entries(item.stats))stats[key]=(stats[key]||1)*mult;
            const member=crew[candidate.member],upgraded=projectGangMember(member,null,0,stats);
            const cycleRates=m=>rawRatesFor(m).map(t=>({name:t.name,money:t.money/5,respect:t.respect/5,wanted:t.wanted/5}));
            const beforeRates=Object.fromEntries(Object.values(crew).map(m=>[m.name,cycleRates(m)]));
            const afterRates={...beforeRates,[candidate.member]:cycleRates(upgraded)};
            return gangEquipmentReadiness({context:{...purchaseFocusContext,money:homeMoney,workFractions:fractionsFor(crew),bonusSeconds:equipmentBonus,tolerance:gangWantedTolerance(gang,wantedPenaltyThreshold),
                assignments:Object.fromEntries(Object.values(crew).map(m=>[m.name,workTask(m.name)])),locked},
                beforeRates,afterRates,afterWorkFractions:fractionsFor({...crew,[candidate.member]:upgraded}),cost:candidate.cost,spent,horizon:Math.min(900,growthHorizon.seconds)});
        }):null;
        // Ascensions have already been applied and re-read. Price material equipment
        // against that retained crew and its committed training on one timeline.
        const developmentComparisons=[],comparisonBudget=gangComparisonBudget(comparisonTiming);let comparisonChecks=0;
        const purchaseGuard=(candidate,crew,spent,planning={})=>{
            const guardStarted=Date.now();
            const ready=readinessGuard?readinessGuard(candidate,crew,spent):{allowed:true};
            if(!ready.allowed||candidate.cost<=homeMoney*.01)return ready;
            if(comparisonChecks>=3||comparisonChecks>=comparisonBudget.candidateLimit)return {allowed:false,reason:'development-comparison-budget',deferredRotation:true};
            const items=candidate.items||[equipments.find(e=>e.name===candidate.equipmentName)];
            if(items.some(e=>!e))return {allowed:false,reason:'missing-development-equipment'};
            const stats={};for(const item of items)for(const [key,mult]of Object.entries(item.stats))stats[key]=(stats[key]||1)*mult;
            const budgetMs=Math.min(comparisonBudget.perComparisonMs,Number.isFinite(planning.remainingMs)?Math.max(0,planning.remainingMs-(Date.now()-guardStarted)):25);
            if(budgetMs<1)return {allowed:false,reason:'development-time-exhausted',deferredRotation:true};
            comparisonChecks++;
            const at=Date.now(),plannedTraining=gangCommittedTraining({...trainingEpisodes,...ascensionRecoveries},crew,lastMemberReset,at);
            const saved=ascensionComparisonQuotes[candidate.member];
            const alternativeAscension=!options['no-auto-ascending']&&!memberProtectedTask(candidate.member)&&saved?.at<=at&&at-saved.at<=5000&&saved.signature===developmentSignature(crew[candidate.member])?saved.quote:null;
            const comparison=forecastGangEquipmentDevelopment({members:crew,name:candidate.member,stats,plannedTraining,gang,alternativeAscension,
                fixedTasks:options.manualTasks||{},training:allTaskStats['Train '+(isHackGang?'Hacking':'Combat')],tasks:allTaskStats,assignments:assignedTasks,
                evaluate:(m,g,task)=>memberBestValue(m,g,shadow,task),horizonSeconds:Math.min(growthHorizon.seconds,candidate.usefulSeconds??growthHorizon.seconds),bonusSeconds:equipmentBonus,warfare,
                goals:myGangMembers.length<12&&gang.respectForNextRecruit>gang.respect?[{name:'recruit',resource:'respect',amount:gang.respectForNextRecruit-gang.respect}]:[],
                compareFreeTraining:true,extendedWindows:true,alternateTrainingTasks:true,returnIncomplete:true,earlyReject:true,crimeGuidedWindows:true,trainingPermitted:!options['no-training']&&!memberProtectedTask(candidate.member),cost:candidate.cost,costWeight:growthFocus==='money'?1:1/Math.max(1,shadow),maxPlanningMs:budgetMs,maxSimulations:17});
            const decision=comparison?.comparison,elapsedMs=Date.now()-at;
            comparisonTiming=recordGangComparisonTiming(comparisonTiming,{at:Date.now(),elapsedMs,budgetMs,incomplete:!decision});
            developmentComparisons.push({member:candidate.member,cost:candidate.cost,...decision,elapsedMs,budgetMs,incomplete:!decision});
            return decision?.allowed?ready:{allowed:false,reason:decision?.reason||'development-comparison-incomplete'};
        };
        const plan=planMarginalGangEquipment({members:dictMembers,equipment:equipments,evaluate,purchaseGuard,crewAware:true,purchaseCursor:equipmentPurchaseCursor,materialCash:homeMoney,horizon:growthHorizon.seconds,cheapCash:homeMoney,
            equipmentLifetime:(member,equip)=>{const at=expectedAscensionAt(member.name);return at===null||equip.type==='Augmentation'?null:Math.max(0,(at-Date.now())/1000);},
            powerFocus:warfare.powerFocus===true,cheapEligibility:(member,equip)=>equip.type==='Augmentation'||!plannedAscensions.has(member.name),valuationOffset:equipmentValuationCursor,valuationItems:equipmentValuationItems,
            recruitment:{memberCount:myGangMembers.length,respectRate:Math.max(0,gang.respectGainRate)*5,respectGap:Math.max(0,gang.respectForNextRecruit-gang.respect),allowProgression:growthFocus!=='money'},
            budgets:{available,equipmentLimit,augLimit,bootstrapBudget}});
        equipmentPurchaseCursor=plan.diagnostics.nextPurchaseCursor;
        equipmentValuationCursor=plan.diagnostics.nextValuationOffset;
        equipmentValuationItems=plan.diagnostics.nextValuationItems;
        const opportunity=plan.firstOpportunity;
        equipmentOpportunity=opportunity?{powerObjective:opportunity.powerObjective,powerGainPerTick:opportunity.powerGainPerTick,powerPaybackSeconds:opportunity.powerPaybackSeconds,paybackSeconds:opportunity.paybackSeconds,cashPaybackSeconds:opportunity.cashPaybackSeconds,valuePaybackSeconds:opportunity.valuePaybackSeconds,cost:opportunity.cost,reason:opportunity.reason,recruitSecondsSaved:opportunity.recruitSecondsSaved}:null;
        equipmentDiagnostics={...plan.diagnostics,developmentChecks,developmentComparisons,comparisonTiming,comparisonBudget:{candidateLimit:comparisonBudget.candidateLimit,perComparisonMs:comparisonBudget.perComparisonMs,reason:comparisonBudget.reason},ownership:Object.fromEntries(Object.values(dictMembers).map(m=>[m.name,{upgrades:m.upgrades,augmentations:m.augmentations}]))};
        orders=plan.orders;
        await ns.write('tasks/gang-growth.json',JSON.stringify({schemaVersion:2,at:Date.now(),pid:ns.pid,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,powerPriority:options['power-focus']===true,powerFocus:warfare.powerFocus===true,equipmentOpportunity,equipmentDiagnostics,horizon:growthHorizon,expectedAscensions,wantedPreparation,recruitmentSprint:trainingDiagnostics?.recruitmentSprint===true}),'w');
    }
    const receipts=await doUpgradePurchases(ns, orders, reserve);
    if(equipmentDiagnostics)equipmentDiagnostics.receipts=receipts;
}

/** @param {NS} ns
 * Spawn a temporary taask to upgrade members. **/
async function doUpgradePurchases(ns, purchaseOrder, reserve) {
    if (purchaseOrder.length == 0) return [];
    const totalCost = purchaseOrder.reduce((t, e) => t + e.cost, 0);
    const getOrderSummary = (items) => items.map(o => `${o.member} ${o.type}: "${o.equipmentName}"`).join(", ");
    const orderOutcomes = await getNsDataThroughFile(ns, `(() => { const claimSpending=${claimSpending.toString()}; return (${purchaseGangEquipment.toString()})(ns,JSON.parse(ns.args[0]),ns.args[1],ns.args[2],claimSpending,ns=>(${gangMutationAllowed.toString()})(ns,ns.args[3]),true,ns.args[3],(${gangPowerPurchaseAllowed.toString()})); })()`,
        '/Temp/gang-upgrade-members.txt', [JSON.stringify(purchaseOrder), reserve, totalCost,ns.pid]);
    const succeeded = [], failed = [], deferred = [];
    for (let i = 0; i < orderOutcomes.length; i++) {
        const receipt=orderOutcomes[i],order={...purchaseOrder[i],reason:receipt.reason,actualCost:receipt.price};
        (receipt.success?succeeded:receipt.reason==='game-rejected'||receipt.reason==='invalid-price'?failed:deferred).push(order);
    }
    if(succeeded.length)log(ns,`SUCCESS: Purchased ${succeeded.length} gang upgrades for ${formatMoney(succeeded.reduce((sum,o)=>sum+o.actualCost,0))}:\n${getOrderSummary(succeeded)}`,false,'success');
    if(deferred.length)log(ns,`INFO: Deferred ${deferred.length} gang upgrades (${[...new Set(deferred.map(o=>o.reason))].join(', ')}); retrying on a later tick.\n${getOrderSummary(deferred)}`);
    if(failed.length)log(ns,`WARNING: Game rejected ${failed.length} gang equipment orders:\n${getOrderSummary(failed)}`,false,'warning');
    return orderOutcomes.map((receipt,i)=>({...receipt,member:purchaseOrder[i].member,equipmentName:purchaseOrder[i].equipmentName}));
}

/** Wait for native processing, including the legitimate case of unchanged rates.
 * No snapshot polling or assumption that a game update changes serialized values.
 * Unavailable access returns an explicitly unverified snapshot for safe deferral. */
async function waitForGameUpdate(ns, oldGangInfo) {
    if (!myGangMembers.some(member => !(assignedTasks[member]||'').includes('Train')))return oldGangInfo;
    let observed=false,updateCycles=null;
    try{if(typeof ns.gang.nextUpdate==='function'){const elapsed=await ns.gang.nextUpdate();observed=true;if(Number.isFinite(elapsed)&&elapsed>0)updateCycles=elapsed/200;}}catch{}
    try{return {...await getNsDataThroughFile(ns,'ns.gang.getGangInformation()'),updateObserved:observed,...(updateCycles===null?{}:{updateCycles})};}
    catch{return {...oldGangInfo,updateObserved:false};}
}

/** Checks whether we should be engaging in warfare based on our gang power and that of other gangs.
 * @param {NS} ns
 * @param {GangGenInfo} myGangInfo **/
async function enableOrDisableWarfare(ns, myGangInfo) {
    warfareFinished = Math.round(myGangInfo.territory * 2 ** 20) / 2 ** 20 /* Handle API imprecision */ >= 1;
    if (warfareFinished && !myGangInfo.territoryWarfareEngaged) return; // No need to engage once we hit 100%
    const otherGangs = await getNsDataThroughFile(ns, 'ns.gang.getAllGangInformation()'); // Returns dict of { [gangName]: { "power": Number, "territory": Number } }
    let lowestWinChance = 1, totalWinChance = 0, totalActiveGangs = 0;
    let lowestWinChanceGang = "";
    for (const otherGang in otherGangs) {
        if (otherGangs[otherGang].territory == 0 || otherGang == myGangFaction) continue; // *New* Don't have to worry about battling a gang if it has 0 territory
        const winChance = myGangInfo.power / (myGangInfo.power + otherGangs[otherGang].power)
        if (winChance <= lowestWinChance) lowestWinChanceGang = otherGang;
        totalActiveGangs++, totalWinChance += winChance, lowestWinChance = Math.min(lowestWinChance, winChance);
    }
    // Turn on territory warfare only if we have a better than <territoryEngageThreshold>% chance of beating our random opponent
    const averageWinChance = totalActiveGangs ? totalWinChance / totalActiveGangs : 0;
    const shouldEngage = warfareDecision(myGangInfo,otherGangs,options['warfare-win-chance']).engage;
    if (shouldEngage != myGangInfo.territoryWarfareEngaged) {
        log(ns, (warfareFinished ? 'SUCCESS' : 'INFO') + `: Toggling participation in territory warfare to ${shouldEngage}. Our power: ${formatNumberShort(myGangInfo.power)}. ` +
            (!warfareFinished ? `Lowest win chance is ${(100 * lowestWinChance).toFixed(2)}% with ${lowestWinChanceGang} (power ${formatNumberShort(otherGangs[lowestWinChanceGang]?.power)}). ` +
                `Average win chance ${(100 * averageWinChance).toFixed(2)}% across ${totalActiveGangs} active gangs.` :
                'We have destroyed all other gangs and earned 100% territory'), false, warfareFinished ? 'info' : 'success');
        await getNsDataThroughFile(ns, `(() => {const allowed=(${gangMutationAllowed.toString()})(ns,ns.args[1]);const g=ns.gang.getGangInformation();const engage=allowed&&ns.args[0]&&(${warfareDecision.toString()})(g,ns.gang.getAllGangInformation(),ns.args[2]).engage;ns.gang.setTerritoryWarfare(engage);return engage;})()`, '/Temp/gang-warfare-decision.txt',[shouldEngage,ns.pid,options['warfare-win-chance']]);
    }
}

// Ram-dodging helper to get gang information for each item in a list
const getGangInfoDict = /**@returns{Promise<{[gangMember: string]: any;}>}*/async (ns, elements, gangFunction) => await getDict(ns, elements, `gang.${gangFunction}`, `/Temp/gang-${gangFunction}.txt`);
const getDict = /**@returns{Promise<{[key: string]: any;}>}*/ async (ns, elements, nsFunction, fileName) => await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(o => [o, ns.${nsFunction}(o)]))`, fileName, elements);

/** Gang calcs shamefully stolen from https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/GangMember.ts **/
/** @param {GangTaskStats} task
 * @param {GangMemberInfo} memberInfo **/
function getStatWeight(task, memberInfo) {
    return (task.hackWeight / 100) * memberInfo["hack"] + // Need to quote to avoid paying RAM for ns.hack -_-
        (task.strWeight / 100) * memberInfo.str +
        (task.defWeight / 100) * memberInfo.def +
        (task.dexWeight / 100) * memberInfo.dex +
        (task.agiWeight / 100) * memberInfo.agi +
        (task.chaWeight / 100) * memberInfo.cha;
}

let getWantedPenalty = myGangInfo => myGangInfo.respect / (myGangInfo.respect + myGangInfo.wantedLevel);
let getTerritoryPenalty = myGangInfo => (0.2 * myGangInfo.territory + 0.8) * multGangSoftcap;

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function computeRepGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 4 * task.difficulty;
    if (task.baseRespect === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.respect) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = getWantedPenalty(myGangInfo);
    const territoryPenalty = getTerritoryPenalty(myGangInfo);
    //console.log(`statWeight: ${statWeight} task.difficulty: ${task.difficulty} territoryMult: ${territoryMult} territoryPenalty: ${territoryPenalty} myGangInfo.respect ${myGangInfo.respect} myGangInfo.wanted ${myGangInfo.wanted} respectMult: ${respectMult}`);
    return Math.pow(11 * task.baseRespect * statWeight * territoryMult * respectMult, territoryPenalty);
}

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function computeWantedGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 3.5 * task.difficulty;
    if (task.baseWanted === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.wanted) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    return (task.baseWanted < 0) ? 0.4 * task.baseWanted * statWeight * territoryMult :
        Math.min(100, (7 * task.baseWanted) / Math.pow(3 * statWeight * territoryMult, 0.8));
}

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function calculateMoneyGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 3.2 * task.difficulty;
    if (task.baseMoney === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.money) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = getWantedPenalty(myGangInfo);
    const territoryPenalty = getTerritoryPenalty(myGangInfo);
    return Math.pow(5 * task.baseMoney * statWeight * territoryMult * respectMult, territoryPenalty);
}

/** Helps us not get caught in cycles by reducing gang member crime tiers in a random order */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function saveGangTraining(ns){
 await ns.write('tasks/gang-training.json',JSON.stringify({nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,members:lastMemberReset,episodes:trainingEpisodes,ascensionRecoveries,wantedPreparation}),'w');
}


function sharedGangAllowance(ns,fallback){
 try{const p=JSON.parse(ns.read('tasks/spending-plan.json'));if(p.expiresAt>Date.now()&&p.reset===resetInfo.lastAugReset&&ns.isRunning(p.ownerPid)){
    let used=0;try{const u=JSON.parse(ns.read('tasks/spending-usage.json'));if(u.epoch===p.epoch)used=Number(u.spent?.gang)||0;}catch{}
    return Math.max(0,(Number(p.allowances?.gang)||0)-used);
 }}catch{}return fallback;
}
async function updateGrowthFocus(ns,gang,members){
 const player=await getNsDataThroughFile(ns,'ns.getPlayer()');
 let factionRep=null;
 if(ownedSourceFiles[4]>0)try{const rep=await getNsDataThroughFile(ns,'({rep:ns.singularity.getFactionRep(ns.args[0]),favor:ns.singularity.getFactionFavor(ns.args[0])})','/Temp/gang-focus-reputation.txt',[myGangFaction]);factionRep=rep.rep;gangFactionFavor=rep.favor;}catch{}
 const priorQuote=purchaseFocusQuote;purchaseFocusContext=null;purchaseFocusQuote=null;
 const money=Math.max(0,player.money-(Number(ns.read('reserve.txt'))||0));
 let otherCashRate=0;
  try{const c=JSON.parse(ns.read('tasks/progression-speed.json')).reputationPlanningContext,now=Date.now();
   if(c?.nodeReset===resetInfo.lastNodeReset&&c.augReset===resetInfo.lastAugReset&&Number.isFinite(c.at)&&c.at<=now&&now-c.at<=60000&&
    Number.isFinite(c.cashRate)&&Number.isFinite(c.factionCashRate))otherCashRate=Math.max(0,Math.min(c.cashRate,c.factionCashRate)-Math.max(0,gang.moneyGainRate)*5);
  }catch{}
 const respectToRep=player.mults.faction_rep*(1+(gangFactionFavor||0)/100)/75;
 purchaseTimingContext=purchaseGoal&&Number.isFinite(factionRep)&&Number.isFinite(respectToRep)&&respectToRep>0?
  {goal:purchaseGoal,money,factionRep,respectToRep,otherCashRate}:null;
 if(!options['disable-adaptive-growth']&&!options['reputation-focus']&&!options['money-focus']&&myGangMembers.length>=12&&purchaseGoal&&Number.isFinite(factionRep)&&members){
  const locked=myGangMembers.filter(n=>memberProtectedTask(n));
  const assignments=Object.fromEntries(myGangMembers.map(n=>[n,memberProtectedTask(n)||assignedTasks[n]]));
  const rates=Object.fromEntries(Object.values(members).map(m=>[m.name,allTaskNames.map(name=>({name,
   money:calculateMoneyGains(gang,name,m),respect:computeRepGains(gang,name,m),wanted:computeWantedGains(gang,name,m)}))]));
  const warfare=gangWarfareContext(gang,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now(),{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true});
  purchaseFocusContext={goal:purchaseGoal,money,factionRep,respectToRep,assignments,locked,tolerance:gangWantedTolerance(gang,wantedPenaltyThreshold),otherCashRate,
   warfare,workFractions:gangWarfareWorkFractions(members,warfare,locked),bonusSeconds:Math.max(0,growthHorizon.bonusSeconds||0)};
  purchaseFocusQuote=gangPurchaseFocus({...purchaseFocusContext,rates,previous:priorQuote});
 }
 growthFocus=gangFocus({reputationFocus:options['reputation-focus'],moneyFocus:options['money-focus'],members:myGangMembers.length,
  factionRep:factionRep??0,requiredRep,money,respect:gang.respect,goal:options['disable-adaptive-growth']?null:purchaseGoal,purchaseForecast:purchaseFocusQuote});
 return growthFocus;
}
function refreshForecastWantedLimits(members,gang){
 const rates=Object.fromEntries(Object.values(members).map(m=>[m.name,allTaskStats[assignedTasks[m.name]||m.task]?computeWantedGains(gang,assignedTasks[m.name]||m.task,m):0]));
 const total=Object.values(rates).reduce((a,b)=>a+b,0),tolerance=gangWantedTolerance(gang,wantedPenaltyThreshold);
 forecastWantedLimits=Object.fromEntries(Object.entries(rates).map(([name,rate])=>[name,tolerance-(total-rate)]));
}
function memberBestValue(member,gang,shadow=null,forcedTask=null){
 const weight=shadow??(purchaseFocusQuote?.weight??gangObjectiveWeight(purchaseGoal));
 const rate=task=>{
  const money=calculateMoneyGains(gang,task,member)*5,respect=computeRepGains(gang,task,member)*5,wanted=computeWantedGains(gang,task,member)*5;
  return {value:gangObjectiveValue({money,respect},growthFocus,weight),task,money,respect,wanted};
 };
 if(options.manualTasks?.[member.name])return rate(options.manualTasks[member.name]);
 if(forcedTask&&allTaskStats[forcedTask])return rate(forcedTask);
 let best=rate('Train '+(isHackGang?'Hacking':'Combat'));
 for(const task of allTaskNames){
  if(task.startsWith('Train ')||task==='Territory Warfare')continue;
  const candidate=rate(task);
  if(candidate.wanted/5>(forecastWantedLimits[member.name]??Infinity))continue;
  if(candidate.value>best.value)best=candidate;
 }return best;
}
async function refreshTrainingPlans(ns,members,gang){
 if(options['disable-adaptive-growth'])return;
 trainingPlans={};trainingForecasts={};
 if(wantedPreparation){trainingReference=[];trainingPlans=Object.fromEntries(myGangMembers.map(n=>[n,false]));trainingDiagnostics={model:activeWantedPreparation()?'wanted-preparation':'ascension-review',recruitmentSprint:false,until:wantedPreparation.until};return;}
 const task=allTaskStats['Train '+(isHackGang?'Hacking':'Combat')],at=Date.now(),previousRecoveries=JSON.stringify(ascensionRecoveries);
 for(const [name,recovery]of Object.entries(ascensionRecoveries))if(!members[name]||recovery.resetAt!==lastMemberReset[name]||recovery.until<=at)delete ascensionRecoveries[name];
 const values=Object.fromEntries(Object.values(members).map(member=>[member.name,memberBestValue(member,gang)]));
 const rows=[],recoveryUntil={},recoveryTasks={};
 for(const member of Object.values(members)){
  if(options.manualTasks?.[member.name]){delete trainingEpisodes[member.name];delete ascensionRecoveries[member.name];continue;}
  const current=values[member.name],resetAt=lastMemberReset[member.name]??0;
  const elapsed=at-resetAt,maximum=options['min-training-ticks']*territoryTickTime;
  const permitted=elapsed<maximum||!options['no-training'];
  const recovery=ascensionRecoveries[member.name],recovering=recovery?.resetAt===resetAt&&recovery.until>at;
  const cycle=trainingEpisodes[member.name],cycleActive=!options['no-training']&&!options['no-auto-ascending']&&cycle?.developmentCycle===true&&cycle.resetAt===resetAt&&cycle.until>at&&cycle.until-cycle.startedAt<=120000;
  const mandatory=cycleActive||recovering||elapsed<2000||permitted&&current.value<=0&&elapsed<maximum;
  if(mandatory)recoveryUntil[member.name]=cycleActive?(cycle.until-at)/1000:recovering?(recovery.until-at)/1000:Math.max(0,(current.value<=0?maximum:2000)-elapsed)/1000;
  if(mandatory){recoveryTasks[member.name]=gangTrainingTaskName(cycleActive?cycle.task:recovery?.task||assignedTasks[member.name],isHackGang);if(recovering)assignedTasks[member.name]=recoveryTasks[member.name];}
  rows.push({name:member.name,value:current.value,resetAt,mandatory,permitted,urgent:false});
 }
 const context=purchaseTimingContext||purchaseFocusContext,goals=[];
 if(myGangMembers.length<12&&gang.respectForNextRecruit>gang.respect)
  goals.push({name:'recruit',resource:'respect',amount:gang.respectForNextRecruit-gang.respect});
 if(context){
  const cash=Math.max(0,context.goal.cost-context.money),rep=Math.max(0,context.goal.rep-context.factionRep);
  if(cash>0)goals.push({name:'augmentationCash',group:'augmentation',resource:'money',amount:cash});
  if(rep>0&&context.respectToRep>0)goals.push({name:'augmentationReputation',group:'augmentation',resource:'respect',amount:rep/context.respectToRep});
 }
 const active=rows.filter(row=>trainingEpisodes[row.name]?.until>at&&trainingEpisodes[row.name].resetAt===row.resetAt);
 const activeTraining=gangCommittedTraining(trainingEpisodes,members,lastMemberReset,at).filter(p=>active.some(row=>row.name===p.name));
 const ascensionRecovering=Object.values(ascensionRecoveries).some(recovery=>recovery.until>at);
 const candidates=rows.filter(row=>(!ascensionRecovering||options['power-focus'])&&row.permitted&&!row.mandatory&&!row.urgent&&(!active.length||active.some(a=>a.name===row.name))).map(row=>row.name);
 const weight=purchaseFocusQuote?.weight??gangObjectiveWeight(purchaseGoal);
 const crew=candidates.length?forecastGangCrewTraining({members,gang,training:task,mixedTraining:options['power-focus']===true,trainingOptions:['Train Combat','Train Hacking','Train Charisma'],allowJointTraining:true,activeTraining,growthFirst:true,prioritizeWeakTraining:true,recruitmentSprint:myGangMembers.length<12,tasks:allTaskStats,assignments:assignedTasks,fixedTasks:options.manualTasks||{},
  evaluate:(m,state,forced)=>memberBestValue(m,state,weight,forced),names:candidates,recoveryUntil,recoveryTasks,committedTraining:gangCommittedTraining(ascensionRecoveries,members,lastMemberReset,at),warfare:gangWarfareContext(gang,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now(),{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true}),
  horizonSeconds:growthHorizon.seconds,bonusSeconds:growthHorizon.bonusSeconds,goals,otherCashRate:context?.otherCashRate||0,
  maxPlanningMs:150,maxSimulations:60,valuationOffset:trainingValuationCursor}):{forecasts:{},diagnostics:{model:'whole-crew',simulations:0},nextOffset:trainingValuationCursor};
 trainingValuationCursor=crew.nextOffset;trainingDiagnostics=crew.diagnostics;
 for(const row of rows){row.forecast=crew.forecasts[row.name]||{train:false,window:0};trainingForecasts[row.name]=row.forecast;}
 const previousEpisodes=JSON.stringify(trainingEpisodes);
 const plan=planGangTrainingBursts(rows,trainingEpisodes,at,crew.jointPlan,{growthFirst:true});
 trainingPlans=plan.plans;trainingEpisodes=plan.episodes;
 trainingReference=gangCommittedTraining(trainingEpisodes,members,lastMemberReset,at).filter(p=>trainingPlans[p.name]&&!rows.find(row=>row.name===p.name)?.mandatory);
 for(const [name,episode]of Object.entries(trainingEpisodes))if(trainingPlans[name]&&episode.until>at&&episode.task)assignedTasks[name]=episode.task;
 if(JSON.stringify(trainingEpisodes)!==previousEpisodes||JSON.stringify(ascensionRecoveries)!==previousRecoveries)await saveGangTraining(ns);
 for(const row of rows)trainingForecasts[row.name].reason=plan.reasons[row.name];
}
function activeWantedPreparation(name=null){
 if(options['disable-adaptive-growth']||options['no-auto-ascending']||!wantedPreparation)return null;
 const p=restoreGangWantedPreparation({nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,wantedPreparation},resetInfo,myGangMembers,lastMemberReset);
 return p&&(name===null||name===p.member)?p:null;
}
function memberProtectedTask(name){
 if(options.manualTasks?.[name])return options.manualTasks[name];
 if(activeWantedPreparation(name))return 'Vigilante Justice';
 return memberNeedsTraining(name)?gangTrainingScheduleTask(ascensionRecoveries[name])||gangTrainingScheduleTask(trainingEpisodes[name])||gangTrainingTaskName(assignedTasks[name],isHackGang):null;
}
function expectedAscensionAt(name){
 const now=Date.now(),p=expectedAscensions[name],episode=trainingEpisodes[name];
 const times=[p&&Number.isFinite(p.at)&&p.at<=now&&now-p.at<120000&&Number.isFinite(p.until)&&p.until>=p.at&&p.until<=p.at+120000?p.until:null,
  episode?.developmentCycle&&episode.until>now?episode.until:null,wantedPreparation?.target===name?wantedPreparation.until:null].filter(Number.isFinite);
 return times.length?Math.min(...times):null;
}
function memberNeedsTraining(name){
 if(!options['disable-adaptive-growth']&&typeof trainingPlans[name]==='boolean')return trainingPlans[name];
 return gangTrainingRequired(lastMemberReset[name],Date.now(),options['min-training-ticks'],territoryTickTime);
}

/** A successful completed controller pass renews the lease; a hung pass cannot keep it alive. */
async function renewWarfareLease(ns){
 const now=Date.now();let previous;try{previous=JSON.parse(ns.read('tasks/gang-warfare-lease.json'));}catch{}
 if(previous?.ownerPid===ns.pid&&now-previous.at<2000)return;
 const tasks=Object.fromEntries(Object.entries(assignedTasks).filter(([name,task])=>task!=='Territory Warfare'&&!options.manualTasks?.[name]));
 await ns.write('tasks/gang-warfare-lease.json',JSON.stringify({at:now,expiresAt:now+60000,ownerPid:ns.pid,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,faction:myGangFaction,tasks}),'w');
}
function gangRecoveryStatus(gang,members){
 const warfare=gangWarfareContext(gang,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],Date.now());
 const locked=myGangMembers.filter(n=>memberProtectedTask(n));
 return gangTerritoryRecovery(warfare,gangWarfarePowerPerTick(members,gang.territory,warfare.clashChance??0,locked),gangWarfareReadyDelay,growthHorizon.seconds,growthHorizon.bonusSeconds||0);
}

/** Preserve manual work, wanted preparation and mandatory recovery. Pulse optional trainees only at zero clash exposure. */
async function prepareGangPowerPulse(ns,gang){
 const members=await getGangInfoDict(ns,myGangMembers,'getMemberInformation'),at=Date.now(),pulseTraining={};
 const warfare=gangWarfareContext(gang,lastOtherGangInfo?.gangs?lastOtherGangInfo:gangRivalsSnapshot,options['warfare-win-chance'],at,{detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime,powerFocusEnabled:!options['disable-adaptive-growth']&&(options['power-focus']||!options['money-focus']),powerPriority:options['power-focus']===true});
 for(const [name,member]of Object.entries(members)){
  const episode=trainingEpisodes[name];
  pulseTraining[name]=!options['disable-adaptive-growth']&&!options.manualTasks?.[name]&&!activeWantedPreparation(name)&&!(ascensionRecoveries[name]?.until>at)&&at-(lastMemberReset[name]||0)>=2000&&
   episode?.until>at&&gangTraineePulse(member,allTaskStats[episode.task],warfare,growthHorizon.seconds,growthHorizon.bonusSeconds||0,projectGangMember);
 }
 await updateMemberActivities(ns,members,'Territory Warfare',{...gang,pulseTraining});
}
