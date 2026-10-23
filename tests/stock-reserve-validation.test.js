import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stockOptionsError,stockReserve} from '../stock-policy.js';
const source=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');
function defaults(){return vm.runInNewContext(source.slice(source.indexOf('const argsSchema ='),source.indexOf('export function autocomplete'))+';Object.fromEntries(argsSchema)');}
test('stock reserve validation accepts parser numeric strings and preserves defaults and explicit zero',()=>{
 for(const reserve of [null,undefined,0,300000,'0','300000',' 1.5e6 ']){
  const options={...defaults(),reserve},before=JSON.stringify(options);assert.equal(stockOptionsError(options),null);assert.equal(JSON.stringify(options),before);
 }
 assert.equal(stockReserve('0','900000'),0);assert.equal(stockReserve('300000','900000'),300000);assert.equal(stockReserve(null,'900000'),900000);
});
test('stock reserve validation rejects malformed, negative, infinite and nonnumeric options',()=>{
 for(const reserve of ['', ' ', 'bad', '1m','null','Infinity','NaN','-1',-1,NaN,Infinity,-Infinity,true,false,[],{},['0']])assert.equal(stockOptionsError({...defaults(),reserve}),'reserve must be nonnegative and finite');
});
test('actual stockmaster startup passes numeric-string reserve and stops invalid values before API reads',async()=>{
 for(const reserve of ['0','300000',null,-1,'bad','']){
  const options={...defaults(),reserve};let reads=0;const messages=[],marker=Error('startup reached stock access read');
  const ns={tprint:s=>messages.push(s),getScriptName:()=> 'stockmaster.js'};
  const context={stockHistoryForecast(){},registerAutomation(){},getConfiguration:()=>options,stockOptionsError,isScriptPaused:()=>false,getNsDataThroughFile:async()=>{reads++;throw marker;}};
  vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export function','function').replace('export async function','async function')+';globalThis.run=main;',context);
  if(stockOptionsError(options)){await context.run(ns);assert.equal(reads,0);assert.equal(messages.length,1);}else{await assert.rejects(context.run(ns),e=>e===marker);assert.equal(reads,1);assert.equal(messages.length,0);}
 }
});
