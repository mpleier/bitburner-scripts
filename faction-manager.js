import {readSoAInfiltrationIncome,wksAugmentation} from './soa-policy.js';
import {publishAugmentationPurchase} from './augmentation-install-policy.js';
import {readAugmentationReputationContext} from './augmentation-reputation-policy.js';
import {estimateMixedAugmentationWait} from './progression-speed-policy.js';
import {readCombatGrowthContext} from './combat-growth-policy.js';
import {augmentationBatchFunded,captureAugmentationEconomics,augmentationEconomicsChange,invalidateAugmentationFunding} from './augmentation-economics-policy.js';
import {captureAugmentationOwnership} from './augmentation-ownership-policy.js';
import {augmentationCashReserve} from './spending-policy.js';
import {ensureFactionJoinPlan} from './faction-joining.js';
import {readNodeRoutePlan} from './node-route-policy.js';
import { augmentationPurchaseBudget,extendNeuroFluxOrder,augmentationStatFilters,factionTerminalOutput,chooseNeuroFluxFaction,augmentationDonationTopUp,augmentationPrerequisiteChain,selectAugmentationBasketDrop,optimizeAugmentationOrder,futureAugmentationBasketCost,pruneAugmentationPrerequisites,neuroFluxLevels,augmentationCountCandidates,selectGangAugmentationGoal,factionJoinAllowed,rankFactionInvites,gangHostPreferences,factionForcedJoins, factionControlAllowed, factionPurchaseBatch } from './faction-policy.js';
import { isScriptPaused } from './automation-control.js';
import { achievementActionAllowed } from './achievement-policy.js';
import {
    log, getConfiguration, instanceCount, formatNumberShort, formatMoney,
    getNsDataThroughFile, getActiveSourceFiles, tryGetBitNodeMultipliers, getStocksValue
} from './helpers.js'

// PLAYER CONFIGURATION CONSTANTS
// This acts as a list of default "easy" factions to always show even if the user has --hide-locked-factions
const easyAccessFactions = [
    "Tian Di Hui", "Sector-12", "Chongqing", "New Tokyo", "Ishima", "Aevum", "Volhaven", // Location-Based
    "BitRunners", "CyberSec", "NiteSec", /* Hack Based */ "Netburners", /* Hacknet-based */ "Slum Snakes", "Tetrads", /* Early Crime */
];
const default_priority_augs = ["The Red Pill", "The Blade's Simulacrum", "Neuroreceptor Management Implant"]; // By default, take these augs when they are accessible
const default_desired_augs = ["CashRoot Starter Kit"] // By default, mark these augs as "desired" regardless of their stats
// If not in a gang, and we are nearing unlocking gangs (54K Karma) we will attempt to join any/all of these factions
const potentialGangFactions = ["Slum Snakes", "Tetrads", "The Black Hand", "The Syndicate", "The Dark Army", "Speakers for the Dead"];
const default_hidden_stats = ['bladeburner', 'hacknet']; // Hide from the summary table by default because they clearly all come from one faction.
const output_file = "/Temp/affordable-augs.txt"; // Temp file produced for autopilot.js to relay information about current owned & affordable augs.
const staneksGift = "Stanek's Gift - Genesis";
const factionsWithoutDonation = ["Bladeburners", "Church of the Machine God", "Shadows of Anarchy"]; // Not allowed to donate to these factions for rep

// Factors used in calculations
const nfCountMult = 1.14; // Factors that control how NeuroFlux prices scale
let augCountMult = 1.9; // The multiplier for the cost increase of augmentations (changes based on SF11 level)
let favorToDonate = 0; // Based on the current BitNode Multipliers, the favour required to donate to factions for reputation.
// Various globals because this script does not do modularity well. Assigned values are all ignored, just used to get type hints
let playerData = (/**@returns{Player}*/() => null)(), bitNode = 0, gangFaction = "";
let numAugsAwaitingInstall = 0, nfLevelPurchased = 0, startingPlayerMoney = 0, stockValue = 0; // If the player holds stocks, their liquidation value will be determined
let factionNames = [""], joinedFactions = [""], desiredAugs = [""], desiredStatsFilters = [""], purchaseFactionDonations = [];
let ownershipSnapshot=null,economicsSnapshot=null;
let ownedAugmentations = [""], simulatedOwnedAugmentations = [""], allAugStats = [""], priorityAugs = [""];
let effectiveSourceFiles = (/**@returns {{[bitNode: number]: number}}*/() => ({}))();
let factionData = (/**@returns {{[factionName: string]: FactionData}}*/() => ({}))();
let augmentationData = (/**@returns {{[augmentationName: string]: AugmentationData}}*/() => ({}))();
let purchaseableAugs = (/**@returns {AugmentationData[]}*/() => [])();
let preNeuroFluxPlan=null;
let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)();
let printToTerminal, ignorePlayerData;
let _ns; // Used to avoid passing ns to functions that don't need it except for some logs.

let options = null; // A copy of the options used at construction time
const argsSchema = [ // The set of all command line arguments
    ['all', false], // Display all factions (spoilers), not just accessible factions
    ['a', false], // Flag-style alias for --all.
    ['hide-locked-factions', false], // Don't show factions that we don't currently have access to
    ['log-only', false], // Keep all reports in script logs, overriding saved verbose settings. Used by automatic launches.
    ['verbose', false], // Also print reports to the terminal when explicitly enabled. Routine output stays in script logs.
    ['v', false], // (Kept for backwards compatilily) this was an alias flag for setting --verbose to true when it previously defaulted to false.
    ['ignore-player-data', false], // Display stats for all factions and augs, despite what we already have (kind of a "mock" mode)
    ['i', false], // Flag alias for --ignore-player-data
    // soa-manager.js purchases Shadows of Anarchy upgrades separately using their special money and reputation prices.
    ['ignore-faction', ["Shadows of Anarchy"]], // Factions to omit from all data, stats, and calcs, (e.g.) if you do not want to purchase augs from them, or do not want to see them because they are impractical to join at this time
    ['after-faction', []], // Pretend we were to buy all augs offered by these factions. Show us only what remains.
    ['force-join', null], // Always join these factions if we have an invite (useful to force join a gang faction)
    // Augmentation purchasing-related options. Controls what augmentations are included in cost calculations, and optionally purchased
    ['priority-aug', []], // If accessible, every effort is made not to drop these from the sort purchase order.
    ['omit-aug', []], // Augmentations to exclude from the augmentation list (e.g. because we do not wish to purchase it yet)
    ['aug-desired', []], // These augs will be marked as "desired" whether or not they match desired-stats
    ['disable-count-building', false], // Do not add cheap unique augmentations toward Daedalus entry.
    ['stat-desired', []], // Augs that give these will be starred (marked as desired and staged for purchase). If empty, defaults are picked based on your situation.
    ['neuroflux-disabled', false], // Set to true to skip including as many neuroflux upgrades as we can afford
    ['disable-donations', false], // When displaying "obtainable" augs and prices, don't include augs that require a donation to meet their rep requirements
    ['purchase-request', ''], // Internal reset-scoped purchase receipt requested by ascend.js
    ['purchase', false], // Set to true to pull the trigger on purchasing all desired augs in the order specified
    ['ignore-stocks', false], // Set to true to ignore the liquidation value of stocks currently held when running
    ['ignore-stanek', false], // Set to true to ignore the fact that stanek is not yet taken before purchasing your first augs
    ['show-unavailable-aug-purchase-order', false], // Set to true to print the list of unavailable augmentations in optimal purchase order. (Note: Always displayed when no augs are available)
    ['show-all-purchase-lists', false], // Set to true to re-print the list of augmentations each time it changes
    // Display-related options - controls what information is displayed in the final "cumulative stats by faction" table
    ['sort', null], // What stat is the table of total faction stats sorted by. Defaults to your first --stat-desired
    ['hide-stat', []], // Stats to exclude from the final table (partial matching works)
    ['unique', false], // When displaying cumulative stats by faction, only include augs not given by a faction further up the list
    ['u', false], // Flag alias for --unique
];

// For convenience, these lists provide command-line <tab> auto-complete values
const stat_multis = ["agility_exp", "agility", "charisma_exp", "charisma", "company_rep", "crime_money", "crime_success", "defense_exp", "defense", "dexterity_exp", "dexterity",
    "faction_rep", "hacking_chance", "hacking_exp", "hacking_grow", "hacking_money", "hacking", "hacking_speed", "strength_exp", "strength", "work_money",
    "bladeburner_analysis", "bladeburner_max_stamina", "bladeburner_stamina_gain", "bladeburner_success_chance",
    "hacknet_node_core_cost", "hacknet_node_level_cost", "hacknet_node_money", "hacknet_node_purchase_cost", "hacknet_node_ram_cost"];
const statShortcuts = ["agi_exp", "agi", "cha_exp", "cha", "cmp_rep", "crm_$", "crm_prob", "def_exp", "def", "dex_exp", "dex", "fac_rep", "hack_prob", "hack_exp", "hack_grow", "hack_$", "hack", "hack_speed", "str_exp", "str", "work_$", 'bladeburner', 'hacknet'];
const statPlayer = ["hacking", "strength", "defense", "dexterity", "agility", "charisma"]; // Since these are substrings of other stats, we can specifically request this stat with e.g. "hacking_level"
const allFactions = ["Illuminati", "Daedalus", "The Covenant", "ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries", "NWO", "Clarke Incorporated", "OmniTek Incorporated",
    "Four Sigma", "KuaiGong International", "Fulcrum Secret Technologies", "BitRunners", "The Black Hand", "NiteSec", "Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12",
    "Volhaven", "Speakers for the Dead", "The Dark Army", "The Syndicate", "Silhouette", "Tetrads", "Slum Snakes", "Netburners", "Tian Di Hui", "CyberSec", "Bladeburners", "Church of the Machine God", "Shadows of Anarchy"];
