/** Uses the same scheduling arguments as hack-target.js. */
export async function main(ns) {
 const [target='',start=0,duration=0,description='',stock=false,silent=false,loop=false,owner=0]=ns.args;
 if(!target||!Number.isFinite(start)||!Number.isFinite(duration)||duration<0)return ns.print('Invalid manual-hack schedule.');
 const delay=Math.max(0,start-Date.now());if(delay)await ns.sleep(delay);
 do {
  if(owner&&!ns.isRunning(owner))return;
  if(!ns.getServer(target).isConnectedTo)return ns.print('Manual-hack target is no longer connected: '+target);
  const began=Date.now();
  try{if(!await ns.singularity.manualHack()&&!silent)ns.toast('Manual hack stole no money: '+description,'warning');}
  catch(error){return ns.print('Manual hacking unavailable: '+String(error));}
  if(loop)await ns.sleep(Math.max(1,4*duration-(Date.now()-began)));
 }while(loop);
}
