import {homeRamHeadroom} from '../home-ram-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangAttritionCooldown,gangMonitorBackoff,gangAttritionCalibration,simulateGangAttrition,planGangAttrition,observeGangAttrition,gangAttritionSignature,startGangAttrition,stopGangAttrition} from '../gang-attrition-policy.js';
import {forecastGangCrewTraining,projectGangMember} from '../gang-policy.js';
import {gangTerritoryProjection} from '../gang-power-policy.js';
const members=()=>Array.from({length:12},(_,i)=>({name:'M'+i,def:1e6,...Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k+'_exp',1000])),upgrades:[],augmentations:[]}));
const input=(patch={})=>({w:{active:true,powerPriority:true,power:22000,territory:.2,threshold:.75,rivals:[{name:'Rival',power:10000,territory:.8,rate:0,highRate:.0425,samples:4}]},
 cumulative:Array.from({length:180},(_,i)=>({at:(i+1)*20,power:22000+(i+1)*100})),members:members(),powerFraction:1,...patch});
test('full-tail attrition can advance stable safe warfare compared with continued development',()=>{
 const r=planGangAttrition(input());assert.equal(r.engage,true);assert.ok(r.savedSeconds>60);assert.ok(r.fight.readySeconds<r.wait.readySeconds);assert.ok(r.extraDeaths<=.005);assert.ok(r.fight.deaths<=.02);
});
test('burst is followed by a full residual clash tail when safety is never reached',()=>{
 const f=input();f.w.power=16000;f.cumulative=f.cumulative.map(p=>({...p,power:16000}));
 const r=simulateGangAttrition({...f,attrition:true});assert.equal(r.ticks,180);assert.equal(r.clashChance,0);assert.equal(r.readySeconds,null);assert.ok(r.deaths>0);
});
test('NPC clashes weaken rivals during the waiting comparison too',()=>{
 const f=input();f.w.rivals=[{name:'A',power:10000,territory:.4,highRate:.0425,samples:4},{name:'B',power:10000,territory:.4,highRate:.0425,samples:4}];f.w.power=100;f.cumulative=f.cumulative.map(p=>({...p,power:100}));
 const r=simulateGangAttrition({...f,attrition:false});assert.ok(r.rivals[0].power<10000);assert.equal(r.deaths,0);assert.ok(Math.abs(r.territory+r.rivals.reduce((n,r)=>n+r.territory,0)-1)<1e-9);
});
test('unknown growth, weak odds, short reset horizons and unacceptable casualty costs retain defensive warfare',()=>{
 for(const mutate of [f=>f.members.pop(),f=>f.w.rivals[0].samples=0,f=>f.w.rivals[0].samples=NaN,f=>f.w.power=1000,f=>f.cumulative=f.cumulative.slice(0,10),f=>f.members.forEach(m=>m.def=1),f=>f.w.powerPriority=false]){const f=input();mutate(f);assert.equal(planGangAttrition(f).engage,false);}
 assert.equal(simulateGangAttrition({...input(),bonusSeconds:1e9}),null);
});
test('ordinary territory projection includes rival loss on player wins',()=>{
 const w={active:true,power:1000,territory:.5,threshold:.75,rivals:[{name:'R',power:100,rate:0,territory:.5}]};
 const r=gangTerritoryProjection(w,[{at:20,power:1000}]);assert.ok(r.rivals[0].power<100);assert.ok(r.power<1000);
});
function native(){const list=members(),files={},calls=[],now=Date.now(),g={faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0};
 const ns={args:[7],read:f=>files[f]||'',write:(f,v)=>{files[f]=v;},isRunning:p=>p===7,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),gang:{getGangInformation:()=>g,getMemberNames:()=>list.map(m=>m.name),getMemberInformation:n=>list.find(m=>m.name===n),getAllGangInformation:()=>({Own:g,Rival:{power:10000,territory:.8}}),setTerritoryWarfare:v=>{calls.push(v);g.territoryWarfareEngaged=v;}}};
 const q={engage:true,ownerPid:7,nodeReset:1,augReset:2,at:now,deadline:now+20000,faction:'Own',power:g.power,territory:g.territory,signature:gangAttritionSignature(list),rivals:[{name:'Rival',power:10000}]};return {ns,q,g,list,files,calls};}
