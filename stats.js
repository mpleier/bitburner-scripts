import {overviewHackingPhase,overviewResetMatches,positionOverviewTooltip,overviewRoutePresentation,overviewCompletionHookNotice} from './overview-safety-policy.js';
import {bitNodeTooltip,renderBitNodeTooltip} from './bitnode-overview-policy.js';
import {readNodeRoutePlan} from './node-route-policy.js';
import {homeRamReserve} from './home-ram-policy.js';
import {runtimeScripts,registerAutomation,automationHeartbeat} from './runtime-policy.js';
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

let doc, hook0, hook1, hudGrid=null, hudTableRow=null;
let hudReadFailures=[];
let serverCache = null, serverCacheAt = 0;
let playerInBladeburner = false, nodeMap = {}
let progressCache=null, progressCacheAt=0, etaSamples=[], etaStatusAt=0;
let darknetHud=null, darknetHudAt=0;

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options || (await instanceCount(ns)) > 1) return; // Prevent multiple instances of this script from being started, even with different args.

    const dictSourceFiles = await getActiveSourceFiles(ns, false); // Find out what source files the user has unlocked
    let resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    disableLogs(ns, ['sleep','getServerMaxRam','getServerUsedRam']);

    // Globals need to reset at startup. Otherwise, they can survive e.g. flumes and new BNs and return stale results
    playerInBladeburner = false;
    nodeMap = {};
    serverCache = null;serverCacheAt = 0;
    progressCache=null; progressCacheAt=0; etaSamples=[]; etaStatusAt=0; hudReadFailures=[];
    darknetHud=null; darknetHudAt=0;
    registerAutomation(ns);
    try { doc = eval('document'); }
    catch { ns.tprint('Overview display needs the in-game interface.');return; }
    // Remove only rows owned by this script; stockmaster has its own overview elements.
    ns.atExit(cleanupHudElements);
    addCSS(doc);
    // A previous instance killed without running atExit leaves its rows and tooltip behind,
    // which used to stack a second HUD (and a stale, wrongly sized tooltip) on top of this one.
    try {
        if (typeof doc.querySelectorAll === 'function')
            for (const stale of doc.querySelectorAll('[data-bb-stats="true"],[data-bb-tooltip="true"]')) stale.remove();
    } catch {}

    // Main stats update loop
    while (true) {
        automationHeartbeat(ns);
        try {
            const nextHook0=doc.getElementById('overview-extra-hook-0'),nextHook1=doc.getElementById('overview-extra-hook-1');
            if(!nextHook0||!nextHook1){await ns.sleep(1000);continue;}
            const hudData = await getHudData(ns, bitNode, dictSourceFiles, options, resetInfo);
            if(hook0!==nextHook0||hook1!==nextHook1||!Object.values(nodeMap).length||Object.values(nodeMap).some(nodes=>!nodes[2].isConnected)) {
                cleanupHudElements();hook0=nextHook0;hook1=nextHook1;
            }
            // Optional rows can appear after startup as fresh manager data arrives.
            prepareHudElements(hudData);

            // update HUD elements with info collected above.
            for (const [header, show, formattedValue, toolTip] of hudData) {
                // Ensure values are never shown glued to the header by adding a non-breaking space to the left of each. 
                const paddedValue = formattedValue == null ? null : ' ' + formattedValue?.trim();
                updateHudElement(header, show, paddedValue, toolTip)
            }
            for(const nodes of Object.values(nodeMap))if(nodes[1].style.display==='block')positionOverviewTooltip(nodes[2],nodes[1],doc);
        } catch (err) {
            try{const stale=[['HUD Data',true,'Updating','Live readings are temporarily unavailable. Retrying; old values are hidden.']];prepareHudElements(stale);updateHudElement(...stale[0]);}catch{}
            // Might run out of ram from time to time, since we use it dynamically
            log(ns, `WARNING: stats.js Caught (and suppressed) an unexpected error in the main loop. Update Skipped:\n` +
                (typeof err === 'string' ? err : (err.stack || err.message || JSON.stringify(err)).slice(0,2048)), false, 'warning');
        }
        await ns.sleep(1000);
    }
}

/** Creates the new UI elements which we will be adding custom HUD data to. 
 * @param {HudRowConfig[]} hudData */
