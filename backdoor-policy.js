/** Faction unlocks precede optional backdoors; ties favor lower hacking requirements. */
import {factionBackdoorServers} from './backdoor-unlock-policy.js';
export function rankBackdoorTargets(targets,requirements={}) {
 const rank=host=>{const i=factionBackdoorServers.indexOf(host);return i<0?factionBackdoorServers.length:i;};
 return [...targets].sort((a,b)=>rank(a)-rank(b)||(requirements[a]??Infinity)-(requirements[b]??Infinity)||a.localeCompare(b));
}
export function backdoorHeadroom(maximum,configured=null,globalReserve=0) {
 if(!Number.isFinite(maximum)||maximum<=0)return 0;
 const reserve=configured==null?Math.min(22,maximum*.25):Number(configured);
 if(!Number.isFinite(reserve)||reserve<0)return maximum;
 return Math.min(maximum,Math.max(reserve,Number.isFinite(globalReserve)?Math.max(0,globalReserve):0));
}
export function backdoorCanLaunch({maximum,free,worker},configured=null,globalReserve=0) {
 return Number.isFinite(free)&&Number.isFinite(worker)&&worker>0&&free>=worker+backdoorHeadroom(maximum,configured,globalReserve);
}

/** Serialized into one small scan worker; each reachable host is scanned once. */
export function discoverBackdoorNetwork(ns) {
 const servers=['home'],routes={home:['home']},seen=new Set(servers),errors=[];
 for(let i=0;i<servers.length;i++){
  const host=servers[i];let adjacent=[];
  try{adjacent=ns.scan(host);}catch(error){errors.push({host,error:String(error)});}
  for(const next of adjacent)if(typeof next==='string'&&next&&!seen.has(next)){
   seen.add(next);servers.push(next);routes[next]=[...routes[host],next];
  }
 }
 return {servers,routes,errors};
}
/** A start receipt proves installBackdoor has been invoked on the checked server. */
export async function waitForBackdoorStart(ns,{pid,target,token,path,timeout=5000,poll=10},allowed,now=()=>Date.now()) {
 const deadline=now()+timeout;
 while(true){
  let state;
  if(!allowed())state='cancelled';
  else{
   let record;try{record=JSON.parse(ns.read(path));}catch{}
   if(record?.pid===pid&&record.target===target&&record.token===token){
    if(record.state==='started')return {state:'started'};
    if(record.state==='failed')state='failed';
   }
   if(!state&&!ns.isRunning(pid))state='exited';
   if(!state&&now()>=deadline)state='timeout';
  }
  if(state){if(ns.isRunning(pid))ns.kill(pid);return {state};}
  await ns.sleep(Math.max(5,Math.min(50,poll||10)));
 }
}

/** One metadata worker, one server read per host; failed hosts are isolated. */
export function collectBackdoorMetadata(ns,hosts) {
 const byHost=Object.create(null),errors=[],hacking=ns.getHackingLevel();
 for(const host of new Set(hosts))try{
  const server=ns.getServer(host);
  if(!Number.isFinite(server.requiredHackingSkill))throw Error('Missing hacking requirement');
  byHost[host]={requiredHackingSkill:server.requiredHackingSkill,hasAdminRights:server.hasAdminRights===true,
   backdoorInstalled:server.backdoorInstalled===true,purchasedByPlayer:server.purchasedByPlayer===true};
 }catch(error){errors.push({host,error:String(error)});}
 return {byHost,hacking,errors};
}
/** Start at the deepest installed backdoor on each known route. Keep originals for retries. */
export function shortcutBackdoorRoutes(routes,metadata) {
 return Object.fromEntries(Object.entries(routes).map(([host,route])=>{
  let shortcut=0;
  for(let i=1;i<route.length;i++)if(metadata[route[i]]?.backdoorInstalled===true)shortcut=i;
  return [host,shortcut?['home',...route.slice(shortcut)]:[...route]];
 }));
}