test('serialized native gate starts one lease then stops on first observed tick and preserves cooldown',()=>{
 const f=native(),start=Function('return ('+startGangAttrition.toString()+')')(),stop=Function('return ('+stopGangAttrition.toString()+')')();
 assert.equal(start(f.ns,f.q,()=>true),true);assert.equal(stop(f.ns,false),false);assert.equal(stop(f.ns,true),true);assert.deepEqual(f.calls,[true,false]);
 assert.equal(JSON.parse(f.files['tasks/gang-attrition.json']).state,'cooldown');assert.equal(start(f.ns,f.q,()=>true),false);
});
test('stale changed blocked and residual-risk native quotes cannot start attrition',()=>{
 for(const mutate of [f=>f.q.at-=3000,f=>f.q.augReset=3,f=>f.q.deadline=0,f=>f.ns.isRunning=()=>false,f=>f.list[0].def=1,f=>f.g.power=10000,f=>f.g.territoryClashChance=.1]){const f=native();mutate(f);assert.equal(startGangAttrition(f.ns,f.q,()=>true),false);assert.equal(f.calls.length,0);}
 const f=native();assert.equal(startGangAttrition(f.ns,f.q,()=>false),false);
});
test('disabled expired and orphaned leases turn warfare off without renewing the cooldown',()=>{
 for(const kind of ['disabled','expired','orphan']){const f=native();assert.equal(startGangAttrition(f.ns,f.q,()=>true),true);const state=JSON.parse(f.files['tasks/gang-attrition.json']),cooldown=state.cooldownUntil;if(kind==='expired'){state.deadline=0;f.files['tasks/gang-attrition.json']=JSON.stringify(state);}if(kind==='orphan')f.ns.isRunning=()=>false;
 assert.equal(stopGangAttrition(f.ns,false,kind==='disabled'),true);assert.equal(JSON.parse(f.files['tasks/gang-attrition.json']).cooldownUntil,cooldown);}
});
test('controller exposes opt-out and retains native defensive and pause checks',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/disable-attrition/);assert.match(s,/stopGangAttrition.toString/);assert.match(s,/startGangAttrition.toString/);assert.match(s,/retainBaseline:true/);assert.match(s,/gangMutationAllowed.toString/);assert.match(s,/cooldownUntil>Date.now/);
});

