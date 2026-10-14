import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCrimeOptions,choosePlayerCrime,crimePauseReason,crimeTick,guardedCommitCrime,guardedStopCrime} from '../crime-policy.js';
const stats={Shoplift:{time:2000,money:10,karma:.1},Mug:{time:4000,money:100,karma:.25},Homicide:{time:3000,money:45000,karma:3,kills:1},Heist:{time:60000,money:1e9,karma:15}};
const snapshot=(work=null)=>({stats,chances:{Mug:1,Homicide:.6,Heist:.8},work,processes:[]});
test('crime arguments accept quoted or split names and honor explicit crimes alongside flags',()=>{
 assert.equal(parseCrimeOptions(['Grand','Theft','Auto']).crime,'Grand Theft Auto');
 assert.equal(parseCrimeOptions(['Mug','--fast-crimes-only']).crime,'Mug');
 assert.equal(parseCrimeOptions(['--goal','karma']).goal,'karma');
 assert.throws(()=>parseCrimeOptions(['--unknown']));assert.throws(()=>parseCrimeOptions(['Invalid']));
});
test('automatic balanced crime selection uses live chances and fast mode excludes long crimes',()=>{
 assert.equal(choosePlayerCrime(stats,snapshot().chances,parseCrimeOptions([])),'Heist');
 assert.equal(choosePlayerCrime(stats,snapshot().chances,parseCrimeOptions(['--fast-crimes-only'])),'Homicide');
 assert.equal(choosePlayerCrime(stats,{Mug:1,Homicide:.1,Heist:.1},parseCrimeOptions([])),'Mug');
});
test('player karma includes quarter rewards on failure while kills and money require success',()=>{
 const data={A:{time:1000,karma:4,kills:1,money:100},B:{time:1000,karma:.9,kills:1,money:100}};
 assert.equal(choosePlayerCrime(data,{A:0,B:1},{goal:'karma'}),'A');
 assert.equal(choosePlayerCrime(data,{A:0,B:1},{goal:'kills'}),'B');
 assert.equal(choosePlayerCrime(data,{A:0,B:1},{goal:'money'}),'B');
});
test('protected work, activities, casino and transitions pause crime without changing work',()=>{
 for(const extra of [{work:{type:'GRAFTING'}},{work:{type:'CREATE_PROGRAM'}},{bladeburnerBlocked:true},{activity:{expiresAt:200,alive:true}},{transition:{expiresAt:200,alive:true}},{processes:[{filename:'casino.js'}]}])
  assert.ok(crimePauseReason({...snapshot(),...extra},100));
 assert.equal(crimePauseReason({...snapshot(),activity:{expiresAt:200,alive:false}},100),null);
});
test('repeating explicit crimes never restart or exit because the player is busy',async()=>{
 let commits=0;const options=parseCrimeOptions(['Mug']),state={};
 for(let i=0;i<10;i++)assert.equal((await crimeTick(state,snapshot({type:'CRIME',crimeType:'Mug',cyclesWorked:i*10}),options,async()=>{commits++;return 4000;})).mode,'running');
 assert.equal(commits,0);
});
test('crime upgrades wait for the current crime to complete and then start the new choice',async()=>{
 const state={},options=parseCrimeOptions([]),calls=[];
 const commit=async crime=>{calls.push(crime);return stats[crime].time;};
 assert.equal((await crimeTick(state,snapshot({type:'CRIME',crimeType:'Mug',cyclesWorked:19}),options,commit)).mode,'finishing');
 assert.equal((await crimeTick(state,snapshot({type:'CRIME',crimeType:'Mug',cyclesWorked:20}),options,commit)).started,true);
 assert.deepEqual(calls,['Heist']);
});
test('rejected crime starts wait rather than claiming success',async()=>{
 assert.equal((await crimeTick({},snapshot(),parseCrimeOptions(['Mug']),async()=>0)).mode,'waiting');
});
test('fresh commit guard protects grafts, races and active UI owners',()=>{
 let work=null,commits=0,record='';
 const ns={read:()=>record,isRunning:()=>true,ps:()=>[],singularity:{getCurrentWork:()=>work,commitCrime:()=>{commits++;return 4000;}}};
 assert.equal(guardedCommitCrime(ns,'Mug',false,null,false),4000);
 work={type:'GRAFTING'};assert.equal(guardedCommitCrime(ns,'Mug',false,null,false),0);
 work={type:'CRIME',crimeType:'Homicide'};assert.equal(guardedCommitCrime(ns,'Mug',false,'Mug',false),0);
 work=null;record=JSON.stringify({expiresAt:Date.now()+10000,ownerPid:1});assert.equal(guardedCommitCrime(ns,'Mug',false,null,false),0);
 assert.equal(commits,1);
});
test('crime entry point has a Source File guard and no faction globals or automatic tails',async()=>{
 const source=await readFile(new URL('../crime.js',import.meta.url),'utf8');
 assert.match(source,/4 in sources/);assert.doesNotMatch(source,/work-for-factions|tail\(/);
});

test('pausing ends only a repeating crime started by this controller',async()=>{
 let stopped=0;const state={ownedCrime:'Mug'},current={...snapshot({type:'CRIME',crimeType:'Mug',cyclesWorked:10}),bladeburnerBlocked:true};
 const stop=async()=>{stopped++;};
 await crimeTick(state,current,parseCrimeOptions(['Mug']),async()=>0,Date.now(),stop);
 assert.equal(stopped,1);assert.equal(state.ownedCrime,null);
 await crimeTick({},current,parseCrimeOptions(['Mug']),async()=>0,Date.now(),stop);assert.equal(stopped,1);
});
test('guarded crime cleanup never stops new grafts or externally restarted crimes',()=>{
 let work={type:'GRAFTING'},stopped=0;
 const ns={singularity:{getCurrentWork:()=>work,stopAction:()=>{stopped++;}}};
 assert.equal(guardedStopCrime(ns,'Mug',10),false);
 work={type:'CRIME',crimeType:'Mug',cyclesWorked:5};assert.equal(guardedStopCrime(ns,'Mug',10),false);
 work.cyclesWorked=11;assert.equal(guardedStopCrime(ns,'Mug',10),true);assert.equal(stopped,1);
});


test('new crime commands honor a pause set after their snapshot',()=>{
 let commits=0;const ns={read:path=>path==='remote-control/paused/crime.js.txt'?'true':'',singularity:{commitCrime:()=>{commits++;return 4000;}}};
 assert.equal(guardedCommitCrime(ns,'Mug',false,null,false),0);assert.equal(commits,0);
});
test('fresh commit refuses a crime restarted after its snapshot',()=>{
 const ns={read:()=>'',ps:()=>[],singularity:{getCurrentWork:()=>({type:'CRIME',crimeType:'Mug',cyclesWorked:2}),commitCrime:()=>4000}};
 assert.equal(guardedCommitCrime(ns,'Heist',false,'Mug',false,10),0);
 assert.equal(guardedCommitCrime(ns,'Heist',false,'Mug',false,1),4000);
});
test('external work and counter resets release ownership before cleanup',async()=>{
 for(const work of [{type:'CRIME',crimeType:'Mug',cyclesWorked:1},{type:'CRIME',crimeType:'Homicide',cyclesWorked:30},{type:'GRAFTING'}]){
  const state={ownedCrime:'Mug',lastCycles:20};let stops=0;
  await crimeTick(state,{...snapshot(work),bladeburnerBlocked:true},parseCrimeOptions(['Mug']),async()=>0,Date.now(),async()=>{stops++;});
  assert.equal(state.ownedCrime,null);assert.equal(stops,0);
 }
});
test('legacy idle Bladeburner actions do not block crimes, while real actions do',()=>{
 let action={type:'Idle'},commits=0;const ns={read:()=>'',ps:()=>[],singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>[],commitCrime:()=>{commits++;return 4000;}},bladeburner:{inBladeburner:()=>true,getCurrentAction:()=>action}};
 assert.equal(guardedCommitCrime(ns,'Mug',false,null,true),4000);
 for(const type of ['Operations','BlackOps']){action={type};assert.equal(guardedCommitCrime(ns,'Mug',false,null,true),0);}
 assert.equal(commits,1);
});
test('startup queries retry, stat rewards refresh and orderly pauses clean up owned crimes',async()=>{
 const source=await readFile(new URL('../crime.js',import.meta.url),'utf8');
 assert.ok(source.includes('Date.now()-lastStatsAt>=60000'));assert.ok(source.includes('finally {'));
 assert.ok(source.includes('state.lastCycles||0'));assert.ok(source.includes('7 in sources||6 in sources'));
});
