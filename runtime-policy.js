export const runtimeScripts=['autopilot.js','daemon.js','corporation-manager.js','gangs.js','sleeve.js','go.js','bladeburner.js','grafting-manager.js','health-manager.js','infiltration-manager.js','soa-manager.js','achievement-manager.js','darknet-manager.js','stanek.js','hacknet-upgrade-manager.js','work-for-factions.js','stockmaster.js','spend-hacknet-hashes.js','contract-validation.js'];
export const statusFiles={'spend-hacknet-hashes.js':'tasks/hacknet-hash-status.json','work-for-factions.js':'tasks/faction-work-status.json','stanek.js':'tasks/stanek-status.json','stockmaster.js':'tasks/stock-status.json','corporation-manager.js':'tasks/corporation-status.json','gangs.js':'tasks/gang-status.json','sleeve.js':'tasks/sleeve-status.json','go.js':'tasks/go-status.json','infiltration-manager.js':'tasks/infiltration-status.json','soa-manager.js':'tasks/soa-status.json','achievement-manager.js':'tasks/achievement-status.json','autopilot.js':'tasks/automation-status.json','grafting-manager.js':'tasks/grafting-status.json','contract-validation.js':'tasks/contract-validation.json'};
export function runtimeHash(text){let n=2166136261;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619);return (n>>>0).toString(16);}
function resolvePath(base,dependency){const parts=(dependency.startsWith('.')?base.split('/').slice(0,-1).join('/')+'/'+dependency:dependency).split('/'),out=[];for(const p of parts){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return out.join('/');}
/** Pass a fresh cache for each supervisor check; never reuse it across updates. */
export function scriptSignature(ns,script,sourceCache=new Map()){
 const visited=new Set(),parts=[];
 function read(name){
  if(visited.has(name))return;visited.add(name);
  let source=sourceCache.get(name);
  if(!source){const text=ns.read(name);source={text,dependencies:[...text.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(m=>resolvePath(name,m[1]))};sourceCache.set(name,source);}
  parts.push(name+'\n'+source.text);for(const dependency of source.dependencies)read(dependency);
 }
 read(script.replace(/^\//,''));return runtimeHash(parts.sort().join('\n'));
}
const registrations=new Map();
export function registerAutomation(ns){const key=ns.pid;registrations.set(key,{pid:key,script:ns.getScriptName(),signature:scriptSignature(ns,ns.getScriptName()),startedAt:Date.now()});automationHeartbeat(ns);}
export function automationHeartbeat(ns){
 const record=registrations.get(ns.pid),now=Date.now();
 if(record&&(record.at===undefined||now-record.at>=10000)){record.at=now;ns.write('tasks/runtime/'+ns.pid+'.json',JSON.stringify(record),'w');}
}
export function maintenanceRequested(ns){try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));return r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid);}catch{return false;}}
export function recoveryDecision({record,signature,observedAt,now,paused=false,protectedWork=false,attempts=0,statusAt,script}){
 if(paused)return 'paused';
 const startedAt=Number.isFinite(record?.startedAt)&&record.startedAt>0&&record.startedAt<=now?record.startedAt:observedAt;
 const grace=now-startedAt<120000;
 const limit=script==='go.js'?20*60000:script==='contract-validation.js'?15*60000:4*60000;
 if(grace)return 'starting';
 const changed=record?.signature&&record.signature!==signature;
 const stale=record?.at&&now-record.at>limit||statusAt&&now-statusAt>limit;
 const unknown=!record||!Number.isFinite(record.at)||record.at<=0||record.at>now||typeof record.signature!=='string'||!record.signature;
 if(!changed&&!stale&&!unknown)return grace?'starting':'healthy';
 if(protectedWork)return 'deferred-protected-work';
 if(attempts>=3)return 'recovery-limit';
 return changed||unknown?'reload':'restart-stalled';
}
export function dashboardRows(processes,read,now=Date.now()){
 return runtimeScripts.map(script=>{
  const matching=processes.filter(p=>p.filename.replace(/^\//,'')===script),saved=read(statusFiles[script]);
  const owner=saved?.pid??saved?.ownerPid;
  const status=matching.length&&(!owner||matching.some(p=>p.pid===owner))?saved:null;
  return {script,pids:matching.map(p=>p.pid),state:matching.length?(status?.status||status?.state||status?.mode||'running'):'not-running',reason:status?.reason||status?.error||(matching.length&&saved&&owner?'Waiting for status from the current process':''),updatedAt:status?.at||null,ageMs:status?.at?now-status.at:null};
 });
}
