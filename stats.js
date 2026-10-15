import {homeRamReserve} from './home-ram-policy.js';
import {runtimeScripts} from './runtime-policy.js';
import {
    log, disableLogs, instanceCount, getConfiguration, getNsDataThroughFile, getActiveSourceFiles,
    getStocksValue, formatNumberShort, formatMoney, formatRam, formatDuration, getFilePath
} from './helpers.js'

const argsSchema = [
    ['hide-automation', false], // Hide manager, priority, corporation, sleeve and IPvGO summaries.
    ['show-peoplekilled', false],
    ['hide-stocks', false],
    ['hide-RAM-utilization', false],
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

let doc, hook0, hook1;
let serverCache = null, serverCacheAt = 0;
let playerInBladeburner = false, nodeMap = {}
let lastBbRank = 0, lastBbRankAt = 0, bbRankRate = 0;

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options || (await instanceCount(ns)) > 1) return; // Prevent multiple instances of this script from being started, even with different args.

    const dictSourceFiles = await getActiveSourceFiles(ns, false); // Find out what source files the user has unlocked
    let resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    disableLogs(ns, ['sleep']);

    // Globals need to reset at startup. Otherwise, they can survive e.g. flumes and new BNs and return stale results
    playerInBladeburner = false;
    nodeMap = {};
    serverCache = null;serverCacheAt = 0;
    lastBbRank = 0; lastBbRankAt = 0; bbRankRate = 0;
    try { doc = eval('document'); }
    catch { ns.tprint('Overview display needs the in-game interface.');return; }
    // Remove only rows owned by this script; stockmaster has its own overview elements.
    ns.atExit(cleanupHudElements);
    addCSS(doc);

    // Main stats update loop
    while (true) {
        try {
            const nextHook0=doc.getElementById('overview-extra-hook-0'),nextHook1=doc.getElementById('overview-extra-hook-1');
            if(!nextHook0||!nextHook1){await ns.sleep(1000);continue;}
            const hudData = await getHudData(ns, bitNode, dictSourceFiles, options, resetInfo);
            if(hook0!==nextHook0||hook1!==nextHook1||!Object.values(nodeMap).length||Object.values(nodeMap).some(nodes=>!nodes[2].isConnected)) {
                cleanupHudElements();hook0=nextHook0;hook1=nextHook1;prepareHudElements(hudData);
            }

            // update HUD elements with info collected above.
            for (const [header, show, formattedValue, toolTip] of hudData) {
                // Ensure values are never shown glued to the header by adding a non-breaking space to the left of each. 
                const paddedValue = formattedValue == null ? null : ' ' + formattedValue?.trim();
                updateHudElement(header, show, paddedValue, toolTip)
            }
        } catch (err) {
            // Might run out of ram from time to time, since we use it dynamically
            log(ns, `WARNING: stats.js Caught (and suppressed) an unexpected error in the main loop. Update Skipped:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(1000);
    }
}

/** Creates the new UI elements which we will be adding custom HUD data to. 
 * @param {HudRowConfig[]} hudData */
function prepareHudElements(hudData) {
    const newline = (id, txt, toolTip = "") => {
        const p = doc.createElement("p");
        p.className = "bb-stats-row hidden";
        p.dataset.bbStats = 'true';
        const text = doc.createElement("span");
        text.textContent = txt;
        p.appendChild(text);
        const tooltip = doc.createElement("span");
        p.appendChild(tooltip);
        tooltip.textContent = toolTip;
        tooltip.className = "tooltiptext";
        nodeMap[id] = [text, tooltip, p]
        return p;
    }

    for (const [header, _, value, toolTip] of hudData) {
        const id = makeID(header)
        if(nodeMap[id+'-title'])continue;
        hook0.appendChild(newline(id + "-title", header.padEnd(9, " "), toolTip))
        hook1.appendChild(newline(id + "-value", value, toolTip))
    }
}

function makeID(header) {
    return String(header||'empty-header').replace(/\s/g,'')
}

/** Creates the new UI elements which we will be adding custom HUD data to.
 * @param {string} header - The stat name which appears in the first column of the custom HUD row
 * @param {boolean} visible - Indicates whether the current HUD row should be displayed (true) or hidden (false)
 * @param {string} value - The value to display in the second column of the custom HUD row
 * @param {string} toolTip - The tooltip to display if the user hovers over this HUD row with their cursor. */
function cleanupHudElements() {
    for(const nodes of Object.values(nodeMap))try{nodes[2].remove();}catch{}
    nodeMap = {};
}

function updateHudElement(header, visible, value, toolTip) {
    const id = makeID(header),
        valId = id + "-value",
        titleId = id + "-title",
        maybeUpdate = (id, index, value) => {
            if (nodeMap[id][index].textContent != value)
                nodeMap[id][index].textContent = value
        }

    if (visible) {
        maybeUpdate(valId, 0, value)
        maybeUpdate(valId, 1, toolTip)
        maybeUpdate(titleId, 1, toolTip)
        nodeMap[titleId][2].classList.remove("hidden")
        nodeMap[valId][2].classList.remove("hidden")
        const warning=header==='Attention'||header==='Automation'&&String(value).trim()==='0 active'||header==='Corp Profit'&&String(value).includes('-');
        nodeMap[valId][2].style.color=warning?'#ffb74d':'';
    } else {
        nodeMap[titleId][2].classList.add("hidden")
        nodeMap[valId][2].classList.add("hidden")
    }
}

/** @param {NS} ns
 * @param {number} bitNode the current bitnode the user is in
 * @param {{[k: number]: number}} dictSourceFiles The source files the user has unlocked so far
 * @param {(string | boolean)[][]} options The run configuration of this script.
 * @typedef {string} header - The stat name which appears in the first column of the custom HUD row
 * @typedef {boolean} show - Indicates whether the current HUD row should be displayed (true) or hidden (false)
 * @typedef {string} formattedValue - The value to display in the second column of the custom HUD row
 * @typedef {string} toolTip - The tooltip to display if the user hovers over this HUD row with their cursor.
 * @typedef {[header, show, formattedValue, toolTip]} HudRowConfig The configuration for a custom row displayed in the HUD
 * @returns {Promise<HudRowConfig[]>} **/
async function getHudData(ns, bitNode, dictSourceFiles, options) {
    const hudData = (/**@returns {HudRowConfig[]}*/() => [])();

    if(!options['hide-automation'])hudData.push(...getAutomationHudData(ns));

    // Show what bitNode we're currently playing in
    {
        const val = ["BitNode", true, `${bitNode}.${1 + (dictSourceFiles[bitNode] || 0)}`,
            `Detected as being one more than your current owned SF level (${dictSourceFiles[bitNode] || 0}) in the current bitnode (${bitNode}).`]
        hudData.push(val)
    }

    // Show Hashes
    {
        const val1 = ["Hashes"];
        const val2 = [" "]; // Blank line placeholder for when hashes are being liquidated
        if (9 in dictSourceFiles || 9 == bitNode) { // Section not relevant if you don't have access to hacknet servers
            const hashes = await optionalHudRead(ns, '[ns.hacknet.numHashes(), ns.hacknet.hashCapacity()]', '/Temp/hash-stats.txt', [], [0,0])
            if (hashes[1] > 0) {
                val1.push(true, `${formatNumberShort(hashes[0], 3, 1)}/${formatNumberShort(hashes[1], 3, 1)}`,
                    `Current Hashes ${hashes[0].toLocaleString('en')} / Current Hash Capacity ${hashes[1].toLocaleString('en')}`)
                // Detect and notify the HUD if any scripts are liquidating hashes (selling them as quickly as possible)
                const spendHashesScript = getFilePath('spend-hacknet-hashes.js');
                const liquidatingHashes = await (/**@returns{Promise<ProcessInfo[]>}*/async () =>
                    await getNsDataThroughFile(ns,
                        `ns.ps('home').filter(p => p.filename == ns.args[0] && (p.args.includes('--liquidate') || p.args.includes('-l')))`,
                        '/Temp/hash-liquidation-scripts.txt', [spendHashesScript])
                )();
                if (liquidatingHashes.length > 0)
                    val2.push(true, "Liquidating", `You have ${liquidatingHashes.length} script` +
                        (liquidatingHashes.length > 1 ? 's running that are' : ' running that is') +
                        ' selling hashes as quickly as possible:\n' +
                        liquidatingHashes.map(s => `${s.filename} ${s.args.join(' ')} (PID: ${s.pid})`).join('\n',));
            }
        }
        if (val1.length < 2) val1.push(false);
        if (val2.length < 2) val2.push(false);
        hudData.push(val1, val2)
    }

    {
        const val = ["Stock"]
        // Show Stocks (only if stockmaster.js isn't already doing the same)
        if (!options['hide-stocks'] && !doc.getElementById("stock-display-1")) {
            let stkPortfolio=0;try{stkPortfolio=await getStocksValue(ns);}catch{}
            // Also, don't bother showing a section for stock if we aren't holding anything
            if (stkPortfolio > 0) val.push(true, formatMoney(stkPortfolio))
            else val.push(false)
        } else val.push(false)
        hudData.push(val)
    }

    // Show total instantaneous script income and experience per second (values provided directly by the game)
    const totalScriptInc = await getNsDataThroughFile(ns, 'ns.getTotalScriptIncome()');
    const totalScriptExp = await getNsDataThroughFile(ns, 'ns.getTotalScriptExpGain()');
    hudData.push(["Scr Inc", true, formatMoney(totalScriptInc[0], 3, 2) + '/sec', "Total 'instantaneous' income per second being earned across all scripts running on all servers."]);
    hudData.push(["Scr Exp", true, formatNumberShort(totalScriptExp, 3, 2) + '/sec', "Total 'instantaneous' hack experience per second being earned across all scripts running on all servers."]);

    // Show reserved money
    {
        const val = ["Reserve"]
        const reserve = Number(ns.read("reserve.txt") || 0);
        if (reserve > 0) {
            val.push(true, formatNumberShort(reserve, 3, 2), "Most scripts will leave this much money unspent. Remove with `run reserve.js 0`");
        } else val.push(false)
        hudData.push(val)
    }

    // needed for gang and karma
    let gangInfo=false;
    if(2 in dictSourceFiles||bitNode===2)try{gangInfo=await getGangInfo(ns);}catch{}

    // Show gang income and territory
    {
        const val1 = ["Gang Inc"]
        const val2 = ["Territory"]
        // Gang income is only relevant once gangs are unlocked
        if ((2 in dictSourceFiles || 2 == bitNode) && gangInfo) {
            // Add Gang Income
            val1.push(true, formatMoney(gangInfo.moneyGainRate * 5, 3, 2) + '/sec',
                `Gang (${gangInfo.faction}) income per second while doing tasks.` +
                `\nIncome: ${formatMoney(gangInfo.moneyGainRate * 5)}/sec (${formatMoney(gangInfo.moneyGainRate)}/tick)` +
                `  Respect: ${formatNumberShort(gangInfo.respect)} (${formatNumberShort(gangInfo.respectGainRate)}/tick)` +
                `\nNote: If you see 0, your gang may all be temporarily set to training or territory warfare.`);
            // Add Gang Territory
            val2.push(true, formatNumberShort(gangInfo.territory * 100, 4, 2) + "%",
                `How your gang is currently doing in territory warfare. Starts at 14.29%\n` +
                `Gang: ${gangInfo.faction} ${gangInfo.isHacking ? "(Hacking)" : "(Combat)"}  ` +
                `Power: ${gangInfo.power.toLocaleString('en')}  Clash ${gangInfo.territoryWarfareEngaged ? "enabled" : "disabled"} ` +
                `(${(gangInfo.territoryClashChance * 100).toFixed(0)}% chance)`);
        } else {
            val1.push(false)
            val2.push(false)
        }
        hudData.push(val1, val2)
    }

    // Show Karma if we're not in a gang yet
    {
        const val = ["Karma"]
        const karma = ns.heart.break();
        // Don't spoiler Karma if they haven't started doing crime yet
        if (karma <= -9
            // If in a gang, you know you have oodles of bad Karma. Save some space
            && !gangInfo) {
            let karmaShown = formatNumberShort(karma, 3, 2);
            if (2 in dictSourceFiles && 2 != bitNode && !gangInfo) karmaShown += '/54k'; // Display karma needed to unlock gangs ouside of BN2
            val.push(true, karmaShown, "After Completing BN2, you need -54,000 Karma in other BNs to start a gang. You also need a tiny amount to join some factions. The most is -90 for 'The Syndicate'");
        } else val.push(false)
        hudData.push(val)
    }

    // Show number of kills if explicitly enabled
    {
        const val = ["Kills"]
        if (options['show-peoplekilled']) {
            const playerInfo = await getNsDataThroughFile(ns, 'ns.getPlayer()');
            const numPeopleKilled = playerInfo.numPeopleKilled;
            val.push(true, formatSixSigFigs(numPeopleKilled), "Count of successful Homicides. Note: The most kills you need is 30 for 'Speakers for the Dead'");
        } else val.push(false)
        hudData.push(val)
    }

    // Show Bladeburner Rank and Skill Points
    {
        const val1 = ["BB Rank"]
        const val2 = ["BB SP"]
        // Both SF6 and SF7 grant access. Keep unavailable APIs from blocking other rows.
        let bb=null;
        if (6 in dictSourceFiles||7 in dictSourceFiles||bitNode===6||bitNode===7)
            bb=await optionalHudRead(ns,'(() => {if(!ns.bladeburner.inBladeburner())return null;const action=ns.bladeburner.getCurrentAction();return {rank:ns.bladeburner.getRank(),points:ns.bladeburner.getSkillPoints(),action,stamina:ns.bladeburner.getStamina(),team:ns.bladeburner.getTeamSize(),assigned:action?ns.bladeburner.getTeamSize(action.type,action.name):0};})()','/Temp/overview-bladeburner.txt',[],null);
        playerInBladeburner=!!bb;
        if(bb) {
            val1.push(true,formatSixSigFigs(bb.rank),'Your current Bladeburner rank');
            val2.push(true,formatSixSigFigs(bb.points),'Your current unspent Bladeburner skill points');
        } else {val1.push(false);val2.push(false);}
        hudData.push(['BB Action',!!bb,bb?.action?.name||'Idle',bb?'Stamina '+(100*bb.stamina[0]/Math.max(1,bb.stamina[1])).toFixed(1)+'%':'']);
        let teamPlan=null;try{const saved=JSON.parse(ns.read('tasks/bladeburner-team.json'));if(saved?.at<=Date.now()+5000&&Date.now()-saved.at<120000&&ns.ps('home').some(p=>p.pid===saved.pid&&p.filename.replace(/^\//,'')==='bladeburner.js'))teamPlan=saved;}catch{}
        const teamDetails=teamPlan?'\n'+(teamPlan.reason||teamPlan.state)+(teamPlan.required!==undefined?'\nTarget team: '+teamPlan.required:'')+'\nRecruitment budget: '+Math.max(0,teamPlan.budgetMinutes-teamPlan.spentMs/60000).toFixed(1)+' min left this hour':'';
        hudData.push(['BB Team',!!bb,bb?formatSixSigFigs(bb.team):'',bb?'Total team members: '+bb.team+'\nAssigned to '+(bb.action?.name||'current action')+': '+bb.assigned+teamDetails:'']);
        hudData.push(val1, val2)
    }

    // Show various server / RAM utilization stats
    {
        const val1 = ["Servers"]
        const val2 = ["Home RAM"]
        const val3 = ["All RAM"]
        if (!options['hide-RAM-utilization']) {
            const servers = await getAllServersInfo(ns);
            const hnServers = servers.filter(s => s.hostname.startsWith("hacknet-server-") || s.hostname.startsWith("hacknet-node-"));
            const nRooted = servers.filter(s => s.hasAdminRights).length;
            const nPurchased = servers.filter(s => s.hostname != "home" && s.purchasedByPlayer).length; // "home" counts as purchased by the game
            // Add Server count.
            val1.push(true, `${servers.length}/${nRooted}/${nPurchased}`, `The number of servers on the network (${servers.length}) / ` +
                `number rooted (${nRooted}) / number purchased ` + (hnServers.length > 0 ?
                    `(${nPurchased - hnServers.length} servers + ${hnServers.length} hacknet servers)` : `(${nPurchased})`));
            const home = servers.find(s => s.hostname == "home");
            // Add Home RAM and Utilization
            val2.push(true, `${formatRam(home.maxRam)} ${(100 * home.ramUsed / home.maxRam).toFixed(1)}%`,
                `Shows total home RAM (and current utilization %)\nDetails: ${home.cpuCores} cores and using ` +
                `${formatRam(home.ramUsed, true)} of ${formatRam(home.maxRam, true)} (${formatRam(home.maxRam - home.ramUsed, true)} free)`);
            // If the user has any scripts running on hacknet servers, assume they want them included in the main "total available RAM" stat
            const includeHacknet = hnServers.some(s => s.ramUsed > 0);
            const fileredServers = servers.filter(s => s.hasAdminRights && !hnServers.includes(s));
            const [sMax, sUsed] = fileredServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [hMax, hUsed] = hnServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [tMax, tUsed] = [sMax + hMax, sUsed + hUsed];
            let statText = includeHacknet ?
                `${formatRam(tMax)} ${(100 * tUsed / tMax).toFixed(1)}%` :
                `${formatRam(sMax)} ${(100 * sUsed / sMax).toFixed(1)}%`;
            let toolTip = `Shows the sum-total RAM and utilization across all rooted hosts on the network` + (9 in dictSourceFiles || 9 == bitNode ?
                (includeHacknet ? "\n(including hacknet servers, because you have scripts running on them)" : " (excluding hacknet servers)") : "") +
                `\nUsing ${formatRam(tUsed, true)} of ${formatRam(tMax, true)} (${formatRam(tMax - tUsed, true)} free) across all servers`;
            if (hMax > 0) toolTip +=
                `\nUsing ${formatRam(sUsed, true)} of ${formatRam(sMax, true)} (${formatRam(sMax - sUsed, true)} free) excluding  hacknet` +
                `\nUsing ${formatRam(hUsed, true)} of ${formatRam(hMax, true)} (${formatRam(hMax - hUsed, true)} free) of hacknet servers`;
            hudData.push(['RAM Hold',true,formatRam(homeRamReserve(ns)),'Home RAM kept available for automation and temporary helpers. Override upward with home-ram-reserve.txt (GB).']);
            // Add Total Network RAM and Utilization
            val3.push(true, statText, toolTip);
        } else {
            val1.push(false)
            val2.push(false)
            val3.push(false)
        }
        hudData.push(val1, val2, val3)
    }

    // Show current share power
    {
        const val = ["Share Pwr"]
        const sharePower = await getNsDataThroughFile(ns, 'ns.getSharePower()');
        // Bitburner bug: Trace amounts of share power sometimes left over after we stop sharing
        if (sharePower > 1.0001) {
            val.push(true, formatNumberShort(sharePower, 3, 2),
                "Uses RAM to boost faction reputation gain rate while working for factions (tapers off at ~1.65) " +
                "\nRun `daemon.js` with the `--no-share` flag to disable.");
        } else val.push(false)
        hudData.push(val)
    }

    return hudData
}

/** @param {number} value
 *  @returns {string} The number formatted as a string with up to 6 significant digits, but no more than the specified number of decimal places. */
function formatSixSigFigs(value, minDecimalPlaces = 0, maxDecimalPlaces = 0) {
    return value >= 1E7 ? formatNumberShort(value, 6, 3) :
        value.toLocaleString(undefined, { minimumFractionDigits: minDecimalPlaces, maximumFractionDigits: maxDecimalPlaces });
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} Gang information, if we're in a gang, or False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false', '/Temp/gang-stats.txt')
}

/** @param {NS} ns
 * @returns {Promise<Server[]>} **/
async function getAllServersInfo(ns) {
    const now=Date.now();
    if(serverCache&&now-serverCacheAt<5000)return serverCache;
    const serverNames = await getNsDataThroughFile(ns, 'scanAllServers(ns)');
    serverCache=await getNsDataThroughFile(ns, 'ns.args.map(ns.getServer)', '/Temp/getServers.txt', serverNames);serverCacheAt=now;
    return serverCache;
}

/** Inject the CSS that controls how custom HUD elements are displayed. */
function addCSS(doc) {
    let priorCss = doc.getElementById("statsCSS");
    if (priorCss) priorCss.parentNode.removeChild(priorCss); // Remove old CSS to facilitate tweaking css above
    // Hopefully this logic remains valid for detecting which element is the HUD draggable window
    const hudParent = doc.getElementsByClassName(`MuiCollapse-root`)[0]?.parentElement;
    if (hudParent) hudParent.style.zIndex = 1E4; // Tail windows start around 1500, this should keep the HUD above them
    doc.head.insertAdjacentHTML('beforeend', css(hudParent ? eval('window').getComputedStyle(hudParent) : null));
}
const css = (rootStyle) => `<style id="statsCSS">
    .MuiTooltip-popper { z-index: 10001 } /* Sadly, not parented by its owners, so must be updated with MuiCollapse-root's parent */
    .bb-stats-row  { margin: 0; position: relative; }
    .bb-stats-row.hidden { display: none; }
    .bb-stats-row:hover .tooltiptext { visibility: visible; opacity: 0.85; }
    .bb-stats-row .tooltiptext {
        visibility: hidden; position: absolute; z-index: 1;
        right: 20px; top: 19px; padding: 2px 10px;
        text-align: left; white-space: pre-wrap; width: max-content; max-width: min(460px, 75vw); overflow-wrap: anywhere;
        border-radius: 6px; border: ${rootStyle?.border || "inherit"};
        background-color: ${rootStyle?.backgroundColor || "#900C"};
    }
</style>`;

/** Formats milliseconds into a compact human-readable duration for the HUD.
 * @param {number} ms
 * @returns {string} */
export function formatEta(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'Unknown';
    if (ms === 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/** Estimates the remaining time to complete the current BitNode across completion phases.
 * @param {object} options
 * @returns {{text: string, etaMs: number|null, tooltip: string}} */
export function estimateNodeCompletion({
    bitNode = 1,
    elapsedMs = 0,
    hasRedPill = false,
    wdHack = null,
    currentHack = 0,
    currentExp = 0,
    expRate = 0,
    hackMult = 1,
    daemonRooted = false,
    completedHook = false,
    departureActive = false,
    inBladeburner = false,
    remainingBlackOps = null,
    bladeburnerRank = 0,
    rankRate = 0,
    installedAugsCount = 0,
    readyAugsCount = 0,
    targetAugsCount = 31,
} = {}) {
    const fmtDuration = typeof formatDuration === 'function' ? formatDuration : (ms => Math.round(ms / 1000) + 's');
    const fmtShort = typeof formatNumberShort === 'function' ? formatNumberShort : ((n, min, max) => Number(n).toLocaleString('en', { maximumFractionDigits: max || 1 }));

    // Phase 1: Victory / Ready to Depart
    if (completedHook || departureActive || (daemonRooted && Number.isFinite(wdHack) && wdHack > 0 && currentHack >= wdHack) || (inBladeburner && remainingBlackOps === 0)) {
        return {
            text: 'Ready',
            etaMs: 0,
            tooltip: 'BitNode victory achieved! Ready to destroy BitNode or depart.'
        };
    }

    // Phase 2: w0r1d_d43m0n Backdoor Ready
    const targetHack = Number.isFinite(wdHack) && wdHack > 0 ? wdHack : 3000;
    if ((hasRedPill || (Number.isFinite(wdHack) && wdHack > 0)) && currentHack >= targetHack) {
        return {
            text: 'Backdoor WD',
            etaMs: 0,
            tooltip: `Target hacking level reached (${currentHack}/${targetHack}). Backdoor w0r1d_d43m0n to finish the BitNode.`
        };
    }

    // Phase 3: Hacking w0r1d_d43m0n
    let hackingEstimate = null;
    if (hasRedPill || (Number.isFinite(wdHack) && wdHack > 0)) {
        const safeMult = Math.max(0.0001, hackMult || 1);
        // Formula: skill = Math.floor(mult * (32 * Math.log(exp + 534.6) - 200))
        // Inverted: exp = Math.exp((skill / mult + 200) / 32) - 534.6
        const expRequired = Math.exp((targetHack / safeMult + 200) / 32) - 534.6;
        const expNeeded = Math.max(0, expRequired - (currentExp || 0));
        if (expRate > 0) {
            const etaMs = Math.round((expNeeded / expRate) * 1000);
            hackingEstimate = {
                text: formatEta(etaMs),
                etaMs,
                tooltip: `Hacking w0r1d_d43m0n: ${currentHack}/${targetHack} hack (${fmtShort(expNeeded, 3, 2)} exp needed at ${fmtShort(expRate, 3, 2)} exp/s)`
            };
        } else {
            hackingEstimate = {
                text: 'Need Exp',
                etaMs: null,
                tooltip: `Hacking w0r1d_d43m0n: ${currentHack}/${targetHack} hack (${fmtShort(expNeeded, 3, 2)} exp needed, no active script exp)`
            };
        }
    }

    // Phase 4: Bladeburner Route
    let bladeburnerEstimate = null;
    if (inBladeburner && remainingBlackOps !== null && remainingBlackOps > 0) {
        let rankEtaMs = 0;
        if (bladeburnerRank < 400000 && rankRate > 0) {
            rankEtaMs = Math.max(0, Math.round(((400000 - bladeburnerRank) / rankRate) * 1000));
        }
        const opsEtaMs = remainingBlackOps * 600000;
        const etaMs = Math.max(rankEtaMs, opsEtaMs);
        bladeburnerEstimate = {
            text: formatEta(etaMs),
            etaMs,
            tooltip: `Bladeburner: ${remainingBlackOps} Black Ops remaining (~${formatEta(etaMs)}). Rank: ${fmtShort(bladeburnerRank, 3, 1)}/400k${rankRate > 0 ? ` (+${fmtShort(rankRate, 3, 1)}/s)` : ''}`
        };
    }

    if (hackingEstimate && bladeburnerEstimate) {
        if (Number.isFinite(hackingEstimate.etaMs) && Number.isFinite(bladeburnerEstimate.etaMs)) {
            return hackingEstimate.etaMs <= bladeburnerEstimate.etaMs ? hackingEstimate : bladeburnerEstimate;
        }
        return Number.isFinite(hackingEstimate.etaMs) ? hackingEstimate : bladeburnerEstimate;
    }
    if (hackingEstimate) return hackingEstimate;
    if (bladeburnerEstimate && ([6, 7].includes(bitNode) || remainingBlackOps <= 3)) {
        return bladeburnerEstimate;
    }

    // Phase 5: Augmentation Accumulation Phase (working toward Daedalus & TRP)
    const targetAugs = targetAugsCount || 31;
    const effectiveAugs = (installedAugsCount || 0) + (readyAugsCount || 0);
    if (effectiveAugs >= targetAugs) {
        return {
            text: '~1h',
            etaMs: 3600000,
            tooltip: `Target augmentations reached (${effectiveAugs}/${targetAugs}). Working to join Daedalus and obtain The Red Pill.`
        };
    }
    if (elapsedMs >= 120000 && effectiveAugs > 0) {
        const msPerAug = elapsedMs / effectiveAugs;
        const remainingAugs = targetAugs - effectiveAugs;
        const totalEstimatedMs = Math.round(remainingAugs * msPerAug + 3600000);
        return {
            text: formatEta(totalEstimatedMs),
            etaMs: totalEstimatedMs,
            tooltip: `Pacing: ${effectiveAugs}/${targetAugs} augs in ${fmtDuration(elapsedMs)} (~${fmtDuration(Math.round(msPerAug))}/aug). Est. remaining: ${formatEta(totalEstimatedMs)} (includes ~1h Daedalus/WD buffer).`
        };
    }
    return {
        text: 'Pacing...',
        etaMs: null,
        tooltip: `Gathering progression pace (${effectiveAugs}/${targetAugs} augs, ${fmtDuration(elapsedMs)} elapsed).`
    };
}


async function optionalHudRead(ns,expression,file,args,fallback) {
    try{return await getNsDataThroughFile(ns,expression,file,args);}catch{return fallback;}
}

/** Read local manager records only while their owner is alive and the record is fresh. */
function getAutomationHudData(ns) {
    const now=Date.now(),processes=ns.ps('home'),active=processes.filter(p=>runtimeScripts.includes(p.filename.replace(/^\//,'')));
    const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
    const live=(file,script)=>{const record=read(file),owner=record?.pid??record?.ownerPid;return owner&&processes.some(p=>p.pid===owner&&p.filename.replace(/^\//,'')===script)&&Number.isFinite(record.at)&&record.at>0&&record.at<=now+5000&&now-record.at<120000?record:null;};
    const detail=active.map(p=>p.filename.replace(/\.js$/,'')).join('\n')||'No automation managers are running.';
    const lock=read('tasks/activity-lock.json'),priority=lock?.expiresAt>now&&processes.some(p=>p.pid===lock.ownerPid)?lock.kind:null;
    const maintenance=read('tasks/automation-maintenance.json');
    const maintenanceActive=maintenance?.expiresAt>now&&processes.some(p=>p.pid===maintenance.ownerPid);
    const corp=live('tasks/corporation-status.json','corporation-manager.js'),sleeves=live('tasks/sleeve-status.json','sleeve.js'),go=live('tasks/go-status.json','go.js');
    const rows=[['Automation',true,active.length+' active',detail],
        ['Priority',true,maintenanceActive?'Updating':priority||'Normal',maintenanceActive?'Applying pending automation updates':priority?'Current activity owner: '+priority:'No exclusive activity owns the player.']];
    const corpRunning=active.some(p=>p.filename.replace(/^\//,'')==='corporation-manager.js');
    const profit=corp&&Number.isFinite(corp.revenue)&&Number.isFinite(corp.expenses)?corp.revenue-corp.expenses:null;
    rows.push(['Corp Profit',corpRunning,profit===null?'Waiting':formatMoney(profit)+'/sec',corp?'Funds '+(Number.isFinite(corp.funds)?formatMoney(corp.funds):'?')+' · Reserve '+(Number.isFinite(corp.reserve)?formatMoney(corp.reserve):'?')+'\n'+corp.mode+' · '+(corp.divisions?.length??0)+' divisions':'Waiting for fresh corporation data.']);
    const sleeveList=Array.isArray(sleeves?.sleeves)?sleeves.sleeves:[];
    rows.push(['Sleeves',active.some(p=>p.filename.replace(/^\//,'')==='sleeve.js'),sleeves?sleeveList.length+' managed':'Waiting',sleeveList.map(s=>'#'+s.index+' '+(s.task||'Idle')+' · Shock '+Number(s.shock).toFixed(1)+' · Sync '+Number(s.sync).toFixed(1)+'%').join('\n')||'Waiting for fresh sleeve data.']);
    rows.push(['IPvGO',active.some(p=>p.filename.replace(/^\//,'')==='go.js'),go?go.state==='recovering'?'Recovering':'Turn '+(go.turn??0):'Waiting',go?(go.opponent||go.selected?.name||'Selecting opponent')+' · '+(go.boardSize||'?')+'×'+(go.boardSize||'?')+(go.error?'\n'+go.error:''):'Waiting for fresh IPvGO data.']);
    const alerts=[];
    if(corp?.mode==='cash recovery')alerts.push('Corporation is recovering cash');
    if(go?.state==='recovering')alerts.push('IPvGO: '+(go.error||'recovering'));
    if(sleeves?.state==='recovering')alerts.push('Sleeves: '+(sleeves.error||'recovering'));
    const paused=runtimeScripts.filter(script=>ns.read('remote-control/paused/'+script+'.txt').trim()==='true');
    if(paused.length)alerts.push('Paused: '+paused.join(', '));
    rows.push(['Attention',alerts.length>0,alerts.length+' notice'+(alerts.length===1?'':'s'),alerts.join('\n')]);
    return rows;
}
