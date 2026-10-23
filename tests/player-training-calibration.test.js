import {combatXpValue} from '../combat-growth-policy.js';
import {choosePlayerCombatTraining} from '../player-combat-training-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNativeTrainingObservation,captureTrainingBackground,trainingBackgroundDelta,playerTrainingScope,recordPlayerTrainingCalibration,calibratePlayerTrainingQuotes} from '../player-training-calibration-policy.js';
const keys=['strength','defense','dexterity','agility'],xp=n=>Object.fromEntries(keys.map(k=>[k,n]));
const q={kind:'gym',name:'strength',city:'Sector-12',gym:'Powerhouse Gym',durationMs:30000,rates:{...xp(0),strength:100},score:1};
const scope='scope';
const session=(i,patch={})=>({scope,at:100000+i*30000,id:''+i,choice:q,before:xp(10000),after:{...xp(10300),strength:12400},background:xp(300),nativeUpper:xp(0),elapsedMs:30000,reason:'completed',stable:true,...patch});
const history=patch=>[0,1,2].reduce((s,i)=>recordPlayerTrainingCalibration(s,session(i,patch)),null);
const context={player:{skills:xp(100),exp:xp(1000),mults:{}},metadata:{weights:{strength:1},decays:{strength:1}},inferLevels:true};
test('background distinguishes no sleeves, unknown access and synchronized observers',()=>{
 assert.equal(captureTrainingBackground({}),null);
 assert.deepEqual(captureTrainingBackground({sleeve:{getNumSleeves:()=>0}}),{count:0,observers:[]});
 for(const n of [-1,NaN,9])assert.equal(captureTrainingBackground({sleeve:{getNumSleeves:()=>n}}),null);
 const ns={sleeve:{getNumSleeves:()=>2,getSleeve:()=>({shock:0,sync:100,exp:xp(100)})}};
 const before=captureTrainingBackground(ns);ns.sleeve.getSleeve=()=>({shock:0,sync:100,exp:xp(120)});const after=captureTrainingBackground(ns);
 assert.deepEqual(trainingBackgroundDelta(before,after),xp(20));
 ns.sleeve.getSleeve=()=>({shock:1,sync:100,exp:xp(120)});assert.equal(captureTrainingBackground(ns),null);
 assert.equal(trainingBackgroundDelta(before,captureTrainingBackground(ns)),null);
 after.observers[1].exp.strength=121;assert.equal(trainingBackgroundDelta(before,after),null);
 assert.deepEqual(trainingBackgroundDelta({count:0,observers:[]},{count:0,observers:[]}),xp(0));
 assert.equal(trainingBackgroundDelta({count:0,observers:[]},before),null);
});
test('three complete bursts subtract sleeve XP and parallel Training before discounting',()=>{
 const saved=history({nativeUpper:{...xp(0),strength:300}});
 assert.equal(saved.samples.length,3);assert.equal(saved.samples[0].net.strength,1800);
 const calibrated=calibratePlayerTrainingQuotes([q],saved,scope,170000,context)[0];
 assert.equal(calibrated.calibration.factor,.6);assert.equal(calibrated.rates.strength,60);assert.equal(calibrated.modelRates.strength,100);
 assert.equal(calibrated.calibration.samples,3);assert.ok(calibrated.score>0);
});
test('calibration requires repeated current evidence and never inflates estimates',()=>{
 assert.equal(calibratePlayerTrainingQuotes([q],{samples:history().samples.slice(0,2)},scope,170000,context)[0],q);
 for(const s of [null,{samples:[]},{samples:history().samples.map(s=>({...s,scope:'foreign'}))},{samples:history().samples.map(s=>({...s,at:800000}))},{samples:history().samples.map(s=>({...s,at:0}))},{samples:history().samples.map(s=>({...s,id:'duplicate'}))}]){
  assert.equal(calibratePlayerTrainingQuotes([q],s,scope,700001,context)[0],q);
 }
 const excessive=history({after:xp(1e8)});assert.equal(calibratePlayerTrainingQuotes([q],excessive,scope,170000,context)[0].calibration.factor,1);
 assert.equal(calibratePlayerTrainingQuotes([{...q,city:'Aevum'}],history(),scope,170000,context)[0].calibration,undefined);
 assert.equal(calibratePlayerTrainingQuotes([{...q,rates:{...xp(0),strength:101}}],history(),scope,170000,context)[0].calibration,undefined);
});
test('cancelled, corrupt, interrupted and unobservable sessions cannot train the model',()=>{
 for(const patch of [{reason:'guard-changed'},{stable:false},{elapsedMs:14000},{elapsedMs:29900},{elapsedMs:32000},{background:null},{background:xp(-1)},{nativeUpper:null},{after:xp(1)},{before:xp(NaN)},{choice:{...q,rates:xp(Infinity)}}]){
  assert.equal(recordPlayerTrainingCalibration(null,session(0,patch)).samples.length,0,JSON.stringify(patch));
 }
 const s=recordPlayerTrainingCalibration(null,session(0));assert.equal(recordPlayerTrainingCalibration(s,session(0)).samples.length,1);
 const changed=recordPlayerTrainingCalibration(s,session(1,{scope:'new'}));assert.equal(changed.samples.length,1);assert.equal(changed.samples[0].scope,'new');
});
test('scope changes with reset, controller, target, city or augmentation profile',()=>{
 const p={city:'Sector-12',mults:{strength_exp:2}},input={nodeReset:1,augReset:2,parent:7,target:'Typhoon'},base=playerTrainingScope(p,input);
 for(const patch of [{nodeReset:2},{augReset:3},{parent:8},{target:'Daedalus'}])assert.notEqual(playerTrainingScope(p,{...input,...patch}),base);
 assert.notEqual(playerTrainingScope({...p,city:'Aevum'},input),base);assert.notEqual(playerTrainingScope({...p,mults:{strength_exp:3}},input),base);
});
test('bounded history and severe underperformance can veto an external option',()=>{
 let saved=null;for(let i=0;i<70;i++)saved=recordPlayerTrainingCalibration(saved,session(i,{after:xp(10000),background:xp(0)}));
 assert.ok(saved.samples.length<=48);assert.ok(saved.samples.length<=21);
 const c=calibratePlayerTrainingQuotes([q],saved,scope,2170000,context)[0];assert.equal(c.calibration.factor,0);assert.equal(c.score,0);
});


