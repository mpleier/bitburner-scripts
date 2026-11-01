import test from 'node:test';
import assert from 'node:assert/strict';
import {yieldDarknetLoot,readLootYield,clearLootYield,lootYieldFile,solverProgressFingerprint,packSolverProgress} from '../darknet-throughput-policy.js';
import {main as lootMain} from '../darknet-loot.js';
import {main as scout} from '../darknet-node.js';
import {electMazeLeases,mazeLeaseIdentity} from '../darknet-development-policy.js';
import {stormBlockerDetails,observeStormBlocker,planStorm} from '../darknet-storm-policy.js';
test('one loot thread finishes an in-flight payout before a priority job obtains RAM',async()=>{
 const files=new Map([['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]);let finish,started,used=14.6,active=true,paid=false;
 const ready=new Promise(resolve=>started=resolve),action=new Promise(resolve=>finish=resolve);
 const ns={pid:42,getHostname:()=> 'darkweb',disableLog(){},getRunningScript:()=>({threads:1}),ls:()=>[],read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),rm:async f=>files.delete(f),print(){},getServerMaxRam:()=>16,getServerUsedRam:()=>used,getScriptRam:()=>6.15,ps:()=>active?[{filename:'darknet-loot.js',threads:1,pid:42}]:[],kill:()=>assert.fail('must never kill a payout'),sleep:()=>assert.fail('should yield after completing payout'),dnet:{phishingAttack:async()=>{started();await action;paid=true;return {success:true};}}};
 const running=lootMain(ns);await ready;
 assert.equal(await yieldDarknetLoot(ns,4,'anchor'),false);assert.equal(paid,false);assert.equal(readLootYield(files.get(lootYieldFile)).reason,'anchor');
 finish();await running;assert.equal(paid,true);active=false;used=8.45;
 assert.equal(await yieldDarknetLoot(ns,4,'anchor'),true);await clearLootYield(ns,'anchor');assert.equal(files.has(lootYieldFile),false);
});
test('yield requests respect priority, expire, and do not interrupt loot when RAM cannot fit',async()=>{
 const now=100000,files=new Map();const ns={getHostname:()=> 'a',getServerMaxRam:()=>16,getServerUsedRam:()=>15,getScriptRam:()=>6,ps:()=>[{filename:'darknet-loot.js',threads:1,pid:7}],read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v)};
 assert.equal(await yieldDarknetLoot(ns,8,'anchor',now),false);assert.equal(files.size,0);
 await yieldDarknetLoot(ns,4,'anchor',now);const original=files.get(lootYieldFile);
 await yieldDarknetLoot(ns,4,'migration',now);assert.equal(files.get(lootYieldFile),original);
 ns.getServerUsedRam=()=>8.45;assert.equal(await yieldDarknetLoot(ns,4,'migration',now),false);assert.equal(await yieldDarknetLoot(ns,4,'migration',now+45001),true);ns.getServerUsedRam=()=>15;
 assert.equal(readLootYield(original,now+45001),null);
 for(const reason of ['promotion','migration']){files.clear();await yieldDarknetLoot(ns,4,reason,now);assert.equal(readLootYield(files.get(lootYieldFile),now).reason,reason);}
 files.clear();await yieldDarknetLoot(ns,4,'cache',now);assert.equal(readLootYield(files.get(lootYieldFile),now).reason,'cache');
 const held=files.get(lootYieldFile);await yieldDarknetLoot(ns,4,'migration',now);assert.equal(files.get(lootYieldFile),held);
});
test('grant renewals preserve identity while owner or manager changes invalidate it',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},now=100000,scope=[1,2,'target'],report={host:'origin',pid:7,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now}]};
 const first=electMazeLeases(null,[report],reset,3,now),next=electMazeLeases(first,[{...report,at:now+30000,mazeRequests:[{maze:'target',scope,at:now+30000}]}],reset,3,now+30000);
 assert.equal(mazeLeaseIdentity(first.leases[0]),mazeLeaseIdentity(next.leases[0]));assert.notEqual(mazeLeaseIdentity(first.leases[0]),mazeLeaseIdentity({...next.leases[0],managerPid:4}));
});
test('checkpoint timestamps do not reset quiet time; actual solver movement does',()=>{
 const now=100000,state={feedback:{checkpointAt:now,index:1,seen:new Set(['a']),map:new Map([['a',2n]])}},before=solverProgressFingerprint(state);
 state.feedback.checkpointAt+=30000;assert.equal(solverProgressFingerprint(state),before);
 const row=(at,progress)=>({host:'seed',pid:1,at,version:1,live:true,busy:false,blockedRam:0,caches:0,contracts:0,seed:true,neighbours:[],solverProgress:progress});
 const first=planStorm([row(now,before)],['seed'],{},now,1);
 const settled=planStorm([row(now+30000,solverProgressFingerprint(state))],['seed'],first.state,now+30000,1);assert.equal(settled.launch,true);
 state.feedback.index++;const changed=planStorm([row(now+30000,solverProgressFingerprint(state))],['seed'],first.state,now+30000,1);assert.equal(changed.launch,false);
});
test('blocker explanations distinguish work and rewards and track uninterrupted observed age',()=>{
 const now=100000,report={at:now-2000,live:true,busy:true,workReasons:['cracking','maintenance hold','untrusted'],blockedRam:4,caches:2,contracts:1,neighbours:[]};
 const details=stormBlockerDetails('target',report,now);assert.deepEqual(details.reasons,['cracking','maintenance hold','blocked RAM 4 GB','2 caches','1 contracts']);assert.equal(details.reportAgeMs,2000);
 const first=observeStormBlocker(null,details,now),next=observeStormBlocker(first,details,now+30000);assert.equal(next.since,now);
 assert.equal(observeStormBlocker(first,details,now+90001).since,now+90001);assert.equal(observeStormBlocker(next,{...details,host:'other'},now+40000).since,now+40000);
 assert.deepEqual(stormBlockerDetails('missing',null,now).reasons,['missing survey']);
});
test('executed scout restores once per grant and uploads only changed dictionary progress',async()=>{
 const now=Date.now(),scope=[1,2,'target','dictionary',1,'numeric',''],reset={lastNodeReset:1,lastAugReset:2};
 const lease=electMazeLeases(null,[{host:'origin',pid:7,at:now,live:true,neighbours:['target'],mazeRequests:[{maze:'target',scope,at:now}]}],reset,1,now);
 const checkpoint='tasks/dnet-solver-target.json',files=new Map([['tasks/dnet-maze-leases.json',JSON.stringify(lease)],['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})],[checkpoint,packSolverProgress(scope,{feedback:{},candidates:{}})]]);
 let downloads=0,uploads=0,attempts=0,passes=0;const stop=Error('stop'),messages=[];
 const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>files.has(f),scp:async(f,_to,from)=>{if(f===checkpoint){if(from==='home')downloads++;else uploads++;}return true;},isRunning:()=>true,ps:()=>[],hasRootAccess:()=>true,getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{passes++;if(passes===3){lease.leases[0].managerPid=2;files.set('tasks/dnet-maze-leases.json',JSON.stringify(lease));}if(passes>=4)throw stop;},
  dnet:{probe:()=>['target'],getServerDetails:h=>h==='target'?{modelId:'dictionary',passwordLength:1,passwordFormat:'numeric',data:'',blockedRam:0,hasSession:false,requiredCharismaSkill:0}:{depth:0,difficulty:0},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0,getServerRequiredCharismaLevel:()=>Infinity,authenticate:async()=>{attempts++;return {success:false,code:401};}}};
 await assert.rejects(scout(ns),e=>e===stop);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
 assert.equal(attempts,10);assert.equal(downloads,2);assert.equal(uploads,2);
});
test('pending priority handoff prevents a new loot launch while its RAM is reserved',async()=>{
 const now=Date.now(),files=new Map([['darknet-loot.js','/* managed loot */'],[lootYieldFile,JSON.stringify({pid:42,at:now,expiresAt:now+45000,reason:'migration'})]]),stop=Error('stop'),messages=[];
 const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>files.has(f),scp:async()=>true,isRunning:()=>true,ps:()=>[],hasRootAccess:()=>true,getServerMaxRam:()=>16,getServerUsedRam:()=>8.45,getScriptRam:()=>6.15,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{throw stop;},exec:()=>assert.fail('reserved RAM must not be consumed by a new loot worker'),
  dnet:{probe:()=>[],getServerDetails:()=>({depth:0,difficulty:0}),getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0}};
 await assert.rejects(scout(ns),e=>e===stop);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
 const survey=JSON.parse(files.get('tasks/dnet-survey-origin.json'));assert.equal(survey.busy,true);assert.ok(survey.workReasons.includes('priority RAM handoff'));
});