// TODO: This list is missing augmentations. Regenerate.
const augmentations = ["ADR-V1 Pheromone Gene", "ADR-V2 Pheromone Gene", "Artificial Bio-neural Network Implant", "Artificial Synaptic Potentiation", "Augmented Targeting I", "Augmented Targeting II", "Augmented Targeting III", "BLADE-51b Tesla Armor", "BLADE-51b Tesla Armor: Energy Shielding Upgrade", "BLADE-51b Tesla Armor: IPU Upgrade", "BLADE-51b Tesla Armor: Omnibeam Upgrade", "BLADE-51b Tesla Armor: Power Cells Upgrade", "BLADE-51b Tesla Armor: Unibeam Upgrade", "Bionic Arms", "Bionic Legs", "Bionic Spine", "BitRunners Neurolink", "BitWire", "Blade's Runners", "BrachiBlades", "CRTX42-AA Gene Modification", "CashRoot Starter Kit", "Combat Rib I", "Combat Rib II", "Combat Rib III", "CordiARC Fusion Reactor", "Cranial Signal Processors - Gen I", "Cranial Signal Processors - Gen II", "Cranial Signal Processors - Gen III", "Cranial Signal Processors - Gen IV", "Cranial Signal Processors - Gen V", "DataJack", "DermaForce Particle Barrier", "ECorp HVMind Implant", "EMS-4 Recombination", "Embedded Netburner Module", "Embedded Netburner Module Analyze Engine", "Embedded Netburner Module Core Implant", "Embedded Netburner Module Core V2 Upgrade", "Embedded Netburner Module Core V3 Upgrade", "Embedded Netburner Module Direct Memory Access Upgrade", "Enhanced Myelin Sheathing", "Enhanced Social Interaction Implant", "EsperTech Bladeburner Eyewear", "FocusWire", "GOLEM Serum", "Graphene Bionic Arms Upgrade", "Graphene Bionic Legs Upgrade", "Graphene Bionic Spine Upgrade", "Graphene Bone Lacings", "Graphene BrachiBlades Upgrade", "Hacknet Node CPU Architecture Neural-Upload", "Hacknet Node Cache Architecture Neural-Upload", "Hacknet Node Core Direct-Neural Interface", "Hacknet Node Kernel Direct-Neural Interface", "Hacknet Node NIC Architecture Neural-Upload", "HemoRecirculator", "Hydroflame Left Arm", "HyperSight Corneal Implant", "Hyperion Plasma Cannon V1", "Hyperion Plasma Cannon V2", "I.N.T.E.R.L.I.N.K.E.D", "INFRARET Enhancement", "LuminCloaking-V1 Skin Implant", "LuminCloaking-V2 Skin Implant", "NEMEAN Subdermal Weave", "Nanofiber Weave", "Neotra", "Neural Accelerator", "Neural-Retention Enhancement", "Neuralstimulator", "Neuregen Gene Modification", "NeuroFlux Governor", "Neuronal Densification", "Neuroreceptor Management Implant", "Neurotrainer I", "Neurotrainer II", "Neurotrainer III", "Nuoptimal Nootropic Injector Implant", "NutriGen Implant", "ORION-MKIV Shoulder", "OmniTek InfoLoad", "PC Direct-Neural Interface", "PC Direct-Neural Interface NeuroNet Injector", "PC Direct-Neural Interface Optimization Submodule", "PCMatrix", "Photosynthetic Cells", "Power Recirculation Core", "SPTN-97 Gene Modification", "SmartJaw", "SmartSonar Implant", "Social Negotiation Assistant (S.N.A)", "Speech Enhancement", "Speech Processor Implant", "Synaptic Enhancement Implant", "Synfibril Muscle", "Synthetic Heart", "TITN-41 Gene-Modification Injection", "The Black Hand", "The Blade's Simulacrum", "The Red Pill", "The Shadow's Simulacrum", "Unstable Circadian Modulator", "Vangelis Virus", "Vangelis Virus 3.0", "Wired Reflexes", "Xanipher", "nextSENS Gene Modification"]
const strNF = "NeuroFlux Governor"

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--sort" || lastFlag == "--stat-desired" || lastFlag == "--hide-stat")
        return statShortcuts.concat(stat_multis).concat(statPlayer.map(s => `${s}_level`));
    if (lastFlag == "--ignore-faction" || lastFlag == "--after-faction")
        return allFactions.map(f => f.replaceAll(" ", "_")).sort(); // Command line doesn't like spaces
    if (lastFlag == "--omit-aug" || lastFlag == "--aug-desired" || lastFlag == "--priority-aug")
        return augmentations.map(f => f.replaceAll(" ", "_"));
    return [];
}

