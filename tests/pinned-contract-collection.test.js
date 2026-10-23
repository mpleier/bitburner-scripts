import {readSharedNetwork} from '../network-snapshot-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {main as pull,resolveUpdateRevision} from '../git-pull.js';
import {contractCollectionPlan} from '../contract-policy.js';
const sha='b'.repeat(40);
function installer(branch='feature/test'){
 const files=new Map([['a.js','old']]),urls=[],messages=[];
 return {files,urls,messages,ns:{pid:8,flags:s=>({...Object.fromEntries(s),branch,download:['a.js','b.js']}),getScriptName:()=> 'git-pull.js',
  fileExists:f=>files.has(f),read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),rm:f=>files.delete(f),run(){},print:m=>messages.push(m),tprint:m=>messages.push(m),
  wget:async(url,f)=>{urls.push(url);files.set(f,'export const changed=1;');return true;}}};
}
test('branch lookup is encoded and resolves exactly once to a full SHA',async()=>{
 const urls=[];assert.equal(await resolveUpdateRevision({github:'owner',repository:'repo',branch:'feature/test'},async url=>{urls.push(url);return {ok:true,json:async()=>({sha})};}),sha);
 assert.equal(urls.length,1);assert.ok(urls[0].endsWith('/commits/feature%2Ftest'));
});
test('full SHA bypasses lookup and normalizes case',async()=>{
 assert.equal(await resolveUpdateRevision({branch:sha.toUpperCase()},()=>{throw Error('network must not be used');}),sha);
});
test('bad lookup responses cannot produce an unpinned update',async()=>{
 for(const response of [{ok:false,status:429},{ok:true,json:async()=>({sha:'main'})},{ok:true,json:async()=>null}])await assert.rejects(resolveUpdateRevision({github:'o',repository:'r',branch:'main'},async()=>response));
});
test('moving branches cannot change raw download revisions',async()=>{
 const old=globalThis.fetch,f=installer();let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({sha:calls===1?sha:'c'.repeat(40)})};};
 try{await pull(f.ns);}finally{globalThis.fetch=old;}
 assert.equal(calls,1);assert.equal(f.urls.length,2);assert.ok(f.urls.every(url=>url.includes('/'+sha+'/')));
});
test('failed pin lookup leaves all live files untouched and downloads nothing',async()=>{
 const old=globalThis.fetch,f=installer();globalThis.fetch=async()=>{throw Error('offline');};
 try{await pull(f.ns);}finally{globalThis.fetch=old;}
 assert.equal(f.files.get('a.js'),'old');assert.equal(f.urls.length,0);assert.ok(f.messages.some(m=>m.includes('Cannot pin update')));
});
test('root and recursive listings and every download share the pinned SHA',async()=>{
 const old=globalThis.fetch,f=installer(),requests=[];f.ns.flags=s=>({...Object.fromEntries(s),branch:'main'});
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('/commits/')?{sha}:url.includes('/contents/Tasks?')?[{type:'file',path:'Tasks/a.js'}]:[{type:'dir',path:'Tasks'},{type:'file',path:'a.js'}]};};
 try{await pull(f.ns);}finally{globalThis.fetch=old;}
 assert.equal(requests.length,3);assert.ok(requests.slice(1).every(url=>url.endsWith('?ref='+sha)));assert.ok(f.urls.every(url=>url.includes('/'+sha+'/')));
});
const passed={version:'v1',types:{good:{state:'passed'},bad:{state:'failed'},waiting:{state:'retrying'}}};
test('only passed contract types qualify; malformed validation fails closed',()=>{
 const contracts=[{type:'good'},{type:'bad'},{type:'waiting'},{type:'unknown'}];
 assert.deepEqual(contractCollectionPlan(contracts,passed).eligible,[contracts[0]]);
 for(const validation of [null,{}, {version:'',types:{}},{version:'v',types:[]}])assert.equal(contractCollectionPlan(contracts,validation).reason,'waiting-for-validation');
});
function collector(validation=passed,missingType=null,missingData=null,dark=false){
 const collection=readFileSync(new URL('../Tasks/contractor.js',import.meta.url),'utf8');
 const files=['good.cct','bad.cct','waiting.cct','unknown.cct','other.cct'],dataReads=[],dispatched=[],messages=[],store=new Map();
 store.set('tasks/contract-validation.json',JSON.stringify(validation));
 if(dark)store.set('tasks/dnet-survey-dark.json',JSON.stringify({host:'dark',at:Date.now()}));
 const types={'good.cct':'good','other.cct':'good','bad.cct':'bad','waiting.cct':'waiting','unknown.cct':'unknown'};
 const ns={pid:9,args:[],getHostname:()=> 'home',getResetInfo:()=>({lastNodeReset:42,lastAugReset:7}),print:m=>messages.push(m),ls:(host,prefix)=>prefix==='tasks/dnet-survey-'?(dark?['tasks/dnet-survey-dark.json']:[]):host==='dark'?['good.cct']:files,read:f=>store.get(f)||'',write:(f,s)=>store.set(f,s),
 codingcontract:{getContractType:file=>{if(file===missingType)throw Error('gone');return types[file];},getData:file=>{dataReads.push(file);if(file===missingData)throw Error('gone');return 9;}}};
 const context={readSharedNetwork,contractCollectionPlan,scriptSolver:'Tasks/contractor.js.solver.js',instanceCount:async()=>1,reconcileContractDelivery:async()=>({busy:false}),disableLogs(){},log(){},
 dispatchContractDelivery:async(_ns,_script,batch)=>{dispatched.push(batch);return {pid:42,host:'remote',count:batch.length};},
 getNsDataThroughFile:async(_ns,command,_temp,args=[])=>{
  if(command==='scanAllServers(ns)')return ['home'];
  return Function('ns','jsonReplacer','return '+command)({...ns,args},(_key,value)=>value);
 }};
 vm.runInNewContext(collection.slice(collection.indexOf('export async function main')).replace('export async function main','async function main')+';globalThis.collect=main;',context);
 return {run:()=>context.collect(ns),dataReads,dispatched,status:()=>JSON.parse(store.get('tasks/contracts-status.json')),store};
}
test('collector downloads data only for validated types',async()=>{
 const f=collector();await f.run();assert.deepEqual(f.dataReads,['good.cct','other.cct']);assert.equal(f.dispatched[0].length,2);assert.equal(f.status().discovered,5);assert.equal(f.status().deferred,3);
});
test('missing validation prevents all payload downloads and dispatch',async()=>{
 const f=collector(null);await f.run();assert.equal(f.dataReads.length,0);assert.equal(f.dispatched.length,0);assert.equal(f.status().reason,'waiting-for-validation');
});
test('one vanished type or input cannot block unrelated contracts',async()=>{
 for(const mode of ['type','data']){
  const f=collector(passed,mode==='type'?'good.cct':null,mode==='data'?'good.cct':null);await f.run();
  assert.equal(f.dispatched[0].length,1);assert.equal(f.dispatched[0][0].contract,'other.cct');assert.equal(f.status().dataErrors,mode==='data'?1:0);
 }
});
test('no passed types avoids the input worker entirely',async()=>{
 const f=collector({version:'v',types:{}});await f.run();assert.equal(f.dataReads.length,0);assert.equal(f.dispatched.length,0);assert.equal(f.status().reason,'no-validated-contracts');
});

test('collector adds fresh Dark Net reward hosts and publishes typed reset-scoped inventory',async()=>{
 const f=collector(passed,null,null,true);await f.run();
 assert.equal(f.dispatched[0].length,3);assert.ok(f.dispatched[0].some(c=>c.hostname==='dark'));
 const status=f.status();assert.equal(status.nodeReset,42);assert.equal(status.augReset,7);assert.equal(status.validationVersion,'v1');assert.ok(status.contracts.some(c=>c.host==='dark'&&c.file==='good.cct'&&c.type==='good'));
});
