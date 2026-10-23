import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {intelligenceProgress,observeIntelligenceFarm,intelligenceFarmPlan,intelligenceSessionDecision,intelligenceUnlocked} from '../intelligence-policy.js';
import {combatXpValue,bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {sleeveCombatCrime} from '../sleeve-development-policy.js';
import {main as farmMain} from '../farm-intelligence.js';
const reset={lastNodeReset:1,lastAugReset:2,currentNode:7,ownedSF:{5:1}},sample={xp:74000,intelligence:159,reset,pid:3,target:200};
test('intelligence measurements require a real window and invalidate gaps, reset and owner changes',()=>{
 let p=intelligenceProgress(null,{...sample,at:1000});assert.equal(p.xpPerSecond,null);
 p=intelligenceProgress(p,{...sample,xp:74060,at:61000});assert.equal(p.xpPerSecond,1);assert.ok(p.etaSeconds>0);
 assert.ok(Math.abs(p.generalBonusGain-.0177)<.0001);assert.ok(Math.abs(p.bladeburnerBonusGain-.0136)<.0001);
 for(const change of [{pid:4},{reset:{...reset,lastAugReset:3}},{xp:1},{at:200000}])assert.equal(intelligenceProgress(p,{...sample,at:62000,...change}).xpPerSecond,null);
 assert.equal(intelligenceProgress(null,{...sample,xp:NaN,at:1}),null);
 assert.equal(intelligenceProgress(null,{...sample,target:1e100,at:1}),null);
 let zero=intelligenceProgress(null,{...sample,at:1});zero=intelligenceProgress(zero,{...sample,at:60001});assert.equal(zero.xpPerSecond,0);assert.equal(zero.etaSeconds,null);
});
const keys=['hacking','strength','defense','dexterity','agility','charisma','intelligence'];
const player={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{}};
const metadata={weights:{strength:.9,intelligence:.1},decays:{strength:.8,intelligence:.75}},context={player,metadata};
test('intelligence competence score includes direct weight and global native bonus without augmentation XP multipliers',()=>{
 const direct=.1*.75*100**(-.25)*32/1534.6,competence=.9*100**.8+.1*100**.75;
 const global=32/1534.6*competence*(.75*.8*100**(-.2)/600)/(1+.75*100**.8/600);
 assert.ok(Math.abs(combatXpValue({intelligence:1},context)-direct-global)<1e-12);
 assert.equal(combatXpValue({intelligence:1},{...context,player:{...player,mults:{intelligence:100,intelligence_exp:100}}}),combatXpValue({intelligence:1},context));
 assert.ok(combatXpValue({intelligence:1},{...context,metadata:{weights:{strength:1},decays:{strength:.8}}})>0);
 const serialized=Function('return ('+combatXpValue.toString()+')')();assert.equal(serialized({intelligence:1},context),combatXpValue({intelligence:1},context));
});
test('intelligence can distinguish otherwise identical Bladeburner mission growth',()=>{
 const actions=[{name:'No int',time:1000,difficulty:100,chance:1,duty:1,weights:{strength:1}},{name:'Int too',time:1000,difficulty:100,chance:1,duty:1,weights:{strength:1,intelligence:.1}}];
 assert.equal(bladeburnerGrowthChoice(actions,context).name,'Int too');
});
test('generic sleeve crime prioritizes intelligence only inside a one-percent combat XP band',()=>{
 const sleeve={shock:0,sync:100,skills:{strength:975,intelligence:100},mults:{}};
 const crime=(xp,intelligence_exp)=>({time:1000,difficulty:1,strength_exp:xp,intelligence_exp,strength_success_weight:1});
 assert.equal(sleeveCombatCrime(sleeve,{Combat:crime(100,0),Int:crime(99.5,1)}).name,'Int');
 assert.equal(sleeveCombatCrime(sleeve,{Combat:crime(100,0),Int:crime(90,100)}).name,'Combat');
 assert.equal(sleeveCombatCrime({...sleeve,skills:{strength:975,intelligence:0}},{Combat:crime(100,0),Int:crime(99.5,1)}).name,'Combat');
 const failed=sleeveCombatCrime({...sleeve,shock:50,sync:50},{Int:crime(100,4)},0);
 assert.equal(failed.intelligenceXpPerSecond,.25); // quarter XP, half shock, half sync
});
test('farm sampling counts actual resets once and bounds interrupted observations',()=>{
 const state={resets:1,lastCycle:{at:1000,xp:1000,joins:10,resetNumber:1}};
 const measured=observeIntelligenceFarm(state,1075,2000);assert.deepEqual(measured.measurements,[{seconds:1,xp:75,joins:10}]);
 assert.equal(observeIntelligenceFarm(measured,1100,3000).measurements.length,1);
 assert.ok(observeIntelligenceFarm(state,1075,200000).measurementError);
 const pending={...state,lastCycle:{...state.lastCycle,augReset:100}};
 assert.ok(observeIntelligenceFarm(pending,1075,2000,100).measurementError);
 assert.equal(observeIntelligenceFarm(pending,1075,2000,101).measurements.length,1);
});
test('dedicated farming uses measured reachability, ordinary growth and future bonus payback',()=>{
 const base={state:{startedAt:1000,resets:1,measurements:[]},xp:74000,intelligence:159,target:200,maxResets:100,maxMinutes:10,now:2000,paybackHours:24};
 assert.equal(intelligenceFarmPlan(base).allow,true);assert.equal(intelligenceFarmPlan({...base,state:{...base.state,resets:2}}).allow,false);
 const noGain={...base.state,measurements:[{seconds:1,xp:0}]};assert.equal(intelligenceFarmPlan({...base,state:noGain}).reason,'no-measured-intelligence-gain');
 const slow={...base.state,measurements:[{seconds:5,xp:1}]};assert.equal(intelligenceFarmPlan({...base,state:slow}).allow,false);
 const good={...base.state,measurements:[{seconds:1,xp:75}]},xp=Math.exp((160+200)/32)-534.6-1;
 const decision=intelligenceFarmPlan({...base,state:good,xp});assert.equal(decision.allow,true);assert.equal(decision.level,160);assert.ok(decision.paybackSeconds<=86400);
 assert.equal(intelligenceFarmPlan({...base,state:{...good,passiveXpPerSecond:100},xp}).reason,'ordinary-progression-is-faster');
 assert.equal(intelligenceFarmPlan({...base,state:good,xp,paybackHours:.0001}).allow,false);
 const session={state:{nodeReset:1},reset:{lastNodeReset:1,lastAugReset:1000},intelligence:159,target:200,maxResets:100,maxMinutes:10,now:2000,invites:10,economics:{allow:false,reason:'no-measured-intelligence-gain'}};
 assert.equal(intelligenceSessionDecision(session),'no-measured-intelligence-gain');assert.equal(intelligenceSessionDecision({...session,now:62000}),'requires-fresh-reset');
});
function fixture({graftAfterBackup=false,casino=0,sourceFiles=true}={}){
 let xp=74000,graft=false,resets=0;const files=new Map(),logs=[],runs=[];
 const now=Date.now(),reset={lastNodeReset:now-10000,lastAugReset:now-1000,currentNode:7,ownedSF:{5:1}};
 const ns={pid:9,disableLog:()=>{},getResetInfo:()=>reset,getScriptName:()=> 'farm-intelligence.js',getPlayer:()=>({exp:{intelligence:xp},skills:{intelligence:159},factions:[]}),
  read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),print:m=>logs.push(m),fileExists:()=>true,ps:()=>[{pid:9,filename:'farm-intelligence.js'}],run:s=>{runs.push(s);return 1;},sleep:async()=>{},getMoneySources:()=>({sinceInstall:{casino}}),
  singularity:{checkFactionInvitations:()=>Array.from({length:10},(_,i)=>'F'+i),getOwnedAugmentations:()=>[],getCurrentWork:()=>graft?{type:'GRAFTING'}:null,joinFaction:()=>{xp+=7.5;return true;},softReset:()=>{resets++;return true;}},bladeburner:{getCurrentAction:()=>null}};
 const o={target:200,'max-resets':100,'max-minutes':10,'payback-hours':24,'probe-resets':2,resume:'autopilot.js'};
 const build=Function('getConfiguration','autopilotSourceFiles','intelligenceUnlocked','observeIntelligenceFarm','intelligenceFarmPlan','intelligenceSessionDecision','activityBusy','rankFactionInvites','factionJoinAllowed','prepareResetBackup','schema','return ('+farmMain.toString()+');');
 const run=build(()=>o,()=>sourceFiles?{4:3}:{},intelligenceUnlocked,observeIntelligenceFarm,intelligenceFarmPlan,intelligenceSessionDecision,()=>false,a=>a,()=>true,async()=>{graft=graftAfterBackup;},Object.entries(o));
 return {run:()=>run(ns),files,logs,runs,resets:()=>resets};
}
test('farming rechecks grafting after backup and preserves casino progress without resetting',async()=>{
 for(const options of [{graftAfterBackup:true},{casino:10},{sourceFiles:false}]){
  const f=fixture(options);await f.run();assert.equal(f.resets(),0);assert.ok(f.runs.includes('autopilot.js'));
 }
});
test('an explicitly opted-in fresh probe saves actual joins and cycle baseline before resetting',async()=>{
 const f=fixture();await f.run();assert.equal(f.resets(),1);
 const saved=JSON.parse(f.files.get('tasks/intelligence-session.json'));assert.equal(saved.lastCycle.joins,10);assert.equal(saved.lastCycle.xp,74000);assert.equal(saved.resets,1);
 const source=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');assert.match(source,/\['intelligence-farming', false\]/);assert.match(source,/intelligence-progress.json/);
});
