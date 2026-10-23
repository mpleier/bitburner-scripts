import {supportReplacementStartAllowed} from '../bladeburner-support-economics-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {blackOpHospitalCost,observeBlackOpCash,blackOpBonusComparison,blackOpExpectedTime,observeBlackOpImprovement,decideBlackOpRisk,blackOpRiskStartAllowed} from '../black-op-risk-policy.js';
import {blackOpRiskQuoteSource,blackOpFailureHp} from '../black-op-risk-source.js';
import {bladeburnerStaminaChance,startBladeburnerPlannedAction,bladeburnerWorkAllowed,optionsError} from '../bladeburner-policy.js';
import {blackOpMetadata} from '../bladeburner-action-data.js';
import {apiReferences,estimateRam} from '../scripts/audit-core.js';
const now=100000,reset={lastNodeReset:1,lastAugReset:2},target='Operation Zero';
function fixture(){
 const q={at:now,ownerPid:7,target,nodeReset:1,augReset:2,city:'A',p:.95,rank:1500,loss:100,time:240000,money:1e9,hp:{current:100,max:100},stamina:[1000,1000],rawChance:[.95,.95],team:0,totalTeam:0,supporting:0,bonusMs:0,recruit:{time:30000,chance:1},hrcTime:1000};
 const c={cashIncome:{at:now,rate:1e9,nodeReset:1,augReset:2},enabled:true,threshold:.99,floor:.9,target,ownerPid:7,reset,requiredRank:1000,hpLoss:100,difficulty:1,observedRankRate:1,rankRecovery:[{rate:1,supply:1000,net:2}],waits:[{ms:600000,chance:.99}]};
 return {q,c,decide:()=>decideBlackOpRisk(q,c,now)};
}
test('constant-odds expected completion cost matches retries plus recovery',()=>{
 assert.equal(blackOpExpectedTime(240000,1,120000),240000);assert.ok(Math.abs(blackOpExpectedTime(240000,.95,120000)-258947.36842105264)<.001);
 for(const [t,p,r]of [[0,.95,1],[1,0,1],[1,2,1],[1,.95,-1],[NaN,.95,1]])assert.equal(blackOpExpectedTime(t,p,r),null);
});
test('a slower improvement path can justify a sub-99 percent Black Op',()=>{
 const f=fixture(),d=f.decide();assert.equal(d.adaptive,true);assert.equal(d.threshold,.95);assert.ok(d.savingMs>=30000&&d.savingMs>=d.waitMs*.2);assert.equal(d.expiresAt,now+5000);assert.equal(d.fallback,.99);
});
test('cheap recruitment or fast growth wins over taking additional risk',()=>{
 const f=fixture();f.c.waits.push({ms:1000,chance:.99});assert.equal(f.decide().adaptive,false);f.c.waits=[{ms:60000,chance:.99}];assert.equal(f.decide().adaptive,false);
});
test('missing evidence, disabled policy, below-floor odds and invalid bonus quotes retain standard threshold',()=>{
 for(const mutate of [f=>f.c.enabled=false,f=>f.c.waits=[],f=>f.q.p=.89,f=>f.q.bonusMs=NaN,f=>f.q.at=now-5000,f=>f.q.ownerPid=8,f=>f.q.augReset=3,f=>f.q.hp.current=89,f=>f.q.stamina[0]=980,f=>f.c.hpLoss=undefined]){const f=fixture();mutate(f);const d=f.decide();assert.equal(d.adaptive,false);assert.equal(d.threshold,.99);}
});
test('rank buffers avoid unnecessary recovery but lost rank requires observed rates and reserved stock',()=>{
 const f=fixture();f.c.observedRankRate=null;f.c.rankRecovery=[];assert.equal(f.decide().adaptive,true);f.q.rank=1000;assert.equal(f.decide().adaptive,false);f.c.observedRankRate=1;f.c.rankRecovery=[{rate:1,supply:1000,net:2}];assert.equal(f.decide().adaptive,true);f.c.rankRecovery[0].supply=10;assert.equal(f.decide().adaptive,false);
});
test('large late-operation rank losses or slow BitNode rank recovery favor waiting',()=>{
 const f=fixture();f.q.rank=1000;f.q.loss=20000;f.c.rankRecovery=[{rate:1,supply:100000,net:2}];assert.equal(f.decide().adaptive,false);f.q.loss=100;f.c.observedRankRate=.001;assert.equal(f.decide().adaptive,false);
});
test('expensive team replacement, unknown support and sleeve exposure prevent reckless attempts',()=>{
 const f=fixture();f.q.team=30;f.q.totalTeam=30;f.q.recruit={time:60000,chance:.2};assert.equal(f.decide().adaptive,false);f.q.team=1;f.q.totalTeam=2;f.q.supporting=2;assert.equal(f.decide().adaptive,false);f.q.supporting=null;assert.equal(f.decide().adaptive,false);
});
test('expected hospital cash losses are bounded independently of time savings',()=>{
 const f=fixture();f.q.money=1000000;f.q.p=.9;assert.equal(f.decide().adaptive,false);f.q.p=.95;const d=f.decide();assert.equal(d.adaptive,true);assert.ok(d.expectedCashLoss<=f.q.money*.01);
});
test('HP and stamina recovery share HRC cycles without double counting',()=>{
 const f=fixture();f.c.hpLoss=1;f.q.hp={current:100,max:100};f.c.difficulty=1;const d=f.decide();assert.equal(d.recoveryMs,1000); // ceil(1.1 * 1.0015)=2 damage -> one HRC cycle, also enough for stamina.
});
test('observed improvement needs enough fresh samples and uses twice the fastest observed growth',()=>{
 const f=fixture();let history=null;
 for(const [at,p] of [[0,.94],[15000,.945],[30000,.95]])history=observeBlackOpImprovement(history,{...f.q,at,p},.99);
 assert.ok(Math.abs(history.waitMs-60000)<1e-5);assert.equal(history.samples.length,3);
 const first=observeBlackOpImprovement(null,f.q,.99);assert.equal(first.waitMs,null);
});
test('failures, target changes, team changes and long gaps reset growth evidence',()=>{
 const f=fixture();let h=null;for(const [at,p]of [[0,.94],[15000,.945],[30000,.95]])h=observeBlackOpImprovement(h,{...f.q,at,p},.99);
 for(const patch of [{at:32000,p:.9},{at:32000,rank:1400},{at:32000,target:'Operation X'},{at:32000,team:1},{at:70000}]){const next=observeBlackOpImprovement(h,{...f.q,...patch},.99);assert.equal(next.waitMs,null);assert.equal(next.samples.length,1);}
});
test('adaptive tickets reject stale or changed native state and permit improved odds',()=>{
 const f=fixture(),ticket=f.decide(),live={...f.q};assert.equal(blackOpRiskStartAllowed(ticket,live,now),true);assert.equal(blackOpRiskStartAllowed(ticket,{...live,p:.96},now),true);
 for(const patch of [{p:.94},{time:250000},{loss:101},{hrcTime:2000},{rank:1499},{money:1},{hp:{current:99,max:100}},{hp:{current:100,max:101}},{team:1},{totalTeam:1},{supporting:1},{stamina:[999,1000]},{bonusMs:NaN},{augReset:3},{target:'Operation X'},{ownerPid:8},{city:'B'}])assert.equal(blackOpRiskStartAllowed(ticket,{...live,...patch},now),false);
 assert.equal(blackOpRiskStartAllowed(ticket,live,now+5000),false);assert.equal(blackOpRiskStartAllowed({...ticket,rank:NaN},live,now),false);assert.equal(blackOpRiskStartAllowed(ticket,live,NaN),false);
});
function nativeStart(f,patch={},clock=now){
 const ticket=f.decide(),source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),literal=source.match(/const startResult = await getNsDataThroughFile\(ns, (`[^`]+`)/)[1];
 const expression=Function('blackOpHospitalCost','blackOpBonusComparison','bladeburnerStaminaChance','blackOpRiskStartAllowed','startBladeburnerPlannedAction','bbMutationGuard','bladeburnerWorkAllowed','supportReplacementStartAllowed','return '+literal)(blackOpHospitalCost,blackOpBonusComparison,bladeburnerStaminaChance,blackOpRiskStartAllowed,startBladeburnerPlannedAction,'true',bladeburnerWorkAllowed,supportReplacementStartAllowed);
 const q={...f.q,...patch};let starts=0;
 const b={getCurrentAction:()=>null,getCity:()=>q.city,getRank:()=>q.rank,getTeamSize:type=>type?q.team:q.totalTeam,getActionTime:(type,name)=>type==='Black Operations'?q.time:name==='Recruitment'?q.recruit.time:q.hrcTime,getActionRankLoss:()=>q.loss,getStamina:()=>q.stamina,getBonusTime:()=>q.bonusMs,getActionEstimatedSuccessChance:()=>[q.p,q.p],startAction:()=>{starts++;return true;}};
 const ns={args:['Black Operations',target,1000,ticket.threshold,0,7,'null',false,JSON.stringify({[target]:{base:1,factor:1}}),-1,0,JSON.stringify(ticket)],bladeburner:b,getPlayer:()=>({hp:q.hp,money:q.money}),getResetInfo:()=>({lastNodeReset:q.nodeReset,lastAugReset:q.augReset}),sleeve:{getNumSleeves:()=>q.supporting,getTask:()=>({type:'SUPPORT'})},isRunning:()=>true,singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>[]}};
 const result=vm.runInNewContext(expression,{ns,Date:{now:()=>clock}});return {result,starts};
}
test('executed production start permits a valid adaptive Black Op and rejects expired or changed economics',()=>{
 const f=fixture();assert.equal(nativeStart(f).starts,1);
 for(const patch of [{p:.94},{time:250000},{loss:101},{team:1},{money:0},{rank:900},{stamina:[900,1000]},{bonusMs:NaN}]){const result=nativeStart(f,patch);assert.equal(result.starts,0);assert.equal(result.result.reason,'black-op-risk-changed');}
 assert.equal(nativeStart(f,{},now+5000).starts,0);
});
test('official HP metadata covers all Black Ops and risk quote stays within a 32 GB worker',()=>{
 assert.deepEqual(Object.keys(blackOpFailureHp).sort(),Object.keys(blackOpMetadata).sort());assert.equal(blackOpFailureHp['Operation Vindictus'],20000);
 const defs=JSON.parse(readFileSync(new URL('../scripts/api-surface.json',import.meta.url),'utf8')),ram=estimateRam(apiReferences('risk.js',blackOpRiskQuoteSource).references,defs);assert.deepEqual(ram.unknown,[]);assert.equal(ram.ram,31.1);
});
test('production preserves regular thresholds, post-stamina native guards and protected Black Ops',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(s,/const actionThreshold=bestActionName===nextBlackOp&&blackOpRisk.adaptive\?blackOpRisk.threshold:options\['success-threshold'\]/);assert.match(s,/ns.args\[0\]==="Black Operations"&&ns.args\[11\]!=="null"/);assert.ok(s.indexOf('if(isBlackOp(observedAction))')<s.indexOf('blackOpRiskQuoteSource,\'/Temp/'));assert.match(s,/observedAction\?\.name!=='Recruitment'/);
});
test('adaptive floor option rejects unsupported or malformed probabilities',()=>{
 for(const value of [.89,1.01,NaN,'0.95'])assert.match(optionsError({'black-op-min-success':value}),/black-op-min-success/);
});

async function controllerRisk(unavailable=false,chance=.95){
 const f=fixture(),source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    // Risk applies only'),end=source.indexOf('    // Detect our current action',start),writes=[];
 let reads=0;let history=null;for(const [at,p]of [[70000,.949],[85000,.9495]])history=observeBlackOpImprovement(history,{...f.q,at,p},.99);
 const c={observeBlackOpCash,blackOpCashHistory:null,blackOpRiskQuoteSource,observeBlackOpImprovement,decideBlackOpRisk:(q,c)=>decideBlackOpRisk(q,c,now),bladeburnerStaminaChance,blackOpRiskHistory:history,nextBlackOp:target,rank:1500,blackOpsRanks:{[target]:1000},blackOpsChance:[chance,chance],options:{'success-threshold':.99,'black-op-min-success':.9,'chaos-recovery-threshold':50},teamSleeves:{supporting:0},teamPlan:{state:'no-useful-team'},resetInfo:reset,blackOpMetadata:{[target]:{baseDifficulty:1}},blackOpFailureHp:{[target]:1},measuredRankRate:1,unreservedActions:[],currentCity:'A',chaosByCity:{A:2},lowHealthTriggered:false,lowStaminaTriggered:false,observedAction:{name:'Training'},bestActionName:'Training',surplusSelected:true,reason:'training',formatDuration:String,Date:{now:()=>now},getNsDataThroughFile:async()=>{reads++;if(unavailable)throw Error('Source File unavailable');return structuredClone(f.q);}};
 const ns={pid:7,write:async(file,text)=>writes.push(JSON.parse(text))};vm.runInNewContext('globalThis.run=async function(ns){'+source.slice(start,end)+'}',c);await c.run(ns);return {c,writes,reads};
}
test('executed controller selects the adaptive Black Op when its observed improvement comparison wins',async()=>{
 const {c,writes}=await controllerRisk();assert.equal(c.bestActionName,target);assert.equal(c.surplusSelected,false);assert.equal(writes.at(-1).adaptive,true);assert.equal(writes.at(-1).threshold,.95);
});
test('executed controller keeps ordinary work and standard threshold when native quote access fails',async()=>{
 const {c,writes}=await controllerRisk(true);assert.equal(c.bestActionName,'Training');assert.equal(writes.at(-1).adaptive,false);assert.equal(writes.at(-1).threshold,.99);assert.match(writes.at(-1).reason,/Source File unavailable/);
});

test('adaptive decision and fallback reasons are exposed through bounded remote diagnostics',()=>{
 const source=readFileSync(new URL('../remote-api-command.js',import.meta.url),'utf8');assert.ok(source.includes('bladeburnerRisk:read("tasks/bladeburner-risk.json")'));
});

test('below-floor chances retain ordinary work without launching an ineligible risk-quote worker',async()=>{
 const {c,writes,reads}=await controllerRisk(false,.89);assert.equal(reads,0);assert.equal(c.bestActionName,'Training');assert.equal(writes.at(-1).adaptive,false);assert.match(writes.at(-1).reason,/probability floor/);
});
