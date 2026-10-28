import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangPreparationPhase,gangPreparationStatus,gangReadinessSavingsFloor,gangPowerBenefit} from '../gang-power-policy.js';
import {gangWarfareContext,gangPulseCalibration,applyGangWorkOrders} from '../gang-policy.js';
const g={faction:'Own',power:300,territory:.5,territoryClashChance:0};
function snap(at,power=300){return {at,tickAt:at,changed:true,faction:'Own',gangs:{Own:{power,territory:.5},Rival:{power:100,territory:.5}},powerHistory:{Own:[10],Rival:[1,1,1]}};}
test('three confirmed phase changes activate only a higher preparation target',()=>{
 let phase;for(let i=0;i<4;i++)phase=gangPreparationPhase(phase,{...g,power:i%2?299:301},snap(1000+i*20000),.75,1000+i*20000);
 assert.equal(phase.changes.length,3);assert.equal(phase.buffered,true);assert.equal(phase.effectiveTarget,.755);
 const s={...snap(61000),preparationTarget:phase.effectiveTarget};
 assert.equal(gangPreparationStatus(g,s,.75,61000).active,true);
 assert.equal(gangWarfareContext(g,s,.75,61000,{trainingFirst:true}).threshold,.755);
 assert.equal(gangWarfareContext(g,s,.75,61000,{trainingFirst:false}).threshold,.75);
});
test('steady readiness never enables a buffer and higher configured targets remain respected',()=>{
 let phase;for(let i=0;i<8;i++)phase=gangPreparationPhase(phase,g,snap(1000+i*20000),.75,1000+i*20000);
 assert.equal(phase.buffered,false);assert.equal(phase.changes.length,0);
 const s={...snap(200000),preparationTarget:.755};assert.equal(gangPreparationStatus(g,s,.8,200000).target,.8);
 for(const invalid of [.74,.8,NaN,Infinity])assert.equal(gangPreparationStatus(g,{...s,preparationTarget:invalid},.75,200000).target,.75);
});
test('phase history is bounded, expires and resets on faction changes, gaps or disabled policy',()=>{
 let p;for(let i=0;i<30;i++)p=gangPreparationPhase(p,{...g,power:i%2?299:301},snap(1000+i*1000),.75,1000+i*1000);
 assert.ok(p.changes.length<=8);
 for(const [gg,at,enabled] of [[{...g,faction:'New'},31000,true],[g,200000,true],[g,31000,false]]){
  const r=gangPreparationPhase(p,gg,snap(at),.75,at,enabled);assert.equal(r.buffered,false);assert.deepEqual(r.changes,[]);
 }
});
test('bonus savings floor retains ordinary safeguards and handles the exhaustion boundary',()=>{
 assert.equal(gangReadinessSavingsFloor(10,0),20);assert.equal(gangReadinessSavingsFloor(10,1000),.8);
 assert.equal(gangReadinessSavingsFloor(10,250),10);assert.equal(gangReadinessSavingsFloor(10,240),20);
 assert.equal(gangReadinessSavingsFloor(NaN,100),20);assert.equal(gangReadinessSavingsFloor(10,-1),20);
});
test('accelerated preparation can accept a useful gain without dropping production or payback checks',()=>{
 const w={power:0,powerFocus:true,powerPriority:true,preparation:{active:true},rivals:[{samples:3}]};
 const before={power:10,powerReady:10,total:100,cumulative:[{at:5,power:5},{at:10,power:10}]};
 const after={power:12,powerReady:8,total:60,cumulative:[{at:5,power:6},{at:10,power:12}]};
 assert.equal(gangPowerBenefit(after,before,w,20).powerObjective,false);
 assert.equal(gangPowerBenefit(after,before,w,20,1000).powerObjective,true);
 assert.equal(gangPowerBenefit({...after,total:49},before,w,20,1000).powerObjective,false);
 assert.equal(gangPowerBenefit({...after,cumulative:[]},before,w,20,1000).powerObjective,false);
});
const pulse={at:19900,faction:'Own',power:290,territory:.5,predicted:20,members:['A']};
test('matched pulse calibration compares actual update gain with actual pulse crew',()=>{
 const r=gangPulseCalibration([],pulse,g,snap(20000),20000);assert.equal(r.length,1);assert.equal(r[0].observed,10);assert.equal(r[0].ratio,.5);
 assert.equal(gangPulseCalibration(r,pulse,g,snap(20000),20000).length,1);
});
test('unmatched, stale, lost, invalid or changed-territory pulses cannot train calibration',()=>{
 for(const p of [{...pulse,power:301},{...pulse,territory:.4},{...pulse,faction:'Other'},{...pulse,predicted:NaN},{...pulse,predicted:0},{...pulse,at:20000},{...pulse,at:-20000},{...pulse,power:280}])assert.equal(gangPulseCalibration([],p,g,snap(20000),20000).length,0);
 assert.equal(gangPulseCalibration([],pulse,g,{...snap(20000),changed:false},20000).length,0);
 assert.equal(gangPulseCalibration([],pulse,g,snap(20000),70000).length,0);
 const s=snap(20000);s.powerHistory.Own=[];assert.equal(gangPulseCalibration([],pulse,g,s,20000).length,0);
});
test('pulse worker captures confirmed native assignments without a separate API request',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('/**',start);
 const members={A:{name:'A',task:'Work',def:100,hack:100,str:100,dex:100,agi:100,cha:100},B:{name:'B',task:'Work',def:100,hack:100,str:100,dex:100,agi:100,cha:100}};
 const build=Function('getNsDataThroughFile','applyGangWorkOrders',`let pendingPowerPulse=null;const assignedTasks={A:'Work',B:'Work'},memberProtectedTask=()=>null,gangWarfareMemberEligible=()=>true,gangMutationAllowed=()=>true,log=()=>{};${source.slice(start,end)};return {run:updateMemberActivities,pulse:()=>pendingPowerPulse};`);
 const native={gang:{getGangInformation:()=>g,getMemberInformation:n=>members[n],setMemberTask:(n,t)=>{if(n==='B')return false;members[n].task=t;return true;}}};
 let calls=0;const controller=build(async(ns,expression,file,args)=>{calls++;native.args=args;return Function('ns','return '+expression)(native);},applyGangWorkOrders);
 await controller.run({pid:1,print:()=>{}},members,'Territory Warfare',g);
 assert.equal(calls,1);assert.deepEqual(controller.pulse().members,['A']);assert.ok(Math.abs(controller.pulse().predicted-.015*.5*600/95)<1e-10);
});

test('unknown initialization cannot inherit or dereference missing phase state',()=>{const r=gangPreparationPhase(null,{},null,.75,1);assert.equal(r.buffered,false);assert.deepEqual(r.changes,[]);assert.equal(r.ready,null);});
