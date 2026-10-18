import { getNsDataThroughFile, getFilePath, getConfiguration, instanceCount, log, getErrorInfo } from '../helpers.js'
import {rankBackdoorTargets,backdoorCanLaunch,discoverBackdoorNetwork,waitForBackdoorStart,collectBackdoorMetadata,shortcutBackdoorRoutes} from '../backdoor-policy.js';
import {isScriptPaused} from '../automation-control.js';
import {maintenanceRequested} from '../runtime-policy.js';
import { activityBusy } from '../activity-coordination.js';

const argsSchema = [
    ['spawn-delay', 10], // Confirmation polling interval; no fixed delay is assumed sufficient.
    ['start-timeout', 5000], // Bound how long a worker may take to confirm installation has started.
    ['reserved-home-ram', null], // Default: 25% of home RAM capped at 22 GB; worker RAM is additional.
];

/** Return only network servers that support player backdoors. */
export function getBackdoorCandidates(servers, purchasedServers = []) {
    const purchased = new Set(purchasedServers);
    return servers.filter(server => server !== "home" &&
        !purchased.has(server) && !server.startsWith("pserv-") &&
        !server.startsWith("hacknet-") && !server.includes("daemon"));
}

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** Scan all servers, backdoor anything that can be backdoored, and leave a file to indicate it's been done
 * Requires: SF-4.1 **/
