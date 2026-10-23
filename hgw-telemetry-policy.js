import {mergeHgwDelaySamples} from './hacking-deadline-policy.js';
import {classifyHgwEvent} from './hgw-diagnostics-policy.js';
const channel='hgw-v1';
const countKeys=['operations','spacingSamples','spacingRisks','deadlineOverruns','unavoidableOverruns','compensatedStarts','zeroHack','noGrowth','noWeaken','errors'];
function mergeCounts(a={},b={}) {
 a=a&&typeof a==='object'?a:{};b=b&&typeof b==='object'?b:{};
 const out={};for(const key of countKeys)out[key]=(Number.isSafeInteger(a[key])&&a[key]>=0?a[key]:0)+(Number.isSafeInteger(b[key])&&b[key]>=0?b[key]:0);
 out.maxLateMs=Math.max(Number.isFinite(a.maxLateMs)?a.maxLateMs:0,Number.isFinite(b.maxLateMs)?b.maxLateMs:0);return out;
}
/** One daemon consumes the reserved port. Counts survive controller reloads within the same reset. */
export function collectHgwTelemetry(ns,reset,ownerPid,now=Date.now()) {
 const file='tasks/hgw-misfires.json';let saved;
 try{saved=JSON.parse(ns.read(file));}catch{}
 const same=saved?.augReset===reset.lastAugReset&&saved?.nodeReset===reset.lastNodeReset&&saved?.at<=now;
 let status=same?saved:{version:1,augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,counts:{},targets:{},recent:[],lastAlerts:{}};
 status.delaySamples=mergeHgwDelaySamples(status.delaySamples,status.recent,{now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid});
 if(typeof ns.getPortHandle!=='function'){ns.write(file,JSON.stringify({...status,at:now,ownerPid,blocked:true,reason:'Port telemetry API unavailable'}),'w');return;}
 const port=ns.getPortHandle(20),head=port.peek();let pending;
 if(head!=='NULL PORT DATA') {
  try{pending=JSON.parse(head);}catch{}
  if(pending?.channel!==channel) {
   // Preserve foreign traffic. A blocked telemetry port must not be reported as zero misfires.
   ns.write(file,JSON.stringify({...status,at:now,ownerPid,blocked:true,reason:'Port 20 contains another protocol; timing measurements may be incomplete'}),'w');return;
  }
  port.read();
 }
 if(pending?.augReset===reset.lastAugReset&&pending?.nodeReset===reset.lastNodeReset) {
  status.counts=mergeCounts(status.counts,pending.counts);
  status.income||={};
  for(const [key,v]of Object.entries(pending.income||{})){
   if(!v||key!==JSON.stringify([v.owner,v.target])||!Number.isSafeInteger(v.owner)||v.owner<=0||typeof v.target!=='string'||
    !Number.isFinite(v.at)||v.at>now||!Number.isFinite(v.money)||v.money<0||!Number.isSafeInteger(v.completions)||v.completions<0||!Number.isSafeInteger(v.risks)||v.risks<0)continue;
   const old=status.income[key]||{};
   status.income[key]={...v,money:(old.money||0)+v.money,completions:(old.completions||0)+v.completions,risks:(old.risks||0)+v.risks};
  }
  status.income=Object.fromEntries(Object.entries(status.income).sort((a,b)=>b[1].at-a[1].at).slice(0,64));
  status.targets||={};for(const [key,value]of Object.entries(pending.targets||{}))
   status.targets[key]={...mergeCounts(status.targets[key],value),at:value.at};
  status.targets=Object.fromEntries(Object.entries(status.targets).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,64));
  const pendingSamples=mergeHgwDelaySamples(pending.delaySamples,pending.recent,{now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid});
  status.delaySamples=mergeHgwDelaySamples(status.delaySamples,pendingSamples,{now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid});
  status.recent=[...(status.recent||[]),...(Array.isArray(pending.recent)?pending.recent:[])].slice(-40);
  status.firstAt=Number.isFinite(status.firstAt)?Math.min(status.firstAt,pending.firstAt||now):pending.firstAt||now;
  status.lastAlerts||={};
  for(const event of (Array.isArray(pending.alerts)?pending.alerts:[])) {
   const severity=classifyHgwEvent(event);if(['on-time','unknown'].includes(severity.kind))continue;
   const minor=severity.kind==='deadline-miss',key=(minor?'minor:':'')+event.tool+':'+event.target;
   if(now-(status.lastAlerts[key]??-Infinity)<60000)continue;
   const message=event.error?'HGW operation error on '+event.target+': '+event.error:
    (minor?'HGW deadline miss: ':'HGW timing risk: ')+event.tool+' on '+event.target+' completed '+Math.round(event.lateMs)+' ms after its deadline'+
    (minor?'; within the '+Math.round(severity.thresholdMs)+' ms spacing-risk threshold.':severity.spacingKnown?'; spacing-risk threshold '+Math.round(severity.thresholdMs)+' ms exceeded; ordering is not verified.':'; spacing unavailable; ordering risk is unknown.');
   ns.print((minor?'INFO: ':'WARNING: ')+message);if(!minor)ns.toast(message,'warning');status.lastAlerts[key]=now;
  }
  status.lastAlerts=Object.fromEntries(Object.entries(status.lastAlerts).filter(([,at])=>now-at<60000).slice(-64));
 }
 // Persist on new evidence, reset, or every five seconds; never write per worker operation.
 if(pending||!same||now-(saved?.at||0)>=5000)
  ns.write(file,JSON.stringify({...status,at:now,ownerPid,blocked:false,scope:'Observed completions, not proof of batch-order failure'}),'w');
}