function prepareHudElements(hudData) {
    const tooltipWidth = (bitNode) => Math.max(220, Math.min(bitNode ? 680 : 360,
        ((doc.defaultView && doc.defaultView.innerWidth) || 1024) - 32));
    const sizeTooltip = (tooltip, bitNode) => {
        const width = tooltipWidth(bitNode);
        if (typeof tooltip.style?.setProperty === 'function') {
            tooltip.style.setProperty('width', width + 'px', 'important');
            tooltip.style.setProperty('min-width', width + 'px', 'important');
            tooltip.style.setProperty('max-width', width + 'px', 'important');
        } else { tooltip.style.width = width + 'px'; tooltip.style.minWidth = width + 'px'; tooltip.style.maxWidth = width + 'px'; }
    };
    const newline = (id, txt, toolTip = "") => {
        const p = doc.createElement("p");
        p.className = "bb-stats-row hidden";
        p.dataset.bbStats = 'true';
        const text = doc.createElement("span");
        text.textContent = txt;
        p.appendChild(text);
        const isBitNode = id.startsWith("BitNode-");
        // Own the tooltip from the start. Inside the HUD row the game's .tooltiptext rules and
        // the row's flex sizing could collapse it to a one-character column, so it lives on the
        // body and carries explicit pixel dimensions instead of inherited or max-content ones.
        const tooltip = doc.createElement("div");
        tooltip.className = "bb-stats-tooltip" + (isBitNode ? " bb-bitnode-tooltip" : "");
        tooltip.textContent = toolTip;
        tooltip.dataset.bbTooltip = 'true';
        tooltip.style.cssText = [
            'position: fixed', 'left: 0px', 'top: 0px', 'right: auto',
            'display: none', 'box-sizing: border-box', 'padding: 2px 10px',
            'text-align: left', 'white-space: pre-wrap', 'overflow-wrap: break-word', 'word-break: normal',
            'max-height: 65vh', 'overflow-y: auto',
            'background: #000', 'color: #00ff00', 'border-radius: 6px', 'z-index: 10002',
            'font-family: monospace', 'font-size: 14px', 'line-height: 1.4'
        ].join(';') + ';';
        tooltip.style.display = 'none';
        sizeTooltip(tooltip, isBitNode);
        (doc.body || doc.documentElement || doc.head)?.appendChild(tooltip);
        nodeMap[id] = [text, tooltip, p]
        return p;
    }

    if(!hudGrid){
        hudGrid=doc.createElement('div');hudGrid.className='bb-stats-grid';hudGrid.dataset.bbStats='true';
        const nativeRow=hook0.closest?.('tr');
        if(nativeRow){
            hudTableRow=doc.createElement('tr');hudTableRow.dataset.bbStats='true';
            const cell=doc.createElement('td');cell.colSpan=2;cell.appendChild(hudGrid);hudTableRow.appendChild(cell);
            nativeRow.insertAdjacentElement('afterend',hudTableRow);
        }else hook0.appendChild(hudGrid);
    }
    const currentRows = new Set();
    for (const [header, _, value, toolTip] of hudData) {
        const id = makeID(header);
        currentRows.add(id + '-title');
        currentRows.add(id + '-value');
        if (!nodeMap[id + '-title']){
            const item=doc.createElement('div');item.className='bb-stats-item';
            item.appendChild(newline(id+'-title',header,toolTip));
            item.appendChild(newline(id+'-value',value,toolTip));
            // One tooltip per row: the value element owns it, and the whole row shows it.
            const tip=nodeMap[id+'-value'][1];
            const showTip=()=>{ if(item.classList?.contains?.('hidden'))return;
                sizeTooltip(tip,tip.classList?.contains?.('bb-bitnode-tooltip')===true);
                tip.style.display='block';positionOverviewTooltip(item,tip,doc); };
            const hideTip=()=>{ tip.style.display='none'; };
            item.addEventListener?.('pointerenter',showTip);item.addEventListener?.('pointerleave',hideTip);
            item.addEventListener?.('focusin',showTip);item.addEventListener?.('focusout',hideTip);
            hudGrid.appendChild(item);
        }
    }
    // A disappearing optional row must not leave an old value visible.
    for (const [id, nodes] of Object.entries(nodeMap))
        if (!currentRows.has(id)){nodes[2].classList.add("hidden");nodes[1].style.display="none";}
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
    for(const nodes of Object.values(nodeMap))try{nodes[1].remove();nodes[2].remove();}catch{}
    if(hudTableRow)hudTableRow.remove();else if(hudGrid)hudGrid.remove();
    hudGrid=null;hudTableRow=null;nodeMap = {};
}