test('actual generated start transaction preserves native guard arguments and has no hidden helper dependency',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),literal=s.match(/const engaged=await getNsDataThroughFile\(ns,(`[^`]+`)/)[1];
 const expression=Function('startGangAttrition','gangMutationAllowed','gangAttritionCalibration','homeRamHeadroom','gangMonitorBackoff','gangAttritionCooldown','return '+literal)(startGangAttrition,()=>true,gangAttritionCalibration,homeRamHeadroom,gangMonitorBackoff,gangAttritionCooldown),f=native();f.ns.args=[7,JSON.stringify(f.q)];
 assert.equal(Function('ns','return '+expression)(f.ns),true);assert.deepEqual(f.calls,[true]);
});

test('retained baseline exposes the actual bounded crew development trajectory only when requested',()=>{
 const list=members().map(m=>projectGangMember(m,null,0)),crew=Object.fromEntries(list.map(m=>[m.name,m])),training={name:'Train Combat',difficulty:100,strWeight:100},war={name:'Territory Warfare',difficulty:5,strWeight:100};
 const f={members:crew,gang:{respect:1000,wantedLevel:1},training,tasks:{'Train Combat':training,'Territory Warfare':war,Work:{name:'Work',difficulty:0}},assignments:Object.fromEntries(list.map(m=>[m.name,'Work'])),warfare:{...input().w,rivalPower:10000,clashChance:0,duty:{normalFraction:.1,bonusFraction:.25}},horizonSeconds:2100,maxSimulations:0,evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0})};
 assert.equal(forecastGangCrewTraining(f).baselineTrajectory,undefined);const r=forecastGangCrewTraining({...f,retainBaseline:true});assert.ok(r.baselineTrajectory.cumulative.length>0);assert.equal(r.baselineTrajectory.cumulative.at(-1).at,2100);
});

test('all three growth scenarios must pass even when the baseline recommends attrition',()=>{
 const f=input();f.w.rivals[0].highRate=.5;const r=planGangAttrition(f);
 assert.deepEqual(r.scenarios.map(v=>v.rivalGrowthScale),[.5,1,2]);
 assert.equal(r.scenarios[1].engage,true);assert.equal(r.scenarios[2].engage,false);assert.equal(r.engage,false);
 for(const scale of [NaN,Infinity,.49,2.01])assert.equal(simulateGangAttrition({...input(),rivalGrowthScale:scale}),null);
});
function observation(){const forecast=planGangAttrition(input()).observationForecast,at=100000;
 const lease={ownerPid:7,nodeReset:1,augReset:2,faction:'Own',startedAt:at,observationForecast:forecast};
 const baseline=forecast.expected[1],cycle={at:at+forecast.wallSeconds*1000,info:{faction:'Own',power:baseline.power,territory:baseline.territory},others:Object.fromEntries(baseline.rivals.map(r=>[r.name,{...r}]))};
 const scope={ownerPid:7,nodeReset:1,augReset:2};return {lease,cycle,scope};
}
test('clash observation compares net outcomes with all scenarios and does not approve warfare',()=>{
 const f=observation(),r=observeGangAttrition(f.lease,f.cycle,f.scope);
 assert.equal(r.length,1);assert.equal(r[0].scored,true);assert.equal(r[0].power.errorFromBaseline,0);assert.equal(r[0].power.insideRange,true);
 f.cycle.info.power*=.5;const miss=observeGangAttrition(f.lease,f.cycle,f.scope)[0];assert.equal(miss.power.insideRange,false);assert.ok(miss.power.errorFromBaseline<0);assert.equal(miss.engage,undefined);
 assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope,r),null);
});
test('observations reject reset owner invalid and future receipts; partial intervals remain unscored',()=>{
 for(const mutate of [f=>f.scope.ownerPid++,f=>f.scope.nodeReset++,f=>f.scope.augReset++,f=>f.cycle.info.faction='Changed',f=>f.cycle.at=0,f=>f.cycle.info.power=NaN,f=>f.lease.observationForecast.expected.pop()]){const f=observation();mutate(f);assert.equal(observeGangAttrition(f.lease,f.cycle,f.scope),null);}
 for(const mutate of [f=>f.cycle.at+=60000,f=>f.cycle.at=f.lease.startedAt+100,f=>f.cycle.others={}]){const f=observation();mutate(f);const r=observeGangAttrition(f.lease,f.cycle,f.scope);assert.equal(r[0].scored,false);assert.equal(r[0].power,undefined);}
});
test('diagnostic history is bounded and scoped to the current reset',()=>{
 const f=observation(),history=Array.from({length:100},(_,i)=>({...f.scope,key:'old'+i}));history.push({...f.scope,augReset:0,key:'other-reset'});
 const r=observeGangAttrition(f.lease,f.cycle,f.scope,history);assert.equal(r.length,64);assert.ok(r.every(x=>x.augReset===2));
});
test('next-tick observation forecast respects bonus time and remains diagnostic in native lease',()=>{
 const r=planGangAttrition({...input(),bonusSeconds:100});assert.equal(r.observationForecast.wallSeconds,.8);assert.equal(r.observationForecast.expected.length,3);
 const f=native();f.q.observationForecast=r.observationForecast;assert.equal(startGangAttrition(f.ns,f.q,()=>true),true);
 const lease=JSON.parse(f.files['tasks/gang-attrition.json']);assert.deepEqual(lease.observationForecast,r.observationForecast);assert.equal(lease.faction,'Own');
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/if\(tickObserved\)\{\s*try\{\s*const lease/);assert.match(s,/observationForecast:quote.observationForecast/);
});
