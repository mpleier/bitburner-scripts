import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as h from '../helpers.js';
import {fallbackBitNodeMultipliers} from '../bitnode-fallbacks.js';
const basic=()=>({args:[],pid:1,print(){},tprint(){},toast(){},disableLog(){},getHostname:()=> 'test-server',getScriptName:()=> 'demo.js',read:()=>'',sleep:async()=>{}});
test('short numbers preserve case-sensitive large scales and reject partial numbers',()=>{
 for(const [s,n]of [['1q',1e15],['1Q',1e18],['2s',2e21],['2S',2e24],[' 3M ',3e6],['-2b',-2e9]])assert.equal(h.parseShortNumber(s),n);
 for(const s of ['1junkm','q','bad'])assert.ok(Number.isNaN(h.parseShortNumber(s)));
});
test('number formatting handles negative precision and the largest suffix boundary',()=>{
 assert.equal(h.formatNumber(-1.234,3,1),'-1.23');assert.equal(h.formatNumberShort(1e42),'1.000e+42');assert.ok(!h.formatNumberShort(1e42).includes('undefined'));
});
test('JSON round trips Maps, Sets, special numbers, BigInts and root undefined',()=>{
 const value={map:new Map([[2,3]]),set:new Set([1]),inf:Infinity,neg:-Infinity,nan:NaN,big:10n};
 assert.deepEqual(JSON.parse(JSON.stringify(value,h.jsonReplacer),h.jsonReviver),value);
 assert.equal(JSON.parse(JSON.stringify(undefined,h.jsonReplacer),h.jsonReviver),undefined);
});
test('configuration overrides retain flag arrays without mutating the supplied schema',()=>{
 const schema=[['count',1],['items',['a']]],ns=basic();ns.read=p=>p.endsWith('.config.txt')?'{"count":2,"items":["b"]}':'';
 ns.flags=rows=>{assert.ok(rows.every(Array.isArray));return {...Object.fromEntries(rows),_:[]};};
 const result=h.getConfiguration(ns,schema);assert.equal(result.count,2);assert.deepEqual(result.items,['b']);assert.deepEqual(schema,[['count',1],['items',['a']]]);
});
test('unknown configuration keys and invalid numeric flags fail gracefully',()=>{
 const ns=basic();ns.read=()=>'{"unknown":1}';ns.flags=()=>({});assert.equal(h.getConfiguration(ns,[['count',1]]),null);
 ns.read=()=>'';ns.flags=()=>({count:NaN});assert.equal(h.getConfiguration(ns,[['count',1]]),null);
});
test('modern Source File discovery needs no Singularity and respects Map overrides',async()=>{
 const calls=[],reset={currentNode:4,ownedSF:new Map([[2,3],[7,1]]),bitNodeOptions:{sourceFileOverrides:new Map([[7,0],[2,1]])}};
 const get=async(ns,cmd)=>{calls.push(cmd);return reset;};
 assert.deepEqual(await h.getActiveSourceFiles_Custom(basic(),get),{2:1,4:3});assert.deepEqual(calls,['ns.getResetInfo()']);
});
test('Source File discovery supports plain objects and legacy fallback',async()=>{
 assert.deepEqual(await h.getActiveSourceFiles_Custom(basic(),async()=>({currentNode:1,ownedSF:{2:2},bitNodeOptions:{sourceFileOverrides:{2:0}}})),{1:1});
 const get=async(ns,cmd)=>cmd==='ns.getResetInfo()'?{currentNode:7}:{4:2};assert.deepEqual(await h.getActiveSourceFiles_Custom(basic(),get,false),{4:2});
});
test('retry handling awaits thenables and zero retries still permits one attempt',async()=>{
 assert.equal(await h.autoRetry(basic(),()=>7,()=>({then:resolve=>resolve(true)})),7);
 let calls=0;await assert.rejects(h.autoRetry(basic(),()=>{calls++;return false;},Boolean,'failed',0,0,1,false,false,true),/failed/);assert.equal(calls,1);
 await assert.rejects(h.autoRetry(basic(),()=>true,Boolean,'failed',-1),/retry settings/);
});
test('argument unescaping retains numeric and boolean arguments',()=>{
 assert.deepEqual(h.unEscapeArrayArgs([1,true,'"hello"',"'world'"]),[1,true,'hello','world']);assert.deepEqual(h.unEscapeArrayArgs(['[1,true]']),[1,true]);
});
test('fallback multipliers cover every supported node and scale Recursion',()=>{
 for(let n=1;n<=15;n++)assert.ok(Object.values(fallbackBitNodeMultipliers(n)).every(Number.isFinite));
 assert.equal(fallbackBitNodeMultipliers(15).HackingLevelMultiplier,.6);
 assert.equal(fallbackBitNodeMultipliers(12,3).WorldDaemonDifficulty,1.02**4);
 assert.equal(fallbackBitNodeMultipliers(12,3).ServerMaxMoney,(1/(1.02**4))**2);
});
async function engine(fake) {
 const source=await readFile(new URL('../helpers.js',import.meta.url),'utf8'),files=new Map([['helpers.js',source]]),active=new Set();let nextPid=10;
 const ns={...basic(),ui:{getGameInfo:()=>({versionNumber:44})},read:p=>files.get(p)||'',write:(p,s)=>{files.set(p,s);},rm:p=>files.delete(p),isRunning:p=>active.has(p),sleep:()=>new Promise(setImmediate)};
 const run=(file,options,...args)=>{const pid=++nextPid;active.add(pid);const code=files.get(file).replace(/^import .*$/gm,'').replace('export async function main','async function main');const worker={...ns,pid,args,fake};
 Promise.resolve().then(()=>new (Object.getPrototypeOf(async function(){}).constructor)('ns','jsonReplacer',code+';return main(ns);')(worker,h.jsonReplacer)).catch(()=>{}).finally(()=>active.delete(pid));return pid;};
 return {ns,run,files};
}
test('concurrent temporary queries use isolated receipts and immutable command scripts',async()=>{
 const jobs=new Map(),e=await engine(name=>new Promise(resolve=>jobs.set(name,resolve)));
 const a=h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake(ns.args[0])','/Temp/shared.txt',['first']);const b=h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake(ns.args[0])','/Temp/shared.txt',['second']);
 while(jobs.size<2)await new Promise(setImmediate);jobs.get('second')('B');await new Promise(setImmediate);jobs.get('first')('A');
 assert.deepEqual(await Promise.all([a,b]),['A','B']);assert.ok([...e.files.keys()].every(k=>!k.includes('.result-')));
});
test('async temporary results and root undefined are awaited and serialized',async()=>{
 const e=await engine(async()=>undefined);assert.equal(await h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake()','/Temp/async.txt'),undefined);
 assert.equal(e.ns.read('/Temp/async.txt'),'{"$type":"undefined"}');
});
test('temporary errors preserve the native cause and clean up receipts',async()=>{
 const e=await engine(()=>{throw Error('API unavailable');});await assert.rejects(h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake()','/Temp/error.txt'),/API unavailable/);
 assert.ok([...e.files.keys()].every(k=>!k.includes('.result-')));
});
test('terminated workers fail promptly instead of waiting for a permanent placeholder',async()=>{
 const e=await engine(()=>0);await assert.rejects(h.getNsDataThroughFile_Custom(e.ns,()=>100,'42','/Temp/missing.txt',[],false,0,0,true),/without a result/);
});
test('temporary result paths are escaped correctly in generated source',async()=>{
 const e=await engine(()=>42);assert.equal(await h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake()','/Temp/a"b.txt'),42);
});


test('legacy games without UI game-info support still execute temporary queries',async()=>{
 const e=await engine(()=>42);e.ns.ui=undefined;assert.equal(await h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake()','/Temp/legacy.txt'),42);
});


test('default worker names never copy namespace arguments or brackets into native paths',async()=>{
 const e=await engine(x=>x);
 assert.equal(await h.getNsDataThroughFile_Custom(e.ns,e.run,'((api,args)=>api(args))(ns.fake,ns.args[0])',null,[42]),42);
 const paths=[...e.files.keys()].filter(k=>k.startsWith('/Temp/'));
 assert.ok(paths.length>0);assert.ok(paths.every(k=>/^\/Temp\/[A-Za-z0-9_.-]+$/.test(k)));
 assert.ok(paths.some(k=>k.startsWith('/Temp/ns-fake.txt.')));
});
test('default filenames handle multiline, computed, unicode and long commands safely',async()=>{
 for(const command of ['((api)=>api(42))(\n ns.fake\n)', 'ns["fake"](42)', '("雪".length+41)', '('+JSON.stringify('ns.'+'a'.repeat(1000))+',42)']) {
  const e=await engine(x=>x);assert.equal(await h.getNsDataThroughFile_Custom(e.ns,e.run,command),42);
  const paths=[...e.files.keys()].filter(k=>k.startsWith('/Temp/'));
  assert.ok(paths.every(k=>/^\/Temp\/[A-Za-z0-9_.-]+$/.test(k)&&k.length<140));
 }
});
test('ordinary command names remain compatible and distinct complex commands stay immutable',async()=>{
 const e=await engine(x=>x);
 await h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake(1)');await h.getNsDataThroughFile_Custom(e.ns,e.run,'ns.fake(2)');
 assert.equal(e.ns.read('/Temp/ns-fake.txt'),'2');assert.equal([...e.files.keys()].filter(k=>k.endsWith('.js')&&k.startsWith('/Temp/ns-fake.txt.')).length,2);
});
test('Bladeburner action starts use a stable explicit native result path',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const call=source.match(/const startResult = await getNsDataThroughFile\(ns,([\s\S]*?)\n    const success=/);
 assert.ok(call,'guarded action start call exists');
 assert.match(call[1],/`,\s*'\/Temp\/bladeburner-start-action.txt'/);
});
