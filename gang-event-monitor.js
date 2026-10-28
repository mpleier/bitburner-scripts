/** Short-lived first-territory-update receipt and early-war shutdown. */
export async function main(ns){
 let ticket;try{ticket=JSON.parse(String(ns.args[0]));}catch{ns.print('WARNING: Invalid gang event monitor ticket.');return;}
 await monitorGangEvent(ns,ticket);
}
export async function monitorGangEvent(ns,ticket){
 const path='tasks/gang-attrition.json',receiptPath='tasks/gang-attrition-event.json';
 const read=()=>{try{return JSON.parse(ns.read(path));}catch{return null;}};
 const owns=q=>q?.monitorRequired===true&&q.monitorPid===ns.pid&&q.ownerPid===ticket?.ownerPid&&q.nodeReset===ticket?.nodeReset&&q.augReset===ticket?.augReset&&q.startedAt===ticket?.startedAt;
 const signature=gangs=>JSON.stringify(Object.entries(gangs).sort(([a],[b])=>a.localeCompare(b)).map(([name,g])=>[name,g.power,g.territory]));
 let lease=read(),processedMs=0,updates=0,largestUpdateMs=0;
 if(!owns(lease)||lease.state!=='active')return;
 const base={kind:'native-update-v1',ownerPid:lease.ownerPid,nodeReset:lease.nodeReset,augReset:lease.augReset,startedAt:lease.startedAt,observerPid:ns.pid,baselineSignature:lease.observationSignature};
 const finish=async(state,data={})=>{
  const current=read(),reset=ns.getResetInfo();
  if(!owns(current)||reset.lastNodeReset!==current.nodeReset||reset.lastAugReset!==current.augReset)return;
  // Disabling is always allowed for this exact active lease. Never enable warfare.
  if(current.state==='active'){
   ns.gang.setTerritoryWarfare(false);
   await ns.write(path,JSON.stringify({...current,state:'cooldown',stoppedAt:Date.now(),stopReason:state==='observed'?'observed-tick':'event-monitor-'+state}),'w');
  }else if(current.stopReason!=='observed-tick')state='interrupted';
  await ns.write(receiptPath,JSON.stringify({...base,at:Date.now(),processedMs,updates,largestUpdateMs,...data,state}),'w');
 };
 try{
  const reset=ns.getResetInfo();
  if(reset.lastNodeReset!==lease.nodeReset||reset.lastAugReset!==lease.augReset)return;
  if(!Number.isFinite(lease.startedAt)||!Number.isFinite(lease.deadline)||lease.deadline<=Date.now()||lease.deadline>lease.startedAt+22000||typeof lease.observationSignature!=='string'||signature(ns.gang.getAllGangInformation())!==lease.observationSignature){await finish('ambiguous-start');return;}
  while(updates<100){
   lease=read();
   if(!owns(lease))return;
   if(lease.state!=='active'||!ns.isRunning(lease.ownerPid)){await finish('interrupted');return;}
   const remaining=lease.deadline-Date.now();
   if(remaining<=0){await finish('timeout');return;}
   // ns.sleep marks Netscript busy even if the native update wins the race.
   // Use a cancellable JavaScript timer so the next API call remains legal.
   let timer,event;
   try{event=await Promise.race([ns.gang.nextUpdate().then(ms=>({ms})),new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),remaining);})]);}
   finally{if(timer!==undefined)clearTimeout(timer);}
   if(event.timeout||Date.now()>lease.deadline){await finish('timeout');return;}
   if(!Number.isFinite(event.ms)||event.ms<=0||event.ms>5000){await finish('invalid-update');return;}
   updates++;processedMs+=event.ms;largestUpdateMs=Math.max(largestUpdateMs,event.ms);
   const others=ns.gang.getAllGangInformation(),observedSignature=signature(others);
   if(processedMs>20000){await finish('ambiguous-interval');return;}
   if(observedSignature!==base.baselineSignature){
    const info=ns.gang.getGangInformation();
    if(info.faction!==lease.faction||others[info.faction]?.power!==info.power||others[info.faction]?.territory!==info.territory){await finish('invalid-snapshot');return;}
    await finish('observed',{at:Date.now(),info:{faction:info.faction,power:info.power,territory:info.territory},others,observedSignature});return;
   }
  }
  await finish('update-limit');
 }catch(error){
  try{await finish('error',{error:String(error).slice(0,160)});}catch{}
  ns.print('WARNING: Gang event monitoring stopped: '+String(error).slice(0,160));
 }
}
