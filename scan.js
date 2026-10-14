import { getConfiguration, formatRam, formatMoney, formatNumber } from './helpers.js';
import { escapeScanHtml, discoverScanNetwork, scanRoutes, scanBackdoorEligible, submitScanRoute, scanTerminalInput } from './scan-policy.js';

const argsSchema = [['hide-stats', false]]; // Set true to hide RAM, money and security details.
export function autocomplete(data, _) { data.flags(argsSchema); return []; }

/** Interactive network map, with a text fallback when the terminal UI is hidden. */
export function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    const network = discoverScanNetwork(host=>ns.scan(host), 'home', (host,error)=>ns.print(`Could not scan ${host}: ${String(error)}`));
    const servers = new Map(), contracts = new Map();
    for (const host of network.hosts) {
        try { servers.set(host, ns.getServer(host)); } catch (error) { ns.print(`Could not read ${host}: ${String(error)}`); }
        try { contracts.set(host, ns.ls(host, '.cct')); } catch { contracts.set(host, []); }
    }
    const routes = scanRoutes(network, servers), hacking = ns.getHackingLevel();
    const showStats = !options['hide-stats'];
    const escape = escapeScanHtml;
    for (const children of network.children.values()) children.sort((a,b)=>
        network.height.get(a)-network.height.get(b) || network.neighbors.get(a).length-network.neighbors.get(b).length ||
        Number(!!servers.get(b)?.purchasedByPlayer)-Number(!!servers.get(a)?.purchasedByPlayer) || a.localeCompare(b));
    const factionServers = new Set(['CSEC','avmnite-02h','I.I.I.I','run4theh111z','w0r1d_d43m0n','fulcrumassets']);
    const rows=[];
    function visit(host,prefix='',last=true,root=false) {
        const server=servers.get(host), names=contracts.get(host)||[], branch=root?'':last?'└╴':'├╴';
        const backdoor=scanBackdoorEligible(host,server,hacking)&&routes.get(host);
        const skill=Number.isFinite(server?.requiredHackingSkill)?server.requiredHackingSkill:'?', canHack=typeof skill==='number'&&skill<=hacking;
        let stats='';
        if(showStats&&server) {
            const moneyMax=Number(server.moneyMax)||0, ram=Number(server.maxRam)||0;
            stats='Money: '+(moneyMax>0?formatMoney(Number(server.moneyAvailable)||0,4,1)+' / ':'')+formatMoney(moneyMax,4,1)+
                '  Sec: '+formatNumber(Number(server.hackDifficulty)||0,0,0)+'/'+formatNumber(Number(server.minDifficulty)||0,0,0)+
                '  RAM: '+formatRam(ram)+(ram>0?' ('+formatNumber((Number(server.ramUsed)||0)*100/ram,0,1)+'% used)':'');
        }
        const plain=prefix+branch+host+(!server?.purchasedByPlayer?' ('+skill+')':'')+(backdoor?' [backdoor]':'')+
            (names.length?' '+names.map(()=> '@').join(''):'')+(stats?'  '+stats:'');
        const classes='server'+(factionServers.has(host)?' faction':'')+(server?.hasAdminRights?' rooted':'');
        const label=routes.get(host)?`<a href="#" class="${classes}" data-host="${escape(host)}">${escape(host)}</a>`:escape(host);
        const html=escape(prefix+branch)+label+(!server?.purchasedByPlayer?` <span class="hack ${canHack?'green':'red'}">(${skill})</span>`:'')+
            (backdoor?` <a href="#" class="backdoor" data-host="${escape(host)}">[backdoor]</a>`:'')+
            (names.length?' '+names.map(name=>`<span class="cct" title="${escape(name)}">@</span>`).join(''):'')+
            (stats?` <span class="serverStats">${escape(stats)}</span>`:'');
        rows.push({plain,html});
        const children=network.children.get(host);
        for(let i=0;i<children.length;i++)visit(children[i],prefix+(root?'':last?'  ':'│ '),i===children.length-1);
    }
    visit(network.root,'',true,true);
    let doc;
    try { doc=eval('document'); } catch { }
    const terminal=doc?.getElementById('terminal');let input;try{input=doc&&scanTerminalInput(doc);}catch{}
    if(!terminal||!input) { ns.tprint(rows.map(row=>row.plain).join('\n')); return; }
    doc.getElementById('scanCSS')?.remove();
    const style=doc.createElement('style');style.id='scanCSS';
    style.textContent='.serverscan{white-space:pre;color:#ccc;font:14px consolas,monospace;line-height:18px}.serverscan a{cursor:pointer;text-decoration:underline}.serverscan .server{color:#080}.serverscan .faction,.serverscan .cct{color:#0ff}.serverscan .rooted,.serverscan .backdoor{color:#6f3}.serverscan .red{color:#f55}.serverscan .green{color:#6f3}.serverscan .serverStats{color:#8aa}';
    doc.head.appendChild(style);
    const entry=doc.createElement('li'), map=doc.createElement('div');map.className='serverscan';
    map.innerHTML=rows.map(row=>row.html).join('\n');entry.appendChild(map);terminal.appendChild(entry);
    let navigating=false;
    for(const link of map.querySelectorAll('a[data-host]'))link.addEventListener('click',async event=>{
        event.preventDefault();
        if(navigating)return;
        const route=routes.get(link.dataset.host);if(!route)return;
        navigating=true;
        try {
            await submitScanRoute(doc,route+(link.classList.contains('backdoor')?'; backdoor':''));
            map.querySelector('.scan-error')?.remove();
        } catch(error) {
            let message=map.querySelector('.scan-error');
            if(!message){message=doc.createElement('div');message.className='scan-error red';map.appendChild(message);}
            message.textContent=String(error);
        } finally { navigating=false; }
    });
}