test('malformed rows are ignored, short evidence stays advisory and scores cannot rise',()=>{
 const malformed={samples:[null,{},...history().samples]};
 assert.equal(calibratePlayerTrainingQuotes([q],malformed,scope,170000,context)[0].calibration.samples,3);
 const short=[0,1,2].reduce((saved,i)=>recordPlayerTrainingCalibration(saved,session(i,{elapsedMs:15000,choice:{...q,durationMs:15000}})),null);
 assert.equal(calibratePlayerTrainingQuotes([q],short,scope,170000,context)[0],q);
 const adjusted=calibratePlayerTrainingQuotes([q],history(),scope,170000,context)[0];assert.ok(adjusted.score<=q.score);
});


test('calibrated rates change the production comparison against native Training',()=>{
 const quote={...q,time:30000,costPerSecond:5,score:combatXpValue(q.rates,context)};
 const options={baselineScore:quote.score*.7,remainingMs:30000,quotaLeft:10,money:1e9,reserve:0};
 assert.ok(choosePlayerCombatTraining([quote],options));
 const adjusted=calibratePlayerTrainingQuotes([quote],history(),scope,170000,context);
 assert.equal(choosePlayerCombatTraining(adjusted,options),null);
 assert.ok(Math.abs(adjusted[0].score/quote.score-.7)<1e-10);
});


test('native observation rejects simultaneous player work and unavailable Source Files',()=>{
 const player={exp:xp(100)},ns={getPlayer:()=>player,bladeburner:{getCurrentAction:()=>({type:'General',name:'Training'}),getActionCurrentTime:()=>1000,getActionTime:()=>30000},singularity:{getCurrentWork:()=>null},sleeve:{getNumSleeves:()=>0}};
 let observed=captureNativeTrainingObservation(ns,true);assert.equal(observed.player,player);assert.equal(observed.workIdle,true);assert.deepEqual(observed.background,{count:0,observers:[]});
 for(const work of [{type:'CLASS'},{type:'CRIME'},{type:'FACTION'},{type:'GRAFTING'}]){ns.singularity.getCurrentWork=()=>work;observed=captureNativeTrainingObservation(ns,true);assert.equal(observed.workIdle,false);assert.equal(observed.background,null);}
 ns.singularity.getCurrentWork=()=>{throw Error('Source File unavailable');};assert.equal(captureNativeTrainingObservation(ns,true).background,null);
 ns.singularity.getCurrentWork=()=>null;ns.bladeburner.getCurrentAction=()=>({type:'Contracts',name:'Retirement'});assert.equal(captureNativeTrainingObservation(ns,true).background,null);
 ns.bladeburner.getCurrentAction=()=>{throw Error('non-Training must not query');};assert.equal(captureNativeTrainingObservation(ns,false).player,player);
});
test('malformed and duplicate sleeve observer records are rejected',()=>{
 for(const value of [{count:2},{count:0,observers:[{}]},{count:2,observers:[{i:0,exp:xp(1)},{i:0,exp:xp(1)}]},{count:2,observers:[{i:-1,exp:xp(1)},{i:1,exp:xp(1)}]}])assert.equal(trainingBackgroundDelta(value,value),null);
});


test('native observation captures only valid Training phase and duration',()=>{
 const ns={getPlayer:()=>({exp:xp(100)}),bladeburner:{getCurrentAction:()=>({type:'General',name:'Training'}),getActionCurrentTime:()=>29000,getActionTime:()=>30000},singularity:{getCurrentWork:()=>null},sleeve:{getNumSleeves:()=>0}};
 assert.deepEqual(captureNativeTrainingObservation(ns,true).clock,{progress:29000,duration:30000});
 ns.bladeburner.getActionCurrentTime=()=>31000;assert.equal(captureNativeTrainingObservation(ns,true).clock,null);
 ns.bladeburner.getActionCurrentTime=()=>{throw Error('unavailable');};assert.equal(captureNativeTrainingObservation(ns,true).clock,null);
});