/** @param {NS} ns **/
export async function main(ns) {
    if (activityBusy(ns)||isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns)) return;
    let notAtHome = false;
    try {
        const options = getConfiguration(ns, argsSchema);
        if(!options)return;
        if(!Number.isFinite(options['start-timeout'])||options['start-timeout']<=0||options['start-timeout']>60000||!Number.isFinite(options['spawn-delay'])||options['spawn-delay']<0||
            options['reserved-home-ram']!=null&&(!Number.isFinite(options['reserved-home-ram'])||options['reserved-home-ram']<0))
            return ns.print('Backdoor: delays and explicit RAM reservations must be finite and nonnegative.');

        // Prevent multiple instances of this script from being started
        if (await instanceCount(ns, "home", false, false) > 1)
            return log(ns, 'Another instance is already running. Shutting down...');

        const spawnDelay = options['spawn-delay'];

        const network=await getNsDataThroughFile(ns,`(${discoverBackdoorNetwork.toString()})(ns)`,'/Temp/backdoor-network.txt');
        const {servers,routes}=network;
        for(const error of network.errors||[])ns.print('Backdoor scan skipped '+error.host+': '+error.error);
        // Network discovery and routes were collected by one scan worker.

        // Filter out servers that cannot or should not be hacked / backdoored
        // Backdoors can only be installed on faction/company servers, not servers
        // owned by the player (including purchased servers and hacknet servers).
        const purchasedServers = await getNsDataThroughFile(ns, 'ns.cloud.getServerNames()');
        const hackableServers = getBackdoorCandidates(servers, purchasedServers);

        const snapshot=await getNsDataThroughFile(ns,`(${collectBackdoorMetadata.toString()})(ns,ns.args)`,'/Temp/backdoor-metadata.txt',hackableServers);
        const myHackingLevel=snapshot.hacking,metadata=snapshot.byHost;
        for(const error of snapshot.errors||[])ns.print('Backdoor metadata skipped '+error.host+': '+error.error);
        const dictRequiredHackingLevels=Object.fromEntries(hackableServers.map(host=>[host,metadata[host]?.requiredHackingSkill??Infinity]));
        const dictRootAccess=Object.fromEntries(hackableServers.map(host=>[host,metadata[host]?.hasAdminRights===true]));
        const shortcuts=shortcutBackdoorRoutes(routes,metadata);

        ns.print(`${hackableServers.length} not-owned servers on the network.`);
        ns.print(`${hackableServers.filter(s => dictRootAccess[s]).length} servers are currently rooted.`);
        ns.print(`${hackableServers.filter(s => myHackingLevel >= dictRequiredHackingLevels[s]).length} servers are within our hack level (${myHackingLevel}).`);
        ns.print(`${hackableServers.filter(s => myHackingLevel >= dictRequiredHackingLevels[s] && dictRootAccess[s]).length} rooted servers are within our hack level (${myHackingLevel})`);

        // Get the set of servers that do not yet have a backdoor installed
        let toBackdoor = hackableServers.filter(host=>metadata[host]&&!metadata[host].purchasedByPlayer&&!metadata[host].backdoorInstalled);
        let count = toBackdoor.length;
        // Early exit condition if there are no servers left to backdoor
        ns.print(`${count} servers have yet to be backdoored.`);
        if (count == 0) return;

        // Early exit condition if there are no servers we can currently backdoor
        ns.print(`${toBackdoor.filter(s => dictRootAccess[s]).length} of ${count} servers to backdoor are currently rooted.`);
        toBackdoor = toBackdoor.filter(s => myHackingLevel >= dictRequiredHackingLevels[s]);
        ns.print(`${toBackdoor.length} of ${count} servers to backdoor are within our hack level (${myHackingLevel}).`);
        toBackdoor = toBackdoor.filter(s => dictRootAccess[s]);
        ns.print(`${toBackdoor.length} of ${count} servers to be backdoored are rooted and within our hack level (${myHackingLevel})`);
        if (toBackdoor.length == 0) return;

        // Faction invitations come before optional server shortcuts.
        toBackdoor = rankBackdoorTargets(toBackdoor,dictRequiredHackingLevels);
        ns.print(`Servers will be backdoored in the following order:\n` + toBackdoor.join(', '));

        // Collect information about any servers still being backdoored (from a prior run), so we can skip them
        let scriptPath = getFilePath('/Tasks/backdoor-all-servers.js.backdoor-one.js');
        let serversBeingBackdoored = await getNsDataThroughFile(ns,
            'ns.ps().filter(script => script.filename == ns.args[0]).map(script => script.args[0])',
            '/Temp/servers-being-backdoored.txt', [scriptPath]);

        let sequence=0;
        for (const server of toBackdoor) {
            if(activityBusy(ns)||isScriptPaused(ns,ns.getScriptName())||maintenanceRequested(ns))return;
            if (serversBeingBackdoored.includes(server)) {
                log(ns, `INFO: Server already beeing backdoored: ${server}`);
                continue;
            }

            // If we're running low on home ram, don't spawn any more backdoor scripts
            const ram = await getNsDataThroughFile(ns,
                '({maximum:ns.getServerMaxRam(ns.args[0]),free:ns.getServerMaxRam(ns.args[0])-ns.getServerUsedRam(ns.args[0]),worker:ns.getScriptRam(ns.args[1],ns.args[0])})',
                '/Temp/getBackdoorRam.txt', ['home',scriptPath]);
            if (!backdoorCanLaunch(ram,options['reserved-home-ram'],Number(ns.read('home-ram-reserve.txt'))||0))
                return log(ns, `WARNING: Home is low on RAM, will skip backdooring remaining servers.`);

            ns.print(`Hopping to ${server}`);
            notAtHome = true; // Set a flag to get us back home if we encounter an error
            let success = await getNsDataThroughFile(ns,
                'ns.args.reduce((success, hop) => success && ns.singularity.connect(hop), true)',
                '/Temp/singularity-connect-hop-to-server.txt', shortcuts[server]);
            if(!success&&shortcuts[server].length<routes[server].length){
                ns.print('Backdoor shortcut unavailable; retrying the scanned route to '+server);
                success=await getNsDataThroughFile(ns,
                    'ns.args.reduce((success, hop) => success && ns.singularity.connect(hop), true)',
                    '/Temp/singularity-connect-hop-to-server.txt',routes[server]);
            }
            if (!success){
                log(ns, `WARN: Failed to hop to server ${server}; skipping its backdoor.`, false, 'warning');
                continue;
            }
            if (server === "w0r1d_d43m0n") {
                ns.alert("Ready to hack w0r1d_d43m0n!");
                log(ns, "INFO: Sleeping forever to avoid multiple instances navigating to w0r1d_d43m0n.");
                while (true) await ns.sleep(10000); // Sleep forever so the script isn't run multiple times to create multiple overlapping alerts
            }
            ns.print(`Installing backdoor on "${server}"...`);
            // Kick off a separate script that will run backdoor before we connect to home.
            const receipt='/Temp/backdoor-start-'+ns.pid+'-'+(++sequence)+'.json',token=ns.pid+':'+sequence+':'+Date.now();
            const pid = ns.run(scriptPath, { temporary: true }, server,receipt,token,ns.pid);
            if (pid === 0)
                return log(ns, `WARN: Couldn't initiate a new backdoor of "${server}" (insufficient RAM?). Will try again later.`, false, 'warning');
            let confirmation;
            try{confirmation=await waitForBackdoorStart(ns,{pid,target:server,token,path:receipt,timeout:options['start-timeout'],poll:spawnDelay},
                ()=>!activityBusy(ns)&&!isScriptPaused(ns,ns.getScriptName())&&!maintenanceRequested(ns));}
            finally{ns.rm(receipt,'home');}
            if(confirmation.state!=='started')return log(ns,'WARN: Backdoor '+server+' did not confirm startup ('+confirmation.state+'); retrying later.',false,'warning');
            const backAtHome = await getNsDataThroughFile(ns, 'ns.singularity.connect(ns.args[0])', null, ["home"]);
            if (backAtHome)
                notAtHome = false;
        }
    }
    catch (err) {
        log(ns, `ERROR: ${ns.getScriptName()} Caught an unexpected error:\n${getErrorInfo(err)}`, false, 'error');
    } finally {
        // Try to clean-up by re-connecting to home before we shut down
        if (notAtHome)try{
            await getNsDataThroughFile(ns, 'ns.singularity.connect(ns.args[0])', null, ["home"]);
        }catch(error){ns.print('Backdoor cleanup could not reconnect home: '+String(error));}
    }
};
