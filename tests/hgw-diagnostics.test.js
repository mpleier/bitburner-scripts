import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {classifyHgwEvent,readHgwTiming} from '../hgw-diagnostics-policy.js';
import {collectHgwTelemetry} from '../hgw-telemetry-policy.js';
import {renderCommandJob,validateCommand} from '../remote-api-command.js';
const reset={lastAugReset:1,lastNodeReset:2},now=100000;
const event=(extra={})=>({at:now-1,owner:7,pid:9,tool:'hack',target:'phantasy',description:'batch',deadline:now-288,lateMs:287,toleranceMs:250,legSpacingMs:2600,startLateMs:0,unavoidableMs:0,error:null,...extra});
function fixture(data={}){
 const files=new Map([['tasks/hgw-misfires.json',JSON.stringify({at:now,ownerPid:7,augReset:1,nodeReset:2,counts:{operations:1},recent:[event()],...data})]]);
 return {files,ns:{read:f=>{assert.ok(['tasks/hgw-misfires.json','tasks/hgw-pacing.json'].includes(f));return files.get(f)||'';},getResetInfo:()=>reset,isRunning:p=>p===7}};
}
test('HGW classification distinguishes minor misses, risks, errors and unknown spacing',()=>{
 assert.equal(classifyHgwEvent(event()).kind,'deadline-miss');assert.equal(classifyHgwEvent(event({lateMs:1300})).kind,'deadline-miss');assert.equal(classifyHgwEvent(event({lateMs:1301})).kind,'spacing-risk');assert.equal(classifyHgwEvent(event({lateMs:250})).kind,'on-time');assert.equal(classifyHgwEvent(event({lateMs:0,error:'failed'})).kind,'error');assert.equal(classifyHgwEvent(event({legSpacingMs:null})).kind,'unclassified-delay');assert.equal(classifyHgwEvent(event({lateMs:NaN})).kind,'unknown');
});
test('minor messages do not toast or throttle later spacing risks; counters remain complete',()=>{
 let queue=JSON.stringify({channel:'hgw-v1',augReset:1,nodeReset:2,counts:{operations:3,deadlineOverruns:3,spacingSamples:3,spacingRisks:1},recent:[event(),event({lateMs:1400})],alerts:[event(),event(),event({lateMs:1400}),event({lateMs:1500})]});const files=new Map(),logs=[],toasts=[];
 const ns={read:f=>files.get(f)||'',write:(f,s)=>files.set(f,s),print:s=>logs.push(s),toast:(...args)=>toasts.push(args),getPortHandle:()=>({peek:()=>queue,read:()=>{queue='NULL PORT DATA';}})};
 collectHgwTelemetry(ns,reset,7,now);assert.equal(logs.length,2);assert.match(logs[0],/^INFO: HGW deadline miss/);assert.match(logs[1],/^WARNING: HGW timing risk/);assert.equal(toasts.length,1);assert.equal(JSON.parse(files.get('tasks/hgw-misfires.json')).counts.deadlineOverruns,3);
});
test('legacy events without spacing and native failures retain warning severity',()=>{
 const logs=[];let queue=JSON.stringify({channel:'hgw-v1',augReset:1,nodeReset:2,alerts:[event({legSpacingMs:null}),event({tool:'grow',lateMs:0,error:'native failure'})]});
 const ns={read:()=>'',write(){},print:s=>logs.push(s),toast(){},getPortHandle:()=>({peek:()=>queue,read:()=>{queue='NULL PORT DATA';}})};
 collectHgwTelemetry(ns,reset,7,now);assert.equal(logs.length,2);assert.match(logs[0],/spacing unavailable/);assert.match(logs[1],/operation error/);
});
test('fixed timing query filters reset, owner and age and caps the event sample',()=>{
 const f=fixture({recent:[event({owner:8}),event({at:now-120001}),event({at:now+1}),...Array.from({length:25},(_,i)=>event({pid:i+1}))]});const r=readHgwTiming(f.ns,now,classifyHgwEvent);assert.equal(r.state,'ready');assert.equal(r.recent.length,20);assert.equal(r.recent[0].pid,6);assert.equal(r.recent[0].kind,'deadline-miss');assert.equal(r.recent[0].thresholdMs,1300);assert.equal(r.counts.operations,1);assert.match(r.countsScope,/previous owners/);assert.equal(r.pacing,null);
 for(const data of [{at:now+1},{at:now-15001},{augReset:3}])assert.equal(readHgwTiming(fixture(data).ns,now,classifyHgwEvent).state,'stale');
 const missing=fixture();missing.files.clear();assert.equal(readHgwTiming(missing.ns,now,classifyHgwEvent).state,'waiting');const offline=fixture();offline.ns.isRunning=()=>false;assert.equal(readHgwTiming(offline.ns,now,classifyHgwEvent).state,'worker-offline');
});
test('timing query only includes matching fresh pacing and rejects oversized input',()=>{
 const f=fixture(),pace={pid:7,at:now,augReset:1,nodeReset:2,cycleMs:10420};f.files.set('tasks/hgw-pacing.json',JSON.stringify(pace));assert.equal(readHgwTiming(f.ns,now,classifyHgwEvent).pacing.cycleMs,10420);
 for(const change of [{pid:8},{at:now+1},{nodeReset:3},{at:now-30001}]){f.files.set('tasks/hgw-pacing.json',JSON.stringify({...pace,...change}));assert.equal(readHgwTiming(f.ns,now,classifyHgwEvent).pacing,null);}
 f.files.set('tasks/hgw-misfires.json','x'.repeat(300001));assert.throws(()=>readHgwTiming(f.ns,now,classifyHgwEvent),/exceeds/);
});
test('generated timing command executes without mutation APIs and rejects arbitrary arguments',async()=>{
 const command={id:'timing-qc',method:'automation.hgwTiming',args:[],expiresAt:Date.now()+60000},f=fixture({at:Date.now(),recent:[]});let output;
 const ns={...f.ns,args:['[]','out','timing-qc'],write:async(path,value)=>{assert.equal(path,'out');output=JSON.parse(value);}};
 const code=renderCommandJob(command).replace('export async function main','async function main');await new (Object.getPrototypeOf(async function(){}).constructor)('ns',code+';return main(ns);')(ns);assert.equal(output.result.state,'ready');assert.throws(()=>validateCommand({...command,args:['other-file']}),/no arguments/);
});
test('standalone workers keep minor fallback toasts quiet while retaining native errors',async()=>{
 for(const name of ['hack','grow','weak']){
  const source=readFileSync(new URL('../Remote/'+name+'-target.js',import.meta.url),'utf8'),tool=name==='weak'?'weaken':name;
  for(const [late,error,expected]of [[287,false,0],[1301,false,1],[0,true,1]]){
   let at=1000,toasts=0,lastToast='';const ctx=vm.createContext({Date:{now:()=>at},Number,JSON,Math,ns:{args:tool==='weaken'?['x',1000,1000,'batch',false,false,0,JSON.stringify({legSpacingMs:2600,toleranceMs:250})]:['x',1000,1000,'batch',false,false,false,0,JSON.stringify({legSpacingMs:2600,toleranceMs:250})],print(){},toast(message){toasts++;lastToast=message;},['get'+tool[0].toUpperCase()+tool.slice(1)+'Time']:()=>1000,[tool]:async()=>{at=2000+late;if(error)throw Error('native');return 1;}}});
   vm.runInContext(source.replace('export async function main','async function main')+';result=main(ns);',ctx);try{await ctx.result;}catch(e){assert.equal(error,true);}assert.equal(toasts,expected,name);if(error)assert.match(lastToast,/Operation error/);
  }
 }
});
