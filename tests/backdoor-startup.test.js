import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {backdoorHeadroom,backdoorCanLaunch,rankBackdoorTargets,discoverBackdoorNetwork,waitForBackdoorStart,collectBackdoorMetadata,shortcutBackdoorRoutes} from '../backdoor-policy.js';
import {torProgramsHandoff,infrastructureAffordable,infrastructureCashBand} from '../early-game-policy.js';
import {getBackdoorCandidates} from '../Tasks/backdoor-all-servers.js';
import {main as tor} from '../Tasks/tor-manager.js';
const reset={lastAugReset:1,lastNodeReset:2};
test('faction unlocks precede ordinary targets without mutating the input',()=>{
 const hosts=['n00dles','run4theh111z','fulcrumassets','I.I.I.I','avmnite-02h','CSEC','foodnstuff'];
 const original=[...hosts],ranked=rankBackdoorTargets(hosts,{n00dles:1,foodnstuff:1});
 assert.deepEqual(ranked,['CSEC','avmnite-02h','I.I.I.I','run4theh111z','fulcrumassets','foodnstuff','n00dles']);assert.deepEqual(hosts,original);
});
test('backdoor headroom scales down and explicit and global reserves remain authoritative',()=>{
 assert.equal(backdoorHeadroom(8),2);assert.equal(backdoorHeadroom(32),8);assert.equal(backdoorHeadroom(64),16);assert.equal(backdoorHeadroom(128),22);
 assert.equal(backdoorHeadroom(32,22),22);assert.equal(backdoorHeadroom(32,0),0);assert.equal(backdoorHeadroom(32,0,12),12);
 assert.equal(backdoorCanLaunch({maximum:32,free:11.6,worker:3.6}),true);
 for(const ram of [{maximum:32,free:11.59,worker:3.6},{maximum:32,free:32,worker:57.6},{maximum:32,free:32,worker:0}])assert.equal(backdoorCanLaunch(ram),false);
});
test('TOR purchase emits a reset-scoped handoff only after native success',async()=>{
 for(const success of [true,false]){
  const files={};await tor({pid:5,args:[],getScriptName:()=> 'Tasks/tor-manager.js',scan:()=>[],read:f=>files[f]||'',write:(f,s)=>files[f]=s,getResetInfo:()=>reset,
   getPlayer:()=>({money:500000}),singularity:{purchaseTor:()=>success},print(){}});
  const record=JSON.parse(files['tasks/infrastructure-tor-ready.json']||'null');assert.equal(!!record,success);
  if(success){assert.equal(torProgramsHandoff(record,null,reset),true);assert.equal(torProgramsHandoff(record,record.token,reset),false);}
 }
});
test('TOR handoffs reject old resets, future timestamps and expired notifications',()=>{
 const q={at:1000,token:'abc',augReset:1,nodeReset:2};assert.equal(torProgramsHandoff(q,null,reset,1001),true);
 for(const patch of [{at:2000},{at:-200000},{augReset:0},{nodeReset:0},{token:null}])assert.equal(torProgramsHandoff({...q,...patch},null,reset,1001),false);
});
async function manager({free=12,worker=3.6,failRoute=false,pause=false,connectError=false,shortcut=false,failShortcut=false,metadataFailure=false}={}){
 const s=await readFile(new URL('../Tasks/backdoor-all-servers.js',import.meta.url),'utf8'),begin=s.indexOf('export async function main(');
 let busy=false;const files={},launches=[],connections=[],paths=[],requests=[],ns={pid:7,getScriptName:()=> 'Tasks/backdoor-all-servers.js',read:f=>files[f]||'',rm:f=>delete files[f],isRunning:()=>true,kill(){},disableLog(){},print(){},run:(script,opts,target,path,token)=>{launches.push(target);free-=worker;files[path]=JSON.stringify({pid:1,target,token,state:'started'});if(pause)busy=true;return 1;},sleep:async()=>{if(pause)busy=true;}};
 const context={getBackdoorCandidates,rankBackdoorTargets,backdoorCanLaunch,discoverBackdoorNetwork,waitForBackdoorStart,collectBackdoorMetadata,shortcutBackdoorRoutes,activityBusy:()=>busy,isScriptPaused:()=>false,maintenanceRequested:()=>false,
  getConfiguration:()=>({'spawn-delay':0,'start-timeout':5000,'reserved-home-ram':null}),argsSchema:[],instanceCount:async()=>1,getFilePath:s=>s,log(){},getErrorInfo:String,
  getNsDataThroughFile:async(ns,cmd,file,args=[])=>{
   requests.push(file);
   if(cmd.includes('function discoverBackdoorNetwork'))return discoverBackdoorNetwork({scan:h=>shortcut?({home:['n00dles'],n00dles:['home','relay'],relay:['n00dles','CSEC'],CSEC:['relay']}[h]):h==='home'?['n00dles','CSEC']:['home']});
   if(cmd.includes('function collectBackdoorMetadata'))return collectBackdoorMetadata({getHackingLevel:()=>50,getServer:h=>{if(metadataFailure&&h==='CSEC')throw Error('Unavailable');return {requiredHackingSkill:h==='CSEC'?50:1,hasAdminRights:true,backdoorInstalled:shortcut&&h==='relay'};}},args);
   if(cmd==='ns.getHackingLevel()')return 50;
   if(cmd.includes('ns.scan'))return args[0]==='home'?['n00dles','CSEC']:['home'];
   if(cmd.includes('cloud.getServerNames'))return [];
   if(cmd.includes('getServerRequiredHackingLevel'))return {n00dles:1,CSEC:50};
   if(cmd.includes('hasRootAccess'))return {n00dles:true,CSEC:true};
   if(cmd.includes('backdoorInstalled'))return ['n00dles','CSEC'];
   if(cmd.includes('ns.ps()'))return [];
   if(cmd.includes('maximum:ns.getServerMaxRam'))return {maximum:32,free,worker};
   if(cmd.includes('ns.args.reduce')){if(connectError)throw Error('SF4 unavailable');connections.push(args.at(-1));paths.push([...args]);if(failShortcut&&args.length===3&&args[1]==='relay')return false;return !(failRoute&&args.at(-1)==='CSEC');}
   if(cmd.includes('ns.singularity.connect')){if(connectError)throw Error('SF4 unavailable');return true;}
   throw Error(cmd);
  }};
 vm.runInNewContext(s.slice(begin).replace('export async function','async function')+';globalThis.execute=main;',context);
 await context.execute(ns);return {launches,connections,paths,requests};
}
test('actual backdoor manager launches the faction target at exactly its required skill on 32 GB',async()=>{
 assert.deepEqual((await manager()).launches,['CSEC']);
 assert.deepEqual((await manager({worker:57.6,free:32})).launches,[]);
});
test('actual backdoor manager never installs after a failed connection and rechecks activity ownership',async()=>{
 assert.deepEqual((await manager({failRoute:true})).launches,['n00dles']);
 assert.deepEqual((await manager({free:32,pause:true})).launches,['CSEC']);
});
test('scheduler consumes a TOR handoff after success and retries RAM failures without the 26-second wait',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8'),a=s.indexOf('    async function runPeriodicScripts('),b=s.indexOf('    async function tryRunTool(',a),body=s.slice(a,b);
 let now=100000,attempts=0;const record={at:100000,token:'tor:1',augReset:1,nodeReset:2};
 const script={name:'programs',infrastructure:true,infrastructureKind:'programs',interval:26000,lastRun:99000,lastCashBand:4};
 const context={periodicScripts:[script],resetInfo:reset,Date:{now:()=>now},torProgramsHandoff,infrastructureAffordable,infrastructureCashBand,getPlayerMoney:()=>1e6,
  getTool:s=>s,tryRunTool:async()=>++attempts>1,dictSourceFiles:{},options:{}};
 const ns={read:f=>f.includes('tor-ready')?JSON.stringify(record):f.includes('infrastructure')?'null':'0',sleep:async()=>{}};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.execute=runPeriodicScripts;',context);
 await context.execute(ns);assert.equal(attempts,1);assert.equal(script.lastTorToken,undefined);
 now+=1000;await context.execute(ns);assert.equal(attempts,2);assert.equal(script.lastTorToken,'tor:1');
 now+=1000;await context.execute(ns);assert.equal(attempts,2);
});

test('daemon reset cache is declared in the shared controller scope rather than shadowed inside startup',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 const declaration=s.indexOf('    let resetInfo = {};'),startup=s.indexOf('    async function startup(');
 assert.ok(declaration>0&&declaration<startup);
 assert.equal((s.match(/let resetInfo/g)||[]).length,1);
 assert.match(s,/resetInfo = await getNsDataThroughFile\(ns, `ns.getResetInfo\(\)`\)/);
});

test('failed native connection cleanup remains graceful when Singularity is unavailable',async()=>{
 await assert.doesNotReject(()=>manager({connectError:true}));
});

test('actual manager uses one metadata helper instead of separate skill, root and installed checks',async()=>{
 const h=await manager();assert.equal(h.requests.filter(p=>p==='/Temp/backdoor-metadata.txt').length,1);
 for(const p of ['/Temp/getServerRequiredHackingLevel-all.txt','/Temp/hasRootAccess-all.txt','/Temp/getServers-where-not-backdoorInstalled.txt'])assert.equal(h.requests.includes(p),false);
});
test('actual manager uses installed shortcuts and retries the full route on shortcut failure',async()=>{
 const h=await manager({shortcut:true});assert.deepEqual(h.paths[0],['home','relay','CSEC']);
 const failed=await manager({shortcut:true,failShortcut:true});
 assert.deepEqual(failed.paths,[['home','relay','CSEC'],['home','n00dles','relay','CSEC']]);assert.deepEqual(failed.launches,['CSEC']);
});
test('an unreadable faction server does not block other eligible backdoors',async()=>{
 assert.deepEqual((await manager({metadataFailure:true})).launches,['n00dles']);
});
