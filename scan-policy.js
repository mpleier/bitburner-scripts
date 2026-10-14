export function escapeScanHtml(value) {
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
export function scanConnectCommand(hostname) {
  return /^[a-zA-Z0-9_.:-]+$/.test(hostname)?(hostname==='home'?'home':'connect '+hostname):null;
}
/** Build a deterministic home-rooted spanning tree, scanning every reachable host once. */
export function discoverScanNetwork(scan,root='home',onError=()=>{}) {
  const hosts=[root],seen=new Set(hosts),parent=new Map([[root,null]]),neighbors=new Map(),children=new Map([[root,[]]]);
  for(let index=0;index<hosts.length;index++) {
    const host=hosts[index];let adjacent=[];
    try { adjacent=[...new Set(scan(host))].filter(name=>typeof name==='string'&&name.length>0); }
    catch(error) { onError(host,error); }
    neighbors.set(host,adjacent);
    for(const next of adjacent)if(!seen.has(next)) {
      seen.add(next);hosts.push(next);parent.set(next,host);children.set(next,[]);children.get(host).push(next);
    }
  }
  const height=new Map(hosts.map(host=>[host,0]));
  for(const host of [...hosts].reverse())if(parent.get(host)!==null)
    height.set(parent.get(host),Math.max(height.get(parent.get(host)),height.get(host)+1));
  return {root,hosts,parent,neighbors,children,height};
}
export function scanRoutes(network,servers) {
  const routes=new Map();
  for(const host of network.hosts) {
    const command=scanConnectCommand(host),up=network.parent.get(host);
    routes.set(host,!command?null:host===network.root?'home':servers.get(host)?.backdoorInstalled?command:
      routes.get(up)?routes.get(up)+'; '+command:null);
  }
  return routes;
}
export function scanBackdoorEligible(host,server,hacking) {
  return host!=='home'&&!host.startsWith('hacknet-')&&!host.startsWith('dark:')&&server?.hasAdminRights===true&&
    !server.purchasedByPlayer&&!server.backdoorInstalled&&Number.isFinite(server.requiredHackingSkill)&&server.requiredHackingSkill<=hacking;
}
export function scanReactProps(element,eventName) {
  if(!element||element.isConnected===false)throw new Error('The terminal input is no longer visible.');
  for(const key of Object.keys(element))if(key.startsWith('__reactProps$')&&typeof element[key]?.[eventName]==='function')return element[key];
  for(const key of Object.keys(element))if(key.startsWith('__reactFiber$')) {
    const fiber=element[key];if(fiber?.stateNode===element&&typeof fiber.memoizedProps?.[eventName]==='function')return fiber.memoizedProps;
  }
  throw new Error('The terminal has no current '+eventName+' handler.');
}
/** The terminal ID may belong to a Material UI wrapper rather than its input. */
export function scanTerminalInput(doc) {
 const node=doc.getElementById('terminal-input');
 const input=node?.querySelector?.('input, textarea')||node;
 if(!input||input.isConnected===false)throw new Error('The terminal input is no longer visible.');
 if(input.disabled||input.readOnly)throw new Error('The terminal is busy; wait for the current action to finish.');
 return input;
}
/** A map click may occur after scan.js exits. Use browser waits, not terminated NS calls. */
export async function submitScanRoute(doc,command,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  if(typeof command!=='string'||!command.trim())throw new Error('The route is empty.');
  let input=scanTerminalInput(doc);
  // Confirm both handlers are present before changing the user's terminal input.
  scanReactProps(input,'onKeyDown');
  const change=scanReactProps(input,'onChange');
  input.value=command;
  change.onChange({target:input,currentTarget:input});
  input.focus();
  // An unrelated render may replace the handler. Only submit our exact controlled value.
  for(let attempt=0;attempt<25;attempt++) {
    await wait(20);input=scanTerminalInput(doc);
    const props=scanReactProps(input,'onKeyDown');
    if(input.value!==command)throw new Error('Terminal input changed; the route was not submitted.');
    if(props.value===command) {
      await props.onKeyDown({key:'Enter',code:'Enter',keyCode:13,which:13,target:input,currentTarget:input,preventDefault(){},stopPropagation(){}});
      return true;
    }
  }
  throw new Error('Terminal state did not update; the route was not submitted.');
}
