import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHgwBatch,withHgwBatch,withHgwPiece,summarizeHgwBatches} from '../hgw-batch-policy.js';
import {classifyHgwEvent,readHgwTiming} from '../hgw-diagnostics-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const reset={lastNodeReset:1,lastAugReset:2},now=100000;
const items=()=>['hack','weak1','grow','weak2'].map((description,i)=>({description,toolShortName:['hack','weak','grow','weak'][i],threadsNeeded:i===1?4:2,end:new Date(now-4000+i*1000)}));
const batch=(seq=1)=>createHgwBatch(7,reset,seq,'x',items());
function receipts(b=batch()) {return b.batchPlan.map((p,i)=>({at:p.deadline+10,owner:7,pid:i+1,tool:p.tool,target:'x',deadline:p.deadline,lateMs:10,toleranceMs:250,legSpacingMs:1000,error:null,...b,batchStep:p.step,pieceThreads:p.threads}));}
const summarize=events=>summarizeHgwBatches(events,7,now);

test('batch IDs distinguish waves, owners and resets and metadata retains all scheduling flags',()=>{
 const b=batch();assert.notEqual(b.batchId,batch(2).batchId);assert.notEqual(b.batchId,createHgwBatch(8,reset,1,'x',items()).batchId);assert.notEqual(b.batchId,createHgwBatch(7,{...reset,lastAugReset:3},1,'x',items()).batchId);
 const args=['x',100,50,'Batch 0',false,false,false,7,JSON.stringify({port:20,drainProtocol:1})],before=JSON.stringify(args),tagged=withHgwBatch(args,b,'weak1'),piece=withHgwPiece(tagged,2),meta=JSON.parse(piece.at(-1));assert.equal(JSON.stringify(args),before);assert.deepEqual(piece.slice(0,-1),args.slice(0,-1));assert.equal(meta.port,20);assert.equal(meta.drainProtocol,1);assert.equal(meta.batchStep,'weak1');assert.equal(meta.pieceThreads,2);assert.equal(meta.batchPlan[1].threads,4);assert.equal(withHgwBatch(args,null,'hack'),args);assert.equal(withHgwPiece(args,2),args);
 assert.equal(createHgwBatch(7,reset,0,'x',items()),null);assert.equal(createHgwBatch(7,reset,1,'x',[...items(),items()[0]]),null);
});
test('ordered and inverted batches depend on actual completions rather than lateness labels',()=>{
 const events=receipts();assert.equal(summarize(events)[0].state,'ordered');events[0].at=events[1].at+1;assert.equal(summarize(events)[0].state,'inverted');events[0].at=events[1].at;assert.equal(summarize(events)[0].state,'timestamp-tie');
});
test('split steps require exact thread coverage and final-before-first ordering',()=>{
 const events=receipts(),weak=events[1];events.splice(1,1,{...weak,pieceThreads:2});assert.equal(summarize(events)[0].state,'partial');events.push({...weak,pid:99,pieceThreads:2,at:weak.at+20});assert.equal(summarize(events)[0].state,'ordered');events.at(-1).at=events[1].at+2000;assert.equal(summarize(events)[0].state,'inverted');
});
test('duplicate receipts are harmless while conflicting, excessive and failed receipts cannot prove order',()=>{
 const events=receipts();assert.equal(summarize([...events,events[0]])[0].state,'ordered');assert.equal(summarize([...events,{...events[0],batchPlan:null}])[0].state,'inconsistent');assert.equal(summarize([{...events[0],batchPlan:[]},...events])[0].state,'inconsistent');assert.equal(summarize([...events,{...events[0],at:events[0].at+1}])[0].state,'inconsistent');assert.equal(summarize([...events,{...events[0],pid:99}])[0].state,'inconsistent');
 assert.equal(summarize(events.map((e,i)=>i===0?{...e,error:'native failure'}:e))[0].state,'failed');assert.equal(summarize(events.map((e,i)=>i===0?{...e,batchPlan:e.batchPlan.map((p,j)=>j===0?{...p,threads:3}:p)}:e))[0].state,'inconsistent');
});
test('batch grouping isolates waves, targets and owners and bounds incomplete data',()=>{
 assert.equal(summarize([...receipts(),...receipts(batch(2)).map(e=>({...e,pid:e.pid+10}))]).length,2);
 assert.equal(summarize(receipts().map(e=>({...e,owner:8}))).length,0);assert.equal(summarize(receipts().map(e=>({...e,at:now+1}))).length,0);assert.equal(summarize(receipts().map(e=>({...e,at:now-120001}))).length,0);
 assert.equal(summarize(receipts().map(e=>({...e,batchVersion:undefined}))).length,0);
 assert.equal(summarize(receipts().slice(1))[0].state,'partial');assert.ok(summarize(Array.from({length:40},(_,i)=>({...receipts(batch(i+1))[0],pid:i+1}))).length<=8);
});
test('read-only query includes serialized bounded summaries and current owner metadata',async()=>{
 const at=Date.now(),b=createHgwBatch(7,reset,1,'x',items().map((p,i)=>({...p,end:new Date(at-4000+i*1000)}))),events=receipts(b),data={at,ownerPid:7,nodeReset:1,augReset:2,recent:events,counts:{}};
 const ns={args:['[]','out','batch-qc'],read:f=>f==='tasks/hgw-misfires.json'?JSON.stringify(data):'',getResetInfo:()=>reset,isRunning:()=>true};let output;ns.write=async(f,s)=>{output=JSON.parse(s);};
 const command={id:'batch-qc',method:'automation.hgwTiming',args:[],expiresAt:Date.now()+60000},source=renderCommandJob(command).replace('export async function main','async function main');await new (Object.getPrototypeOf(async function(){}).constructor)('ns',source+';return main(ns);')(ns);assert.equal(output.result.batches[0].state,'ordered');assert.equal(output.result.recent[0].batchId,b.batchId);
});
test('actual daemon schedule construction gives each wave one stable identity and skips looping batches',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    function getScheduleObject('),end=source.indexOf('    // initialize a new incomplete schedule item',start),itemStart=source.indexOf('    function getScheduleItem('),itemEnd=source.indexOf('    // Intended as a high-powered',itemStart);
 const timing={batchStart:new Date(1),hackStart:new Date(2),hackEnd:new Date(100),firstWeakenStart:new Date(3),firstWeakenEnd:new Date(200),growStart:new Date(4),growEnd:new Date(300),secondWeakenStart:new Date(5),secondWeakenEnd:new Date(400)};
 const target={name:'x',getHackThreadsNeeded:()=>2,getWeakenThreadsNeededAfterTheft:()=>4,percentageStolenPerHackThread:()=>.1,getGrowThreadsNeededAfterTheft:()=>2,getWeakenThreadsNeededAfterGrowth:()=>2};
 const ctx=vm.createContext({createHgwBatch,resetInfo:reset,ns:{pid:7},target,timing,loopingMode:false,hackOnly:false,hgwBatchSequence:0});vm.runInContext(source.slice(start,end)+source.slice(itemStart,itemEnd),ctx);
 const a=vm.runInContext('getScheduleObject(ns,timing,target,0)',ctx),b=vm.runInContext('getScheduleObject(ns,timing,target,0)',ctx);assert.notEqual(a.batchIdentity.batchId,b.batchIdentity.batchId);assert.equal(a.batchIdentity.batchPlan.length,4);ctx.loopingMode=true;assert.equal(vm.runInContext('getScheduleObject(ns,timing,target,0)',ctx).batchIdentity,null);
 assert.match(source,/withHgwBatch\(\[currentTarget.name/);assert.match(source,/withHgwPiece\(args,physical,maxThreadsHere\)/);
});
test('actual workers publish their allocated thread receipts but looping events remain untagged',async()=>{
 for(const name of ['hack','grow','weak'])for(const loop of [false,true]){
  const tool=name==='weak'?'weaken':name,step=name==='weak'?'weak1':name,b=batch(),meta={port:20,...b,batchStep:step,pieceThreads:2};let at=95000,queue='NULL PORT DATA',running=true;
  const flags=tool==='weaken'?[false,loop,7,JSON.stringify(meta)]:[false,false,loop,7,JSON.stringify(meta)];
  const ns={args:['x',95000,1000,'batch',...flags],pid:99,isRunning:()=>running,print(){},toast(){},['get'+tool[0].toUpperCase()+tool.slice(1)+'Time']:()=>1000,[tool]:async()=>{at=96010;running=false;return 1;},getPortHandle:()=>({peek:()=>queue,read:()=>{queue='NULL PORT DATA';},write:s=>queue=s})};
  const ctx=vm.createContext({ns,Date:{now:()=>at},Math,JSON,Number});const text=readFileSync(new URL('../Remote/'+name+'-target.js',import.meta.url),'utf8');vm.runInContext(text.replace('export async function main','async function main')+';result=main(ns);',ctx);await ctx.result;
  const e=JSON.parse(queue).recent[0];assert.equal(e.batchId,loop?undefined:b.batchId);if(!loop){assert.equal(e.pieceThreads,2);assert.equal(e.batchStep,step);}
 }
});
