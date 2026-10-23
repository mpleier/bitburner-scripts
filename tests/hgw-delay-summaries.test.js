import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mergeHgwDelaySamples,hackingDrainPadding} from '../hacking-deadline-policy.js';
import {collectHgwTelemetry} from '../hgw-telemetry-policy.js';
const now=200000,reset={lastNodeReset:1,lastAugReset:2},options={now,nodeReset:1,augReset:2,ownerPid:7};
const event=(i=0,extra={})=>({owner:7,pid:i+1,tool:'hack',batchVersion:1,batchId:'1:2:7:'+i,at:now-3000+i*100,deadline:now-4000+i*100,lateMs:1000,...extra});
const merge=(prior,events,extra={})=>mergeHgwDelaySamples(prior,events,{...options,...extra});
test('summaries retain one maximum per batch with its real timestamp and immutable inputs',()=>{
 const a=event(),b=event(0,{pid:99,at:now,deadline:now-100,lateMs:100}),before=JSON.stringify([a,b]);
 const result=merge([a],[b]);assert.equal(result.length,1);assert.equal(result[0].lateMs,1000);assert.equal(result[0].at,a.at);assert.equal(JSON.stringify([a,b]),before);
 const fresh=merge(result,[event(0,{at:now,deadline:now-1500,lateMs:1500})]);assert.equal(fresh[0].lateMs,1500);assert.equal(fresh[0].at,now);
});
test('expiry, reset, owner and malformed data cannot supply delay evidence',()=>{
 for(const patch of [{at:now+1},{at:now-120001},{owner:8},{error:'failed'},{batchVersion:2},{deadline:0},{lateMs:-1},{pid:0},{batchId:'wrong'}])assert.equal(merge([], [event(0,patch)]).length,0);
 assert.equal(merge([event()],[],{nodeReset:9}).length,0);assert.equal(merge(null,null).length,0);
});
test('summaries are capped at 64 and preserve every batch when merging two bounded buffers',()=>{
 const prior=Array.from({length:64},(_,i)=>event(i,{at:now-10000+i,deadline:now-11000+i}));
 const next=Array.from({length:64},(_,i)=>event(i+64,{at:now-1000+i,deadline:now-2000+i}));const r=merge(prior,next);assert.equal(r.length,64);assert.equal(r[0].batchId,'1:2:7:127');assert.equal(r[63].batchId,'1:2:7:64');
});
test('all worker reporters preserve independent batches through a burst of split receipts',()=>{
 for(const name of ['hack','grow','weak']){
  const source=readFileSync(new URL('../Remote/'+name+'-target.js',import.meta.url),'utf8');const report=vm.runInNewContext(source.slice(source.indexOf('function report('))+';report');const workerMerge=vm.runInNewContext(source.slice(source.indexOf('function mergeHgwDelaySamples('))+';mergeHgwDelaySamples');assert.equal(workerMerge.toString().replaceAll('\r\n','\n'),mergeHgwDelaySamples.toString().replaceAll('\r\n','\n'));
  let queue='NULL PORT DATA';const ns={getPortHandle:()=>({peek:()=>queue,read:()=>{queue='NULL PORT DATA';},write:s=>{queue=s;}})};
  for(let i=0;i<6;i++)report(ns,{port:20,nodeReset:1,augReset:2},event(i),true);
  for(let i=0;i<40;i++)report(ns,{port:20,nodeReset:1,augReset:2},event(5,{pid:100+i}),true);
  const data=JSON.parse(queue);assert.equal(data.recent.length,20);assert.equal(new Set(data.recent.map(e=>e.batchId)).size,1);assert.equal(data.delaySamples.length,6);
 }
});
test('collector persists summary history despite raw-buffer crowding and drops previous owners',()=>{
 const files=new Map();let queue='NULL PORT DATA';const ns={read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),print(){},toast(){},getPortHandle:()=>({peek:()=>queue,read:()=>{queue='NULL PORT DATA';}})};
 for(let i=0;i<6;i++){
  queue=JSON.stringify({channel:'hgw-v1',nodeReset:1,augReset:2,recent:[event(i,{at:now-6000+i*1000,deadline:now-7000+i*1000})]});collectHgwTelemetry(ns,reset,7,now);
 }
 queue=JSON.stringify({channel:'hgw-v1',nodeReset:1,augReset:2,recent:Array.from({length:40},()=>event(5))});collectHgwTelemetry(ns,reset,7,now);
 const data=JSON.parse(files.get('tasks/hgw-misfires.json'));assert.equal(new Set(data.recent.map(e=>e.batchId)).size,1);assert.equal(data.delaySamples.length,6);
 const p=hackingDrainPadding(data,{now,ownerPid:7,reset,baseMs:250});assert.equal(p.batches,6);assert.equal(p.paddingMs,1250);
 collectHgwTelemetry(ns,reset,8,now+6000);assert.equal(JSON.parse(files.get('tasks/hgw-misfires.json')).delaySamples.length,0);
});
test('summary-only histories calibrate padding and stale maxima expire without being refreshed',()=>{
 const samples=Array.from({length:6},(_,i)=>event(i,{at:now-6000+i*1000,deadline:now-7000+i*1000}));
 const data={at:now,ownerPid:7,nodeReset:1,augReset:2,blocked:false,recent:[],delaySamples:samples};assert.equal(hackingDrainPadding(data,{now,ownerPid:7,reset}).paddingMs,1250);
 assert.equal(merge(samples,[],{now:now+120001}).length,0);
});
