import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blackOpRiskStartAllowed,blackOpBonusComparison,blackOpHospitalCost} from '../black-op-risk-policy.js';
import {startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed} from '../bladeburner-policy.js';
import {quoteSupportSleeveGrowth,planSupportReplacement,supportReplacementStartAllowed,quoteNextSupportTarget,readSupportInvestment} from '../bladeburner-support-economics-policy.js';
import {bladeburnerRecruitmentDecision} from '../bladeburner-policy.js';
import {parallelTrainingFragment,recordParallelTrainingCalibration,captureParallelTrainingObservation} from '../parallel-training-measurement-policy.js';
const stats=['strength','defense','dexterity','agility'],map=v=>Object.fromEntries(stats.map(k=>[k,v]));
function economy(){return {plan:{state:'ready',available:3,required:3,supportingSleeves:2,teamCap:30},quote:{at:1000,poolScore:1,members:[{index:0,score:10},{index:1,score:10}],releaseOrder:[1,0]},ownScore:1,competence:100,chance:.5,threshold:.99,rankGap:0,rankEtaMs:0,requiredRank:2500,horizonSeconds:300,budgetMs:120000,estimate:{chance:[1,1],duration:10000,progress:0,bonusMs:0},decision:bladeburnerRecruitmentDecision,now:1000};}
test('one replacement human is worthwhile only with completed stat-readiness payback',()=>{
 const q=planSupportReplacement(economy());assert.equal(q.recruit,true);assert.equal(q.totalTarget,4);assert.equal(q.requiredHumans,3);assert.equal(q.sleeve,1);assert.ok(q.secondsSaved>2);assert.ok(q.projectedSeconds<q.baselineSeconds);assert.equal(q.expectedMs,10000);
});
test('replacement honors actual release order rather than claiming the best sleeve will be freed',()=>{
 const f=economy();f.quote.members[0].score=1000;f.quote.members[1].score=.001;assert.equal(planSupportReplacement(f).recruit,false);
});
test('unknown quotes, healthy support gaps, imminent readiness and budgets cannot recruit',()=>{
 const f=economy();for(const patch of [{quote:null},{now:10000},{horizonSeconds:5},{budgetMs:1},{chance:.99},{rankGap:10,rankEtaMs:null},{rankGap:100,rankEtaMs:100000},{quote:{...f.quote,members:[]}}, {plan:{...f.plan,available:4}}, {plan:{...f.plan,state:'needs-recruitment'}},{ownScore:100}])assert.equal(planSupportReplacement({...f,...patch}).recruit,false,JSON.stringify(patch));
});
test('known rank delay can be repaid when stats remain the completion bottleneck',()=>{
 const f=economy(),q=planSupportReplacement({...f,rankGap:10,rankEtaMs:10000});assert.equal(q.recruit,true);assert.ok(q.projectedSeconds>10);
});
test('long crime startup cannot create XP before a verified first payout',()=>{
 const f=economy();f.quote.members[1].delaySeconds=120;assert.equal(planSupportReplacement(f).recruit,false);
});
test('native replacement guard rejects changes and never postpones a ready Black Op',()=>{
 const q={...planSupportReplacement(economy()),at:Date.now(),ownerPid:7,nodeReset:1,augReset:2,target:'Typhoon'};
 let total=3,rank=0,chance=.5;const ns={isRunning:p=>p===7,read:()=>JSON.stringify({selected:'bladeburner',nodeReset:1,augReset:2,at:Date.now(),ownerPid:7}),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),sleeve:{getNumSleeves:()=>2,getTask:()=>({type:'SUPPORT'})},bladeburner:{getTeamSize:()=>total,getRank:()=>rank,getActionCountRemaining:()=>1,getActionEstimatedSuccessChance:()=>[chance,chance]}};
 assert.equal(supportReplacementStartAllowed(ns,q),true);total=4;assert.equal(supportReplacementStartAllowed(ns,q),false);total=3;rank=2500;chance=1;assert.equal(supportReplacementStartAllowed(ns,q),false);rank=0;assert.equal(supportReplacementStartAllowed(ns,q),false);chance=.5;
 for(const patch of [{at:0},{augReset:3},{ownerPid:8},{totalTarget:100},{requiredHumans:NaN},{threshold:NaN}])assert.equal(supportReplacementStartAllowed(ns,{...q,...patch}),false);
 ns.read=()=>JSON.stringify({selected:'hacking'});assert.equal(supportReplacementStartAllowed(ns,q),false);
 ns.read=()=>JSON.stringify({selected:'bladeburner',nodeReset:1,augReset:2,at:Date.now(),ownerPid:7});ns.sleeve.getTask=()=>{throw Error('Source File unavailable');};assert.equal(supportReplacementStartAllowed(ns,q),false);
});
const point=(at,exp=0,extra={})=>({at,scope:'same',progress:at,time:30000,successes:0,bonusMs:0,exp:map(exp),background:{count:0,observers:[]},...extra});
test('fragment strips sleeve XP and certifies no BB completion with a queued-work margin',()=>{
 const before=point(1000,10),after=point(1200,30),q=parallelTrainingFragment(before,after);assert.equal(q.seconds,.2);assert.equal(q.net.strength,20);
 const background=n=>({count:2,observers:[{i:0,exp:map(n)},{i:1,exp:map(n)}]});
 assert.equal(parallelTrainingFragment({...before,background:background(100)},{...after,background:background(115)}).net.strength,5);
});
test('possible completions, failed wraps, accelerated gaps and unknown backgrounds are excluded',()=>{
 const a=point(1000,10),b=point(1200,30);
 for(const patch of [{successes:1},{progress:0},{scope:'other'},{at:4000},{bonusMs:-100000},{background:null},{exp:map(0)}])assert.equal(parallelTrainingFragment(a,{...b,...patch}),null);
 assert.equal(parallelTrainingFragment({...a,progress:29000},{...b,progress:29200}),null);
 assert.equal(parallelTrainingFragment({...a,time:1000},{...b,time:1000}),null);
});
test('certified fragments calibrate partial mission-boundary sessions downwards only',()=>{
 const fragments=Array.from({length:80},(_,i)=>({start:i*200,end:(i+1)*200,seconds:.2,scope:'same',net:map(2)}));
 const q={fragments,scope:'profile',at:20000,id:'one',choice:{kind:'gym',name:'strength',city:'A',rates:map(20),durationMs:30000},elapsedMs:18000,reason:'mission-boundary',stable:true};
 const r=recordParallelTrainingCalibration(null,q);assert.equal(r.measurement.accepted,true);assert.equal(r.samples[0].seconds,16);assert.equal(r.samples[0].net.strength,160);assert.equal(r.samples[0].evidence,'completion-free-fragments');assert.equal(r.measurement.excludedMs,2000);
 const huge=recordParallelTrainingCalibration(null,{...q,fragments:fragments.map(f=>({...f,net:map(1000)}))});assert.equal(huge.samples[0].net.strength,320);
 assert.equal(recordParallelTrainingCalibration(r,q).samples.length,1);
});
test('overlapping fragments, short exposures and interrupted work cannot calibrate',()=>{
 const f={start:0,end:1000,seconds:1,scope:'same',net:map(1)},q={scope:'profile',at:20000,id:'one',choice:{kind:'gym',rates:map(20),durationMs:30000},elapsedMs:20000,reason:'completed',stable:true};
 assert.equal(recordParallelTrainingCalibration(null,{...q,fragments:[f,f]}).measurement.accepted,false);
 assert.equal(recordParallelTrainingCalibration(null,{...q,fragments:[f]}).measurement.accepted,false);
 const fragments=Array.from({length:16},(_,i)=>({...f,start:i*1000,end:(i+1)*1000}));for(const patch of [{reason:'guard-changed'},{stable:false},{elapsedMs:1000}])assert.equal(recordParallelTrainingCalibration(null,{...q,fragments,...patch}).measurement.accepted,false);
});
test('optional capture fails gracefully without required APIs or mission ownership',()=>{
 assert.equal(captureParallelTrainingObservation({bladeburner:{getCurrentAction:()=>null}},{mission:{name:'Tracking'}}),null);
 assert.equal(quoteSupportSleeveGrowth({fileExists:()=>false},{},{},()=>1),null);
});
test('native support quote prices clone crime chance and validates current incoming XP evidence',()=>{
 const now=Date.now(),o={nodeReset:1,augReset:2,pid:8,observedAt:now,samples:[{},{}],pool:{...map(1),hacking:1,charisma:1}};
 const ns={fileExists:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),getPlayer:()=>({}),read:()=>JSON.stringify(o),ps:()=>[{pid:8,filename:'sleeve.js'}],enums:{CrimeType:{Mug:'Mug'}},singularity:{getCrimeStats:()=>({time:2000})},sleeve:{getNumSleeves:()=>2,getSleeve:()=>({shock:0,sync:100}),getTask:()=>({type:'SUPPORT'})},formulas:{work:{crimeSuccessChance:()=>.5,crimeGains:()=>({strExp:100,defExp:0,dexExp:0,agiExp:0,hackExp:0,chaExp:0})}}};
 const q=quoteSupportSleeveGrowth(ns,{}, {},r=>r.strength);assert.equal(q.members[0].score,31.25);assert.equal(q.members[0].delaySeconds,2);assert.deepEqual(q.releaseOrder,[1,0]);
 o.observedAt=now-100000;assert.equal(quoteSupportSleeveGrowth(ns,{}, {},r=>r.strength),null);
});
test('actual generated recruitment transaction rejects changed replacement quotes',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),literal=source.match(/const startResult = await getNsDataThroughFile\(ns, (`[^`]+`)/)[1];
 const names=['supportReplacementStartAllowed','blackOpRiskStartAllowed','blackOpBonusComparison','blackOpHospitalCost','startBladeburnerPlannedAction','bladeburnerStaminaChance','bladeburnerWorkAllowed','bbMutationGuard'];
 const expression=Function(...names,'return '+literal)(supportReplacementStartAllowed,blackOpRiskStartAllowed,blackOpBonusComparison,blackOpHospitalCost,startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed,'true');
 let total=3,starts=0;const q={...planSupportReplacement(economy()),at:Date.now(),ownerPid:7,nodeReset:1,augReset:2,target:'Typhoon'};
 const ns={args:['General','Recruitment',0,.99,4,7,'null',false,'{}',-1,0,'null',JSON.stringify(q)],isRunning:()=>true,read:()=>JSON.stringify({selected:'bladeburner',nodeReset:1,augReset:2,at:Date.now(),ownerPid:7}),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),sleeve:{getNumSleeves:()=>2,getTask:()=>({type:'SUPPORT'})},singularity:{getCurrentWork:()=>null},bladeburner:{getTeamSize:()=>total,getRank:()=>0,getActionCountRemaining:()=>1,getActionEstimatedSuccessChance:()=>[.5,.5],startAction:()=>{starts++;return true;}}};
 assert.equal(Function('ns','return '+expression)(ns).success,true);assert.equal(starts,1);total=4;assert.equal(Function('ns','return '+expression)(ns).reason,'support-replacement-changed');assert.equal(starts,1);
});
test('following Black Op probes use the existing squad and restore assignments on error or cancellation',()=>{
 let assigned=1,rank=0,allowed=true,fail=false;const b={getCurrentAction:()=>({type:'Contracts'}),getTeamSize:type=>type?assigned:3,setTeamSize:(_t,_n,v)=>(assigned=v),getRank:()=>rank,getActionCountRemaining:()=>1,getStamina:()=>[100,100],getSkillLevel:()=>0,getActionEstimatedSuccessChance:(_t,name)=>{if(fail)throw Error('probe failed');return name==='Current'?[1,1]:[.8,.8];}};
 const ns={bladeburner:b};let q=quoteNextSupportTarget(ns,'Current','Next',3,30,2500,.99,c=>c,()=>allowed);assert.equal(q.target,'Next');assert.equal(assigned,1);
 fail=true;assert.equal(quoteNextSupportTarget(ns,'Current','Next',3,30,2500,.99,c=>c,()=>true),null);assert.equal(assigned,1);fail=false;
 assert.equal(quoteNextSupportTarget(ns,'Current','Next',3,30,2500,.99,c=>{allowed=false;return c;},()=>allowed),null);assert.equal(assigned,1);
 allowed=true;rank=2500;assert.equal(quoteNextSupportTarget(ns,'Current','Next',3,30,2500,.99,c=>c,()=>true),null);assert.equal(assigned,1);
});
test('support XP investment retains bounded purpose while keeping the actual current squad plan separate',()=>{
 let q={at:1000,expiresAt:61000,nodeReset:1,augReset:2,ownerPid:7,currentTarget:'Current',target:'Next',workers:[1],chance:[.8,.8],threshold:.99};
 const route={selected:'bladeburner',at:1000,nodeReset:1,augReset:2,ownerPid:9},ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),read:f=>JSON.stringify(f.includes('node-route')?route:q),ps:()=>[{pid:7,filename:'bladeburner.js'}],isRunning:()=>true},plan={target:'Current',rankReady:false,counts:{Tracking:10},chance:[1,1]};
 assert.equal(readSupportInvestment(ns,plan,2000).target,'Next');assert.equal(plan.target,'Current');assert.equal(readSupportInvestment(ns,plan,2000).rankReady,true);
 assert.equal(readSupportInvestment(ns,{...plan,target:'Next',chance:[1,1]},2000),null);assert.equal(readSupportInvestment(ns,{...plan,target:'Later'},2000),null);
 q.expiresAt=1000000;assert.equal(readSupportInvestment(ns,plan,2000),null);q.expiresAt=61000;route.selected='hacking';assert.equal(readSupportInvestment(ns,plan,2000),null);
});
