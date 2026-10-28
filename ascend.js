import {augmentationInstallSafety,resumeAugmentationAutomation,liquidateAugmentationStocks,prepareAugmentationPurchases} from './augmentation-install-policy.js';
import {ensureFactionJoinPlan} from './faction-joining.js';
import {factionJoinAllowed,rankFactionInvites} from './faction-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { prepareResetBackup } from './reset-backup.js';
import { beginTransition, endTransition } from './progression-coordination.js';
import {
    log, getConfiguration, getFilePath, runCommand, waitForProcessToComplete, getNsDataThroughFile,
    getActiveSourceFiles, getStockSymbols
} from './helpers.js'

const argsSchema = [
    ['install-augmentations', false], // By default, augs will only be purchased. Set this flag to install (a.k.a reset)
    /* OR */['reset', false], // An alias for the above flag, does the same thing.
    ['allow-soft-reset', false], // If set to true, allows ascend.js to invoke a **soft** reset (installs no augs) when no augs are affordable. This is useful e.g. when ascending rapidly to grind hacknet hash upgrades.
    ['skip-staneks-gift', false], // By default, we get stanek's gift before our first install (except in BN8). If set to true, skip this step.
    /* Deprecated */['bypass-stanek-warning', false], // (Obsoleted by the above option) Used to warn you if you were installing augs without accepting stanek's gift
    // Spawn this script after installing augmentations (Note: Args not supported by the game)
    ['on-reset-script', null], // By default, will start with `stanek.js` if you have stanek's gift, otherwise `daemon.js`.
    ['ticks-to-wait-for-additional-purchases', 10], // Don't reset until we've gone this many game ticks without any new purchases being made (10 * 200ms (game tick time) ~= 2 seconds)
    ['stock-liquidation-timeout',30000], // Maximum wall time allowed for stock liquidation before aborting installation.
    ['stock-liquidation-attempts',3], // Bound retries when its worker cannot start or leaves positions open.
    ['max-wait-time', 60000], // The maximum number of milliseconds we'll wait for external scripts to purchase whatever permanent upgrades they can before we ascend anyway.
    ['prioritize-home-ram', false], // If set to true, will spend as much money as possible on upgrading home RAM before buying augmentations
    /* Deprecated */['prioritize-augmentations', true], // (Legacy flag, now ignored - left for backwards compatibility)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--on-reset-script"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** @param {NS} ns
 * This script is meant to do all the things best done when ascending (in a generally ideal order) **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    let dictSourceFiles = await getActiveSourceFiles(ns); // Find out what source files the user has unlocked
    if (!(4 in dictSourceFiles))
        return log(ns, "ERROR: You cannot automate installing augmentations until you have unlocked singularity access (SF4).", true, 'error');
    if (!await beginTransition(ns, 'augmentation installation', true)) return;
    ns.atExit(() => endTransition(ns));
    const beforeReset=ns.getResetInfo(),previousAutomation=ns.ps('home');
    const bladeburnerAccess=!!(dictSourceFiles[6]||dictSourceFiles[7]);
    let shutdownStarted=false;
    try {
    ns.disableLog('sleep');
    if (options['prioritize-augmentations'])
        log(ns, "INFO: The --prioritize-augmentations flag is deprecated, as this is now the default behaviour. Use --prioritize-home-ram to get back the old behaviour.")

    // Kill every script except this one, since it can interfere with out spending
    // Guard and stop services in one worker tick so an intervening Black Op is preserved.
    shutdownStarted=true;
    const stopped=await getNsDataThroughFile(ns,`(() => {
        if(!ns.isRunning(ns.args[2]))return {allowed:false,reason:"Install owner exited"};
        const safety=(${augmentationInstallSafety.toString()})({getCurrentWork:()=>ns.singularity.getCurrentWork(),inBladeburner:()=>ns.bladeburner.inBladeburner(),getCurrentAction:()=>ns.bladeburner.getCurrentAction()},ns.args[1]);
        if(!safety.allowed)return safety;
        ns.ps().filter(s=>s.pid!==ns.pid&&s.filename!==ns.args[0]&&!s.filename.includes('remote-api-agent')&&!s.filename.startsWith('remote-control/')).forEach(s=>ns.kill(s.pid));
        return {allowed:true};
    })()`,'/Temp/ascend-stop-services.txt',[ns.getScriptName(),bladeburnerAccess,ns.pid]);
    if(!stopped?.allowed)return log(ns,stopped?.reason||'Install safety check unavailable',true,'warning');
    let pid;

    // Stop the current action so that we're no longer spending money (if training) and can collect rep earned (if working)
    await getNsDataThroughFile(ns, 'ns.singularity.stopAction()');

    // Clear any global reserve so that all money can be spent
    await ns.write("reserve.txt", 0, "w");

    // STEP 1: Liquidate Stocks and (SF9) Hacknet Hashes
    log(ns, 'Sell stocks and hashes...', false, 'info');
    ns.run(getFilePath('spend-hacknet-hashes.js'), 1, '--liquidate');

    // If we do not have tix api access, we cannot automate checking on or selling stocks, so skip this
    const hasTixApiAccess = await getNsDataThroughFile(ns, `ns.stock.hasTixApiAccess()`);
    if (hasTixApiAccess) {
        const stkSymbols = await getStockSymbols(ns);
        const countOwnedStocks = async () => await getNsDataThroughFile(ns, `ns.args.map(sym => ns.stock.getPosition(sym))` +
            `.reduce((t, stk) => t + (stk[0] + stk[2] > 0 ? 1 : 0), 0)`, '/Temp/owned-stocks.txt', stkSymbols);
        const liquidation=await liquidateAugmentationStocks(ns,{count:countOwnedStocks,
            launch:()=>ns.run(getFilePath('stockmaster.js'),1,'--liquidate'),
            timeoutMs:options['stock-liquidation-timeout'],maxAttempts:options['stock-liquidation-attempts']});
        if(!liquidation.ok)return log(ns,'Installation deferred: '+liquidation.reason,true,'warning');
    }

    // STEP 2: Buy Home RAM Upgrades (more important than squeezing in a few extra augs)
    const spendOnHomeRam = async () => {
        log(ns, 'Try Upgrade Home RAM...', false, 'info');
        pid = ns.run(getFilePath('Tasks/ram-manager.js'), 1, '--reserve', '0', '--budget', '0.8');
        await waitForProcessToComplete(ns, pid, true); // Wait for the script to shut down, indicating it has bought all it can.
    };
    if (options['prioritize-home-ram']) await spendOnHomeRam();

    // STEP 3: (SF13) STANEK'S GIFT
    // There is now an API to accept stanek's gift without resorting to exploits. We must do this before installing augs for the first time
    if (13 in dictSourceFiles && achievementActionAllowed(ns,"stanek")) {
        // By feature request: Auto-skip stanek in BN8 (requires a separate API check to get current BN)
        let isInBn8 = 8 === (await getNsDataThroughFile(ns, `ns.getResetInfo()`)).currentNode;

        if (options['skip-staneks-gift'])
            log(ns, 'INFO: --skip-staneks-gift was set, we will not accept it.');
        else if (isInBn8) {
            log(ns, 'INFO: Stanek\'s gift is useless in BN8, setting the --skip-staneks-gift argument automatically.');
            options['skip-staneks-gift'] = true;
        } else {
            log(ns, 'Accepting Stanek\'s Gift (if this is the first reset)...', false, 'info');
            const haveStanek = await getNsDataThroughFile(ns, `ns.stanek.acceptGift()`);
            if (haveStanek) log(ns, 'INFO: Confirmed that we have Stanek\'s Gift', false, 'info');
            else {
                log(ns, 'WARNING: It looks like we can\'t get Stanek\'s Gift. (Did you manually purchase some augmentations?)', true, 'warning');
                options['skip-staneks-gift'] = true; // Nothing we can do, no point in failing our augmentation install
            }
        }
    }

    // STEP 4: Buy as many desired augmentations as possible
    log(ns, 'Purchasing augmentations...', false, 'info');
    const facmanArgs = ['--purchase', '--log-only'];
    if (options['skip-staneks-gift']) {
        log(ns, 'INFO: Sending the --ignore-stanek argument to faction-manager.js')
        facmanArgs.push('--ignore-stanek');
    }
    const primaryPurchases=await prepareAugmentationPurchases(ns,{script:getFilePath('faction-manager.js'),args:facmanArgs,reset:beforeReset,phase:'primary'});
    if(!primaryPurchases.ok)return log(ns,'Installation deferred: '+primaryPurchases.reason,true,'warning');

    // If we are not slated to install any augmentations, ABORT
    // Get owned + purchased augmentations, then installed augmentations. Ensure there's a difference
    let purchasedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
    let installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
    let noAugsToInstall = purchasedAugmentations.length == installedAugmentations.length;
    if (noAugsToInstall && !options['allow-soft-reset'])
        return log(ns, `ERROR: See above faction-manager.js logs - there are no new purchased augs. ` +
            `Specify --allow-soft-reset to proceed without any purchased augs.`, true, 'error');

    // STEP 2 (If Deferred): Upgrade home RAM after purchasing augmentations if this option was set.
    if (!options['prioritize-home-ram']) await spendOnHomeRam();

    // STEP 5: Try to Buy 4S data / API if we haven't already and can afford it (although generally stockmaster.js would have bought these if it could)
    log(ns, 'Checking on Stock Market upgrades...', false, 'info');
    await getNsDataThroughFile(ns, 'ns.stock.purchaseWseAccount()');
    let hasStockApi = await getNsDataThroughFile(ns, 'ns.stock.purchaseTixApi()');
    if (hasStockApi && achievementActionAllowed(ns,"fourSigma")) {
        await getNsDataThroughFile(ns, 'ns.stock.purchase4SMarketData()');
        await getNsDataThroughFile(ns, 'ns.stock.purchase4SMarketDataTixApi()');
    }

    // STEP 6: (SF10) Buy whatever sleeve upgrades we can afford
    if (10 in dictSourceFiles) {
        log(ns, 'Try Upgrade Sleeves...', false, 'info');
        ns.run(getFilePath('sleeve.js'), 1, '--reserve', '0', '--aug-budget', '1', '--min-aug-batch', '1', '--buy-cooldown', '0', '--disable-training');
        await ns.sleep(500); // Give it time to make its initial purchases. Note that we do not block on the process shutting down - it will keep running.
    }

    // STEP 7: (SF2) Buy whatever gang equipment we can afford
    if (2 in dictSourceFiles) {
        log(ns, 'Try Upgrade Gangs...', false, 'info');
        ns.run(getFilePath('gangs.js'), 1, '--reserve', '0', '--augmentations-budget', '1', '--equipment-budget', '1');
        await ns.sleep(500); // Give it time to make its initial purchases. Note that we do not block on the process shutting down - it will keep running.
    }

    // STEP 8: Buy whatever home CPU upgrades we can afford
    log(ns, 'Try Upgrade Home Cores...', false, 'info');
    pid = await runCommand(ns, `while((${achievementActionAllowed.toString()})(ns,"homeCores")&&ns.singularity.upgradeHomeCores()) { await ns.sleep(10); }`, '/Temp/upgrade-home-ram.js');
    await waitForProcessToComplete(ns, pid, true); // Wait for the script to shut down, indicating it has bought all it can.

    // STEP 9: Join every faction we've been invited to (gives a little INT XP)
    await ensureFactionJoinPlan(ns);
    let invites = await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()');
    invites=rankFactionInvites(invites);
    if (invites.length > 0) {
        pid = await runCommand(ns, `ns.args.forEach(f => {if((${factionJoinAllowed.toString()})({joined:()=>ns.getPlayer().factions,read:path=>ns.read(path),reset:()=>ns.getResetInfo()},f))ns.singularity.joinFaction(f);})`, '/Temp/join-factions.js', invites);
        await waitForProcessToComplete(ns, pid, true);
    }

    // TODO: If in corporation, and buyback shares is available, buy as many as we can afford

    // STEP 10: WAIT: For money to stop decreasing, so we know that external scripts have bought what they could.
    log(ns, 'Waiting for purchasing to stop...', false, 'info');
    let money = 0, lastMoney = 0, ticksWithoutPurchases = 0;
    const maxWait = Date.now() + options['max-wait-time'];
    while (ticksWithoutPurchases < options['ticks-to-wait-for-additional-purchases'] && (Date.now() < maxWait)) {
        const start = Date.now(); // Used to wait for the game to tick.
        const refreshMoney = async () => money =
            await getNsDataThroughFile(ns, `ns.getServerMoneyAvailable(ns.args[0])`, null, ["home"]);
        while ((Date.now() - start <= 200) && lastMoney == await refreshMoney())
            await ns.sleep(10); // Wait for game to tick (money to change) - might happen sooner than 200ms
        ticksWithoutPurchases = money < lastMoney ? 0 : ticksWithoutPurchases + 1;
        lastMoney = money;
    }

    // STEP 4 REDUX: If somehow we have money left over and can afford some junk augs that weren't on our desired list, grab them too
    log(ns, 'Seeing if we can afford any other augmentations...', false, 'info');
    facmanArgs.push('--stat-desired', '_'); // Means buy any aug with any stats
    const leftoverPurchases=await prepareAugmentationPurchases(ns,{script:getFilePath('faction-manager.js'),args:facmanArgs,reset:beforeReset,phase:'leftover'});
    if(!leftoverPurchases.ok)return log(ns,'Installation deferred: '+leftoverPurchases.reason,true,'warning');

    // Clean up our temp folder - it's good to do this once in a while to reduce the save footprint
    // As well as to ensure that data written out on this bitnode don't confuse scripts in the next one.
    await waitForProcessToComplete(ns, ns.run(getFilePath('cleanup.js')), true);

    // FINALLY: If configured, soft reset
    if (options.reset || options['install-augmentations']) {
        await prepareResetBackup(ns,'augmentation reset');
        log(ns, '\nCatch you on the flippity-flip\n', true, 'success');
        await ns.sleep(1000); // Pause for effect?
        const resetScript = options['on-reset-script'] ??
            // Default script (if none is specified) is stanek.js if we have it (which in turn will spawn daemon.js when done)
            (purchasedAugmentations.includes(`Stanek's Gift - Genesis`) ? getFilePath('stanek.js') : getFilePath('daemon.js'));
        const committed=await getNsDataThroughFile(ns,`(() => {
            const r=ns.getResetInfo();
            if(!ns.isRunning(ns.args[5])||r.lastAugReset!==ns.args[2]||r.lastNodeReset!==ns.args[3])return {allowed:false,reason:"Reset changed during preparation"};
            const safety=(${augmentationInstallSafety.toString()})({getCurrentWork:()=>ns.singularity.getCurrentWork(),inBladeburner:()=>ns.bladeburner.inBladeburner(),getCurrentAction:()=>ns.bladeburner.getCurrentAction()},ns.args[1]);
            if(!safety.allowed)return safety;
            const queued=ns.singularity.getOwnedAugmentations(true).length>ns.singularity.getOwnedAugmentations(false).length;
            if(!queued&&!ns.args[4])return {allowed:false,reason:"No augmentations queued at commit"};
            const result=queued?ns.singularity.installAugmentations(ns.args[0]):ns.singularity.softReset(ns.args[0]);
            return {allowed:result!==false,reason:"Install returned without resetting"};
        })()`,'/Temp/ascend-install.txt',[resetScript,bladeburnerAccess,beforeReset.lastAugReset,beforeReset.lastNodeReset,options['allow-soft-reset'],ns.pid]);
        if(committed)log(ns,committed.reason||'Installation returned without resetting; resuming automation',true,'warning');
    } else
        log(ns, `SUCCESS: Ready to ascend. In the future, you can run with --reset (or --install-augmentations) ` +
            `to actually perform the reset automatically.`, true, 'success');
    } finally {
        endTransition(ns);
        if(shutdownStarted){
            try{resumeAugmentationAutomation(ns,previousAutomation,beforeReset);}
            catch(error){ns.print('Could not restore automation after installation preparation: '+String(error));}
        }
    }
}