// Flags -a for all factions, -v to print to terminal
/** @param {NS} ns **/
export async function main(ns) {
    if(isScriptPaused(ns,ns.getScriptName()))return;
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    _ns = ns;

    // Ensure all globals are reset before we proceed with the script, in case we've done things out of order
    augCountMult = favorToDonate = playerData = gangFaction = nfLevelPurchased = startingPlayerMoney = stockValue = null;
    factionNames = [], joinedFactions = [], desiredAugs = [], desiredStatsFilters = [], purchaseFactionDonations = [];
    ownedAugmentations = [], simulatedOwnedAugmentations = [], effectiveSourceFiles = {}, allAugStats = [], priorityAugs = [], purchaseableAugs = []; preNeuroFluxPlan=null;
    factionData = {}, augmentationData = {}, bitNodeMults = {};

    printToTerminal = factionTerminalOutput(options);
    ignorePlayerData = options.i || options['ignore-player-data'];
    const afterFactions = options['after-faction'].map(f => f.replaceAll("_", " "));
    const omitAugs = options['omit-aug'].map(f => f.replaceAll("_", " "));
    // Set up augs which should take priority (in our purchase budget) over all others
    priorityAugs = options['priority-aug']?.map(f => f.replaceAll("_", " "));
    if (priorityAugs.length == 0) priorityAugs = default_priority_augs;
    // Set up "desired augs" to always include in our purhase order (but with standard priority). Should include priority-augs as well
    desiredAugs = options['aug-desired'].map(f => f.replaceAll("_", " "));
    if (desiredAugs.length == 0) desiredAugs = default_desired_augs;
    desiredAugs = priorityAugs.concat(desiredAugs);

    // Determine which source files are active, which, for one, lets us determine how the cost of augmentations will scale
    playerData = await getPlayerInfo(ns);
    let resetInfo = (/**@returns{ResetInfo}*/() => null)(); // Hack to get type hints despite use of ram-dodging
    resetInfo = await getNsDataThroughFile(ns, `ns.getResetInfo()`);
    bitNode = resetInfo.currentNode;
    const ownedSourceFiles = await getActiveSourceFiles(ns, false);
    effectiveSourceFiles = await getActiveSourceFiles(ns, true);
    const sf4Level = effectiveSourceFiles[4] || 0; // If in BN4, singularity costs are as though you had SF4.3
    if (sf4Level == 0)
        return log(ns, `ERROR: This script requires SF4 (singularity) functions to work.`, printToTerminal, 'error');
    else if (sf4Level < 3)
        log(ns, `WARNING: This script makes heavy use of singularity functions, which are quite expensive before you have SF4.3. ` +
            `Unless you have a lot of free RAM for temporary scripts, you may get runtime errors.`);
    const sf11Level = ownedSourceFiles[11] || 0;
    augCountMult = 1.9 * [1, 0.96, 0.94, 0.93][sf11Level];

    log(ns, `Player has sf11Level ${sf11Level}, so the multiplier after each aug purchased is ${augCountMult}.`);

    // Count planning and all augmentation quotes must use this node's native multipliers.
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    // Collect information about the player
    const gangInfo = await getGangInfo(ns);
    gangFaction = gangInfo ? gangInfo.faction : null;
    favorToDonate = await getNsDataThroughFile(ns, 'ns.getFavorToDonate()');
    startingPlayerMoney = playerData.money;
    stockValue = options['ignore-stocks'] ? 0 : await getStocksValue(ns);
    joinedFactions = ignorePlayerData ? [] : playerData.factions;
    log(ns, 'In factions: ' + joinedFactions);
    // Get owned augmentations (whether they've been installed or not). Ignore strNF because you can always buy more.
    ownershipSnapshot=await getNsDataThroughFile(ns,`(${captureAugmentationOwnership.toString()})(ns)`,'/Temp/faction-augmentation-ownership.txt');
    if(!ownershipSnapshot?.complete||ownershipSnapshot.augReset!==resetInfo.lastAugReset||ownershipSnapshot.nodeReset!==resetInfo.lastNodeReset)
        return log(ns,'Augmentation ownership is unavailable or reset changed; deferring planning.',printToTerminal,'warning');
    ownedAugmentations=ownershipSnapshot.owned;
    const installedAugmentations=ownershipSnapshot.installed;
    numAugsAwaitingInstall=ownershipSnapshot.queued.length;
    const nfLevels=neuroFluxLevels({ownedAugs:Object.fromEntries(ownershipSnapshot.levels)},ownershipSnapshot.queued);
    if(!nfLevels)return log(ns,'Native NeuroFlux ownership data is unavailable; deferring augmentation planning.',printToTerminal,'warning');
    nfLevelPurchased=nfLevels.purchased;
    if (options['neuroflux-disabled']) omitAugs.push(strNF);
    simulatedOwnedAugmentations = ignorePlayerData ? [] : ownedAugmentations.filter(a => a != strNF);
    // Clear "priority" / "desired" lists of any augs we already own
    priorityAugs = priorityAugs.filter(name => !simulatedOwnedAugmentations.includes(name));
    desiredAugs = desiredAugs.filter(name => !simulatedOwnedAugmentations.includes(name));
    const augmentationRoute=readNodeRoutePlan(ns)?.selected||([6,7].includes(bitNode)||playerData.factions.includes('Bladeburners')?'bladeburner':'hacking');
    desiredStatsFilters=augmentationStatFilters({route:augmentationRoute,node:bitNode,explicit:options['stat-desired']});
    log(ns, 'Desired stats filter: ' + JSON.stringify(desiredStatsFilters));

    // Prepare global data sets of faction and augmentation information
    log(ns, 'Getting all faction data...');
    await updateFactionData(ns, options['ignore-faction'].map(f => f.replaceAll("_", " ")));
    log(ns, 'Getting all augmentation data...');
    await updateAugmentationData(ns);
    if(!ignorePlayerData&&!await refreshAugmentationQuotes(ns))return log(ns,'Native augmentation quotes unavailable; deferring planning.',printToTerminal);

    if(augmentationRoute!=='bladeburner'&&!options['disable-count-building']&&!options['stat-desired'].length&&!playerData.factions.includes('Daedalus')){
        const needed=bitNodeMults.DaedalusAugsRequirement||30;
        const candidates=Object.values(augmentationData).filter(a=>!omitAugs.includes(a.name)).map(a=>({name:a.name,price:a.price,rep:a.reputation,
            prereqs:a.prereqs,available:a.joinedFactionsWithAug().length>0}));
        const countAugs=augmentationCountCandidates(candidates,ownedAugmentations,needed,augmentationPurchaseBudget(playerData.money,stockValue,ns.read("reserve.txt")));
        for(const name of countAugs)augmentationData[name].desired=true;
        if(countAugs.length)log(ns,'Daedalus count additions: '+countAugs.join(', '));
    }
    // Join available factions that would give access to additional desired augmentations
    if (ignorePlayerData)
        log(ns, 'INFO: Skipping joining available factions due to the --ignore-player-data flag set.');
    else {
        log(ns, 'Joining available factions...');
        const forceJoinFactions = factionForcedJoins(options['force-join'],bitNode,gangFaction,Number(effectiveSourceFiles[2])>0,ns.heart.break(),gangHostPreferences(ns));
        let joined = await joinFactions(ns, forceJoinFactions);
        if (joined) log(ns, `SUCCESS: Joined ${joined} factions.`);
        if(joined&&!await refreshAugmentationQuotes(ns))return log(ns,'Quotes unavailable after joining factions; deferring planning.',printToTerminal);
        displayJoinedFactionSummary(ns);
    }

    // Display the summary of all factions and total aug stats available from each
    let hideSummaryStats = options['hide-stat'];
    if (hideSummaryStats.length == 0) hideSummaryStats = default_hidden_stats;
    const sort = unshorten(options.sort || desiredStatsFilters[0]);
    displayFactionSummary(ns, sort, options.u || options.unique, afterFactions, hideSummaryStats);

    // Create the table of all augmentations, and the breakdown of what we can afford
    const redPill=readNodeRoutePlan(ns)?.redPill;
    let achievementQueue=false;try{const g=JSON.parse(ns.read('tasks/achievement-goals.json'));achievementQueue=g.expiresAt>Date.now()&&g.nodeReset===resetInfo.lastNodeReset&&ns.isRunning(g.ownerPid)&&g.minimumQueue>0;}catch{}
    if(redPill?.active&&!['prepare','favor-reset'].includes(redPill.stage)&&!(redPill.stage==='install'&&achievementQueue)) {
        options['neuroflux-disabled']=true;omitAugs.push(strNF);
        for(const a of Object.values(augmentationData))if(a.name!=='The Red Pill'){a.desired=false;omitAugs.push(a.name);}
    }
    await manageUnownedAugmentations(ns, omitAugs);

    if (options.purchase && ownedAugmentations.length <= 1 && 13 in ownedSourceFiles && !ownedAugmentations.includes(staneksGift) && !options['ignore-stanek'])
        log(ns, `WARNING: You have not yet accepted Stanek's Gift from the church in Chongqing. Purchasing augs will ` +
            `prevent you from doing so for the rest of this BN. (Run with '--ignore-stanek' to bypass this warning.)`, printToTerminal);
    else if (options.purchase && purchaseableAugs) {
        const outcome=await purchaseDesiredAugs(ns);
        await publishAugmentationPurchase(ns,options['purchase-request'],resetInfo,outcome,purchaseableAugs.length);
        ns.write(output_file, "", "w"); // Clear the file so it isn't misinterpreted on next reset.
    } else if (!ignorePlayerData) { // Don't do this next part if we were "mocking" the player for this run
        // Write a file that summarizes what augs we could afford if we could ascend right now. (used by autopilot.js)
        const augsAwaitingInstall = ownershipSnapshot.queued;
        // Native total NF levels minus explicitly queued levels gives installed NF levels
        const nfInstalled = nfLevelPurchased - augsAwaitingInstall.filter(a => a == strNF).length;
        const readyAugs=augsAwaitingInstall.concat(purchaseableAugs.map(a=>a.name));
        const readySet=new Set(readyAugs);
        // Waiting may forgo unpurchased optional NF; installing now still receives the full ready basket.
        const preserveOptionalNeuroFlux=priorityAugs.includes(strNF)||!preNeuroFluxPlan;
        const futurePurchaseAugs=preserveOptionalNeuroFlux?purchaseableAugs:preNeuroFluxPlan.augmentations;
        const futureDonationPlan=preserveOptionalNeuroFlux?purchaseFactionDonations:preNeuroFluxPlan.donations;
        const futureReadyAugs=augsAwaitingInstall.concat(futurePurchaseAugs.map(a=>a.name));
        const plannedDonations=Object.values(futureDonationPlan).reduce((t,r)=>t+r,0);
        let resetEconomics={known:false,replacementCost:null,gangLossPerSecond:Math.max(0,gangInfo?.moneyGainRate||0)*5*.05};
        if(bitNode===9&&resetInfo.lastAugReset===resetInfo.lastNodeReset)try{
            resetEconomics=await getNsDataThroughFile(ns,`(() => {
                const p=ns.getPlayer(),f=ns.formulas.hacknetServers;
                let replacementCost=0;
                for(let i=0;i<ns.hacknet.numNodes();i++){
                    const n=ns.hacknet.getNodeStats(i);if(!Number.isFinite(n.ram))throw new Error('Not a Hacknet server');
                    replacementCost+=f.hacknetServerCost(i+1,p.mults.hacknet_node_purchase_cost)+
                        f.levelUpgradeCost(1,Math.max(0,n.level-1),p.mults.hacknet_node_level_cost||1)+
                        f.ramUpgradeCost(1,Math.max(0,Math.log2(n.ram)),p.mults.hacknet_node_ram_cost)+
                        f.coreUpgradeCost(1,Math.max(0,n.cores-1),p.mults.hacknet_node_core_cost)+
                        f.cacheUpgradeCost(0,Math.max(0,n.cache));
                }
                if(!Number.isFinite(replacementCost)||replacementCost<0)throw new Error('Invalid rebuild cost');
                return {known:true,replacementCost};
            })()`,'/Temp/augmentation-reset-economics.txt',[],false,1,0,true);
            resetEconomics.gangLossPerSecond=Math.max(0,gangInfo?.moneyGainRate||0)*5*.05;
        }catch{}
        else resetEconomics.known=true,resetEconomics.replacementCost=0;
        if(gangFaction){
            const f=factionData[gangFaction];
            const goal=selectGangAugmentationGoal(Object.values(augmentationData).filter(a=>a.joinedFactionsWithAug().some(f=>f.name===gangFaction))
                .map(a=>({name:a.name,desired:a.desired,cost:a.price,rep:a.reputation,prereqs:a.prereqs})),
                {owned:ownedAugmentations,money:Math.max(0,playerData.money-(Number(ns.read('reserve.txt'))||0)),rep:f?.reputation||0,
                 repRate:Math.max(0,gangInfo.respectGainRate||0)*5*playerData.mults.faction_rep*(1+(f?.favor||0)/100)/75,
                 cashRate:Math.max(0,gangInfo.moneyGainRate||0)*5,multiplier:augCountMult});
            await ns.write('tasks/gang-purchase-goal.json',JSON.stringify({at:Date.now(),nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,faction:gangFaction,goal}),'w');
        }
        let income=null;
        try{income=await getNsDataThroughFile(ns,'({at:Date.now(),sources:ns.getMoneySources().sinceInstall,...((w)=>({workFaction:w?.type==="FACTION"?w.factionName:null,workType:w?.factionWorkType??null}))(ns.singularity.getCurrentWork())})','/Temp/augmentation-income-sources.txt');}catch{}
        const speedSnapshot={income,resetEconomics,gangFaction,gangRepRate:gangFaction?Math.max(0,gangInfo.respectGainRate||0)*5*playerData.mults.faction_rep*(1+(factionData[gangFaction]?.favor||0)/100)/75:0,workFaction:income?.workFaction,workType:income?.workType,repMultiplier:playerData.mults.faction_rep,factionFavor:Object.fromEntries(Object.values(factionData).filter(f=>f.joined).map(f=>[f.name,f.favor])),nodeReset:resetInfo.lastNodeReset,ownershipSignature:ownershipSnapshot.signature,donationUnitCost:playerData.mults.faction_rep>0&&bitNodeMults.FactionWorkRepGain>0?1e6/playerData.mults.faction_rep/bitNodeMults.FactionWorkRepGain:null,installedCount:installedAugmentations.filter(n=>n!==strNF).length,requiredCount:bitNodeMults.DaedalusAugsRequirement||30,at:Date.now(),augReset:resetInfo.lastAugReset,worth:playerData.money+stockValue,
            soa:{installed:installedAugmentations.includes(wksAugmentation),queued:augsAwaitingInstall.includes(wksAugmentation),infiltration:readSoAInfiltrationIncome(ns)},
            ready:readyAugs.map(name=>({name,stats:augmentationData[name]?.stats||{}})),
            waitReady:futureReadyAugs.map(name=>({name,stats:augmentationData[name]?.stats||{}})),
            reputation:Object.fromEntries(Object.values(factionData).filter(f=>f.joined).map(f=>[f.name,f.reputation])),
            targets:Object.values(augmentationData).filter(a=>a.desired&&!a.owned&&!readySet.has(a.name)&&a.name!==strNF&&!omitAugs.includes(a.name))
                .map(a=>{
                    const chain=augmentationPrerequisiteChain(a.name,augmentationData,{owned:simulatedOwnedAugmentations,ready:futureReadyAugs,
                        allowed:item=>!omitAugs.includes(item.name)&&item.joinedFactionsWithAug().length>0});
                    if(!chain)return null;
                    const requirements=chain.map(item=>({rep:item.reputation,factions:item.joinedFactionsWithAug().map(f=>f.name),
                        providers:item.joinedFactionsWithAug().map(f=>({faction:f.name,canDonate:f.donationsUnlocked&&!options['disable-donations'],requiredDonation:f.reputation>=item.reputation?0:
                            f.donationsUnlocked&&!options['disable-donations']?getReqDonationForAug(item,f.name):null}))}));
                    const credits={...futureDonationPlan};let donationCost=0;
                    for(const item of chain){
                        const providers=item.joinedFactionsWithAug();
                        const choice=chooseNeuroFluxFaction(providers.map(f=>({name:f.name,rep:f.reputation,
                            donationCost:f.donationsUnlocked&&!options['disable-donations']?getReqDonationForAug(item,f.name):null})),item.reputation,credits);
                        if(!choice){donationCost=null;break;}
                        donationCost+=augmentationDonationTopUp([{faction:choice.faction,requiredDonation:choice.totalDonation}],credits);
                        credits[choice.faction]=Math.max(credits[choice.faction]||0,choice.totalDonation);
                    }
                    const stats={};
                    for(const item of chain)for(const [key,value]of Object.entries(item.stats||{}))
                        if(Number.isFinite(value)&&value>0)stats[key]=(stats[key]??1)*value;
                    return {name:a.name,stats,chain:chain.map(item=>item.name),requirements,plannedDonations:{...futureDonationPlan},
                        directCost:a.prereqs.every(p=>simulatedOwnedAugmentations.includes(p))?a.price:null,
                        cost:futureAugmentationBasketCost([...futurePurchaseAugs,...chain.slice(0,-1)],a,{owned:simulatedOwnedAugmentations,multiplier:augCountMult,donations:plannedDonations}),
                        priority:priorityAugs.indexOf(a.name),standaloneCost:priorityAugs.includes(a.name)&&a.prereqs.every(p=>simulatedOwnedAugmentations.includes(p))?a.price:null,
                        rep:a.reputation,factions:a.joinedFactionsWithAug().map(f=>f.name),donationCost};
                }).filter(Boolean)};
        // Native catalog and committed basket let reset planning price shared gang bundles once.
        speedSnapshot.gangBundlePlan=gangFaction?{ownershipSignature:ownershipSnapshot.signature,faction:gangFaction,multiplier:augCountMult,donations:plannedDonations,
            owned:[...simulatedOwnedAugmentations],base:futurePurchaseAugs.map(a=>({name:a.name,price:a.price,prereqs:a.prereqs})),
            catalog:Object.values(augmentationData).filter(a=>!a.owned&&!omitAugs.includes(a.name)&&a.name!==strNF&&a.joinedFactionsWithAug().some(f=>f.name===gangFaction))
                .map(a=>({name:a.name,price:a.price,rep:a.reputation,prereqs:a.prereqs,stats:a.stats,desired:a.desired}))}:null;
        const finalOwnership=await getNsDataThroughFile(ns,`(${captureAugmentationOwnership.toString()})(ns)`,'/Temp/faction-augmentation-ownership-final.txt');
        if(!finalOwnership?.complete||finalOwnership.signature!==ownershipSnapshot.signature){
            await ns.write(output_file,'','w');
            return log(ns,'Augmentation ownership changed during planning; waiting for a fresh plan.',printToTerminal);
        }
        const finalEconomics=await getNsDataThroughFile(ns,`(${captureAugmentationEconomics.toString()})(ns,JSON.parse(ns.args[0]))`,
            '/Temp/faction-augmentation-economics-final.txt',[JSON.stringify(economicsSnapshot.watch)]);
        const quoteChange=augmentationEconomicsChange(economicsSnapshot,finalEconomics,{allowRepDrift:true});
        if(quoteChange.changed){await ns.write(output_file,'','w');return log(ns,'Augmentation plan changed during calculation: '+quoteChange.reason,printToTerminal);}
        await ns.write(output_file, JSON.stringify({
            economics:economicsSnapshot,
            ownershipSignature:ownershipSnapshot.signature,
            schemaVersion:1,at:Date.now(),augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset,
            speedSnapshot,
            // Augs we already have installed
            installed_augs: installedAugmentations, // Names of augs we've installed (Note: NeuroFlux will only appears once)
            installed_count: installedAugmentations.length, // Number of augs we've installed (Note: multiple NeuroFlux levels only counts as one)
            installed_count_nf: nfInstalled, // Count of NeuroFlux levels we have installed
            installed_count_ex_nf: installedAugmentations.filter(a => a != strNF).length, // Count of non-NeuroFlux augs installed
            // Augs we have purchased, but perhaps not installed
            purchased_augs: ownedAugmentations, // Names of augs we've purchased (which may include duplicates of NeuroFlux)
            purchased_count: ownedAugmentations.length, // Total number of augs we've purchased (some of which may not be installed)
            purchased_count_nf: nfLevelPurchased, // Count of NeuroFlux levels we have purchased (some of which may not be installed)
            purchased_count_ex_nf: ownedAugmentations.filter(a => a != strNF).length, // Count augmentations we have purchased (some of which may not be installed)
            // Augs awaiting installation (to be explicit about what's installed vs purchased)
            awaiting_install_augs: augsAwaitingInstall, // Names of augmentations purchased but not yet installed
            awaiting_install_count: numAugsAwaitingInstall, // Number of augmentations awaiting installation
            awaiting_install_count_nf: augsAwaitingInstall.filter(a => a == strNF).length, // Count of NeuroFlux levels awaiting installation
            awaiting_install_count_ex_nf: augsAwaitingInstall.filter(a => a != strNF).length, // Count of non-NeuroFlux awaiting installation
            // Augs we want to purchase
            affordable_augs: purchaseableAugs.map(a => a.name), // List of aug names we can currently afford to buy
            affordable_count: purchaseableAugs.length, // Count of augmentations we can currently install
            affordable_count_nf: purchaseableAugs.filter(a => a.name == strNF).length, // Count of NeuroFlux levels we can currently afford to buy
            affordable_count_ex_nf: purchaseableAugs.filter(a => a.name != strNF).length, // Count of unique augs we can currently afford to buy, ignoring NeuroFlux
            total_rep_cost: Object.values(purchaseFactionDonations).reduce((t, r) => t + r, 0), // Total money needed to buy the reputation needed for all affordable augs
            total_aug_cost: getTotalCost(purchaseableAugs), // Total money needed to buy all affordable augs (excludes the rep cost above)
            // Unpurchased augs
            unpurchased_count: Object.values(augmentationData).filter(a => !a.owned).length, // Number of augs are we have not yet purchased (note: depending on config, may not include all augs in the game)
        }, undefined, 2), "w");
    }
}

