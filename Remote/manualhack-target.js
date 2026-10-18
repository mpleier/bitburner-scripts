/** Uses the same scheduling arguments as hack-target.js. */
export async function main(ns) {
 const [target='',start=0,duration=0,description='',stock=false,silent=false,loop=false,owner=0,timingMeta='']=ns.args;
 let meta=null;try{meta=JSON.parse(timingMeta);}catch{}
 let lastCompleted=0;
 if(!target||!Number.isFinite(start)||!Number.isFinite(duration)||duration<0)return ns.print('Invalid manual-hack schedule.');
 const delay=Math.max(0,start-Date.now());if(delay)await ns.sleep(delay);
 do {
  if(owner&&!ns.isRunning(owner))return;
  if(loop&&hackingLoopShouldStop(ns,owner,target,'hack',lastCompleted,meta))return;
  if(!ns.getServer(target).isConnectedTo)return ns.print('Manual-hack target is no longer connected: '+target);
  const began=Date.now();
  try{if(!await ns.singularity.manualHack()&&!silent)ns.toast('Manual hack stole no money: '+description,'warning');}
  catch(error){return ns.print('Manual hacking unavailable: '+String(error));}
  lastCompleted=Date.now();
  if(loop)await ns.sleep(Math.max(1,4*duration-(Date.now()-began)));
 }while(loop);
}

function hackingLoopShouldStop(ns,owner,target,tool,lastCompleted,meta) {
 if(!owner||typeof ns.read!=='function')return false;
 let plan;try{plan=JSON.parse(ns.read('tasks/hgw-drain-'+owner+'.json'));}catch{return false;}
 if(plan?.ownerPid!==owner||plan.nodeReset!==meta?.nodeReset||plan.augReset!==meta?.augReset)return false;
 const entry=plan.targets?.[target];if(!entry||!Number.isFinite(entry.stageAt))return false;
 if(tool==='hack')return ['attack','grow','weaken','complete'].includes(entry.stage);
 if(tool==='grow')return ['grow','weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
 return tool==='weaken'&&['weaken','complete'].includes(entry.stage)&&lastCompleted>entry.stageAt;
}
