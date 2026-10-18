import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {augmentationFundingWorkTargets} from '../faction-reassessment-policy.js';
import {estimateMixedAugmentationWait} from '../progression-speed-policy.js';

const now=2000000,reset={lastNodeReset:1,lastAugReset:2};
function record(){
 return {schemaVersion:1,active:true,ownerPid:10,nodeReset:1,augReset:2,startedAt:now-1000,at:now,expiresAt:now+60000,
  plan:{name:'Target',at:now,worthWaiting:true,deadline:now+60000,
   funding:{seconds:50,workTargets:{A:50,B:100},workByFaction:{A:5,B:10}}}};
}
const select=(r=record(),options={})=>augmentationFundingWorkTargets(r,{now,reset,ownerAlive:true,joined:['A','B'],...options});

test('fresh wait plans provide exact work targets and stable keys across heartbeat refreshes',()=>{
 const tasks=select();assert.deepEqual(tasks.map(t=>[t.faction,t.targetRep]),[['A',50],['B',100]]);
 const updated=record();updated.at+=1000;updated.plan.at+=1000;
 assert.equal(select(updated,{now:now+1000})[0].key,tasks[0].key);
 updated.plan.name='Other';assert.notEqual(select(updated,{now:now+1000})[0].key,tasks[0].key);
});

test('stale, expired, withdrawn, orphaned and foreign-reset wait plans cannot direct faction work',()=>{
 for(const update of [{active:false},{schemaVersion:0},{at:now+1},{at:now-120001},{expiresAt:now},
  {startedAt:now+1},{expiresAt:now+16*60000},{augReset:3},{nodeReset:3},{ownerPid:0}]){
  assert.deepEqual(select({...record(),...update}),[]);
 }
 for(const plan of [{...record().plan,at:now-120001},{...record().plan,worthWaiting:false},
  {...record().plan,deadline:now+120000},{...record().plan,deadline:now}])
  assert.deepEqual(select({...record(),plan}),[]);
 assert.deepEqual(select(record(),{ownerAlive:false}),[]);
 assert.deepEqual(select(record(),{reset:{}}),[]);
});

test('explicit faction priorities, crime and invite modes remain above augmentation assistance',()=>{
 for(const options of [{first:['A']},{crimeFocus:true},{invitesOnly:true}])assert.deepEqual(select(record(),options),[]);
 assert.deepEqual(select(record(),{skip:['A'],gangFaction:'B'}),[]);
 assert.deepEqual(select(record(),{joined:['A']}).map(t=>t.faction),['A']);
 const r=record();r.plan.funding.workTargets.Bladeburners=10;r.plan.funding.workByFaction.Bladeburners=1;
 assert.equal(select(r,{joined:['Bladeburners']}).length,0);
});

test('funding work ignores completed, invalid and donation-only requirements',()=>{
 const r=record();r.plan.funding.workByFaction.A=0;r.plan.funding.workTargets.B=NaN;
 assert.deepEqual(select(r),[]);
 r.plan.funding={seconds:10,donationsByFaction:{A:100},workByFaction:{},workTargets:{}};
 assert.deepEqual(select(r),[]);
});

test('mixed estimates expose absolute targets independently of measured work durations',()=>{
 const plan=estimateMixedAugmentationWait({requirements:[{rep:150,factions:['A'],providers:[{faction:'A',requiredDonation:null}]}],
  cost:10,worth:10,cashRate:0,reputation:{A:100},repRates:{A:10}});
 assert.equal(plan.seconds,5);assert.deepEqual(plan.workTargets,{A:150});assert.deepEqual(plan.workByFaction,{A:5});
});

