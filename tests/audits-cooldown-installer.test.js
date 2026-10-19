import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {auditImports,apiReferences,auditApis,auditDynamicRam,estimateRam} from '../scripts/audit-core.js';
import {schedulingMinima,checkNativeRamBudgets} from '../scripts/ram-budget-core.js';
import {ramBudgetGroups} from '../scripts/ram-budget-groups.js';
import {launchCooldown,recordLaunch,launchCooldownKey} from '../launch-cooldown-policy.js';
import {nativeScriptPreflight} from '../native-preflight-policy.js';
import {main as gitPull} from '../git-pull.js';
import {formatTime} from '../helpers.js';
const surface=JSON.parse(readFileSync(new URL('../scripts/api-surface.json',import.meta.url),'utf8'));

test('import audit catches missing files and missing named/default exports',()=>{
 const files=new Map([['a.js',"import d,{missing} from './b.js'; import './gone.js';"],['b.js','export const present=1;']]);
 const result=auditImports(files);assert.equal(result.problems.length,3);assert.ok(result.problems.some(p=>p.detail.includes('missing')));assert.ok(result.problems.some(p=>p.detail.includes('default')));
});
test('import audit supports aliases, reexports, export-star, defaults and cycles',()=>{
 const files=new Map([['main.js',"import def,{publicName as local, other} from './a.js';"],['a.js',"export {x as publicName} from './b.js'; export * from './c.js'; export default 1;"],['b.js','export const x=1;'],['c.js',"export * from './a.js'; export function other(){}"]]);
 assert.deepEqual(auditImports(files).problems,[]);
});
test('import audit rejects path escapes and node dependencies in game files',()=>{
 const result=auditImports(new Map([['main.js',"import '../../outside.js'; import 'node:fs';"]]));assert.equal(result.problems.length,2);
});
test('API audit follows namespace aliases and literal generated workers',()=>{
 const files=new Map([['a.js',"function main(ns){const c=ns.corporation; c.imaginary(); ns.singularity.getUpgradeHomeRamCost();} const worker='function run(ns){ns.nonexistent();}';"]]);
 const result=auditApis(files,surface);assert.deepEqual(result.problems.map(p=>p.detail).sort(),['ns.corporation.imaginary','ns.nonexistent']);
});
test('API audit tracks lexical shadowing and destructured namespace members',()=>{
 const refs=apiReferences('a.js',"function f(ns){const c=ns.cloud;{const c={};c.nonApi();} c.getServerCost(32);const {getServerNames:list}=ns.cloud;list();}").references;
 assert.ok(refs.has('cloud.getServerCost'));assert.ok(!refs.has('cloud.nonApi'));
});
test('API compatibility exceptions are specific to a file and API, with documented intent',()=>{
 const files=new Map([['legacy.js','ns.oldApi();'],['other.js','ns.oldApi();']]);const result=auditApis(files,surface,{'legacy.js':{'oldApi':'guarded fallback'}});assert.equal(result.problems.length,1);assert.equal(result.problems[0].file,'other.js');
});
test('API audit exposes computed calls instead of claiming full coverage',()=>{
 const result=apiReferences('a.js','function f(ns,key){ns[key]();ns.dynamicImport("./b.js");}');assert.ok(result.uncertain.size>=2);
});
test('documented API snapshot retains methods with interface return types as functions',()=>{
 assert.equal(surface.paths['gang.getGangInformation'],'function');assert.equal(surface.paths['format.time'],'function');assert.equal(surface.paths['ui.time'],undefined);assert.equal(surface.sha256.length,64);
});
test('RAM estimates deduplicate calls and distinguish SF4 levels',()=>{
 const defs={paths:{a:'function',b:'function'},costs:{a:{base:2,singularityScaled:true},b:{base:1,singularityScaled:false}}};
 assert.equal(estimateRam(['a','a','b'],defs,3).ram,4.6);assert.equal(estimateRam(['a','b'],defs,2).ram,10.6);assert.equal(estimateRam(['a','b'],defs,1).ram,34.6);
});
test('RAM audit catches charged APIs behind dynamic imports and follows static chains',()=>{
 const files=new Map([['a.js','async function main(ns){await ns.dynamicImport("./b.js");}'],['b.js','export function f(ns){ns.hack("n00dles");}']]);assert.ok(auditDynamicRam(files,surface).problems.some(p=>p.file==='a.js'));
 files.set('a.js','import {f} from "./b.js"; export function main(ns){f(ns);}');assert.equal(auditDynamicRam(files,surface).problems.length,0);
});
test('scheduler RAM audit fails a missing or insufficient parent-plus-worker allowance',()=>{
 const defs={paths:{hack:'function'},costs:{hack:{base:1,singularityScaled:false}}},groups=[{parent:'parent.js',worker:'ns.hack("n00dles")'}],native={sourceFile4:3,scripts:[{script:'parent.js',ram:5}]};
 const minima=schedulingMinima('const tools=[{name:"parent.js",minRamReq:6}];');assert.equal(checkNativeRamBudgets(native,defs,groups,minima).groups[0].required,7.6);assert.equal(checkNativeRamBudgets(native,defs,groups,minima).ok,false);
 minima.set('parent.js',8);assert.equal(checkNativeRamBudgets(native,defs,groups,minima).ok,true);assert.equal(checkNativeRamBudgets({...native,sourceFile4:undefined},defs,groups,minima).ok,false);
});
test('cloud and contract scheduler groups include actual serialized child dependencies',()=>{
 const cloud=ramBudgetGroups.find(g=>g.parent==='host-manager.js');assert.match(cloud.worker,/function claimSpending/);assert.match(cloud.worker,/getServerUpgradeCost/);assert.ok(apiReferences('worker.js',cloud.worker).references.has('cloud.purchaseServer'));
});
test('native preflight exposes active SF4 overrides and current-node access without mutations',()=>{
 for(const [reset,wanted]of [[{currentNode:4,ownedSF:new Map()},3],[{currentNode:7,ownedSF:new Map([[4,2]])},2],[{currentNode:4,ownedSF:new Map(),bitNodeOptions:{sourceFileOverrides:new Map([[4,1]])}},1]])assert.equal(nativeScriptPreflight({getResetInfo:()=>reset},[]).sourceFile4,wanted);
});
const update=(s,now,alive=false,extra={})=>launchCooldown(s,{now,alive,reset:1,signature:'v1',...extra});
test('two rapid exits trigger bounded cooldown; repeated observations do not extend it',()=>{
 let s=recordLaunch(update(null,100000),1,100000);s=update(s,110000);assert.equal(s.strikes,1);s=recordLaunch(s,2,110000);s=update(s,120000);assert.equal(s.retryAt,150000);assert.equal(s.pid,0);assert.equal(update(s,130000).retryAt,150000);
 for(let i=0;i<20;i++){s=recordLaunch(s,i+3,s.retryAt);s=update(s,s.startedAt+1000);}assert.ok(s.retryAt-s.at<=300000);
});
test('stable uptime, reset, clock rollback and source changes clear crash history',()=>{
 let s={reset:1,signature:'v1',pid:7,startedAt:100000,strikes:4,retryAt:140000,at:100000};
 assert.equal(update(s,170000,true).strikes,0);assert.equal(update(s,110000,false,{reset:2}).strikes,0);assert.equal(update(s,110000,false,{signature:'v2'}).strikes,0);assert.equal(update(s,90000,false).strikes,0);
 assert.notEqual(launchCooldownKey('a.js',['x']),launchCooldownKey('a.js',['y']));
});
test('actual autopilot launcher backs off fast exits but leaves one-shot progression hooks alone',()=>{
 const text=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=text.indexOf('    function launchScriptHelper('),end=text.indexOf('    let lastStatusLog',start),code=text.slice(start,end);
 let now=100000,pid=0,runs=0;const map=new Map();class Clock extends Date{static now(){return now;}}
 const context={Date:Clock,launchCooldown,recordLaunch,launchCooldownKey,launchHistory:map,launchSourceCache:new Map(),trackedLaunches:new Set(['bladeburner.js']),resetInfo:{lastAugReset:1},options:{'no-tail-windows':true},
  isScriptPaused:()=>false,activityBusy:()=>false,getFilePath:x=>x,scriptSignature:()=> 'v1',homeRamReserve:()=>0,reclaimHomeRam:()=>true,log(){},log_once(){},getErrorInfo:String,
  ns:{getScriptRam:()=>2,isRunning:()=>false,run:()=>{runs++;return ++pid;}}};
 vm.runInNewContext(code+';globalThis.launch=launchScriptHelper;',context);
 context.launch(context.ns,'bladeburner.js');now+=10000;context.launch(context.ns,'bladeburner.js');now+=10000;assert.equal(context.launch(context.ns,'bladeburner.js'),0);assert.equal(runs,2);
 now+=10000;assert.equal(context.launch(context.ns,'bladeburner.js'),0);now=150000;assert.ok(context.launch(context.ns,'bladeburner.js')>0);
 for(let i=0;i<5;i++)context.launch(context.ns,'ascend.js');assert.equal(runs,8);
});
test('v3 time formatter uses the current API',()=>{
 assert.equal(formatTime({ui:{getGameInfo:()=>({versionNumber:44})},format:{time:(n,p)=>n+':'+p}},1200,true),'1200:true');
});

