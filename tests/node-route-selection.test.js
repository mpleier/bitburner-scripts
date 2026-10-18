import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {bitNodeRoutePreference,nodeRouteAvailability,chooseNodeRoute,routeContinuousXp,routeDevelopment,trainBladeburnerEntrySource,stopBladeburnerEntrySource} from '../node-route-selection-policy.js';
import {estimateDaemonRoute,estimateBladeburnerRoute,nodeRouteSnapshotSource,sampleRouteProgress} from '../node-route-policy.js';
import {autopilotSourceFiles,autopilotOptionsError} from '../autopilot-policy.js';

const trainBladeburnerEntry=vm.runInNewContext('('+trainBladeburnerEntrySource+')'),stopBladeburnerEntry=vm.runInNewContext('('+stopBladeburnerEntrySource+')');
const context={now:1000000,augReset:10,nodeReset:5,node:9};
const known=(lowerMs,upperMs)=>({actionable:true,etaMs:(lowerMs+upperMs)/2,lowerMs,upperMs});
test('all fifteen BN starting preferences match the evaluated policy',()=>{
 const bb=new Set([6,7,9,10,13,14]);
 for(let node=1;node<=15;node++)assert.equal(bitNodeRoutePreference(node).selected,bb.has(node)?'bladeburner':'hacking');
 for(const node of [2,4,11,12])assert.equal(bitNodeRoutePreference(node).confidence,'low');
 assert.equal(bitNodeRoutePreference(8).confidence,'required');
});
test('missing forecasts select labelled BN defaults, never a claimed measured winner',()=>{
 for(let node=1;node<=15;node++) {
  const p=chooseNodeRoute({},null,{...context,node});
  assert.equal(p.selected,bitNodeRoutePreference(node).selected);assert.equal(p.policy,'bn-default');assert.equal(p.candidate,null);
 }
});
test('BB availability honors SF access, current-node access, restrictions, pause and achievements',()=>{
 const reset={currentNode:9},sf={4:3,7:1};assert.equal(nodeRouteAvailability(reset,sf).bladeburner,true);
 for(const [r,s,o,state] of [[{currentNode:8},sf,{},{}],[reset,{4:3},{},{}],[reset,{7:1},{},{}],
  [{...reset,bitNodeOptions:{disableBladeburner:true}},sf,{},{}],[reset,sf,{'disable-bladeburner':true},{}],
  [reset,sf,{}, {paused:true}],[reset,sf,{}, {allowed:false}]])assert.equal(nodeRouteAvailability(r,s,o,state).bladeburner,false);
 const r={currentNode:6,ownedSF:{4:3}};assert.equal(nodeRouteAvailability(r,autopilotSourceFiles(r)).bladeburner,true);
});
test('unavailable BN preference falls back, but explicit unavailable BB does not silently choose WD',()=>{
 const availability={hacking:true,bladeburner:false,bladeburnerReason:'restricted'};
 const p=chooseNodeRoute({},null,{...context,availability});assert.equal(p.selected,'hacking');assert.match(p.reason,/restricted/);
 const q=chooseNodeRoute({},null,{...context,availability,override:'bb'});assert.equal(q.selected,null);assert.equal(q.policy,'unavailable');
});
test('explicit WD and BB override opposite measured advantages; legacy false preserves WD',()=>{
 for(const override of ['wd','hacking'])assert.equal(chooseNodeRoute({hacking:known(1000,2000),bladeburner:known(0,0)},null,{...context,override}).selected,'hacking');
 for(const override of ['bb','bladeburner'])assert.equal(chooseNodeRoute({},null,{...context,node:1,override}).selected,'bladeburner');
 assert.equal(chooseNodeRoute({},null,{...context,adaptive:false}).selected,'hacking');
 assert.equal(chooseNodeRoute({},null,{...context,adaptive:false,override:'bb'}).selected,'bladeburner');
});
test('invalid route flags fail configuration validation',()=>{
 assert.match(autopilotOptionsError({'node-route':'invalid'}),/node-route/);
});
test('switch requires twenty-five percent separation for two minutes of fresh same-reset evidence',()=>{
 const routes={hacking:known(100,200),bladeburner:known(1000,2000)};
 let p=chooseNodeRoute(routes,null,context);assert.equal(p.selected,'bladeburner');assert.equal(p.candidate,'hacking');
 for(let i=1;i<=3;i++){p=chooseNodeRoute(routes,p,{...context,now:context.now+i*30000});assert.equal(p.selected,'bladeburner');}
 p=chooseNodeRoute(routes,p,{...context,now:context.now+120000});assert.equal(p.selected,'hacking');assert.equal(p.policy,'measured');
});
test('overlap, inverted ranges, partial or unavailable routes cannot win on a missing ETA',()=>{
 for(const hacking of [known(800,1100),known(20,10),{...known(1,2),actionable:false},{etaMs:0},known(NaN,1)]) {
  const p=chooseNodeRoute({hacking,bladeburner:known(1000,2000)},null,context);assert.equal(p.candidate,null);assert.equal(p.selected,'bladeburner');
 }
});
test('reset, stale snapshots, future timestamps and broken comparison restart confirmation',()=>{
 const routes={hacking:known(1,2),bladeburner:known(1000,2000)};
 const prior=chooseNodeRoute(routes,null,context);
 for(const patch of [{augReset:11},{nodeReset:6},{now:context.now+46000},{now:context.now-1}]) {
  const c={...context,now:context.now+30000,...patch},p=chooseNodeRoute(routes,prior,c);
  assert.equal(p.selected,'bladeburner');assert.equal(p.candidateSince,c.now);
 }
 const p=chooseNodeRoute({},prior,{...context,now:context.now+30000});assert.equal(p.candidate,null);
 const q=chooseNodeRoute(routes,p,{...context,now:context.now+60000});assert.equal(q.candidateSince,context.now+60000);
});
test('an incumbent measured winner remains selected while ranges overlap but both remain usable',()=>{
 const previous={...context,at:context.now-1000,selected:'hacking',policy:'measured'};
 const p=chooseNodeRoute({hacking:known(100,300),bladeburner:known(200,400)},previous,context);
 assert.equal(p.selected,'hacking');assert.equal(p.policy,'measured');
 const q=chooseNodeRoute({},previous,context);assert.equal(q.selected,'hacking');assert.equal(q.policy,'measured-hold');
});
test('automatic BB releases continuous XP while explicit and measurement scheduling remain possible',()=>{
 assert.equal(routeContinuousXp({}, {selected:'bladeburner'}),false);assert.equal(routeContinuousXp({}, {selected:'hacking'}),true);
 assert.equal(routeContinuousXp({'force-xp':true},{selected:'bladeburner'}),true);
 assert.equal(routeContinuousXp({'disable-continuous-xp':true},{selected:'hacking'}),false);
});
test('WD prerequisite stages retain unknown augmentation and post-reset time',()=>{
 const p=estimateDaemonRoute({singularityKnown:true,hasRedPill:false,daedalus:false,installedAugs:1,daedalusAugsRequired:30,worth:50e9,hacking:200}, {cashRate:1e9});
 assert.equal(p.actionable,false);assert.equal(p.etaMs,null);assert.equal(p.partial,true);
 assert.equal(p.stages.find(s=>s.name.includes('wealth')).etaMs,50000);assert.equal(p.stages[0].etaMs,null);
 assert.equal(estimateDaemonRoute({queuedRedPill:true,singularityKnown:true}).etaMs,null);
});
test('WD installed XP ranges use measured rates and reject zero throughput',()=>{
 const s={hasRedPill:true,hacking:100,wdHack:200,hackMult:1,exp:1000};
 const p=estimateDaemonRoute(s,{xpModes:{xp:{rate:100,low:75,high:125}}});assert.equal(p.actionable,true);assert.ok(p.lowerMs<p.etaMs&&p.etaMs<p.upperMs);
 assert.equal(estimateDaemonRoute(s,{xpModes:{xp:{rate:0,low:75,high:125}}}).etaMs,null);
});
test('BB credits ordered rewards and finite grind pools; unsafe later BlackOps stay partial',()=>{
 const action={time:1000,chance:[1,1],gain:100,loss:0,count:10};
 const op=(name,required,chance=1)=>({name,required,time:1000,chance:[chance,chance],gain:100,loss:0});
 const p=estimateBladeburnerRoute({rank:0,actions:[action],ops:[op('A',100),op('B',200)]});assert.equal(p.actionable,true);assert.equal(p.lowerMs,3000);
 const q=estimateBladeburnerRoute({rank:0,actions:[action],ops:[op('A',100),op('B',200,.5)]});assert.equal(q.etaMs,null);assert.equal(q.partial,true);assert.equal(q.completedStagesMs,2000);
 const r=estimateBladeburnerRoute({rank:0,actions:[{...action,count:1}],ops:[op('A',1000)]});assert.equal(r.actionable,false);
});
test('combat entry and next BlackOp growth are partial milestones, with unknowns preserved',()=>{
 const combat=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,{level:80,exp:100,mult:1,requiredExp:300}]));
 const first={at:1000,combat,bb:{rank:10,city:'A',ops:[{name:'A',chance:[.5,.5]}]}};
 const current={at:61000,combat:Object.fromEntries(Object.entries(combat).map(([k,v])=>[k,{...v,exp:200}])),bb:{rank:70,city:'A',ops:[{name:'A',required:130,chance:[.6,.6]}]}};
 const p=routeDevelopment(current,{samples:[first,current]});assert.equal(p.entry.needsTraining,true);assert.equal(p.entry.etaMs,60000);assert.equal(p.nextBlackOp.rankEtaMs,60000);assert.ok(p.nextBlackOp.chanceEtaMs>0);assert.equal(p.nextBlackOp.safe,false);
 assert.equal(routeDevelopment(current).entry.etaMs,null);
 current.bb.city='B';assert.equal(routeDevelopment(current,{samples:[first,current]}).nextBlackOp.chanceEtaMs,null);
});
test('development observations reset after installs, long gaps and changed hacking multipliers',()=>{
 const s={at:1000,exp:100,hackMult:1,hackingMultiplier:1,augReset:10,nodeReset:5,xpMode:'xp',worth:100};
 const p=sampleRouteProgress(null,s);
 for(const patch of [{augReset:11},{nodeReset:6},{hackMult:2},{at:47000}])assert.equal(sampleRouteProgress(p,{...s,at:2000,...patch}).samples.length,1);
});
test('generated snapshot is executable and uses current BN combat multipliers',()=>{
 const ns={getPlayer:()=>({exp:{hacking:1000,strength:100,defense:100,dexterity:100,agility:100},skills:{hacking:100,strength:80,defense:80,dexterity:80,agility:80},mults:{hacking:2,faction_rep:1,strength:2,defense:2,dexterity:2,agility:2},money:1}),getResetInfo:()=>({ownedAugs:{},currentNode:9}),getBitNodeMultipliers:()=>({HackingLevelMultiplier:.5}),serverExists:()=>false,ps:()=>[]};
 const s=vm.runInNewContext(nodeRouteSnapshotSource(false,false,{StrengthLevelMultiplier:.45}),{ns});
 assert.equal(s.combat.strength.mult,.9);assert.equal(s.hackMult,1);assert.ok(Number.isFinite(s.combat.strength.requiredExp));
});

