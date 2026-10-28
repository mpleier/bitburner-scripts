import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {factionTerminalOutput} from '../faction-policy.js';
import {log} from '../helpers.js';
import {main as openCaches} from '../darknet-cache.js';
import {main as linkStasis} from '../darknet-stasis.js';
import {main as solve,codingContractTypesMetadata} from '../Tasks/contractor.js.solver.js';
import {solverVersion} from '../contract-policy.js';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
test('faction output is log-only by default and handles legacy boolean strings',()=>{
 for(const verbose of [undefined,null,false,'false','',0])assert.equal(factionTerminalOutput({verbose}),false);
 for(const value of [true,'true']){assert.equal(factionTerminalOutput({verbose:value}),true);assert.equal(factionTerminalOutput({v:value}),true);}
 assert.equal(factionTerminalOutput({v:true,'join-only':true}),false);
});
async function factionRun(options){
 const raw=await read('faction-manager.js');
 const source=raw.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm,'').replace(/\bexport (?=(async )?function|const|let)/g,'');
 const lines=[],terminal=[],ns={getScriptName:()=> 'faction-manager.js',print:s=>lines.push(s),tprint:s=>terminal.push(s),toast(){}};
 const context={factionTerminalOutput,log,isScriptPaused:()=>false,instanceCount:async()=>1,
  getConfiguration:(_ns,schema)=>({...Object.fromEntries(schema),...options}),
  getNsDataThroughFile:async(_ns,cmd)=>cmd.includes('getResetInfo')?{currentNode:7}:{money:1000,factions:[]},getActiveSourceFiles:async()=>({}),};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.entry=main;',context);await context.entry(ns);return {lines,terminal};
}
test('actual faction entrypoint routes messages to logs by default',async()=>{
 const f=await factionRun({});assert.equal(f.terminal.length,0);assert.ok(f.lines.some(l=>l.includes('requires SF4')));
});
test('explicit faction verbosity still exposes requested reports and join-only remains quiet',async()=>{
 assert.ok((await factionRun({verbose:true})).terminal.some(l=>l.includes('requires SF4')));
 assert.equal((await factionRun({verbose:true,'join-only':true})).terminal.length,0);
});
test('faction reports have no unconditional terminal mirror remaining',async()=>{
 const s=await read('faction-manager.js');assert.match(s,/\['verbose', false\]/);assert.match(s,/printToTerminal = factionTerminalOutput\(options\)/);
 assert.doesNotMatch(s,/\bns\.tprint(?:f)?\(/);assert.doesNotMatch(s,/log\(ns,[^;]*,\s*true(?:,|\))/);
});
test('Dark Net cache success and retry errors remain visible in logs without terminal output',async()=>{
 const lines=[];await openCaches({disableLog(){},getHostname:()=> 'dark:one',pid:9,getResetInfo:()=>({lastNodeReset:7,lastAugReset:42}),read:f=>f==='tasks/dnet-cache-context.json'?JSON.stringify({nodeReset:7,augReset:42}):'',ls:()=>['good.cache','bad.cache'],write(){},print:s=>lines.push(s),tprint:()=>assert.fail('routine cache output reached terminal'),dnet:{openCache:file=>{if(file.startsWith('bad'))throw Error('temporary');return {success:true};}}});
 assert.equal(lines.length,2);assert.ok(lines.some(l=>l.includes('opened good')));assert.ok(lines.some(l=>l.includes('could not open bad')));
});
test('automated stasis confirmation uses the worker log',async()=>{
 const lines=[];let linked=[];await linkStasis({getHostname:()=> 'dark:one',print:s=>lines.push(s),tprint:()=>assert.fail('stasis output reached terminal'),dnet:{getStasisLinkedServers:()=>linked,getStasisLinkLimit:()=>3,setStasisLink:async()=>{linked=['dark:one'];return {success:true};}}});assert.ok(lines.some(l=>l.includes('stasis link set')));
});
async function contractRun(total,failed=false,validated=true){
 const lines=[],terminal=[],files={};const version=solverVersion(codingContractTypesMetadata);
 if(validated)files['tasks/contract-validation.json']=JSON.stringify({version,types:{'Find Largest Prime Factor':{state:'passed'}}});
 await solve({args:[JSON.stringify(Array.from({length:total},(_,i)=>({hostname:'home',contract:'c'+i,type:'Find Largest Prime Factor',dataJson:'9'})))],read:p=>files[p]||'',write:(p,s)=>files[p]=s,print:s=>lines.push(s),tprint:s=>terminal.push(s),toast(){},sleep:async()=>{},codingcontract:{attempt:()=>failed?'':'reward'}});
 return {lines,terminal};
}
test('routine contract successes and deferred summaries stay in logs for small and large batches',async()=>{
 for(const count of [1,21])for(const validated of [false,true]){const f=await contractRun(count,false,validated);assert.equal(f.terminal.length,0);assert.ok(f.lines.some(l=>l.startsWith('Contracts:')));}
});
test('contract failures retain an actionable terminal warning',async()=>{
 for(const count of [1,21])assert.ok((await contractRun(count,true)).terminal.length>0);
});
test('background result and startup messages do not use terminal calls',async()=>{
 for(const name of ['darknet-loot.js','darknet-cache.js','darknet-stasis.js','darknet-storm.js'])assert.doesNotMatch(await read(name),/\bns\.tprint(?:f)?\(/,name);
 const agent=await read('remote-api-agent.js');assert.match(agent,/ns\.print\('Remote API command worker ready/);assert.match(agent,/ns\.tprint\('Run remote-api-agent.js on home/);
});
test('routine resource purchases and controller launches have terminal mirroring disabled',async()=>{
 const checks=[['Tasks/ram-manager.js',/SUCCESS: Upgraded home RAM[^\n]+`,false,'success'/],['sleeve.js',/SUCCESS: Sleeve[^\n]+`, false, 'success'/],['autopilot.js',/INFO: Launched[^\n]+`, false/],['host-manager.js',/RAM for[^\n]+budget was[^\n]+`, false, 'success'/]];
 for(const [name,pattern]of checks)assert.match(await read(name),pattern,name);
});
test('interactive diagnostics, opt-in stock noise, reset milestones and configuration errors stay visible',async()=>{
 for(const name of ['scan.js','grep.js','run-command.js','git-pull.js','Tasks/corporation-diagnostic.js'])assert.match(await read(name),/\bns\.tprint(?:f)?\(/,name);
 assert.match(await read('autopilot.js'),/log\(ns, `SUCCESS: \$\{text\}`, true, 'success'\)/);
 assert.match(await read('Tasks/ram-manager.js'),/Received:[^\n]+true,'error'/);
 assert.match(await read('stockmaster.js'),/if \(tprint\) ns\.tprint\(message\)/);
});


test('log-only overrides both verbose aliases and saved string settings in the actual faction worker',async()=>{
 for(const value of [true,'true']){
  assert.equal(factionTerminalOutput({'log-only':value,verbose:true,v:true}),false);
  const f=await factionRun({'log-only':value,verbose:true,v:true});assert.equal(f.terminal.length,0);assert.ok(f.lines.length>0);
 }
});
test('all automatic faction-manager launch paths explicitly require logs instead of forced verbosity',async()=>{
 const ascend=await read('ascend.js'),auto=await read('autopilot.js'),daemon=await read('daemon.js');
 assert.match(ascend,/const facmanArgs = \['--purchase', '--log-only'\]/);assert.doesNotMatch(ascend,/const facmanArgs[^;]+['"]-v['"]/);
 assert.match(daemon,/name: "faction-manager.js", factionInvites: true, args: \['--log-only'\]/);
 const launches=auto.split('\n').filter(line=>/launchScriptHelper\(ns,\s*'faction-manager.js'/.test(line));assert.equal(launches.length,3);assert.ok(launches.every(line=>line.includes('--log-only')));
});
test('automatic stock liquidation success stays quiet while explicit requests and failures remain visible',async()=>{
 assert.match(await read('stockmaster.js'),/failed positions \$\{failed\}`,explicit\|\|failed>0,failed\?'warning':'success'/);
});
