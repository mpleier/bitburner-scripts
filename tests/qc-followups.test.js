import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controllerReloadBlocked} from '../runtime-policy.js';
import {boundedDiagnostics} from '../diagnostics-policy.js';
import {renderCommandJob,validateCommand,commandPolicyVersion} from '../remote-api-command.js';
const command=(method,args=[])=>({id:'qc',method,args,expiresAt:Date.now()+60000});
test('only independent controllers reload during soft protected work',()=>{
 for(const script of ['stockmaster.js','gangs.js','corporation-manager.js','stats.js'])assert.equal(controllerReloadBlocked(script,{protectedWork:true}),false);
 for(const script of ['autopilot.js','daemon.js','bladeburner.js','sleeve.js','grafting-manager.js','unknown.js'])assert.equal(controllerReloadBlocked(script,{protectedWork:true}),true);
});
test('hard activity, transitions and unknown protection block even independent reloads',()=>{
 for(const script of ['stockmaster.js','gangs.js','corporation-manager.js','daemon.js'])assert.equal(controllerReloadBlocked(script,{globalProtection:true}),true);
 assert.equal(controllerReloadBlocked('stats.js',{globalProtection:true}),false);
 assert.equal(controllerReloadBlocked('/daemon.js',{drainProtected:true}),true);
 assert.equal(controllerReloadBlocked('gangs.js',{drainProtected:true}),false);
 assert.equal(controllerReloadBlocked('autopilot.js'),false);
});
test('supervisor applies per-controller guard while preserving activity and RAM guards',()=>{
 const s=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');
 assert.match(s,/protectedWork:reloadBlocked\(script\)/);assert.match(s,/if\(reloadBlocked\(job.filename\)\)continue/);
 assert.match(s,/globalProtection:globalProtection\|\|!protectionKnown/);
 assert.match(s,/if\(activityRecord\(ns\)&&job.filename!=='stats.js'\)break/);
 assert.match(s,/automationReloadReady\(ns,job,homeRamReserve\(ns\)\)/);
});
test('compact diagnostics omit bulk logs and file inventories but retain current counters',()=>{
 const r=boundedDiagnostics({hgw:{counts:{operations:10,errors:0},recent:Array(100).fill('x')},dashboard:{at:10,logs:Array(100).fill('x'),fileAudit:{allNames:Array(100).fill('x')},pending:['gangs.js']}});
 assert.equal(r.hgw.counts.operations,10);assert.equal(r.dashboard.at,10);assert.equal(r.dashboard.logs,undefined);assert.equal(r.dashboard.fileAudit,undefined);assert.equal(r.hgw.recent,undefined);
 assert.equal(r._diagnostics.truncated,true);assert.ok(r._diagnostics.details.includes('automation.logs'));
});
test('diagnostics respect actual UTF-8 byte limits including escaping and metadata',()=>{
 const fixture=Object.fromEntries(Array.from({length:32},(_,i)=>['key'+i,Array.from({length:128},()=>({unicode:'🙂'.repeat(1000),escaped:'\n"'.repeat(1000)}))]));
 for(const compact of [true,false])for(const size of [4096,65536]){const r=boundedDiagnostics(fixture,compact,size);assert.ok(Buffer.byteLength(JSON.stringify(r))<=size);assert.equal(r._diagnostics.truncated,true);}
});
test('diagnostics bound circular input, deep values and excessive keys',()=>{
 const circular={x:1};circular.self=circular;const r=boundedDiagnostics(circular);assert.equal(r.x,1);assert.deepEqual(r.self,{truncated:true});
 const deep={};let p=deep;for(let i=0;i<100;i++)p=p.child={};assert.ok(JSON.stringify(boundedDiagnostics(deep)).length<2000);
 const keys=Object.fromEntries(Array.from({length:2000},(_,i)=>['a'+i,i]));assert.ok(Object.keys(boundedDiagnostics(keys)).length<=33);
});
test('detailed logs and files use narrow validated arguments',()=>{
 assert.equal(commandPolicyVersion,21);
 for(const c of [command('automation.logs'),command('automation.logs',['daemon.js']),command('automation.files',[0,100])])assert.doesNotThrow(()=>validateCommand(c));
 for(const c of [command('automation.logs',['secret.txt']),command('automation.files',[-1]),command('automation.files',[0,101]),command('automation.files',[0,1.1]),command('automation.status',['full']),command('getFile',['x'])])assert.throws(()=>validateCommand(c));
});
async function execute(method,args,files){let result;const code=renderCommandJob(command(method,args));const worker=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));await worker.main({args:[JSON.stringify(args),'result','qc'],read:f=>files[f]?JSON.stringify(files[f]):'',write:async(_,s)=>{result=JSON.parse(s);}});return result;}
test('generated default status preserves compatible fields and hides detailed logs',async()=>{
 const r=await execute('automation.status',[],{'tasks/automation-status.json':{},'tasks/dashboard.json':{at:10,logs:[{lines:['large']}],fileAudit:{allNames:['runtime']}}});
 assert.equal(r.state,'completed');assert.deepEqual(r.result.automation,{});assert.equal(r.result.dashboard.logs,undefined);
 assert.ok(Buffer.byteLength(JSON.stringify(r))<65536);
});
test('generated log query filters managed scripts and retains only recent lines',async()=>{
 const r=await execute('automation.logs',['daemon.js'],{'tasks/dashboard.json':{at:10,logs:[{script:'daemon.js',lines:Array.from({length:100},(_,i)=>String(i))},{script:'gangs.js',lines:['other']}]}});
 assert.equal(r.state,'completed');assert.equal(r.result.logs.length,1);assert.equal(r.result.logs[0].lines.length,20);assert.equal(r.result.logs[0].lines[0],'80');
});
test('generated file audit supports bounded pagination and absent snapshots',async()=>{
 const r=await execute('automation.files',[10,5],{'tasks/dashboard.json':{fileAudit:{at:10,files:Array.from({length:20},(_,i)=>({filename:String(i),hash:'x'}))}}});
 assert.equal(r.result.total,20);assert.equal(r.result.nextOffset,15);assert.equal(r.result.files[0].filename,'10');assert.equal(r.result.files.length,5);
 const absent=await execute('automation.files',[],{});assert.equal(absent.result.total,0);assert.equal(absent.result.nextOffset,null);
});
