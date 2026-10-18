import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {scriptSignature,registerAutomation,automationHeartbeat,maintenanceRequested,recoveryDecision,dashboardRows} from '../runtime-policy.js';
import {spendingPlan,adaptiveBudgetSignals} from '../spending-policy.js';
const data={record:{signature:'old',at:300000},signature:'new',observedAt:0,now:300000,script:'sleeve.js'};
test('updates, stale heartbeats, grace periods, pauses and restart limits are distinguished',()=>{
 assert.equal(recoveryDecision(data),'reload');assert.equal(recoveryDecision({...data,signature:'old',record:{signature:'old',at:1}}),'restart-stalled');
 assert.equal(recoveryDecision({...data,protectedWork:true}),'deferred-protected-work');assert.equal(recoveryDecision({...data,paused:true}),'paused');assert.equal(recoveryDecision({...data,attempts:3}),'recovery-limit');assert.equal(recoveryDecision({...data,observedAt:290000}),'starting');
});
test('long-running Go games have a longer stale threshold than ordinary managers',()=>{
 const d={...data,signature:'old',record:{signature:'old',at:1000},now:600000};assert.equal(recoveryDecision({...d,script:'go.js'}),'healthy');assert.equal(recoveryDecision({...d,script:'sleeve.js'}),'restart-stalled');
});
test('dependency signatures resolve nested imports and stop at cycles',()=>{
 const files={'a.js':"import {x} from './sub/b.js';",'sub/b.js':"import {x} from '../a.js';",'unused.js':'1'},ns={read:f=>files[f]||''},initial=scriptSignature(ns,'a.js');files['unused.js']='2';assert.equal(scriptSignature(ns,'a.js'),initial);files['sub/b.js']+='changed';assert.notEqual(scriptSignature(ns,'a.js'),initial);
});
test('registration and heartbeat records carry process identity and the loaded signature',()=>{
 const files=new Map(),ns={pid:123,getScriptName:()=> 'demo.js',read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s)};registerAutomation(ns);automationHeartbeat(ns);const r=JSON.parse(files.get('tasks/runtime/123.json'));assert.equal(r.pid,123);assert.equal(r.script,'demo.js');assert.ok(r.signature);assert.ok(r.at>=r.startedAt);
});
test('cooperative maintenance expires and requires a live owner',()=>{
 let alive=true,record={ownerPid:1,expiresAt:Date.now()+1000};const ns={read:()=>JSON.stringify(record),isRunning:()=>alive};assert.equal(maintenanceRequested(ns),true);alive=false;assert.equal(maintenanceRequested(ns),false);alive=true;record.expiresAt=1;assert.equal(maintenanceRequested(ns),false);
});
test('adaptive allowances remain inside available cash and fund corporation creation',()=>{
 const p=spendingPlan({money:200e9,reserve:10e9,homeRam:128,node:1,signals:{corporationStartup:true,gangStalled:true,sleeveShockHigh:true}});assert.ok(p.allowances.corporation>=150e9);assert.ok(Math.abs(Object.values(p.allowances).reduce((a,b)=>a+b,0)-190e9)<.001);assert.equal(p.reasons.length,3);
});
test('gang bottleneck signals persist until territory improves and ignore old node data',()=>{
 const now=Date.now(),files=new Map([['tasks/gang-status.json',JSON.stringify({pid:1,at:now,memberCount:12,info:{territory:.2}})],['tasks/budget-progress.json',JSON.stringify({at:now-21*60000,nodeReset:3,territory:.2})]]),ns={read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),isRunning:()=>true,getResetInfo:()=>({lastNodeReset:3})};
 assert.equal(adaptiveBudgetSignals(ns).gangStalled,true);assert.equal(adaptiveBudgetSignals(ns).gangStalled,true);
 files.set('tasks/gang-status.json',JSON.stringify({pid:1,at:now,memberCount:12,info:{territory:.3}}));assert.equal(adaptiveBudgetSignals(ns).gangStalled,false);
});
test('dashboard exposes current manager state and waiting reasons',()=>{
 const rows=dashboardRows([{pid:1,filename:'sleeve.js'}],f=>f==='tasks/sleeve-status.json'?{at:10,status:'waiting',reason:'shock'}:null,100);const row=rows.find(r=>r.script==='sleeve.js');assert.equal(row.state,'waiting');assert.equal(row.reason,'shock');assert.equal(row.ageMs,90);
});
test('supervisor restores original arguments, defers protected work and uses bounded recovery',async()=>{
 const s=await readFile(new URL('../reliability-manager.js',import.meta.url),'utf8');assert.ok(s.includes('ns.run(job.filename,job.threads,...job.args)'));assert.ok(s.includes("protectedWork:reloadBlocked(script)"));assert.ok(s.includes("if(reloadBlocked(job.filename))continue;"));assert.ok(s.includes('job.history.count>=3'));assert.ok(s.includes("if(activityRecord(ns)&&job.filename!=='stats.js')break;"));
});
test('infiltration, grafting and Bladeburner cooperate before starting new protected work',async()=>{
 for(const file of ['infiltration-manager.js','grafting-manager.js','bladeburner.js'])assert.ok((await readFile(new URL('../'+file,import.meta.url),'utf8')).includes('maintenanceRequested(ns)'));
});