/** Ram-dodge getting updated player info.
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} Gang information, if we're in a gang, or False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false', '/Temp/gang-stats.txt')
}

// Helper function to make multi names shorter for display in a table
function shorten(mult) {
    return mult.replace("_mult", "").replace("company", "cmp").replace("faction", "fac").replace("money", "$").replace("crime", "crm")
        .replace("agility", "agi").replace("strength", "str").replace("charisma", "cha").replace("defense", "def").replace("dexterity", "dex").replace("hacking", "hack")
        .replace("hacknet_node", "hn").replace("bladeburner", "bb").replace("stamina", "stam")
        .replace("success_chance", "success").replace("success", "prob").replace("chance", "prob");
}

// Helper function to take a shortened multi name provided by the user and map it to a real multi
function unshorten(strMult) {
    if (!strMult) return strMult;
    if (stat_multis.includes(strMult)) return strMult; // They just omitted the "_mult" suffix shared by all
    if (stat_multis.includes(strMult.replace("_mult", ""))) return strMult.replace("_mult", ""); // _mult suffix no longer appears
    if (stat_multis.includes(strMult.replace("_level", ""))) return strMult.replace("_level", ""); // Users can explicitly request just the base mult (and not all mults that include it) by specifying the _level suffix
    if (strMult == "*") return "hacking"; // Default if no one stat was provided (* is the wildcard)
    let match = stat_multis.find(m => m == strMult || shorten(m) == strMult) || // Match exactly on the short-form of a multiplier
        stat_multis.find(m => m.startsWith(strMult)) || // Otherwise match on the first multiplier that starts with the provided string
        stat_multis.find(m => m.includes(strMult)); // Otherwise match on the first multiplier that contains the provided string
    if (match !== undefined) return match;
    throw `The specified stat name '${strMult}' does not match any of the known stat names: ${stat_multis.join(', ')}`;
}

let factionSortOrder = (a, b) => factionSortValue(a) - factionSortValue(b);
let factionSortValue = faction => {
    let preferredIndex = factionNames.indexOf(faction.name || faction);
    return preferredIndex == -1 ? 99 : preferredIndex;
};

/** Ram-dodging helper, runs a command for all items in a list and returns a dictionary.
 * @returns {string} */
const dictCommand = (command) => `Object.fromEntries(ns.args.map(o => [o, ${command}]))`;

/** Get a dictionary from retrieving the same infromation for every server name
 * @param {NS} ns
 * @param {any[]} listItems
 * @returns {Promise<{[k: string]: any}>} */
async function getSingularityDict(ns, command, listItems) {
    return await getNsDataThroughFile(ns, dictCommand(`ns.singularity.${command}(o)`),
        `/Temp/singularity-${command}-all.txt`, listItems);
}

/** @param {NS} ns
 * @param {string[]} factionsToOmit **/
