/** Relative productive work over one horizon; these are comparisons, not completion ETAs. */
export function freshAugmentationOffer(offer,reset,processes,now=Date.now()) {
 return offer?.schemaVersion===1&&offer.nodeReset===reset.lastNodeReset&&offer.augReset===reset.lastAugReset&&
  Number.isFinite(offer.at)&&offer.at<=now&&now-offer.at<=120000&&
  processes.some(p=>p.pid===offer.ownerPid&&p.filename==='autopilot.js');
}
export function compareGraftInstall(offer,graft) {
 const unknown={winner:'unknown',reason:'Comparable augmentation economics unavailable'};
 const h=offer?.horizonMs,rate=offer?.cashRate;
 if(graft?.channelSignature!==undefined&&graft.channelSignature!==JSON.stringify(offer?.channels))return unknown;
 if(!Number.isFinite(h)||h<=0||h>43200000||!Number.isFinite(rate)||rate<=0)return unknown;
 const valid=o=>o&&[o.gain,o.cost,o.delayMs,o.downtimeMs].every(Number.isFinite)&&o.gain>=0&&o.cost>=0&&o.delayMs>=0&&o.downtimeMs>=0;
 if(offer.install?.eligible&&!valid(offer.install)||offer.wait?.eligible&&!valid(offer.wait))return unknown;
 const score=o=>Math.min(h,o.delayMs)+Math.max(0,h-o.delayMs-o.downtimeMs)*(1+o.gain)-o.cost/rate*1000;
 const options=[{name:'wait',work:h}];
 if(offer.install?.eligible&&valid(offer.install))options.push({name:'install',work:score(offer.install)});
 if(offer.wait?.eligible&&valid(offer.wait))options.push({name:'bundle',work:score(offer.wait)});
 if(valid(graft))options.push({name:'graft',work:score(graft)});
 options.sort((a,b)=>b.work-a.work);
 // Require a material advantage before displacing the existing install/wait choice.
 const alternative=options.find(o=>o.name!=='graft');
 const g=options.find(o=>o.name==='graft');
 const winner=g&&g.work>alternative.work+Math.max(60000,h*.05)?'graft':alternative.name;
 return {winner,horizonMs:h,options,reason:'Discounted productive work after cash replacement and interrupted work'};
}
export function graftChannelGain(stats,channels,factor=1) {
 let log=0;
 for(const [key,weight]of Object.entries(channels||{})){
  const m=(stats?.[key]??1)*factor;
  if(!Number.isFinite(m)||m<=0||!Number.isFinite(weight))return null;
  log+=weight*Math.log(m);
 }
 return Math.max(0,Math.min(2,Math.expm1(log)*.5));
}
/** One handoff per augmentation reset. Failed starts cannot continually defer a reset. */
export function graftHandoff(previous,proposal,offer,reset,processes,now=Date.now()) {
 const same=previous?.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset;
 if(same)return {defer:now<previous.expiresAt,window:previous};
 if(!freshAugmentationOffer(offer,reset,processes,now)||!proposal||proposal.nodeReset!==reset.lastNodeReset||proposal.augReset!==reset.lastAugReset||
  !Number.isFinite(proposal.at)||proposal.at>now||now-proposal.at>90000||
  !processes.some(p=>p.pid===proposal.ownerPid&&p.filename==='grafting-manager.js')||
  compareGraftInstall(offer,proposal.quote).winner!=='graft')return {defer:false};
 return {defer:true,window:{nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,expiresAt:now+90000,name:proposal.name}};
}

export function comparisonCashRate(observation,reset,now=Date.now()) {
 const e=observation?.cashObservation,s=e?.samples?.slice(-2);
 if(observation?.augReset!==reset.lastAugReset||!Number.isFinite(observation?.at)||observation.at>now||now-observation.at>120000||
  e?.schemaVersion!==1||e.augReset!==reset.lastAugReset||e.mode!=='sources-v1'||s?.length!==2||
  !s.every(x=>x&&Number.isFinite(x.at)&&x.at<=now&&now-x.at<=300000&&Number.isFinite(x.rate)&&x.rate>0)||
  s[0].at>=s[1].at||now-s[1].at>120000||!Number.isFinite(observation.cashRate)||observation.cashRate<=0)return null;
 return Math.min(observation.cashRate,...s.map(x=>x.rate));
}
