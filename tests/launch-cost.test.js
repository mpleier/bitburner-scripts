import {runBackgroundCheck} from '../background-job-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function harness(){
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 const a=s.indexOf('    async function tryRunTool('),b=s.indexOf('    /** Wrapper for ns.exec',a),body=s.slice(a,b);
 let cost=0,free=16,executions=0;const messages=[],tool={name:'Tasks/backdoor-all-servers.js',cost:0};
 const context={runBackgroundCheck,maintenanceRequested:()=>false,isScriptPaused:()=>false,activityBusy:()=>false,options:{'disable-script':[]},verbose:false,doesFileExist:async()=>true,
  daemonHost:'home',whichServerIsRunning:()=>[null,null],homeServer:{totalRam:()=>64},getServerByName:()=>({ramAvailable:()=>free}),
  funcResultOrValue:()=>[],exec:async()=>{executions++;return 1;},log:(ns,text)=>messages.push(text),formatRam:String};
 vm.runInNewContext(body.slice(0,body.lastIndexOf('    }')+5)+';globalThis.execute=tryRunTool;',context);
 return{tool,messages,get executions(){return executions;},set:(c,f=free)=>{cost=c;free=f;},run:()=>context.execute({getScriptRam:()=>cost},tool)};
}
test('invalid RAM estimates defer launches without retry exceptions and recover after import repair',async()=>{
 const h=await harness();assert.equal(await h.run(),false);assert.equal(await h.run(),false);
 assert.equal(h.executions,0);assert.equal(h.messages.length,1);
 h.set(7.5);assert.equal(await h.run(),true);assert.equal(h.tool.cost,7.5);assert.equal(h.executions,1);
});
test('fresh helper costs and configured minimum requirements both protect RAM',async()=>{
 const h=await harness();h.set(20,16);assert.equal(await h.run(),false);assert.equal(h.executions,0);
 h.set(7.5,16);h.tool.minimumRam=20;assert.equal(await h.run(),false);
 h.set(7.5,24);assert.equal(await h.run(),true);assert.equal(h.tool.cost,20);
});
test('backdoor policy avoids relative re-exports rejected by the live RAM analyzer',async()=>{
 const s=await readFile(new URL('../backdoor-policy.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/export\s*\{[^}]*\}\s*from/);
});
