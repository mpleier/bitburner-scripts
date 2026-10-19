import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {moduleManifest,priorityManagerPlan,runtimeScripts,statusFiles,automaticManagerScripts,watchedScripts} from '../automation-manifest.js';
import {managedScripts,diagnosticScripts,validateCommand} from '../remote-api-command-policy.js';
import {collectAutomationPreview,previewOptions} from '../automation-preview-policy.js';
import {main as autopilot} from '../autopilot.js';
import {main as previewMain} from '../automation-preview.js';
import {renderCommandJob} from '../remote-api-command.js';
const now=1000000;
function fixture({ram=64,used=8,sources={4:3,6:1,9:1,10:1},node=7,processes=[]}={}){
 const files={},output=[],calls=[];
 const allowed={pid:5,args:['--dry-run'],read:f=>files[f]||'',getResetInfo:()=>({currentNode:node,lastNodeReset:100,lastAugReset:200,ownedSF:new Map(Object.entries(sources).map(([k,v])=>[Number(k),v]))}),
  getPlayer:()=>({money:10000}),getServerMaxRam:h=>h==='home'?ram:1024,getServerUsedRam:h=>h==='home'?used:100,ps:()=>processes,
  fileExists:()=>true,getScriptRam:()=>2,hasRootAccess:()=>true,scan:h=>h==='home'?['remote']:['home'],
  flags:s=>Object.fromEntries(s),tprint:m=>output.push(m)};
 const ns=new Proxy(allowed,{get:(target,key)=>{
  if(key in target)return target[key];throw Error('Unexpected or mutating API: '+String(key));
 }});
 return {ns,files,output,calls,allowed,processes};
}
test('manifest entries are unique, immutable, deployed files with valid status paths',()=>{
 assert.equal(new Set(moduleManifest.map(m=>m.script)).size,moduleManifest.length);assert.equal(Object.isFrozen(moduleManifest),true);
 for(const m of moduleManifest){assert.equal(Object.isFrozen(m),true);assert.ok(existsSync(new URL('../'+m.script,import.meta.url)),m.script);if(m.statusFile)assert.match(m.statusFile,/^tasks\/.+\.json$/);}
 assert.deepEqual(moduleManifest.filter(m=>!m.homeOnly).map(m=>m.script),['Tasks/contractor.js.solver.js','Remote/share.js']);assert.equal(moduleManifest.find(m=>m.script==='Tasks/contractor.js.solver.js').requiresLease,true);
});
test('supervision, API permissions, diagnostics and automatic starts derive from the same registry',()=>{
 assert.deepEqual(runtimeScripts,moduleManifest.filter(m=>m.supervised).map(m=>m.script));
 assert.deepEqual(managedScripts,moduleManifest.filter(m=>m.remoteControl).map(m=>m.script));
 assert.deepEqual(diagnosticScripts,moduleManifest.filter(m=>m.diagnostic).map(m=>m.script));
 assert.deepEqual(watchedScripts,moduleManifest.filter(m=>m.watched).map(m=>m.script));assert.ok(watchedScripts.includes('stats.js'));
 assert.equal(statusFiles['contract-validation.js'],'tasks/contract-validation.json');
 assert.equal(automaticManagerScripts.length,12);assert.equal(automaticManagerScripts[2],'achievement-manager.js');
 for(const file of ['host-manager.js','Tasks/ram-manager.js','Tasks/contractor.js','Tasks/contractor.js.solver.js','automation-preview.js'])assert.ok(diagnosticScripts.includes(file));
 assert.ok(diagnosticScripts.length<=32);
});
test('diagnostic additions do not expand remote start and stop permissions',()=>{
 for(const script of ['host-manager.js','automation-preview.js','Tasks/ram-manager.js']){
  assert.doesNotThrow(()=>validateCommand({id:'t',method:'automation.preflight',args:[script],expiresAt:Date.now()+10000}));
  assert.throws(()=>validateCommand({id:'t',method:'start',args:[script],expiresAt:Date.now()+10000}));
 }
 assert.doesNotThrow(()=>validateCommand({id:'t',method:'automation.preview',args:[],expiresAt:Date.now()+10000}));
 assert.throws(()=>validateCommand({id:'t',method:'automation.preview',args:['run'],expiresAt:Date.now()+10000}));
});
test('shared startup gates preserve priority, RAM, source files, explicit disables and corporation uncertainty',()=>{
 const plan=args=>new Map(priorityManagerPlan(args).map(m=>[m.name,m.enabled]));
 const small=plan({homeRam:32,sourceFiles:{4:3,10:1},node:10});assert.equal(small.get('go.js'),true);assert.equal(small.get('bladeburner.js'),false);assert.equal(small.get('sleeve.js'),true);assert.equal(small.get('sleeve-expansion.js'),true);
 const full=plan({homeRam:1024,sourceFiles:{4:3,6:1,9:1,10:1},options:{'disable-go':true,'disable-infiltration':true,'disable-achievements':true,'disable-bladeburner':true},corporationReady:false,corporationKnown:false,corporationRunning:true});
 for(const name of ['go.js','infiltration-manager.js','achievement-manager.js','bladeburner.js'])assert.equal(full.get(name),false);
 assert.equal(full.get('corporation-manager.js'),true);assert.equal(full.get('grafting-manager.js'),true);assert.equal(full.get('spend-hacknet-hashes.js'),true);
 assert.equal(plan({homeRam:64,sourceFiles:{6:1},bladeburnerRank:0}).get('bladeburner.js'),false);
});
test('preview works with only read APIs and separates running, paused, locked and planned launches',()=>{
 const f=fixture({processes:[{filename:'stats.js',pid:3}]});f.files['remote-control/paused/go.js.txt']='true';
 const p=collectAutomationPreview(f.ns,{},now),state=name=>p.managers.find(m=>m.script===name).state;
 assert.equal(p.readOnly,true);assert.equal(state('stats.js'),'running');assert.equal(state('go.js'),'paused');assert.equal(state('sleeve-expansion.js'),'locked-or-disabled');assert.equal(state('bladeburner.js'),'would-start');
 assert.equal(p.placements[0].host,'remote');assert.equal(p.placements[0].state,'requires-home-owned-lease');assert.match(p.limitations,/not purchase orders/);
});
test('preview detects low RAM, native compile errors, paused launch and missing scripts',()=>{
 const f=fixture({ram:32,used:31});f.allowed.getScriptRam=name=>name==='stats.js'?0:2;
 const p=collectAutomationPreview(f.ns,{},now);assert.equal(p.managers.find(m=>m.script==='reliability-manager.js').state,'waiting-for-ram');assert.equal(p.managers.find(m=>m.script==='stats.js').state,'missing-or-invalid');
});
test('preview honors source-file overrides including explicit zero and current node access',()=>{
 const f=fixture({sources:{4:3,6:1}}),base=f.allowed.getResetInfo;f.allowed.getResetInfo=()=>({...base(),bitNodeOptions:{sourceFileOverrides:new Map([[4,0],[6,0],[7,0]])}});
 const p=collectAutomationPreview(f.ns,{},now);assert.equal(p.managers.find(m=>m.script==='bladeburner.js').state,'locked-or-disabled');assert.equal(p.managers.find(m=>m.script==='work-for-factions.js').state,'locked-or-disabled');
});
test('preview shows only current owned spending plans and accounts for used allowance',()=>{
 const f=fixture({processes:[{filename:'autopilot.js',pid:7}]});f.files['tasks/spending-plan.json']=JSON.stringify({epoch:now-10,expiresAt:now+60000,reset:200,ownerPid:7,allowances:{home:1000,servers:200}});
 f.files['tasks/spending-usage.json']=JSON.stringify({epoch:now-10,spent:{home:400,servers:1000}});
 let p=collectAutomationPreview(f.ns,{},now);assert.equal(p.evidence.budget,'current');assert.equal(p.budgets.find(b=>b.category==='home').remaining,600);assert.equal(p.budgets.find(b=>b.category==='servers').remaining,0);
 for(const patch of [{reset:100},{expiresAt:now-1},{epoch:now+1},{ownerPid:100}]){
  f.files['tasks/spending-plan.json']=JSON.stringify({epoch:now-10,expiresAt:now+60000,reset:200,ownerPid:7,allowances:{home:1000},...patch});assert.equal(collectAutomationPreview(f.ns,{},now).evidence.budget,'unavailable');
 }
});
test('preview only uses fresh same-reset infrastructure quotes and never calls purchase APIs',()=>{
 const f=fixture();f.files['tasks/infrastructure-ram.json']=JSON.stringify({at:now,augReset:200,nodeReset:100,cost:20000,budget:.5});
 let p=collectAutomationPreview(f.ns,{},now);assert.equal(p.purchases[0].state,'cash-reserved');
 for(const patch of [{at:now-300001},{at:now+1},{augReset:1},{nodeReset:1}]){
  f.files['tasks/infrastructure-ram.json']=JSON.stringify({at:now,augReset:200,nodeReset:100,cost:10,...patch});assert.equal(collectAutomationPreview(f.ns,{},now).purchases.length,0);
 }
});
test('preview reports maintenance without claiming a launch or touching its lease',()=>{
 const f=fixture({processes:[{pid:7,filename:'reliability-manager.js'}]});f.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:7,expiresAt:now+1000});
 assert.equal(collectAutomationPreview(f.ns,{},now).managers.find(m=>m.script==='remote-api-agent.js').state,'maintenance');
});
test('autopilot dry-run returns before registration, writes, launch hooks, purchases and resets',async()=>{
 for(const flag of ['--dry-run','--preview']){
  const f=fixture();f.allowed.args=[flag];await autopilot(f.ns);assert.ok(f.output[0].includes('read only'));assert.ok(f.output.some(line=>line.startsWith('bladeburner.js:')));
 }
});
test('preview configuration is read without persistence and explicit flags win',()=>{
 const f=fixture();f.files['autopilot.js.config.txt']=JSON.stringify([['disable-go',true]]);
 f.allowed.flags=s=>({...Object.fromEntries(s),'disable-go':false});assert.equal(previewOptions(f.ns,[['disable-go',false]])['disable-go'],false);
 f.files['autopilot.js.config.txt']='invalid';assert.throws(()=>previewOptions(f.ns,[['disable-go',false]]));
});
test('standalone JSON preview reads saved settings and has no mutation APIs',async()=>{
 const f=fixture();f.allowed.flags=()=>({json:true});f.files['autopilot.js.config.txt']=JSON.stringify({'disable-go':true});await previewMain(f.ns);
 const p=JSON.parse(f.output[0]);assert.equal(p.readOnly,true);assert.equal(p.managers.find(m=>m.script==='go.js').state,'locked-or-disabled');
});
test('generated Remote API preview is self-contained and writes only its transport response',async()=>{
 const f=fixture(),writes=[];const command={id:'preview-qc',method:'automation.preview',args:[],expiresAt:Date.now()+60000};
 const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(command)).toString('base64'));
 f.allowed.args=['[]','remote-control/results/qc.json','preview-qc'];f.allowed.write=async(file,text)=>{assert.equal(file,'remote-control/results/qc.json');writes.push(JSON.parse(text));};
 await job.main(f.ns);assert.equal(writes.at(-1).state,'completed',writes.at(-1).error);assert.equal(writes.at(-1).result.readOnly,true);assert.ok(writes.at(-1).result.managers.length>0);
});
test('manifest command validation stays import-free for listener hot reload',()=>{
 const text=readFileSync(new URL('../remote-api-command-policy.js',import.meta.url),'utf8');assert.doesNotMatch(text,/^import\s/m);
 const autopilotText=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');assert.match(autopilotText,/const priorityManagers = priorityManagerPlan\(/);assert.match(autopilotText,/for \(const manager of automaticManagerScripts\)/);
});

test('saved dry-run mode is honored before any startup hook',async()=>{
 for(const config of [{'dry-run':true},[['preview',true]]]){
  const f=fixture();f.allowed.args=[];f.files['autopilot.js.config.txt']=JSON.stringify(config);await autopilot(f.ns);assert.ok(f.output[0].includes('read only'));
 }
});

test('preview respects current live-owner cooldowns without trusting old resets',()=>{
 const f=fixture({processes:[{pid:7,filename:'autopilot.js'}]});
 const record={at:now,augReset:200,nodeReset:100,ownerPid:7,managers:[{script:'bladeburner.js',state:'restart-cooldown',cooldownUntil:now+30000}]};
 f.files['tasks/automation-status.json']=JSON.stringify(record);assert.equal(collectAutomationPreview(f.ns,{},now).managers.find(m=>m.script==='bladeburner.js').state,'restart-cooldown');
 for(const patch of [{augReset:1},{nodeReset:1},{ownerPid:999},{at:now-30001}]){
  f.files['tasks/automation-status.json']=JSON.stringify({...record,...patch});assert.notEqual(collectAutomationPreview(f.ns,{},now).managers.find(m=>m.script==='bladeburner.js').state,'restart-cooldown');
 }
});
