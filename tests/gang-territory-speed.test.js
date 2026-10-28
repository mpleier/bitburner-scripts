import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {warfareDecision,gangWarfareContext,ascendGangMemberSafely,gangPulseObservation,applyGangWorkOrders} from '../gang-policy.js';
import {gangPreparationStatus,gangPowerBenefit} from '../gang-power-policy.js';

test('a tiny active rival prevents completion even when player territory rounds to one',()=>{
 const g={faction:'Own',power:1000,territory:1-1e-8,territoryClashChance:0},r={Own:{power:1000,territory:g.territory},R:{power:1,territory:1e-8}},s={at:100,faction:'Own',gangs:r};
 for(const territory of [g.territory,1]){
  assert.equal(warfareDecision({...g,territory},r,.7).engage,true);
  assert.equal(warfareDecision({...g,territory},r,.7).finished,false);
  assert.equal(gangWarfareContext({...g,territory},s,.7,100).active,true);
 }
 const done={Own:{power:1000,territory:1},R:{power:1,territory:0}};
 assert.equal(warfareDecision(g,done,.7).finished,true);
 assert.equal(warfareDecision(g,done,.7).engage,false);
 assert.equal(gangWarfareContext(g,{...s,gangs:done},.7,100).active,false);
 assert.equal(gangPreparationStatus(g,s,.75,100).reason,'Safe warfare target reached; balanced development');
});

test('unknown completion and malformed rival data fail closed',()=>{
 const g={faction:'Own',power:100,territory:1};
 for(const r of [null,{}, {R:{power:NaN,territory:0}},{R:{power:1,territory:-1}},{R:{power:1,territory:Infinity}}]){
  const d=warfareDecision(g,r,.7);assert.equal(d.engage,false);assert.equal(d.finished,false);
 }
});

function ascension(){
 const events=[],g={faction:'Own',power:10000,territory:.3,territoryWarfareEngaged:true},r={R:{power:10,territory:.7}};
 const ns={gang:{getMemberNames:()=>['M'],getGangInformation:()=>g,getAscensionResult:()=>({str:2}),getAllGangInformation:()=>r,
  setMemberTask:(n,t)=>{events.push(['task',n,t]);return true;},setTerritoryWarfare:v=>events.push(['war',v]),ascendMember:n=>{events.push(['ascend',n]);return {str:2};}}};
 const native=Function('return ('+ascendGangMemberSafely.toString()+')')();
 return {events,g,r,ns,run:()=>native(ns,'M',['str'],1.02,.01,()=>[{name:'M'}],()=>true,null,true)};
}
test('safe routine ascension removes the member from combat before resetting without interrupting clashes',()=>{
 const f=ascension(),r=f.run();assert.equal(r.success,true);assert.equal(r.warfarePreserved,true);
 assert.deepEqual(f.events,[['task','M','Train Combat'],['ascend','M'],['task','M','Train Combat']]);
});
test('uncertain, unsafe and failed task switches retain ascension disengagement',()=>{
 for(const change of [f=>f.r.R.power=9000,f=>f.r.R.power=NaN,f=>f.ns.gang.getAllGangInformation=()=>{throw Error('unavailable');},f=>f.ns.gang.setMemberTask=()=>false]){
  const f=ascension();change(f);const r=f.run();assert.equal(r.warfarePreserved,false);
  assert.ok(f.events.findIndex(e=>e[0]==='war')<f.events.findIndex(e=>e[0]==='ascend'));
 }
});
test('failed post-ascension training confirmation withdraws preserved warfare',()=>{
 const f=ascension();let calls=0;f.ns.gang.setMemberTask=()=>++calls===1;
 const r=f.run();assert.equal(r.trainingAssigned,false);assert.equal(r.warfarePreserved,false);assert.deepEqual(f.events.at(-1),['war',false]);
});

