import {overviewResetMatches,overviewHackingPhase,overviewRoutePresentation,overviewCompletionHookNotice} from '../overview-safety-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runtimeScripts} from '../runtime-policy.js';

async function overview(overrides={}) {
 const source=(await readFile(new URL('../stats.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replace(/export /g,'');
 const context={overviewResetMatches,overviewHackingPhase,overviewRoutePresentation,overviewCompletionHookNotice,runtimeScripts,Date:{now:()=>300000},formatMoney:n=>'$'+n,...overrides};
 vm.runInNewContext(source+`;globalThis.harness={getHudData,getAutomationHudData,optionalHudRead,prepareHudElements,cleanupHudElements,updateHudElement,getFailures:()=>hudReadFailures,set:(d,a,b)=>{doc=d;hook0=a;hook1=b;}};`,context);
 return context.harness;
}
function element(){const style={setProperty(name,value){style[name]=value;},getPropertyValue(name){return style[name]??'';}};return {children:[],style,dataset:{},classList:{add(){},remove(){},contains(){return false;}},isConnected:true,appendChild(child){child.parent=this;this.children.push(child);},remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}};}
function nsState(files={},processes=[]){return {ps:()=>processes,read:file=>files[file]||''};}
const row=(rows,name)=>rows.find(r=>r[0]===name);

test('overview counts running managers without relying on a supervisor snapshot',async()=>{
 const h=await overview(),rows=h.getAutomationHudData(nsState({},[{pid:1,filename:'go.js'},{pid:2,filename:'other.js'}]));
 assert.equal(row(rows,'Automation')[2],'1 active');assert.match(row(rows,'Automation')[3],/go/);
});

test('overview excludes stale, stopped and mismatched manager records',async()=>{
 const h=await overview(),file='tasks/corporation-status.json';
 for(const record of [{at:1,pid:1,revenue:50,expenses:5},{at:300000,pid:2,revenue:50,expenses:5}]){
  const rows=h.getAutomationHudData(nsState({[file]:JSON.stringify(record)},[{pid:1,filename:'corporation-manager.js'},{pid:2,filename:'go.js'}]));
  assert.equal(row(rows,'Corp Profit')[2],'Waiting');
 }
});

test('overview shows fresh corporation profit and recovery notices',async()=>{
 const h=await overview(),files={'tasks/corporation-status.json':JSON.stringify({at:300000,pid:1,revenue:50,expenses:5,funds:100,reserve:10,mode:'cash recovery',divisions:['A']})};
 const rows=h.getAutomationHudData(nsState(files,[{pid:1,filename:'corporation-manager.js'}]));
 assert.equal(row(rows,'Corp Profit')[2],'$45/sec');assert.equal(row(rows,'Attention')[1],true);
});

test('overview does not claim expired priority locks are active',async()=>{
 const h=await overview(),files={'tasks/activity-lock.json':JSON.stringify({ownerPid:1,kind:'casino',expiresAt:1})};
 assert.equal(row(h.getAutomationHudData(nsState(files,[{pid:1,filename:'casino.js'}])),'Priority')[2],'Normal');
});

test('overview cleanup preserves rows owned by stockmaster and avoids duplicate own rows',async()=>{
 const h=await overview(),left=element(),right=element(),stock=element(),doc={createElement:()=>element()};
 left.appendChild(stock);h.set(doc,left,right);h.prepareHudElements([['A',true,'1','']]);h.prepareHudElements([['A',true,'1','']]);
 assert.equal(left.children.length,2);assert.equal(right.children.length,0);
 assert.equal(left.children[1].children.length,1);assert.equal(left.children[1].children[0].children.length,2);
 h.cleanupHudElements();assert.equal(left.children.length,1);assert.equal(left.children[0],stock);assert.equal(right.children.length,0);
});

test('overview tooltips own a fixed pixel box on the body instead of the HUD row',async()=>{
 const h=await overview(),left=element(),right=element(),body=element();
 const doc={createElement:()=>element(),body,defaultView:{innerWidth:1280}};
 h.set(doc,left,right);
 h.prepareHudElements([['A',true,'1','Multi\nline\ntip']]);
 // The tooltip is parented by the body, so no HUD flex sizing or game .tooltiptext rule can shrink it.
 assert.equal(body.children.length,2);
 for(const tip of body.children){
  assert.ok(!String(tip.className).includes('tooltiptext'));
  assert.equal(tip.style.getPropertyValue('width'),'360px');
  assert.equal(tip.style.getPropertyValue('min-width'),'360px');
  assert.equal(tip.style.getPropertyValue('max-width'),'360px');
  assert.equal(tip.style.display,'none');assert.match(tip.style.cssText,/position: fixed/);
 }
 const grid=left.children[0],item=grid.children[0];
 assert.equal(item.children.length,2); // label and value rows; the tooltip is not inside either
 assert.equal(item.children[0].children.length,1);
});


test('overview optional API failures return their fallback',async()=>{
 const h=await overview({getNsDataThroughFile:async()=>{throw Error('missing Source File');}});
 assert.equal(await h.optionalHudRead({},'expression','file',[],null),null);
});

test('overview integrates team size, recruitment reasons, rebuilding and both Bladeburner unlocks',async()=>{
 const source=await readFile(new URL('../stats.js',import.meta.url),'utf8');
 assert.match(source,/BB Team/);assert.match(source,/getTeamSize\(action.type,action.name\)/);
 assert.match(source,/teamPlan.reason/);assert.match(source,/6 in dictSourceFiles\|\|7 in dictSourceFiles/);
 assert.match(source,/nextHook0/);assert.doesNotMatch(source,/hook1.innerHTML = hook0.innerHTML/);
});


test('overview separates projected and observed hacking income and rejects stale plans',async()=>{
 const h=await overview(),record={at:300000,ownerPid:7,enforced:true,preferred:'x',reason:'Confirmed payback',projectedRate:100,income:{state:'measured',observedRate:75,seconds:120,receipts:8}};
 const state=nsState({'tasks/hacking-target-plan.json':JSON.stringify(record)},[{pid:7,filename:'daemon.js'}]);
 const rows=h.getAutomationHudData(state);assert.equal(row(rows,'Hack Proj')[2],'$100/sec');assert.equal(row(rows,'Hack Real')[2],'$75/sec');assert.match(row(rows,'Hack Real')[3],/different interval/);
 const stale=h.getAutomationHudData(nsState({'tasks/hacking-target-plan.json':JSON.stringify({...record,at:280000})},[{pid:7,filename:'daemon.js'}]));assert.equal(row(stale,'Hack Proj')[1],false);
});

test('manager readings reject prior reset data even when a PID is reused',async()=>{
 const h=await overview(),reset={lastNodeReset:200000,lastAugReset:250000},processes=[{pid:1,filename:'corporation-manager.js'}];
 for(const record of [{at:249999,pid:1},{at:300000,pid:1,nodeReset:1,augReset:250000},{at:300000,pid:1,nodeReset:200000,augReset:1}])assert.equal(row(h.getAutomationHudData(nsState({'tasks/corporation-status.json':JSON.stringify({...record,revenue:50,expenses:5})},processes),null,reset),'Corp Profit')[2],'Waiting');
});
test('failed server and optional reads preserve independent overview rows and report partial data',async()=>{
 const h=await overview({getNsDataThroughFile:async()=>{throw Error('RAM unavailable');},formatNumberShort:String,formatRam:String,formatDuration:String,homeRamReserve:()=>32,readNodeRoutePlan:()=>null,bitNodeTooltip:()=> 'BitNode info'});
 h.set({getElementById:()=>null},element(),element());
 const rows=await h.getHudData({heart:{break:()=>0},read:()=>'',ps:()=>[],write:async()=>{}},1,{}, {'hide-automation':true,'hide-stocks':true},{});
 assert.equal(row(rows,'BitNode')[2],'1.1');assert.equal(row(rows,'Home RAM')[2],'Unavailable');assert.equal(row(rows,'HUD Data')[2],'Partial');
});

test('overview shows the current BitNode age since the previous one was destroyed',async()=>{
 const h=await overview({getNsDataThroughFile:async()=>{throw Error('RAM unavailable');},formatDuration:ms=>`${ms}ms`,formatNumberShort:String,formatRam:String,homeRamReserve:()=>32,readNodeRoutePlan:()=>null,bitNodeTooltip:()=> 'BitNode info'});
 h.set({getElementById:()=>null},element(),element());
 const ns={heart:{break:()=>0},read:()=>'',ps:()=>[],write:async()=>{}};
 const rows=await h.getHudData(ns,1,{}, {'hide-automation':true,'hide-stocks':true},{lastNodeReset:100000});
 const age=row(rows,'BN Age');assert.equal(age[1],true);assert.equal(age[2],'200000ms');assert.match(age[3],/last BitNode/);
 const missing=await h.getHudData(ns,1,{}, {'hide-automation':true,'hide-stocks':true},{});
 assert.equal(row(missing,'BN Age')[1],false);
});

test('a previous refresh failure is cleared while failures from the current refresh remain',async()=>{
 const h=await overview({getNsDataThroughFile:async()=>{throw Error('RAM unavailable');},formatNumberShort:String,formatRam:String,formatDuration:String,homeRamReserve:()=>32,readNodeRoutePlan:()=>null,bitNodeTooltip:()=> 'BitNode info'});
 h.set({getElementById:()=>null},element(),element());
 h.getFailures().push('Stocks'); // A failure from an earlier refresh must not persist forever.
 const rows=await h.getHudData({heart:{break:()=>0},read:()=>'',ps:()=>[],write:async()=>{}},1,{}, {'hide-automation':true,'hide-stocks':true},{});
 assert.ok(!h.getFailures().includes('Stocks'),'an earlier refresh failure must be cleared');
 assert.ok(h.getFailures().includes('Server/RAM'),'a failure from this refresh is still reported');
 assert.equal(row(rows,'HUD Data')[2],'Partial');
});


test('Attention exposes current-node completion holds and hides receipts from earlier nodes',async()=>{
 const h=await overview(),file='tasks/bitnode-completion-hook.json',reset={lastNodeReset:100,lastAugReset:200};
 const rows=h.getAutomationHudData(nsState({[file]:JSON.stringify({nodeReset:100,status:'uncertain',reason:'Interrupted claim'})},[]),null,reset);
 assert.equal(row(rows,'Attention')[1],true);assert.match(row(rows,'Attention')[3],/Interrupted claim/);
 const old=h.getAutomationHudData(nsState({[file]:JSON.stringify({nodeReset:99,status:'uncertain'})},[]),null,reset);
 assert.equal(row(old,'Attention')[1],false);
});
