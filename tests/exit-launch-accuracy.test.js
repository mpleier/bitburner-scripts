import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stockExitDecision} from '../stock-policy.js';
import {launchHackingBatch} from '../hacking-policy.js';
import {commitHackingCapacity,hackingLoopCapacity,withHackingLoopCapacity} from '../hacking-drain-policy.js';
import {sampleSleeveReputation,observeSleeveReputation} from '../sleeve-work-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
const stock=(extra={})=>({sharesLong:100,boughtPrice:100,sharesShort:0,boughtPriceShort:0,ask_price:101,bid_price:99,prob:.49,probStdDev:.08,vol:.02,absReturn:()=>0,...extra});
const opts={estimated:true,tick:1,threshold:0,margin:.1};
test('weak estimated stock exit requires three distinct ticks, not repeated polls',()=>{
 let s=stockExitDecision(stock(),null,opts);assert.equal(s.sell,false);
 for(let i=0;i<20;i++)s=stockExitDecision(stock(),s,opts);
 assert.equal(s.count,1);s=stockExitDecision(stock(),s,{...opts,tick:2});assert.equal(s.sell,false);
 s=stockExitDecision(stock(),s,{...opts,tick:3});assert.equal(s.sell,true);
});
test('stock reversal confirmation resets when direction or native position changes',()=>{
 let s=stockExitDecision(stock(),null,opts);s=stockExitDecision(stock({sharesLong:101}),s,{...opts,tick:2});assert.equal(s.count,1);
 s=stockExitDecision(stock({prob:.6,absReturn:()=>.01}),s,{...opts,tick:3});assert.equal(s.reason,'forecast-supports-position');assert.equal(s.count,0);
 s=stockExitDecision(stock(),s,{...opts,tick:4});assert.equal(s.count,1);
});
test('native forecasts and strong estimated reversals exit immediately on either side',()=>{
 assert.equal(stockExitDecision(stock(),null,{...opts,estimated:false}).sell,true);
 assert.equal(stockExitDecision(stock({prob:.3}),null,opts).sell,true);
 assert.equal(stockExitDecision(stock({sharesLong:0,sharesShort:100,prob:.7}),null,opts).sell,true);
});
test('forward estimated loss above sell commission shortens confirmation without using entry cost',()=>{
 const st=stock({sharesLong:1e9,prob:.45,probStdDev:.01});let s=stockExitDecision(st,null,opts);
 assert.ok(s.expectedLoss>100000);assert.equal(s.sell,false);
 s=stockExitDecision(st,s,{...opts,tick:2});assert.equal(s.sell,true);
});
test('batch commits happen after all legs; rejected or throwing commits roll back only new workers',async()=>{
 const order=[],killed=[];
 assert.equal(await launchHackingBatch([{threadsNeeded:1}],async(_,p)=>{order.push('launch');p.push(7);return true;},p=>killed.push(...p),()=>{order.push('commit');return false;}),false);
 assert.deepEqual(order,['launch','commit']);assert.deepEqual(killed,[7]);
 await assert.rejects(launchHackingBatch([{threadsNeeded:1}],async(_,p)=>{p.push(8);return true;},p=>killed.push(...p),()=>{throw Error('disk');}),/disk/);
 assert.deepEqual(killed,[7,8]);let commits=0;
 await launchHackingBatch([{threadsNeeded:1}],async()=>false,()=>{},()=>{commits++;});assert.equal(commits,0);
});
const job={jobId:'missing',target:'n',tool:'grow',expectedThreads:10};
function ledgerFixture(){const files=new Map();return {files,ns:{pid:7,read:f=>files.get(f)||'',write:async(f,s)=>files.set(f,s)}};}
test('launch manifest detects a whole group lost before its first inventory',async()=>{
 const f=ledgerFixture();assert.equal(await commitHackingCapacity(f.ns,reset,[job],1000),true);
 const previous=JSON.parse(f.files.get('tasks/hgw-capacity-7.json')).jobs;
 const args=withHackingLoopCapacity(['n',1000,100,'hack',false,true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})],'hack',1,'alive');
 const c=hackingLoopCapacity([{pid:1,filename:'Remote/hack-target.js',args,threads:1,host:'home'}],7,reset,previous);
 assert.equal(c.damaged.find(x=>x.jobId==='missing').liveThreads,0);assert.deepEqual(c.targets,['n']);
});
test('launch manifest merges current groups and discards foreign reset state',async()=>{
 const f=ledgerFixture();await commitHackingCapacity(f.ns,reset,[job],1000);await commitHackingCapacity(f.ns,reset,[{...job,jobId:'next'}],1001);
 assert.equal(Object.keys(JSON.parse(f.files.get('tasks/hgw-capacity-7.json')).jobs).length,2);
 await commitHackingCapacity(f.ns,{...reset,lastAugReset:3},[{...job,jobId:'reset'}],1002);
 assert.deepEqual(Object.keys(JSON.parse(f.files.get('tasks/hgw-capacity-7.json')).jobs),['reset']);
});
test('invalid and over-capacity manifests fail without replacing the ledger',async()=>{
 const f=ledgerFixture();await commitHackingCapacity(f.ns,reset,[job],1000);const before=f.files.get('tasks/hgw-capacity-7.json');
 assert.equal(await commitHackingCapacity(f.ns,reset,[{...job,expectedThreads:NaN}],1001),false);
 assert.equal(await commitHackingCapacity(f.ns,reset,Array.from({length:2049},(_,i)=>({...job,jobId:String(i)})),1001),false);
 assert.equal(f.files.get('tasks/hgw-capacity-7.json'),before);
});
const quote=(rep,rate=10,key='faction')=>({index:0,eligible:true,key,rep,rate});
function measure(factor=1){let r=null;for(let t=0;t<=30;t+=10)r=observeSleeveReputation(r,[quote(t*10*factor)],1000+t*1000,reset,7);return r;}
test('sleeve audit integrates a thirty second isolated reputation window',()=>{
 const r=measure();assert.equal(r.results[0].reason,'measured');assert.equal(r.results[0].predicted,300);assert.equal(r.results[0].observed,300);assert.equal(r.results[0].relativeError,0);
});
test('sleeve audit flags donations or unexplained changes without altering spending',()=>{
 const r=measure(3);assert.equal(r.results[0].reason,'unexplained-reputation-change');assert.equal(r.results[0].relativeError,2);
});
test('sleeve audit resets task, reset, owner, downtime and reputation loss windows',()=>{
 const first=observeSleeveReputation(null,[quote(100)],1000,reset,7);
 for(const [q,t,r,pid]of [[quote(200,10,'other'),11000,reset,7],[quote(200),11000,{...reset,lastAugReset:3},7],[quote(200),11000,reset,8],[quote(200),21000,reset,7],[quote(99),11000,reset,7]]){
  const result=observeSleeveReputation(first,[q],t,r,pid);assert.equal(result.windows[0].predicted,0);assert.equal(result.results[0].reason,'calibrating');
 }
});
test('sleeve audit integrates changing native rates and retains last completed measurement',()=>{
 let r=null;for(let t=0;t<=30;t+=10)r=observeSleeveReputation(r,[quote(t*t/2,t)],1000+t*1000,reset,7);
 assert.equal(r.results[0].predicted,450);assert.equal(r.results[0].relativeError,0);
 r=observeSleeveReputation(r,[quote(500,30)],41000,reset,7);assert.equal(r.lastMeasured.results[0].observed,450);
});
function nativeFixture(){let tasks=[{type:'FACTION',factionName:'F',factionWorkType:'hacking'}],current=null,gang=null;
 const person={shock:0,sync:100,storedCycles:0,mults:{faction_rep:1}};
 const ns={getPlayer:()=>({jobs:{C:'Intern'}}),sleeve:{getNumSleeves:()=>tasks.length,getTask:i=>tasks[i],getSleeve:()=>person},singularity:{getCurrentWork:()=>current,getFactionFavor:()=>1,getFactionRep:()=>300,getCompanyFavor:()=>2,getCompanyRep:()=>400},gang:{inGang:()=>!!gang,getGangInformation:()=>({faction:gang})},formulas:{work:{factionGains:()=>({reputation:2}),companyGains:()=>({reputation:3})}}};
 return {ns,person,setTasks:t=>tasks=t,setCurrent:t=>current=t,setGang:g=>gang=g};}
