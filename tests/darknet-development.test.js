import test from 'node:test';
import assert from 'node:assert/strict';
import {observeAnchorValue,electMazeLeases,mazeLeaseOwned,mazeLeaseFile,coordinateDarknetDevelopment} from '../darknet-development-policy.js';
import {chooseAnchorReplacement} from '../darknet-anchor-policy.js';
import {main as scout} from '../darknet-node.js';
const reset={lastNodeReset:1,lastAugReset:2},scope=[1,2,'lab','(The Labyrinth)',4,'numeric',''];
const report=(at,money,neighbours=['a'])=>({host:'h',pid:7,at,live:true,depth:5,modelId:'NIL',passwordLength:4,passwordFormat:'numeric',data:'',neighbours,cacheRewards:{host:'h',epoch:'e',nodeReset:1,augReset:2,at,totals:{money}}});
function history(){let s=null;for(let i=0;i<4;i++)s=observeAnchorValue(s,report(1000+i*30000,i*300,['a',...Array.from({length:i},(_,n)=>'n'+n)]),reset,1000+i*30000);return s;}
test('anchor rates require three comparable native windows and use exact cache amounts',()=>{
 const s=history();assert.equal(s.cashKnown,true);assert.equal(s.cashRate,10);assert.equal(s.discoveryKnown,true);assert.equal(s.discoveryRate,1/30);assert.equal(s.windows.length,3);
});
test('failed observation and grant writes do not stop other manager work',async()=>{
 let writes=0;const messages=[];coordinateDarknetDevelopment.warningAt=-Infinity;
 const ns={pid:1,read:()=>'',write:async()=>{writes++;throw Error('disk unavailable');},print:s=>messages.push(s),dnet:{getStasisLinkedServers:()=>[]}};
 assert.deepEqual(await coordinateDarknetDevelopment(ns,[],reset),{});assert.equal(writes,2);assert.equal(messages.length,1);
});
test('repeated surveys add no windows and serialized derived rates are recomputed',()=>{
 const s=history(),r=report(s.last.at,900,['a','n0','n1','n2']);const v=observeAnchorValue({...s,cashRate:1e99,discoveryRate:1e99},r,reset,r.at);assert.equal(v.cashRate,10);assert.equal(v.windows.length,3);
});
test('stale reports, counter reversal, epoch changes and resets cannot reuse rates',()=>{
 const s=history();assert.equal(observeAnchorValue(s,report(91000,900),reset,181001),null);
 for(const r of [report(121000,1),{...report(121000,1000),cacheRewards:{...report(121000,1000).cacheRewards,epoch:'new'}}])assert.equal(observeAnchorValue(s,r,reset,121000).cashKnown,false);
 assert.equal(observeAnchorValue(s,report(121000,1000),{...reset,lastAugReset:3},121000).cashKnown,false);
});
test('malformed continuity restarts measurements and text rewards never become cash',()=>{
 const s=history();s.windows[1].start.money=99999;assert.equal(observeAnchorValue(s,report(121000,1000),reset,121000).cashKnown,false);
 let v=null;for(let i=0;i<4;i++){const r=report(1000+i*30000,0);delete r.cacheRewards;r.message='$999b retrieved';v=observeAnchorValue(v,r,reset,r.at);}assert.equal(v.cashKnown,false);assert.equal(v.cashRate,0);
});
test('bounded neighbour memory marks incomplete discovery evidence',()=>{
 let s=observeAnchorValue(null,report(1000,0,Array.from({length:70},(_,i)=>'n'+i)),reset,1000);for(let i=1;i<4;i++)s=observeAnchorValue(s,report(1000+i*30000,i*300,[]),reset,1000+i*30000);
 assert.equal(s.seen.length,64);assert.equal(s.discoveryKnown,false);assert.equal(s.cashKnown,true);
});
test('measured cache cash protects a paying donor and requires transition payback',()=>{
 const at=100000,row=(host,depth)=>({host,depth,at,live:true,busy:false,isStationary:false,hasSession:true,maxRam:64,neighbours:[],caches:0,contracts:0,modelId:'NIL'}),rows=[row('old',2),row('deep',20),row('new',12)],known=cashRate=>({at,cashKnown:true,cashRate,discoveryKnown:true,discoveryRate:0});
 assert.equal(chooseAnchorReplacement(rows,['old','deep'],2,new Map([['new','']]),at,{old:known(10),new:known(5)}),null);
 assert.equal(chooseAnchorReplacement(rows,['old','deep'],2,new Map([['new','']]),at,{old:known(10)}),null);
 const p=chooseAnchorReplacement(rows,['old','deep'],2,new Map([['new','']]),at,{old:known(10),new:known(20)});assert.equal(p.cacheEconomics.paybackMs,60000);
});
const candidate=(host,pid,at,extra={})=>({host,pid,at,live:true,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at}],...extra});
test('one deterministic maze owner is retained while fresh and hands off after death',()=>{
 let f=electMazeLeases(null,[candidate('b',8,1000),candidate('a',7,1000)],reset,1,1000);assert.equal(f.leases.length,1);assert.equal(f.leases[0].pid,7);
 f=electMazeLeases(f,[candidate('b',8,2000),candidate('a',7,2000)],reset,2,2000);assert.equal(f.leases[0].pid,7);assert.equal(f.leases[0].managerPid,2);
 f=electMazeLeases(f,[candidate('b',8,3000),candidate('a',7,3000,{live:false})],reset,2,3000);assert.equal(f.leases[0].pid,8);
});
test('maze grants reject stale progress, missing adjacency and foreign scopes',()=>{
 for(const r of [candidate('a',7,1000,{neighbours:[]}),candidate('a',7,1000,{mazeRequests:[{maze:'lab',scope:[1,9,'lab'],at:1000}]}),candidate('a',7,1000,{mazeRequests:[{maze:'lab',scope,at:-100000}]})])assert.equal(electMazeLeases(null,[r],reset,1,1000).leases.length,0);
});
test('a live but non-progressing owner yields to another fresh scout',()=>{
 const first=electMazeLeases(null,[candidate('a',7,1000),candidate('b',8,1000)],reset,1,1000);
 const next=electMazeLeases(first,[candidate('a',7,100000),candidate('b',8,100000)],reset,1,100000);assert.equal(next.leases[0].pid,8);
});
test('different metadata scopes never grant two explorers for the same maze',()=>{
 const a=candidate('a',7,1000),b=candidate('b',8,2000);b.mazeRequests[0].scope=[...scope.slice(0,-1),'new maze'];
 const f=electMazeLeases(null,[a,b],reset,1,2000);assert.equal(f.leases.length,1);assert.equal(f.leases[0].pid,8);
});
test('native lease guard checks live manager, owner PID, expiry and reset before moves',async()=>{
 const at=Date.now(),f=electMazeLeases(null,[candidate('a',7,at)],reset,1,at);const ns={pid:7,getHostname:()=> 'a',fileExists:()=>true,scp:async()=>true,read:()=>JSON.stringify(f),isRunning:()=>true};assert.equal(await mazeLeaseOwned(ns,scope),true);
 ns.pid=8;assert.equal(await mazeLeaseOwned(ns,scope),false);ns.pid=7;ns.isRunning=()=>false;assert.equal(await mazeLeaseOwned(ns,scope),false);ns.isRunning=()=>true;f.leases[0].expiresAt=at-1;assert.equal(await mazeLeaseOwned(ns,scope),false);assert.equal(await mazeLeaseOwned(ns,[1,3,'lab']),false);
});
test('executed scouts publish maze requests and only the granted PID authenticates a move',async()=>{
 for(const granted of [false,true]){
  const at=Date.now(),mazeScope=[1,2,'lab','(The Labyrinth)',4,'numeric',''],f=electMazeLeases(null,[{...candidate('origin',granted?7:8,at),mazeRequests:[{maze:'lab',scope:mazeScope,at}]}],reset,1,at);
  const files=new Map([[mazeLeaseFile,JSON.stringify(f)],['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]),attempts=[],messages=[],stop=Error('end scout');
  const info={modelId:'(The Labyrinth)',passwordLength:4,passwordFormat:'numeric',data:'',blockedRam:0,hasSession:false,requiredCharismaSkill:0};
  const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,prefix='')=>[...files.keys()].filter(f=>f.includes(prefix)),fileExists:f=>f===mazeLeaseFile,hasRootAccess:()=>true,
   scp:async()=>true,isRunning:()=>true,ps:()=>[],getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,getPlayer:()=>({skills:{charisma:10000}}),print:s=>messages.push(s),sleep:async()=>{throw stop;},
   dnet:{probe:()=>['lab'],getServerDetails:h=>h==='lab'?info:{depth:0,difficulty:0},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0,getServerRequiredCharismaLevel:()=>Infinity,
    labreport:async()=>({success:true,coords:[1,1],east:true,north:false,south:false,west:false}),labradar:async()=>({success:false}),authenticate:async(_h,p)=>{attempts.push(p);throw stop;}}};
  await assert.rejects(scout(ns),e=>e===stop);assert.equal(attempts.length,granted?1:0);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));
  assert.ok([...files.keys()].some(f=>f.startsWith('tasks/dnet-survey-')));
 }
});
