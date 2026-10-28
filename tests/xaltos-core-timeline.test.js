import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAdjustedThreads} from '../hacking-core-policy.js';
import {withHgwPiece} from '../hgw-batch-policy.js';
import {recordHgwTimeline,summarizeHgwTimeline,readHgwTimeline,renderHgwTimeline} from '../hgw-timeline-policy.js';
import {escapeScanHtml} from '../scan-policy.js';
import {recordHackingDeadline} from '../hacking-deadline-policy.js';
test('core weaken savings round up and preserve the required native effect',()=>{
 for(const cores of [1,2,8,17,64])for(let n=1;n<300;n++){const actual=coreAdjustedThreads(n,'weak',cores);assert.ok(actual<=n);assert.ok(actual*(1+(cores-1)/16)>=n);if(actual>1&&cores>1)assert.ok((actual-1)*(1+(cores-1)/16)<n);}
});
test('core grow bound retains additive money even from zero at all stronger growth rates',()=>{
 for(const cores of [2,8,17,64])for(const n of [1,2,20,100,1000])for(const floor of [.00001,.001,.1]){
  const actual=coreAdjustedThreads(n,'grow',cores,floor),bonus=1+(cores-1)/16;
  assert.ok(actual<=n);
  for(const m of [0,1,100,1e9])for(const k of [floor,floor*2,floor*10])assert.ok(Math.log(m+actual)+k*actual*bonus>=Math.log(m+n)+k*n-1e-9);
 }
});
test('unknown growth, invalid cores, hacks and unsupported tools retain original counts',()=>{
 for(const c of [0,NaN,Infinity,1.5,1025])assert.equal(coreAdjustedThreads(100,'weak',c),100);
 for(const t of ['hack','manualhack',null])assert.equal(coreAdjustedThreads(100,t,17,.1),100);
 for(const k of [0,-1,NaN,Infinity])assert.equal(coreAdjustedThreads(100,'grow',17,k),100);
});
test('batch pieces distinguish physical threads from credited one-core work',()=>{
 const a=['t',JSON.stringify({batchVersion:1})],p=JSON.parse(withHgwPiece(a,5,10).at(-1));assert.equal(p.pieceThreads,10);assert.equal(p.physicalThreads,5);assert.equal(withHgwPiece(a,10,5),a);
});
test('drain inventory recognizes core-adjusted native workers and rejects false physical counts',()=>{
 const meta={batchVersion:1,port:20,nodeReset:1,augReset:2,batchId:'1:2:7:1',batchTarget:'n',batchStep:'weak1',pieceThreads:10,physicalThreads:5,batchPlan:[{step:'weak1',tool:'weaken',threads:10,deadline:300}]};
 const make=()=>({at:100,ownerPid:7,nodeReset:1,augReset:2,complete:true,targets:{}});
 const p={filename:'Remote/weak-target.js',pid:8,threads:5,args:['n',200,100,'Batch 1',false,false,7,JSON.stringify(meta)]};
 const s=make();recordHackingDeadline(s,p);assert.equal(s.targets.n.known,1);assert.equal(s.targets.n.uncertain,false);assert.equal(s.targets.n.latestDeadline,300);
 p.args[7]=JSON.stringify({...meta,physicalThreads:6});const bad=make();recordHackingDeadline(bad,p);assert.equal(bad.targets.n.uncertain,true);
});
test('timeline inventory tracks actual threads and keeps looping deadlines unknown',()=>{
 const rows=[];recordHgwTimeline(rows,{filename:'Remote/weak-target.js',threads:5,pid:1,args:['x',100,200,'Batch 1',false,false,7]},7);
 recordHgwTimeline(rows,{filename:'Remote/grow-target.js',threads:3,pid:2,args:['x',100,200,'FarmXP',false,false,true,7]},7);
 recordHgwTimeline(rows,{filename:'Remote/hack-target.js',threads:8,pid:3,args:['other',100,200,'Batch',false,false,false,8]},7);
 const [r]=summarizeHgwTimeline(rows,200);assert.equal(r.workers,2);assert.equal(r.threads,8);assert.equal(r.nextDeadline,300);assert.equal(r.legs[1].deadline,null);
 assert.equal(recordHgwTimeline(Array(128).fill({}),{},7),false);
});
test('timeline readers reject stale, other-reset and dead-owner data',()=>{
 const t={schemaVersion:1,nodeReset:1,augReset:2,at:100,ownerPid:7,targets:[]},reset={lastNodeReset:1,lastAugReset:2};
 const ns={read:()=>JSON.stringify(t),isRunning:()=>true};assert.deepEqual(readHgwTimeline(ns,reset,1000),t);
 assert.equal(readHgwTimeline(ns,reset,15101),null);assert.equal(readHgwTimeline(ns,{...reset,lastAugReset:3},1000),null);ns.isRunning=()=>false;assert.equal(readHgwTimeline(ns,reset,1000),null);
});
test('timeline output escapes labels and never calls planned work completed',()=>{
 const t={at:100,complete:false,targets:[{target:'<img>',phases:['batch'],workers:1,threads:1,nextDeadline:200,overdue:0,legs:[{tool:'grow',threads:1}]}]};
 const html=renderHgwTimeline(t,escapeScanHtml,100);assert.ok(html.includes('&lt;img&gt;'));assert.ok(html.includes('not confirmed completions'));assert.ok(html.includes('Partial inventory'));
});
