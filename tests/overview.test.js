import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runtimeScripts} from '../runtime-policy.js';

async function overview(overrides={}) {
 const source=(await readFile(new URL('../stats.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replace(/export /g,'');
 const context={runtimeScripts,Date:{now:()=>300000},formatMoney:n=>'$'+n,...overrides};
 vm.runInNewContext(source+`;globalThis.harness={getAutomationHudData,optionalHudRead,prepareHudElements,cleanupHudElements,updateHudElement,set:(d,a,b)=>{doc=d;hook0=a;hook1=b;}};`,context);
 return context.harness;
}
function element(){return {children:[],style:{},dataset:{},classList:{add(){},remove(){}},isConnected:true,appendChild(child){child.parent=this;this.children.push(child);},remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}};}
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
 assert.equal(left.children.length,2);assert.equal(right.children.length,1);
 h.cleanupHudElements();assert.equal(left.children.length,1);assert.equal(left.children[0],stock);assert.equal(right.children.length,0);
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