function trainingFixture() {
 const now=Date.now(),files={'tasks/node-route-plan.json':{ownerPid:1,selected:'bladeburner',augReset:10,nodeReset:5,at:now},'tasks/activity-lock.json':{ownerPid:2,expiresAt:now+15000}};
 const commits=[],stops=[];let work=null,stats=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,80]));
 const ns={read:f=>typeof files[f]==='string'?files[f]:JSON.stringify(files[f]??null),isRunning:()=>true,getResetInfo:()=>({lastAugReset:10,lastNodeReset:5}),getPlayer:()=>({skills:stats}),ps:()=>[],singularity:{getCurrentWork:()=>work,getCrimeStats:()=>({strength_exp:10,defense_exp:10,dexterity_exp:10,agility_exp:10,time:2000}),getCrimeChance:()=>1,commitCrime:name=>{commits.push(name);work={type:'CRIME',crimeType:name};return 2000;},stopAction:()=>{stops.push(work);work=null;return true;}}};
 return {ns,files,commits,stops,setWork:w=>work=w,ready:()=>stats=Object.fromEntries(Object.keys(stats).map(k=>[k,100]))};
}
test('serialized entry worker starts one short crime and leaves its continuing cycle intact',()=>{
 const f=trainingFixture(),worker=vm.runInNewContext('('+trainBladeburnerEntry.toString()+')');
 const p=worker(f.ns,2);assert.equal(p.state,'training');assert.equal(f.commits.length,1);
 assert.equal(worker(f.ns,2,p.crime).state,'training');assert.equal(f.commits.length,1);
 f.ready();assert.equal(worker(f.ns,2,p.crime).state,'ready');assert.equal(f.stops.length,1);
});
test('entry worker never stops replacement work, protected work or untracked manual work',()=>{
 for(const work of [{type:'GRAFTING'},{type:'CREATE_PROGRAM'},{type:'FACTION'},{type:'CLASS'}]) {
  const f=trainingFixture();f.setWork(work);assert.equal(trainBladeburnerEntry(f.ns,2).state,'protected-work');assert.equal(f.commits.length,0);
 }
 const f=trainingFixture();f.setWork({type:'GRAFTING'});assert.equal(stopBladeburnerEntry(f.ns,2,'Mug'),false);assert.equal(f.stops.length,0);
});
test('entry workers honor pauses, stale/reset plans, owner loss, activity locks, maintenance and casino',()=>{
 for(const change of [f=>f.files['tasks/node-route-plan.json'].selected='hacking',f=>f.files['tasks/node-route-plan.json'].augReset=11,
  f=>f.files['tasks/node-route-plan.json'].at=Date.now()-46000,f=>f.files['tasks/node-route-plan.json'].at=Date.now()+1000,
  f=>f.files['tasks/activity-lock.json'].ownerPid=3,f=>f.files['tasks/activity-lock.json'].expiresAt=0,
  f=>f.files['remote-control/paused/bladeburner.js.txt']='true',f=>f.files['remote-control/paused/crime.js.txt']='true',
  f=>f.ns.isRunning=()=>false,f=>f.files['tasks/automation-maintenance.json']={ownerPid:3,expiresAt:Date.now()+10000},
  f=>f.files['tasks/achievement-profile.json']={active:true,nodeReset:5,deniedActions:['bladeburner']},
  f=>f.ns.ps=()=>[{filename:'casino.js'}]]) {
  const f=trainingFixture();change(f);assert.equal(trainBladeburnerEntry(f.ns,2).state,'waiting');assert.equal(f.commits.length,0);
 }
});
test('route handoff cleanup stops only its tracked matching crime',()=>{
 const f=trainingFixture();f.setWork({type:'CRIME',crimeType:'Mug'});assert.equal(stopBladeburnerEntry(f.ns,2,'Shoplift'),false);
 assert.equal(stopBladeburnerEntry(f.ns,2,'Mug'),true);assert.equal(f.stops.length,1);
});
test('actual autopilot integrates automatic preferences and guarded fallback without touching departure rules',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(s,/\['adaptive-node-route', true\]/);assert.match(s,/\['node-route','auto'\]/);
 assert.match(s,/chooseNodeRoute\(routes,routePlan/);assert.match(s,/chooseNodeRoute\(\{\},null/);
 assert.match(s,/routeContinuousXp\(options,routePlan\)/);assert.doesNotMatch(s,/World Daemon is the configured default/);
 assert.match(s,/bitNodeVictory\(player.skills.hacking, wdHack, daemonRooted, blackOpsComplete\)/);
});
test('actual controllers expose BB entry handoff and preserve protected work guards',async()=>{
 const bb=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8'),fac=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');
 assert.match(bb,/claimActivity\(ns,'Bladeburner entry training'\)/);assert.match(bb,/stopBladeburnerEntrySource/);
 assert.match(fac,/routePlan\?\.development\?\.entry\?\.needsTraining/);assert.match(fac,/\["GRAFTING","CREATE_PROGRAM"\]/);
});


test('unknown combat XP requirements never become zero-time entry estimates',()=>{
 for(const requiredExp of [null,undefined,Infinity,NaN]) {
  const combat=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,{level:80,exp:200,mult:1,requiredExp}]));
  const first={at:1000,combat:Object.fromEntries(Object.entries(combat).map(([k,v])=>[k,{...v,exp:100}]))};
  assert.equal(routeDevelopment({at:61000,combat},{samples:[first]}).entry.etaMs,null);
 }
});
