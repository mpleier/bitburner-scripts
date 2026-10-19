import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditBindings} from '../scripts/audit-bindings.js';
import {main as update} from '../git-pull.js';

function fixture(files=['a.js','b.js']) {
 const store=new Map([['a.js','old a'],['b.js','old b']]), messages=[], runs=[], downloads=[];
 const ns={pid:7, flags:s=>({...Object.fromEntries(s),download:files,branch:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}),getScriptName:()=> 'git-pull.js',
 print:m=>messages.push(m),tprint:m=>messages.push(m),fileExists:f=>store.has(f),read:f=>store.get(f)||'',
 write:(f,s)=>store.set(f,s),rm:f=>store.delete(f),run:f=>runs.push(f),
 wget:async(url,f)=>{downloads.push(f);store.set(f,'export const updated=1;');return true;}};
 return {store,messages,runs,downloads,ns};
}
const clean=f=>assert.ok([...f.store.keys()].every(k=>!k.startsWith('Temp/')));
test('all downloads finish before any live file changes',async()=>{
 const f=fixture(),download=f.ns.wget;
 f.ns.wget=async(...args)=>{assert.equal(f.store.get('a.js'),'old a');assert.equal(f.store.get('b.js'),'old b');return download(...args);};
 await update(f.ns);assert.equal(f.store.get('a.js'),'export const updated=1;');assert.equal(f.runs.length,1);clean(f);
});
test('thrown downloads leave every original intact',async()=>{
 const f=fixture(),download=f.ns.wget;f.ns.wget=async(url,path)=>{if(path.endsWith('/b.js'))throw new Error('offline');return download(url,path);};
 await update(f.ns);assert.equal(f.store.get('a.js'),'old a');assert.equal(f.store.get('b.js'),'old b');assert.equal(f.runs.length,0);clean(f);
});
test('failed promotion restores existing and removes newly created live files',async()=>{
 const f=fixture(['a.js','new.js','b.js']),write=f.ns.write;
 f.ns.write=(path,text)=>{if(path==='b.js'&&text.startsWith('export'))throw new Error('locked');write(path,text);};
 await update(f.ns);assert.equal(f.store.get('a.js'),'old a');assert.equal(f.store.get('b.js'),'old b');assert.equal(f.store.has('new.js'),false);assert.equal(f.runs.length,0);assert.ok(f.messages.some(m=>m.includes('Previous files restored')));clean(f);
});
test('silent write corruption is detected and rolled back, including empty originals',async()=>{
 const f=fixture(),write=f.ns.write;f.store.set('a.js','');
 f.ns.write=(path,text)=>write(path,path==='b.js'&&text.startsWith('export')?'corrupted':text);
 await update(f.ns);assert.equal(f.store.get('a.js'),'');assert.equal(f.store.get('b.js'),'old b');assert.equal(f.runs.length,0);clean(f);
});
test('restoration failures are reported explicitly',async()=>{
 const f=fixture(),write=f.ns.write;f.ns.write=(path,text)=>{if(path==='b.js'||text==='old a')throw new Error('locked');return write(path,text);};
 await update(f.ns);assert.ok(f.messages.some(m=>m.includes('RESTORATION FAILED for:') && m.includes('a.js')));assert.equal(f.runs.length,0);clean(f);
});
test('empty executables and HTML errors abort while empty text files are accepted',async()=>{
 for(const body of ['', '<!DOCTYPE html><html>error</html>']){const f=fixture(['a.js']);f.ns.wget=async(url,path)=>{f.store.set(path,body);return true;};await update(f.ns);assert.equal(f.store.get('a.js'),'old a');assert.equal(f.runs.length,0);clean(f);}
 const f=fixture(['blank.txt']);f.ns.wget=async(url,path)=>{f.store.set(path,'');return true;};await update(f.ns);assert.equal(f.store.get('blank.txt'),'');assert.equal(f.runs.length,1);clean(f);
});
test('unsafe update paths are rejected before downloading',async()=>{
 for(const path of ['../a.js','dir/../a.js','dir//a.js','C:/a.js','dir\\a.js','a.js?other','a.js#other']){const f=fixture([path]);await update(f.ns);assert.equal(f.downloads.length,0);assert.equal(f.store.get('a.js'),'old a');assert.equal(f.runs.length,0);}
});
test('undefined checker catches missing variables and shorthand properties',()=>{
 const result=auditBindings(new Map([['a.js','export function f(ns){ const x={missing}; return unknown + ns.args[0]; }']]));assert.equal(result.problems.length,2);
});
test('undefined checker understands bindings, imports, browser globals and type comments',()=>{
 const result=auditBindings(new Map([['a.js',`import {value as alias} from './b.js';
 /** @param {NS} ns */
 export function f(ns){const {x:y}={x:1};try{throw 1;}catch(error){console.log(error);}
 const fn=()=>y+alias; return [fn(), typeof absent, window, globalThis, ns];}`],['b.js','export const value=1;']]));assert.deepEqual(result.problems,[]);
});
test('undefined checker respects block scope and isolated script modules',()=>{
 const result=auditBindings(new Map([['a.js','const leaked=1;'],['b.js','function f(){ {let scoped=1;} return scoped + leaked; }']]));assert.equal(result.problems.length,2);
});
