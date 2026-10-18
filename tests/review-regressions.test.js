import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { main as programs } from '../Tasks/program-manager.js';
import { main as killScripts } from '../kill-all-scripts.js';
import { parseCommandArgs } from '../run-command.js';
import { canLaunchFactionWorker, chooseSleeveCrime, studyCommand } from '../automation-policy.js';
import { isScriptPaused, pauseFile, setScriptPaused } from '../automation-control.js';

test('backdoor discovery uses the version-compatible cloud API', async () => {
 const source=await readFile(new URL('../Tasks/backdoor-all-servers.js',import.meta.url),'utf8');
 assert.match(source,/getNsDataThroughFile\(ns, 'ns\.cloud\.getServerNames\(\)'\)/);
 assert.doesNotMatch(source,/ns\.getPurchasedServers\(/);
});
test('faction worker launch requires actual RAM and idle startup', () => {
 assert.equal(canLaunchFactionWorker(1,ram=>8>=ram,false),false);
 assert.equal(canLaunchFactionWorker(1,ram=>512>=ram,true),false);
 assert.equal(canLaunchFactionWorker(1,ram=>128>=ram,false),true);
 assert.equal(canLaunchFactionWorker(3,ram=>32>=ram,false),true);
 assert.equal(canLaunchFactionWorker(0,()=>true,false),false);
});
test('startup travel, study, and cleanup preserve current grafts', () => {
 const touched=[];
 const ns={args:['city','course',false],singularity:{getCurrentWork:()=>({type:'GRAFTING'}),travelToCity:()=>touched.push('travel'),universityCourse:()=>touched.push('study'),stopAction:()=>touched.push('stop')}};
 for(const action of ['travel','start','stop']) assert.equal(new Function('ns','return ('+studyCommand(action)+')')(ns),false);
 assert.deepEqual(touched,[]);
});
test('study cleanup only stops class work', () => {
 let type='FACTION',stops=0;
 const ns={singularity:{getCurrentWork:()=>({type}),stopAction:()=>{stops++;return true;}}};
 const run=new Function('ns','return ('+studyCommand('stop')+')');
 assert.equal(run(ns),false); type='CLASS'; assert.equal(run(ns),true); assert.equal(stops,1);
});
test('continuous program buying exits immediately when all programs exist', async () => {
 await programs({args:['-c'],write(){},getScriptName:()=> 'Tasks/program-manager.js',read:()=>'',getResetInfo:()=>({}),getPlayer:()=>({money:1e9}),fileExists:()=>true,singularity:{purchaseProgram:()=>assert.fail('already owned')},sleep:()=>assert.fail('must exit'),toast:()=>{}});
});
test('continuous program buying retries genuinely missing programs', async () => {
 const owned=new Set(); let affordable=false,sleeps=0;
 await programs({args:['-c'],write(){},getScriptName:()=> 'Tasks/program-manager.js',read:()=>'',getResetInfo:()=>({}),getPlayer:()=>({money:1e9}),fileExists:program=>owned.has(program),singularity:{getDarkwebProgramCost:()=>500000,purchaseProgram:program=>{if(!affordable)return false;owned.add(program);return true;}},toast:()=>{},sleep:async()=>{sleeps++;affordable=true;}});
 assert.equal(sleeps,1); assert.equal(owned.size,5);
});
test('explicit sleeve crime overrides survive automatic chance selection', () => {
 assert.equal(chooseSleeveCrime('Mug',1,0.8),'Mug');
 assert.equal(chooseSleeveCrime('Heist',0,0.8),'Heist');
 assert.equal(chooseSleeveCrime(null,0.9,0.8),'Homicide');
 assert.equal(chooseSleeveCrime(null,0.1,0.8),'Mug');
});
test('silent command parsing preserves command and forwarded arguments', () => {
 const input=['-s','ns.getPlayer()'];
 assert.deepEqual(parseCommandArgs(input),{args:['ns.getPlayer()'],silent:true,escaped:false});
 assert.deepEqual(input,['-s','ns.getPlayer()']);
 assert.deepEqual(parseCommandArgs(['ns.getPlayer()','-s']).args,['ns.getPlayer()']);
 assert.equal(parseCommandArgs(['-s']).args.length,0);
 assert.equal(parseCommandArgs(["'ns.args[0]'",'argument','-s']).escaped,true);
 assert.deepEqual(parseCommandArgs(["'ns.args[0]'",'argument','-s']).args,["'ns.args[0]'",'argument']);
});
test('kill-all waits for process arrays to empty before removing files', async () => {
 let active=true,waits=0;const actions=[];
 await killScripts({print:()=>{},getHostname:()=> 'home',scan:host=>host==='home'?['remote']:['home'],ps:()=>active?[{pid:2}]:[],killall:host=>actions.push('kill:'+host),sleep:async()=>{waits++;active=false;},ls:()=>['worker.js'],rm:()=>{assert.equal(active,false);actions.push('remove');}});
 assert.equal(waits,1);assert.deepEqual(actions,['kill:remote','remove','kill:home']);
});
test('persistent pauses normalize paths and resume explicitly', async () => {
 const files=new Map();const ns={read:file=>files.get(file)||'',write:async(file,value)=>files.set(file,value),rm:file=>files.delete(file)};
 await setScriptPaused(ns,'/corporation-manager.js',true);
 assert.equal(isScriptPaused(ns,'corporation-manager.js'),true);
 await setScriptPaused(ns,'corporation-manager.js',false);
 assert.equal(isScriptPaused(ns,'/corporation-manager.js'),false);
 assert.equal(pauseFile('folder/daemon.js'),'remote-control/paused/daemon.js.txt');
});
test('supervisors and indirect starts honor persistent pauses', async () => {
 for(const file of ['autopilot.js','daemon.js','corporation-manager.js','darknet-manager.js','casino.js','grafting-manager.js','sleeve-expansion.js']) {
  const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  assert.match(source,/isScriptPaused\(ns, ns\.getScriptName\(\)\)/,file);
 }
 const daemon=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.match(daemon,/isScriptPaused\(ns, tool\.name\)/);
 const autopilot=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(autopilot,/isScriptPaused\(ns, baseScriptName\)/);
 assert.match(autopilot,/isScriptPaused\(ns, "casino\.js"\)/);
});
