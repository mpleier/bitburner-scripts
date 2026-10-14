import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeScanHtml,scanConnectCommand,discoverScanNetwork,scanRoutes,scanBackdoorEligible,submitScanRoute,scanTerminalInput} from '../scan-policy.js';
test('network discovery handles cycles and scans each reachable server once',()=>{
 const edges={home:['a','b'],a:['home','b','c'],b:['home','a','c'],c:['a','b']},calls=[];
 const network=discoverScanNetwork(host=>{calls.push(host);return edges[host];});
 assert.deepEqual(network.hosts,['home','a','b','c']);assert.equal(calls.length,4);
 assert.equal(network.parent.get('c'),'a');assert.equal(network.height.get('home'),2);
});
test('a failed scan retains the discovered node and continues other branches',()=>{
 const failures=[];const network=discoverScanNetwork(host=>{if(host==='home')return ['a','b'];if(host==='a')throw new Error('gone');return [];},'home',host=>failures.push(host));
 assert.deepEqual(network.hosts,['home','a','b']);assert.deepEqual(failures,['a']);
});
test('routes reset to home and use direct shortcuts for backdoored servers',()=>{
 const network=discoverScanNetwork(host=>({home:['a'],a:['home','b'],b:['a','c'],c:['b']}[host]));
 const routes=scanRoutes(network,new Map([['b',{backdoorInstalled:true}]]));
 assert.equal(routes.get('a'),'home; connect a');assert.equal(routes.get('b'),'connect b');assert.equal(routes.get('c'),'connect b; connect c');
});
test('names are escaped for HTML and command separators never become terminal instructions',()=>{
 assert.equal(escapeScanHtml('<b title="x">&'), '&lt;b title=&quot;x&quot;&gt;&amp;');
 assert.equal(scanConnectCommand('host; rm anything'),null);assert.equal(scanConnectCommand('host\nconnect x'),null);
 assert.equal(scanConnectCommand('I.I.I.I'),'connect I.I.I.I');assert.equal(scanConnectCommand('home'),'home');
});
test('backdoor links require root and skill and exclude home and owned or special servers',()=>{
 const server={hasAdminRights:true,requiredHackingSkill:100};
 assert.equal(scanBackdoorEligible('CSEC',server,100),true);
 for(const [host,extra,hacking] of [['home',{},100],['hacknet-server-0',{},100],['dark:sys',{},100],['CSEC',{hasAdminRights:false},100],['CSEC',{purchasedByPlayer:true},100],['CSEC',{backdoorInstalled:true},100],['CSEC',{},99]])
   assert.equal(scanBackdoorEligible(host,{...server,...extra},hacking),false);
});
test('route clicks wait for React state and submit through the refreshed handler',async()=>{
 let submitted=null, oldCalls=0, focused=false;
 const input={isConnected:true,value:'',focus:()=>{focused=true;},__reactProps$x:{value:'',onChange(){},onKeyDown:()=>{oldCalls++;}}};
 const doc={getElementById:()=>input};
 await submitScanRoute(doc,'home; connect a',async()=>{input.__reactProps$x={value:input.value,onKeyDown:event=>{assert.equal(event.key,'Enter');submitted=input.value;}};});
 assert.equal(submitted,'home; connect a');assert.equal(oldCalls,0);assert.equal(focused,true);
});
test('stale terminal inputs and failed state updates reject route submission',async()=>{
 const input={isConnected:true,value:'',focus(){},__reactProps$x:{value:'',onChange(){},onKeyDown(){}}};
 await assert.rejects(submitScanRoute({getElementById:()=>input},'home',async()=>{}),/did not update/);
 input.isConnected=false;await assert.rejects(submitScanRoute({getElementById:()=>input},'home'),/no longer visible/);
});


test('wrapped terminal inputs resolve to the actual input and busy inputs are rejected',()=>{
 const input={isConnected:true};const doc={getElementById:()=>({querySelector:()=>input})};
 assert.equal(scanTerminalInput(doc),input);input.disabled=true;assert.throws(()=>scanTerminalInput(doc),/busy/);
 input.disabled=false;input.readOnly=true;assert.throws(()=>scanTerminalInput(doc),/busy/);
});
test('an unrelated React handler update never submits the wrong command',async()=>{
 let calls=0;const input={isConnected:true,value:'',focus(){},__reactProps$x:{value:'',onChange(){},onKeyDown(){calls++;}}};
 await assert.rejects(submitScanRoute({getElementById:()=>input},'home; connect a',async()=>{input.__reactProps$x={value:'other command',onKeyDown(){calls++;}};}),/did not update/);assert.equal(calls,0);
});
test('user edits cancel a pending route rather than submitting or overwriting them',async()=>{
 let calls=0;const input={isConnected:true,value:'',focus(){},__reactProps$x:{value:'',onChange(){},onKeyDown(){calls++;}}};
 await assert.rejects(submitScanRoute({getElementById:()=>input},'home',async()=>{input.value='user command';}),/input changed/);assert.equal(calls,0);assert.equal(input.value,'user command');
});
test('wrapped route submission waits for the exact controlled value',async()=>{
 let calls=0;const input={isConnected:true,value:'',focus(){},__reactProps$x:{value:'',onChange(){},onKeyDown(){calls++;}}};const doc={getElementById:()=>({querySelector:()=>input})};
 await submitScanRoute(doc,'home',async()=>{input.__reactProps$x={value:'home',onKeyDown(){calls++;}};});assert.equal(calls,1);
});
test('a terminal becoming disabled during a pending click cancels submission',async()=>{
 const input={isConnected:true,value:'',focus(){},__reactProps$x:{value:'',onChange(){},onKeyDown(){throw Error('should not submit');}}};
 await assert.rejects(submitScanRoute({getElementById:()=>input},'home',async()=>{input.disabled=true;}),/busy/);
});
test('text fallback still displays the map when a server detail lookup fails',async()=>{
 const {main}=await import('../scan.js');let output='';const ns={args:[],getScriptName:()=> 'scan.js',read:()=>'',flags:()=>({'hide-stats':true}),print(){},tprint:s=>{output=s;},scan:h=>h==='home'?['missing']:[],getServer:h=>{if(h==='missing')throw Error('gone');return {requiredHackingSkill:1};},ls:()=>[],getHackingLevel:()=>1};
 main(ns);assert.ok(output.includes('missing (?)'));assert.ok(output.includes('home'));
});
