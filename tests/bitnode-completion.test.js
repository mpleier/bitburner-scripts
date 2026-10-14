import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitNodeVictory, bitNodeDeparture, runCompletionHook, completionHookFile } from '../progression-coordination.js';

test('hacking victory requires a visible daemon, enough skill and root', () => {
  assert.equal(bitNodeVictory(3000, 3000, true, false), 'hacking');
  for (const [hack, requirement, rooted] of [[2999,3000,true],[3000,3000,false],[3000,Infinity,true],[3000,0,true]])
    assert.equal(bitNodeVictory(hack, requirement, rooted, false), null);
});
test('Bladeburner victory is independent of Red Pill, hacking level and daemon root', () => {
  assert.equal(bitNodeVictory(1, Infinity, false, true), 'bladeburner');
  assert.equal(bitNodeVictory(3000, 3000, false, true), 'bladeburner');
  assert.equal(bitNodeVictory(3000, 3000, true, true), 'hacking');
});
test('departure validates stay conditions and all supported next nodes', () => {
  const input = {route:'bladeburner',nextBn:3,singularity:true};
  assert.equal(bitNodeDeparture(input),'ready');
  assert.equal(bitNodeDeparture({...input,route:null}),'not-complete');
  assert.equal(bitNodeDeparture({...input,autoDestroy:false}),'disabled');
  assert.equal(bitNodeDeparture({...input,singularity:false}),'manual-exit');
  assert.equal(bitNodeDeparture({...input,sleevesReady:false}),'sleeves-pending');
  for(const nextBn of [0,16,1.5,NaN,Infinity,'3']) assert.equal(bitNodeDeparture({...input,nextBn}),'invalid-next-node');
  for(let nextBn=1;nextBn<=15;nextBn++) assert.equal(bitNodeDeparture({...input,nextBn}),'ready');
});
function hookFixture() {
  const files=new Map(), launched=[], waited=[];
  const ns={read:path=>files.get(path)||'',write:async(path,value)=>files.set(path,value),rm:path=>files.delete(path),isRunning:()=>false};
  return {files,ns,launched,waited,launch:(script,args)=>{launched.push({script,args});return 42;},wait:async pid=>waited.push(pid)};
}
test('completion hooks run once across destruction retries and autopilot restarts',async()=>{
  const f=hookFixture();
  assert.equal(await runCompletionHook(f.ns,100,'hook.js',['arg'],f.launch,f.wait),true);
  assert.equal(await runCompletionHook(f.ns,100,'hook.js',['arg'],f.launch,f.wait),true);
  assert.equal(f.launched.length,1);assert.deepEqual(f.waited,[42]);
  assert.equal(JSON.parse(f.files.get(completionHookFile)).status,'completed');
  await runCompletionHook(f.ns,200,'hook.js',['arg'],f.launch,f.wait);
  assert.equal(f.launched.length,2);
});
test('failed hook launches block departure and remain retryable',async()=>{
  const f=hookFixture();
  assert.equal(await runCompletionHook(f.ns,100,'hook.js',[],()=>0,f.wait),false);
  assert.equal(f.files.has(completionHookFile),false);
  assert.equal(await runCompletionHook(f.ns,100,'hook.js',[],f.launch,f.wait),true);
});
test('a hook launch exception leaves no false completion receipt',async()=>{
  const f=hookFixture();
  await assert.rejects(runCompletionHook(f.ns,100,'hook.js',[],()=>{throw new Error('launch failed');},f.wait),/launch failed/);
  assert.equal(f.files.has(completionHookFile),false);
});
test('a surviving completion hook is waited for without launching another copy',async()=>{
  const f=hookFixture();f.ns.isRunning=()=>true;
  f.files.set(completionHookFile,JSON.stringify({nodeReset:100,pid:77,status:'started'}));
  await runCompletionHook(f.ns,100,'hook.js',[],f.launch,f.wait);
  assert.equal(f.launched.length,0);assert.deepEqual(f.waited,[77]);
});
test('an interrupted hook receipt prevents replay and no configured hook needs no file',async()=>{
  const f=hookFixture();
  assert.equal(await runCompletionHook(f.ns,100,'',[],f.launch,f.wait),true);
  assert.equal(f.files.size,0);
  f.files.set(completionHookFile,JSON.stringify({nodeReset:100,status:'claimed'}));
  await runCompletionHook(f.ns,100,'hook.js',[],f.launch,f.wait);
  assert.equal(f.launched.length,0);
});
test('autopilot checks departure guards before interrupting work or starting cleanup',async()=>{
  const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('async function checkIfBnIsComplete'),source.indexOf('async function getRunningScripts'));
  const transition=block.indexOf("beginTransition(ns, 'BitNode completion'");
  assert.ok(block.indexOf('bitNodeDeparture(')<transition);
  assert.ok(block.indexOf('if (reasonToStay)')<transition);
  assert.ok(block.indexOf('runCompletionHook(')>transition);
  assert.ok(block.indexOf("'cleanup.js'")>block.indexOf('runCompletionHook('));
  assert.match(block,/if \(route === 'hacking'\) \{\s*pid = launchScriptHelper\(ns, '\/Tasks\/crack-host.js'/);
  assert.match(block,/!Number\.isFinite\(wdHack\) && installedAugmentations.includes\(augTRP\)/);
});
