import {captureNativeTrainingObservation} from '../player-training-calibration-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerTrainingMilestone,bladeburnerTrainingPayoff} from '../bladeburner-training-policy.js';
const reset={lastNodeReset:1,lastAugReset:2},keys=['strength','defense','dexterity','agility'];
const player=(xp=100)=>({exp:Object.fromEntries(keys.map(k=>[k,xp])),mults:{strength_exp:1}});
const update=(s,extra={})=>bladeburnerTrainingMilestone(s,{reset,ownerPid:7,target:'Typhoon',total:60,limit:50,now:100000,observe:true,training:true,player:player(),background:{count:0,observers:[]},workIdle:true,clock:{progress:(s?.clock?.progress??1)/2,duration:30000},...extra});
const candidate={kind:'training',score:2,rates:Object.fromEntries(keys.map(k=>[k,1]))};
test('new milestones have their own quota while reloads preserve training already used',()=>{
 let s=update(null);assert.equal(s.used,0);assert.equal(s.baseTotal,60);assert.equal(s.eligible,true);
 s=update(s,{total:70,now:110000});assert.equal(s.used,10);
 s=update(s,{ownerPid:8,total:70,now:120000});assert.equal(s.used,10);assert.equal(s.baseTotal,60);assert.equal(s.samples.length,0);
 const next=update(s,{target:'Zero',total:70,now:130000});assert.equal(next.used,0);assert.equal(next.baseTotal,70);
 assert.equal(update(next,{target:'Zero',total:120,now:140000}).eligible,false);
 assert.equal(update(s,{reset:{...reset,lastAugReset:3},total:0,now:140000}).used,0);
});
test('training allowance requires useful consecutive measured XP after its initial probe',()=>{
 let s=update(null);s=update(s,{total:61,now:130000,player:player(130)});
 assert.equal(s.samples.length,1);s=update(s,{total:62,now:160000,player:player(160)});assert.equal(s.eligible,true);
 assert.equal(bladeburnerTrainingPayoff(s,candidate,1,160000),true);assert.equal(bladeburnerTrainingPayoff(s,candidate,2,160000),false);
 const slow={...s,samples:[{at:160000,backgroundCorrected:true,completionAligned:true,rates:Object.fromEntries(keys.map(k=>[k,.1]))}]};assert.equal(bladeburnerTrainingPayoff(slow,candidate,1,160000),false);
 const external={...s,samples:[{at:160000,backgroundCorrected:true,completionAligned:true,rates:Object.fromEntries(keys.map(k=>[k,100]))}]};assert.equal(bladeburnerTrainingPayoff(external,candidate,2,160000),false);
 let zero=update(null);zero=update(zero,{total:62,now:160000,player:player()});assert.equal(zero.eligible,false);
});
test('missing evidence can get only a cooldown-limited bounded reprobe within the quota',()=>{
 let s=update(null);s=update(s,{total:62,now:160000,player:player()});assert.equal(s.eligible,false);
 s=update(s,{total:62,now:700000,training:false});assert.equal(s.eligible,true);assert.equal(s.probeUntil,4);
 s=update(s,{total:64,now:760000,player:player()});assert.equal(s.eligible,false);
 assert.equal(update(s,{limit:0,now:1400000}).eligible,false);
});
test('offline gaps, XP resets, profile changes and owner changes cannot fabricate measured output',()=>{
 let s=update(null);assert.equal(update(s,{now:170001,total:62,player:player(200)}).samples.length,0);
 assert.equal(update(s,{now:130000,total:61,player:player(90)}).samples.length,0);
 assert.equal(update(s,{ownerPid:8,now:130000,total:61,player:player(200)}).samples.length,0);
 assert.equal(update(s,{now:130000,total:61,player:{...player(200),mults:{strength_exp:2}}}).samples.length,0);
 assert.equal(update(s,{now:130000,total:61,training:false,player:player(200)}).samples.length,0);
});
test('quota and payoff reject disabled, stale, malformed and unmeasured inputs without mutation',()=>{
 const s=update(null),before=JSON.stringify(s);assert.equal(update(s,{limit:0}).eligible,false);assert.equal(update(s,{target:null}).eligible,false);
 assert.equal(bladeburnerTrainingPayoff(s,candidate,1,100000),true);
 for(const change of [{eligible:false},{at:100001},{at:0},{used:2,nativeUsed:2,samples:[]}])assert.equal(bladeburnerTrainingPayoff({...s,...change},candidate,1,100000),false);
 assert.equal(bladeburnerTrainingPayoff(s,{...candidate,score:NaN},1,100000),false);assert.equal(JSON.stringify(s),before);
});

