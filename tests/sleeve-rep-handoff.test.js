import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sleeveFactionRepScore,factionWorkScores,bestFactionWork} from '../sleeve-policy.js';
import {planSleeveRepHandoff,executeSleeveRepHandoff,sleeveRepHandoffFile} from '../sleeve-rep-handoff-policy.js';
const makeSleeve=hacking=>({shock:0,sync:100,skills:{hacking,strength:100,defense:100,dexterity:100,agility:100,charisma:0,intelligence:0},mults:{faction_rep:1}});
const target={type:'FACTION',name:'Daedalus',priority:0,requiredRep:250000,workTypes:['hacking']};
function fixture(options={}){
 const now=Date.now(),sleeves=[makeSleeve(100),makeSleeve(500)],tasks=[{type:'FACTION',factionName:'Daedalus',factionWorkType:'hacking'},{type:'RECOVERY'}];
 const reset={lastNodeReset:100,lastAugReset:200,currentNode:7,ownedSF:new Map()},context={nodeReset:100,augReset:200,ownerPid:7,shareBonus:1,sf15Level:0};
 const p=planSleeveRepHandoff(sleeves,tasks,{0:target},null,context,now),files=new Map(),events=[];let writes=0,paused=false;
 const ns={getResetInfo:()=>reset,getPlayer:()=>({factions:['Daedalus']}),getSharePower:()=>1,read:f=>files.get(f)||'',
  write:async(f,v)=>{writes++;if(options.failWrite===writes)throw Error('write failed');files.set(f,v);if(options.afterWrite)options.afterWrite(writes);},
  singularity:{getFactionRep:()=>options.rep??0,getFactionWorkTypes:()=>['hacking']},
  sleeve:{getNumSleeves:()=>2,getSleeve:i=>sleeves[i],getTask:i=>tasks[i],
   setToShockRecovery:i=>{events.push('release:'+i);if(options.failRelease)return false;tasks[i]={type:'RECOVERY'};if(options.pauseAfterRelease)paused=true;return true;},
   setToFactionWork:(i,faction,work)=>{events.push('assign:'+i);if(i===1&&options.failAssign||i===0&&options.failRestore)return false;tasks[i]={type:'FACTION',factionName:faction,factionWorkType:work};return true;}}};
 return {now,sleeves,tasks,reset,context,p,files,events,ns,allowed:()=>!paused,state:()=>JSON.parse(files.get(sleeveRepHandoffFile)||'null')};
}
test('handoff proposal requires a substantial gain, spare healthy worker, and a still-critical target',()=>{
 const f=fixture();assert.equal(f.p.to,1);assert.equal(f.p.ratio,5);
 f.sleeves[1].skills.hacking=149;assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},null,f.context,f.now),null);
 f.sleeves[1].skills.hacking=150;assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},null,f.context,f.now).to,1);
 for(const type of ['CRIME','CLASS','FACTION','COMPANY','INFILTRATE','SUPPORT','BLADEBURNER']){
  assert.equal(planSleeveRepHandoff(f.sleeves,[f.tasks[0],{type}],{0:target},null,f.context,f.now),null,type);
 }
 assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},null,{...f.context,reservedSleeves:[1]},f.now),null);
 for(const patch of [{shock:1},{sync:99}])assert.equal(planSleeveRepHandoff([f.sleeves[0],{...f.sleeves[1],...patch}],f.tasks,{0:target},null,f.context,f.now),null);
 assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:{...target,priority:1}},null,f.context,f.now),null);
});
test('successful native transaction persists its attempt and releases before assigning',async()=>{
 const f=fixture(),result=await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,f.allowed);
 assert.equal(result.success,true);assert.deepEqual(f.events,['release:0','assign:1']);assert.equal(f.tasks[1].factionName,'Daedalus');
 const row=f.state().entries.Daedalus;assert.equal(row.pending,false);assert.ok(row.lastSuccess>=f.now);assert.equal(row.lastResult.success,true);
 assert.equal(planSleeveRepHandoff(f.sleeves,[{...f.tasks[1]}, {type:'RECOVERY'}],{0:target},f.state(),f.context,Date.now()+1000),null);
});
test('cooldowns survive restarts, failed attempts retry after one minute, and resets clear them',()=>{
 const f=fixture(),state={version:1,nodeReset:100,augReset:200,entries:{Daedalus:{lastAttempt:f.now,lastSuccess:f.now}}};
 assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,f.context,f.now+599999),null);
 assert.ok(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,f.context,f.now+600000));
 state.entries.Daedalus.lastSuccess=0;assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,f.context,f.now+59999),null);
 assert.ok(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,f.context,f.now+60000));
 assert.ok(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,{...f.context,augReset:201},f.now));
 for(const patch of [{blocked:true},{pending:true},{lastAttempt:f.now+1}]){
  state.entries.Daedalus={lastAttempt:0,lastSuccess:0,...patch};assert.equal(planSleeveRepHandoff(f.sleeves,f.tasks,{0:target},state,f.context,f.now),null);
 }
});
test('failed release makes no assignment; failed new assignment restores the old owner',async()=>{
 const release=fixture({failRelease:true});assert.equal((await executeSleeveRepHandoff(release.ns,release.p,sleeveFactionRepScore,release.allowed)).success,false);assert.deepEqual(release.events,['release:0']);
 const assign=fixture({failAssign:true}),r=await executeSleeveRepHandoff(assign.ns,assign.p,sleeveFactionRepScore,assign.allowed);
 assert.equal(r.success,false);assert.equal(r.blocked,false);assert.deepEqual(assign.events,['release:0','assign:1','assign:0']);assert.equal(assign.tasks[0].factionName,'Daedalus');
});
test('unrestored or paused rollback blocks future handoffs rather than assuming success',async()=>{
 for(const options of [{failAssign:true,failRestore:true},{pauseAfterRelease:true}]){
  const f=fixture(options),r=await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,f.allowed);
  assert.equal(r.success,false);assert.equal(r.blocked,true);assert.equal(f.state().entries.Daedalus.blocked,true);
  const again=await executeSleeveRepHandoff(f.ns,{...f.p,at:Date.now()},sleeveFactionRepScore,()=>true);assert.equal(again.success,false);
 }
});
test('fresh checks reject expired requests, changed owners/tasks/skills, completed goals and unavailable APIs',async()=>{
 for(const change of [f=>f.p.at-=10001,f=>f.reset.lastAugReset++,f=>f.tasks[0].factionName='Other',f=>f.tasks[1]={type:'CRIME'},f=>f.sleeves[1].shock=1,f=>f.sleeves[1].skills.hacking=101,f=>f.ns.singularity.getFactionRep=()=>NaN,f=>delete f.ns.sleeve.setToFactionWork]){
  const f=fixture();change(f);const r=await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,f.allowed);
  assert.equal(r.success,false);assert.equal(f.events.length,0);
 }
 const f=fixture({rep:250000});assert.equal((await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,f.allowed)).success,false);assert.equal(f.events.length,0);
});
test('attempt persistence failures cause no mutation; a lost final write leaves a pending safety hold',async()=>{
 const first=fixture({failWrite:1});await assert.rejects(executeSleeveRepHandoff(first.ns,first.p,sleeveFactionRepScore,first.allowed));assert.equal(first.events.length,0);
 const last=fixture({failWrite:2});await assert.rejects(executeSleeveRepHandoff(last.ns,last.p,sleeveFactionRepScore,last.allowed));
 assert.equal(last.tasks[1].factionName,'Daedalus');assert.equal(last.state().entries.Daedalus.pending,true);
});
test('controls are rechecked after the durable attempt write and before releasing the owner',async()=>{
 let allowed=true;const f=fixture({afterWrite:()=>{allowed=false;}});
 const r=await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,()=>allowed);assert.equal(r.success,false);assert.equal(f.events.length,0);
});
test('serialized worker runs independently and respects effective SF15 overrides',async()=>{
 const run=Function('ns','p','allowed',`const factionWorkScores=${factionWorkScores.toString()};const bestFactionWork=${bestFactionWork.toString()};const score=${sleeveFactionRepScore.toString()};return (${executeSleeveRepHandoff.toString()})(ns,p,score,allowed);`);
 const f=fixture();f.reset.currentNode=15;f.reset.ownedSF=new Map([[15,3]]);f.reset.bitNodeOptions={sourceFileOverrides:new Map([[15,0]])};
 assert.equal((await run(f.ns,f.p,f.allowed)).success,true);
});
test('native scoring receives the current share and effective source-file context',async()=>{
 for(const [owned,override,node,expected]of [[3,undefined,7,3],[3,new Map([[15,0]]),15,0],[0,undefined,15,1],[1,{15:3},7,3]]){
  const f=fixture(),seen=[];f.reset.ownedSF=new Map([[15,owned]]);f.reset.bitNodeOptions={sourceFileOverrides:override};f.reset.currentNode=node;f.ns.getSharePower=()=>3;
  const score=(s,types,context)=>{seen.push(context);return sleeveFactionRepScore(s,types,context);};
  assert.equal((await executeSleeveRepHandoff(f.ns,f.p,score,f.allowed)).success,true);
  assert.ok(seen.every(c=>c.sf15Level===expected&&c.shareBonus===3));assert.equal(seen.length,2);
 }
});
test('a duplicate native dispatch cannot bypass the durable cooldown',async()=>{
 const f=fixture();assert.equal((await executeSleeveRepHandoff(f.ns,f.p,sleeveFactionRepScore,f.allowed)).success,true);
 const count=f.events.length;assert.equal((await executeSleeveRepHandoff(f.ns,{...f.p,at:Date.now()},sleeveFactionRepScore,f.allowed)).success,false);assert.equal(f.events.length,count);
});
test('controller refreshes native sleeves and tasks after a handoff, including lost replies',()=>{
 const s=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 assert.match(s,/requiredRep:needed/);assert.match(s,/let actualTasks = await/);assert.match(s,/sleeve-tasks-after-handoff/);
 assert.match(s,/reputationAssignments=assignReputation\(\)/);assert.match(s,/readNodeRoutePlan.toString/);
});
