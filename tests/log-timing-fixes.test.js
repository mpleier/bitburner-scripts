import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {adaptiveHgwTiming,restoreHgwTiming} from '../progression-improvements-policy.js';
const source=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
function snapshot(at,n=0,bad=0,recent=[]){return {at,augReset:1,nodeReset:2,counts:{operations:n,deadlineOverruns:bad,spacingSamples:n,spacingRisks:bad},recent};}
const initial=()=>adaptiveHgwTiming(null,snapshot(100000),{now:100000});
const events=(at=129000,lateMs=6500)=>Array.from({length:3},(_,pid)=>({at,pid,tool:'hack',target:'n00dles',deadline:at-lateMs,lateMs,legSpacingMs:4000,toleranceMs:250,error:null}));
function next(s,at=130000,n=20,bad=3,recent=events(),extra={}){return adaptiveHgwTiming(s,{...snapshot(at,n,bad,recent),...extra},{now:at,targetCount:4});}
test('three recent independent timing risks can exceed fixed backoff while limiting concurrency',()=>{
 const s=next(initial());assert.equal(s.multiplier,1.5);assert.equal(s.cycleMs,52000);assert.equal(s.targetCap,1);
 assert.equal(restoreHgwTiming(s,snapshot(130000,20,3),130001).latencyFloorMs,52000);
});
test('latency floor ignores old, future, duplicate, invalid, failed and blocked evidence',()=>{
 for(const recent of [events(99000),events(130001),[events()[0],events()[0],events()[0]],events().map(e=>({...e,lateMs:Infinity})),events().map(e=>({...e,error:'failed'})),events().slice(0,2)])assert.equal(next(initial(),130000,20,3,recent).cycleMs,6000);
 assert.equal(next(initial(),130000,20,3,events(),{blocked:true}).cycleMs,4000);
 assert.equal(next(initial(),130000,20,3,events(),{counts:{operations:20,deadlineOverruns:3}}).cycleMs,6000);
});
test('measured pacing is bounded, survives silence, decays with clean windows and clears on reset',()=>{
 let s=next(initial(),130000,20,3,events(129000,1e9));assert.equal(s.cycleMs,64000);
 s=next(s,160000,20,3,[]);assert.equal(s.cycleMs,64000);
 for(let i=1;i<=3;i++)s=next(s,160000+i*60000,20+i*20,3,[]);
 assert.equal(s.cycleMs,51200);
 assert.equal(next(s,350000,100,3,[],{augReset:3}).cycleMs,4000);
 for(const latencyFloorMs of [Infinity,-1,64001])assert.equal(restoreHgwTiming({...s,latencyFloorMs},snapshot(s.at,80,3),s.at),null);
});
test('Bladeburner unchanged hash worker status is quiet; failures and recovery stay visible',()=>{
 let now=100000,live=true,runs=0;const logs=[];
 const text=source('bladeburner.js');const code=text.slice(text.indexOf('let nextHashWorkerCheck=0;')>=0?text.indexOf('let nextHashWorkerCheck=0;'):text.indexOf('let nextHashWorkerCheck=0,'));
 const ns={ps:()=>live?[{}]:[],run:()=>{runs++;return 0;}};
 const ctx=vm.createContext({Date:{now:()=>now},log:(ns,m)=>logs.push(m),isScriptPaused:()=>false,readNodeRoutePlan:()=>null,ownedSourceFiles:{9:1},options:{},achievementActionAllowed:()=>true,getFilePath:x=>x,hasBladeburnerHashWorker:ps=>ps.length>0,ns});
 vm.runInContext(code,ctx);
 for(let i=0;i<4;i++){vm.runInContext('ensureBladeburnerHashWorker(ns)',ctx);now+=60000;}
 assert.equal(logs.length,1);assert.equal(runs,0);
 live=false;for(let i=0;i<2;i++){vm.runInContext('ensureBladeburnerHashWorker(ns)',ctx);now+=60000;}
 assert.equal(runs,2);assert.equal(logs.filter(m=>m.startsWith('WARNING:')).length,2);
 live=true;vm.runInContext('ensureBladeburnerHashWorker(ns)',ctx);assert.equal(logs.length,4);
});
test('Hacknet alternating waiting reasons are throttled, status stays fresh and purchases remain immediate',()=>{
 let now=100000;const logs=[],writes=[];const text=source('hacknet-upgrade-manager.js');
 const code=text.slice(text.indexOf('let lastUpgradeLog ='),text.indexOf('// Will buy the most effective'));
 const ctx=vm.createContext({Map,Date:{now:()=>now},ns:{pid:1,print:m=>logs.push(m),write:(f,s)=>writes.push(JSON.parse(s))}});vm.runInContext(code,ctx);
 const status=m=>{ctx.message=m;vm.runInContext('setStatus(ns,message)',ctx);};
 for(let i=0;i<10;i++){status(i%2?'Waiting for cash':'Waiting for payoff');now+=6000;}
 assert.equal(logs.length,2);assert.equal(writes.length,10);assert.equal(writes.at(-1).reason,'Waiting for cash');
 status('Purchased level');status('Purchased level');assert.equal(logs.length,4);
 status('Hacknet purchase failed; retrying');status('Hacknet purchase failed; retrying');assert.equal(logs.length,6);
 now+=300000;status('Waiting for payoff');assert.equal(logs.length,7);
 for(let i=0;i<30;i++)status('reason '+i);assert.ok(vm.runInContext('upgradeStatusHistory.size',ctx)<=16);
});
