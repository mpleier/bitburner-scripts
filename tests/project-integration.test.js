import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {main as sync,deployableSyncFile} from '../sync-scripts.js';
import {main as cleanup} from '../cleanup.js';
import {main as gitPull} from '../git-pull.js';
import {claimSpending} from '../spending-policy.js';
test('remote script sync handles network cycles and never copies remote files over home',async()=>{
 const copies=[];await sync({flags:()=>({restart:false}),disableLog(){},scan:h=>({home:['a','b'],a:['home','b'],b:['home','a']}[h]),ls:()=>['main.js','Tasks/helper.js','Temp/x.js','tasks/state.json','tests/a.js','scripts/check.js'],hasRootAccess:()=>true,scp:async(files,host,source)=>{copies.push({files,host,source});return true;},print(){}});
 assert.deepEqual(copies.map(v=>v.host),['a','b']);assert.ok(copies.every(v=>v.source==='home'));assert.deepEqual(copies[0].files,['main.js','Tasks/helper.js']);
});
test('sync excludes runtime artifacts while preserving actual Tasks helpers',()=>{
 for(const f of ['Temp/x.js','/Temp/x.js','tasks/x.js','remote-control/job.js','tests/a.js','scripts/check.js','node_modules/a.js','a.cct','a.txt'])assert.equal(deployableSyncFile(f),false);
 assert.equal(deployableSyncFile('Tasks/helper.js'),true);assert.equal(deployableSyncFile('Remote/hack-target.js'),true);
});
test('explicit sync restarts preserve threads and arguments and skip unrooted hosts',async()=>{
 const restarts=[];await sync({flags:()=>({restart:true}),disableLog(){},scan:h=>h==='home'?['a','b']:['home'],ls:()=>['worker.js'],hasRootAccess:h=>h==='a',scp:async()=>true,ps:()=>[{filename:'worker.js',threads:3,args:['x',2],pid:8}],kill:()=>true,exec:(...args)=>{restarts.push(args);return 9;},print(){}});
 assert.deepEqual(restarts,[['worker.js','a',3,'x',2]]);
});
test('failed remote sync never kills running workers',async()=>{
 await sync({flags:()=>({restart:true}),disableLog(){},scan:h=>h==='home'?['a']:['home'],ls:()=>['worker.js'],hasRootAccess:()=>true,scp:async()=>false,ps:()=>[{filename:'worker.js',pid:8}],kill:()=>assert.fail('must preserve worker'),print(){}});
});
test('temporary cleanup defers while home automation is active',async()=>{
 await cleanup({pid:1,ps:()=>[{pid:2,filename:'autopilot.js'}],print(){},rm:()=>assert.fail('must preserve runtime files')});
});
test('idle cleanup removes only the actual Temp directory',async()=>{
 const removed=[];await cleanup({pid:1,ps:()=>[{pid:1,filename:'cleanup.js'},{pid:2,filename:'remote-api-agent.js'}],ls:()=>['Temp/a.txt','/Temp/b.js','myTemp/data.txt','tasks/state.json','Tasks/helper.js'],rm:f=>{removed.push(f);return true;},print(){}});assert.deepEqual(removed,['Temp/a.txt','/Temp/b.js']);
});
test('git-pull filters tooling, deduplicates files and rewrites imports safely',async()=>{
 const old=globalThis.fetch,requests=[],downloads=[],files=new Map();
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('/contents/Tasks?')?[{type:'file',path:'Tasks/a.js'}]:[{type:'dir',path:'tests'},{type:'dir',path:'scripts'},{type:'dir',path:'Tasks'},{type:'file',path:'helpers.js'}]};};
 try{await gitPull({flags:s=>({...Object.fromEntries(s),subfolder:"folder'quoted",'new-file':['helpers.js']}),getScriptName:()=> 'git-pull.js',print(){},tprint(){},wget:async(url,file)=>{downloads.push(file);files.set(file,"const subfolder = '';\nimport { x } from './other.js';");return true;},read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),run:()=>0});}
 finally{globalThis.fetch=old;}
 assert.equal(requests.length,2);assert.equal(downloads.length,2);assert.ok(downloads.every(f=>!f.startsWith('/')));
 const source=files.get("folder'quoted/helpers.js");assert.doesNotThrow(()=>new Function(source.replace(/^import.*$/m,'')));assert.ok(source.includes(`from "folder'quoted/other.js"`));
});
test('GitHub listing failures keep local config and tooling files out of fallback downloads',async()=>{
 const old=globalThis.fetch,files=[];globalThis.fetch=async()=>({ok:false,status:429});
 try{await gitPull({flags:s=>Object.fromEntries(s),getScriptName:()=> 'git-pull.js',print(){},tprint(){},ls:()=>['main.js','main.js.config.txt','Temp/a.js','tests/a.js','scripts/a.js','Tasks/a.js'],wget:async(url,file)=>{files.push(file);return false;},run:()=>0});}finally{globalThis.fetch=old;}
 assert.deepEqual(files,['main.js','Tasks/a.js']);
});
test('malformed same-epoch spending counters recover without dropping cash limits',()=>{
 const plan={epoch:1,ownerPid:2,reset:3,expiresAt:Date.now()+10000,allowances:{home:20}},files=new Map([['tasks/spending-plan.json',JSON.stringify(plan)],['tasks/spending-usage.json','{"epoch":1,"spent":null}']]);
 const ns={read:f=>files.get(f)||'',getPlayer:()=>({money:100}),ps:()=>[{pid:2}],getResetInfo:()=>({lastAugReset:3}),write:(f,s)=>files.set(f,s)};
 assert.equal(claimSpending(ns,'home',10),true);assert.equal(claimSpending(ns,'home',11),false);
});
test('continuous managers check pause flags after startup',async()=>{
 for(const f of ['health-manager.js','grafting-manager.js','infiltration-manager.js','darknet-manager.js','corporation-manager.js','sleeve.js','soa-manager.js','spend-hacknet-hashes.js','stockmaster.js'])assert.match(await readFile(new URL('../'+f,import.meta.url),'utf8'),/while\s*\(!isScriptPaused\(ns,ns.getScriptName\(\)\)\)/);
});