test('executed general fallback cannot bypass the rolling Training time budget',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('        if (!bestActionName) {',source.indexOf('bestActionName=rankBladeburnerActions')),end=source.indexOf('        // Recruitment is reserved',start),block=source.slice(start,end);
 assert.ok(start>0&&end>start);
 for(const spentMs of [0,90000,90001,120000]){
  const c={bestActionName:null,populationUncertain:false,currentCity:'A',unreservedActions:['Tracking'],getCount:()=>1,cityNames:['A'],chaosByCity:{A:0},options:{'max-chaos':50,'success-threshold':.99,'high-stamina-pct':.9},maxChance:()=>0,staminaPct:1,trainingMilestone:{eligible:true,used:0,limit:50},developmentBudget:{spentMs},reason:''};vm.runInNewContext(block,c);assert.equal(c.bestActionName,spentMs<=90000?'Training':'Field Analysis');
 }
});
test('a zero-progress sample cannot be hidden by a later positive sample',()=>{
 let s=update(null);s=update(s,{total:61,now:130000,player:player()});s=update(s,{total:62,now:160000,player:player(160)});assert.equal(s.samples.length,2);assert.equal(s.eligible,false);
});

test('external sessions consume the shared milestone quota without becoming native Training probes',()=>{
 let s=update(null);s=update(s,{total:60,externalTotal:10,now:130000,training:false});assert.equal(s.used,10);assert.equal(s.nativeUsed,0);assert.equal(s.eligible,true);
 s=update(s,{total:60,externalTotal:50,now:160000,training:false});assert.equal(s.used,50);assert.equal(s.eligible,false);
 const next=update(s,{target:'Zero',total:60,externalTotal:50,now:170000,training:false});assert.equal(next.used,0);assert.equal(next.nativeUsed,0);
});


