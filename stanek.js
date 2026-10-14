import { isScriptPaused } from './automation-control.js';
import { registerAutomation, automationHeartbeat, maintenanceRequested } from './runtime-policy.js';
import { pendingRam } from './activity-coordination.js';
import { stanekChargePlan, stanekThreadBudget, stanekOptionsError, stanekSourceLevel } from './stanek-policy.js';
import {
    log, disableLogs, getFilePath, getConfiguration, formatNumberShort, formatRam,
    getNsDataThroughFile, waitForProcessToComplete, instanceCount, unEscapeArrayArgs,
    tail
} from './helpers.js'

// Name of the external script that will be created and called to generate charges
const chargeScript = "/Temp/stanek.js.charge.js";
let awakeningRep = 1E6, serenityRep = 100E6; // Base reputation cost - can be scaled by bitnode multipliers

const argsSchema = [
    ['reserved-ram', 32], // Don't use this RAM
    ['reserved-ram-ideal', 64], // Leave this amount of RAM free if it represents less than 5% of available RAM
    ['max-charges', 120], // Stop charging when all fragments have this many charges (diminishing returns - num charges is ^0.07 )
    ['on-startup-script', null], // Spawn this script when stanek is launched
    ['on-startup-script-args', []], // Args for the above
    // Autopilot supplies its daemon completion hook; standalone use has no default hooks.
    ['on-completion-script', null], // Spawn this script when max-charges is reached
    ['on-completion-script-args', []], // Optional args to pass to the script when launched
    ['no-tail', true], // Keep tail windows closed; inspect logs manually when needed.
    ['reputation-threshold', 0.2], // By default, if we are this close to the rep needed for an unowned stanek upgrade (e.g. "Stanek's Gift - Serenity"), we will keep charging despite the 'max-charges' setting
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

let options, currentServer, maxCharges, sf4Level, shouldContinueForAug;
const chargeChildren = new Set();

/** Maximizes charge on stanek fragments based on current home RAM.
 * NOTE: You should have no other scripts running on home while you do this to get the best peak charge possible
 *       Stanek stats benefit more from charges with a high avg RAM used per charge, rather than just more charges.
 * @param {NS} ns **/
export async function main(ns) {
    if (isScriptPaused(ns, ns.getScriptName())) return;
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    const optionError = stanekOptionsError(options);
    if (optionError) return ns.tprint('Stanek: '+optionError);
    registerAutomation(ns);
    disableLogs(ns, ['sleep', 'run', 'getServerMaxRam', 'getServerUsedRam']);
    chargeChildren.clear();
    ns.atExit(() => { for (const pid of chargeChildren) if (ns.isRunning(pid)) ns.kill(pid); });

    // The charging API requires installed Genesis, rather than SF13 itself.
    let initialFragments;
    try { initialFragments = await getActiveFragments(ns); }
    catch (error) { return ns.tprint("Stanek charging unavailable: install Stanek's Gift - Genesis first. "+String(error)); }
    if (initialFragments.length == 0) {
        // Try to run our helper script to set up the grid
        const pid = ns.run(getFilePath('stanek.js.create.js'));
        if (pid) { chargeChildren.add(pid); try { await waitForProcessToComplete(ns, pid); } finally { chargeChildren.delete(pid); } }
        else log(ns, "ERROR while attempting to run stanek.js.create.js (pid was 0)");
        // Verify that this worked.
        if ((await getActiveFragments(ns)).length == 0)
            return log(ns, "ERROR: You must manually populate your stanek grid with your desired fragments before you run this script to charge them.", true, 'error');
    }

    currentServer = await getNsDataThroughFile(ns, `ns.getHostname()`);
    maxCharges = options['max-charges']; // Don't bother adding charges beyond this amount
    let startupScript = options['on-startup-script'];
    let startupArgs = unEscapeArrayArgs(options['on-startup-script-args']);
    if (startupScript) {
        // If so configured, launch the start-up script to run alongside stanek and let it consume the RAM it needs before initiating stanek loops.
        if (ns.run(startupScript, 1, ...startupArgs)) {
            log(ns, `INFO: Stanek.js is launching accompanying 'on-startup-script': ${startupScript}...`, false, 'info');
            await ns.sleep(1000); // Give time for the accompanying script to start up and consume its required RAM footprint.
        } else
            log(ns, `WARNING: Stanek.js has started successfully, but failed to launch accompanying 'on-startup-script': ${startupScript}...`, false, 'warning');
    }

    const chargeScriptBody = "export async function main(ns) { await ns.stanek.chargeFragment(ns.args[0], ns.args[1]); }";
    const checkOnChargeScript = async () => { // We must use this periodically since cleanup might be run while we're charging.
        // Check if our charge script exists. If not, we can create it (facilitates copying stanek.js to a new server to run)
        if (ns.read(chargeScript) != chargeScriptBody)
            await ns.write(chargeScript, chargeScriptBody, "w");
    }

    // Check what augs we own and establish the theshold to continue grinding REP if we're close to one.
    sf4Level = stanekSourceLevel(ns.getResetInfo(), 4);
    shouldContinueForAug = () => false;
    if (sf4Level == 0) {
        log(ns, `INFO: SF4 required to get owned faction rep and augmentation info. Ignoring the --reputation-threshold setting.`);
    } else try {
        const ownedAugmentations = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(true)`, '/Temp/player-augs-purchased.txt');
        const [strAwakening, strSerenity] = ["Stanek's Gift - Awakening", "Stanek's Gift - Serenity"];
        const [awakeningOwned, serenityOwned] = [ownedAugmentations.includes(strAwakening), ownedAugmentations.includes(strSerenity)];
        if (!awakeningOwned || !serenityOwned) {
            [awakeningRep, serenityRep] = await getNsDataThroughFile(ns,
                `[${[strAwakening, strSerenity].map(a => `ns.singularity.getAugmentationRepReq(\"${a}\")`)}]`,
                '/Temp/stanek-aug-rep-reqs.txt');
            log(ns, `INFO: Stanek Augmentations Rep Requirements are Awakening: ${formatNumberShort(awakeningRep)}, ` +
                `Serenity: ${formatNumberShort(serenityRep)} (--reputation-threshold = ${options['reputation-threshold']})`);
        }
        shouldContinueForAug = (currentRep, owned = ownedAugmentations) => // return true if currentRep is high enough that we should keep grinding for the next unowned aug
            !owned.includes(strAwakening) && options['reputation-threshold'] * awakeningRep <= currentRep && currentRep < awakeningRep ||
            !owned.includes(strSerenity) && options['reputation-threshold'] * serenityRep <= currentRep && currentRep < serenityRep
    }

    catch (error) { sf4Level = 0; log(ns, 'Optional reputation tracking unavailable: '+String(error)); }

    // Start the main stanek loop
    let lastLoopSuccessful = true;
    while (!isScriptPaused(ns, ns.getScriptName())) {
        await ns.sleep(lastLoopSuccessful ? 10 : 1000); // Only sleep a short while between charges if things are going well
        lastLoopSuccessful = false;
        automationHeartbeat(ns);
        if (isScriptPaused(ns, ns.getScriptName())) break;
        if (maintenanceRequested(ns)) {
            await ns.write('tasks/stanek-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,mode:'waiting',reason:'Automation maintenance'}), 'w');
            await ns.sleep(1000); continue;
        }
        try {
            if (!options['no-tail']) tail(ns); // Keep a tail window open unless otherwise configured
            await checkOnChargeScript();
            const fragmentsToCharge = await getFragmentsToCharge(ns);
            if (fragmentsToCharge === undefined) {
                await ns.write('tasks/stanek-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,mode:'blocked',reason:'No chargeable fragments; inspect the gift layout.'}), 'w');
                return;
            }
            if (fragmentsToCharge.length == 0) break; // All fragments at max desired charge
            lastLoopSuccessful = await tryChargeAllFragments(ns, fragmentsToCharge);
            await ns.write('tasks/stanek-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,mode:lastLoopSuccessful?'charging':'waiting',target:maxCharges,pending:fragmentsToCharge.length,fragments:await getActiveFragments(ns)}), 'w');
        }
        catch (err) {
            await ns.write('tasks/stanek-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,mode:'recovering',error:String(err)}), 'w');
            log(ns, `WARNING: stanek.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
    }
    if (isScriptPaused(ns, ns.getScriptName())) return;
    await ns.write('tasks/stanek-status.json', JSON.stringify({at:Date.now(),pid:ns.pid,mode:'complete',target:maxCharges,fragments:await getActiveFragments(ns)}), 'w');
    log(ns, `SUCCESS: All stanek fragments at desired charge ${maxCharges}`, true, 'success');

    // Run the completion script before shutting down
    let completionScript = options['on-completion-script'];
    let completionArgs = unEscapeArrayArgs(options['on-completion-script-args']);
    if (completionScript) {
        if (ns.run(completionScript, 1, ...completionArgs)) {
            log(ns, `INFO: Stanek.js shutting down and launching ${completionScript}...`, false, 'info');
            if (!options['no-tail'])
                ns.ui.closeTail(); // Close the tail window if we opened it
        } else
            log(ns, `WARNING: Stanek.js shutting down, but failed to launch ${completionScript}...`, false, 'warning');
    }
}

/** Get Fragments to Charge
 * @param {NS} ns
 * @returns {Promise<ActiveFragment[]>} whether all fragments were charged successfully **/
async function getFragmentsToCharge(ns) {
    // Make sure we have the latest information about all fragments
    let fragments = await getActiveFragments(ns);
    if (fragments.length == 0) {
        log(ns, "ERROR: Stanek fragments were cleared. You must re-populate the grid before charging can continue.", true, 'error');
        return undefined;
    }
    // If we have SF4, get our updated faction rep, and determine if we should continue past --max-charges to earn rep for the next augmentation
    let churchRep = 0, currentOwned = [];
    if (sf4Level) try {
        churchRep = await getNsDataThroughFile(ns, 'ns.singularity.getFactionRep(ns.args[0])', null, ["Church of the Machine God"]);
        currentOwned = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/stanek-current-owned-augs.txt');
    } catch (error) {
        sf4Level = 0; shouldContinueForAug = () => false;
        log(ns, 'Optional reputation tracking unavailable; continuing charge target: '+String(error));
    }
    const shouldContinue = shouldContinueForAug(churchRep, currentOwned);

    const freeRam = ns.getServerMaxRam(currentServer) - ns.getServerUsedRam(currentServer);
    const budget = stanekThreadBudget(freeRam, ns.getScriptRam(chargeScript, currentServer), options['reserved-ram'], options['reserved-ram-ideal'], currentServer === 'home' ? pendingRam(ns) : 0);
    const coreBonus = 1 + (ns.getServer(currentServer).cpuCores - 1) / 16;
    const plan = stanekChargePlan(fragments, maxCharges, shouldContinue, budget.threads * coreBonus);
    if (plan.blocked) { log(ns, 'Stanek layout contains only booster fragments; nothing can be charged.'); return undefined; }
    if (plan.complete) return [];
    const fragmentsToCharge = plan.fragments;
    const fragmentSummary = fragments.map(fragment => `Fragment ${fragment.id} at [${fragment.x},${fragment.y}]: ` +
        (fragment.id < 100 ? `Peak ${formatNumberShort(fragment.highestCharge)}, charges ${fragment.numCharge}` : 'booster')).join('\n');
    // Log a status update
    log(ns, `Charging ${fragmentsToCharge.length}/${fragments.length} fragments ` + (!shouldContinue ? `to ${maxCharges}` : `until faction has ` +
        formatNumberShort(churchRep < awakeningRep ? awakeningRep : serenityRep) + ` rep (currently at ${formatNumberShort(churchRep)})`) +
        `. Curent charges:\n${fragmentSummary}`);
    return fragmentsToCharge;
}

/** Try to charge all the specified fragments using available ram
 * @param {NS} ns
 * @returns {Promise<bool>} whether all fragments were charged successfully **/
async function tryChargeAllFragments(ns, fragmentsToCharge) {
    return await chargeStanekFragments(ns, fragmentsToCharge, currentServer, options,
        getActiveFragments, chargeChildren, currentServer === 'home' ? pendingRam(ns) : 0);
}

/** Return true only after every launched worker produces an observed charge increase. */
export async function chargeStanekFragments(ns, fragments, host, configuration, readFragments, children = new Set(), pending = 0) {
    let allSuccessful = true;
    for (const fragment of fragments) {
        if (isScriptPaused(ns, ns.getScriptName()) || maintenanceRequested(ns)) return false;
        const live = (await readFragments(ns)).find(f => f.id === fragment.id && f.x === fragment.x && f.y === fragment.y && f.rotation === fragment.rotation);
        if (!live) { allSuccessful = false; continue; }
        const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
        const workerRam = ns.getScriptRam(chargeScript, host);
        const {threads, reserve} = stanekThreadBudget(availableRam, workerRam, configuration['reserved-ram'], configuration['reserved-ram-ideal'],
            Math.max(pending, host === 'home' ? pendingRam(ns) : 0));
        if (threads <= 0) {
            ns.print(`Stanek waiting for RAM: ${formatRam(availableRam)} free, ${formatRam(reserve)} reserved.`);
            allSuccessful = false; continue;
        }
        const pid = ns.run(chargeScript, {threads, temporary:true}, live.x, live.y);
        if (!pid) { allSuccessful = false; continue; }
        children.add(pid);
        try { while (ns.isRunning(pid)) {
            automationHeartbeat(ns);
            if (isScriptPaused(ns, ns.getScriptName()) || maintenanceRequested(ns)) { ns.kill(pid); return false; }
            await ns.sleep(20);
        } }
        finally { if (!ns.isRunning(pid)) children.delete(pid); }
        const after = (await readFragments(ns)).find(f => f.id === live.id && f.x === live.x && f.y === live.y && f.rotation === live.rotation);
        if (!after || !(after.numCharge > live.numCharge || after.highestCharge > live.highestCharge)) {
            ns.print(`Stanek fragment ${live.id} at [${live.x},${live.y}] did not gain charge; retrying without declaring completion.`);
            allSuccessful = false;
        }
    }
    return allSuccessful;
}

/** Get the current active stanek fragments
 * @param {NS} ns
 * @returns {Promise<ActiveFragment[]>} **/
async function getActiveFragments(ns) {
    return await getNsDataThroughFile(ns, 'ns.stanek.activeFragments()', '/Temp/stanek-active-fragments.txt', [], false, 1, 0, true);
}