test('the actual native warfare transaction reports confirmed state and control rejections',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),marker=", '/Temp/gang-warfare-decision.txt'";
 const start=s.indexOf('`',s.indexOf('const transition=await getNsDataThroughFile(ns,')),end=s.indexOf(marker,start);
 const make=Function('gangMutationAllowed','warfareDecision','conditional','gangAggressionGuardSource','return '+s.slice(start,end));
 for(const allowed of [false,true]){
  let engaged=false;const files={},calls=[];
  const ns={permitted:allowed,args:[true,7,.7,false],getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),write:(p,v)=>files[p]=JSON.parse(v),gang:{
   getGangInformation:()=>({faction:'Own',power:10000,territory:.3,territoryWarfareEngaged:engaged}),getAllGangInformation:()=>({R:{power:10,territory:.7}}),setTerritoryWarfare:v=>{calls.push(v);engaged=v;}}};
  const code=make(ns=>ns.permitted,warfareDecision,false,()=>{}),r=Function('ns','return '+code)(ns);
  assert.equal(r.engaged,allowed);assert.equal(r.before,false);assert.equal(r.reason,allowed?'routine-threshold-met':'control-blocked');
  assert.deepEqual(calls,allowed?[true]:[]);assert.equal(files['tasks/gang-warfare-decision.json'].engaged,allowed);
 }
});

const pulse={at:19900,faction:'Own',power:100,territory:.3,predicted:10,expectedMembers:['M'],members:['M']};
const gang={faction:'Own',power:110,territory:.3},snap={changed:true,at:20000,faction:'Own'};
test('pulse diagnostics distinguish missing, mismatched, flat and clash-confounded observations',()=>{
 const inspect=(p=pulse,g=gang)=>gangPulseObservation(p,g,snap,20000);
 assert.equal(inspect().state,'power-increased');assert.equal(inspect().observed,10);
 assert.equal(inspect(null).state,'no-pulse');assert.equal(inspect({...pulse,members:[]}).state,'assignment-mismatch');
 assert.equal(inspect({...pulse,expectedMembers:[],members:[]}).state,'no-eligible-members');
 assert.equal(inspect(pulse,{...gang,power:100}).state,'power-unchanged');
 assert.equal(inspect(pulse,{...gang,power:99}).state,'clash-confounded');
 assert.equal(inspect(pulse,{...gang,territory:.31}).state,'clash-confounded');
 assert.equal(inspect({...pulse,at:20000}).state,'unmatched-pulse');
 assert.equal(inspect({...pulse,at:-20000}).state,'unmatched-pulse');
 assert.equal(inspect({...pulse,expectedMembers:undefined}).state,'unverified-assignments');
 assert.equal(gangPulseObservation(pulse,gang,{...snap,changed:false},20000).state,'unverified-update');
});

test('already assigned crews still produce a verified native power snapshot',async()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=s.indexOf('async function updateMemberActivities('),end=s.indexOf('\n/** @param {NS} ns',start);
 const crew={M:{name:'M',task:'Territory Warfare',def:1000,hack:10,str:100,dex:100,agi:100,cha:10}},files={};
 const ns={args:[],print:()=>{},gang:{getGangInformation:()=>({faction:'Own',power:100,territory:.3}),getMemberInformation:n=>crew[n]}};
 const run=Function('applyGangWorkOrders','getNsDataThroughFile',`let pendingPowerPulse=null;const assignedTasks={M:'Work'},memberProtectedTask=()=>null,gangWarfareMemberEligible=()=>true,gangMutationAllowed=()=>true,log=()=>{},isHackGang=false;${s.slice(start,end)};return async(ns,crew)=>{await updateMemberActivities(ns,crew,'Territory Warfare',{territoryWarfareEngaged:true,territoryClashChance:1});return pendingPowerPulse;};`)(applyGangWorkOrders,async(ns,code,path,args)=>{ns.args=args;files[path]=code;return Function('ns','return '+code)(ns);});
 const p=await run(ns,crew);assert.deepEqual(p.members,['M']);assert.deepEqual(p.expectedMembers,['M']);assert.ok(p.predicted>0);
 assert.equal(Object.keys(files).length,1);
 assert.equal(applyGangWorkOrders(ns,[],()=>false,7).deferred,true);
});

test('post-readiness power priority keeps material gain, completed payback and output safeguards',()=>{
 const w={powerFocus:true,powerPriority:true,power:100,preparation:{active:false},rivals:[{samples:3}]};
 const before={power:200,powerReady:0,total:100,cumulative:[{at:20,power:101},{at:600,power:200}]};
 const after={power:230,powerReady:0,total:60,cumulative:[{at:20,power:102},{at:600,power:230}]};
 assert.equal(gangPowerBenefit(after,before,w,900).powerObjective,true);
 for(const bad of [{...after,total:49},{...after,cumulative:[]},{...after,power:200.0001}])assert.equal(gangPowerBenefit(bad,before,w,900).powerObjective,false);
});