function updateHudElement(header, visible, value, toolTip) {
    const id = makeID(header),
        valId = id + "-value",
        titleId = id + "-title",
        maybeUpdate = (id, index, value) => {
            if(header==='BitNode'&&index===1){renderBitNodeTooltip(nodeMap[id][index],value,doc);return;}
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
        nodeMap[titleId][1].style.display='none';nodeMap[valId][1].style.display='none';
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
async function getHudData(ns, bitNode, dictSourceFiles, options, resetInfo) {
    hudReadFailures = []; // Report only reads that failed during this refresh, not historic ones.
    const hudData = (/**@returns {HudRowConfig[]}*/() => [])();

    const progress=await getOverviewProgress(ns,4 in dictSourceFiles||bitNode===4);
    let currentBB=null;
    if(!options['hide-automation'])hudData.push(...getAutomationHudData(ns,progress?.workType,progress?{lastNodeReset:progress.lastNodeReset,lastAugReset:progress.lastAugReset}:resetInfo));
    hudData.push(await getDarknetHudData(ns,resetInfo));

    // Show what bitNode we're currently playing in
    {
        const val = ["BitNode", true, `${bitNode}.${1 + (dictSourceFiles[bitNode] || 0)}`,
            bitNodeTooltip(bitNode,dictSourceFiles[bitNode]||0,progress?.nodeMultipliers)]
        hudData.push(val)
    }

    // Show how long the current BitNode has existed (time since the previous one was destroyed)
    {
        const lastNodeReset = Number(resetInfo.lastNodeReset)
        if (Number.isFinite(lastNodeReset) && lastNodeReset > 0) {
            hudData.push(["BN Age", true, formatDuration(Math.max(0, Date.now() - lastNodeReset)),
                "Time since the last BitNode was destroyed. This is the age of the current BitNode."])
        } else hudData.push(["BN Age", false])
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
            let stkPortfolio=0;try{stkPortfolio=await getStocksValue(ns);}catch{hudReadFailures.push('Stocks');}
            // Also, don't bother showing a section for stock if we aren't holding anything
            if (stkPortfolio > 0) val.push(true, formatMoney(stkPortfolio))
            else val.push(false)
        } else val.push(false)
        hudData.push(val)
    }

    // Show total instantaneous script income and experience per second (values provided directly by the game)
    const totalScriptInc = overviewIncomeRate(await optionalHudRead(ns, 'ns.getTotalScriptIncome()', '/Temp/overview-income.txt', [], null));
    const totalScriptExp = await optionalHudRead(ns, 'ns.getTotalScriptExpGain()', '/Temp/overview-exp.txt', [], null);
    hudData.push(["Scr Inc", totalScriptInc !== null, formatMoney(totalScriptInc ?? 0, 3, 2) + '/sec', "Total 'instantaneous' income per second being earned across all scripts running on all servers."]);
    hudData.push(["Scr Exp", Number.isFinite(totalScriptExp), formatNumberShort(totalScriptExp ?? 0, 3, 2) + '/sec', "Total 'instantaneous' hack experience per second being earned across all scripts running on all servers."]);

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
            const playerInfo = await optionalHudRead(ns,'ns.getPlayer()','/Temp/overview-player.txt',[],null);
            const numPeopleKilled = playerInfo?.numPeopleKilled??0;
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
            bb=await optionalHudRead(ns,"(() => {if(!ns.bladeburner.inBladeburner())return null;const action=ns.bladeburner.getCurrentAction();const ops=ns.bladeburner.getBlackOpNames().filter(n=>ns.bladeburner.getActionCountRemaining('Black Operations',n)>0);return {rank:ns.bladeburner.getRank(),points:ns.bladeburner.getSkillPoints(),action,stamina:ns.bladeburner.getStamina(),team:ns.bladeburner.getTeamSize(),assigned:action?ns.bladeburner.getTeamSize(action.type,action.name):0,remainingBlackOps:ops.length,blackOpTimeMs:ops.reduce((t,n)=>t+ns.bladeburner.getActionTime('Black Operations',n),0),rankGoal:ns.bladeburner.getBlackOpRank('Operation Daedalus')};})()",'/Temp/overview-bladeburner.txt',[],null);
        if(bb && (typeof bb!=='object'||!Number.isFinite(bb.rank)||!Number.isFinite(bb.points)))bb=null;
        currentBB=bb;
        playerInBladeburner=!!bb;
        if(bb) {
            val1.push(true,formatSixSigFigs(bb.rank),'Your current Bladeburner rank');
            val2.push(true,formatSixSigFigs(bb.points),'Your current unspent Bladeburner skill points');
        } else {val1.push(false);val2.push(false);}
        hudData.push(['BB Action',!!bb,bb?.action?.name||'Idle',bb?overviewStaminaText(bb.stamina):'']);
        let teamPlan=null;try{const saved=JSON.parse(ns.read('tasks/bladeburner-team.json'));if(saved?.at<=Date.now()+5000&&Date.now()-saved.at<120000&&ns.ps('home').some(p=>p.pid===saved.pid&&p.filename.replace(/^\//,'')==='bladeburner.js'))teamPlan=saved;}catch{}
        const teamDetails=teamPlan?'\n'+(teamPlan.reason||teamPlan.state)
            +(teamPlan.target?'\nNext Black Op: '+teamPlan.target:'')
            +(Number.isFinite(teamPlan.rankGap)?'\nRank still needed: '+formatSixSigFigs(teamPlan.rankGap):'')
            +(Number.isFinite(teamPlan.rankEtaMs)?'\nMeasured rank ETA: '+formatDuration(teamPlan.rankEtaMs):teamPlan.rankGap>0?'\nRank ETA: measuring progress':'')
            +(Number.isInteger(teamPlan.required)?'\nTarget team: '+teamPlan.required:'')
            +(Number.isInteger(teamPlan.teamCap)?'\nTeam cap: '+teamPlan.teamCap:'')
            +(Number.isFinite(teamPlan.baseline?.[0])?'\nSolo lower success estimate: '+(100*teamPlan.baseline[0]).toFixed(1)+'%':'')
            +(Number.isInteger(teamPlan.available)&&Number.isInteger(teamPlan.supportingSleeves)?'\nHuman recruits: '+Math.max(0,teamPlan.available-teamPlan.supportingSleeves)+'; supporting sleeves: '+teamPlan.supportingSleeves:'')
            +'\nHealthy support sleeves: '+(Number.isInteger(teamPlan.healthySleeves)?teamPlan.healthySleeves:'unavailable')
            +(Number.isFinite(teamPlan.expectedRecruitmentMs)?'\nExpected recruitment: '+formatDuration(teamPlan.expectedRecruitmentMs):'')
            +(Number.isFinite(teamPlan.budgetMinutes)&&Number.isFinite(teamPlan.spentMs)?'\nRecruitment budget: '+Math.max(0,teamPlan.budgetMinutes-teamPlan.spentMs/60000).toFixed(1)+' min left this hour':''):'';
        hudData.push(['BB Team',!!bb,bb?formatSixSigFigs(bb.team):'',bb?'Total team members: '+bb.team+'\nAssigned to '+(bb.action?.name||'current action')+': '+bb.assigned+teamDetails:'']);
        hudData.push(val1, val2);
    }

    // Show various server / RAM utilization stats
    {
        const val1 = ["Servers"]
        const val2 = ["Home RAM"]
        const val3 = ["All RAM"]
        if (!options['hide-RAM-utilization']) {
           try{
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
           }catch{hudReadFailures.push('Server/RAM');for(const row of [val1,val2,val3]){row.length=1;row.push(true,'Unavailable','Server and RAM readings are temporarily unavailable. Retrying.');}}
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
        const sharePower = await optionalHudRead(ns,'ns.getSharePower()','/Temp/overview-share.txt',[],1);
        // Bitburner bug: Trace amounts of share power sometimes left over after we stop sharing
        if (sharePower > 1.0001) {
            val.push(true, formatNumberShort(sharePower, 3, 2),
                "Uses RAM to boost faction reputation gain rate while working for factions (tapers off at ~1.65) " +
                "\nRun `daemon.js` with the `--no-share` flag to disable.");
        } else val.push(false)
        hudData.push(val)
    }

    const rates=sampleNodeEtaRates(etaSamples,progress?{at:progress.at,augReset:progress.lastAugReset,nodeReset:progress.lastNodeReset,exp:progress.hackingExp,rank:currentBB?.rank??null,hackMult:progress.hackMult}:null);
    etaSamples=rates.samples;
    let eta=estimateNodeCompletion({hasRedPill:progress?.hasRedPill,wdHack:progress?.wdHack,currentHack:progress?.hacking||0,currentExp:progress?.hackingExp||0,expRate:rates.xp,hackMult:progress?.hackMult||1,
      inBladeburner:!!currentBB,bladeburnerActive:!!currentBB?.action,remainingBlackOps:currentBB?.remainingBlackOps??null,bladeburnerRank:currentBB?.rank||0,rankRate:rates.rank,
      blackOpTimeMs:currentBB?.blackOpTimeMs,rankGoal:currentBB?.rankGoal,installedAugsCount:progress?.installedAugs||0});
    if(rates.sampling&&eta.etaMs===null&&!['Need Red Pill','BB paused'].includes(eta.text))eta.text='Sampling';
    const routePlan=readNodeRoutePlan(ns);
    if(routePlan) {
        const label=route=>route==='hacking'?'WD':'BB';
        const describe=(name,r)=>!r?name+': unavailable':name+': '+(r.reason||(r.actionable===false?'blocked':'available'));
        const presentation=overviewRoutePresentation(routePlan,formatDuration);
        const details=[presentation.note,routePlan.reason,routePlan.redPill?.reason||'',describe('WD',routePlan.routes?.hacking),describe('BB',routePlan.routes?.bladeburner),...(routePlan.assumptions||[])].join('\n');
        hudData.push(['Node Route',true,presentation.label,details]);
        const selected=routePlan.routes?.[routePlan.selected];
        if(presentation.probe)eta={text:label(routePlan.selected)+' probe',etaMs:null,tooltip:details};
        else if(presentation.confidence==='provisional')eta={text:label(routePlan.selected)+' provisional',etaMs:null,tooltip:details+'\nProvisional rate estimate only; required route evidence is still missing. This is not an actionable completion forecast.'};
        else if(presentation.confidence==='actionable')eta={text:selected.phase==='backdoor'?'Backdoor WD':label(routePlan.selected)+' ~'+formatDuration(selected.etaMs),etaMs:selected.etaMs,tooltip:details};
        else if(routePlan.selected) {
            // A selected route with unknown timing must show its own blocker, never the other route's state.
            let phase='waiting';
            if(routePlan.selected==='hacking') {
                phase=overviewHackingPhase(selected?.stages?.[0],routePlan.redPill?.stage,progress?.hasRedPill);
            }else if(selected?.next)phase='prepare BlackOps';
            eta={text:label(routePlan.selected)+': '+phase,etaMs:null,tooltip:details};
        }
    }
    if(Date.now()-etaStatusAt>=5000){etaStatusAt=Date.now();await ns.write('tasks/overview-status.json',JSON.stringify({at:etaStatusAt,pid:ns.pid,nodeEta:eta,routePlan,rates:{xp:rates.xp,rank:rates.rank,windowMs:rates.windowMs,sampling:rates.sampling},hasRedPill:progress?.hasRedPill,wdHack:progress?.wdHack}),'w');}
    const unavailable=[...new Set(hudReadFailures)];
    hudData.push(['HUD Data',unavailable.length>0,'Partial',unavailable.join(', ')+' readings unavailable. Other values are still updating.']);
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
    const serverNames = await getNsDataThroughFile(ns,'scanAllServers(ns)',null,[],false,1,0,true);
    serverCache=await getNsDataThroughFile(ns, 'ns.args.map(ns.getServer)', '/Temp/getServers.txt',serverNames,false,1,0,true);serverCacheAt=now;
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
    .bb-stats-grid { color:#00ff00;font-family:monospace;font-size:14px;line-height:1.4;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 18px;width:min(500px,calc(100vw - 48px)); }
    .bb-stats-item { display:flex;justify-content:space-between;align-items:baseline;gap:6px;min-width:0; }
    .bb-stats-item:has(.bb-stats-row.hidden) { display:none; }
    .bb-stats-item .bb-stats-row:first-child { color:inherit; }
    .bb-stats-item .bb-stats-row:last-child { text-align:right;overflow-wrap:anywhere;min-width:0; }
    .bb-stats-row  { margin: 0; position: relative; }
    .bb-stats-row.hidden { display: none; }
    /* The tooltip element is created on the body with explicit pixel dimensions by
       prepareHudElements; these rules are only a fallback if that styling is stripped. */
    .bb-stats-tooltip {
        display: none; position: fixed; z-index: 10002; box-sizing: border-box;
        padding: 2px 10px; text-align: left; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
        max-height: 65vh; overflow-y: auto; border-radius: 6px; border: ${rootStyle?.border || "inherit"};
        background-color: #000; color: #00ff00; font-family: monospace; font-size: 14px; line-height: 1.4;
    }
    .bb-tooltip-summary,.bb-tooltip-footer { display:block;white-space:pre-wrap; }
    .bb-tooltip-summary { margin-bottom:8px; }
    .bb-tooltip-footer { margin-top:8px; }
    .bb-tooltip-columns { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px;white-space:normal; }
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
export function estimateNodeCompletion({hasRedPill=false,wdHack=null,currentHack=0,currentExp=0,expRate=0,hackMult=1,
 completedHook=false,departureActive=false,inBladeburner=false,bladeburnerActive=true,remainingBlackOps=null,bladeburnerRank=0,rankRate=0,
 blackOpTimeMs=null,rankGoal=400000,installedAugsCount=0}={}) {
 if(completedHook||departureActive||inBladeburner&&remainingBlackOps===0)return {text:'Ready',etaMs:0,tooltip:'A verified BitNode completion route is ready.'};
 const routes=[];
 if(hasRedPill&&Number.isFinite(wdHack)&&wdHack>0){
  if(currentHack>=wdHack)return {text:'Backdoor WD',etaMs:0,tooltip:'Native daemon hacking requirement reached; backdoor it to complete the BitNode.'};
  const required=Math.exp((wdHack/Math.max(.0001,hackMult)+200)/32)-534.6;
  const etaMs=Math.max(0,required-currentExp)/expRate*1000;
  if(expRate>0&&Number.isFinite(etaMs))routes.push({text:etaMs>86400000?'Slow XP':'XP ~'+formatEta(etaMs),etaMs,route:'hacking',tooltip:'Straight-line hacking estimate: '+formatEta(etaMs)+'. Hacking route estimate at the current script XP rate. Excludes interruptions, future upgrades and backdoor time.'});
 }
 if(inBladeburner&&bladeburnerActive&&remainingBlackOps>0&&Number.isFinite(blackOpTimeMs)&&blackOpTimeMs>=0&&Number.isFinite(rankGoal)&&rankGoal>0){
  if(bladeburnerRank>=rankGoal||rankRate>0){
   const etaMs=Math.max(0,rankGoal-bladeburnerRank)/(rankRate||1)*1000+blackOpTimeMs;
   if(Number.isFinite(etaMs))routes.push({text:etaMs>86400000?'Slow BB':'BB ~'+formatEta(etaMs),etaMs,route:'bladeburner',tooltip:'Straight-line Bladeburner estimate: '+formatEta(etaMs)+'. Bladeburner route estimate from observed rank gain plus native remaining Black Op durations. Success chances, stamina and interruptions can extend it.'});
  }
 }
 if(routes.length)return routes.sort((a,b)=>a.etaMs-b.etaMs)[0];
 return {text:inBladeburner&&!bladeburnerActive?'BB paused':inBladeburner&&remainingBlackOps>0?'Need rank pace':hasRedPill?'Need XP pace':'Need Red Pill',etaMs:null,tooltip:(inBladeburner&&!bladeburnerActive?'Bladeburner is idle or paused; no completion time is projected from passive rank gains. ':'No reliable completion time yet. ')+installedAugsCount+' installed augmentations. Waiting for a native daemon target with XP income, or measured Bladeburner rank progress.'};
}

/** Observed XP/rank gains, reset on progression resets, stat multiplier changes or long observation gaps. */
export function sampleNodeEtaRates(history,sample){
 let samples=Array.isArray(history)?history:[];
 const empty={samples,xp:0,rank:0,windowMs:0,sampling:true};
 if(!sample||!Number.isFinite(sample.at)||!Number.isFinite(sample.exp)||sample.exp<0)return {...empty,samples:[]};
 const previous=samples.at(-1);
 if(previous&&(sample.augReset!==previous.augReset||sample.nodeReset!==previous.nodeReset||Math.abs(sample.hackMult/previous.hackMult-1)>.01||sample.exp<previous.exp||sample.at-previous.at>30000||sample.at<previous.at||Number.isFinite(sample.rank)&&Number.isFinite(previous.rank)&&sample.rank<previous.rank))samples=[];
 if(samples.at(-1)?.at!==sample.at)samples=[...samples,sample];
 samples=samples.filter(p=>p.at>=sample.at-300000);
 const first=samples[0],windowMs=sample.at-first.at;
 if(windowMs<60000||samples.length<3)return {...empty,samples,windowMs};
 const seconds=windowMs/1000,rankFirst=samples.find(p=>Number.isFinite(p.rank)),rankSeconds=rankFirst?(sample.at-rankFirst.at)/1000:0;
 const rank=rankSeconds>=60&&Number.isFinite(sample.rank)?Math.max(0,(sample.rank-rankFirst.rank)/rankSeconds):0;
 return {samples,xp:Math.max(0,(sample.exp-first.exp)/seconds),rank,windowMs,sampling:false};
}

async function getOverviewProgress(ns,canReadWork){
 const now=Date.now();if(progressCacheAt&&now-progressCacheAt<5000)return progressCache;
 const expression=`(() => {const p=ns.getPlayer(),r=ns.getResetInfo();const owned=r.ownedAugs;const names=typeof owned?.keys==='function'?[...owned.keys()]:Object.keys(owned||{});let wdHack=null;try{if(ns.serverExists('w0r1d_d43m0n'))wdHack=ns.getServerRequiredHackingLevel('w0r1d_d43m0n');}catch{}let nodeMultipliers=null,hackMult=p.mults.hacking;try{nodeMultipliers=ns.getBitNodeMultipliers();hackMult*=nodeMultipliers.HackingLevelMultiplier;}catch{const base=32*Math.log(p.exp.hacking+534.6)-200;if(base>0)hackMult=(p.skills.hacking+.5)/base;}let workType=null;if(ns.args[0])try{workType=ns.singularity.getCurrentWork()?.type||null;}catch{}return {nodeMultipliers,lastAugReset:r.lastAugReset,lastNodeReset:r.lastNodeReset,hasRedPill:names.includes('The Red Pill'),installedAugs:names.length,wdHack,hacking:p.skills.hacking,hackingExp:p.exp.hacking,hackMult,workType};})()`;
 progressCache=await optionalHudRead(ns,expression,'/Temp/overview-progress.txt',[canReadWork],null);if(progressCache)progressCache.at=now;progressCacheAt=now;return progressCache;
}

/** Dark Net progress is file-backed and changes slowly; refresh it separately. */
async function getDarknetHudData(ns,reset){
 const now=Date.now();
 if(typeof ns.ls!=='function'||typeof ns.ps!=='function')return ['Dark Web',false,'','Dark Web progress is unavailable in this interface.'];
 if(darknetHud&&darknetHud.nodeReset===reset.lastNodeReset&&darknetHud.augReset===reset.lastAugReset&&now-darknetHudAt<10000)return darknetHud.row;
 const manager=ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='darknet-manager.js');
 let summary=null;try{summary=JSON.parse(ns.read('tasks/dnet-cache-rewards-summary.json'));}catch{}
 const summaryFresh=summary?.nodeReset===reset.lastNodeReset&&summary?.augReset===reset.lastAugReset&&Number.isFinite(summary?.at)&&summary.at<=now&&now-summary.at<=90000;
 const hosts=new Set(),rooted=new Set(),labyrinths=new Map();
 let pending=0;
 for(const file of ns.ls('home','tasks/dnet-survey-')){
  if(!file.endsWith('.json'))continue;
  try{
   const report=JSON.parse(ns.read(file));
   if(!report?.host)continue;
   // Old survey files are historical, not current Dark Web progress.
   if(!Number.isFinite(report.at)||report.at>now+5000||now-report.at>600000)continue;
   hosts.add(report.host);
   if(report.rooted===true)rooted.add(report.host);
   pending+=Math.max(0,Number(report.caches)||0);
   if(report.modelId==='(The Labyrinth)')labyrinths.set(report.host,report.rooted===true||Number(report.caches)>0);
  }catch{}
 }
 let opened=0,cash=0;
 for(const file of ns.ls('home','tasks/dnet-cache-rewards-')){
  if(!file.endsWith('.json')||file.includes('summary'))continue;
  try{
   const receipt=JSON.parse(ns.read(file));
   if(receipt?.nodeReset!==reset.lastNodeReset||receipt?.augReset!==reset.lastAugReset)continue;
   opened+=Math.max(0,Number(receipt?.opened)||0);
   cash+=Math.max(0,Number(receipt?.totals?.money)||0);
  }catch{}
 }
 const seenOpened=summaryFresh&&summary?.seen&&typeof summary.seen==='object'?Object.keys(summary.seen).length:0;
 const liveHosts=Math.max(hosts.size,summaryFresh?Math.max(0,Number(summary?.coverage?.liveHosts)||0):0);
 const openedCaches=Math.max(opened,seenOpened);
 const totals=summaryFresh&&summary?.totals&&typeof summary.totals==='object'?summary.totals:{};
 const rewardParts=[];
 for(const [key,label] of [['shares','shares'],['programs','programs'],['stockAccess','stock access'],['dataFiles','data files'],['contracts','contracts'],['augmentations','augmentations'],['karma','karma'],['unknown','unknown']]){
  const value=Number(totals[key])||0;
  if(value>0)rewardParts.push(`${value} ${label}`);
 }
 let storm='';try{const result=JSON.parse(ns.read('tasks/dnet-storm-result.json'));storm=String(result?.reason||result?.status||'').slice(0,80);}catch{}
 let value;
 if(openedCaches&&pending)value=openedCaches+'c '+pending+'p';
 else if(openedCaches)value=openedCaches+' caches';
 else if(pending)value=pending+' pending';
 else if(liveHosts)value=rooted.size+'/'+liveHosts;
 else if(rewardParts.length)value=rewardParts[0];
 else value=manager?'scouting':'no data';
 const solved=[...labyrinths.values()].filter(Boolean).length;
 const tooltip=['Dark Web progress',
  'Live hosts: '+liveHosts,
  ...(hosts.size?['Surveyed hosts: '+hosts.size]:[]),
  'Rooted: '+rooted.size,
  'Pending caches: '+pending,
  'Caches opened: '+openedCaches,
  ...(cash?['Cache cash: '+formatMoney(cash,3,2)]:[]),
  ...(rewardParts.length?['Rewards: '+rewardParts.join(', ')]:[]),
  ...(labyrinths.size?['Labyrinths: '+solved+'/'+labyrinths.size+' solved']:[]),
  ...(summaryFresh?'Reward report age: '+formatDuration(now-summary.at):'Reward report: unavailable or stale'),
  ...(storm?['StormSeed: '+storm]:[]),
  ...(manager?'Manager:\u00a0running':'Manager:\u00a0not\u00a0running')].join('\n');
 const row=['Dark Web',manager||liveHosts>0||openedCaches>0||rewardParts.length>0,value,tooltip];
 darknetHud={nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,row};darknetHudAt=now;
 return row;
}


async function optionalHudRead(ns,expression,file,args,fallback) {
    try{
        const value=await getNsDataThroughFile(ns,expression,file,args,false,1,0,true);
        if(Array.isArray(fallback)&&(!Array.isArray(value)||fallback.some((_,i)=>!Number.isFinite(value[i]))))return fallback;
        return value ?? fallback;
    }catch{hudReadFailures.push(file?.includes('bladeburner')?'Bladeburner':file?.includes('progress')?'Progress':file?.includes('share')?'Share power':file?.includes('income')?'Script income':'Optional data');return fallback;}
}

/** Read local manager records only while their owner is alive and the record is fresh. */
function getAutomationHudData(ns,workType=null,reset=null) {
    const now=Date.now(),processes=ns.ps('home'),active=processes.filter(p=>runtimeScripts.includes(p.filename.replace(/^\//,'')));
    const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
    const live=(file,script)=>{const record=read(file),owner=record?.pid??record?.ownerPid;return owner&&processes.some(p=>p.pid===owner&&p.filename.replace(/^\//,'')===script)&&Number.isFinite(record.at)&&record.at>0&&record.at<=now+5000&&now-record.at<120000&&overviewResetMatches(record,reset)?record:null;};
    const detail=active.map(p=>p.filename.replace(/\.js$/,'')).join('\n')||'No automation managers are running.';
    const lock=read('tasks/activity-lock.json'),priority=lock?.expiresAt>now&&processes.some(p=>p.pid===lock.ownerPid)?lock.kind:(workType==='GRAFTING'?'Grafting':workType==='CREATE_PROGRAM'?'Creating program':null);
    const maintenance=read('tasks/automation-maintenance.json');
    const maintenanceActive=maintenance?.expiresAt>now&&processes.some(p=>p.pid===maintenance.ownerPid);
    const corp=live('tasks/corporation-status.json','corporation-manager.js'),sleeves=live('tasks/sleeve-status.json','sleeve.js'),go=live('tasks/go-status.json','go.js');
    const rows=[['Automation',true,active.length+' active',detail],
        ['Priority',true,maintenanceActive?'Updating':priority||'Normal',maintenanceActive?'Applying pending automation updates':priority?'Current activity owner: '+priority:'No exclusive activity owns the player.']];
    const targetPlan=live('tasks/hacking-target-plan.json','daemon.js');
    const planFresh=targetPlan&&now-targetPlan.at<15000&&targetPlan.incomeMode!=='inactive';
    rows.push(['Hack Plan',!!planFresh,targetPlan?.preferred||'Waiting',targetPlan?.reason||'Waiting for native target quotes']);
    rows.push(['Hack Proj',!!planFresh&&Number.isFinite(targetPlan?.projectedRate),formatMoney(targetPlan?.projectedRate??0)+'/sec','Model estimate for '+(targetPlan?.preferred||'?')+' under current RAM and pacing. Excludes runtime stalls and fragmentation.']);
    const measured=targetPlan?.income;
    rows.push(['Hack Real',!!planFresh,measured?.state==='measured'&&Number.isFinite(measured.observedRate)?formatMoney(measured.observedRate)+'/sec':'Sampling',measured?'Gross hack receipts over '+Math.round(measured.seconds||0)+' seconds, '+(measured.receipts||0)+' hack completions. Includes idle gaps and timing losses; different interval from the current model.':'Waiting for receipts']);
    const corpRunning=active.some(p=>p.filename.replace(/^\//,'')==='corporation-manager.js');
    const profit=corp&&Number.isFinite(corp.revenue)&&Number.isFinite(corp.expenses)?corp.revenue-corp.expenses:null;
    rows.push(['Corp Profit',corpRunning,profit===null?'Waiting':formatMoney(profit)+'/sec',corp?'Funds '+(Number.isFinite(corp.funds)?formatMoney(corp.funds):'?')+' · Reserve '+(Number.isFinite(corp.reserve)?formatMoney(corp.reserve):'?')+'\n'+corp.mode+' · '+(corp.divisions?.length??0)+' divisions':'Waiting for fresh corporation data.']);
    rows.push(['Corp Pay',corpRunning,Number.isFinite(corp?.estimatedDividendIncome)?formatMoney(corp.estimatedDividendIncome)+'/sec':'Waiting','Player dividend income after ownership and tribute. Share sales are one-off payments.\n'+(corp?.liquidityDecision?.reason||'Waiting for payout data.')]);
    const sleeveList=Array.isArray(sleeves?.sleeves)?sleeves.sleeves:[];
    rows.push(['Sleeves',active.some(p=>p.filename.replace(/^\//,'')==='sleeve.js'),sleeves?sleeveList.length+' managed':'Waiting',sleeveList.map(s=>'#'+s.index+' '+(s.task||'Idle')+' · Shock '+Number(s.shock).toFixed(1)+' · Sync '+Number(s.sync).toFixed(1)+'%').join('\n')||'Waiting for fresh sleeve data.']);
    rows.push(['IPvGO',active.some(p=>p.filename.replace(/^\//,'')==='go.js'),go?go.state==='recovering'?'Recovering':'Turn '+(go.turn??0):'Waiting',go?(go.opponent||go.selected?.name||'Selecting opponent')+' · '+(go.boardSize||'?')+'×'+(go.boardSize||'?')+(go.error?'\n'+go.error:''):'Waiting for fresh IPvGO data.']);
    const alerts=[];
    const completionHold=overviewCompletionHookNotice(read('tasks/bitnode-completion-hook.json'),reset,processes);
    if(completionHold)alerts.push(completionHold);
    if(corp?.mode==='cash recovery')alerts.push('Corporation is recovering cash');
    if(go?.state==='recovering')alerts.push('IPvGO: '+(go.error||'recovering'));
    if(sleeves?.state==='recovering')alerts.push('Sleeves: '+(sleeves.error||'recovering'));
    const paused=runtimeScripts.filter(script=>ns.read('remote-control/paused/'+script+'.txt').trim()==='true');
    if(paused.length)alerts.push('Paused: '+paused.join(', '));
    rows.push(['Attention',alerts.length>0,alerts.length+' notice'+(alerts.length===1?'':'s'),alerts.join('\n')]);
    return rows;
}

/** Native reads may be unavailable during RAM pressure or a controller reload. */
export function overviewIncomeRate(value) {
    const rate=Array.isArray(value)?value[0]:value;
    return Number.isFinite(rate)?rate:null;
}
export function overviewStaminaText(value) {
    if(!Array.isArray(value)||!Number.isFinite(value[0])||!Number.isFinite(value[1])||value[0]<0||value[1]<=0)
        return 'Stamina unavailable';
    return 'Stamina '+(100*Math.min(1,value[0]/value[1])).toFixed(1)+'%';
}
