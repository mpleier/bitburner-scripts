import {homeRamHeadroom} from './home-ram-policy.js';
/** Capacity for enabled controllers plus one helper slot; purchases still use shared cash guards. */
export function managerCapacityPlan(ns,managers=[],processes=ns.ps('home'),phaseGroups=[]) {
 const rows=new Map(),unavailable=[];
 const add=(name,threads=1,accumulate=false)=>{
  name=String(name).replace(/^\//,'');if(rows.has(name)&&!accumulate)return;
  let ram;try{ram=ns.getScriptRam(name,'home')*threads;}catch{}
  if(!(Number.isFinite(ram)&&ram>0)){unavailable.push(name);return;}rows.set(name,(accumulate?rows.get(name)||0:0)+ram);
 };
 for(const p of processes)if(!p.temporary&&!/^(Temp|remote-control|Remote)\//.test(p.filename.replace(/^\//,'')))add(p.filename,p.threads,true);
 for(const m of managers)if(m.enabled&&!m.paused)add(m.name||m.script);
 let workerReserve=16;
 for(const group of phaseGroups){
  const costs=group.map(name=>{try{return ns.getScriptRam(name,'home');}catch{return 0;}});
  if(costs.some(c=>!Number.isFinite(c)||c<=0)){unavailable.push('phase-worker');continue;}
  workerReserve+=Math.max(0,...costs);
 }
 const controllerRam=[...rows.values()].reduce((sum,n)=>sum+n,0),required=controllerRam+workerReserve;
 const configured=Math.max(0,Number(ns.read('home-ram-reserve.txt'))||0),maximum=ns.getServerMaxRam('home');
 let target=128;
 if(!(Number.isFinite(maximum)&&maximum>0&&Number.isFinite(required)))return null;
 while(target<2**30&&target<required+homeRamHeadroom(target,configured))target*=2;
 return {current:maximum,target:Math.min(2**30,target),required,controllerRam,workerReserve,complete:unavailable.length===0,
  unavailable:unavailable.slice(0,32),controllers:[...rows.keys()].slice(0,64),needsUpgrade:target>maximum,
  basis:'Enabled controller capacity plus a 16 GB helper slot and declared sequential phase peaks; not a runtime RAM guarantee'};
}

/** Only successful casino completion can request a bounded infrastructure-first restart. */
export function postCasinoInfrastructure(ns,reset,sourceFiles,launch,now=Date.now()) {
 const file='tasks/post-casino-infrastructure.json';let r;try{r=JSON.parse(ns.read(file));}catch{return null;}
 if(r?.version!==1||r.nodeReset!==reset.lastNodeReset||r.augReset!==reset.lastAugReset||
  !Number.isFinite(r.at)||r.at<reset.lastAugReset||r.at>now||now-r.at>120000||!['pending','running','waiting-for-ram','retry'].includes(r.state))return null;
 const finish=(state,active)=>{r={...r,state,checkedAt:now};ns.write(file,JSON.stringify(r),'w');return {...r,active};};
 if(now-r.at>=60000)return finish('timed-out',false);
 const jobs=[['Tasks/ram-manager.js',['--budget',.5,'--reserve',0],4],['Tasks/tor-manager.js',[],4],
  ['Tasks/program-manager.js',[],4],['host-manager.js',[],0]];
 if(!Number.isSafeInteger(r.index)||r.index<0||r.index>jobs.length)r.index=0;
 r.results=Array.isArray(r.results)?r.results.slice(-4):[];
 if(r.pid){
  const process=ns.ps('home').find(p=>p.pid===r.pid&&p.filename.replace(/^\//,'')===jobs[r.index]?.[0]);
  if(process)return finish('running',true);
  r.results.push({script:jobs[r.index]?.[0],result:'exit-observed'});r.index++;r.pid=null;r.attempts=0;
 }
 while(r.index<jobs.length){
  const [script,args,sf]=jobs[r.index];
  if(sf&&!sourceFiles[sf]||ns.read('remote-control/paused/'+script+'.txt').trim()==='true'||!ns.fileExists(script,'home')){
   r.results.push({script,result:'unavailable-or-paused'});r.index++;continue;
  }
  const existing=ns.ps('home').find(p=>p.filename.replace(/^\//,'')===script);
  if(existing){r.pid=existing.pid;return finish('running',true);}
  let required;try{required=ns.getScriptRam(script,'home');}catch{required=0;}
  const free=ns.getServerMaxRam('home')-ns.getServerUsedRam('home');
  if(!(Number.isFinite(required)&&required>0)){r.results.push({script,result:'invalid-ram'});r.index++;continue;}
  if(required>free)return finish('waiting-for-ram',true);
  try{r.pid=launch(script,args);}catch{r.pid=0;}r.attempts=(r.attempts||0)+1;
  if(r.pid)return finish('running',true);
  if(r.attempts<2)return finish('retry',true);
  r.results.push({script,result:'launch-failed'});r.index++;r.attempts=0;
 }
 return finish('complete',false);
}
