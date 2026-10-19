import {planGangHost,gangHostPreferences} from './faction-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {autopilotSourceFiles} from './autopilot-policy.js';
import { claimSpending } from './spending-policy.js';
import { isScriptPaused } from './automation-control.js';
import { gangMaintenanceStatus,planGangWantedCrew,planMarginalGangEquipment,gangTerritoryTiming,forecastGangAscension,restoreGangProductiveTasks,gangObjectiveValue,gangObjectiveWeight,gangWantedTolerance,forecastGangTraining,applyGangWorkOrders,projectGangMember,gangFocus, warfareDecision, chooseGangAscensions, gangTaskTotals, wantedRecoveryOrder, purchaseGangEquipment, gangMutationAllowed, gangOptionsError, gangTrainingRequired, nextWantedDowngrade, largestWantedDowngrade, improveGangPlan, betterGangPlan, ascendGangMemberSafely, restoreGangTraining, suspendGangWarfare } from './gang-policy.js';
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
let nextRepRefresh = 0;
let postTickRestoreMs=0,forecastWantedLimits={};
let purchaseGoal=null,growthFocus='respect',trainingPlans={},trainingForecasts={},plannedAscensions=new Set(),equipmentOpportunity=null,equipmentDiagnostics=null;
const argsSchema = [
    ['gang-type', 'combat'], // Choose combat or hacking when creating a gang. Does not change an existing gang.
    ['gang-faction', null], // Optional exact host; implies its gang type and waits for this faction.
    ['gang-skip', []], // Factions that must not be used as a gang host.

    ['disable-adaptive-growth', false], // Use legacy training, ascension thresholds and price-ordered equipment.
    ['growth-horizon-minutes', 15], // Maximum modeled payback time for member ascensions and equipment.
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
    trainingPlans={};trainingForecasts={};purchaseGoal=null;growthFocus='respect';plannedAscensions=new Set();equipmentOpportunity=null;equipmentDiagnostics=null;
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    const invalid=gangOptionsError(options)||planGangHost([],options).error||(!Number.isFinite(options['growth-horizon-minutes'])||options['growth-horizon-minutes']<=0?'growth-horizon-minutes must be positive.':null);if(invalid)return ns.tprint(invalid);
    try{resetInfo=await getNsDataThroughFile(ns,'ns.getResetInfo()');ownedSourceFiles=resetInfo.ownedSF?autopilotSourceFiles(resetInfo):await getActiveSourceFiles(ns);}catch(err){return log(ns,'WARNING: Cannot read gang API access: '+String(err),false,'warning');}
    const sf2Level = ownedSourceFiles[2] || 0;
    if (sf2Level == 0)
        return log(ns, "ERROR: You have no yet unlocked gangs. Script should not be run...");

    ns.atExit(() => suspendGangWarfare(ns,assignedTasks));
    try {if(!await initialize(ns))return;}catch(err){return log(ns,'WARNING: Gang initialization unavailable: '+String(err),false,'warning');}
    log(ns, "Starting main loop...");
    while (!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
        try { await mainLoop(ns); }
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
    allTaskStats = await getGangInfoDict(ns, allTaskNames, 'getTaskStats');
    multGangSoftcap = (await tryGetBitNodeMultipliers(ns)).GangSoftcap;
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const dictMembers = await (/**@returns{Promise<{[gangMember: string]: GangMemberInfo;}>}*/() =>
        getGangInfoDict(ns, myGangMembers, 'getMemberInformation'))();
    try{lastMemberReset=restoreGangTraining(JSON.parse(ns.read('tasks/gang-training.json')),resetInfo,myGangMembers);}catch{}
    for (const member of Object.values(dictMembers)) // Initialize the current activity of each member
        assignedTasks[member.name] = (member.task && member.task !== "Unassigned") ? member.task : ("Train " + (isHackGang ? "Hacking" : "Combat"));
    while (myGangMembers.length < 3) {if(isScriptPaused(ns,ns.getScriptName()))return false;if(!await doRecruitMember(ns))await ns.sleep(1000);} // We should be able to recruit our first three members immediately (for free)
    // Peform all updates / actions normally performed on territory tick (every 20 seconds) once before starting the main loop
    lastLoopTime = Date.now()
    await onTerritoryTick(ns, myGangInfo);
    lastTerritoryPower = myGangInfo.power;
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
    const myGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    const thisLoopStart = Date.now();
    // Recruitment is independent of the slower territory clock. Fill every available slot.
    if (!isReadyForNextTerritoryTick && myGangMembers.length < 12 && thisLoopStart >= nextRecruitCheck &&
        (!Number.isFinite(territoryNextTick) || thisLoopStart + 2000 < territoryNextTick)) {
        await recruitAvailableMembers(ns);
        nextRecruitCheck = Date.now() + 2000;
    }
    if(myGangInfo.territoryWarfareEngaged&&thisLoopStart>=nextWarfareCheck){await enableOrDisableWarfare(ns,myGangInfo);nextWarfareCheck=thisLoopStart+2000;}
    if (!territoryTickDetected) { // Detect the first territory tick by watching for other gang's territory power to update.
        const otherGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getAllGangInformation()'); // Returns dict of { [gangName]: { "power": Number, "territory": Number } }
        if (lastOtherGangInfo != null && JSON.stringify(otherGangInfo) != JSON.stringify(lastOtherGangInfo)) {
            territoryNextTick = lastLoopTime + territoryTickTime/(ns.gang.getBonusTime()>0?5:1);
            territoryTickDetected = true;
            lastTerritoryPower = myGangInfo.power;
            log(ns, `INFO: Others gangs power updated (sometime in the past ${formatDuration(thisLoopStart - lastLoopTime)}. ` +
                `Will start waiting for next tick in: ${formatDuration(territoryNextTick - thisLoopStart - territoryTickWaitPadding)}`, false);
        } else if (lastOtherGangInfo == null)
            log(ns, `INFO: Waiting to detect territory to tick. (Waiting for other gangs' power to update.) Will check every ${formatDuration(updateInterval)}...`);
        lastOtherGangInfo = otherGangInfo;
    }
    // If territory is close to ticking, quick - set everyone to do "territory warfare"! Once we hit 100% territory, there's no need to keep swapping members to warfare
    const timing=gangTerritoryTiming({detected:territoryTickDetected,nextTick:territoryNextTick,now:thisLoopStart,
        ready:isReadyForNextTerritoryTick,finished:warfareFinished,padding:territoryTickWaitPadding,interval:updateInterval});
    if (timing.prepare) {
        isReadyForNextTerritoryTick = true;
        await updateMemberActivities(ns, null, "Territory Warfare", myGangInfo);
    }
    // Detect if territory power has been updated in the last tick (or if we have no power, assume it has ticked and we just haven't generated power yet)
    if ((isReadyForNextTerritoryTick && myGangInfo.power != lastTerritoryPower) || timing.overdue || timing.management) {
        await onTerritoryTick(ns, myGangInfo); //Do most things only once per territory tick
        isReadyForNextTerritoryTick = false;
        lastTerritoryPower = myGangInfo.power;
    } else if (isReadyForNextTerritoryTick)
        log(ns, `INFO: Waiting for territory to tick. (Waiting for gang power to change from ${formatNumberShort(lastTerritoryPower)}. ETA: ${formatDuration(territoryNextTick - thisLoopStart)}`);
    lastLoopTime = thisLoopStart; // Due to periodic lag, we must track the last time we checked, can't assume it was `updateInterval` ago.
}

/** @param {NS} ns
 * Do some things only once per territory tick **/
async function onTerritoryTick(ns, myGangInfo) {
    // Release surviving members from warfare before any slow development work.
    const restoreStarted=Date.now();
    const restored=await getNsDataThroughFile(ns,`(${restoreGangProductiveTasks.toString()})(ns,JSON.parse(ns.args[0]),(${gangMutationAllowed.toString()}),ns.args[1])`,
        '/Temp/gang-restore-productive.txt',[JSON.stringify(assignedTasks),ns.pid]);
    postTickRestoreMs=Date.now()-restoreStarted;
    if(restored.deferred)return;
    if(restored.failed.length)log(ns,`WARNING: Could not restore productive tasks for: ${restored.failed.join(', ')}`);
    territoryNextTick = lastLoopTime + territoryTickTime / (ns.gang.getBonusTime() > 0 ? 5 : 1); // Reset the time the next tick will occur
    if (lastTerritoryPower != myGangInfo.power || lastTerritoryPower == null) {
        log(ns, `Territory power updated from ${formatNumberShort(lastTerritoryPower)} to ${formatNumberShort(myGangInfo.power)}.`)
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

    if (ownedSourceFiles[4] > 0 && Date.now() >= nextRepRefresh) {
        try { requiredRep = await getNsDataThroughFile(ns,
            '(() => { const owned=new Set(ns.singularity.getOwnedAugmentations(true)); return Math.max(0,...ns.singularity.getAugmentationsFromFaction(ns.args[0]).filter(a=>!owned.has(a)&&a!=="NeuroFlux Governor"&&(a!=="The Red Pill"||ns.args[1]===2)).map(a=>ns.singularity.getAugmentationRepReq(a))); })()',
            '/Temp/gang-reputation-goal.txt', [myGangFaction,resetInfo.currentNode]); } catch {}
        nextRepRefresh = Date.now() + 60000;
    }
    purchaseGoal=null;try{const p=JSON.parse(ns.read('tasks/gang-purchase-goal.json'));
        if(p.nodeReset===resetInfo.lastNodeReset&&p.augReset===resetInfo.lastAugReset&&p.faction===myGangFaction&&p.at>Date.now()-120000&&p.at<=Date.now())purchaseGoal=p.goal;}catch{}
    // Update gang members in case someone died in a clash
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const liveNames=new Set(myGangMembers);
    for(const name of Object.keys(assignedTasks))if(!liveNames.has(name)){delete assignedTasks[name];delete lastMemberReset[name];}
    await recruitAvailableMembers(ns);
    let dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    await updateGrowthFocus(ns,myGangInfo);
    refreshForecastWantedLimits(dictMembers,myGangInfo);
    plannedAscensions=new Set();
    if (!options['no-auto-ascending']) { await tryAscendMembers(ns, myGangInfo); dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation'); } // Ascend members if we deem it a good time
    refreshTrainingPlans(dictMembers,myGangInfo);
    await tryUpgradeMembers(ns, dictMembers); // Upgrade members if possible
    await enableOrDisableWarfare(ns, await getNsDataThroughFile(ns,'ns.gang.getGangInformation()')); // Update whether we should be participating in gang warfare
    // There's a chance we do training instead of work for this next tick. If training, we primarily train our main stat, with a small chance to train less-important stats
    const task = !options['disable-adaptive-growth'] || Math.random() >= pctTraining ? null : "Train " + (Math.random() < 0.1 ? "Charisma" : Math.random() < (isHackGang ? 0.1 : 0.9) ? "Combat" : "Hacking")
    await updateMemberActivities(ns, dictMembers, task); // Set everyone working on the next activity
    if (!task) await optimizeGangCrime(ns, await waitForGameUpdate(ns, myGangInfo));  // Finally, see if we can improve rep gain rates by micro-optimizing individual member crimes
    const status = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    const actualMembers=await getGangInfoDict(ns,myGangMembers,'getMemberInformation');
    const completedAt=Date.now();
    await ns.write('tasks/gang-status.json', JSON.stringify({at:completedAt,dataAt:completedAt,status:'managing',pid:ns.pid,memberCount:myGangMembers.length,requiredRep,
        nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,growthFocus,purchaseGoal,trainingPlans,trainingForecasts,equipmentOpportunity,equipmentDiagnostics,
        equipmentOwnership:Object.fromEntries(Object.values(actualMembers).map(m=>[m.name,{upgrades:m.upgrades,augmentations:m.augmentations}])),
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
        if (forceTask == "Territory Warfare" && myGangInfo.territoryClashChance > 0 && (member.def < 100 || member.def < Math.min(10000, maxMemberDefense * 0.1)))
            task = assignedTasks[member.name]; // Hack: Spare low-defense members from engaging in in warfare since they have a higher chance of dying
        if(memberNeedsTraining(member.name))task='Train '+(isHackGang?'Hacking':'Combat');
        task ||= 'Train '+(isHackGang?'Hacking':'Combat');
        if (member.task != task) workOrders.push({ name: member.name, task }); // Only bother with the API call if this isn't their current task
    }
    if (workOrders.length == 0) return;
    // Set the activities in bulk using a ram-dodging script
    const result=await getNsDataThroughFile(ns, `(${applyGangWorkOrders.toString()})(ns,JSON.parse(ns.args[0]),(${gangMutationAllowed.toString()}),ns.args[1])`,
        '/Temp/gang-set-member-tasks.txt', [JSON.stringify(workOrders),ns.pid]);
    if(result.deferred){ns.print('INFO: Gang task assignment deferred by pause, maintenance, or protected activity.');return;}
    if(!result.failed.length)
        log(ns, `INFO: Assigned ${workOrders.length}/${Object.keys(dictMembers).length} gang member tasks (${workOrders.map(o => o.task).filter((v, i, self) => self.indexOf(v) === i).join(", ")})`)
    else
        log(ns, `ERROR: Failed to set member task of one or more members: ` + JSON.stringify(result.failed), false, 'error');
}

/** @param {NS} ns
 * @param {GangGenInfo} myGangInfo
 * Logic to assign tasks that maximize rep gain rate without wanted gain getting out of control **/
async function optimizeGangCrime(ns, myGangInfo) {
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    // Tolerate our wanted level increasing, as long as reputation increases several orders of magnitude faster and we do not currently have a penalty more than -0.01%
    const wantedGainTolerance=gangWantedTolerance(myGangInfo,wantedPenaltyThreshold);
    const optStat=await updateGrowthFocus(ns,myGangInfo);
    refreshForecastWantedLimits(dictMembers,myGangInfo);
    refreshTrainingPlans(dictMembers,myGangInfo);
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
    // Forecasts and the actual wanted-constrained planner share one objective.
    const objectiveWeight=gangObjectiveWeight(purchaseGoal);
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
    const crewPlan=planGangWantedCrew(memberTaskRates,Object.fromEntries(myGangMembers.map(m=>[m,memberNeedsTraining(m)?'Train '+(isHackGang?'Hacking':'Combat'):assignedTasks[m]])),wantedGainTolerance,optStat,myGangMembers.filter(m=>memberNeedsTraining(m)));
    if(crewPlan&&betterGangPlan(crewPlan.wanted,crewPlan.value,bestWanted,bestTotalGain,wantedGainTolerance))
        [bestTaskAssignments,bestTotalGain,bestWanted]=[crewPlan.assignments,crewPlan.value,crewPlan.wanted];
    for (let shuffle = 0; shuffle < 100; shuffle++) { // We can discover more optimal results by greedy-optimizing gang members in a different order. Try a few.
        let proposedTasks = {}, totalWanted = 0, totalGain = 0;
        shuffleArray(myGangMembers.slice()).forEach((member, index) => {
            const taskRates = memberTaskRates[member];
            // "Greedy" optimize one member at a time, but as we near the end of the list, we can no longer expect future members to make for wanted increases
            const sustainableTasks = (index < myGangMembers.length - 2) ? taskRates : taskRates.filter(c => (totalWanted + c.wanted) <= wantedGainTolerance);
            // Find the crime with the best gain (If we can't generate value for any tasks, then we should only be training)
            const bestTask = taskRates[0][optStat] == 0 || memberNeedsTraining(member) ?
                taskRates.find(t => t.name === ("Train " + (isHackGang ? "Hacking" : "Combat"))) :
                (totalWanted > wantedGainTolerance || sustainableTasks.length == 0) ? taskRates.find(t => t.name === strWantedReduction) : sustainableTasks[0];
            [proposedTasks[member], totalWanted, totalGain] = [bestTask, totalWanted + bestTask.wanted, totalGain + bestTask[optStat]];
        });
        // Compare both recovery paths. A ratio-only greedy repair can overshoot and sacrifice too much production.
        const trainingMembers=myGangMembers.filter(m=>memberNeedsTraining(m));
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
        const trainingMembers=myGangMembers.filter(m=>memberNeedsTraining(m));
        bestTaskAssignments=improveGangPlan(bestTaskAssignments,memberTaskRates,optStat,wantedGainTolerance,trainingMembers);
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
        // Check that our calculations (which we stole from game source code) are about right
        if ((Math.abs(myGangInfo.wantedLevelGainRate - optWanted) / Math.max(1e-9,Math.abs(optWanted)) > 0.01) || (Math.abs(myGangInfo.respectGainRate - optRespect) / Math.max(1e-9,Math.abs(optRespect)) > 0.01) || (Math.abs(myGangInfo.moneyGainRate - optMoney) / Math.max(1e-9,Math.abs(optMoney)) > 0.01))
            log(ns, `WARNING: Calculated new rates would be Rep:${formatNumberShort(optRespect)} Wanted: ${optWanted.toPrecision(3)} Money: ${formatMoney(optMoney)}` +
                `but they are Rep:${formatNumberShort(myGangInfo.respectGainRate)} Wanted: ${myGangInfo.wantedLevelGainRate.toPrecision(3)} Money: ${formatMoney(myGangInfo.moneyGainRate)}`, false, 'warning');
    } else
        log(ns, `INFO: Determined all ${myGangMembers.length} gang member assignments need no improvement in this pass for ${optStat} with wanted gain tolerance ${wantedGainTolerance.toPrecision(2)} (${elapsed} ms).`);
    // Fail-safe: Recover using the least costly members if observed wanted exceeds the plan.
    if (myGangInfo.wantedLevelGainRate > wantedGainTolerance) await fixWantedGainRate(ns, myGangInfo, wantedGainTolerance, memberTaskRates, optStat);
}

/** @param {NS} ns
 * Logic to reduce crime tiers when we're generating a wanted level **/
async function fixWantedGainRate(ns, myGangInfo, wantedGainTolerance = 0, rates = {}, focus = "respect") {
    let lastWantedLevelGainRate = myGangInfo.wantedLevelGainRate;
    log(ns, `WARNING: Generating wanted levels (${lastWantedLevelGainRate.toPrecision(3)}/sec > ${wantedGainTolerance.toPrecision(3)}/sec), assigning the least costly members to wanted reduction...`, false, 'warning');
    for (const member of wantedRecoveryOrder(myGangMembers,assignedTasks,rates,strWantedReduction,focus)) {
        if(memberNeedsTraining(member))continue;
        if (assignedTasks[member] === strWantedReduction) continue; // This member isn't doing crime, so they aren't contributing to wanted
        assignedTasks[member] = strWantedReduction;
        await updateMemberActivities(ns);
        const wantedLevelGainRate = (myGangInfo = await waitForGameUpdate(ns, myGangInfo)).wantedLevelGainRate;
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
async function tryAscendMembers(ns, gangInfo) {
    const dictAscensionResults=await getGangInfoDict(ns,myGangMembers,'getAscensionResult');
    const candidates=chooseGangAscensions(dictAscensionResults,gangInfo,myGangMembers,importantStats,
        options['ascend-multi-threshold'],options['ascend-multi-threshold-spacing'],options['disable-adaptive-growth']?1:12,!options['disable-adaptive-growth']);
    const plans=[];
    if(options['disable-adaptive-growth'])plans.push(...candidates.map(c=>({name:c.name,economics:null})));
    else if(candidates.length){
        const members=await getGangInfoDict(ns,myGangMembers,'getMemberInformation');
        for(const candidate of candidates){
            const member=candidate.name,ascResult=dictAscensionResults[member],original=members[member];
            if(Date.now()-(lastMemberReset[member]||0)<60000)continue;
            const retained={...original},training=allTaskStats['Train '+(isHackGang?'Hacking':'Combat')];
            const keep=Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,original.augmentations.reduce((m,a)=>m*(equipments.find(e=>e.name===a)?.stats[k]||1),1)]));
            for(const k of ['hack','str','def','dex','agi','cha']){retained[k+'_exp']=0;retained[k+'_mult']=keep[k];retained[k+'_asc_mult']=(original[k+'_asc_mult']||1)*(ascResult[k]||1);}
            // Compare integrated crew production, including global wanted effects and recruit delay.
            const plan=forecastGangAscension({members,name:member,ascended:retained,gang:gangInfo,training,
                tasks:allTaskStats,assignments:assignedTasks,evaluate:(m,g,task)=>memberBestValue(m,g,null,task),
                respectLoss:Math.max(0,ascResult.respect||0),horizonSeconds:options['growth-horizon-minutes']*60});
            const economics=plan?{...plan,adaptive:true,restoreEquipment:false,name:member,member:original,ascension:ascResult,
                gang:gangInfo,crewNames:myGangMembers.slice(),respectLoss:Math.max(0,ascResult.respect||0),expiresAt:Date.now()+5000}:null;
            if(economics)plans.push({name:member,economics});
        }
        plans.sort((a,b)=>a.economics.paybackSeconds-b.economics.paybackSeconds);
        plannedAscensions=new Set(plans.map(p=>p.name));
    }
    for(const {name:member,economics} of plans){
        const ascResult=dictAscensionResults[member];
        if(await getNsDataThroughFile(ns,`(${ascendGangMemberSafely.toString()})(ns,ns.args[0],JSON.parse(ns.args[2]),ns.args[3],ns.args[4],(${chooseGangAscensions.toString()}),ns=>(${gangMutationAllowed.toString()})(ns,ns.args[1]),JSON.parse(ns.args[5]))`,
            '/Temp/gang-ascend-member.txt',[member,ns.pid,JSON.stringify(importantStats),options['ascend-multi-threshold'],options['ascend-multi-threshold-spacing'],JSON.stringify(economics)])){
            log(ns,`SUCCESS: Ascended member ${member}: ${importantStats.map(k=>k+' -> '+ascResult[k].toFixed(2)+'x').join(', ')}.`);
            lastMemberReset[member]=Date.now();assignedTasks[member]='Train '+(isHackGang?'Hacking':'Combat');
            plannedAscensions.delete(member); // Buying equipment after the reset cannot discard it in that reset.
            await saveGangTraining(ns);break;
        }
    }
}

/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMembers
 * Upgrade any missing equipment / augmentations of members if we have the budget for it **/
async function tryUpgradeMembers(ns, dictMembers) {
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
        const shadow=gangObjectiveWeight(purchaseGoal);
        const gang=await getNsDataThroughFile(ns,'ns.gang.getGangInformation()');
        const locked=myGangMembers.filter(name=>memberNeedsTraining(name));
        const workTask=name=>locked.includes(name)?'Train '+(isHackGang?'Hacking':'Combat'):assignedTasks[name]||dictMembers[name].task;
        const cache=new WeakMap();
        const ratesFor=member=>{
            if(cache.has(member))return cache.get(member);
            const names=locked.includes(member.name)?[workTask(member.name)]:allTaskNames.filter(t=>!t.startsWith('Train ')&&t!=='Territory Warfare');
            const rates=names.map(name=>{const money=calculateMoneyGains(gang,name,member)*5,respect=computeRepGains(gang,name,member)*5,wanted=computeWantedGains(gang,name,member)*5;
                return {name,money,respect,wanted,value:gangObjectiveValue({money,respect},growthFocus,shadow)};});
            cache.set(member,rates);return rates;
        };
        let previousCrew=[],baselineTeam=null,baselineRates=null;
        const quoteCache=new Map();
        const evaluate=(member,equip,crew=dictMembers)=>{
            if(equip.type!=='Augmentation'&&plannedAscensions.has(member.name))return null;
            const baseline=member,upgraded=projectGangMember(member,null,0,equip.stats);
            const values=Object.values(crew);
            if(values.length!==previousCrew.length||values.some((m,i)=>m!==previousCrew[i])){
                previousCrew=values;quoteCache.clear();baselineRates=Object.fromEntries(values.map(m=>[m.name,ratesFor(m)]));
                baselineTeam=planGangWantedCrew(baselineRates,Object.fromEntries(values.map(m=>[m.name,workTask(m.name)])),gangWantedTolerance(gang,wantedPenaltyThreshold)*5,'value',locked);
            }
            const quoteKey=JSON.stringify([member.name,equip.stats]);
            if(quoteCache.has(quoteKey))return quoteCache.get(quoteKey);
            const base=baselineTeam;
            const next=planGangWantedCrew({...baselineRates,[member.name]:ratesFor(upgraded)},Object.fromEntries(values.map(m=>[m.name,workTask(m.name)])),gangWantedTolerance(gang,wantedPenaltyThreshold)*5,'value',locked);
            const task=workTask(member.name);
            // Cash payback follows current feasible work, not an unconstrained future task.
            const moneyGain=allTaskStats[task]?Math.max(0,calculateMoneyGains(gang,task,upgraded)-calculateMoneyGains(gang,task,baseline))*5:0;
            const respectGain=allTaskStats[task]?Math.max(0,computeRepGains(gang,task,upgraded)-computeRepGains(gang,task,baseline))*5:0;
            const objectiveGain=base&&next?Math.max(0,next.value-base.value)*(growthFocus==='money'?1:shadow):0;
            const quote={moneyGain,objectiveGain,respectGain:base&&next?Math.max(0,next.respect-base.respect):respectGain,relativeObjectiveGain:base?.value>0&&next?(next.value-base.value)/base.value:0};
            quoteCache.set(quoteKey,quote);return quote;
        };
        const bootstrapBudget=options['money-focus']||(options['equipment-budget']===0&&options['augmentations-budget']===0)?0:Math.min(homeMoney*.01,sharedGangAllowance(ns,homeMoney*.01));
        const available=Math.min(sharedGangAllowance(ns,homeMoney*.2),homeMoney*.2);
        const equipmentLimit=options['equipment-budget']===null?homeMoney*.05:homeMoney*options['equipment-budget'];
        const augLimit=options['augmentations-budget']===null?homeMoney*.2:homeMoney*options['augmentations-budget'];
        const plan=planMarginalGangEquipment({members:dictMembers,equipment:equipments,evaluate,crewAware:true,horizon:options['growth-horizon-minutes']*60,
            recruitment:{memberCount:myGangMembers.length,respectRate:Math.max(0,gang.respectGainRate)*5,respectGap:Math.max(0,gang.respectForNextRecruit-gang.respect),allowProgression:growthFocus!=='money'},
            budgets:{available,equipmentLimit,augLimit,bootstrapBudget}});
        const opportunity=plan.firstOpportunity;
        equipmentOpportunity=opportunity?{paybackSeconds:opportunity.paybackSeconds,cashPaybackSeconds:opportunity.cashPaybackSeconds,valuePaybackSeconds:opportunity.valuePaybackSeconds,cost:opportunity.cost,reason:opportunity.reason,recruitSecondsSaved:opportunity.recruitSecondsSaved}:null;
        equipmentDiagnostics={...plan.diagnostics,ownership:Object.fromEntries(Object.values(dictMembers).map(m=>[m.name,{upgrades:m.upgrades,augmentations:m.augmentations}]))};
        orders=plan.orders;
        await ns.write('tasks/gang-growth.json',JSON.stringify({schemaVersion:2,at:Date.now(),pid:ns.pid,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,equipmentOpportunity,equipmentDiagnostics}),'w');
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
    const orderOutcomes = await getNsDataThroughFile(ns, `(() => { const claimSpending=${claimSpending.toString()}; return (${purchaseGangEquipment.toString()})(ns,JSON.parse(ns.args[0]),ns.args[1],ns.args[2],claimSpending,ns=>(${gangMutationAllowed.toString()})(ns,ns.args[3]),true); })()`,
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

let sequentialMisfires = 0;

/** Helper to wait for the game to update stats (typically 2 seconds per cycle)
 * @param {NS} ns
 * @param {GangGenInfo} oldGangInfo
 * @returns {Promise<GangGenInfo>} **/
async function waitForGameUpdate(ns, oldGangInfo) {
    if (!myGangMembers.some(member => !assignedTasks[member].includes("Train")))
        return oldGangInfo; // Ganginfo will never change if all members are training, so don't wait for an update
    const maxWaitTime = 2500;
    const waitInterval = 100;
    const start = Date.now()
    while (Date.now() < start + maxWaitTime) {
        var latestGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
        if (JSON.stringify(latestGangInfo) != JSON.stringify(oldGangInfo)) {
            sequentialMisfires = 0;
            return latestGangInfo;
        }
        await ns.sleep(Math.min(waitInterval, start + maxWaitTime - Date.now()));
    }
    sequentialMisfires++;
    log(ns, `WARNING: Max wait time ${maxWaitTime} exceeded while waiting for old gang info to update.\n${JSON.stringify(oldGangInfo)}\n===\n${JSON.stringify(latestGangInfo)}`,
        false, sequentialMisfires < 2 ? null : 'warning'); // Only pop-up an alert if this happens twice in a row (or more)
    territoryTickDetected = false;
    return latestGangInfo;
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
 await ns.write('tasks/gang-training.json',JSON.stringify({nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,members:lastMemberReset}),'w');
}


function sharedGangAllowance(ns,fallback){
 try{const p=JSON.parse(ns.read('tasks/spending-plan.json'));if(p.expiresAt>Date.now()&&p.reset===resetInfo.lastAugReset&&ns.isRunning(p.ownerPid)){
    let used=0;try{const u=JSON.parse(ns.read('tasks/spending-usage.json'));if(u.epoch===p.epoch)used=Number(u.spent?.gang)||0;}catch{}
    return Math.max(0,(Number(p.allowances?.gang)||0)-used);
 }}catch{}return fallback;
}
async function updateGrowthFocus(ns,gang){
 const player=await getNsDataThroughFile(ns,'ns.getPlayer()');
 let factionRep=gang.respect/75;
 if(ownedSourceFiles[4]>0)try{factionRep=await getNsDataThroughFile(ns,'ns.singularity.getFactionRep(ns.args[0])',null,[myGangFaction]);}catch{}
 growthFocus=gangFocus({reputationFocus:options['reputation-focus'],moneyFocus:options['money-focus'],members:myGangMembers.length,
  factionRep,requiredRep,money:Math.max(0,player.money-(Number(ns.read('reserve.txt'))||0)),respect:gang.respect,goal:options['disable-adaptive-growth']?null:purchaseGoal});
 return growthFocus;
}
function refreshForecastWantedLimits(members,gang){
 const rates=Object.fromEntries(Object.values(members).map(m=>[m.name,allTaskStats[assignedTasks[m.name]||m.task]?computeWantedGains(gang,assignedTasks[m.name]||m.task,m):0]));
 const total=Object.values(rates).reduce((a,b)=>a+b,0),tolerance=gangWantedTolerance(gang,wantedPenaltyThreshold);
 forecastWantedLimits=Object.fromEntries(Object.entries(rates).map(([name,rate])=>[name,tolerance-(total-rate)]));
}
function memberBestValue(member,gang,shadow=null,forcedTask=null){
 const weight=shadow??gangObjectiveWeight(purchaseGoal);
 const rate=task=>{
  const money=calculateMoneyGains(gang,task,member)*5,respect=computeRepGains(gang,task,member)*5,wanted=computeWantedGains(gang,task,member)*5;
  return {value:gangObjectiveValue({money,respect},growthFocus,weight),task,money,respect,wanted};
 };
 if(forcedTask&&allTaskStats[forcedTask])return rate(forcedTask);
 let best=rate('Train '+(isHackGang?'Hacking':'Combat'));
 for(const task of allTaskNames){
  if(task.startsWith('Train ')||task==='Territory Warfare')continue;
  const candidate=rate(task);
  if(candidate.wanted/5>(forecastWantedLimits[member.name]??Infinity))continue;
  if(candidate.value>best.value)best=candidate;
 }return best;
}
function refreshTrainingPlans(members,gang){
 if(options['disable-adaptive-growth'])return;
 trainingPlans={};trainingForecasts={};
 const task=allTaskStats['Train '+(isHackGang?'Hacking':'Combat')];
 for(const member of Object.values(members)){
  const now=memberBestValue(member,gang);
  const elapsed=Date.now()-(lastMemberReset[member.name]??0),maximum=options['min-training-ticks']*territoryTickTime;
  const imminentRecruit=myGangMembers.length<12&&gang.respectForNextRecruit>0&&gang.respect>=gang.respectForNextRecruit*.8;
  const permitted=elapsed<maximum||!options['no-training'];
  if(elapsed>=2000&&now.value>0&&(imminentRecruit||!permitted)){
   trainingPlans[member.name]=false;
   trainingForecasts[member.name]={train:false,window:0,reason:imminentRecruit?'Preserve imminent recruit':'Training disabled outside recovery window'};
   continue;
  }
  const forecast=forecastGangTraining(member,task,allTaskStats,m=>memberBestValue(m,gang),options['growth-horizon-minutes']*60);
  trainingForecasts[member.name]={...forecast,reason:imminentRecruit&&now.value>0?'Preserve imminent recruit':!permitted?'Training disabled outside recovery window':forecast.train?'Forecasted training gains exceed continued work':'Continue productive work'};
  trainingPlans[member.name]=elapsed<2000 || permitted && (now.value<=0&&elapsed<maximum ||
    forecast.train&&!(imminentRecruit&&now.value>0));

 }
}
function memberNeedsTraining(name){
 if(!options['disable-adaptive-growth']&&typeof trainingPlans[name]==='boolean')return trainingPlans[name];
 return gangTrainingRequired(lastMemberReset[name],Date.now(),options['min-training-ticks'],territoryTickTime);
}