async function updateFactionData(ns, factionsToOmit) {
    // Gather a list of all faction names to collect information about. Start with any player joined and invited factions
    const invitations = (/**@returns {string[]}*/() => null)() ??
        await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()');
    factionNames = joinedFactions.concat(invitations);
    // Add in factions the user hasn't seen. All factions by default, or a small subset of easy-access factions if --hide-locked-factions is set
    factionNames.push(...(options['hide-locked-factions'] ? easyAccessFactions : allFactions).filter(f => !factionNames.includes(f)));
    // Unless "all factions" is requested, omit factions that are in no way accessible on this reset
    if (!(options.a || options.all)) {
        if (!(13 in effectiveSourceFiles)) factionsToOmit.push("Church of the Machine God");
        if (!(6 in effectiveSourceFiles || 7 in effectiveSourceFiles)) factionsToOmit.push("Bladeburners");
    }
    // Finally, remove all factions marked as omitted
    log(ns, `We "know" about ${factionNames.length} factions, and will omit ${factionsToOmit.length} of them.`);
    factionNames = factionNames.filter(f => !factionsToOmit.includes(f));
    // Force-feed typescript information about the type of these dictionaries retrieved via ram-dodging
    const dictFactionAugs = (/**@returns {{[factionName: string]: string[]}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationsFromFaction', factionNames);
    const dictFactionReps = (/**@returns {{[factionName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getFactionRep', factionNames);
    const dictFactionFavors = (/**@returns {{[factionName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getFactionFavor', factionNames);

    // Need information about our gang to work around a TRP bug - gang faction appears to have it available, but it's not (outside of BN2)
    if (gangFaction && bitNode != 2)
        dictFactionAugs[gangFaction] = dictFactionAugs[gangFaction]?.filter(a => a != "The Red Pill");

    factionData = Object.fromEntries(factionNames.map(faction => [faction, new FactionData(
        faction, invitations.includes(faction), joinedFactions.includes(faction), dictFactionReps[faction], dictFactionFavors[faction], dictFactionAugs[faction]
    )]));
}

/** Custom class with all faction data we care to gather, plus some helper functions. */
class FactionData {
    /** @param {string} faction The faction name
     * @param {boolean} invited Whether we have an invitation to this faction 
     * @param {boolean} joined Whether we have an already joined this faction 
     * @param {number} factionRep The amount of reputation we have with this faction
     * @param {number} factionFavor The amount of faction favour we have with this faction
     * @param {string[]} augmentationNames The names of all augmentations offered by this faction **/
    constructor(faction, invited, joined, factionRep, factionFavor, augmentationNames) {
        this.name = faction;
        this.invited = invited;
        this.joined = joined;
        this.reputation = factionRep || 0;
        this.favor = factionFavor;
        this.donationsUnlocked = factionFavor >= favorToDonate &&
            // As a rule, cannot donate to gang factions or any of the below factions - need to use other mechanics to gain rep.
            ![gangFaction, ...factionsWithoutDonation].includes(faction);
        this.augmentations = augmentationNames;
    }
    /** @param {boolean} includeNf Whether to include NeuroFlux (generally offered by all factions) in the list of augmentations offered.
     * @returns {string[]} A list of augmentations we don't own that are offered by this faction */
    unownedAugmentations(includeNf = false) {
        return this.augmentations.filter(aug => !simulatedOwnedAugmentations.includes(aug) && (aug != strNF || includeNf))
    }
    /** @returns {number} The most cost (monetary) of the most expensive augmentation offered by this faction. */
    augToDropCost() {
        return this.augmentations.map(augName => augmentationData[augName]).reduce((max, aug) => Math.max(max, aug.price), 0)
    }
    /** @returns {Map<string, AugmentationData>}  */
    totalUnownedMults() {
        return this.unownedAugmentations().map(augName => augmentationData[augName])
            .reduce((arr, aug) => Object.keys(aug.stats).forEach(stat => arr[stat] = ((arr[stat] || 1) * aug.stats[stat])) || arr, new Map);
    }
}

/** Updates the global "augmentationData" property with information about every augmentation.
 * @param {NS} ns **/
async function updateAugmentationData(ns) {
    const augmentationNames = [...new Set(Object.values(factionData).flatMap(f => f.augmentations))]; // augmentations.slice();
    // Force-feed typescript information about the type of these dictionaries retrieved via ram-dodging
    const dictAugRepReqs = (/**@returns {{[augmentationName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationRepReq', augmentationNames);
    const dictAugPrices = (/**@returns {{[augmentationName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationPrice', augmentationNames);
    const dictAugStats = (/**@returns {{[augmentationName: string]: Multipliers}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationStats', augmentationNames);
    const dictAugPrereqs = (/**@returns {{[augmentationName: string]: string[]}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationPrereq', augmentationNames);
    // Create a new dictionary of augmentation data by augmentation name
    augmentationData = Object.fromEntries(augmentationNames.map(aug => [aug, new AugmentationData(
        aug, dictAugRepReqs[aug], dictAugPrices[aug], dictAugStats[aug], dictAugPrereqs[aug]
    )]));
    /** Helper function which will propagate the "desired" (priority) status to any dependencies of desired augs.
     * Note when --all-factions mode is not enabled, it's possible some prereqs will be missing from our list
     * @param {AugmentationData} aug */
    function propagateDesired(aug) {
        if (!aug.desired || !aug.prereqs) return;
        aug.prereqs.forEach(prereqName => {
            let pa = augmentationData[prereqName];
            if (!pa) return log(ns, `WARNING: Missing info about aug ${aug.name} prerequisite ${prereqName}. We likely don't have access.`);
            if (pa.owned) return;
            if (!pa.desired) {
                log(ns, `INFO: Promoting aug "${prereqName}" to "desired" status, because desired aug "${aug.name}" depends on it.`);
                pa.desired = true;
            } // Also propagate the "priority" status to any dependencies of priority augs (dependency must be made a higher priority)
            if (priorityAugs.includes(aug.name) && !priorityAugs.includes(prereqName)) {
                log(ns, `INFO: Promoting aug "${prereqName}" to "priority" status, because priority aug "${aug.name}" depends on it.`, printToTerminal);
                priorityAugs.splice(priorityAugs.indexOf(aug.name), 0, prereqName);
            }
            propagateDesired(pa); // Recurse on any nested prerequisites of this prerequisite aug.
        })
    }
    const allAugmentations = Object.values(augmentationData);
    allAugmentations.forEach(a => propagateDesired(a));
    // Prepare a collection of all augmentations' statistics
    allAugStats = allAugmentations.flatMap(aug => Object.keys(aug.stats)).filter((v, i, a) => a.indexOf(v) === i).sort();
}

/** Helper function to determine if the specified stat matches one of the requested desired stats.
 * @param {string} stat_name The name of the player multiplier affected */
function isStatDesired(stat_name) {
    return desiredStatsFilters.includes('*') || desiredStatsFilters.includes('_') || // Wildcards - if all stats are desired, always return true (_ is for backwards compatibility when all stat names ended with '_mult')
        desiredStatsFilters.some(filter => stat_name.includes(filter) || // A stat is desired if any "desired stat" string appears anywhere in the stat name
            stat_name == filter.replace("_level", "")); // Users can explicitly request just the base mult (and not all mults that include it as a substring) by specifying the _level suffix
}

/** Custom class with all augmentation data we care to gather, plus some helper functions. */
class AugmentationData {
    /** @param {string} aug The augmentation name
     * @param {number} reputationRequirement The required reputation to unlock this augmentation (it's the same for all factions that carry it)
     * @param {number} price The cost (money) of this augmentation
     * @param {Multipliers} augmentationStats The stats granted if this augmentation is installed.
     * @param {string[]} augmentationPrereqs The names of all augmentations which must be installed before this one. **/
    constructor(aug, reputationRequirement, price, augmentationStats, augmentationPrereqs) {
        this.name = aug;
        this.displayName = aug;
        this.owned = simulatedOwnedAugmentations.includes(aug);
        this.reputation = reputationRequirement;
        this.price = price;
        /** The stats for this augmentation, except that all properties with a value of 1.0 have been stripped out. @type {Multipliers} */
        this.stats = Object.fromEntries(Object.entries(augmentationStats).filter(([k, v]) => v != 1));
        this.prereqs = augmentationPrereqs || [];
        this.desired = desiredAugs.includes(aug) || // Mark as "desired" augs explicitly requested, or those with stats in the 'stat-desired' command line options
            desiredStatsFilters.includes('*') || desiredStatsFilters.includes('_') || // Wildcards - all stats are desired (_ is for backwards compatibility when all stat names ended with '_mult')
            Object.keys(this.stats).some(stat => isStatDesired(stat));
        // Get the name of the "most-early-game" faction from which we can buy this augmentation. Estimate this by cost of the most expensive aug the offer
        this.getFromAny = factionNames.map(f => factionData[f]).sort((a, b) => a.augToDropCost - b.augToDropCost)
            .filter(f => f.augmentations.includes(aug))[0]?.name ?? "(unknown)";
    }
    /** @returns {FactionData[]} A list of joined factions that have this augmentation */
    joinedFactionsWithAug() {
        return factionNames.map(f => factionData[f]).filter(f => f.joined && f.augmentations.includes(this.name));
    }
    /** @returns {boolean} Whether there is some joined faction which already has enough reputation to buy this augmentation */
    canAfford() {
        return this.joinedFactionsWithAug().some(f => f.reputation >= this.reputation);
    }
    /** @returns {boolean} Whether there is some joined faction with the augmentation that we've unlocked reputation donations with */
    canAffordWithDonation() {
        return this.joinedFactionsWithAug().some(f => f.donationsUnlocked);
    }
    /** @returns {string} Get the name of the joined faction from which we should purchase this augmentation. */
    getFromJoined() {
        if (this.purchaseFaction) return this.purchaseFaction;
        // For most augmentations, choose to get the augmentation from the faction requiring the lowest cost 
        const augFactions = this.joinedFactionsWithAug();
        if (this.name != strNF)
            return (augFactions.filter(f => f.reputation >= this.reputation)[0] || // Any faction we can buy it from
                augFactions.filter(f => f.donationsUnlocked).sort((a, b) => getReqDonationForAug(this, a) - getReqDonationForAug(this, b))[0] || // Cheapest donation for aug
                augFactions.sort((a, b) => b.reputation - a.reputation)[0] || // Faction we are closest to being able to get it from (most rep)
                augFactions[0])?.name; // First faction in our faction list order (which should be ordered by priority)

        const choice=chooseNeuroFluxFaction(augFactions.map(f=>({name:f.name,rep:f.reputation,
            donationCost:f.donationsUnlocked&&!options['disable-donations']?getReqDonationForAug(this,f):null})),this.reputation);
        return choice?.faction||augFactions.slice().sort((a,b)=>b.reputation-a.reputation)[0]?.name;
    }
    /** @returns {string} A formatted row of information for this augmentation */
    toString() {
        const factionColWidth = 16, augColWidth = 40, statsColWidth = 60;
        const statKeys = Object.keys(this.stats);
        const statsString = `Stats:${statKeys.length.toFixed(0).padStart(2)}` + (statKeys.length == 0 ? '' : (` { ` +
            // Display a summary of stats (capped at a maximum length). Prioritize showing desired stats, then those with the largest mult
            statKeys.sort((a, b) => (isStatDesired(b) - isStatDesired(a)) || (this.stats[b] - this.stats[a]))
                .map(prop => shorten(prop) + ': ' + Math.round((this.stats[prop] + Number.EPSILON) * 100) / 100).join(', ') + ` }`));
        const factionName = this.getFromJoined() || this.getFromAny;
        const fCreep = Math.max(0, factionName.length - factionColWidth);
        const budget = playerData.money + stockValue;
        const augNameShort = this.displayName.length <= (augColWidth - fCreep) ? this.displayName :
            `${this.displayName.slice(0, Math.ceil(augColWidth / 2 - 3 - fCreep))}...${this.displayName.slice(this.displayName.length - Math.floor(augColWidth / 2))}`;
        return `${this.desired ? '*' : ' '} Price: ${formatMoney(this.price, 4).padEnd(7)} ${this.price <= budget ? 'Ã¢Å“â€œ' : 'Ã¢Å“â€”'}  ` +
            `Rep: ${formatNumberShort(this.reputation, 4).padEnd(6)} ${this.canAfford() ? 'Ã¢Å“â€œ' : this.canAffordWithDonation() ? '$' : 'Ã¢Å“â€”'}  ` +
            `Faction: ${factionName.padEnd(factionColWidth)}  Aug: ${augNameShort.padEnd(augColWidth - fCreep)}  ` +
            `${statsString.length <= statsColWidth ? statsString : (statsString.substring(0, statsColWidth - 4) + '... }')}`;
    }
}

/** Helper function to join any factions we have an invite to, and which have augmentations we want.
 * @param {NS} ns
 * @param {string[]} forceJoinFactions A list of factions to join even if they have no remaining augmentations. **/
async function joinFactions(ns, forceJoinFactions) {
    const explicitCities=options['force-join']==null?[]:factionForcedJoins(options['force-join']);
    await ensureFactionJoinPlan(ns,explicitCities,options['ignore-faction']||[]);
    // Collect the set of augmentations we already have access to given the factions we've joined
    const accessibleAugmentations = new Set(joinedFactions.flatMap(fac => factionData[fac]?.augmentations ?? []));
    log(ns, `${accessibleAugmentations.size} augmentations are already accessible from our ${joinedFactions.length} joined factions.`);
    // Check for faction invitations
    const invitations = Object.values(factionData).filter(f => f.invited);
    log(ns, `Outstanding invitations from ${invitations.length} factions: ${JSON.stringify(invitations.map(f => f.name))}`);
    let joined = 0;
    // Join all factions with remaining augmentations we care about
    const ordered=rankFactionInvites(invitations.sort(factionSortOrder).map(f=>f.name),!gangFaction,gangHostPreferences(ns));
    for (const faction of ordered.map(name=>factionData[name])) {
        if(isScriptPaused(ns,ns.getScriptName()))break;
        let unownedAugs = faction.unownedAugmentations(true); // Filter out augmentations we've already purchased
        let newAugs = unownedAugs.filter(aug => !accessibleAugmentations.has(aug)); //  Filter out augmentations we can purchase from another faction we've already joined
        let desiredAugs = newAugs.filter(aug => augmentationData[aug].desired); //  Filter out augmentations we have no interest in
        log(ns, `${faction.name} has ${faction.augmentations.length} augs, ${unownedAugs.length} unpurchased, ${newAugs.length} not offered by joined factions, ` +
            `${desiredAugs.length} with desirable stats` + (desiredAugs.length == 0 ? ' (not joining)' : `: ${JSON.stringify(desiredAugs)}`));
        if (desiredAugs.length == 0 && !forceJoinFactions.includes(faction.name)) continue;
        if (!factionJoinAllowed({joined:()=>joinedFactions,read:f=>ns.read(f),reset:()=>ns.getResetInfo()},faction.name))
            log(ns, `Deferring ${faction.name}: not in the shared city group.`, printToTerminal);
        else {
            log(ns, `Joining faction ${faction.name} which has ${desiredAugs.length} desired augmentations: ${desiredAugs}`);
            let response;
            if (response = await getNsDataThroughFile(ns, `(${factionControlAllowed.toString()})({isRunning:p=>ns.isRunning(p),read:f=>ns.read(f)},ns.args[1],"faction-manager.js")&&(${factionJoinAllowed.toString()})({joined:()=>ns.getPlayer().factions,read:f=>ns.read(f),reset:()=>ns.getResetInfo()},ns.args[0])&&ns.singularity.joinFaction(ns.args[0])`, null, [faction.name,ns.pid])) {
                faction.joined = true;
                faction.augmentations.forEach(aug => accessibleAugmentations.add(aug));
                joinedFactions.push(faction.name);
                log(ns, `SUCCESS: Joined faction ${faction.name} (Response: ${response})`, printToTerminal, 'success');
                joined++;
            } else
                log(ns, `ERROR: Error joining faction ${faction.name}. Response: ${response}`, false, 'error');
        }
    }
    return joined;
}

/** Compute how much money must be donated to recieve the specified reputation amount.
 * @param {number} rep */
let getCostOfReputation = (rep) => Math.ceil(1e6 * rep / playerData.mults.faction_rep / bitNodeMults.FactionWorkRepGain);
/** Compute how much money must be donated to the faction to attain the specified reputation amount with this faction. Takes into account the current faction rep.
 * @param {number} rep_needed @param {FactionData|string} factionOrFactionName */
let getReqDonationForRep = (rep_needed, factionOrFactionName) => getCostOfReputation(Math.max(0, rep_needed - (factionOrFactionName.name ? factionOrFactionName : factionData[factionOrFactionName]).reputation));
/** Compute how much money must be donated to the faction to afford an augmentation. Faction can be either a faction object, or faction name
 * @param {AugmentationData} aug @param {FactionData|string} factionOrFactionName */
let getReqDonationForAug = (aug, factionOrFactionName) => getReqDonationForRep(aug.reputation, factionOrFactionName || aug.getFromJoined());
/** @param {AugmentationData[]} augPurchaseOrder The augmentations we wish to purchase in order of purchase.
 * @returns The total cost of purchasing all these augmentations in the specified order */
let getTotalCost = (augPurchaseOrder) => augPurchaseOrder.reduce((total, aug, i) => total + aug.price * augCountMult ** i, 0);

/** Sort augmentations such that they are in order of price, except when there are prerequisites to worry about
 * @param {NS} ns
 * @param {AugmentationData[]} augs augmentations to sort
 * @returns {AugmentationData[]} The input array of augs, which were sorted in place */
function sortAugs(ns, augs = []) {
    const order=optimizeAugmentationOrder(augs,augCountMult);
    augs.splice(0,augs.length,...order);
    return augs;
}

/** @param {NS} ns
 * @param {string[]} ignoredAugs a list of augmentation names to ignore
 * Display all information about all augmentations, including lists of available / desired / affordable augmentations in their optimal purchase order.  */
async function manageUnownedAugmentations(ns, ignoredAugs) {
    const reqDaedalusAugs = bitNodeMults.DaedalusAugsRequirement;
    let outputRows = [`Currently have ${ownedAugmentations.length}/${reqDaedalusAugs} Augmentations required for Daedalus.`];
    const unownedAugs = Object.values(augmentationData).filter(aug => (!aug.owned || aug.name == strNF) && !ignoredAugs.includes(aug.name));
    if (unownedAugs.length == 0) return log(ns, `All ${Object.keys(augmentationData).length} augmentations are either owned or ignored!`, printToTerminal)
    let unavailableAugs = unownedAugs.filter(aug => aug.getFromJoined() == null);
    let availableAugs = unownedAugs.filter(aug => aug.getFromJoined() != null);
    // List unavailable augs only if there are none available, or if the user specifically requested to see this list.
    if (availableAugs.length == 0 || unavailableAugs.length > 0 && options['show-unavailable-aug-purchase-order'])
        await manageFilteredSubset(ns, outputRows, 'Unavailable', unavailableAugs, true, false);
    // Prepare and display a little legend of what symbols in our augmentation list mean
    const legendTitle = 'Optimized Purchase Order Legend';
    outputRows.push(legendTitle, '-'.repeat(legendTitle.length), "Ã¢Å“â€œ  Can afford", "Ã¢Å“â€”  Cannot afford", "$  Can donate for rep",
        `*  Desired aug/stats (${desiredStatsFilters.join(", ")})`, '-'.repeat(legendTitle.length));
    const countAvailable = availableAugs?.length || 0; // Get a count of available augs (including NF) to determine whether to prepare a purchase order
    // Display available augs. We use the return value to "lock in" the new sort order. If enabled, subsequent tables are displayed if the filtered sort order changes.
    availableAugs = ignorePlayerData ? unavailableAugs : // Note: We omit NF from available augs here because as many as we can afford are added at the end.
        await manageFilteredSubset(ns, outputRows, 'Available', availableAugs.filter(aug => aug.name != strNF), true);
    if (countAvailable > 0) {
        let augsWithRep = availableAugs.filter(aug => aug.canAfford() || (aug.canAffordWithDonation() && !options['disable-donations']));
        let desiredAugs = availableAugs.filter(aug => aug.desired);
        if (augsWithRep.length > desiredAugs.length) {
            augsWithRep = await manageFilteredSubset(ns, outputRows, 'Within Rep', augsWithRep)
            desiredAugs = await manageFilteredSubset(ns, outputRows, 'Desired', desiredAugs);
        } else {
            desiredAugs = await manageFilteredSubset(ns, outputRows, 'Desired', desiredAugs);
            augsWithRep = await manageFilteredSubset(ns, outputRows, 'Within Rep', augsWithRep);
        }
        let accessibleAugs = await manageFilteredSubset(ns, outputRows, 'Desired Within Rep', augsWithRep.filter(aug => aug.desired));
        await managePurchaseableAugs(ns, outputRows, accessibleAugs);
    }
    // Print all rows of output that were prepped. Keep as many rows in one log as possible to avoid scrolling the history too much
    log(ns, outputRows.join("\n  "), printToTerminal);
    if (purchaseableAugs.length > 0)
        log(ns, `INFO: The above ${purchaseableAugs.length} augmentations ${options.purchase ? 'will' : 'can'} be purchased ` +
            `${stockValue > 0 ? 'after liquidating stocks' : 'right now'}.` +
            (options.purchase ? '' : ' Run with the --purchase flag to make the purchase.'), printToTerminal);
}

/** Helper to compute the total rep cost for augmentations, including the cost of donating for access.
 * @param {AugmentationData[]} sortedAugs The augmentations we're purchasing, in the order we'll puchase them
 * @returns {[{[factionName: string]: number},number,number]} */
function computeCosts(sortedAugs, replan = true) {
    const repCostByFaction = computeAugsRepReqDonationByFaction(sortedAugs, replan);
    const totalRepCost = Object.values(repCostByFaction).reduce((t, r) => t + r, 0);
    const totalAugCost = getTotalCost(sortedAugs);
    return [repCostByFaction, totalRepCost, totalAugCost];
}

/** Helper to produce a summary of the cost of augs with reputation. */
function getCostString(augCost, repCost) {
    return `${formatMoney(augCost + repCost, 4)}` + (repCost == 0 ? '' : ` (Augs: ${formatMoney(augCost, 4)} + Rep: ${formatMoney(repCost, 4)})`);
}

/** Helper to remove augs that cannot be purchased because their prerequisites are not owned and have been filtered out */
function filterMissingPrereqs(ns, subset) {
    const kept=pruneAugmentationPrerequisites(subset,simulatedOwnedAugmentations),names=new Set(kept.map(a=>a.name));
    for(const aug of subset)if(!names.has(aug.name))log(ns,'INFO: Removing '+aug.name+' because a prerequisite is missing from the purchase basket');
    subset.splice(0,subset.length,...kept);
    return subset;
}

/** Helper to generate outputs for different subsets of the augmentations, each in optimal sort order
 * @param {NS} ns
 * @param {string[]} outputRows An array of strings to which we should log the cost of these augmentations, and other details as specified.
 * @param {AugmentationData[]} subset A list of augmentations to include in the output.
 * @param {boolean|undefined} printList Whether to print the list to the outputRows. If undefined, we will only automatically print only if the sort order changed.
 * @param {boolean}
 * @returns {Promise<AugmentationData[]>} The list of augmentations, with the requested operations performed */
async function manageFilteredSubset(ns, outputRows, subsetName, subset, printList = undefined, removeMissingPrereqs = true, reorder = true) {
    subset = subset.slice(); // Take a copy so we don't mess up the original array sent in.
    // If enabled, filter out augs who are missing prerequisites
    if (removeMissingPrereqs)
        filterMissingPrereqs(ns, subset)
    let subsetLength = subset.length;
    if (subsetLength == 0) {
        outputRows.push(`There are 0 ${subsetName}`);
        return subset;
    }
    // Sort the filtered subset into its optimal purchase order
    let subsetSorted = reorder ? sortAugs(ns, subset.slice()) : subset;
    // The final NF summary describes the committed plan; reporting must not reroute it.
    let [repCostByFaction, totalRepCost, totalAugCost] = computeCosts(subsetSorted, reorder);
    // By default, if the purchase order is unchanged after filtering out augmentations, don't bother reprinting the full list
    if (printList === true || printList !== false && options['show-all-purchase-lists'] && !subset.every((v, i) => v == subsetSorted[i]))
        outputRows.push(`${subset.length} ${subsetName} Augmentations in Optimized Purchase Order:\nÃ‚Â  ${subsetSorted.join('\nÃ‚Â Ã‚Â ')}`);
    outputRows.push(`Total Cost of ${subset.length} ${subsetName}:`.padEnd(37) + ` ${getCostString(totalAugCost, totalRepCost)}` +
        (totalRepCost == 0 ? '' : `  Donate: {${Object.keys(repCostByFaction).map(f => `"${f}":${formatNumberShort(repCostByFaction[f], 4)}`).join(", ")}}`));
    return subsetSorted;
}

/** @param {NS} ns
 * Prepares a "purchase order" of augs that we can afford.
 * Note: Stores this info in global properties `purchaseableAugs` and `purchaseFactionDonations` so that a final action in the main method will do the purchase. */
async function managePurchaseableAugs(ns, outputRows, accessibleAugs) {
    // Refresh player data to get an accurate read of current money
    playerData = await getPlayerInfo(ns);
    const budget = augmentationPurchaseBudget(playerData.money,stockValue,ns.read("reserve.txt"));
    let totalRepCost, totalAugCost, dropped, restart;
    // We will make every effort to keep "priority" augs in the purchase order, but start dropping them if we find we cannot afford them all
    const inaccessiblePriorityAugs = priorityAugs.filter(name => {
        const aug = augmentationData[name];
        return !aug || !accessibleAugs.includes(aug) || aug.price + getReqDonationForAug(aug) > budget;
    });
    const droppedPriorityAugs = [...inaccessiblePriorityAugs];
    const selectedRoute=readNodeRoutePlan(ns)?.selected||([6,7].includes(bitNode)||playerData.factions.includes('Bladeburners')?'bladeburner':'hacking');
    const countWeight=selectedRoute!=='bladeburner'&&!playerData.factions.includes('Daedalus')&&new Set(ownedAugmentations.filter(n=>n!==strNF)).size<(bitNodeMults.DaedalusAugsRequirement||30) ? 0.05 : 0;
    do { // Outer loop is only repeated if we have to drop a priority aug and start over with our purchasable augs determination
        restart = false; // Flag as to whether we need to loop again with different starting set of priority augs
        dropped = [];
        purchaseableAugs = filterMissingPrereqs(ns, accessibleAugs.slice().filter(a => !droppedPriorityAugs.includes(a.name) && a.price + getReqDonationForAug(a) <= budget));
        [purchaseFactionDonations, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        const reputationContext=readAugmentationReputationContext(ns,ownershipSnapshot);
        // Cut the least route benefit per dollar saved, including dependent augmentations.
        while (totalAugCost + totalRepCost > budget && purchaseableAugs.length > 0) {
            // Price each retained basket with fresh providers, then restore the committed plan.
            const cut=selectAugmentationBasketDrop(purchaseableAugs,{owned:simulatedOwnedAugmentations,priority:priorityAugs,route:selectedRoute,multiplier:augCountMult,countWeight,donationCost:previewAugmentationDonationCost,combatContext:readCombatGrowthContext(ns,playerData),reputationContext,reputationEstimator:estimateMixedAugmentationWait});
            const augToDrop=cut?purchaseableAugs.find(a=>a.name===cut.name):null;
            if (!augToDrop) { // If there is nothing but "priority augs" left, then we need the user to deprioritize one or the other
                const aPa = priorityAugs.filter(name => purchaseableAugs.some(a => a.name == name));
                if(!aPa.length)throw Error('No valid augmentation budget cut; deferring purchases');
                const toDrop = aPa[aPa.length - 1];
                log(ns, `WARNING: We can afford ${aPa.length} priority augs on their own, but not together. We must drop the lowest-priority one: ${toDrop}`, printToTerminal, 'warning');
                droppedPriorityAugs.push(toDrop);
                restart = true;
                break;
            }
            let costBefore = getCostString(totalAugCost, totalRepCost);
            purchaseableAugs = sortAugs(ns, filterMissingPrereqs(ns,purchaseableAugs.filter(aug => aug !== augToDrop)));
            [purchaseFactionDonations, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
            let costAfter = getCostString(totalAugCost, totalRepCost);
            dropped.unshift({ aug: augToDrop, costBefore, costAfter });
            log(ns, `Dropping aug from the purchase order: \"${augToDrop.name}\". New total cost: ${costAfter}`);
        }
    } while (restart);

    // Capture costs and committed providers before optional NF adds prices and donations.
    preNeuroFluxPlan={augmentations:purchaseableAugs.slice(),donations:{...purchaseFactionDonations}};

    // Do not let optional NF inflate a basket while a bounded wait is funding a more valuable target.
    // An explicit NF priority takes precedence; queued native purchases are never removed.
    const neuroFluxFundingGoal=priorityAugs.includes(strNF)?null:augmentationCashReserve(ns,true);
    const omitOptionalNeuroFlux=options['neuroflux-disabled']||!!neuroFluxFundingGoal;
    // Show the full ordinary basket when no optional NF table will follow.
    manageFilteredSubset(ns, outputRows, 'Unique Affordable', purchaseableAugs, omitOptionalNeuroFlux);

    // The the user know about some of the next upcoming augs / import augs that had to be dropped
    let nextUpAug = dropped.length == 0 ? null : `Next desired aug available at:`.padEnd(37) + ` ${dropped[0].costBefore}  ` +
        `for \"${dropped[0].aug.name}\" from "${dropped[0].aug.getFromJoined()}" (next excluded candidate; ${dropped.length} dropped augs)`
    if (nextUpAug && omitOptionalNeuroFlux) outputRows.push(nextUpAug); // Output this now if we will be exiting early, otherwise save for after the last table.
    if (numAugsAwaitingInstall > 0)
        outputRows.push(`WARNING: Prices all have a x ${formatNumberShort(augCountMult ** numAugsAwaitingInstall)} cost penalty, because ` +
            `${numAugsAwaitingInstall} Augmentations were previously purchased but are not yet installed.`);
    if (inaccessiblePriorityAugs.length > 0)
        outputRows.push(`INFO: ${inaccessiblePriorityAugs.length} 'priority' augs are not yet accessible: ${inaccessiblePriorityAugs.map(n => `"${n}"`).join(", ")}`);
    const additionalDroppedPri = droppedPriorityAugs.filter(n => !inaccessiblePriorityAugs.includes(n));
    if (additionalDroppedPri.length > 0)
        outputRows.push(`INFO: ${additionalDroppedPri.length} 'priority' augs had to be droped: ${additionalDroppedPri.map(n => `"${n}"`).join(", ")}`);

    // NEXT STEP: Add as many NeuroFlux levels to our purchase as we can (unless disabled)
    if (options['neuroflux-disabled']) return;
    if(neuroFluxFundingGoal){
        outputRows.push('INFO: Holding optional NeuroFlux levels while funding '+neuroFluxFundingGoal.name+'.');
        return;
    }
    const augNf = augmentationData[strNF];
    // nfLevelPurchased comes from native installed ownership plus queued NF purchases.
    let nextNfLevel = nfLevelPurchased + 1;
    let getFrom = augNf.getFromJoined();
    // If No currently joined factions can provide us with the next level of Neuroflux, look for the best joined **or unjoined** faction to get NF from.
    if (!augNf.canAfford() && !augNf.canAffordWithDonation()) {
        outputRows.push(`Cannot purchase any ${strNF}. The next level (${nextNfLevel}) requires ${formatNumberShort(augNf.reputation)} reputation, but ` +
            (!getFrom ? `it isn't being offered by any of our factions` : `the best faction (${getFrom}) has insufficient rep (${formatNumberShort(factionData[getFrom].reputation)}).`));
        // Prefer factions that support donating for reputation, otherwise grinding rep takes a long time.
        const factionSort = (a, b) => ((b.donationsUnlocked ? 1 : 0) - (a.donationsUnlocked ? 1 : 0)) || (b.favor - a.favor);
        const factionsWithAug = Object.values(factionData).filter(f => f.augmentations.includes(augNf.name)).sort(factionSort);
        const factionsWithAugAndInvite = factionsWithAug.filter(f => f.invited || f.joined).sort(factionSort);
        const factionWithMostFavor = factionsWithAugAndInvite[0] ?? factionsWithAug[0];
        let joined = 0;
        if (getFrom != factionsWithAug[0].name && factionsWithAug[0] != factionsWithAugAndInvite[0])
            outputRows.push(`SUGGESTION: Earn an invitation to faction ${factionsWithAug[0].name} to make it easier to get rep for ${strNF} since it has the most favor (${factionsWithAug[0].favor}).`);
        else if (factionsWithAug[0].joined && !factionsWithAug[0].donationsUnlocked)
            outputRows.push(`SUGGESTION: Do some work for faction ${factionsWithAug[0].name} to quickly earn rep for ${strNF} since it has the most favor (${factionsWithAug[0].favor}).`);
        else if (!getFrom || (factionData[getFrom].favor < factionWithMostFavor.favor && factionWithMostFavor.invited)) {
            outputRows.push(`Attempting to join faction ${factionWithMostFavor.name} to make it easier to earn rep for ${strNF} since it has the most favor (${factionWithMostFavor.favor}).`);
            joined = await joinFactions(ns, [factionWithMostFavor.name]);
            if (!joinedFactions.includes(factionWithMostFavor.name)) {
                const invitedFactionsWithDonation = factionsWithAugAndInvite.filter(f => f.donationsUnlocked).map(f => f.name);
                if (invitedFactionsWithDonation.length > 0) {
                    outputRows.push(`Failed to join ${factionWithMostFavor.name}. Attempting to join any factions with whom we have enough favour to donate: ${invitedFactionsWithDonation.join(", ")}.`);
                    joined = await joinFactions(ns, invitedFactionsWithDonation);
                } else
                    outputRows.push(`Failed to join ${factionWithMostFavor.name}. NeuroFlux will not be accessible.`);
            }
            // If after the above potential attempt to join a faction offering NF we still can't afford it, we're done here
            getFrom = augNf.getFromJoined();
            if (!getFrom) return log(ns, "Cannot buy any NF due to no joined or joinable factions offering it.");
        }
        if (!augNf.canAfford() && !augNf.canAffordWithDonation())
            log(ns, `Cannot buy any NF due to best provider faction ${getFrom} having insufficient rep, and donations are not unlocked.`);
        else if (joined)
            outputRows.push(`SUCCESS: Joined ${joined} factions just to gain access to additional NeuroFlux levels.`);
    }
    // Start adding as many NeuroFlux levels as we can afford
    let nfPurchased = purchaseableAugs.filter(a => a.name === augNf.name).length;
    let nextUpNf; // Will tell the user when they will unlock the next NF level
    while (nfPurchased < 200) { // Limit to 200 to avoid breaking the game if near infinite money.
        const nextNfPrice = augNf.price * (nfCountMult ** nfPurchased);
        const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
        const nfClone = new AugmentationData(augNf.name,nextNfRep,nextNfPrice,augNf.stats,augNf.prereqs);
        const proposedOrder = extendNeuroFluxOrder(purchaseableAugs,nfClone,augCountMult);
        // Inserting NF also shifts every following augmentation's global price multiplier.
        const proposedAugCost = getTotalCost(proposedOrder);
        const nextNfCost = proposedAugCost - totalAugCost;
        const choice=chooseNeuroFluxFaction(augNf.joinedFactionsWithAug().map(f=>({name:f.name,rep:f.reputation,
            donationCost:f.donationsUnlocked&&!options['disable-donations']?getReqDonationForRep(nextNfRep,f):null})),nextNfRep,purchaseFactionDonations);
        if(!choice){nextUpNf='Next NeuroFlux level requires more reputation or an eligible donation provider.';break;}
        const augNfFaction=factionData[choice.faction];
        const currentNfFactionDonation = purchaseFactionDonations[augNfFaction.name] || 0;
        const nextNfTotalRepDonation = choice.totalDonation;
        const nextNfRepCost = Math.max(0, nextNfTotalRepDonation - currentNfFactionDonation); // Compute the incremental cost of donating for rep
        const totalCostWithNextNf = totalAugCost + nextNfCost + totalRepCost + nextNfRepCost;
        log(ns, `Adding ${nfPurchased + 1} NF (Level ${nextNfLevel}) Requires ${formatNumberShort(nextNfRep, 4)} reputation, ` +
            `would cost another ${getCostString(nextNfCost, nextNfRepCost)} for a ` +
            `total of ${getCostString(totalAugCost + nextNfCost, totalRepCost + nextNfRepCost)}`);
        if (totalCostWithNextNf > budget || nextNfRep > augNfFaction.reputation && !augNfFaction.donationsUnlocked) {
            nextUpNf = `Next NF (L${nextNfLevel}) will be available at:`.padEnd(37) +
                ` ${getCostString(totalAugCost + nextNfCost, totalRepCost + nextNfRepCost)}  Money (` +
                `${(totalCostWithNextNf > budget ? 'Ã¢Å“â€”' : 'Ã¢Å“â€œ')}) and ${formatNumberShort(nextNfRep)} Reputation with "${augNfFaction.name}" (` +
                (nextNfRep > augNfFaction.reputation && !augNfFaction.donationsUnlocked ? 'Ã¢Å“â€”' : 'Ã¢Å“â€œ') +
                ` have ${formatNumberShort(augNfFaction.reputation)}` + (nextNfRep <= augNfFaction.reputation ? '' :
                    augNfFaction.donationsUnlocked ? ', can donate' : ', donations unavailable') + `)`;
            break; // If we cannot afford the next NF, break
        }
        // Otherwise, add the next NF to our purchase order, and see if we can afford any more.
        // Each level retains its selected provider through donation and purchase execution.
        nfClone.getFromJoined=()=>choice.faction;
        nfClone.displayName += ` Level ${nextNfLevel}`
        // Commit the exact basket and provider used by the affordability quote.
        purchaseableAugs = proposedOrder;
        totalAugCost = proposedAugCost;
        const newDonationForRep = Math.max(currentNfFactionDonation, nextNfTotalRepDonation);
        if (newDonationForRep > 0) purchaseFactionDonations[augNfFaction.name] = newDonationForRep;
        totalRepCost = Object.values(purchaseFactionDonations).reduce((t, r) => t + r, 0);
        nextNfLevel++;
        nfPurchased++;
    }
    log(ns, `With ${formatMoney(budget)}, can afford to purchase ${nfPurchased} level${nfPurchased == 1 ? '' : 's'} of ${strNF}.` +
        ` New total cost: ${getCostString(totalAugCost, totalRepCost)}`);
    manageFilteredSubset(ns, outputRows, `(${purchaseableAugs.length - nfPurchased} Augs + ${nfPurchased} NF)`, purchaseableAugs, true, false, false);
    if (nextUpAug) outputRows.push(nextUpAug);
    if (nextUpNf) outputRows.push(nextUpNf);
};

/** Find out the optimal set of factions and rep-donations required to access them
 * @param {NS} ns
 * @param {AugmentationData[]} augmentations
 * @returns {{[factionName: string]: number}} The amount of reputation we need to donate to each faction to purchase the specified augmentations. */
function computeAugsRepReqDonationByFaction(augmentations, replan = true, quiet = false) {
    // Rebuild provider assignments for this basket. A dropped augmentation may have
    // been the only reason another faction's donation was economical.
    if (replan) for (const aug of augmentations) delete aug.purchaseFaction;
    const repCostByFaction = (/**@returns {{[factionName: string]: number}}*/() => ({}))();
    for (const aug of augmentations) {
        if (!(aug instanceof AugmentationData)) throw new Error("Wrong type: " + aug.constructor.name + JSON.stringify(aug));
        let faction = factionData[aug.getFromJoined() || aug.getFromAny];
        if (!faction.donationsUnlocked) continue; // getFromJoined() already ensures that we don't resort to faction requiring donations unless we must (and can)
        let reqDonation = getReqDonationForAug(aug, faction);
        // Existing reputation costs nothing; never reroute it to a donation provider.
        if (reqDonation === 0) continue;
        // Compare each provider's own requirement with the donation already committed there.
        // Keep the current provider on ties and choose the smallest positive increase, not the first match.
        let additionalDonation = Math.max(0, reqDonation - (repCostByFaction[faction.name] || 0));
        let alternativeFaction;
        for (const name of replan ? Object.keys(repCostByFaction) : []) {
            const candidate = factionData[name];
            if (name === faction.name || !candidate.joined || !candidate.donationsUnlocked ||
                !candidate.augmentations.includes(aug.name)) continue;
            const additional = Math.max(0, getReqDonationForAug(aug, candidate) - repCostByFaction[name]);
            if (additional < additionalDonation) {
                additionalDonation = additional;
                alternativeFaction = name;
            }
        }
        if (alternativeFaction) {
            if (!quiet) log(_ns, `INFO: Using alternative faction "${alternativeFaction}" for "${aug.name}" rather than earlier faction "${faction.name}"`)
            aug.purchaseFaction = alternativeFaction; // Keep the ordinary provider selector intact for future baskets.
            reqDonation = getReqDonationForAug(aug, alternativeFaction);
            faction = factionData[alternativeFaction];
        }
        if (reqDonation > 0)
            repCostByFaction[faction.name] = Math.max(repCostByFaction[faction.name] || 0, reqDonation);
    }
    return repCostByFaction;
}

/** Reuse the execution planner for hypothetical cuts without retaining any provider changes.
 * This is synchronous; even failed previews restore the exact original property descriptors. */
function previewAugmentationDonationCost(augmentations) {
    const assignments = new Map(augmentations.map(aug => [aug,Object.getOwnPropertyDescriptor(aug,'purchaseFaction')]));
    try {
        return Object.values(computeAugsRepReqDonationByFaction(augmentations,true,true)).reduce((sum,cost)=>sum+cost,0);
    } finally {
        for (const [aug,descriptor] of assignments) {
            if (descriptor) Object.defineProperty(aug,'purchaseFaction',descriptor);
            else delete aug.purchaseFaction;
        }
    }
}

/** @param {NS} ns
 * Donate any required rep and purchase the desired augmentations */
async function purchaseDesiredAugs(ns) {
    if(isScriptPaused(ns,ns.getScriptName())||!achievementActionAllowed(ns,'cashSpending'))return;
    let totalRepCost = Object.values(purchaseFactionDonations).reduce((t, r) => t + r, 0);
    let totalAugCost = getTotalCost(purchaseableAugs);
    // Refresh player data to get an accurate read of current money
    playerData = await getPlayerInfo(ns);
    if (stockValue > 0)
        return log(ns, `ERROR: For your own protection, --purchase will not run while you are holding stocks (current stock value: ${formatMoney(stockValue)}). ` +
            `Liquidate your shares before running (run stockmaster.js --liquidate) or run this script with --ignore-stocks to override this.`, printToTerminal, 'error')
    if (totalAugCost + totalRepCost > playerData.money && totalAugCost + totalRepCost > playerData.money * 1.1) // If we're way off affording this, something is probably wrong
        return log(ns, `ERROR: Purchase order total cost (${getCostString(totalAugCost, totalRepCost)})` +
            ` is far more than current player money (${formatMoney(playerData.money)}). Your money may have recently changed (It was ${formatMoney(startingPlayerMoney)} at startup), ` +
            `or there may be a bug in purchasing logic.`, printToTerminal, 'error');
    if (totalAugCost + totalRepCost > playerData.money) // If we're just a little off affording this, it could be because a bit of money was just spent? Just warn and buy what we can
        log(ns, `WARNING: Purchase order total cost (${getCostString(totalAugCost, totalRepCost)})` +
            ` is a bit more than current player money (${formatMoney(playerData.money)}). Did something else spend some money? ` +
            `(We had ${formatMoney(startingPlayerMoney)} at startup). Will proceed with buying most of the purchase order.`, printToTerminal, 'warning');
    // Donate to factions if necessary (using a ram-dodging script of course)
    if (Object.keys(purchaseFactionDonations).length > 0 && Object.values(purchaseFactionDonations).some(v => v > 0)) {
        const donationResult=await executeFactionPurchases(ns,Object.keys(purchaseFactionDonations).map(f => ({ faction:f,repDonation:purchaseFactionDonations[f],targetRep:Math.max(...purchaseableAugs.filter(a=>a.getFromJoined()===f).map(a=>a.reputation),0) })),true);
        if(donationResult===-3)return log(ns,'Full augmentation basket is no longer funded above the cash reserve; deferring donations and purchases.',printToTerminal);
        if(donationResult===-2)return log(ns,'Augmentation prices or reputation changed before donation; deferring to a fresh plan.',printToTerminal);
        if(donationResult===-1)return log(ns,'Augmentation ownership changed before donation; deferring to a fresh plan.',printToTerminal);
        if(donationResult===Object.keys(purchaseFactionDonations).length)
            log(ns, `SUCCESS: Donated to ${Object.keys(purchaseFactionDonations).length} factions to gain access to desired augmentations.`, printToTerminal, 'success')
        else
            return log(ns, `WARNING: A reputation donation failed; deferring augmentation purchases to a fresh plan.`, printToTerminal, 'warning');
    }
    // Purchase desired augs (using a ram-dodging script of course)
    if (purchaseableAugs.length == 0) {
        log(ns, `INFO: Cannot afford to buy any augmentations at this time.`, printToTerminal);
        return {complete:true,purchased:0};
    }
    const purchased = await executeFactionPurchases(ns,purchaseableAugs.map(aug => ({faction:aug.getFromJoined(),augmentation:aug.name})));
    if(purchased===-2)return log(ns,'Augmentation prices or reputation changed before purchase; deferring to a fresh plan.',printToTerminal);
    if(purchased===-1)return log(ns,'Augmentation ownership changed before purchase; deferring to a fresh plan.',printToTerminal);
    if (purchased == purchaseableAugs.length)
        log(ns, `SUCCESS: Purchased ${purchased} desired augmentations in optimal order!`, printToTerminal, 'success')
    else
        log(ns, `WARNING: Purchased ${purchased} of ${purchaseableAugs.length} augmentations; stopped at the first blocked purchase. Remaining purchases require a fresh plan. ` +
            `Expected cost was ${getCostString(totalAugCost, totalRepCost)}. Player money was ${formatMoney(playerData.money)} right before purchase, ` +
            `is now ${formatMoney((await getPlayerInfo(ns)).money)}`, printToTerminal, 'warning');
    return {complete:purchased===purchaseableAugs.length,purchased};
}

/** @param {NS} ns **/
function displayJoinedFactionSummary(ns) {
    let joinedFactions = Object.values(factionData).filter(f => f.joined);
    let summary = `${joinedFactions.length} Joined Factions:`
    let noaugs = joinedFactions.filter(f => f.unownedAugmentations().length == 0)
    if (noaugs.length > 0)
        summary += `\nÃ‚Â Ã‚Â ${noaugs.length} joined factions have no unowned augs remaining: "${noaugs.map(f => f.name).join('", "')}"`;
    for (const faction of joinedFactions.filter(f => !noaugs.includes(f)))
        summary += `\nÃ‚Â Ã‚Â ${faction.name}: ${faction.unownedAugmentations().length} augs remaining (${faction.unownedAugmentations().join(", ")})`;
    log(ns, summary, printToTerminal);
}

/** @param {NS} ns **/
function displayFactionSummary(ns, sortBy, unique, overrideFinishedFactions, excludedStats) {
    let noAugs = Object.values(factionData).filter(f => f.unownedAugmentations().length == 0);
    let summary = "";
    if (noAugs.length > 0)
        summary += `${noAugs.length} factions have no augmentations to purchase (excluding NF): ${JSON.stringify(noAugs.map(a => a.name))}\n`;
    let summaryFactions = Object.values(factionData).filter(f => f.unownedAugmentations().length > 0 && !overrideFinishedFactions.includes(f.name));
    if (summaryFactions.length == 0) return;
    // Apply any override faction options
    joinedFactions.push(...overrideFinishedFactions.filter(f => !joinedFactions.includes(f)));
    for (const faction of overrideFinishedFactions)
        simulatedOwnedAugmentations.push(...factionData[faction]?.unownedAugmentations() || []);
    // Grab disctinct augmentations stats
    const relevantAugStats = allAugStats.filter(s => !excludedStats.find(excl => s.includes(excl)) &&
        undefined !== summaryFactions.find(f => f.unownedAugmentations().find(aug => 1 != (augmentationData[aug].stats[s] || 1))));
    summary += `${summaryFactions.length} factions with augmentations (Ã¢Å“â€œ=Joined Ã¢Å“â€°=Invited Ã¢Å“â€”=Locked, sorted by total ${sortBy}):`;
    // Creates the table header row
    let getHeaderRow = countName => `\nÃ‚Â Ã‚Â Ã‚Â Faction Name ${countName.padStart(9)} / Total Augs ` + relevantAugStats.map(key => shorten(key).padStart(4)).join(' ');
    // Creates the string to display a single faction's stats in the table
    let getFactionSummary = faction => {
        const totalMults = faction.totalUnownedMults();
        return `\nÃ‚Â ${faction.joined ? 'Ã¢Å“â€œ' : faction.invited ? 'Ã¢Å“â€°' : 'Ã¢Å“â€”'} ${faction.name} `.padEnd(32) +
            `${String(faction.unownedAugmentations().length).padStart(2)} / ${String(faction.augmentations.length).padEnd(2)} ` +
            relevantAugStats.map(key => (totalMults[key] === undefined ? '-' : totalMults[key].toPrecision(3)).padStart(Math.max(shorten(key).length, 4))).join(' ');
    };
    // Helper to sort the factions in order of most-contributing to the desired multiplier
    let sortFunction = (a, b) => {
        let aMultiContrib = a.totalUnownedMults()[sortBy] || 1, bMultiContrib = b.totalUnownedMults()[sortBy] || 1;
        let sort1 = bMultiContrib - aMultiContrib; // Sort by the total amount of desired multi provided by this faction
        let sort2 = (a.joined ? 0 : 1) - (b.joined ? 0 : 1); // If tied, sort by which faction we've joined
        if (unique && bMultiContrib > 1 && aMultiContrib > 1 && sort2 != 0) return sort2; // When in "unique" mode it's important to first list contributing factions we've already joined
        if (sort1 != 0) return sort1;
        if (sort2 != 0) return sort2;
        let sort3 = b.reputation - a.reputation; // If tied, sort by which faction we have the most rep with
        if (sort3 != 0) return sort3;
        let sort4 = a.augToDropCost().length - b.augToDropCost().length; // If tied, "soonest to unlock", estimated by their most expensive aug cost
        if (sort4 != 0) return sort4;
        return (a.name).localeCompare(b.name) // If still tied, sort by naeme
    };
    // Helper to insert a table separator between factions that do and don't contribute to the specified stat
    let moreContributors = true;
    let getSeparator = faction => (moreContributors && !(moreContributors = faction.totalUnownedMults()[sortBy] !== undefined)) ?
        `\n---------------------------  (Factions below offer no augs that contribute to '${sortBy}')` : '';
    summary += getHeaderRow(unique ? 'New' : 'Unowned');
    const unownedAugCount = Object.values(augmentationData).length - simulatedOwnedAugmentations.length;
    if (!unique) // Each faction is summarized based on all the unowned augs it has, regardless of whether a faction higher up the list has the same augs
        for (const faction of summaryFactions.sort(sortFunction))
            summary += getSeparator(faction) + getFactionSummary(faction);
    else { // Each faction's stats computed as though the faction sorted above it was joined and bought out first, so only showing new augs
        const actualOwnedAugs = simulatedOwnedAugmentations;
        const actualUnjoinedFactions = summaryFactions;
        do {
            summaryFactions.sort(sortFunction);
            const faction = summaryFactions.shift();
            summary += getSeparator(faction) + getFactionSummary(faction);
            joinedFactions.push(faction.name);  // Simulate that we've now joined and bought out all this factions augs
            simulatedOwnedAugmentations.push(...faction.unownedAugmentations())
        } while (summaryFactions.length > 0)
        simulatedOwnedAugmentations = actualOwnedAugs; // Restore the original lists once the simulation is complete
        summaryFactions = actualUnjoinedFactions;
    }
    log(ns, `INFO: The following is a summary of ${unownedAugCount} remaining augmentations available from each faction:\n` + summary, printToTerminal);
}


async function executeFactionPurchases(ns,orders,donations=false) {
 if(donations&&options['disable-donations'])return 0;
 const adapter=donations?'rep:f=>ns.singularity.getFactionRep(f),donate:(f,a)=>ns.singularity.donateToFaction(f,a)':'price:a=>ns.singularity.getAugmentationPrice(a),buy:(f,a)=>ns.singularity.purchaseAugmentation(f,a)';
 const result=await getNsDataThroughFile(ns,`(() => {
  const snapshot=(${captureAugmentationOwnership.toString()})(ns);
  if(!snapshot?.complete||snapshot.signature!==ns.args[4])return {count:-1};
  const expected=JSON.parse(ns.args[5]),market=(${captureAugmentationEconomics.toString()})(ns,expected?.watch);
  if((${augmentationEconomicsChange.toString()})(expected,market,{allowRepDrift:true}).changed)return {count:-2};
  if(ns.args[2]&&!(${augmentationBatchFunded.toString()})(market,JSON.parse(ns.args[6]),JSON.parse(ns.args[0]),ns.args[7],ns.args[3],ns.getPlayer().money,ns.read("reserve.txt")))return {count:-3};
  const count=(${factionPurchaseBatch.toString()})({player:()=>ns.getPlayer(),${adapter}},JSON.parse(ns.args[0]),
   ()=>(!ns.args[8]||ns.isRunning(ns.args[8]))&&(${factionControlAllowed.toString()})({isRunning:p=>ns.isRunning(p),read:f=>ns.read(f)},ns.args[1],"faction-manager.js")&&(${achievementActionAllowed.toString()})(ns,"cashSpending"),
   ()=>ns.read("reserve.txt"),ns.args[2],ns.args[3]);
  return {count,market:ns.args[2]?(${captureAugmentationEconomics.toString()})(ns,expected.watch):null};
 })()`,donations?'/Temp/facman-donate.txt':'/Temp/facman-purchase-augs.txt',
 [JSON.stringify(orders),ns.pid,donations,bitNodeMults.FactionWorkRepGain,ownershipSnapshot?.signature||'',JSON.stringify(economicsSnapshot),JSON.stringify(purchaseableAugs.map(a=>({augmentation:a.name}))),augCountMult,Number(String(options['purchase-request']||'').split(':')[0])||0]);
 if(donations&&result?.count>=0&&result.market?.complete)economicsSnapshot=result.market; // Own donations must not invalidate the following purchase phase.
 return result?.count??0;
}

/** Refresh before price-sensitive count selection and after our own membership changes. */
async function refreshAugmentationQuotes(ns) {
        const watch={augmentations:Object.values(augmentationData).filter(a=>!a.owned||a.name===strNF).map(a=>a.name).sort(),
            factions:Object.values(factionData).map(f=>({name:f.name,augmentations:f.augmentations.filter(n=>!augmentationData[n]?.owned||n===strNF)})).sort((a,b)=>a.name.localeCompare(b.name))};
        economicsSnapshot=await getNsDataThroughFile(ns,`(${captureAugmentationEconomics.toString()})(ns,JSON.parse(ns.args[0]))`,
            '/Temp/faction-augmentation-economics.txt',[JSON.stringify(watch)]);
        if(!economicsSnapshot?.complete)return false;
        for(const [name,q]of Object.entries(economicsSnapshot.quotes)){augmentationData[name].price=q.price;augmentationData[name].reputation=q.rep;}
        favorToDonate=economicsSnapshot.favorToDonate;playerData.mults.faction_rep=economicsSnapshot.repMultiplier;
        for(const [name,f]of Object.entries(economicsSnapshot.factions)){
            factionData[name].reputation=f.rep;factionData[name].favor=f.favor;factionData[name].joined=f.joined;
            factionData[name].donationsUnlocked=f.favor>=favorToDonate&&![gangFaction,...factionsWithoutDonation].includes(name);
        }
    return true;
}