const sleeveBackground=n=>({count:2,observers:[{i:0,exp:Object.fromEntries(keys.map(k=>[k,n]))},{i:1,exp:Object.fromEntries(keys.map(k=>[k,n]))}]});
test('native Training subtracts shared sleeve XP before assessing continued payoff',()=>{
 let s=update(null,{background:sleeveBackground(1000)});
 s=update(s,{total:61,now:130000,player:player(1130),background:sleeveBackground(2000)});
 assert.equal(s.samples.length,1);assert.equal(s.samples[0].backgroundCorrected,true);assert.equal(s.samples[0].rates.strength,1);
 s=update(s,{total:62,now:160000,player:player(2160),background:sleeveBackground(3000)});
 assert.equal(s.eligible,true);assert.equal(bladeburnerTrainingPayoff(s,candidate,1,160000),true);
 let incomingOnly=update(null,{background:sleeveBackground(1000)});
 incomingOnly=update(incomingOnly,{total:62,now:130000,player:player(1100),background:sleeveBackground(2000)});
 assert.equal(incomingOnly.samples[0].rates.strength,0);assert.equal(incomingOnly.eligible,false);assert.equal(bladeburnerTrainingPayoff(incomingOnly,candidate,1,130000),false);
});
test('unknown background, observer disagreement and player work cannot produce native evidence',()=>{
 for(const patch of [{background:null},{workIdle:false},{background:{count:2,observers:[{i:0,exp:{}},{i:1,exp:{}}]}}]){
  let s=update(null);s=update(s,{...patch,total:62,now:130000,player:player(10000)});
  assert.equal(s.samples.length,0);assert.equal(s.anchor,null);assert.equal(s.eligible,false);
 }
 let s=update(null,{background:sleeveBackground(1000)}),disagree=sleeveBackground(2000);disagree.observers[1].exp.strength++;
 s=update(s,{total:62,now:130000,player:player(10000),background:disagree});assert.equal(s.samples.length,0);assert.equal(s.eligible,false);
 s=update(s,{total:62,now:140000,workIdle:false});assert.equal(s.anchor,null);
});
test('an unknown interval breaks measurement continuity even when observers return',()=>{
 let s=update(null,{background:sleeveBackground(1000)});
 s=update(s,{total:60.5,now:115000,background:null,player:player(600)});
 s=update(s,{total:61,now:130000,background:sleeveBackground(2000),player:player(1130)});
 assert.equal(s.samples.length,0);assert.equal(s.anchor.at,130000);
 s=update(s,{total:62,now:160000,background:sleeveBackground(3000),player:player(2160)});
 assert.equal(s.samples.length,1);assert.equal(s.samples[0].rates.strength,1);
});
test('uncorrected saved samples are invalidated without resetting quota or probe allowance',()=>{
 let s=update(null);s={...s,evidenceVersion:undefined,samples:[{at:100000,rates:Object.fromEntries(keys.map(k=>[k,1e6]))}]};
 s=update(s,{total:62,now:130000,background:null,player:player(10000)});
 assert.equal(s.used,2);assert.equal(s.nativeUsed,2);assert.equal(s.probeUntil,2);assert.equal(s.samples.length,0);assert.equal(s.eligible,false);
 const legacy={...s,evidenceVersion:1,eligible:true,samples:[{at:130000,backgroundCorrected:true,completionAligned:true,rates:candidate.rates}]};assert.equal(bladeburnerTrainingPayoff(legacy,candidate,1,130000),false);
 const untagged={...s,evidenceVersion:3,eligible:true,samples:[{at:130000,rates:candidate.rates}]};assert.equal(bladeburnerTrainingPayoff(untagged,candidate,1,130000),false);
});
test('corrupted sleeve anchors and sample rows restart observation without crashing',()=>{
 let s=update(null);s={...s,samples:[null,{},...s.samples],anchor:{at:100000,exp:player().exp,background:{count:2}}};
 s=update(s,{total:61,now:130000,player:player(130)});assert.equal(s.samples.length,0);assert.equal(s.anchor.at,130000);
});
test('production passes a synchronous player/background observation into native Training policy',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(source,/const nativeTrainingObservation=captureNativeTrainingObservation\(ns,observedAction\?\.name==='Training'\)/);
 assert.match(source,/player=nativeTrainingObservation\.player/);assert.match(source,/background:nativeTrainingObservation\.background,workIdle:nativeTrainingObservation\.workIdle/);
});


test('executed controller observation passes corrected native XP into milestone decisions',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    const nativeTrainingObservation='),end=source.indexOf('    const recovery=',start),block=source.slice(start,end);
 let state=null;
 for(const [now,total,pXp,sXp] of [[100000,60,100,1000],[130000,61,1130,2000],[160000,62,2160,3000]]){
  const c={Date:{now:()=>now},captureNativeTrainingObservation,bladeburnerTrainingMilestone,ns:{pid:7,getPlayer:()=>player(pXp),bladeburner:{getCurrentAction:()=>({type:'General',name:'Training'}),getActionCurrentTime:()=>1/(total-58),getActionTime:()=>30000},singularity:{getCurrentWork:()=>null},sleeve:{getNumSleeves:()=>2,getSleeve:()=>({shock:0,sync:100,exp:Object.fromEntries(keys.map(k=>[k,sXp]))})}},observedAction:{name:'Training'},trainingMilestone:null,player:null,developmentSaved:{trainingMilestone:state},resetInfo:reset,nextBlackOp:'Typhoon',timesTrained:total,options:{'training-limit':50}};
  vm.runInNewContext(block,c);state=c.trainingMilestone;
 }
 assert.equal(state.samples.length,2);assert.equal(state.samples[0].rates.strength,1);assert.equal(state.backgroundStatus,'verified');assert.equal(state.eligible,true);
});


