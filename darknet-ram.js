import {readMazeLease,mazeLeaseIdentity} from './darknet-development-policy.js';
/** A single native action: no retries against an expired grant or vanished neighbor. */
export async function main(ns){
 ns.disableLog('ALL');
 const [target,parentPid,rawScope,token]=ns.args,self=ns.getHostname();
 try{
  const scope=JSON.parse(rawScope),context=JSON.parse(ns.read('tasks/dnet-cache-context.json'));
  if(!Array.isArray(scope)||scope[0]!==context.nodeReset||scope[1]!==context.augReset||scope[2]!==target||scope[3]!=='(RAM Recovery)'||!ns.ps(self).some(p=>p.pid===parentPid&&p.filename===(self==='home'?'darknet-manager.js':'darknet-node.js'))||!ns.dnet.probe().includes(target))return;
  if(self!=='home'&&mazeLeaseIdentity(await readMazeLease(ns,scope,{host:self,pid:parentPid}))!==token)return;
  if(self==='home'&&token!=='root')return;
  const before=ns.dnet.getServerDetails(target);
  if(before.hasSession!==true||!(before.blockedRam>0)||before.modelId!==scope[4])return;
  const result=await ns.dnet.memoryReallocation(target);
  const after=ns.dnet.getServerDetails(target);
  ns.print(target+': RAM recovery '+(result?.success?'completed':'returned '+result?.code)+'; blocked '+before.blockedRam+' -> '+after.blockedRam+' GB.');
 }catch(error){ns.print('RAM recovery deferred: '+String(error));}
}