function installer({files=['a.js'],failed=[],subfolder='',stale=false,args={}}={}){
 const store=new Map(stale?[['git-pull.js','old installer']]:[]),downloads=[],messages=[],runs=[];
 const ns={flags:s=>({...Object.fromEntries(s),download:files,subfolder,...args}),getScriptName:()=> 'git-pull.js',pid:7,
  print:m=>messages.push(m),tprint:m=>messages.push(m),wget:async(url,file)=>{downloads.push({url,file});if(failed.includes(file))return false;store.set(file,"export const value=1;\n");return true;},
  read:f=>store.get(f)||'',write:(f,s)=>store.set(f,s),run:(...a)=>{runs.push(a);return 1;},ls:()=>[]};
 return {ns,store,downloads,messages,runs};
}
test('installer successfully updates nested files and forwards ref/subfolder settings',async()=>{
 const f=installer({files:['Tasks/a.js','helpers.js'],subfolder:'folder',args:{branch:'feature/test'}});await gitPull(f.ns);assert.equal(f.downloads.length,2);assert.ok(f.downloads.every(d=>d.url.includes('/feature/test/')));assert.deepEqual(f.runs,[['folder/cleanup.js']]);
});
test('partial downloads report incomplete results and do not run cleanup',async()=>{
 const f=installer({files:['a.js','b.js'],failed:['b.js']});await gitPull(f.ns);assert.equal(f.runs.length,0);assert.ok(f.messages.some(m=>m.includes('Pull incomplete: 1/2')));assert.ok(!f.messages.some(m=>m.includes('Pull complete.')));
});
test('retry completes an interrupted update without overwriting local config files',async()=>{
 const f=installer({files:['a.js','b.js'],failed:['b.js']});f.store.set('a.js.config.txt','local settings');await gitPull(f.ns);
 f.ns.wget=async(url,file)=>{f.store.set(file,'export const restored=1;');return true;};await gitPull(f.ns);assert.equal(f.runs.length,1);assert.equal(f.store.get('a.js.config.txt'),'local settings');
});
test('self-update replaces a stale installer without recursively launching itself',async()=>{
 const f=installer({files:['git-pull.js'],stale:true});await gitPull(f.ns);assert.notEqual(f.store.get('git-pull.js'),'old installer');assert.ok(f.runs.every(([file])=>file==='cleanup.js'));assert.equal(f.downloads.length,1);
});
test('duplicate install entries are downloaded once',async()=>{
 const f=installer({files:['a.js','a.js'],args:{'new-file':['a.js']}});await gitPull(f.ns);assert.equal(f.downloads.length,1);
});

test('import audit handles namespace reexports without inventing named exports',()=>{
 const files=new Map([['a.js',"export * as tools from './b.js';"],['b.js','export const helper=1;'],['main.js',"import {tools} from './a.js';"]]);assert.equal(auditImports(files).problems.length,0);
 files.set('main.js',"import {helper} from './a.js';");assert.equal(auditImports(files).problems.length,1);
});