test('a window ending before completion waits for the native clock wrap instead of recording zero',()=>{
 let s=update(null,{clock:{progress:100,duration:30000}});
 s=update(s,{total:61,now:130000,player:player(),clock:{progress:29900,duration:30000}});
 assert.equal(s.samples.length,0);assert.equal(s.anchor.at,100000);assert.equal(s.completionStatus,'waiting-for-wrap');
 s=update(s,{total:61.01,now:130200,player:player(130),clock:{progress:100,duration:30000}});
 assert.equal(s.samples.length,1);assert.equal(s.samples[0].completionAligned,true);assert.ok(s.samples[0].rates.strength>.99);assert.equal(s.completionStatus,'wrapped');
 s=update(s,{total:62,now:160000,player:player(130),clock:{progress:29900,duration:30000}});
 assert.equal(s.samples.length,1);
 s=update(s,{total:62.01,now:160200,player:player(160),clock:{progress:100,duration:30000}});
 assert.equal(s.samples.length,2);assert.equal(s.eligible,true);
});
test('bonus-time wraps aggregate into a bounded observation window',()=>{
 let s=update(null,{clock:{progress:0,duration:30000}});
 for(const [offset,progress,xp] of [[5000,25000,100],[6000,0,130],[11000,25000,130],[12000,0,160],[17000,25000,160],[18000,0,190]])s=update(s,{now:100000+offset,total:60+offset/30000,player:player(xp),clock:{progress,duration:30000}});
 assert.equal(s.samples.length,1);assert.equal(s.samples[0].rates.strength,5);assert.equal(s.anchor.at,118000);
 assert.equal(bladeburnerTrainingPayoff({...s,nativeUsed:2},candidate,2,118000),false);
});
test('missing, invalid, unchanged and discontinuous clocks cannot invent completion evidence',()=>{
 for(const clock of [null,{progress:NaN,duration:30000},{progress:-1,duration:30000},{progress:30001,duration:30000},{progress:0,duration:0}]){
  let s=update(null);s=update(s,{now:130000,total:62,player:player(1000),clock});assert.equal(s.samples.length,0);assert.equal(s.anchor,null);assert.equal(s.eligible,false);
 }
 let s=update(null,{clock:{progress:1000,duration:30000}});
 s=update(s,{now:130000,total:62,player:player(1000),clock:{progress:1000,duration:30000}});assert.equal(s.samples.length,0);
 s=update(s,{now:200001,total:63,player:player(2000),clock:{progress:0,duration:30000}});assert.equal(s.samples.length,0);
});
test('clock model changes and pre-alignment evidence restart measurement without clearing quota',()=>{
 let s=update(null);s=update(s,{now:130000,total:61,player:player(130)});assert.equal(s.samples.length,1);
 const changed=update(s,{now:160000,total:62,player:player(160),clock:{progress:0,duration:60000}});assert.equal(changed.samples.length,0);assert.equal(changed.anchor.at,160000);assert.equal(changed.used,2);
 const old=update({...s,evidenceVersion:2},{now:160000,total:62,player:player(160)});assert.equal(old.samples.length,0);assert.equal(old.used,2);assert.equal(old.probeUntil,2);
 const unaligned={...s,nativeUsed:2,samples:s.samples.map(s=>({...s,completionAligned:false}))};assert.equal(bladeburnerTrainingPayoff(unaligned,candidate,1,130000),false);
});


test('executed action monitor only queries native success counters for levelable actions',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),match=source.match(/const progress=await getNsDataThroughFile\(ns,'([^']*)','\/Temp\/bladeburner-action-progress.txt'/);assert.ok(match);
 for(const type of ['General','BlackOps','Black Operations','Contract','Contracts','Operation','Operations']){
  let calls=0;const ns={bladeburner:{getCurrentAction:()=>({type,name:'example'}),getActionSuccesses:()=>{calls++;return 123;},getActionCurrentTime:()=>500}};
  const result=vm.runInNewContext(match[1],{ns});assert.equal(result.progress,500);assert.equal(calls,/^(Contracts?|Operations?)$/.test(type)?1:0);assert.equal(result.successes,calls?123:null);
 }
});
