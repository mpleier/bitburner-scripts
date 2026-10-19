import {launchCooldown,recordLaunch,launchCooldownKey} from './launch-cooldown-policy.js';
import {priorityManagerPlan,automaticManagerScripts,moduleManifest} from './automation-manifest.js';
import {collectAutomationPreview,printAutomationPreview,previewOptions,previewRequested} from './automation-preview-policy.js';
import {observeCasinoReset,forecastCasinoReset} from './casino-reset-policy.js';
import {chooseNodeRoute,nodeRouteAvailability,routeContinuousXp,routeDevelopment} from './node-route-selection-policy.js';
import {factionWorkerReady} from './early-game-policy.js';
import {casinoSeedMoney,earnCasinoSeedSource,chooseCasinoSeedCrime,seedSleevesSource,essentialHomeRamSource} from './casino-bootstrap-policy.js';
import {planRedPill,purchaseRedPillSource} from './red-pill-policy.js';
import {nodeRouteFile,nodeRouteSnapshotSource,sampleRouteProgress,estimateDaemonRoute,estimateBladeburnerRoute} from './node-route-policy.js';
import {homeRamReserve,reclaimHomeRam,essentialManagerRamTarget} from './home-ram-policy.js';
import {observeCombatRecovery,augmentationResetDecision,augmentationFourSigmaWait,progressionSpeed} from './progression-speed-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested,scriptSignature} from './runtime-policy.js';
import {campaignReady,challengeProfile,achievementNode,achievementActionAllowed} from './achievement-policy.js';
import {achievementWorkerSources} from './achievement-worker-sources.js';
import { autopilotSourceFiles, installedAugmentationsFromReset, daemonArgumentsChanged, autopilotOptionsError, autopilotStockReserve, priorityAugmentationReady, freshFactionManagerOutput } from './autopilot-policy.js';
import { spendingPlan,adaptiveBudgetSignals,claimSpending } from './spending-policy.js';
import { prepareResetBackup } from './reset-backup.js';
import { maximumSleeves,sleeveCrimeChance } from './sleeve-policy.js';
import { casinoRetryPending, casinoHookArgs } from './casino-policy.js';
import { isScriptPaused } from './automation-control.js';
import { planBitNodePriority } from './bitnode-priority.js';
import { activityBusy, ramReserveFile, activityGuard } from './activity-coordination.js';
import { beginTransition, endTransition, bitNodeVictory, bitNodeDeparture, runCompletionHook } from './progression-coordination.js';
import {
    log, getFilePath, getConfiguration, instanceCount, getNsDataThroughFile, runCommand, waitForProcessToComplete,
    tryGetBitNodeMultipliers, getStocksValue,
    formatMoney, formatDuration, formatNumber, getErrorInfo, tail, jsonReplacer
} from './helpers.js'

