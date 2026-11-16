import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const allMaxed={strength:300,defense:300,dexterity:300,agility:300};
const plain=value=>JSON.parse(JSON.stringify(value));

function loadSection(context,source,startMarker,endMarker,exportName){
 const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,`missing slice ${startMarker}`);
 const body=source.slice(start,end).replaceAll('export async function','async function');
 vm.runInNewContext(body+`\nglobalThis.${exportName}=${exportName};`,context);
 return context[exportName];
}

function crimeHarness({skills,kills=8213,karma=-95192,gymAvailable=true,setKillsAfterCrime=false}={}){
 const calls={gym:[],crimes:[]};
 const player={skills:{...skills},numPeopleKilled:kills};
 const context={
  options:{},
  getPlayerInfo:async()=>({...player,skills:{...player.skills}}),
  getNsDataThroughFile:async()=>({Heist:.5,Assassination:.5,Homicide:.99,Mug:.5}),
  getCurrentWorkInfo:async()=>({type:'CRIME',crimeType:'Homicide'}),
  isValidInterruption:async()=>false,
  factionWorkCommand:async(ns,expression,args=[])=>{
   calls.crimes.push(args[0]);
   player.skills={...allMaxed};
   if(setKillsAfterCrime)player.numPeopleKilled=30;
   return 1000;
  },
  trainCombatStatAtGym:async(ns,stat,requirement)=>{
   calls.gym.push(stat);
   if(!gymAvailable)return false;
   player.skills={...player.skills,[stat]:requirement};
   return true;
  },
  focusForWork:()=>true,tail(){},log(){},automationHeartbeat(){},isScriptPaused:()=>false,
  maintenanceRequested:()=>false,activityBusy:()=>false,breakToMainLoop:()=>false,
  loopSleepInterval:1000,statusUpdateInterval:60000,crimeCount:0,
  ns:{heart:{break:()=>karma},print(){},sleep:async()=>{},getScriptName:()=>'work-for-factions.js'},
 };
 return {context,calls,player};
}

async function runCrime({skills,...rest}={},args={trainLastStatAtGym:true}){
 const harness=crimeHarness({skills,...rest});
 const source=(await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const run=loadSection(harness.context,source,'const combatStats =','/** @param {NS} ns */\nasync function studyForCharisma','crimeForKillsKarmaStats');
 const outcome=await run(harness.context.ns,30,45,300,false,args.trainLastStatAtGym);
 return {...harness,outcome};
}

test('the final deficient combat stat is finished at the gym instead of crime',async()=>{
 const r=await runCrime({skills:{strength:299,defense:300,dexterity:300,agility:300}});
 assert.deepEqual(r.calls.gym,['strength']);
 assert.deepEqual(r.calls.crimes,[]);
 assert.equal(r.outcome,true);
});

test('crime still trains every stat while more than one is deficient',async()=>{
 const r=await runCrime({skills:{strength:299,defense:290,dexterity:300,agility:300}});
 assert.deepEqual(r.calls.gym,[]);
 assert.deepEqual(r.calls.crimes,['Homicide']);
});

test('an unusable gym falls back to crime instead of stalling',async()=>{
 const r=await runCrime({skills:{strength:299,defense:300,dexterity:300,agility:300},gymAvailable:false});
 assert.deepEqual(r.calls.gym,['strength']);
 assert.deepEqual(r.calls.crimes,['Homicide']);
});

test('the gym handoff is opt-in and respects unmet kill requirements',async()=>{
 const disabled=await runCrime({skills:{strength:299,defense:300,dexterity:300,agility:300}},{trainLastStatAtGym:false});
 assert.deepEqual(disabled.calls.gym,[]);
 assert.deepEqual(disabled.calls.crimes,['Homicide']);
 const kills=await runCrime({skills:{strength:299,defense:300,dexterity:300,agility:300},kills:0,setKillsAfterCrime:true});
 assert.deepEqual(kills.calls.gym,[]);
 assert.deepEqual(kills.calls.crimes,['Homicide']);
});

async function runGym({work={type:'CRIME'},city='Chongqing',money=5e6,gymStarts=true,noStudying=false}={}){
 const calls={travel:[],gym:[],monitor:[],logs:[]};
 const context={
  options:{'no-studying':noStudying},
  getCurrentWorkInfo:async()=>work,
  getPlayerInfo:async()=>({city,money,skills:{strength:250}}),
  goToCity:async(ns,to)=>{calls.travel.push(to);return true;},
  factionWorkCommand:async(ns,expression,args=[])=>{calls.gym.push(args);return gymStarts;},
  focusForWork:()=>true,
  monitorStudies:async(ns,stat,requirement,label)=>{calls.monitor.push([stat,requirement,label]);return true;},
  log:(ns,message)=>calls.logs.push(message),
  formatMoney:n=>'$'+n,
 };
 const source=(await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const run=loadSection(context,source,'const gymLocation =','/** @param {NS} ns */\nexport async function factionInviteBackdoorReady','trainCombatStatAtGym');
 const started=await run({},'strength',300);
 return {started,calls};
}

test('gym training travels once and uses the native gym stat abbreviation',async()=>{
 const r=await runGym();
 assert.equal(r.started,true);
 assert.deepEqual(r.calls.travel,['Sector-12']);
 assert.deepEqual(plain(r.calls.gym),[['Powerhouse Gym','str',true]]);
 assert.deepEqual(r.calls.monitor,[['strength',300,'Training']]);
});

test('gym training resumes existing work without travelling or restarting it',async()=>{
 const r=await runGym({work:{type:'CLASS',classType:'str',location:'Powerhouse Gym'}});
 assert.equal(r.started,true);
 assert.deepEqual(r.calls.travel,[]);
 assert.deepEqual(r.calls.gym,[]);
 assert.deepEqual(r.calls.monitor,[['strength',300,'Training']]);
});

test('gym training refuses to start without travel cash, native success or --no-studying',async()=>{
 const poor=await runGym({money:500000});
 assert.equal(poor.started,false);
 assert.deepEqual(poor.calls.travel,[]);
 assert.deepEqual(poor.calls.monitor,[]);
 const failed=await runGym({gymStarts:false});
 assert.equal(failed.started,false);
 assert.deepEqual(failed.calls.monitor,[]);
 assert.ok(failed.calls.logs.some(message=>message.includes('Failed to start gym training')));
 const disabled=await runGym({noStudying:true});
 assert.equal(disabled.started,false);
 assert.deepEqual(disabled.calls.travel,[]);
});

test('gang qualification enables the gym handoff and drives the host requirement directly',async()=>{
 const source=(await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 assert.match(source,/crimeForKillsKarmaStats\(ns, requiredKillsByFaction\[factionName\][^;]*, false, true\);/);
 assert.match(source,/await earnFactionInvite\(ns, gangPlan\.inviteOrder\[0\]\)/);
});
