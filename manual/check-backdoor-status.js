import {getNsDataThroughFile, scanAllServers} from './helpers.js';

/** Check if all servers are backdoored
 * @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('ALL');
    
    // Get list of all servers
    const allServers = scanAllServers(ns);
    
    // Filter out special servers that shouldn't be backdoored
    const usableServers = allServers.filter(server => 
        server !== 'home' && 
        !server.startsWith('pserv-') && 
        !server.startsWith('hacknet-') &&
        !server.includes('daemon')
    );
    
    ns.print(`Total usable servers: ${usableServers.length}`);
    
    let backdooredCount = 0;
    let notBackdoored = [];
    
    for (const server of usableServers) {
        try {
            const serverInfo = await getNsDataThroughFile(ns, `ns.getServer(ns.args[0])`, null, [server]);
            if (serverInfo.backdoorInstalled) {
                backdooredCount++;
            } else {
                notBackdoored.push(server);
            }
        } catch (error) {
            ns.print(`Error checking ${server}: ${String(error)}`);
        }
    }
    
    ns.print(`${backdooredCount} servers are backdoored`);
    ns.print(`${usableServers.length - backdooredCount} servers are not backdoored`);
    
    if (notBackdoored.length > 0) {
        ns.print('Not backdoored servers:');
        for (const server of notBackdoored) {
            ns.print(`  ${server}`);
        }
    } else {
        ns.print('All servers are backdoored!');
    }
}

export function autocomplete(data, args) {
    return [];
}