const argsSchema = [ // The set of all command line arguments
    ['dry-run',false], // Read-only preview; returns before startup hooks or writes.
    ['preview',false],
    ['intelligence-farming', false], // Dedicated, bounded fresh-reset session; disabled by default.
    ['intelligence-target', 200],
    ['intelligence-max-resets', 100],
    ['intelligence-max-minutes', 10],
    ['disable-achievements', false], // Supervise native achievement goals and schedule dedicated runs after Source Files.
    ['next-bn', 0], // If we destroy the current BN, the next BN to start
    ['wait-in-bitverse-for-achievement', false], // Optional INDECISIVE attempt opens manual selection and interrupts automatic departure.
    ['disable-auto-destroy-bn', false], // Set to true if you do not want to auto destroy this BN when done
    ['install-at-aug-count', 8], // Automatically install when we can afford this many new augmentations (with NF only counting as 1). Note: This number will automatically be increased by 1 for every level of SF11 you have (up to 3)
    ['install-at-aug-plus-nf-count', 12], // or... automatically install when we can afford this many augmentations including additional levels of Neuroflux.  Note: This number will automatically be increased by 1 for every level of SF11 you have (up to 3)
    ['install-for-augs', ["The Red Pill", "The Blade's Simulacrum"]], // or... install when one of these is affordable or purchased and awaiting installation
    ['disable-adaptive-resets', false], // Use only the existing augmentation count and countdown rules.
    ['adaptive-node-route', true], // Use BN preferences and stable ETA comparisons. False retains the legacy WD preference.
    ['node-route','auto'], // auto, wd, bb; explicit routes override automatic comparison when available.
    ['force-xp',false], // Explicitly keep hacking XP priority even while pursuing Bladeburner.
    ['disable-node-route-planner', false], // Keep legacy progression priorities; ignore route comparisons.
    ['disable-adaptive-spending', false], // Keep the base cash allowances.
    ['install-countdown', 5 * 60 * 1000], // If we're ready to install, wait this long first to see if more augs come online (we might just be gaining momentum)
    ['time-before-boosting-best-hack-server', 15 * 60 * 1000], // Wait this long before picking our best hack-income server and spending hashes on boosting it
    ['reduced-aug-requirement-per-hour', 0.5], // For every hour since the last reset, require this many fewer augs to install.
    ['interval', 2000], // Wake up this often (milliseconds) to check on things
    ['interval-check-scripts', 10000], // Get a listing of all running processes on home this frequently
    ['high-hack-threshold', 8000], // Once hack level reaches this, we start daemon in high-performance hacking mode
    ['enable-bladeburner', null], // (Deprecated) Bladeburner is now always enabled if it's available. Use '--disable-bladeburner' to explicitly turn off
    ['disable-bladeburner', false], // This will instruct daemon.js not to run the bladeburner.js, even if bladeburner is available.
    ['disable-corporation', false], // Prevent autopilot and its daemon from starting corporation-manager.js.
    ['disable-go', false], // Prevent automatic IPvGO launches.
    ['disable-infiltration', false], // Leave infiltration entry and minigames manual.
    ['wait-for-4s-threshold', 0.9], // Minimum fraction of the 4S price before considering a bounded funding wait; 0 removes only this proximity gate.
    ['disable-wait-for-4s', false], // If true, will doesn't wait for the 4S Tix API to be acquired under any circumstantes
    ['disable-rush-gangs', false], // Set to true to disable focusing work-for-faction on Karma until gangs are unlocked
    ['disable-casino', false], // Set to true to disable running the casino.js script automatically
    ['spend-hashes-on-server-hacking-threshold', 0.1], // Threshold for how good hacking multipliers must be to merit spending hashes for boosting hack income. Set to a large number to disable this entirely.
    ['on-completion-script', null], // Spawn this script when we defeat the bitnode
    ['on-completion-script-args', []], // Optional args to pass to the script when we defeat the bitnode
    ['disable-continuous-xp', false], // XP is the default hacking priority; opt out to restore adaptive income/XP scheduling.
    ['xp-mode-interval-minutes', 55], // Every time this many minutes has elapsed, toggle daemon.js to runing in --xp-only mode, which prioritizes earning hack-exp rather than money
    ['xp-mode-duration-minutes', 5], // The number of minutes to keep daemon.js in --xp-only mode before switching back to normal money-earning mode.
    ['no-tail-windows', true], // Suppress automatic tail windows; open script logs manually from the terminal.
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--on-completion-script"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** The entire program is now wrapped in the main functino to avoid objects in
 * global shared memory surviving between multiple invocations of this script.
 * @param {NS} ns **/
export async function main(ns) {
 if(previewRequested(ns)){
  const options=previewOptions(ns,argsSchema);printAutomationPreview(ns,collectAutomationPreview(ns,options));return;
 }
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
    const persistentLog = "log.autopilot.txt";
    const factionManagerOutputFile = "/Temp/affordable-augs.txt"; // Temp file produced by faction manager with status information
    const augTRP = "The Red Pill";
    const augStanek = `Stanek's Gift - Genesis`;

    let achievementProfile, achievementState;
    let bnPriority;
    const launchHistory=new Map(),launchSourceCache=new Map();
    const trackedLaunches=new Set(moduleManifest.filter(m=>m.supervised||m.priority).map(m=>m.script));
    let options; // The options used at construction time
    let playerInGang = false, rushGang = false; // Tells us whether we're should be trying to work towards getting into a gang
    let playerInBladeburner = false; // Whether we've joined bladeburner
    let wdHack = (/**@returns{null|number}*/() => null)(); // If the WD server is available (i.e. TRP is installed), caches the required hack level
    let casinoSeedWorkerPid=0,casinoSeedPending=false,lastSeedSleeves=0;
    let ranCasino = false; // Flag to indicate whether we've stolen 10b from the casino yet
    let reservedPurchase = 0; // The amount of player money that has been reserved to purchase augmentations
    let alreadyJoinedDaedalus = false, autoJoinDaedalusUnavailable = false, reservingMoneyForDaedalus = false, disableStockmasterForDaedalus = false; // Flags to indicate that we should be keeping 100b cash on hand to earn an invite to Daedalus
    let prioritizeHackForDaedalus = false, prioritizeHackForWd = false;
    let routePlan=null, routeObservation=null, routeSnapshotAt=0;
    let xpMeasurementActive=false, redPillLiquidating=false;
    let lastScriptsCheck = 0; // Last time we got a listing of all running scripts
    let homeRam = 0; // Amount of RAM on the home server, last we checked
    let killScripts = []; // A list of scripts flagged to be restarted due to changes in priority
    let dictOwnedSourceFiles = (/**@returns{{[k: number]: number;}}*/() => [])(); // Player owned source files
    let dictServerHackReqs = (/**@returns{{[serverName: string]: number;}}*/() => undefined)(); // Hacking requirement for each server
    let unlockedSFs = [], nextBn = 0; // Info for the current bitnode
    let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // Information about the current bitnode
    let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)(); // bitNode multipliers that can be automatically determined after SF-5
    let playerInstalledAugCount = (/**@returns{null|number}*/() => null)(); // Number of augs installed, or null if we don't have SF4 and can't tell.
    let installedAugmentations = [];
    let acceptedStanek = false, stanekLaunched = false;
    let daemonStartTime = 0; // The time we personally launched daemon.
    let speedObservation, combatRecovery, augmentationWaitWindow, installWindowStarted=0;
    let nextFactionSummaryRefresh=0;
    let installCountdown = 0; // Start of a countdown before we install augmentations.
    let installCountdownResets = 0; // Number of times we've reset the countdown because our affordable augs has increased
    let bnCompletionSuppressed = false; // Flag if we've detected that we've won the BN, but are suppressing a restart
    let sleevesMaxedOut = false; // Flag used only when the player is replaying BN 10 with all sleeves but has suppressed auto-destroying the BN, to allow continued auto-installs
    let loggedBnCompletion = false; // Flag set to ensure that if we choose to stay in the BN, we only log the "BN completed" message once per reset.
    let have4STixApi = false; // Whether we have access to the 4S (stockmarket) API. Once confirmed true, we can stop checking.
    let have4SData = false; // Whether we have access to 4S (stockmarket) data. Once confirmed true, we can stop checking.

    // Replacements for player properties deprecated since 2.3.0
    function getTimeInAug() { return Date.now() - resetInfo.lastAugReset; }
    function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

    /** @param {NS} ns **/
    async function main_start(ns) {
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
        options = runOptions;
        const optionError = autopilotOptionsError(options);
        if (optionError) return ns.tprint('Autopilot: '+optionError);
        try { options['on-completion-script-args'] = casinoHookArgs(options['on-completion-script-args']); }
        catch (error) { return ns.tprint('Autopilot completion arguments: '+String(error)); }
        ns.atExit(() => {
            endTransition(ns);
            try { if (JSON.parse(ns.read(ramReserveFile)).ownerPid === ns.pid) ns.rm(ramReserveFile, 'home'); } catch { }
        });

        log(ns, "INFO: Auto-pilot engaged...", false, 'info');
        // The game does not allow boolean flags to be turned "off" via command line, only on. Since this gets saved, notify the user about how they can turn it off.
        const flagsSet = ['disable-auto-destroy-bn', 'disable-bladeburner', 'disable-corporation', 'disable-wait-for-4s', 'disable-rush-gangs'].filter(f => options[f]);
        for (const flag of flagsSet)
            log(ns, `WARNING: You have previously enabled the flag "--${flag}". Because of the way this script saves its run settings, the ` +
                `only way to now turn this back off will be to manually edit or delete the file ${ns.getScriptName()}.config.txt`, true);

        let startUpRan = false, keepRunning = true;
        while (keepRunning) {
            automationHeartbeat(ns);
            try {
                // Start-up actions, wrapped in error handling in case of temporary failures
                if (!startUpRan) startUpRan = await startUp(ns);
                // Main loop: Monitor progress in the current BN and automatically reset when we can afford TRP, or N augs.
                keepRunning = await mainLoop(ns);
            }
            catch (err) {
                log(ns, `WARNING: autopilot.js Caught (and suppressed) an unexpected error:` +
                    `\n${getErrorInfo(err)}`, false, 'warning');
                keepRunning = shouldWeKeepRunning(ns);
            }
            await ns.sleep(options['interval']);
        }
    }

    /** @param {NS} ns **/
    async function startUp(ns) {
        await persistConfigChanges(ns);

        // Collect and cache some one-time data
        resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
        dictOwnedSourceFiles = autopilotSourceFiles(resetInfo, false);
        unlockedSFs = autopilotSourceFiles(resetInfo, true);
        let nativeAchievements=[],runSnapshot={};
        if(4 in unlockedSFs&&!options['disable-achievements']) {
            nativeAchievements=await getNsDataThroughFile(ns,'ns.singularity.getUnlockedAchievements()','/Temp/achievement-start-unlocked.txt');
            // Native challenge eligibility is only needed once the achievement campaign is unlocked.
            if(campaignReady(dictOwnedSourceFiles))
                runSnapshot=await getNsDataThroughFile(ns,`(${achievementWorkerSources.achievementRunSnapshot})(ns)`,'/Temp/achievement-start-snapshot.txt');
        }
        let oldProfile;try{oldProfile=JSON.parse(ns.read('tasks/achievement-profile.json'));}catch{}
        achievementProfile=challengeProfile(resetInfo,nativeAchievements,runSnapshot,dictOwnedSourceFiles,oldProfile,!options['disable-achievements']);
        await ns.write('tasks/achievement-profile.json',JSON.stringify(achievementProfile),'w');
        if(options['disable-achievements']){await killScript(ns,'achievement-manager.js');ns.rm('tasks/achievement-goals.json','home');}
        bitNodeMults = null;
        if (5 in unlockedSFs) try { bitNodeMults = await getNsDataThroughFile(ns, 'ns.getBitNodeMultipliers()', '/Temp/autopilot-bitnode-multipliers.txt', [], false, 1, 0, true); } catch { }
        bitNodeMults ??= await tryGetBitNodeMultipliers(ns);
        homeRam = await getNsDataThroughFile(ns, `ns.getServerMaxRam(ns.args[0])`, null, ["home"]);

        installedAugmentations = installedAugmentationsFromReset(resetInfo);
        playerInstalledAugCount = installedAugmentations.length;
        if (!(4 in unlockedSFs))
            log(ns, 'Singularity is unavailable; hacking and unlocked managers continue, while augmentation purchases and installs wait.', true);
        // We currently no longer have any one-time logic that needs to be run at the start of a new bitnode
        //if (getTimeInBitnode() < 60 * 1000) // Skip initialization if we've been in the bitnode for more than 1 minute
        //    await initializeNewBitnode(ns);

        // Decide what the next-up bitnode should be
        bnPriority = planBitNodePriority(dictOwnedSourceFiles, resetInfo.currentNode, options['next-bn']);
        const recommended = bnPriority.recommended;
        nextBn = options['next-bn']||options['disable-achievements']?bnPriority.nextBn:achievementNode(bnPriority.projectedLevels,nativeAchievements,bnPriority.nextBn,achievementProfile);
        log(ns, `INFO: General progression recommends BN${recommended.node} until SF${recommended.node} level ${recommended.targetLevel}: ${recommended.reason}.` +
            `\nThis run earns SF${resetInfo.currentNode} level ${bnPriority.projectedLevels[resetInfo.currentNode]}.`);
        if (!bnPriority.validOverride)
            log(ns, `WARNING: Invalid --next-bn ${nextBn}; automatic departure will wait until the configuration is corrected.`, true, 'warning');
        else if (bnPriority.overridden)
            log(ns, `INFO: --next-bn overrides the recommendation with BN${nextBn}.`);
        await ns.write('tasks/bitnode-priority.json', JSON.stringify({ at: Date.now(), ...bnPriority, nextBn, nodeReset: resetInfo.lastNodeReset, automatic: !options['next-bn'], autoEnter: !options['disable-auto-destroy-bn'], ownerPid: ns.pid }), 'w');

        return true;
    }

    /** Write any configuration changes to disk so that they will survive resets and new bitnodes
     * @param {NS} ns **/
    async function persistConfigChanges(ns) {
        // Because we cannot pass args to "install" and "destroy" functions, we write them to disk to override defaults
        const changedArgs = argsSchema
            .filter(a => JSON.stringify(options[a[0]], jsonReplacer) != JSON.stringify(a[1]), jsonReplacer)
            .map(a => [a[0], options[a[0]]]);
        // Fix Bug #237 - do not overwrite the config file if one of the arguments provided is of the wrong type
        // This is a copy of new code in helpers.js which generates warnings, but otherwise ignores the errors.
        // We evaluate the same logic here because we want to act on the errors (avoid persisting them)
        for (const [key, finalValue] of changedArgs) {
            const defaultValue = argsSchema.find(kvp => kvp[0] == key)[1];
            const strFinalValue = JSON.stringify(finalValue, jsonReplacer);
            const strDefaultValue = JSON.stringify(defaultValue, jsonReplacer);
            log(ns, `INFO: Default config has been modified: ${key}=${strFinalValue} (type="${typeof finalValue})" ` +
                `does not match default value of ${key}=${strDefaultValue} (type="${typeof defaultValue}").`);
            if ((typeof finalValue) !== (typeof defaultValue) && defaultValue != null) {
                log(ns, `WARNING: A configuration value provided (${key}=${strFinalValue} - ` +
                    `type="${typeof finalValue}") does not match the expected type "${typeof defaultValue}" ` +
                    `based on the default value (${key}=${strDefaultValue}).` +
                    `\nThis configuration will NOT be persisted, and the script may behave unpredictably.`);
                return;
            }
            if (finalValue !== defaultValue && (typeof finalValue == 'number') && Number.isNaN(finalValue)) {
                log(ns, `WARNING: A numeric configuration value (--${key}) got a value of "NaN" (Not a Number), ` +
                    `which likely indicates it was set to a string value that could not be parsed. ` +
                    `Please double-check the script arguments for mistakes or typos.` +
                    `\nThis configuration will NOT be persisted, and the script may behave unpredictably.`);
                return;
            }
        }

        const strConfigChanges = JSON.stringify(changedArgs, jsonReplacer);
        // Only update the config file if it doesn't match the most resent set of run args
        const configPath = `${ns.getScriptName()}.config.txt`
        const currentConfig = ns.read(configPath);
        if ((strConfigChanges.length > 2 || currentConfig) && strConfigChanges != currentConfig) {
            await ns.write(configPath, strConfigChanges, "w");
            log(ns, `INFO: Updated "${configPath}" to persist the most recent run args through resets: ${strConfigChanges}`, false, 'info');
        }
    }

    /** Logic run once at the beginning of a new BN
     * @param {NS} ns */
    async function initializeNewBitnode(ns) {
        // Nothing to do here (yet)
    }

    /** Logic run periodically throughout the BN
     * @param {NS} ns */
    async function mainLoop(ns) {
        // A casino started outside autopilot still has first priority.
        if (ns.ps('home').some(process => /(^|\/)casino\.js$/.test(process.filename))) return true;
        const player = await getPlayerInfo(ns);
        // Cash-poor starts prioritize the casino at every home size; unavailable workers yield to hacking.
        if (await bootstrapCasino(ns, player)) return true;
        if(casinoSeedPending){
            await checkOnRunningScripts(ns,player,true);
            return shouldWeKeepRunning(ns);
        }
        await ensureEssentialHomeRam(ns,player);
        await updateCachedData(ns);
        let stocksValue = 0;
        try { stocksValue = await getStocksValue(ns); } catch { /* Assume if this fails (insufficient ram) we also have no stocks */ }
        await manageReservedMoney(ns, player, stocksValue);
        // Casino has priority over BitNode completion and other progression work.
        await maybeDoCasino(ns, player);
        try{achievementState=JSON.parse(ns.read('tasks/achievement-status.json'));}catch{}
        if(!options['next-bn']&&!options['disable-achievements']&&Array.isArray(achievementState?.unlocked))
            nextBn=achievementNode(bnPriority.projectedLevels,achievementState.unlocked,bnPriority.nextBn,achievementProfile,achievementState.catalogVerified?achievementState.achievements.map(a=>a.ID):null);
        await updateXpMeasurement(ns,player);
        await checkOnDaedalusStatus(ns, player, stocksValue);
        await updateNodeRoutePlan(ns, stocksValue);
        await manageRedPill(ns,player,stocksValue);
        await checkIfBnIsComplete(ns, player);
        if(options['intelligence-farming']) {
            let session;try{session=JSON.parse(ns.read('tasks/intelligence-session.json'));}catch{}
            if(!(session?.nodeReset===resetInfo.lastNodeReset&&['complete','blocked'].includes(session.status))&&4 in unlockedSFs&&(resetInfo.currentNode===5||Number(dictOwnedSourceFiles[5])>0)) {
                const pid=launchScriptHelper(ns,'farm-intelligence.js',['--target',options['intelligence-target'],'--max-resets',options['intelligence-max-resets'],'--max-minutes',options['intelligence-max-minutes']]);
                if(pid)await waitForProcessToComplete(ns,pid);
            }
        }
        await maybeAcceptStaneksGift(ns, player);
        await checkOnRunningScripts(ns, player);
        await maybeInstallAugmentations(ns, player);
        return shouldWeKeepRunning(ns); // Return false to shut down autopilot.js if we installed augs, or don't have enough home RAM
    }

    /** Ram-dodge getting player info.
     * @param {NS} ns
     * @returns {Promise<Player>} */
    async function getPlayerInfo(ns) {
        return await getNsDataThroughFile(ns, `ns.getPlayer()`);
    }

    /** Update some information that can be safely cached for small periods of time
     * @param {NS} ns */
    async function updateCachedData(ns) {
        const freshReset = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
        installedAugmentations = installedAugmentationsFromReset(freshReset);
        playerInstalledAugCount = installedAugmentations.length;
    }

    /** Logic run periodically to if there is anything we can do to speed along earning a Daedalus invite
     * @param {NS} ns
     * @param {Player} player **/
    async function checkOnDaedalusStatus(ns, player, stocksValue) {
        // Early exit conditions, if we Daedalus is not (or is no longer) a concern for this reset
        if (alreadyJoinedDaedalus || autoJoinDaedalusUnavailable) return;
        // If we've already installed the red pill we no longer need to try to join this faction.
        // Even without SF4, we can "deduce" whether we've installed TRP by checking whether w0r1d_d43m0n has a non-zero hack level
        if (installedAugmentations.includes(augTRP) || (wdHack != null && Number.isFinite(wdHack) && wdHack > 0))
            return alreadyJoinedDaedalus = true; // Set up an early exit condition for future checks
        // See if we even have enough augmentations to attempt to join Daedalus (once we have a count of our augmentations)
        if (playerInstalledAugCount !== null && playerInstalledAugCount < bitNodeMults.DaedalusAugsRequirement) {
            if (!(10 in unlockedSFs))
                autoJoinDaedalusUnavailable = true; // Won't be able to unlock daedalus this ascend if we can't graft augs and have to install for them
            return; // Either way, for now we can't get into Daedalus without more augmentations
        }

        // See if we've already joined this faction
        if (player.factions.includes("Daedalus")) {
            alreadyJoinedDaedalus = true;
            disableStockmasterForDaedalus = false;
            // If we previously took any action to "rush" Daedalus, keep the momentum going by restarting work-for-factions.js
            // so that it immediately re-assesses priorities and sees there's a new priority faction to earn reputation for.
            if (prioritizeHackForDaedalus || reservingMoneyForDaedalus) {
                let reason;
                if (prioritizeHackForDaedalus) {
                    prioritizeHackForDaedalus = false; // Can turn off this flag now so daemon.js can be reverted
                    reason = "by prioritizing hack exp gains";
                }
                if (reservingMoneyForDaedalus) {
                    reservingMoneyForDaedalus = false; // Turn this flag off now so we reset our reserve.txt
                    reason = (reason ? reason + " and" : "by") + " saving up our money";
                }
                log(ns, `SUCCESS: We sped along joining the faction 'Daedalus' ${reason}. ` + // Pat ourselves on the back
                    `Restarting work-for-factions.js to speed along earn rep.`, false, 'success');
                killScripts.push("work-for-factions.js"); // Schedule this to be killed (will be restarted) on the next script loop.
                lastScriptsCheck = 0; // Reset cooldown on checking whether any changes need to be made to running scripts
            }
            return;
        }
        const moneyReq = 100E9;
        // If we've previously set a flag to wait for the daedalus invite and reserve money, try to speed-along joining them
        if (reservingMoneyForDaedalus && player.money >= moneyReq) // If our cash has dipped below the threshold again, we may need to take action below
            return await getNsDataThroughFile(ns, 'ns.singularity.joinFaction(ns.args[0])', null, ["Daedalus"]); // Note, we should have already checked that we have SF4 access before reserving money

        // Remaining logic below is for rushing a Daedalus invite in the current reset
        const totalWorth = player.money + stocksValue;
        // Check for sufficient hacking level before attempting to reserve money
        const combatEntryReady=['strength','defense','dexterity','agility'].every(stat=>player.skills[stat]>=1500);
        if (combatEntryReady) prioritizeHackForDaedalus=false;
        if (player.skills.hacking < 2500 && !combatEntryReady) {
            // If we happen to already have enough money for daedalus and are only waiting on hack-level,
            // set a flag to switch daemon.js into --xp-only mode, to prioritize earning hack exp over money
            // HEURISTIC (i.e. Hack): Only do this if we naturally get within 75% of the hack stat requirement,
            //    otherwise, assume our hack gain rate is too low in this reset to make it all the way to 2500.
            if (totalWorth >= moneyReq && player.skills.hacking >= (2500 * 0.75))
                prioritizeHackForDaedalus = true;
            //log(ns, `total worth: ${formatMoney(totalWorth)} moneyReq: ${formatMoney(moneyReq)} prioritizeHackForDaedalus: ${prioritizeHackForDaedalus}`)
            return reservingMoneyForDaedalus = false; // Don't reserve money until hack level suffices
        }
        // If we have sufficient augs and hacking, the only requirement left is the money (100b)
        // If our net worth is sufficient, reserve our money and liquidate stocks if necessary until we get the invite
        if (player.money < moneyReq && totalWorth > moneyReq * 1.001 /* slight buffer to account for timing issues */) {
            // Note: Without SF4, we have no way of knowing how many augmentations we own, so we should probably
            //       never reserve money in case this requirement is not met, or we're potentially just wasting money
            if (!(4 in unlockedSFs)) {
                log(ns, `SUCCESS: ${player.money < moneyReq ? "If you sell your stocks, y" : "Y"}ou should have enough money ` +
                    `(>=${formatMoney(moneyReq)}) and sufficient hacking or combat stats to get an invite from the faction Daedalus. ` +
                    `Before you attempt this though, ensure you have ${bitNodeMults.DaedalusAugsRequirement} ` +
                    `augmentations installed (scripts cannot check this without SF4).`, true, 'success');
                return autoJoinDaedalusUnavailable = true; // We won't show this again.
            }
            reservingMoneyForDaedalus = true; // Flag to pause all spending (set reserve.txt) until we've gotten the Daedalus invite
            if (player.money < moneyReq) { // Only liquidate stocks if we don't have enough cash lying around.
                disableStockmasterForDaedalus = true; // Flag to keep stockmaster offline until we've gotten a daedalus invite
                log(ns, "INFO: Temporarily liquidating stocks to earn an invite to Daedalus...", false, 'info');
                launchScriptHelper(ns, 'stockmaster.js', ['--liquidate']);
            } // else if we don't liquidate stocks, and our money dips below 100E9 again, we can always do it on the next loop
        } else if (resetInfo.currentNode == 8) {
            // In BN8, there is nothing worth spending money on when we've met all other Daedalus requirements except the $100b money.
            // We should immediately set the reserve and wait until we have enough wealth to liquidate stocks and get the invite.
            reservingMoneyForDaedalus = true;
        } // Cancel the reserve if our money drops below the threshold before getting an invite (due to other scripts not respecting the reserve?)
        else if (reservingMoneyForDaedalus && totalWorth < moneyReq * 0.999 /* slight buffer to let cash recover */) {
            reservingMoneyForDaedalus = false; // Cancel the hold on funds, and wait for total worth to increase again
            disableStockmasterForDaedalus = false; // Allow stockmaster to be relaunched
            log(ns, `WARN: We previously had sufficient wealth to earn a Daedalus invite (>=${formatMoney(moneyReq)}), ` +
                `but our wealth somehow decreased (to ${formatMoney(totalWorth)}) before the invite was recieved, ` +
                `so we'll need to wait for it to recover and try again later.`, false, 'warning');
        }
    }

    /** Bounded native XP experiment; daemon scheduling returns to normal after completion/expiry. */
    async function updateXpMeasurement(ns, player) {
        xpMeasurementActive=false;
        let m;try{m=JSON.parse(ns.read('tasks/xp-measurement.json'));}catch{return;}
        if(!['requested','arming','measuring'].includes(m?.state))return;
        const now=Date.now();
        const abort=reason=>{m.state='aborted';m.reason=reason;m.finishedAt=now;};
        if(!Number.isFinite(m.expiresAt)||m.expiresAt<=now)abort('Measurement expired before completion');
        else if(m.augReset!==resetInfo.lastAugReset||m.nodeReset!==resetInfo.lastNodeReset)abort('Augmentation or BitNode reset changed the experiment');
        else if(!Number.isInteger(m.durationMs)||m.durationMs<60000||m.durationMs>600000)abort('Invalid measurement duration');
        else {
            const daemon=ns.ps('home').find(p=>p.filename.replace(/^\//,'')==='daemon.js');
            const xpMode=daemon?.args.includes('--xp-only');
            if(m.state==='requested')m.state='arming';
            if(m.state==='arming'&&xpMode) {
                m.state='measuring';m.startedAt=now;m.startExp=player.exp.hacking;m.startHack=player.skills.hacking;
                m.hackMult=player.mults.hacking;m.expMult=player.mults.hacking_exp;m.daemonPid=daemon.pid;m.samples=[];
            }
            if(m.state==='measuring') {
                if(!xpMode||daemon.pid!==m.daemonPid)abort('Dedicated XP daemon stopped or restarted');
                else if(player.mults.hacking!==m.hackMult||player.mults.hacking_exp!==m.expMult)abort('Hacking multipliers changed');
                else if(player.exp.hacking<m.startExp)abort('Hacking XP decreased');
                else {
                    if(!m.samples.length||now-m.samples.at(-1).at>=10000)m.samples.push({at:now,exp:player.exp.hacking,hacking:player.skills.hacking});
                    if(now-m.startedAt>=m.durationMs) {
                        m.state='completed';m.finishedAt=now;m.endExp=player.exp.hacking;m.endHack=player.skills.hacking;
                        m.elapsedMs=now-m.startedAt;m.gainedExp=m.endExp-m.startExp;m.xpPerSecond=m.gainedExp/(m.elapsedMs/1000);
                        const steady=m.samples.find(s=>s.at>=m.startedAt+60000);
                        m.steadyXpPerSecond=steady&&now-steady.at>=60000?(m.endExp-steady.exp)/((now-steady.at)/1000):null;
                        log(ns,'XP measurement complete: '+formatNumber(m.xpPerSecond)+' XP/sec ('+formatDuration(m.elapsedMs)+'). Restoring normal daemon priorities.',false,'info');
                    }
                }
            }
        }
        xpMeasurementActive=['arming','measuring'].includes(m.state);
        m.at=now;m.ownerPid=ns.pid;await ns.write('tasks/xp-measurement.json',JSON.stringify(m),'w');
    }

    /** Forecast both routes without mutating native state or depending on the overview. */
    async function updateNodeRoutePlan(ns, stocksValue) {
        if(options['disable-node-route-planner']) {routePlan=null;ns.rm(nodeRouteFile);return;}
        const now=Date.now();if(now-routeSnapshotAt<15000)return;
        routeSnapshotAt=now;
        try {
            const s=await getNsDataThroughFile(ns,nodeRouteSnapshotSource(homeRam>=64&&!!unlockedSFs[4],homeRam>=128&&!!(unlockedSFs[6]||unlockedSFs[7]),bitNodeMults),
                '/Temp/node-route-snapshot.txt');
            s.worth+=Math.max(0,stocksValue||0);
            if(s.bb)s.bb.disabled=options['disable-bladeburner']||isScriptPaused(ns,'bladeburner.js')||!achievementActionAllowed(ns,'bladeburner');
            routeObservation=sampleRouteProgress(routeObservation,s);
            const routes={hacking:estimateDaemonRoute(s,routeObservation),bladeburner:estimateBladeburnerRoute(s.bb)};
            const old=routePlan?.selected;
            const availability=nodeRouteAvailability(resetInfo,unlockedSFs,options,{paused:isScriptPaused(ns,'bladeburner.js'),allowed:achievementActionAllowed(ns,'bladeburner')});
            routePlan={...chooseNodeRoute(routes,routePlan,{now,augReset:s.augReset,nodeReset:s.nodeReset,node:s.node,override:options['node-route'],adaptive:options['adaptive-node-route'],availability}),
                ownerPid:ns.pid,simulacrum:s.simulacrum,sampling:routeObservation.sampling,development:routeDevelopment(s,routeObservation),
                assumptions:['BitNode preferences are priors, not completion forecasts','Unknown prerequisites never count as zero time',
                    'Bladeburner recovery, chaos and recruitment use a 50 to 100 percent duty range','Automatic switches require a 25 percent advantage for two minutes']};
            if(!combatRecovery)try{combatRecovery=JSON.parse(ns.read('tasks/combat-recovery.json'));}catch{}
            combatRecovery=observeCombatRecovery(combatRecovery,{reset:resetInfo,route:routePlan,now});
            if(combatRecovery)await ns.write('tasks/combat-recovery.json',JSON.stringify(combatRecovery),'w');
            routePlan.redPill=planRedPill(s,routeObservation,{route:routePlan.selected});
            if(routePlan.redPill.stage==='installed') {
                const rate=routeObservation.xpModes?.xp?.rate;
                routePlan.redPill.wdEtaMs=routes.hacking.etaMs;
                routePlan.redPill.wdResetRecoveryMs=rate>0?s.exp/rate*1000+600000:null;
            }
            if(routePlan.redPill.active){reservedPurchase=0;await ns.write('tasks/augmentation-reset-plan.json',JSON.stringify({pending:false,ownerPid:ns.pid,expiresAt:now+30000}),'w');}
            await ns.write(nodeRouteFile,JSON.stringify(routePlan),'w');
            if(old!==routePlan.selected)log(ns,'Node route planner: '+routePlan.reason,false,'info');
        }catch(error) {
            // Explicit route preference survives missing forecast APIs; inferred priorities do not.
            routeObservation=null;
            routePlan={...chooseNodeRoute({},null,{now,augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset,node:resetInfo.currentNode,
                override:options['node-route'],adaptive:options['adaptive-node-route'],availability:nodeRouteAvailability(resetInfo,unlockedSFs,options,{paused:isScriptPaused(ns,'bladeburner.js'),allowed:achievementActionAllowed(ns,'bladeburner')})}),
                ownerPid:ns.pid,error:'Native route evidence unavailable: '+String(error)};
            await ns.write(nodeRouteFile,JSON.stringify(routePlan),'w');
        }
    }

    /** Save native milestone funds and buy TRP alone as soon as the whole transaction is affordable. */
    async function manageRedPill(ns,player,stocksValue) {
        const pill=routePlan?.redPill;
        redPillLiquidating=!!(pill?.active&&pill.stage==='buy');
        if(!pill?.active)return;
        if(Number.isFinite(pill.reserve))await ns.write('reserve.txt',Math.max(0,pill.reserve),'w');
        if(pill.stage!=='buy'||activityBusy(ns)||maintenanceRequested(ns)||!achievementActionAllowed(ns,'cashSpending'))return;
        if(player.money<pill.targetCash) {
            const positions=ns.ps('home').filter(p=>p.filename===getFilePath('stockmaster.js'));
            if(!positions.some(p=>p.args.includes('--liquidate')))launchScriptHelper(ns,'stockmaster.js',['--liquidate']);
            return;
        }
        const guard=`ns.isRunning(ns.args[0])&&!(${maintenanceRequested.toString()})(ns)&&!${activityGuard}&&(${achievementActionAllowed.toString()})(ns,"cashSpending")&&!['GRAFTING','CREATE_PROGRAM'].includes(ns.singularity.getCurrentWork()?.type)`;
        try {
            const result=await getNsDataThroughFile(ns,`(${purchaseRedPillSource})(ns,ns.args[0],ns.args[1],ns.args[2],ns.args[3],()=>${guard})`,
                '/Temp/red-pill-purchase.txt',[ns.pid,resetInfo.lastAugReset,resetInfo.lastNodeReset,bitNodeMults.FactionWorkRepGain]);
            pill.transaction=result;
            if(result.status==='queued'){pill.stage='install';pill.reason='The Red Pill is purchased and ready to install';}
            await ns.write(nodeRouteFile,JSON.stringify(routePlan),'w');
        }catch(error){log_once(ns,'Red Pill transaction deferred: '+String(error));}
    }

    /** Installing a queued TRP does not wait for an augmentation basket, 4S, or another countdown. */
    async function installQueuedRedPill(ns,achievementGoals) {
        if(achievementGoals?.expiresAt>Date.now()&&ns.isRunning(achievementGoals.ownerPid)&&achievementGoals.nodeReset===resetInfo.lastNodeReset&&achievementGoals.minimumQueue>0) {
            const count=await getNsDataThroughFile(ns,'ns.singularity.getOwnedAugmentations(true).length-ns.singularity.getOwnedAugmentations(false).length');
            if(count<achievementGoals.minimumQueue){
                const pid=launchScriptHelper(ns,'faction-manager.js',['--purchase','--log-only']);
                if(pid)await waitForProcessToComplete(ns,pid,true);
                return setStatus(ns,'Red Pill queued; filling the active achievement queue requirement before installing');
            }
        }
        if(await checkIfGrafting(ns))return;
        if((unlockedSFs[6]||unlockedSFs[7])&&await getNsDataThroughFile(ns,'ns.bladeburner.inBladeburner()&&/black/i.test(ns.bladeburner.getCurrentAction()?.type||"")','/Temp/red-pill-blackop.txt'))return;
        if(!await beginTransition(ns,'Red Pill installation',true))return;
        try {
            await prepareResetBackup(ns,'Red Pill installation');
            const pid=await runCommand(ns,`ns.isRunning(ns.args[1])&&ns.getResetInfo().lastAugReset===ns.args[2]&&ns.singularity.getOwnedAugmentations(true).includes("The Red Pill")&&!ns.singularity.getOwnedAugmentations(false).includes("The Red Pill") ? ns.singularity.installAugmentations(ns.args[0]):false`,
                '/Temp/install-red-pill.js',[ns.getScriptName(),ns.pid,resetInfo.lastAugReset]);
            if(pid)await waitForProcessToComplete(ns,pid,true);
        }finally{endTransition(ns);}
    }

    /** Logic run periodically throughout the BN to see if we are ready to complete it.
     * @param {NS} ns
     * @param {Player} player */
    async function checkIfBnIsComplete(ns, player) {
        if (bnCompletionSuppressed) return true;
        if (wdHack === null || (!Number.isFinite(wdHack) && installedAugmentations.includes(augTRP))) { // Refresh when The Red Pill unlocks the daemon.
            wdHack = await getNsDataThroughFile(ns, 'ns.scan("The-Cave").includes("w0r1d_d43m0n") ? ' +
                'ns.getServerRequiredHackingLevel("w0r1d_d43m0n"): -1',
                '/Temp/wd-hackingLevel.txt');
            if (wdHack == -1) wdHack = Number.POSITIVE_INFINITY; // Cannot stringify infinity, so use -1 in transit
        }
        // Detect if a BN win condition has been met
        let daemonRooted = false;

        // We cannot technically destroy WD until we have root. If we recently reset, we may have to wait a bit
        // for daemon.js to get a little money, buy the crack tools, and nuke the server first.
        if (player.skills.hacking >= wdHack)
            daemonRooted = await getNsDataThroughFile(ns, 'ns.hasRootAccess(ns.args[0])', null, ["w0r1d_d43m0n"]);

        // Detect the BB win condition (requires SF7 (bladeburner API) or being in BN6)
        if (6 in unlockedSFs || 7 in unlockedSFs) // Both Source Files grant Bladeburner API access
            playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
        let blackOpsComplete = false;
        if (!daemonRooted && playerInBladeburner)
            blackOpsComplete = await getNsDataThroughFile(ns,
                `ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0`,
                '/Temp/bladeburner-completed.txt');

        // Prefer measured route comparisons; retain the legacy rule while either forecast is unknown.
        const route = bitNodeVictory(player.skills.hacking, wdHack, daemonRooted, blackOpsComplete);
        prioritizeHackForWd = !route && (routePlan?.selected==='hacking' || !routePlan?.selected && installedAugmentations.includes(augTRP) && Number.isFinite(wdHack) && player.skills.hacking >= wdHack*.75);

        if (!route) return false; // No win conditions met


        if (!loggedBnCompletion) {
            const text = `BN ${resetInfo.currentNode}.${(dictOwnedSourceFiles[resetInfo.currentNode] || 0) + 1} completed at ` +
                `${formatDuration(getTimeInBitnode())} ` +
                `(${(route === 'hacking' ? `hack (${wdHack.toFixed(0)})` : 'bladeburner')} win condition)`;
            persist_log(ns, text);
            log(ns, `SUCCESS: ${text}`, true, 'success');
            loggedBnCompletion = true; // Flag set to ensure that if we choose to stay in the BN, we only log the "BN completed" message once per reset.
        }

        const departure = bitNodeDeparture({ route, nextBn, autoDestroy: !options['disable-auto-destroy-bn'], singularity: 4 in unlockedSFs });
        if (departure !== 'ready') {
            const reasons = { disabled: '--disable-auto-destroy-bn is set; you can manually exit when ready.',
                'manual-exit': `Singularity is unavailable; manually exit via ${route === 'hacking' ? 'w0r1d_d43m0n' : 'the Bladeburner BlackOps tab'}.`,
                'invalid-next-node': `Invalid --next-bn ${nextBn}; choose an integer from 1 through 15 and restart autopilot.` };
            log(ns, reasons[departure] || departure, true);
            return bnCompletionSuppressed = true;
        }

        if(!options['disable-achievements']) {
            let goals;try{goals=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
            if(goals?.expiresAt>Date.now()&&ns.isRunning(goals.ownerPid)&&goals.nodeReset===resetInfo.lastNodeReset&&goals.holdDeparture?.length){setStatus(ns,'Achievement campaign: '+goals.holdDeparture.join(', '));return true;}
            const owned=achievementState?.unlocked;
            let bitverseAttempt;try{bitverseAttempt=JSON.parse(ns.read('tasks/achievement-bitverse-attempt.json'));}catch{}
            if(options['wait-in-bitverse-for-achievement']&&route==='hacking'&&Array.isArray(owned)&&!owned.includes('INDECISIVE')&&bitverseAttempt?.nodeReset!==resetInfo.lastNodeReset) {
                await ns.write('tasks/achievement-departure.json',JSON.stringify({nodeReset:resetInfo.lastNodeReset,route,at:Date.now()}),'w');
                return true;
            }
        }
        // Check if there is some reason not to automatically destroy this BN
        if (resetInfo.currentNode == 10 && achievementActionAllowed(ns,"sleeve")) { // Suggest the user doesn't reset until they buy all sleeves and max memory
            const shouldHaveSleeveCount = maximumSleeves(resetInfo);
            const numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
            let reasonToStay = null;
            if (numSleeves < shouldHaveSleeveCount)
                reasonToStay = `Detected that you only have ${numSleeves} sleeves, but you could have ${shouldHaveSleeveCount}.`;
            else {
                let sleeveInfo = (/** @returns {SleevePerson[]} */() => [])();
                sleeveInfo = await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`, '/Temp/sleeve-getSleeve-all.txt', [...Array(numSleeves).keys()]);
                if (sleeveInfo.some(s => s.memory < 100))
                    reasonToStay = `Detected that you have ${numSleeves}/${shouldHaveSleeveCount} sleeves, but they do not all have the maximum memory of 100:\n  ` +
                        sleeveInfo.map((s, i) => `- Sleeve ${i} has ${s.memory}/100 memory`).join('\n  ');
                else
                    sleevesMaxedOut = true; // Flag is used elsewhere to allow continued installs
            }
            if (reasonToStay) {
                log_once(ns, `WARNING: ${reasonToStay}\nTry not to leave BN10 before buying all you can from the faction "The Covenant", especially sleeve memory!` +
                    `\nNOTE: You can ONLY buy sleeves & memory from The Covenant in BN10, which is why it's important to do this before you leave.`, true);
                return true; // Return true, but do not set `bnCompletionSuppressed = true` so we can auto-reset once the user intervenes.
            }
        }
        // All stay conditions passed. Actual departure overrides grafts and UI work.
        if (!await beginTransition(ns, 'BitNode completion', false)) return true;
        try {
        if (!await runCompletionHook(ns, resetInfo.lastNodeReset, options['on-completion-script'],
            options['on-completion-script-args'],
            (script, args) => launchScriptHelper(ns, script, args, false), pid => waitForProcessToComplete(ns, pid))) {
            log_once(ns, 'Completion hook could not start; waiting for RAM or the configured script before departing.', true);
            return true;
        }

        // Clean out our temp folder and flags so we don't have any stale data when the next BN starts.
        await prepareResetBackup(ns,'BitNode departure');
        let pid = launchScriptHelper(ns, 'cleanup.js');
        if (pid) await waitForProcessToComplete(ns, pid);

        // In all likelihood, daemon.js has already nuked this like it does all servers, but in case it hasn't:
        if (route === 'hacking') {
            pid = launchScriptHelper(ns, '/Tasks/crack-host.js', ['w0r1d_d43m0n']);
            if (pid) await waitForProcessToComplete(ns, pid);
        }

        // Use the new special singularity function to automate entering a new BN
        pid = await runCommand(ns, `ns.singularity.destroyW0r1dD43m0n(ns.args[0], ns.args[1]` +
            `, { sourceFileOverrides: new Map() }` + // Work around a long-standing bug on bitburner-official.github.io TODO: Remove when no longer needed
            `)`, '/Temp/singularity-destroyW0r1dD43m0n.js', [nextBn, ns.getScriptName()]);
        if (pid) {
            log(ns, `SUCCESS: Initiated process ${pid} to execute 'singularity.destroyW0r1dD43m0n' with args: [${nextBn}, ${ns.getScriptName()}]`, true, 'success')
            await waitForProcessToComplete(ns, pid);
            log(ns, `WARNING: Process is done running, why am I still here? Sleeping 10 seconds...`, true, 'error')
            await ns.sleep(10000);
        }
        persist_log(ns, log(ns, `ERROR: Tried destroy the bitnode (pid=${pid}), but we're still here...`, true, 'error'));
        //return bnCompletionSuppressed = true; // Don't suppress bn Completion, try again on our next loop.
        } finally { endTransition(ns); }
    }

    /** Helper to get a list of all scripts running (on home)
     * @param {NS} ns */
    async function getRunningScripts(ns) {
        return await getNsDataThroughFile(ns, 'ns.ps(ns.args[0])', null, ['home']);
    }

    /** Helper to get the first instance of a running script by name.
     * @param {NS} ns
     * @param {string} baseScriptName The name of a script (before applying getFilePath)
     * @param {ProcessInfo[]} runningScripts - (optional) Cached list of running scripts to avoid repeating this expensive request
     * @param {(value: ProcessInfo, index: number, array: ProcessInfo[]) => unknown} filter - (optional) Filter the list of processes beyond just matching on the script name */
    function findScriptHelper(baseScriptName, runningScripts, filter = null) {
        return runningScripts.filter(s => s.filename == getFilePath(baseScriptName) && (!filter || filter(s)))[0];
    }

    /** Helper to kill a running script instance by name
     * @param {NS} ns
     * @param {ProcessInfo[]} runningScripts - (optional) Cached list of running scripts to avoid repeating this expensive request
     * @param {ProcessInfo} processInfo - (optional) The process to kill, if we've already found it in advance */
    async function killScript(ns, baseScriptName, runningScripts = null, processInfo = null) {
        processInfo = processInfo || findScriptHelper(baseScriptName, runningScripts || (await getRunningScripts(ns)))
        if (processInfo) {
            for(const [key,record]of launchHistory)if(record.pid===processInfo.pid)launchHistory.delete(key);
            log(ns, `INFO: Killing script ${baseScriptName} with pid ${processInfo.pid} and args: [${processInfo.args.join(", ")}].`, false, 'info');
            return await getNsDataThroughFile(ns, 'ns.kill(ns.args[0])', null, [processInfo.pid]);
        }
        log(ns, `INFO: Skipping request to kill script ${baseScriptName}, no running instance was found...`, false, 'warning');
        return false;
    }

    /** Logic to ensure scripts are running to progress the BN
     * @param {NS} ns
     * @param {Player} player */
    async function checkOnRunningScripts(ns, player, bootstrapOnly=false) {
        if (lastScriptsCheck > Date.now() - options['interval-check-scripts']) return;
        lastScriptsCheck = Date.now();
        let spending;try{spending=JSON.parse(ns.read('tasks/spending-plan.json'));}catch{}
        if(!spending||spending.expiresAt<=Date.now()||spending.ownerPid!==ns.pid||spending.reset!==resetInfo.lastAugReset){
            let corporationStartup=false;if(!options['disable-corporation']&&unlockedSFs[3]&&achievementActionAllowed(ns,'corporation'))try{corporationStartup=!await getNsDataThroughFile(ns,'ns.corporation.hasCorporation()','/Temp/budget-corporation.txt');}catch{}
            const signals=adaptiveBudgetSignals(ns,corporationStartup);
            let speed;try{speed=JSON.parse(ns.read('tasks/progression-speed.json'));}catch{}
            if(!options['disable-adaptive-spending'])signals.bottleneck=homeRam<64?'ram':routePlan?.redPill?.active?(routePlan.redPill.canDonate?'cash':'reputation'):routePlan?.selected==='bladeburner'&&!options['force-xp']?'combat':routeContinuousXp(options,routePlan)?'hacking':prioritizeHackForDaedalus||prioritizeHackForWd?'hacking':speed?.augReset===resetInfo.lastAugReset&&speed.at>Date.now()-120000?speed.bottleneck:'balanced';
            signals.activeCategories={graft:!!unlockedSFs[10]&&!!unlockedSFs[4],soa:!!unlockedSFs[4],sleeves:!!unlockedSFs[10],sleeveExpansion:resetInfo.currentNode===10&&!!unlockedSFs[10],gang:!!unlockedSFs[2],corporation:!options['disable-corporation']&&!!unlockedSFs[3]};
            await ns.write('tasks/spending-plan.json',JSON.stringify(spendingPlan({money:player.money,reserve:Number(ns.read('reserve.txt'))||0,homeRam,node:resetInfo.currentNode,ownerPid:ns.pid,reset:resetInfo.lastAugReset,signals})), 'w');
        }
        let runningScripts = await getRunningScripts(ns); // Refresh after requested restarts.
        launchSourceCache.clear();
        for(const [key,record]of launchHistory){
            if(!record.pid&&Date.now()-Math.max(record.retryAt,record.startedAt)>15*60000){launchHistory.delete(key);continue;}
            launchHistory.set(key,{...record,...launchCooldown(record,{now:Date.now(),reset:resetInfo.lastAugReset,signature:scriptSignature(ns,record.path||getFilePath(record.script),launchSourceCache),alive:runningScripts.some(p=>p.pid===record.pid)})});
        }

        const findScript = /** @param {(value: ProcessInfo, index: number, array: ProcessInfo[]) => unknown} filter @returns {ProcessInfo} */
            (baseScriptName, filter = null) => findScriptHelper(baseScriptName, runningScripts, filter);

        // Kill any scripts that were flagged for restart
        const restartingScripts = killScripts.length > 0;
        while (killScripts.length > 0)
            await killScript(ns, killScripts.pop(), runningScripts);
        if (restartingScripts) runningScripts = await getRunningScripts(ns);

        // See if home ram has improved. We hold back on launching certain scripts if we are low on home RAM
        homeRam = await getNsDataThroughFile(ns, `ns.getServerMaxRam(ns.args[0])`, null, ["home"]);

        // Avoid parking the large corporation controller in RAM before there is a corporation to manage.
        let corporationReady = false, corporationKnown = false;
        if (!options['disable-corporation'] && (resetInfo.currentNode === 3 || Number(unlockedSFs[3]) > 0)) {
            try {
                const hasCorporation = await getNsDataThroughFile(ns, 'ns.corporation.hasCorporation()', '/Temp/autopilot-corporation-exists.txt');
                corporationKnown = true;
                corporationReady = hasCorporation || achievementActionAllowed(ns, 'corporation') &&
                    (resetInfo.currentNode === 3 || player.money >= 150e9 + Math.max(0, Number(ns.read('reserve.txt')) || 0));
                if (!corporationReady && findScript('corporation-manager.js'))
                    await killScript(ns, 'corporation-manager.js', runningScripts);
            } catch { /* Keep a running controller when native state cannot be read. */ }
        }

        // Bring up hacking and infrastructure before optional managers consume startup RAM.
        const existingDaemon = findScript('daemon.js');
        let daemonArgs = []; // The args we currently want deamon to have
        let daemonRelaunchMessage; // Will hold any special messages we want to show the user if relaunching daemon.

        // If daemon.js is already running in --looping-mode, we should not restart it, because
        // TODO: currently daemon.js has no ability to kill it's loops on shutdown (so the next instance will be stuck with no RAM available)
        if (existingDaemon?.args.includes("--looping-mode"))
            daemonArgs = [...existingDaemon.args];
        else {
            // Determine the arguments we want to run daemon.js with. We will either pass these directly, or through stanek.js if we're running it first.
            const hackThreshold = options['high-hack-threshold']; // If player.skills.hacking level is about 8000, tweak daemon to increase income rates
            // When our hack level gets sufficiently high, hack/grow/weaken go so fast that spawning new scripts for each cycle becomes very
            // expensive / laggy. To help with this, daemon.js supports "looping mode", to just spawn one long-lived script that does H/G/W in a loop.
            if (false /* TODO: LOOPING MODE DISABLED UNTIL WORKING BETTER */ && player.skills.hacking >= hackThreshold) {
                daemonArgs = ["--looping-mode", "--cycle-timing-delay", 40, "--queue-delay", 2000, "--initial-max-targets", 61, "--silent-misfires", "--no-share",
                    "--recovery-thread-padding", Math.min(5.0, player.skills.hacking / hackThreshold)]; // Use more recovery thread padding as our hack level increases
                // Log a special notice if we're going to be relaunching daemon.js for this reason
                if (!existingDaemon || !(existingDaemon.args.includes("--looping-mode")))
                    daemonRelaunchMessage = `Hack level (${player.skills.hacking}) is >= ${hackThreshold} (--high-hack-threshold): Starting daemon.js in high-performance hacking mode.`;
            } else if (player.skills.hacking >= hackThreshold) { // "tight" mode. Tighter batches to increase income rate, at the cost of more frequent misfires
                daemonArgs = ["--cycle-timing-delay", 40, "--queue-delay", 50, "--silent-misfires",
                    "--recovery-thread-padding", Math.min(5.0, player.skills.hacking / hackThreshold)]; // Use more recovery thread padding as our hack level increases
            }
            else if (homeRam < 32) { // If we're in early BN 1.1 (i.e. with < 32GB home RAM), avoid squandering RAM
                daemonArgs.push("--no-share", "--initial-max-targets", 1);
            } else { // XP-ONLY MODE: We can shift daemon.js to this when we want to prioritize earning hack exp rather than money
                // Only do this if we aren't in --looping mode because TODO: currently it does not kill it's loops on shutdown, so they'd be stuck in hack exp mode
                let useXpOnlyMode = routeContinuousXp(options,routePlan) || (prioritizeHackForDaedalus && routePlan?.selected!=='bladeburner') || prioritizeHackForWd ||
                    // In BNs that give no money for hacking, always start daemon.js in this mode (except BN8, because TODO: --xp-only doesn't handle stock manipulation)
                    (bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain == 0 && resetInfo.currentNode != 8);
                if (!useXpOnlyMode) { // Otherwise, respect the configured interval / duration
                    const xpInterval = Number(options['xp-mode-interval-minutes']);
                    const xpDuration = Number(options['xp-mode-duration-minutes']);
                    const minutesInAug = getTimeInAug() / 60.0 / 1000.0;
                    if (routePlan?.selected!=='bladeburner' && xpInterval > 0 && xpDuration > 0 && (minutesInAug % (xpInterval + xpDuration)) <= xpDuration)
                        useXpOnlyMode = true; // We're in the time window where we should focus hack exp
                    // If daemon.js was previously running in hack exp mode, prepare a message indicating that we 're switching back
                    else if (existingDaemon?.args.includes("--xp-only"))
                        daemonRelaunchMessage = `Time is up for "xp-mode", Relaunching daemon.js normally to focus on earning money for ${xpInterval} minutes (--xp-mode-interval-minutes)`;
                }
                if (useXpOnlyMode) {
                    daemonArgs.push("--xp-only", "--silent-misfires", "--no-share");
                    // If daemon.js isn't already running in hack exp mode, prepare a message to communicate the change
                    if (!existingDaemon?.args.includes("--xp-only"))
                        daemonRelaunchMessage = routeContinuousXp(options,routePlan) ? 'Continuous hacking XP priority is enabled.' : prioritizeHackForWd ? `Prioritizing the World Daemon hacking requirement (${routePlan?.selected==='hacking'?'measured route comparison':'near-target fallback'}).` :
                            prioritizeHackForDaedalus ? `Hack Level is the only missing requirement for Daedalus, so we will run daemon.js in --xp-only mode to try and speed along the invite.` :
                                (bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain == 0) ?
                                    `The current BitNode does not give any money from hacking, so we will run daemon.js in --xp-only mode.` :
                                    `Relaunching daemon.js to focus on earning Hack Experience for ${options['xp-mode-duration-minutes']} minutes (--xp-mode-duration-minutes)`;
                }
            }
            // Explicit XP priority also applies above the high-performance threshold and on small home servers.
            if((routeContinuousXp(options,routePlan)||prioritizeHackForWd||xpMeasurementActive)&&!daemonArgs.includes('--xp-only'))daemonArgs.push('--xp-only','--silent-misfires','--no-share');
            // Prevent daemon from starting "work-for-faction.js" since we now manage that script
            daemonArgs.push('--disable-script', getFilePath('work-for-factions.js'));
            // In BN8, always run in a mode that prioritizes stock market manipulation
            if (resetInfo.currentNode == 8) daemonArgs.push("--stock-manipulation-focus");
            // Don't run the script to join and manage bladeburner if it is explicitly disabled
            if (options['disable-bladeburner']) daemonArgs.push('--disable-script', getFilePath('bladeburner.js'));
            // Relay the option to suppress tail windows
            if (options['no-tail-windows']) daemonArgs.push('--no-tail-windows');
            // If we have SF4, but not level 3, instruct daemon.js to reserve additional home RAM
            if ((4 in unlockedSFs) && unlockedSFs[4] < 3)
                daemonArgs.push('--reserved-ram', Math.min(homeRam*.25,32 * ((unlockedSFs[4] ?? 0) == 2 ? 4 : 16)));
        }

        // Autopilot launches the corporation manager. Suppress daemon's competing
        // launcher even when --disable-corporation is set or looping mode is active.
        const corporationScript = getFilePath('corporation-manager.js');
        if (!daemonArgs.some((arg, index) => arg === '--disable-script' && daemonArgs[index + 1] === corporationScript))
            daemonArgs.push('--disable-script', corporationScript);
        for (const script of ['health-manager.js', 'infiltration-manager.js', 'go.js', 'stats.js', 'darknet-manager.js', 'grafting-manager.js', 'spend-hacknet-hashes.js', 'bladeburner.js'])
            if (!daemonArgs.some((arg, index) => arg === '--disable-script' && daemonArgs[index + 1] === getFilePath(script)))
                daemonArgs.push('--disable-script', getFilePath(script));

        // Once stanek's gift is accepted, launch it once per reset before we launch daemon (Note: stanek's gift is auto-purchased by faction-manager.js on your first install)
        let stanekRunning = findScript('stanek.js') !== undefined;
        if (!bootstrapOnly && homeRam >= 128 && !stanekLaunched && !stanekRunning && installedAugmentations.includes(augStanek)) {
            const stanekArgs = ["--on-completion-script", getFilePath('daemon.js')]
            if (options['no-tail-windows']) stanekArgs.push('--no-tail'); // Relay the option to suppress tail windows
            if (daemonArgs.length >= 0) stanekArgs.push("--on-completion-script-args", JSON.stringify(daemonArgs)); // Pass in all the args we wanted to run daemon.js with
            const stanekPid = launchScriptHelper(ns, 'stanek.js', stanekArgs);
            stanekLaunched = stanekRunning = stanekPid > 0; // Failed launches remain retryable and do not reserve all home RAM.
        }
        // If stanek is running, tell daemon to reserve all home RAM for it.
        if (stanekRunning)
            daemonArgs.push("--reserved-ram", 1E100);

        // Launch (or re-launch) daemon if it is not already running with all our desired args.
        // Hack: Ignore numeric arguments in the comparison, since we e.g. tweak --recovery-thread-padding over time
        if(achievementProfile?.active){for(const script of achievementProfile.disabledScripts)if(!daemonArgs.some((a,i)=>a==='--disable-script'&&daemonArgs[i+1]===getFilePath(script)))daemonArgs.push('--disable-script',getFilePath(script));
            if(achievementProfile.deniedActions.includes('hacknetMoney')&&!daemonArgs.includes('--disable-spend-hashes'))daemonArgs.push('--disable-spend-hashes');}
        if(achievementState?.goals?.xp&&!daemonArgs.includes('--xp-only'))daemonArgs.push('--xp-only');
        if(casinoSeedPending&&bitNodeMults.ScriptHackMoney*bitNodeMults.ScriptHackMoneyGain>0)daemonArgs=daemonArgs.filter(arg=>arg!=='--xp-only'&&arg!=='-x');
        if(bootstrapOnly){
            daemonArgs.push('--no-share','--initial-max-targets',1,'--initial-study-time',0,'--initial-hack-xp-time',0);
            for(const script of ['stockmaster.js','hacknet-upgrade-manager.js','sleeve.js','sleeve-expansion.js','gangs.js','work-for-factions.js','Tasks/backdoor-all-servers.js','Tasks/tor-manager.js','Tasks/program-manager.js','Tasks/ram-manager.js','host-manager.js','faction-manager.js'])
                if(!daemonArgs.some((a,i)=>a==='--disable-script'&&daemonArgs[i+1]===getFilePath(script)))daemonArgs.push('--disable-script',getFilePath(script));
        }
        const launchDaemon = !existingDaemon || daemonArgumentsChanged(existingDaemon.args, daemonArgs);
        if (launchDaemon) {
            if (existingDaemon) {
                daemonRelaunchMessage ??= `Relaunching daemon.js with new arguments since the current instance doesn't include all the args we want.`;
                log(ns, daemonRelaunchMessage);
            }
            const fallback=findScript('bootstrap-hacking.js');
            const needed=ns.getScriptRam(getFilePath('daemon.js'),'home')+homeRamReserve(ns);
            const replaceable=!fallback||ns.getServerMaxRam('home')-ns.getServerUsedRam('home')+ns.getScriptRam(fallback.filename,'home')*fallback.threads>=needed;
            if(fallback&&replaceable)ns.kill(fallback.pid);
            let daemonPid = replaceable?launchScriptHelper(ns, 'daemon.js', daemonArgs):0;
            if(!daemonPid&&!existingDaemon&&(!fallback||replaceable)&&!stanekRunning)launchScriptHelper(ns,'bootstrap-hacking.js',[ns.pid]);
            if (daemonPid) daemonStartTime = Date.now();
            // Open the tail window if it's the start of a new BN. Especially useful to new players.
            if (!options['no-tail-windows'] && daemonPid && (getTimeInBitnode() < 1000 * 60 * 5 || homeRam == 8))
                tail(ns, daemonPid);
        }


        if(bootstrapOnly)return;

        // Leave RAM for absent priority managers while existing batches drain naturally.
        const priorityManagers = priorityManagerPlan({homeRam,sourceFiles:unlockedSFs,node:resetInfo.currentNode,options,
            bladeburnerRank:bitNodeMults.BladeburnerRank,corporationReady,corporationKnown,corporationRunning:!!findScript('corporation-manager.js')});
        let pending = !options['disable-achievements'] && findScript('achievement-manager.js') ? (achievementProfile?.active?8:48) : 0;
        const managerStatus = priorityManagers.map(manager => {
            const script = getFilePath(manager.name), process = findScript(manager.name);
            const ram = ns.fileExists(script, 'home') ? ns.getScriptRam(script, 'home') : 0;
            const cooling=[...launchHistory.values()].filter(r=>r.script===manager.name&&r.retryAt>Date.now()).sort((a,b)=>b.retryAt-a.retryAt)[0];
            const state = isScriptPaused(ns, manager.name) ? 'paused' : !manager.enabled ? 'locked-or-disabled' :
                process ? 'running' : cooling?'restart-cooldown':ram <= 0 ? 'missing' : manager.name === 'work-for-factions.js' && activityBusy(ns) ? 'waiting-for-activity' : ram + pending + 16 > homeRam ? 'needs-home-ram' : 'waiting-for-ram';
            if (state === 'waiting-for-ram' || state === 'waiting-for-activity') pending += ram;
            return { script: manager.name, state, ram, pid: process?.pid || null,cooldownUntil:cooling?.retryAt??null }; 
        });
        await ns.write('tasks/essential-home-ram.json',JSON.stringify({at:Date.now(),ownerPid:ns.pid,augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset,...essentialManagerRamTarget(ns,managerStatus,runningScripts)}),'w');
        await ns.write(ramReserveFile, JSON.stringify({ ownerPid: ns.pid, expiresAt: Date.now() + 30000, ram: pending ? pending + 8 : 0 }), 'w');
        await ns.write('tasks/automation-status.json', JSON.stringify({ at: Date.now(), ownerPid: ns.pid,augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset,
            bitNodePriority: bnPriority, nextAchievementNode:nextBn, achievementProfile, managers: managerStatus, processes: runningScripts.map(p => ({ script: p.filename, pid: p.pid })), priority: 'casino, completed BitNode, active graft, infiltration, faction work' }), 'w');

        // Maintain the Remote API mailbox after normal automation restarts.
        const remoteWorker = findScript('remote-api-agent.js');
        // The supervisor upgrades idle workers independently; do not replace newer compatible workers.
        if (!remoteWorker) {
            const worker = getFilePath('remote-api-agent.js');
            if (ns.fileExists(worker, 'home')) {
                const required = ns.getScriptRam(worker, 'home');
                const free = await getNsDataThroughFile(ns, 'ns.getServerMaxRam("home") - ns.getServerUsedRam("home")');
                if (required > 0 && free >= required) launchScriptHelper(ns, 'remote-api-agent.js', ['--protocol-version', 2]);
            }
        }

        // Launch the standalone manager; all corporation decisions stay in that script.
        if (corporationReady && !findScript('corporation-manager.js')) {
            const script = getFilePath('corporation-manager.js');
            if (!ns.fileExists(script, 'home'))
                log_once(ns, 'WARNING: corporation-manager.js is missing from home; sync the project to enable corporation automation.', true, 'warning');
            else {
                const requiredRam = ns.getScriptRam(script, 'home');
                const otherManagersRam = managerStatus.filter(item => item.script !== 'corporation-manager.js' && item.state === 'waiting-for-ram').reduce((sum, item) => sum + item.ram, 0);
                if (requiredRam > 0 && reclaimHomeRam(ns,requiredRam+homeRamReserve(ns)+otherManagersRam))
                    launchScriptHelper(ns, 'corporation-manager.js');
            }
        }

        for (const manager of automaticManagerScripts) {
            const status = managerStatus.find(item => item.script === manager);
            if (status?.state === 'waiting-for-ram' && reclaimHomeRam(ns,status.ram+homeRamReserve(ns)))
                launchScriptHelper(ns, manager);
        }

        // Launch stock-master in a way that emphasizes it as our main source of income early-on
        if (!findScript('stockmaster.js') && !redPillLiquidating && !disableStockmasterForDaedalus && homeRam >= 32 && ns.getServerMaxRam('home')-ns.getServerUsedRam('home') >= ns.getScriptRam(getFilePath('stockmaster.js'),'home')+16)
            launchScriptHelper(ns, 'stockmaster.js', [
                "--fracH", resetInfo.currentNode == 8 ? 0.001 : 0.1, // Fraction of wealth to keep as cash (10% - unless in BN8)
                "--reserve", 0, // Override to ignore the global reserve.txt. Any money we reserve can more or less safely live as stocks
            ]);

        // Launch sleeves and allow them to also ignore the reserve so they can train up to boost gang unlock speed
        if (resetInfo.currentNode === 10 && !findScript('sleeve-expansion.js')) launchScriptHelper(ns, 'sleeve-expansion.js');
        if ((10 in unlockedSFs) && !findScript('sleeve.js')) {
            let sleeveArgs = [];
            if (!options["disable-casino"] && !ranCasino)
                sleeveArgs.push("--training-reserve", 300000); // Avoid training away our casino seed money
            if (options["disable-bladeburner"])
                sleeveArgs.push("--disable-bladeburner");
            launchScriptHelper(ns, 'sleeve.js', sleeveArgs);
        }

        // Spend hacknet hashes on our boosting best hack-income server once established
        let existingSpendHashesProc = findScript('spend-hacknet-hashes.js', s => s.args.includes("--spend-on-server"))
        if ((9 in unlockedSFs) && getTimeInAug() >= options['time-before-boosting-best-hack-server']
            && 0 != bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain) // No point in boosting hack income if it's scaled to 0 in the current BN
        {
            const strServerIncomeInfo = ns.read('/Temp/analyze-hack.txt');	// HACK: Steal this file that Daemon also relies on
            if (strServerIncomeInfo) {
                const incomeByServer = JSON.parse(strServerIncomeInfo);
                dictServerHackReqs ??= await getNsDataThroughFile(ns, 'Object.fromEntries(ns.args.map(server => [server, ns.getServerRequiredHackingLevel(server)]))',
                    '/Temp/getServerRequiredHackingLevel-all.txt', incomeByServer.map(s => s.hostname));
                const [bestServer, gain] = incomeByServer.filter(s => dictServerHackReqs[s.hostname] <= player.skills.hacking)
                    .reduce(([bestServer, bestIncome], target) => target.gainRate > bestIncome ? [target.hostname, target.gainRate] : [bestServer, bestIncome], [null, -1]);
                const spendHashesMultThreshold = options['spend-hashes-on-server-hacking-threshold'];
                // If hacking gain multipliers are too low, assume the bitnode is meant to be won a different way and don't bother wasting hashes on boosting hack income
                // The exception is that in BN9, despite high penalties, we're definitely meant to spend hashes to boost hack income
                if (bestServer && (gain > spendHashesMultThreshold || resetInfo.currentNode == 9)) {
                    // Check whether we should be spending hashes to reduce minimum security
                    const serverMinSecurity = await getNsDataThroughFile(ns, 'ns.getServerMinSecurityLevel(ns.args[0])', null, [bestServer]);
                    const shouldReduceMinSecurity = serverMinSecurity > 2; // Each purchase reduces by 2%. Can't go below 1, but not worth the cost to keep going below 2.
                    // If we were already spending hashes to boost a server, check to see if things have changed
                    if (existingSpendHashesProc) {
                        const currentBoostTarget = existingSpendHashesProc.args[1 + existingSpendHashesProc.args.indexOf("--spend-on-server")];
                        const isReducingSecurity = existingSpendHashesProc.args.includes("Reduce_Minimum_Security");
                        if (currentBoostTarget != bestServer || isReducingSecurity != shouldReduceMinSecurity) {
                            log(ns, `Killing a prior spend-hacknet-hashes.js process targetting ${currentBoostTarget} because ` +
                                (currentBoostTarget != bestServer ? `The new best income server is ${bestServer}.` : 'We no longer need to reduce minimum security.'), true);
                            await killScript(ns, 'spend-hacknet-hashes.js', null, existingSpendHashesProc);
                            existingSpendHashesProc = false;
                        }
                    }
                    if (!existingSpendHashesProc) { // 
                        log(ns, `Identified that the best hack income server is ${bestServer} worth ${formatMoney(gain)}/sec.`);
                        const spendHashesArgs = ["--automatic","--liquidate", "--spend-on-server", bestServer, "--spend-on", "Increase_Maximum_Money"];
                        if (shouldReduceMinSecurity) spendHashesArgs.push("--spend-on", "Reduce_Minimum_Security");
                        launchScriptHelper(ns, 'spend-hacknet-hashes.js', spendHashesArgs);
                    }
                } else if (gain <= 1)
                    log_once(ns, `INFO: The best server (${bestServer})'s hack income multiplier (${formatNumber(gain)}) is currently too severely penalized ` +
                        `(< ${spendHashesMultThreshold}) to merit launching spend-hacknet-hashes.js to boost servers. (Configure with --spend-hashes-on-server-hacking-threshold)`);
                else
                    log(ns, `WARNING: strServerIncomeInfo was not empty, but could not determine best server:\n${strServerIncomeInfo}`);
            }
        }

        // Default work for faction args we think are ideal for speed-running BNs
        const workForFactionsArgs = [
            "--fast-crimes-only", // Essentially means we do mug until we can do homicide, then stick to homicide
            "--get-invited-to-every-faction" // Join factions even we have all their augs. Good for having NeuroFlux providers
        ];
        // Relay the options to suppress tail windows and ignore bladeburner
        if (options['no-tail-windows']) workForFactionsArgs.push('--no-tail-windows');
        if (options['disable-bladeburner']) workForFactionsArgs.push("--no-bladeburner-check")
        // The following args are ideal when running 'work-for-factions.js' to rush unlocking gangs (earn karma)
        const rushGangsArgs = workForFactionsArgs.concat(...[ // Everything above, plus...
            "--crime-focus", // Start off by trying to work for each of the crime factions (generally have combat reqs)
            "--training-stat-per-multi-threshold", 200, // Be willing to spend more time grinding for stats rather than skipping a faction
            "--prioritize-invites"]); // Don't actually start working for factions until we've earned as many invites as we think we can
        // If gangs are unlocked, micro-manage how 'work-for-factions.js' is running by killing off unwanted instances
        if (2 in unlockedSFs && achievementActionAllowed(ns,"gang")) {
            // Check if we've joined a gang yet. (Never have to check again once we know we're in one)
            if (!playerInGang) playerInGang = await getNsDataThroughFile(ns, 'ns.gang.inGang()');
            rushGang = !options['disable-rush-gangs'] && !playerInGang;
            // Detect if a 'work-for-factions.js' instance is running with args that don't match our goal. We aren't too picky,
            // (so the player can run with custom args), but should have --crime-focus if (and only if) we're still working towards a gang.
            const wrongWork = findScript('work-for-factions.js', !rushGang ? s => s.args.includes("--crime-focus") :
                s => !rushGangsArgs.every(a => s.args.includes(a))); // Require all rushGangsArgs if we're not in a gang yet.
            // If running with the wrong args, kill it so we can start it with the desired args
            if (wrongWork) await killScript(ns, 'work-for-factions.js', null, wrongWork);

            // Start gangs immediately (even though daemon would eventually start it) since we want any income they provide right away after an ascend
            // TODO: Consider monitoring gangs territory progress and increasing their budget / decreasing their reserve to help kick-start them
            if (playerInGang && !findScript('gangs.js'))
                launchScriptHelper(ns, 'gangs.js');
        }

        // Launch work-for-factions if it isn't already running (rules for maybe killing unproductive instances are above)
        // Native startup readiness replaces the fixed 30-second focus delay.
        let daemonReadiness;try{daemonReadiness=JSON.parse(ns.read('tasks/daemon-readiness.json'));}catch{}
        if ((4 in unlockedSFs) && !findScript('work-for-factions.js') && factionWorkerReady(daemonReadiness,findScript('daemon.js'),resetInfo)) {
            // If we're trying to rush gangs, run in such a way that we will spend most of our time doing crime, reducing Karma (also okay early income)
            // NOTE: Default work-for-factions behaviour is to spend hashes on coding contracts, which suits us fine
            launchScriptHelper(ns, 'work-for-factions.js', rushGang ? rushGangsArgs : workForFactionsArgs);
        }
    }

    /** Get the source of the player's earnings by category.
     * @param {NS} ns
     * @returns {Promise<MoneySources>} */
    async function getPlayerMoneySources(ns) {
        return await getNsDataThroughFile(ns, 'ns.getMoneySources()');
    }

    /** Accept Stanek's gift immediately at the start of the BN (as opposed to just before the first install)
     * if it looks like it will scale well.
     * @param {NS} ns
     * @param {Player} player */
    async function maybeAcceptStaneksGift(ns, player) {
        if(!achievementActionAllowed(ns,"stanek"))return;
        // Look for any reason not to accept stanek's gift (do the quickest checks first)
        if (acceptedStanek) return;
        // Don't get Stanek's gift too early if its size is reduced in this BN
        if (bitNodeMults.StaneksGiftExtraSize < 0) return;
        // If Stanek's gift size isn't reduced, but is penalized, don't get it too early 
        if (bitNodeMults.StaneksGiftExtraSize == 0 && bitNodeMults.StaneksGiftPowerMultiplier < 1) return;
        // Otherwise, it is not penalized in any way, it's probably safe to get it immediately despite the 10% penalty to all stats
        // If we won't have access to Stanek yet, skip this
        if (!(13 in unlockedSFs)) return;
        // If we've already accepted Stanek's gift (Genesis aug is installed), skip
        if (installedAugmentations.includes(augStanek)) return acceptedStanek = true;
        // If we have more than Neuroflux (aug) installed, we won't be allowed to accept the gift (but we can try)
        if (installedAugmentations.length > 1)
            log(ns, `WARNING: We think it's a good idea to accept Stanek's Gift, but it appears to be too late - other augmentations have been installed. Trying Anyway...`);
        // Use the API to accept Stanek's gift
        if (await getNsDataThroughFile(ns, 'ns.stanek.acceptGift()')) {
            log(ns, `SUCCESS: Accepted Stanek's Gift!`, false, 'success');
            installedAugmentations.push(augStanek); // Manually add Genesis to installed augmentations so checkOnRunningScripts picks up on the change.
        } else
            log(ns, `WARNING: autopilot.js tried to accepted Stanek's Gift, but was denied.`, true, 'warning');
        // Whether we succeded or failed, don't try again - if we're denied entry (due to having an augmentation) we will never be allowed in
        acceptedStanek = true;
    }

    async function bootstrapCasino(ns, player) {
        homeRam=ns.getServerMaxRam('home');casinoSeedPending=false;
        if(ranCasino||options['disable-casino']||isScriptPaused(ns,'casino.js'))return false;
        const sources=await getPlayerMoneySources(ns);
        if((sources.sinceInstall.casino||0)>1e10){ranCasino=true;return false;}
        // Larger, established economies keep the existing wealth/income skip logic.
        if(homeRam>32&&player.money>1e9)return false;
        casinoSeedPending=player.money<casinoSeedMoney;
        await ns.write('reserve.txt',String(casinoSeedMoney),'w');
        await ns.write(ramReserveFile,JSON.stringify({ownerPid:ns.pid,expiresAt:Date.now()+30000,ram:0}),'w');
        if(casinoSeedPending&&unlockedSFs[10]&&Date.now()-lastSeedSleeves>5000){
            lastSeedSleeves=Date.now();
            try{await getNsDataThroughFile(ns,`(${seedSleevesSource})(ns,ns.args[0],ns.args[1],(${sleeveCrimeChance.toString()}),(${achievementActionAllowed.toString()}),ns.args[2])`,
                '/Temp/casino-seed-sleeves.txt',[ns.pid,casinoSeedMoney,bitNodeMults.CrimeSuccessRate??1],false,1,0,true);}catch{/* Hacking/player crime remain available when this worker cannot fit. */}
        }
        let result;
        if(!casinoSeedPending)result={state:'ready',reason:'Casino seed funded'};
        else if(!unlockedSFs[4])result={state:'fallback',reason:'Singularity unavailable; hacking earns the casino seed'};
        else {
            try{
                if(!casinoSeedWorkerPid||!ns.isRunning(casinoSeedWorkerPid)){
                    casinoSeedWorkerPid=await runCommand(ns,`let result;try{result=await (${earnCasinoSeedSource})(ns,ns.args[0],ns.args[1],(${chooseCasinoSeedCrime.toString()}));}catch(error){result={state:'fallback',reason:'Crime API unavailable: '+String(error)};}
                        await ns.write('tasks/casino-seed-crime.json',JSON.stringify({ownerPid:ns.args[0],augReset:ns.getResetInfo().lastAugReset,at:Date.now(),...result}),'w');`,
                        '/Temp/casino-seed-crime.js',[ns.pid,casinoSeedMoney],false,1,0,true);
                }
                result={state:casinoSeedWorkerPid?'earning':'fallback',reason:casinoSeedWorkerPid?'Crime worker running':'Crime worker cannot fit; hacking earns the seed'};
                try{const saved=JSON.parse(ns.read('tasks/casino-seed-crime.json'));
                    if(saved.ownerPid===ns.pid&&saved.augReset===resetInfo.lastAugReset&&saved.at>Date.now()-10000)result=saved;}catch{}
            }catch{result={state:'fallback',reason:'Crime worker unavailable; hacking earns the seed'};}
        }
        await ns.write('tasks/casino-bootstrap.json',JSON.stringify({at:Date.now(),ownerPid:ns.pid,augReset:resetInfo.lastAugReset,
            nodeReset:resetInfo.lastNodeReset,target:casinoSeedMoney,money:player.money,...result}),'w');
        setStatus(ns,'Casino startup: '+(result.crime||result.reason||result.state));
        if(result.state==='ready')await maybeDoCasino(ns,player,true);
        // Unavailable APIs/RAM and casino retry delays must never freeze ordinary progression.
        if(result.state==='fallback'||result.state==='ready'||result.state==='waiting')return false;
        return false; // Funding crimes and a minimal hacking controller can run in parallel.
    }

    async function ensureEssentialHomeRam(ns,player) {
        if(!unlockedSFs[4]||options['disable-casino']||!achievementActionAllowed(ns,'homeRam')||
            ns.getServerMaxRam('home')>=128||isScriptPaused(ns,'Tasks/ram-manager.js'))return;
        const sources=await getPlayerMoneySources(ns);
        if((sources.sinceInstall.casino||0)<=1e10)return;
        if(!options['disable-adaptive-spending'])await ns.write('tasks/spending-plan.json',JSON.stringify(spendingPlan({money:player.money,
            reserve:Math.max(0,Number(ns.read('reserve.txt'))||0),homeRam:ns.getServerMaxRam('home'),node:resetInfo.currentNode,
            ownerPid:ns.pid,reset:resetInfo.lastAugReset,signals:{bottleneck:'ram'}})),'w');
        try{await getNsDataThroughFile(ns,`(${essentialHomeRamSource})(ns,ns.args[0],128,(${claimSpending.toString()}),(${achievementActionAllowed.toString()}))`,
            '/Temp/essential-home-ram.txt',[ns.pid],false,1,0,true);}catch{/* Normal RAM manager retries when its workers fit. */}
    }

    /** Logic to steal 10b from the casino
     * @param {NS} ns
     * @param {Player} player */
    async function maybeDoCasino(ns, player, bootstrap = false) {
        if (isScriptPaused(ns, "casino.js")) return;
        if (ranCasino || options['disable-casino']) return;
        // Figure out whether we've already been kicked out of the casino for earning more than 10b there
        const moneySources = await getPlayerMoneySources(ns);
        try { if (casinoRetryPending(JSON.parse(ns.read('tasks/casino-status.json')), resetInfo.lastAugReset)) return; } catch { }
        const casinoEarnings = moneySources.sinceInstall.casino;
        if (casinoEarnings > 1e10) {
            log(ns, `INFO: Skipping running casino.js, as we've previously earned ${formatMoney(casinoEarnings)} and been kicked out.`);
            return ranCasino = true;
        }
        // If we already have more than 1t money but hadn't run casino.js yet, don't bother. Another 10b won't move the needle much.
        const playerWealth = player.money + (await getStocksValue(ns));
        if (playerWealth >= 1e12) {
            log(ns, `INFO: Skipping running casino.js, since we're already ridiculously wealthy (${formatMoney(playerWealth)} > 1t).`);
            return ranCasino = true;
        }

        // If we're making more than ~5b / minute from the start of the BN, there's no need to run casino.
        // In BN8 this is impossible, so in that case we don't even check and head straight to the casino.
        if (!bootstrap && playerWealth > 1e9 && resetInfo.currentNode != 8) {
            // If we've been in the BN for less than 1 minute, wait a while to establish player's income rate 
            if (getTimeInAug() < 60000)
                return log_once(ns, `INFO: Waiting a minute to establish player income before deciding whether casino.js is needed.`);
            // Since it's possible that the CashRoot Startker Kit could give a false income velocity, account for that.
            const cashRootBought = installedAugmentations.includes(`CashRoot Starter Kit`);
            const incomePerMs = (playerWealth - (cashRootBought ? 1e6 : 0)) / getTimeInAug();
            const incomePerMinute = incomePerMs * 60_000;
            if (incomePerMinute >= 5e9) {
                log(ns, `INFO: Skipping running casino.js this augmentation, since our income (${formatMoney(incomePerMinute)}/min) >= 5b/min`);
                return ranCasino = true;
            }
        }

        // If we aren't in Aevum already, wait until we have the 200K required to travel (plus some extra buffer to actually spend at the casino)
        if (player.money < casinoSeedMoney)
            return log_once(ns, `INFO: Waiting until we have ${formatMoney(300000)} to travel to Aevum and run casino.js`);

        if (!await beginTransition(ns, 'casino automation', false)) return;
        try {
        // Run casino.js (and expect this script to get killed in the process)
        // Make sure "work-for-factions.js" is dead first, lest it steal focus and break the casino script before it has a chance to kill all scripts.
        await killScript(ns, 'work-for-factions.js');
        await killScript(ns, 'daemon.js'); // We also have to kill daemon which can make us study.
        // Kill any action, in case we are studying or working out, as it might steal focus or funds before we can bet it at the casino.
        if (4 in unlockedSFs) // No big deal if we can't, casino.js has logic to find the stop button and click it.
            await getNsDataThroughFile(ns, `ns.singularity.stopAction()`);

        const pid = launchScriptHelper(ns, 'casino.js', ['--kill-all-scripts', true, '--on-completion-script', ns.getScriptName()]);
        if (pid) {
            await waitForProcessToComplete(ns, pid);
            await ns.sleep(10000); // Give time for this script to be killed if the game is being restarted by casino.js
            // Otherwise, something went wrong
            log(ns, `ERROR: Something went wrong. casino.js was run, but we haven't been killed. It must have run into a problem...`)
        }
        } finally { endTransition(ns); }
    }

    /** Retrieves the last faction manager output file, parses, and provides type-hints for it.
     * @returns {{ installed_augs: string[], installed_count: number, installed_count_nf: number, installed_count_ex_nf: number,
     *             owned_augs: string[], owned_count: number, owned_count_nf: number, owned_count_ex_nf: number,
     *             awaiting_install_augs: string[], awaiting_install_count: number, awaiting_install_count_nf: number, awaiting_install_count_ex_nf: number,
     *             affordable_augs: string[], affordable_count: number, affordable_count_nf: number, affordable_count_ex_nf: number,
     *             total_rep_cost: number, total_aug_cost: number, unowned_count: number }} */
    function getFactionManagerOutput(ns) {
        return freshFactionManagerOutput(ns.read(factionManagerOutputFile),resetInfo);
    }

    /** Logic to detect if it's a good time to install augmentations, and if so, do so
     * @param {NS} ns
     * @param {Player} player */
    async function maybeInstallAugmentations(ns, player) {
        if(xpMeasurementActive)return setStatus(ns,'Measuring dedicated hacking XP; augmentation installs resume after the timed experiment.');
        let achievementGoals;try{achievementGoals=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
        if(!options['disable-achievements']&&achievementGoals?.expiresAt>Date.now()&&ns.isRunning(achievementGoals.ownerPid)&&achievementGoals.nodeReset===resetInfo.lastNodeReset&&achievementGoals.holdAugmentations) {
            if(!achievementGoals.minimumQueue||achievementGoals.holdPuzzle){setStatus(ns,'Achievement campaign is holding augmentation resets');return;}
        }
        await ns.write('tasks/augmentation-reset-plan.json', JSON.stringify({ pending: reservedPurchase > 0, ownerPid: ns.pid, expiresAt: Date.now() + 120000 }), 'w');
        if (!(4 in unlockedSFs))  // Cannot automate augmentations or installs without singularity
            return setStatus(ns, `No singularity access, so you're on your own. You should manually work for factions and install augmentations!`);

        if(routePlan?.redPill?.stage==='install')return await installQueuedRedPill(ns,achievementGoals);

        // If we previously attempted to reserve money for an augmentation purchase order, do a fresh facman run to ensure it's still available
        if (reservedPurchase && installCountdown <= Date.now()) {
            log(ns, "INFO: Manually running faction-manager.js to ensure previously reserved purchase is still obtainable.");
            await ns.write(factionManagerOutputFile, "", "w"); // Reset the output file to ensure it isn't stale
            const pid = launchScriptHelper(ns, 'faction-manager.js', ['--log-only']);
            if (!pid) return setStatus(ns, 'Faction manager could not start; retaining the planned purchase and retrying.');
            await waitForProcessToComplete(ns, pid, true); // Wait for the script to shut down (and output to be generated)
        }

        // Grab the latest output from faction manager to see if it's a good time to reset
        const facman = getFactionManagerOutput(ns);
        if (!facman) {
            if(Date.now()>=nextFactionSummaryRefresh){
                nextFactionSummaryRefresh=Date.now()+31000;
                launchScriptHelper(ns,'faction-manager.js',['--log-only']);
            }
            setStatus(ns,'Waiting for a fresh faction-manager summary for this reset.');
            return reservedPurchase = 0;
        }
        playerInstalledAugCount = facman.installed_count; // Augmentations bought *and installed* by the player (used for Daedalus requirement)

        // If we're in BN9 (where hacknet is most important) and we're still on our first reset (where we have an upgraded hacknet node), resist installing
        const inFirstBn9Aug = resetInfo.currentNode == 9 && Math.abs(resetInfo.lastNodeReset - resetInfo.lastAugReset) < 1000;

        // Reduce the augmentations required to reset over time, except in cetain situations. This is because in most situations,
        // pefoming an ascention in a slow-going BN will let us lock in bonuses that will speed up overall pogression.
        let reducedAugReq = Math.floor(options['reduced-aug-requirement-per-hour'] * getTimeInAug() / 3.6E6);
        // In our first BN9 augmentation and in BN8, use this mechanic to actually *increase* aug count requirements.
        if (inFirstBn9Aug || resetInfo.currentNode == 8) // In BN8, no reset bonuses are possible, and we'd lose our stock progress
            reducedAugReq = -2; // In our first BN9 augmentation, delay resetting as we'd lose our boosted hacknet server
        // Collect additional information about how many augmentations we need before it's worth resetting, based on the current configuration
        const sf11Level = dictOwnedSourceFiles[11] ?? 0; // SF11 makes augs scale cheaper, so for each level, require +1 augs
        const augsNeeded = Math.max(1, options['install-at-aug-count'] + sf11Level - reducedAugReq);
        const augsNeededInclNf = Math.max(1, options['install-at-aug-plus-nf-count'] + sf11Level - reducedAugReq);

        // Get a count of pending augmentations (augs we plan to buy, plus any we've bought but not yet installed)
        const pendingAugCount = facman.affordable_count_ex_nf + facman.awaiting_install_count_ex_nf; // Excludes neuroflux levels
        const pendingNfCount = facman.affordable_count_nf + facman.awaiting_install_count_nf; // Only neuroflux levels
        const pendingAugInclNfCount = pendingAugCount + pendingNfCount; // Includes neuroflux levels
        // Create a list of augmentations pending install or pending puchase to display. Group all nf augs into one.
        const strNF = "NeuroFlux Governor"
        let augsToInstall = facman.awaiting_install_augs.filter(aug => aug != strNF)
            .concat(...facman.affordable_augs.filter(aug => aug != strNF));
        if (pendingNfCount > 0)
            augsToInstall.push(`${strNF} (x${pendingNfCount})`)

        // Determine whether we can afford enough augmentations to merit a reset
        let totalCost = facman.total_rep_cost + facman.total_aug_cost;
        const augSummary = `${pendingAugCount} of ${facman.unpurchased_count - 1} remaining augmentations` + // Unowned - 1 because we can always buy more Neuroflux
            (pendingNfCount > 0 ? ` + ${pendingNfCount} levels of NeuroFlux.` : '.') +
            (pendingAugCount > 0 ? `\n    Augs: [\"${augsToInstall.join("\", \"")}\"]` : '');
        let resetStatus = `Reserving ${formatMoney(totalCost)} to install ${augSummary}`
        let shouldReset = priorityAugmentationReady(options['install-for-augs'], facman) ||
            pendingAugCount >= augsNeeded || pendingAugInclNfCount >= augsNeededInclNf;

        if(!speedObservation)try{speedObservation=JSON.parse(ns.read('tasks/speed-observation.json'));}catch{}
        const previousSnapshotAt=speedObservation?.at;
        let casinoStatus,casinoEvidence;
        try{casinoStatus=JSON.parse(ns.read('tasks/casino-status.json'));}catch{}
        try{casinoEvidence=JSON.parse(ns.read('tasks/casino-reset-evidence.json'));}catch{}
        casinoEvidence=observeCasinoReset(casinoEvidence,casinoStatus,resetInfo);
        await ns.write('tasks/casino-reset-evidence.json',JSON.stringify(casinoEvidence),'w');
        const casinoFunding=forecastCasinoReset(casinoEvidence,{reset:resetInfo,
            enabled:!options['disable-casino'],paused:isScriptPaused(ns,'casino.js'),allowed:achievementActionAllowed(ns,'casino'),
            seedFundable:installedAugmentations.concat(facman.affordable_augs||[],facman.awaiting_install_augs||[]).includes('CashRoot Starter Kit')||
                !!unlockedSFs[4]&&!isScriptPaused(ns,'crime.js')&&achievementActionAllowed(ns,'crime'),
            homeRam,casinoRam:ns.getScriptRam(getFilePath('casino.js'),'home'),status:casinoStatus,incomePerSecond:speedObservation?.cashRate||0});
        const speed=progressionSpeed({snapshot:facman.speedSnapshot,previous:speedObservation,casinoFunding,augReset:resetInfo.lastAugReset,elapsed:getTimeInAug(),node:resetInfo.currentNode,firstBn9:inFirstBn9Aug,combatRecovery,nodeReset:resetInfo.lastNodeReset,combatTarget:routePlan?.development?.nextBlackOp?.name??null,routeRemainingMs:routePlan?.routes?.[routePlan.selected]?.etaMs,combat:routePlan?.selected?routePlan.selected==='bladeburner':[6,7].includes(resetInfo.currentNode),baseDelay:options['install-countdown'],homeRam,hackingGoal:routeContinuousXp(options,routePlan)||(prioritizeHackForDaedalus&&routePlan?.selected!=='bladeburner')||prioritizeHackForWd});
        speedObservation=speed.observation;
        if(speedObservation&&speedObservation.at!==previousSnapshotAt)await ns.write('tasks/speed-observation.json',JSON.stringify(speedObservation),'w');
        await ns.write('tasks/progression-speed.json',JSON.stringify({at:Date.now(),augReset:resetInfo.lastAugReset,...speed,observation:undefined}),'w');
        const adaptiveEnabled=!options['disable-adaptive-resets'];
        if(adaptiveEnabled&&speed.earlyInstall){shouldReset=true;resetStatus=speed.reason+'\n'+resetStatus;}
        let installDelay=adaptiveEnabled?speed.delayMs:options['install-countdown'];

        // If we are in Daedalus, and we do not yet have enough favour to unlock rep donations with Daedalus,
        // but we DO have enough rep to earn that favor on our next restart, trigger an install immediately (need at least 1 aug)
        // (doesn't apply in BN8, since we can immediately donate to all factions)
        if (
            routePlan?.redPill?.allowFavorReset===true &&
            routePlan.redPill.worth>=routePlan.redPill.postResetBill+totalCost
        ) {
            shouldReset = true;
            resetStatus = `We have enough reputation with Daedalus to unlock donations on our next reset.\n${resetStatus}`;
            if (totalCost == 0) totalCost = 1; // Hack, logic below expects some non-zero reserve in preparation for ascending.
        }

        // Heuristic: if we can afford 4 or more augs in the first ~20 minutes, it's usually worth doing a "quick install"
        // For example, in BN8, we get a big cash influx on each reset and can buy reputation immediately, so it's worth
        //     doing an few immediate installs to purchase upgrades, then reset for more free cash.
        // When in a gang, require a more augs and don't countdown as quickly, since each reset reduces gang member ascention multipliers
        const quickInstallThreshold = playerInGang ? 6 : 4;
        if (!inFirstBn9Aug && (
            (getTimeInAug() < 20 * 60 * 1000 && pendingAugInclNfCount >= quickInstallThreshold) ||
            // Heuristic: In BN8, reinstall repeatedly for the first 10 minutes to purchase every little thing we can with our flat 10B casino winnings
            (resetInfo.currentNode == 8 && getTimeInBitnode() < 10 * 60 * 1000))) {
            shouldReset = true;
            resetStatus = `We haven't been in this reset for long. We can do a quick reset immediately for a quick stat boost.\n${resetStatus}`;
            if (installDelay > 30 * 1000 && !playerInGang)
                installDelay = 30 * 1000; // Install relatively quickly in this scenario (30s)
        }

        // Fresh native milestone evidence supersedes count/NF/reset heuristics and old favor flags.
        const pill=routePlan?.redPill;
        const wdUpgradePaysBack=pill?.stage==='installed'&&pendingAugCount>0&&speed.gain>=.2&&
            Number.isFinite(speed.paybackMs)&&Number.isFinite(pill.wdResetRecoveryMs)&&Number.isFinite(pill.wdEtaMs)&&
            Math.max(speed.paybackMs,pill.wdResetRecoveryMs)<pill.wdEtaMs*.75;
        if(pill?.holdResets&&!wdUpgradePaysBack||pill?.allowFavorReset&&pill.worth<pill.postResetBill+totalCost) {
            reservedPurchase=0;installCountdown=0;installWindowStarted=0;installCountdownResets=0;
            await ns.write('tasks/augmentation-reset-plan.json',JSON.stringify({pending:false,ownerPid:ns.pid,expiresAt:Date.now()+30000}),'w');
            return setStatus(ns,'Red Pill milestone: '+pill.reason+'; optional augmentation resets are held.');
        }

        // Apply after every count/quick-install heuristic, retaining verified progression milestones.
        if(!augmentationWaitWindow)try{augmentationWaitWindow=JSON.parse(ns.read('tasks/augmentation-wait-plan.json'));}catch{}
        const economicsDecision=augmentationResetDecision({requested:shouldReset,adaptive:adaptiveEnabled,speed,
            waitWindow:augmentationWaitWindow,now:Date.now(),augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset,
            priority:priorityAugmentationReady(options['install-for-augs'],facman),
            favor:pill?.allowFavorReset===true&&pill.worth>=pill.postResetBill+totalCost,
            countUnlock:speed.countMilestone===true||!inFirstBn9Aug&&speed.countProgress===true,
            campaign:!options['disable-achievements']&&achievementGoals?.expiresAt>Date.now()&&achievementGoals.minimumQueue>0&&pendingAugInclNfCount>=achievementGoals.minimumQueue,
            bn8Quick:resetInfo.currentNode===8&&getTimeInBitnode()<10*60*1000,
            remainingMs:routePlan?.routes?.[routePlan.selected]?.etaMs});
        if(economicsDecision.waitWindow){
            augmentationWaitWindow=economicsDecision.waitWindow;
            await ns.write('tasks/augmentation-wait-plan.json',JSON.stringify({...augmentationWaitWindow,active:true,ownerPid:ns.pid,at:Date.now(),plan:economicsDecision.waitPlan}),'w');
        }
        else if(augmentationWaitWindow){
            await ns.write('tasks/augmentation-wait-plan.json',JSON.stringify({...augmentationWaitWindow,active:false,ownerPid:ns.pid,at:Date.now()}),'w');
        }
        if(economicsDecision.waitWindow||augmentationWaitWindow)await refreshAugmentationFundingBudget(ns,player);
        if(shouldReset&&!economicsDecision.allowed){shouldReset=false;resetStatus=economicsDecision.reason;}
        // If not ready to reset, set a status with our progress and return
        if(!options['disable-achievements']&&achievementGoals?.expiresAt>Date.now()&&achievementGoals.minimumQueue>0&&pendingAugInclNfCount<achievementGoals.minimumQueue)shouldReset=false;
        if (!shouldReset) {
            await ns.write('tasks/augmentation-reset-plan.json',JSON.stringify({pending:false,augReset:resetInfo.lastAugReset,ownerPid:ns.pid,expiresAt:Date.now()+120000}),'w');
            setStatus(ns, `Currently at ${formatDuration(getTimeInAug())} since last aug. ` +
                (economicsDecision.reason==='Augmentation threshold not reached'?`Waiting for ${augsNeeded} new augs (or ${augsNeededInclNf} including NeuroFlux levels) before installing.`:economicsDecision.reason) +
                `\nCan currently get: ${augSummary}` + (pendingAugCount == 0 ? '' : `\n  Total Cost: ${formatMoney(totalCost)}`) +
                ` (\`run faction-manager.js\` for details)`, augSummary);
            installWindowStarted=0;installCountdownResets=0;
            return reservedPurchase = 0; // If we were previously reserving money for a purchase, reset that flag now
        }
        if(totalCost===0&&pendingAugInclNfCount>0)totalCost=1; // Give queued-only installations the same bounded countdown.
        await ns.write('tasks/augmentation-reset-plan.json', JSON.stringify({ pending: true, augReset:resetInfo.lastAugReset, ownerPid: ns.pid, expiresAt: Date.now() + 120000 }), 'w');
        // If we want to reset, but there is a reason to delay, don't reset
        if (await shouldDelayInstall(ns, player, facman, speed)) // If we're currently in a state where we should not be resetting, skip reset logic
            return reservedPurchase = 0;

        // Ensure the money needed for the above augs doesn't get ripped out from under us by reserving it
        if (reservedPurchase < totalCost) {
            // A countdown is displayed to give the user a heads up, and give us time to potentially earn money for more augmentations
            if (reservedPurchase == 0){installWindowStarted=Date.now();installCountdownResets=0;installCountdown=Date.now()+installDelay;}
            else { // If we were already reserving for a purchase and the number went up, log a notice of the timer being reset.
                let purchaseChangeLog = `INFO: The augmentation purchase we can afford has increased from ${formatMoney(reservedPurchase)} to ${formatMoney(totalCost)}.`
                // First, check if we're ready to install TRP - if so, don't delay the install for any additional augmentations.
                if (!augsToInstall.includes(augTRP)) {
                    // Otherwise, each time we can afford more augs, reset the install delay timer to take advantage of "momentum"
                    // and potentially purchase many more augmentations in this reset. To avoid delaying an install indefinitely,
                    // we reduce the additional time we're willing to wait a little bit each time this happens.
                    installCountdownResets++;
                    const newCountDown = Date.now() + Math.max(10 * 1000, // At a bare minimum, wait 10 more seconds
                        // Heuristic: Linearly reduce the cooldown until we have doubled the aug count needed.
                        installDelay * (1 - (installCountdownResets / augsNeededInclNf)));
                    if (newCountDown > installCountdown) { // If the existing countdown remaining was longer than this, leave it be
                        installCountdown = newCountDown;
                        purchaseChangeLog = purchaseChangeLog + ' Resetting the timer before we install augmentations.'
                    }
                }
                log(ns, purchaseChangeLog, false);
            }
            await ns.write("reserve.txt", totalCost, "w"); // Should prevent other scripts from spending this money
        }
        if(adaptiveEnabled&&installWindowStarted)installCountdown=Math.min(installCountdown,installWindowStarted+options['install-countdown'],Date.now()+installDelay);
        // We must wait until the configured cooldown elapses before we install augs.
        if (installCountdown > Date.now()) {
            resetStatus += `\n  Waiting for ${formatDuration(Math.max(0,installCountdown-Date.now()))} (installation countdown) ` +
                `to elapse before we install, in case we're close to being able to purchase more augmentations...`;
            setStatus(ns, resetStatus);
            ns.toast(`Heads up: Autopilot plans to reset in ${formatDuration(installCountdown - Date.now())}`, 'info');
            return reservedPurchase = totalCost;
        }

        // Otherwise, we've got the money reserved, we can afford the augs, we should be confident to ascend
        const resetLog = `  Invoking ascend.js at ${formatDuration(getTimeInAug()).padEnd(11)} since last aug to install: ${augSummary}`;
        persist_log(ns, log(ns, resetLog, true, 'info'));

        if (!await beginTransition(ns, 'augmentation installation', true)) return;
        try {
        // Kick off ascend.js
        let errLog;
        const ascendArgs = ['--install-augmentations', true, '--on-reset-script', ns.getScriptName()]
        if (pendingAugInclNfCount == 0) // If we know we would install 0 augs, but still wish to reset, we must enable soft resetting
            ascendArgs.push("--allow-soft-reset")
        let pid = launchScriptHelper(ns, 'ascend.js', ascendArgs);
        if (pid) {
            await waitForProcessToComplete(ns, pid, true); // Wait for the script to shut down (Ascend should get killed as it does, since the BN will be rebooting)
            await ns.sleep(1000); // If we've been scheduled to be killed, awaiting an NS function should trigger it?
            errLog = `ERROR: ascend.js ran, but we're still here. Something must have gone wrong. Will try again later`;
        } else
            errLog = `ERROR: Failed to launch ascend.js (pid == 0). Will try again later`;
        // If we got this far, something went wrong
        persist_log(ns, log(ns, errLog, true, 'error'));
        } finally { endTransition(ns); }
    }

    /** Logic to detect if we are close to a milestone and should postpone installing augmentations until it is hit
     * @param {NS} ns
     * @param {Player} player
     * @param {{ installed_augs: string[], installed_count: number, installed_count_nf: number, installed_count_ex_nf: number,
     *           owned_augs: string[], owned_count: number, owned_count_nf: number, owned_count_ex_nf: number,
     *           awaiting_install_augs: string[], awaiting_install_count: number, awaiting_install_count_nf: number, awaiting_install_count_ex_nf: number,
     *           affordable_augs: string[], affordable_count: number, affordable_count_nf: number, affordable_count_ex_nf: number,
     *           total_rep_cost: number, total_aug_cost: number, unowned_count: number }} facmanOutput
    */
    async function shouldDelayInstall(ns, player, facmanOutput, speed) {
        // Don't install if we're currently grafting an augmentation
        if (await checkIfGrafting(ns))
            return true;
        if ((unlockedSFs[6]||unlockedSFs[7]) && await getNsDataThroughFile(ns,
            'ns.bladeburner.inBladeburner() && /black/i.test(ns.bladeburner.getCurrentAction()?.type || "")', '/Temp/autopilot-blackop.txt'))
            return true;
        // Are we close to being able to afford 4S TIX data?
        if (!have4STixApi) have4STixApi = await getNsDataThroughFile(ns, `ns.stock.has4SDataTixApi()`);
        if (!priorityAugmentationReady(options['install-for-augs'],facmanOutput) && !options['disable-wait-for-4s'] && achievementActionAllowed(ns,'fourSigma') && !have4STixApi) {
            if (!have4SData) have4SData = await getNsDataThroughFile(ns, `ns.stock.has4SData()`);
            const totalWorth = player.money + await getStocksValue(ns);
            const totalCost = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost +
                (have4SData ? 0 : 1E9 * bitNodeMults.FourSigmaMarketDataCost);
            let stock,window;
            try{stock=JSON.parse(ns.read('tasks/stock-status.json'));}catch{}
            try{window=JSON.parse(ns.read('tasks/augmentation-4s-wait.json'));}catch{}
            const stockPid=isScriptPaused(ns,'stockmaster.js')?0:ns.ps('home').find(p=>p.filename.replace(/^\//,'')==='stockmaster.js'&&p.pid===stock?.pid)?.pid;
            const decision=augmentationFourSigmaWait({route:routePlan?.selected||([6,7].includes(resetInfo.currentNode)?'bladeburner':'hacking'),
                reset:resetInfo,now:Date.now(),worth:totalWorth,cost:totalCost,threshold:options['wait-for-4s-threshold'],
                stock,stockPid,income:speedObservation,window,paybackMs:speed?.paybackMs,remainingMs:routePlan?.routes?.[routePlan.selected]?.etaMs});
            if(decision.window)await ns.write('tasks/augmentation-4s-wait.json',JSON.stringify({...decision.window,at:Date.now(),ownerPid:ns.pid,
                active:decision.wait,reason:decision.reason,etaMs:decision.etaMs??null,target:decision.target??null}),'w');
            if(decision.wait){
                setStatus(ns,`Waiting up to ${formatDuration(decision.deadline-Date.now())} for 4S funding (estimated ${formatDuration(decision.etaMs)}).`);
                return true;
            }
        }
        if (resetInfo.currentNode == 8) { // Many special rules for this special Bitnode
            if (player.factions.includes("Daedalus")) { // If we've already joined Daedalus
                // In BN8, large sums of money are hard to accumulate, so if we've made it into Daedalus, but can't purchase TRP rep yet,
                // remain in the BN until we have enough rep and/or money to buy TRP (Reminder: in BN8, donations are immediately unlocked for all factions)    
                if (!installedAugmentations.includes(augTRP) && !facmanOutput.affordable_augs.includes(augTRP) && !facmanOutput.awaiting_install_augs.includes(augTRP)) {
                    setStatus(ns, `We're in Daedalus, so we won't install until we can afford to purchase "${augTRP}".`);
                    return true;
                }
            } else if (playerInstalledAugCount >= bitNodeMults.DaedalusAugsRequirement && player.skills.hacking >= (2500 * 0.9)) {
                // If we meet the Daedalus aug count requirement and at least 90% of the required hack level, wait to earn the invite
                setStatus(ns, `Not installing because we're in BN8 and we have enough augs and ` + (player.skills.hacking < 2500 ? 'nearly ' : '')
                    + 'enough hack level to get invited to Daedalus once we hit $100b.');
                return true;
            } else if (getTimeInAug() > 4 * 60 * 60 * 1000) { // 4 hours = 4hrs/min * 60mins/sec * 60secs/ms * 1000ms
                // If we've been in BN8 for more than 4 hours, we shouldn't reset unless we're making significant progress towards unlocking Daedalus.
                // because it takes so long to build up money, and nothing we install will accellerate our earnings in the next augmentation.
                const augsReadyToInstall = facmanOutput.awaiting_install_count_ex_nf + facmanOutput.affordable_count_ex_nf;
                if (augsReadyToInstall < 10) { // Heuristic: 10 augs per install means max 3 installs before we meet the Daedalus aug requirement
                    setStatus(ns, `Not installing because we've in BN8 for more than 4 hours (~${Math.round(getTimeInAug() / 1000 / 60 / 60)}h) and aren't in Daedalus yet, ` +
                        `so our threshold is at least 10 new augs installed to merit resetting (currently at ${augsReadyToInstall}).`);
                    return true;
                }
            }
        }
        // If we're reserving money because we're close to getting an invite to Daedalus don't reset.
        if (reservingMoneyForDaedalus) {
            setStatus(ns, `Not installing since we are close to earning an invite from Daedalus.`);
            return true;
        }

        // In BN10, it takes a while to build up the 100q needed to purchase the last sleeve, so don't reset if we're close
        if (resetInfo.currentNode == 10 && player.money >= 10e15 && !sleevesMaxedOut) { // Heuristic: If we hit 10q (10% the cost of the last sleeve) before an install, we can probably go all the way
            setStatus(ns, `Not installing anymore since we are nearing the 100q needed to purchase the 6th sleeve from the Covenant.`);
            return true;
        }

        // TODO: Bladeburner black-op in progress
        // TODO: Close to the rep needed for unlocking donations with a new faction?
        return false;
    }

    let wasGrafting = false;

    /** Checks if we are current grafting. If so, certain actions should not be taken.
     * @param {NS} ns
     * @returns {bool} true if the player is grafting, false otherwise. */
    async function checkIfGrafting(ns) {
        let currentWork = (/**@returns{Task|null}*/() => null)();
        currentWork = await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()');
        // Never interrupt grafting
        if (currentWork?.type == "GRAFTING") {
            if (!wasGrafting) // Only log the first time we detect we've started grafting
                log(ns, "Grafting in progress. Augmentation installs will wait; casino automation and completed BitNodes take priority.");
            return wasGrafting = true;
        }
        else
            return wasGrafting = false
    }

    /** Refresh only the cash goal; keep the current epoch and already-consumed allowances. */
    async function refreshAugmentationFundingBudget(ns,player) {
        const signals=adaptiveBudgetSignals(ns);
        let plan;try{plan=JSON.parse(ns.read('tasks/spending-plan.json'));}catch{}
        if(plan?.ownerPid===ns.pid&&plan.reset===resetInfo.lastAugReset&&plan.expiresAt>Date.now()){
            plan.signals={...plan.signals,augmentationCashTarget:signals.augmentationCashTarget};
        }else{
            plan=spendingPlan({money:player.money,reserve:Math.max(0,Number(ns.read('reserve.txt'))||0),homeRam,
                node:resetInfo.currentNode,ownerPid:ns.pid,reset:resetInfo.lastAugReset,signals});
        }
        await ns.write('tasks/spending-plan.json',JSON.stringify(plan),'w');
    }

    /** Consolidated logic for all the times we want to reserve money
     * @param {NS} ns
     * @param {Player} player */
    async function manageReservedMoney(ns, player, stocksValue) {
        if(casinoSeedPending)return ns.write('reserve.txt',String(casinoSeedMoney),'w');
        if(routePlan?.redPill?.active&&Number.isFinite(routePlan.redPill.reserve))return ns.write('reserve.txt',Math.max(0,routePlan.redPill.reserve),'w');
        if (reservedPurchase) return; // Do not mess with money reserved for installing augmentations
        const currentReserve = Number(ns.read("reserve.txt") || 0);
        if (reservingMoneyForDaedalus) // Reserve 100b to get the daedalus invite
            return currentReserve == 100E9 ? true : ns.write("reserve.txt", 100E9, "w");
        // Keep essential spending possible before the stock API is unlocked.
        let stockApiAvailable = false;
        try { stockApiAvailable = await getNsDataThroughFile(ns, 'ns.stock.hasTixApiAccess()', '/Temp/autopilot-stock-access.txt'); } catch { }
        let saving=false;try{const p=JSON.parse(ns.read('tasks/spending-plan.json'));saving=p.ownerPid===ns.pid&&p.reset===resetInfo.lastAugReset&&p.expiresAt>Date.now()&&Number.isFinite(p.signals?.augmentationCashTarget?.cost)&&p.signals.augmentationCashTarget.cost>0;}catch{}
        // The stock-capital target is optional when another route or an augmentation needs funding.
        const reserve = autopilotStockReserve(player.money, stocksValue, getTimeInBitnode() / 3.6e6, stockApiAvailable,routePlan?.selected==='bladeburner'||saving);
        if (currentReserve !== reserve) await ns.write('reserve.txt', reserve, 'w');
    }

    /** Logic to determine whether we should keep running, or shut down autopilot.js for some reason.
     * @param {NS} ns
     * @returns {boolean} true if we should keep running. False if we should shut down this script. */
    function shouldWeKeepRunning(ns) {
        if (4 in unlockedSFs)
            return true; // If we have SF4 - run always
        // If we've gotten daemon.js launched, but only have 8GB ram, we must shut down for now
        if (homeRam == 8 && daemonStartTime > 0) {
            log(ns, `WARN: (not an actual warning, just trying to make this message stand out.)` +
                `\n` + '-'.repeat(100) +
                `\n\n  Welcome to bitburner and thanks for using my scripts!` +
                `\n\n  Currently, your available RAM on home (8 GB) is too small to keep autopilot.js running.` +
                `\n  The priority should just be to run "daemon.js" for a while until you have enough money to` +
                `\n  purchase some home RAM (which you must do manually at a store like [alpha ent.] in the city),` +
                `\n\n  Once you have more home ram, feel free to 'run ${ns.getScriptName()}' again!` +
                `\n\n` + '-'.repeat(100), true);
            return false; // Daemon.js needs more room to breath
        }
        // Otherwise, keep running
        return true;
    }

    /** Helper to launch a script and log whether if it succeeded or failed
     * @param {NS} ns */
    function launchScriptHelper(ns, baseScriptName, args = [], convertFileName = true) {
        if (isScriptPaused(ns, baseScriptName)) return 0;
        if (activityBusy(ns) && /(^|\/)(work-for-factions|grafting-manager)\.js$/.test(baseScriptName)) return 0;
        if (!options['no-tail-windows'])
            tail(ns); // If we're going to be launching scripts, show our tail window so that we can easily be killed if the user wants to interrupt.
        const script=convertFileName?getFilePath(baseScriptName):baseScriptName;
        const track=trackedLaunches.has(baseScriptName.replace(/^\//,''));
        const launchKey=launchCooldownKey(script,args);
        const existing=launchHistory.get(launchKey);
        const live=!!existing?.pid&&ns.isRunning(existing.pid);
        if(live)return existing.pid;
        const prior=track?launchCooldown(existing,{now:Date.now(),reset:resetInfo.lastAugReset,signature:scriptSignature(ns,script,launchSourceCache),alive:false}):null;
        if(track&&existing)launchHistory.set(launchKey,{...existing,...prior});
        if(prior?.retryAt>Date.now()){
            log_once(ns,'INFO: '+baseScriptName+' exited repeatedly; retrying after '+new Date(prior.retryAt).toISOString(),false);return 0;
        }
        const required=ns.getScriptRam(script,'home');
        if(!(required>0)||!reclaimHomeRam(ns,required+homeRamReserve(ns)))return 0;
        let pid, err;
        try { pid = ns.run(convertFileName ? getFilePath(baseScriptName) : baseScriptName, 1, ...args); }
        catch (e) { err = e; }
        if(track&&launchHistory.size>=64&&!launchHistory.has(launchKey))launchHistory.delete([...launchHistory].sort((a,b)=>a[1].startedAt-b[1].startedAt)[0][0]);
        if(track)launchHistory.set(launchKey,{...recordLaunch(prior,pid,Date.now()),script:baseScriptName.replace(/^\//,''),path:script});
        if (pid)
            log(ns, `INFO: Launched ${baseScriptName} (pid: ${pid}) with args: [${args.join(", ")}]`, false);
        else
            log(ns, `ERROR: Failed to launch ${baseScriptName} with args: [${args.join(", ")}]` +
                (err ? `\nCaught: ${getErrorInfo(err)}` : ''), true, 'error');
        return pid;
    }

    let lastStatusLog = ""; // The current or last-assigned long-term status (what this script is waiting to happen)

    /** Helper to set a global status and print it if it changes
     * @param {NS} ns */
    function setStatus(ns, status, uniquePart = null) {
        uniquePart = uniquePart || status; // Can be used to consider a logs "the same" (not worth re-printing) even if they have some different text
        if (lastStatusLog == uniquePart) return;
        lastStatusLog = uniquePart
        log(ns, status);
    }

    /** Append the specified text (with timestamp) to a persistent log in the home directory
     * @param {NS} ns */
    function persist_log(ns, text) {
        ns.write(persistentLog, `${(new Date()).toISOString().substring(0, 19)} ${text}\n`, "a")
    }

    let logged_once = new Set();
    /** Helper to log a message, but only the first time it is encountered.
     * @param {NS} ns
     * @param {string} message The message to log, only if it hasn't been previously logged. 
     * @param {boolean} alsoPrintToTerminal Set to true to print not only to the current script's tail file, but to the terminal
     * @param {""|"success"|"warning"|"error"|"info"} toastStyle - If specified, your log will will also become a toast notification */
    function log_once(ns, message, alsoPrintToTerminal, toastStyle) {
        if (logged_once.has(message))
            return;
        logged_once.add(log(ns, message, alsoPrintToTerminal, toastStyle));
    }

    // Invoke the main function
    await main_start(ns);
}
