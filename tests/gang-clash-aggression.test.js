import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {warfareDecision,gangWarfareContext} from '../gang-policy.js';
import {gangPreparationStatus} from '../gang-power-policy.js';
import {simulateGangAttrition,planGangAttrition,startGangAttrition,stopGangAttrition,gangAttritionSignature} from '../gang-attrition-policy.js';
const members=()=>Array.from({length:12},(_,i)=>({name:'M'+i,def:1e6,upgrades:[],augmentations:[],...Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k+'_exp',1000]))}));
function input(){const crew=members();return {w:{active:true,powerPriority:true,power:22000,territory:.2,threshold:.75,engageThreshold:.7,preparation:{enabled:true},rivals:[{name:'R',power:10000,territory:.8,highRate:.0425,samples:4}]},allowTrainingFirst:true,participants:crew.map(m=>m.name),members:crew,powerFraction:1,cumulative:Array.from({length:180},(_,i)=>({at:(i+1)*20,power:22000+(i+1)*100}))};}
test('routine engagement at seventy percent remains separate from seventy-five-percent preparation',()=>{
 const gang={faction:'Own',power:700,territory:.2,territoryClashChance:0},snapshot={at:100000,faction:'Own',gangs:{Own:{power:700,territory:.2},R:{power:300,territory:.8}}};
 assert.equal(warfareDecision(gang,snapshot.gangs,.7).engage,true);assert.equal(warfareDecision({...gang,power:699},snapshot.gangs,.7).engage,false);
 const preparation=gangPreparationStatus(gang,snapshot,.7,100000,true);assert.equal(preparation.target,.75);assert.equal(preparation.active,true);
 const context=gangWarfareContext(gang,snapshot,.7,100000,{trainingFirst:true});assert.equal(context.threshold,.75);assert.equal(context.engageThreshold,.7);
});
test('forecast readiness uses the tactical threshold and preserves the residual clash tail',()=>{
 const f=input(),newer=simulateGangAttrition({...f,attrition:true}),older=simulateGangAttrition({...f,w:{...f.w,engageThreshold:.75},attrition:true});
 assert.ok(newer.readySeconds<older.readySeconds);
 f.w.power=1000;f.cumulative=f.cumulative.map(p=>({...p,power:1000}));
 const tail=simulateGangAttrition({...f,attrition:true});assert.equal(tail.clashChance,0);assert.ok(tail.deaths>0);assert.equal(tail.ticks,180);
});
test('bounded 65–70 percent attempts need explicit training-first consent and net territory advantage in every scenario',()=>{
 const f=input(),quote=planGangAttrition(f);assert.equal(quote.engage,true);assert.ok(quote.scenarios.every(s=>s.fight.territory>s.wait.territory&&s.extraDeaths<=.005&&s.fight.deaths<=.02));
 assert.equal(planGangAttrition({...f,allowTrainingFirst:false}).engage,false);
 const weak=input();weak.w.power=18000;weak.cumulative=weak.cumulative.map(p=>({...p,power:18000+(p.at/20)*100}));assert.equal(planGangAttrition(weak).engage,false);
 assert.equal(planGangAttrition({...f,participants:[]}).engage,false);
 const routine=input();routine.w.power=25000;routine.cumulative=routine.cumulative.map(p=>({...p,power:p.power+3000}));assert.equal(planGangAttrition(routine).engage,false);
});
test('casualties count specified warfare participants without exposing excluded weak members',()=>{
 const f=input();f.members[0].def=1;f.participants=f.members.slice(1).map(m=>m.name);
 const selected=simulateGangAttrition({...f,attrition:true}),all=simulateGangAttrition({...f,participants:null,attrition:true});
 assert.equal(selected.participantCount,11);assert.ok(selected.deaths<all.deaths);
 assert.equal(simulateGangAttrition({...f,participants:[],attrition:true}).deaths,0);
 for(const participants of [['missing'],['M1','M1'],'M1'])assert.equal(simulateGangAttrition({...f,participants,attrition:true}),null);
});
function native(){
 const list=members(),g={faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0},rival={power:10000,territory:.8},files={},calls=[],now=Date.now();
 const ns={args:[7],read:f=>files[f]||'',write:(f,v)=>files[f]=v,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),
  gang:{getGangInformation:()=>g,getAllGangInformation:()=>({Own:g,R:rival}),getMemberNames:()=>list.map(m=>m.name),getMemberInformation:n=>list.find(m=>m.name===n),setTerritoryWarfare:v=>{calls.push(v);g.territoryWarfareEngaged=v;}}};
 const q={engage:true,ownerPid:7,nodeReset:1,augReset:2,at:now,deadline:now+20000,faction:'Own',power:22000,territory:.2,signature:gangAttritionSignature(list),rivals:[{name:'R',power:10000}],participants:list.map(m=>m.name),excluded:[]};
 return {ns,q,list,g,rival,files,calls};
}
test('native gate independently validates the quoted warfare participant set',()=>{
 const f=native();assert.equal(startGangAttrition(f.ns,f.q,()=>true),true);
 for(const patch of [{participants:['M0']},{participants:[]},{participants:['M0','M0']},{excluded:['missing']}]){
  const bad=native();assert.equal(startGangAttrition(bad.ns,{...bad.q,...patch},()=>true),false);assert.equal(bad.calls.length,0);
 }
 const weak=native();weak.list[0].def=1;weak.q.signature=gangAttritionSignature(weak.list);weak.q.participants=weak.list.slice(1).map(m=>m.name);assert.equal(startGangAttrition(weak.ns,weak.q,()=>true),true);
 const routine=native();routine.g.power=routine.q.power=24000;assert.equal(startGangAttrition(routine.ns,routine.q,()=>true),false);
});
test('early leases stop on power loss, territory loss, a casualty, or odds below sixty-five percent',()=>{
 for(const change of [f=>f.g.power*=.94,f=>f.g.territory-=.0011,f=>f.list.pop(),f=>f.rival.power=20000]){
  const f=native();assert.equal(startGangAttrition(f.ns,f.q,()=>true),true);change(f);assert.equal(stopGangAttrition(f.ns,false),true);assert.deepEqual(f.calls,[true,false]);
  assert.match(JSON.parse(f.files['tasks/gang-attrition.json']).stopReason,/safety limit/);
 }
});
test('a changed eligible participant set cancels an active early-clash lease',()=>{
 const f=native();f.list[0].def=1;f.q.signature=gangAttritionSignature(f.list);f.q.participants=f.list.slice(1).map(m=>m.name);
 assert.equal(startGangAttrition(f.ns,f.q,()=>true),true);f.list[0].def=1e6;
 assert.equal(stopGangAttrition(f.ns,false),true);assert.equal(JSON.parse(f.files['tasks/gang-attrition.json']).stopReason,'Participant set changed');
});
test('residual early-clash pulses retain the quoted exposure set until routine warfare or tail expiry',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('\n/** @param {NS} ns',start);
 let captured=[];const crew={A:{name:'A',def:1000,task:'Train Combat'},B:{name:'B',def:1000,task:'Train Combat'}};
 const ctx={Math,Set,JSON,resetInfo:{lastNodeReset:1,lastAugReset:2},assignedTasks:{A:'Train Combat',B:'Train Combat'},memberProtectedTask:()=>null,gangWarfareMemberEligible:()=>true,isHackGang:false,
  applyGangWorkOrders(){},gangMutationAllowed(){},getNsDataThroughFile:async(_ns,_code,_file,args)=>{captured=JSON.parse(args[0]);return {failed:[],assigned:captured.length};},log(){}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.run=updateMemberActivities;',ctx);
 const ns={pid:7,read:()=>JSON.stringify({state:'cooldown',nodeReset:1,augReset:2,faction:'Own',participants:['A']})};
 await ctx.run(ns,crew,'Territory Warfare',{faction:'Own',territoryWarfareEngaged:false,territoryClashChance:.8});assert.deepEqual(captured.map(o=>o.name),['A']);
 await ctx.run(ns,crew,'Territory Warfare',{faction:'Own',territoryWarfareEngaged:true,territoryClashChance:1});assert.deepEqual(captured.map(o=>o.name),['A','B']);
});
test('controller allows bounded attrition under training-first while retaining pulse safeguards and opt-out',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/warfare-win-chance', 0.70/);
 assert.match(s,/function gangWarfareThreshold\(\)\{return options\['warfare-win-chance'\];\}/);
 assert.match(s,/allowTrainingFirst:true,participants/);assert.match(s,/gangWarfareMemberEligible\(m,maxDefense,1\)/);
 assert.match(s,/if\(lease.state==='active'\)/);assert.match(s,/activeLease&&!options\['disable-attrition'\]/);
});
