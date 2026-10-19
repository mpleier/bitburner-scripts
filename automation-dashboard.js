import {readDashboardSummary} from './diagnostics-policy.js';
import {escapeScanHtml} from './scan-policy.js';
export async function main(ns){
 const read=()=>readDashboardSummary(ns,Date.now(),{requireManagers:true});
 const doc=globalThis['doc'+'ument'],terminal=doc?.getElementById('terminal');
 if(!terminal){const d=read();ns.tprint(d?d.managers.map(m=>m.script+': '+m.state+(m.reason?' — '+m.reason:'')).join('\n'):'Dashboard is waiting for reliability-manager.js.');return;}
 const entry=doc.createElement('li'),card=doc.createElement('div');entry.appendChild(card);terminal.appendChild(entry);
 card.style.cssText='padding:12px;border:1px solid #496;color:#ddd;font:14px monospace';
 let renderedAt;
 while(card.isConnected){const d=read(),e=escapeScanHtml;
  if(d&&d.at===renderedAt){await ns.sleep(5000);continue;}renderedAt=d?.at;
  card.innerHTML=d?'<h3>Automation — BitNode '+e(d.node)+'</h3><p>Updated '+e(new Date(d.at).toLocaleTimeString())+' · Achievements '+e(d.achievements?.unlocked??'?')+'/'+e(d.achievements?.known??'?')+'</p><table><thead><tr><th>Manager</th><th>State</th><th>Details</th></tr></thead><tbody>'+d.managers.map(m=>'<tr><td>'+e(m.script)+'</td><td>'+e(m.state)+'</td><td>'+e(m.reason)+'</td></tr>').join('')+'</tbody></table><p>Cloud capacity: '+e(d.cloud?(d.cloud.description||d.cloud.reason)+(d.cloud.ram?' · '+d.cloud.ram+' GB':'')+(d.cloud.cost?' · $'+Math.round(d.cloud.cost):''):'waiting for a purchase decision')+'</p><p>Pending updates: '+e(d.pending.join(', ')||'none')+'</p><p>Hacking timing: '+e(d.hgw?.blocked?'Measurements unavailable: '+d.hgw.reason:d.hgw?.counts?.operations?d.hgw.counts.operations+' observed operations, '+(d.hgw.counts.deadlineOverruns||0)+' deadline overruns, '+(d.hgw.counts.errors||0)+' execution errors':'Collecting completed operations')+'</p><p>Contracts: '+e(d.contracts?.queued??0)+' queued · Validation: '+e(d.validation?.state??'waiting')+'</p><p>Budget priorities: '+e(d.budgets?.reasons?.join('; ')||'standard allowances')+'</p><p>Reset planner: '+e(d.speed?.reason||'waiting for evidence')+' · Estimated restart payback: '+e(d.speed?.paybackMs?Math.round(d.speed.paybackMs/60000)+' min':'unknown')+'</p><p>Backup: '+e(d.backup?.backup??'waiting')+'</p>':'Waiting for the automation supervisor…';
  await ns.sleep(5000);
 }
}
