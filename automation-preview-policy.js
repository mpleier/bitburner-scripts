import {moduleManifest,priorityManagerPlan} from './automation-manifest.js';
import {homeRamHeadroom} from './home-ram-policy.js';

/** Honor a saved inspection mode before autopilot can register or persist configuration. */
export function previewRequested(ns){
 if((ns.args||[]).some(a=>a==='--dry-run'||a==='--preview'))return true;
 let saved;try{saved=JSON.parse(ns.read('autopilot.js.config.txt'));if(Array.isArray(saved))saved=Object.fromEntries(saved);}catch{return false;}
 return [saved?.['dry-run'],saved?.preview].some(v=>v===true||v==='true');
}

/** Read configuration without getConfiguration's persistence or startup side effects. */
export function previewOptions(ns,schema){
 let saved={};const text=ns.read('autopilot.js.config.txt');
 if(text){saved=JSON.parse(text);if(Array.isArray(saved))saved=Object.fromEntries(saved);if(!saved||typeof saved!=='object')throw Error('Invalid autopilot configuration');}
 return ns.flags(schema.map(([key,value])=>[key,key in saved?saved[key]:Array.isArray(value)?value.slice():value]));
}

/** Read-only observation. Does not invoke gameplay APIs, claim budgets, launch or write files. */
export function collectAutomationPreview(ns,options=null,now=Date.now(),manifest=moduleManifest,managerPlan=priorityManagerPlan,headroom=homeRamHeadroom){
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 if(options===null){options=read('autopilot.js.config.txt')||{};if(Array.isArray(options))options=Object.fromEntries(options);if(typeof options!=='object')throw Error('Invalid autopilot configuration');}
 const reset=ns.getResetInfo(),player=ns.getPlayer(),homeRam=ns.getServerMaxRam('home'),homeUsed=ns.getServerUsedRam('home');
 const processes=ns.ps('home'),alive=pid=>processes.some(p=>p.pid===pid);
 const fresh=(record,age=120000)=>record&&Number.isFinite(record.at)&&record.at<=now&&now-record.at<=age&&record.at>=reset.lastAugReset&&
  (record.augReset===undefined||record.augReset===reset.lastAugReset)&&(record.nodeReset===undefined||record.nodeReset===reset.lastNodeReset);
 const entries=value=>value instanceof Map?[...value]:Object.entries(value||{});
 const sources=Object.fromEntries(entries(reset.ownedSF).filter(([,v])=>Number(v)>0));
 if(reset.currentNode>0)sources[reset.currentNode]=Math.max(Number(sources[reset.currentNode])||0,[4,8].includes(reset.currentNode)?3:1);
 for(const [id,level]of entries(reset.bitNodeOptions?.sourceFileOverrides)){if(Number(level)>0)sources[id]=Number(level);else delete sources[id];}
 const corporation=read('tasks/corporation-status.json'),corporationRunning=processes.some(p=>p.filename.replace(/^\//,'')==='corporation-manager.js');
 const corporationReady=!options['disable-corporation']&&!!sources[3]&&reset.bitNodeOptions?.disableCorporation!==true;
 const enabled=new Map(managerPlan({homeRam,sourceFiles:sources,node:reset.currentNode,options,bladeburnerRank:reset.currentNode===8||reset.bitNodeOptions?.disableBladeburner?0:1,
  corporationReady,corporationKnown:true,corporationRunning},manifest).map(p=>[p.name,p.enabled]));
 const maintenance=read('tasks/automation-maintenance.json'),activity=read('tasks/activity-lock.json');
 const maintenanceActive=maintenance?.expiresAt>now&&alive(maintenance.ownerPid);
 const activityActive=activity?.expiresAt>now&&alive(activity.ownerPid);
 const reserve=headroom(homeRam,Number(ns.read('home-ram-reserve.txt'))||0);
 let available=Math.max(0,homeRam-homeUsed-reserve);
 const launchPlan=read('tasks/automation-status.json');
 const cooldowns=fresh(launchPlan,30000)&&launchPlan.augReset===reset.lastAugReset&&launchPlan.nodeReset===reset.lastNodeReset&&processes.some(p=>p.pid===launchPlan.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js')&&Array.isArray(launchPlan.managers)?launchPlan.managers:[];
 const modules=[...manifest].sort((a,b)=>(a.priority??100)-(b.priority??100));
 const managers=modules.map(m=>{
  const running=processes.find(p=>p.filename.replace(/^\//,'')===m.script);
  let ram=0,reason='';try{ram=ns.fileExists(m.script,'home')?ns.getScriptRam(m.script,'home'):0;}catch(error){reason=String(error).slice(0,160);}
  const paused=ns.read('remote-control/paused/'+m.script.split('/').pop()+'.txt').trim()==='true';
  const cooling=cooldowns.find(p=>p.script===m.script&&p.state==='restart-cooldown'&&p.cooldownUntil>now&&p.cooldownUntil<=now+300000);
  if(cooling)reason='Repeated early exits; retry at '+new Date(cooling.cooldownUntil).toISOString();
  let state=running?'running':paused?'paused':!(Number.isFinite(ram)&&ram>0)?'missing-or-invalid':
   enabled.get(m.script)===false?'locked-or-disabled':cooling?'restart-cooldown':maintenanceActive?'maintenance':
   !enabled.has(m.script)?'managed-by-parent':m.script==='work-for-factions.js'&&activityActive?'waiting-for-activity':ram>available?'waiting-for-ram':'would-start';
  if(state==='would-start')available-=ram;
  return {script:m.script,state,ram:Number.isFinite(ram)?ram:0,pid:running?.pid??null,homeOnly:m.homeOnly,reason};
 });
 const plan=read('tasks/spending-plan.json'),usage=read('tasks/spending-usage.json');
 const validPlan=plan&&plan.reset===reset.lastAugReset&&Number.isFinite(plan.epoch)&&plan.epoch<=now&&plan.expiresAt>now&&plan.expiresAt<=now+120000&&
  processes.some(p=>p.pid===plan.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js');
 const cashReserve=Math.max(0,Number(ns.read('reserve.txt'))||0);
 const budgets=validPlan?Object.entries(plan.allowances||{}).map(([category,amount])=>{
  const used=usage?.epoch===plan.epoch?Number(usage.spent?.[category])||0:0;
  return {category,remaining:Number.isFinite(amount)&&amount>=0&&used>=0?Math.max(0,Math.min(amount-used,player.money-cashReserve)):0};
 }):[];
 const cloud=read('tasks/cloud-purchase-status.json');
 const cloudDecision=fresh(cloud)&&cloud?.schemaVersion===1?cloud:null;
 const purchases=['ram','tor','program'].map(kind=>{
  const quote=read('tasks/infrastructure-'+kind+'.json');if(!fresh(quote,300000)||!(quote.cost>0)||!Number.isFinite(quote.cost))return null;
  const category=kind==='ram'?'home':kind,ceiling=budgets.find(b=>b.category===category)?.remaining;
  const affordable=quote.cost<=Math.max(0,player.money-cashReserve)&&quote.cost<=player.money*(quote.budget>0&&quote.budget<=1?quote.budget:1);
  return {kind,cost:quote.cost,state:!affordable?'cash-reserved':ceiling!==undefined&&quote.cost>ceiling?'shared-budget':'requires-live-recheck'};
 }).filter(Boolean);
 const hosts=['home'],seen=new Set(hosts);let cursor=0;
 if(typeof ns.scan==='function')while(cursor<hosts.length&&cursor<128){for(const host of ns.scan(hosts[cursor++]))if(!seen.has(host)){seen.add(host);hosts.push(host);if(hosts.length>=128)break;}if(hosts.length>=128)break;}
 const remote=hosts.filter(h=>h!=='home'&&ns.hasRootAccess(h)).map(host=>({host,free:Math.max(0,ns.getServerMaxRam(host)-ns.getServerUsedRam(host))})).sort((a,b)=>b.free-a.free);
 const placements=manifest.filter(m=>m.homeOnly===false).map(m=>{
  const manager=managers.find(p=>p.script===m.script),ram=manager?.ram||0,target=ram>0?remote.find(h=>h.free>=ram):null;
  if(target)target.free-=ram;
  return {script:m.script,host:target?.host??null,ram,state:target?(m.requiresLease?'requires-home-owned-lease':'eligible-remote-worker'):'no-remote-capacity'};
 });
 return {schemaVersion:1,at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,readOnly:true,
  home:{ram:homeRam,used:homeUsed,reserve,available:Math.max(0,homeRam-homeUsed-reserve)},managers,budgets,purchases,placements,cloud:cloudDecision,
  evidence:{budget:validPlan?'current':'unavailable',corporation:fresh(corporation)?'observed':'access-only',networkTruncated:hosts.length>=128},
  limitations:'Launch estimates use current RAM and shared manager gates. Purchases show observed quotes and budget ceilings, not purchase orders. Parent controllers, casino, reset and activity policies still apply. No files, jobs, purchases or processes were changed.'};
}

export function printAutomationPreview(ns,preview){
 ns.tprint('Automation preview — read only');
 if(preview.cloud)ns.tprint('Cloud capacity: '+(preview.cloud.description||preview.cloud.reason));
 for(const m of preview.managers)ns.tprint(m.script+': '+m.state+' ('+m.ram+' GB)');
 if(preview.budgets.length)ns.tprint('Remaining shared allowances: '+preview.budgets.map(b=>b.category+'='+Math.round(b.remaining)).join(', '));
 for(const p of preview.purchases)ns.tprint(p.kind+': '+p.cost+' — '+p.state);
 for(const p of preview.placements)ns.tprint(p.script+': '+(p.host||p.state));
 ns.tprint(preview.limitations);
}
