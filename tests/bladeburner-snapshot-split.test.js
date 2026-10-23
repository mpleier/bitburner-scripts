import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerSnapshotPlan,mergeBladeburnerSnapshots,readBladeburnerSnapshot} from '../bladeburner-snapshot-policy.js';
import {bladeburnerSnapshotWorkers,bladeburnerSnapshotBatch} from '../bladeburner-snapshot-source.js';
import {buildBladeburnerSnapshotCatalog} from '../scripts/generate-bladeburner-snapshot.js';
import {apiReferences,estimateRam} from '../scripts/audit-core.js';
import {nativeBladeburnerSnapshotPreflight} from '../native-preflight-policy.js';
import {validateCommand} from '../remote-api-command-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const reset={lastNodeReset:1,lastAugReset:2};
function fixture(free=32){
 const player={hp:{current:100,max:100},entropy:0,skills:Object.fromEntries(['hacking','strength','defense','dexterity','agility','charisma','intelligence'].map(k=>[k,100])),mults:{}},city='A';
 const ns={getServerMaxRam:()=>free,getServerUsedRam:()=>0,getResetInfo:()=>({...reset,ownedAugs:new Map()}),getPlayer:()=>player,bladeburner:{getCity:()=>city,getSkillNames:()=>['Cloak'],getSkillLevel:()=>1,getBonusTime:()=>0,getActionCountRemaining:()=>100,getOperationNames:()=>['Assassination'],getTeamSize:()=>2,getStamina:()=>[100,100],getActionEstimatedSuccessChance:()=>[.5,.5],getCityEstimatedPopulation:()=>1000,getCityCommunities:()=>1,getCityChaos:()=>2}};
 return ns;
}
const full=()=>({capabilities:{complete:false},stats:null,maintenance:{complete:false},squads:{complete:false},trainingVitals:null,currentCity:'A',population:{A:100},communities:{A:1},chaos:{A:0}});
const envelope=(data=full(),at=1000)=>({at,nodeReset:1,augReset:2,city:'A',data});
test('snapshot catalog remains generated from authoritative read-only readers',()=>assert.equal(readFileSync(new URL('../bladeburner-snapshot-source.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),buildBladeburnerSnapshotCatalog()));
test('documented split-reader RAM stays below 24 GB while the batch retains its measured cost',()=>{
 const definitions=JSON.parse(readFileSync(new URL('../scripts/api-surface.json',import.meta.url),'utf8'));
 for(const worker of bladeburnerSnapshotWorkers){const refs=apiReferences('snapshot.js',worker.source).references,ram=estimateRam(refs,definitions);assert.deepEqual(ram.unknown,[]);assert.ok(ram.ram>1.6&&ram.ram<=24,worker.name+': '+ram.ram);}
 assert.equal(estimateRam(apiReferences('batch.js',bladeburnerSnapshotBatch.source).references,definitions).ram,51.1);
});
test('32 GB and unknown RAM select sequential workers; adequate free RAM retains one batch',()=>{
 for(const free of [0,32,63.99,NaN,Infinity,undefined])assert.equal(bladeburnerSnapshotPlan(free),bladeburnerSnapshotWorkers);
 assert.deepEqual(bladeburnerSnapshotPlan(64),[bladeburnerSnapshotBatch]);
});
test('executed 32 GB reads never overlap and merge to the same data as the batched snapshot',async()=>{
 let active=0,peak=0;const sources=[];
 const read=async(ns,source,file,args)=>{active++;peak=Math.max(peak,active);sources.push(source);await Promise.resolve();const value=vm.runInNewContext(source,{ns:{...ns,args}});active--;return value;};
 const low=await readBladeburnerSnapshot(fixture(),read,['A'],'Operation Zero',reset);assert.equal(peak,1);assert.equal(sources.length,5);assert.deepEqual(sources,bladeburnerSnapshotWorkers.map(w=>w.source));
 sources.length=0;const high=await readBladeburnerSnapshot(fixture(128),read,['A'],'Operation Zero',reset);assert.equal(sources.length,1);
 for(const data of [low,high]){data.capabilities.at=0;data.trainingVitals.at=0;}
 assert.deepEqual(JSON.parse(JSON.stringify(low)),JSON.parse(JSON.stringify(high)));
});
test('unknown available RAM fails to the split path without optional Source File access',async()=>{
 const ns=fixture();ns.getServerMaxRam=()=>{throw Error('Unknown');};let count=0;
 await readBladeburnerSnapshot(ns,async(ns,source,file,args)=>{count++;return vm.runInNewContext(source,{ns:{...ns,args}});},['A'],null,reset);assert.equal(count,5);
});
test('partial worker failures abort without reading later workers or publishing merged state',async()=>{
 let count=0;await assert.rejects(readBladeburnerSnapshot(fixture(),async(ns,source,file,args)=>{if(++count===2)throw Error('Worker failed');return vm.runInNewContext(source,{ns:{...ns,args}});},['A'],null,reset),/Worker failed/);assert.equal(count,2);
});
test('merge rejects stale, future, missing, duplicate, reset-mismatched and city-mismatched observations',()=>{
 assert.equal(mergeBladeburnerSnapshots([envelope()],reset,1000,1001).currentCity,'A');
 for(const patch of [{at:999},{at:1002},{at:-14000},{city:'B'},{nodeReset:3},{augReset:3},{nodeReset:NaN},{data:null},{data:{...full(),extra:true}},{data:{...full(),currentCity:'B'}}])assert.throws(()=>mergeBladeburnerSnapshots([envelope(),{...envelope(),...patch}],reset,1000,1001));
 assert.throws(()=>mergeBladeburnerSnapshots([envelope({},1000)],reset,1000,1001),/Incomplete/);
 assert.throws(()=>mergeBladeburnerSnapshots([envelope()],reset,1000,16000),/expired/);
 for(const patch of [{at:999},{at:1002},{city:'B'},{nodeReset:3},{augReset:3}])assert.throws(()=>mergeBladeburnerSnapshots([{...envelope(),...patch}],reset,1000,1001));
});
test('native snapshot preflight compiles fixed probes without executing or retaining them',async()=>{
 const files=new Map();let starts=0;const ns={pid:7,write:async(f,s)=>files.set(f,s),rm:f=>files.delete(f),getScriptRam:f=>f==='bladeburner.js'?70:22.6,run:()=>starts++};
 const result=await nativeBladeburnerSnapshotPreflight(ns,bladeburnerSnapshotWorkers);assert.equal(result.ok,true);assert.equal(result.workers.length,5);assert.equal(starts,0);assert.equal(files.size,0);
 ns.getScriptRam=()=>25;assert.equal((await nativeBladeburnerSnapshotPreflight(ns,bladeburnerSnapshotWorkers)).ok,false);
});
test('native compile failures are reported and temporary probe files are removed',async()=>{
 const files=new Set(),ns={pid:8,write:async f=>files.add(f),rm:f=>files.delete(f),getScriptRam:f=>{if(f==='bladeburner.js')return 70;throw Error('Compile failed');}};
 const result=await nativeBladeburnerSnapshotPreflight(ns,bladeburnerSnapshotWorkers);assert.equal(result.ok,false);assert.equal(files.size,0);assert.ok(result.workers.every(w=>w.status==='unavailable'));
});
test('snapshot QC command accepts no arbitrary sources, filenames or gameplay arguments',async()=>{
 const command={id:'snapshot-qc',method:'automation.bladeburnerSnapshotPreflight',args:[],expiresAt:Date.now()+60000};assert.doesNotThrow(()=>validateCommand(command));assert.throws(()=>validateCommand({...command,args:['custom-code']}));
 const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(command)).toString('base64'));let reply;
 await job.main({pid:9,args:['[]','out',command.id],write:async(f,s)=>{if(f==='out')reply=JSON.parse(s);},rm:()=>true,getScriptRam:f=>f==='bladeburner.js'?70:22.6});assert.equal(reply.state,'completed');assert.equal(reply.result.ok,true);
});
test('production controller no longer imports native readers into its RAM footprint',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),policy=readFileSync(new URL('../bladeburner-capability-policy.js',import.meta.url),'utf8');assert.ok(!source.includes('captureBladeburnerPlanningState'));assert.ok(!policy.includes('ns.bladeburner'));assert.ok(!readFileSync(new URL('../bladeburner-snapshot-policy.js',import.meta.url),'utf8').includes('snapshot-readers.js'));
});
