/** Self-contained guard shared by preparation and the final native install worker. */
export function augmentationInstallSafety(api,bladeburnerAccess=false) {
 try{
  if(api.getCurrentWork()?.type==='GRAFTING')return {allowed:false,reason:'Waiting for grafting to finish'};
  if(bladeburnerAccess&&api.inBladeburner()&&/black/i.test(api.getCurrentAction()?.type||''))return {allowed:false,reason:'Waiting for the active Black Op to finish'};
  return {allowed:true};
 }catch(error){return {allowed:false,reason:'Install safety unavailable: '+String(error)};}
}

/** Restore only known persistent automation, preserving the previous controller arguments. */
export function resumeAugmentationAutomation(ns,saved,expectedReset) {
 const reset=ns.getResetInfo();
 if(reset.lastAugReset!==expectedReset.lastAugReset||reset.lastNodeReset!==expectedReset.lastNodeReset)return [];
 const known=['autopilot.js','daemon.js','bladeburner.js','corporation-manager.js','gangs.js','sleeve.js','stockmaster.js','work-for-factions.js','darknet-manager.js','go.js','hacknet-upgrade-manager.js','spend-hacknet-hashes.js','health-manager.js','reliability-manager.js','host-manager.js'];
 const eligible=saved.filter(p=>known.includes(p.filename.replace(/^\//,''))&&Array.isArray(p.args)&&Number.isSafeInteger(p.threads)&&p.threads>0);
 const root=eligible.find(p=>p.filename.replace(/^\//,'')==='autopilot.js')||eligible.find(p=>p.filename.replace(/^\//,'')==='daemon.js');
 const targets=root?[root]:eligible,results=[];let fallback=null;
 for(const process of targets){
  const name=process.filename.replace(/^\//,'');
  if(ns.read('remote-control/paused/'+name+'.txt').trim()==='true')continue;
  const existing=ns.ps('home').find(p=>p.filename.replace(/^\//,'')===name);
  if(existing){results.push({script:process.filename,pid:existing.pid,existing:true});continue;}
  try{
   const pid=ns.run(process.filename,process.threads,...process.args);
   results.push({script:process.filename,pid});
   if(!pid){fallback??=process;ns.print('Recovery could not start '+process.filename+' while ascend.js still holds RAM.');}
  }catch(error){ns.print('Automation recovery failed for '+process.filename+': '+String(error));fallback??=process;}
 }
 // A controller can start after ascend releases its own RAM; it restores the subordinate services.
 if(root&&fallback)ns.spawn(root.filename,root.threads,...root.args);
 return results;
}

/** Bound child lifetime and launch attempts; a failed liquidation must never authorize a reset. */
export async function liquidateAugmentationStocks(ns,{count,launch,timeoutMs=30000,maxAttempts=3,now=Date.now}={}) {
 if(typeof count!=='function'||typeof launch!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isSafeInteger(maxAttempts)||maxAttempts<1)return {ok:false,reason:'Invalid stock liquidation limits'};
 const deadline=now()+timeoutMs;
 const readCount=async()=>{const remaining=await count();return Number.isSafeInteger(remaining)&&remaining>=0?remaining:null;};
 let remaining=await readCount();
 if(remaining===null)return {ok:false,reason:'Stock positions unavailable'};
 for(let attempt=0;remaining>0&&attempt<maxAttempts&&now()<deadline;attempt++){
  const pid=launch();
  if(pid){
   while(ns.isRunning(pid)){
    if(now()>=deadline){ns.kill(pid);return {ok:false,remaining,reason:'Stock liquidation timed out; stopped its worker'};}
    await ns.sleep(Math.min(200,Math.max(1,deadline-now())));
   }
  }
  remaining=await readCount();
  if(remaining===null)return {ok:false,reason:'Stock positions unavailable after liquidation'};
  if(remaining>0&&attempt+1<maxAttempts&&now()<deadline)await ns.sleep(Math.min(1000,deadline-now()));
 }
 return remaining===0?{ok:true,remaining:0}:{ok:false,remaining,reason:'Stock liquidation did not finish within its attempt/time budget'};
}

/** Publish only the requested purchase attempt; standalone faction-manager runs need no receipt. */
export async function publishAugmentationPurchase(ns,request,reset,outcome,planned) {
 if(!request)return;
 const match=/^(\d+):\d+:(primary|leftover)$/.exec(request);
 if(!match)return;
 const owner=Number(match[1]),current=ns.getResetInfo();
 if(!Number.isSafeInteger(owner)||owner<=0||!ns.isRunning(owner)||current.lastAugReset!==reset.lastAugReset||current.lastNodeReset!==reset.lastNodeReset)return;
 const purchased=outcome?.purchased??0;
 await ns.write('tasks/augmentation-purchase-result-'+owner+'.json',JSON.stringify({version:1,request,workerPid:ns.pid,
  augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,at:Date.now(),planned,purchased,
  complete:outcome?.complete===true,reason:outcome?.complete?'Purchase batch completed':'Purchase batch deferred or failed'}),'w');
}

/** Bound one purchase child and accept only its matching, complete, reset-scoped receipt. */
export async function prepareAugmentationPurchases(ns,{script='faction-manager.js',args=[],reset,phase='primary',timeoutMs=300000,now=Date.now}={}) {
 if(!reset||!['primary','leftover'].includes(phase)||!Number.isFinite(timeoutMs)||timeoutMs<=0)return {ok:false,reason:'Invalid purchase preparation'};
 const started=now(),request=ns.pid+':'+started+':'+phase,file='tasks/augmentation-purchase-result-'+ns.pid+'.json';
 await ns.write(file,'','w');
 const pid=ns.run(script,1,...args,'--purchase-request',request);
 if(!pid)return {ok:false,reason:'Augmentation purchase worker could not start'};
 while(ns.isRunning(pid)){
  if(now()-started>=timeoutMs){ns.kill(pid);return {ok:false,reason:'Augmentation purchase worker timed out and was stopped'};}
  await ns.sleep(Math.min(200,Math.max(1,timeoutMs-(now()-started))));
 }
 if(now()-started>timeoutMs)return {ok:false,reason:'Augmentation purchase result arrived after its deadline'};
 let receipt;try{receipt=JSON.parse(ns.read(file));}catch{return {ok:false,reason:'Augmentation purchase result is missing or unreadable'};}
 const current=ns.getResetInfo();
 if(!receipt||receipt.version!==1||receipt.request!==request||receipt.workerPid!==pid||receipt.augReset!==reset.lastAugReset||receipt.nodeReset!==reset.lastNodeReset||
  current.lastAugReset!==reset.lastAugReset||current.lastNodeReset!==reset.lastNodeReset||!Number.isFinite(receipt.at)||receipt.at<started||receipt.at>now()||
  !Number.isSafeInteger(receipt.planned)||receipt.planned<0||!Number.isSafeInteger(receipt.purchased)||receipt.purchased<0||receipt.purchased>receipt.planned)
  return {ok:false,reason:'Augmentation purchase result is stale or does not match this attempt'};
 if(receipt.complete!==true||receipt.purchased!==receipt.planned)return {ok:false,reason:'Augmentation purchase batch was deferred or incomplete'};
 return {ok:true,receipt};
}
