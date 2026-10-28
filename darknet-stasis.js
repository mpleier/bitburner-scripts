import {anchorIdentity,anchorRequestFile,anchorReceiptFile,anchorControlAllowed} from './darknet-anchor-policy.js';
/**
 * One-shot: stasis-links the server this runs on, so it can't move or go
 * offline and stays reachable from a distance. setStasisLink costs 12 GB of
 * RAM, so it lives in its own script and exits as soon as it is done.
 */
export async function main(ns) {
  const self = ns.getHostname();
  if(ns.args?.length){
    await ns.scp(anchorRequestFile,self,'home');
    let r;try{r=JSON.parse(ns.read(anchorRequestFile));}catch{return;}
    const phase=String(ns.args[1]),now=Date.now();
    if(!['prepare','release','apply','rollback'].includes(phase))return;
    if(r.id!==ns.args[0]||r.phase!==phase||r.at>now||r.expiresAt-now<20000||!ns.isRunning(r.owner)||(['prepare','apply'].includes(phase)?r.target:r.source)!==self)return;
    if(!await anchorControlAllowed(ns))return;
    let success=false,message='Anchor preflight failed';
    try{
      const context=JSON.parse(ns.read('tasks/dnet-cache-context.json')||'{}'),details=ns.dnet.getServerDetails(self);
      if(context.nodeReset!==r.nodeReset||context.augReset!==r.augReset||anchorIdentity({...details,host:self})!==(self===r.target?r.targetIdentity:r.sourceIdentity))throw Error('Anchor identity or reset changed');
      const linkedNow=ns.dnet.getStasisLinkedServers();
      if(phase==='prepare'){success=ns.hasRootAccess(self)&&ns.ps(self).some(p=>p.filename==='darknet-node.js')&&!linkedNow.includes(self);message=success?'Replacement scout verified':'Replacement scout unavailable';}
      else{
        const add=phase==='apply'||phase==='rollback';
        if(!add){
          if(ns.ls(self).some(f=>/\.(cache|cct)$/.test(f)||f==='STORM_SEED.exe'))throw Error('Anchor now holds unfinished rewards');
          if(details.isStationary!==false||linkedNow.length<2||!linkedNow.includes(self)||linkedNow.includes(r.target)||!ns.ps(r.target).some(p=>p.filename==='darknet-node.js'))throw Error('Replacement no longer ready');
          if(details.depth>=Math.max(...linkedNow.map(h=>ns.dnet.getServerDetails(h).depth)))throw Error('Deepest anchor is protected');
        }
        if(add&&linkedNow.includes(self))success=true;
        else{const result=await ns.dnet.setStasisLink(add);success=!!result?.success&&ns.dnet.getStasisLinkedServers().includes(self)===add;message=String(result?.message||phase);}
      }
    }catch(error){message=String(error);}
    await ns.write(anchorReceiptFile,JSON.stringify({id:r.id,phase,host:self,at:Date.now(),success,message}),'w');
    await ns.scp(anchorReceiptFile,'home',self);return;
  }
  try{const r=JSON.parse(ns.read(anchorRequestFile));if(r.expiresAt>Date.now()&&!['done','blocked'].includes(r.phase))return;}catch{}
  const linked = ns.dnet.getStasisLinkedServers();
  const limit = ns.dnet.getStasisLinkLimit();
  if (linked.includes(self)) return;
  if (linked.length >= limit) {
    ns.print(`${self}: stasis link limit reached (${linked.length}/${limit}).`);
    return;
  }
  const result = await ns.dnet.setStasisLink(true);
  const after = ns.dnet.getStasisLinkedServers();
  ns.print(`${self}: stasis link ${result?.success ? "set" : `not set (${result?.code}: ${result?.message})`} (${after.length}/${limit}).`);
}