test('native reputation sampler quotes faction and company work in per second units',()=>{
 const f=nativeFixture();assert.equal(sampleSleeveReputation(f.ns)[0].rate,10);f.setTasks([{type:'COMPANY',companyName:'C'}]);assert.equal(sampleSleeveReputation(f.ns)[0].rate,15);
});
test('native reputation sampler excludes shared player, sleeve and gang producers',()=>{
 const f=nativeFixture();const task=f.ns.sleeve.getTask(0);
 f.setCurrent(task);assert.equal(sampleSleeveReputation(f.ns)[0].eligible,false);
 f.setCurrent(null);f.setTasks([task,task]);assert.equal(sampleSleeveReputation(f.ns)[0].eligible,false);
 f.setTasks([task]);f.setGang('F');assert.equal(sampleSleeveReputation(f.ns)[0].eligible,false);
});
test('native audit handles missing Source Files, formulas and bonus cycles gracefully',()=>{
 const f=nativeFixture();f.person.storedCycles=6;assert.equal(sampleSleeveReputation(f.ns)[0].eligible,false);
 f.person.storedCycles=0;delete f.ns.formulas;assert.match(sampleSleeveReputation(f.ns)[0].reason,/unavailable/);
 delete f.ns.singularity;assert.equal(sampleSleeveReputation(f.ns)[0].eligible,false);
});
test('production wiring commits capacity and publishes diagnostic reputation and exit plans',()=>{
 const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
 assert.match(read('daemon.js'),/commitHackingCapacity\(ns,resetInfo,capacityJobs\)/);
 assert.match(read('sleeve.js'),/reputationAccuracy:sleeveReputationObservation/);
 assert.match(read('stockmaster.js'),/stockExitDecision\(stk,stk.exitDecision/);
});

test('native reputation sampler survives serialization into the temporary helper',()=>{
 const f=nativeFixture();const invoke=new Function('ns','return ('+sampleSleeveReputation.toString()+')(ns)');
 assert.deepEqual(invoke(f.ns),sampleSleeveReputation(f.ns));
});