const source=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const begin=source.indexOf('export async function workForSingleFaction(');
const end=source.indexOf('/** Stop whatever focus',begin);
const functionSource=source.slice(begin,end).replace('export ','');
function harness({cancel=false,protectedOnCancel=false,pending=false,blocked=false}={}){
 let time=now,rep=0,active=true,current={},started=0,stopped=0,sleeps=0;
 const target={faction:'A',targetRep:50,key:'key'};
 const ns={print(){},sleep:async()=>{sleeps++;rep+=10;time+=5000;if(cancel){active=false;if(protectedOnCancel)current={type:'GRAFTING'};}}};
 const context={Date:{now:()=>time},Math,mostExpensiveAugByFaction:{A:10000},mostExpensiveDesiredAugByFaction:{A:10000},
  dictFactionFavors:{A:0},favorToDonate:150,firstFactions:[],playerGang:null,options:{'no-tail-windows':true},
  earnFactionInvite:async()=>true,getFactionReputation:async()=>rep,checkFactionMembership:async()=>blocked,breakToMainLoop:()=>false,
  readAugmentationFundingWork:()=>active?[target]:[],pendingAugmentationFundingWork:async()=>pending?target:null,
  getCurrentWorkInfo:async()=>current,maintainWorkFocus:async()=>{},isValidInterruption:async()=>true,
  detectBestFactionWork:async()=> 'hacking',startWorkForFaction:async()=>{started++;current={type:'FACTION',factionName:'A',factionWorkType:'hacking'};return true;},
  stop:async()=>{stopped++;current={};},statusUpdateInterval:60000,lastFactionWorkStatus:null,shouldFocus:false,hasFocusPenalty:false,
  formatNumberShort:String,formatDuration:String,log(){},measureFactionRepGainRate:async()=>10,tryBuyReputation:async()=>{},loopSleepInterval:5000};
 vm.runInNewContext(functionSource+';globalThis.run=workForSingleFaction;',context);
 return {run:planned=>context.run(ns,'A',false,false,planned?50:false,planned?target:null),counts:()=>({rep,started,stopped,sleeps})};
}

test('executed planned work stops at its exact rep target instead of grinding expensive unrelated augmentations',async()=>{
 const h=harness();assert.equal(await h.run(true),true);
 assert.deepEqual(h.counts(),{rep:50,started:1,stopped:1,sleeps:5});
});

test('executed planned work cancels promptly after withdrawal and releases only its faction activity',async()=>{
 const h=harness({cancel:true});assert.equal(await h.run(true),false);
 assert.deepEqual(h.counts(),{rep:10,started:1,stopped:1,sleeps:1});
 const protectedWork=harness({cancel:true,protectedOnCancel:true});await protectedWork.run(true);
 assert.equal(protectedWork.counts().stopped,0);
});

test('ordinary work yields to selected funding work and existing activity guards still run first',async()=>{
 const h=harness({pending:true});await h.run(false);assert.equal(h.counts().started,0);
 const blocked=harness({blocked:true});await blocked.run(true);assert.equal(blocked.counts().started,0);
});

test('actual funding reader skips achieved targets and refuses a higher-priority Red Pill goal',async()=>{
 const start=source.indexOf('function readAugmentationFundingWork('),finish=source.indexOf('/** @param {NS} ns\n * @returns {Promise<ResetInfo>}',start);
 const fragment=source.slice(start,finish);
 let pill=null;const ns={read:()=>JSON.stringify(record()),isRunning:()=>true};
 const context={Date:{now:()=>now},augmentationFundingWorkTargets,readNodeRoutePlan:()=>({redPill:pill}),fundingResetInfo:reset,
  factionMembershipState:{current:['A','B']},skipFactions:[],firstFactions:[],playerGang:null,options:{},
  getFactionReputation:async(ns,f)=>f==='A'?50:0};
 vm.runInNewContext(fragment+';globalThis.pending=pendingAugmentationFundingWork;',context);
 assert.equal((await context.pending(ns)).faction,'B');
 pill={active:true,requiredRep:100,rep:0};assert.equal(await context.pending(ns),null);
});

test('autopilot explicitly withdraws obsolete work plans and faction assistance sits below Red Pill priority',()=>{
 const autopilot=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.ok(autopilot.includes('active:true,ownerPid:ns.pid'));
 assert.ok(autopilot.includes('active:false,ownerPid:ns.pid'));
 const planned=source.indexOf('const fundingWork=await pendingAugmentationFundingWork(ns);');
 assert.ok(source.indexOf('const redPill=readNodeRoutePlan(ns)?.redPill;')<planned);
 assert.ok(planned<source.indexOf('const factionWorkOrder ='));
});


test('partial funding guides faction work only to the earned portion of the requirement',()=>{
 const funding=estimateMixedAugmentationWait({requirements:[{rep:200,factions:['A'],providers:[{faction:'A',requiredDonation:100}]}],
  cost:100,worth:100,cashRate:1,reputation:{A:100},repRates:{A:1}});
 const r=record();r.plan.funding=funding;
 const [target]=select(r);
 assert.equal(target.targetRep,150);
 assert.equal(funding.donationCost,50);
 assert.equal(funding.reputationSeconds,50);
});
