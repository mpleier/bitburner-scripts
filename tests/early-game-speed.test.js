import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {daemonHomeReserve,infrastructureCashBand,infrastructureAffordable,torProgramsHandoff} from '../early-game-policy.js';
import {hacknetTierEligible} from '../hacknet-policy.js';
import {main as programs} from '../Tasks/program-manager.js';
import {main as tor} from '../Tasks/tor-manager.js';

test('default home reserve scales down while explicit reservations remain authoritative',()=>{
 for(const [ram,want]of [[8,2],[32,8],[64,16],[128,32],[1024,32]])assert.equal(daemonHomeReserve(ram),want);
 assert.equal(daemonHomeReserve(32,0),0);assert.equal(daemonHomeReserve(32,512),512);
 assert.equal(daemonHomeReserve(1024,null,true),64);
});
test('cash milestones increase at meaningful wallet thresholds',()=>{
 assert.equal(infrastructureCashBand(0),-1);assert.equal(infrastructureCashBand(NaN),-1);
 assert.equal(infrastructureCashBand(100000),0);assert.equal(infrastructureCashBand(200000),1);
 assert.ok(infrastructureCashBand(1e10)>infrastructureCashBand(300000));
});
test('consolidated Hacknet tiers retain the four former cost and payoff limits',()=>{
 for(const [cost,payoff,want]of [[900000,3600,true],[100000,14400,true],[100001,14400,false],
 [10000,28800,true],[10001,28800,false],[1000,1e8,true],[1001,1e8,false],[Infinity,1,false]])
 assert.equal(hacknetTierEligible({cost,payoff},1e6),want,JSON.stringify([cost,payoff]));
});
function purchasing({money=1e6,reserve=300000,paused=false,challenge=false,maintenance=false}={}){
 const bought=[],owned=new Set(),files={'reserve.txt':String(reserve)};
 if(paused){files['remote-control/paused/program-manager.js.txt']='true';files['remote-control/paused/tor-manager.js.txt']='true';}
 if(challenge)files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:1,deniedActions:['cashSpending']});
 if(maintenance)files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:99,expiresAt:Date.now()+10000});
 const ns={args:[],getScriptName:()=> 'Tasks/program-manager.js',read:f=>files[f]||'',write:(f,s)=>files[f]=s,getResetInfo:()=>({lastNodeReset:1}),isRunning:()=>true,
 getPlayer:()=>({money}),fileExists:p=>owned.has(p),scan:()=>[],toast(){},print(){},
 singularity:{getDarkwebProgramCost:()=>500000,purchaseProgram:p=>{money-=500000;owned.add(p);bought.push(p);return true;},
 purchaseTor:()=>{money-=200000;bought.push('tor');return true;}}};
 return {ns,bought,files};
}
test('program purchases recheck the wallet after each purchase and protect the seed',async()=>{
 const a=purchasing();await programs(a.ns);assert.equal(a.bought.length,1);
 const b=purchasing({money:300000});await programs(b.ns);assert.equal(b.bought.length,0);
});
test('TOR can spend exactly the available surplus but cannot consume the reserve',async()=>{
 for(const [money,count]of [[300000,0],[499999,0],[500000,1]]){
  const a=purchasing({money});a.ns.getScriptName=()=> 'Tasks/tor-manager.js';await tor(a.ns);assert.equal(a.bought.length,count);
 }
});
test('infrastructure purchases obey pauses, maintenance, achievement protections and missing APIs',async()=>{
 for(const opt of [{paused:true},{challenge:true},{maintenance:true}])for(const action of [programs,tor]){
  const a=purchasing(opt);a.ns.getScriptName=()=>action===programs?'Tasks/program-manager.js':'Tasks/tor-manager.js';
  await action(a.ns);assert.deepEqual(a.bought,[]);
 }
 for(const action of [programs,tor]){const a=purchasing();a.ns.singularity={};await action(a.ns);assert.deepEqual(a.bought,[]);}
});
test('daemon has one supervised Hacknet configuration and no periodic competitors',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.equal((s.match(/name: "hacknet-upgrade-manager.js"/g)||[]).length,1);
 assert.match(s,/--adaptive-tiers/);assert.doesNotMatch(s,/serverRamAvailable -= homeReservedRam/);
});
test('actual periodic scheduler wakes infrastructure on growing cash without waking unrelated tools',async()=>{
 const s=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 const start=s.indexOf('    async function runPeriodicScripts('),end=s.indexOf('    async function tryRunTool(',start);
 // Exclude the documentation immediately before the next declaration.
 const body=s.slice(start,end);const periodicScripts=[{name:'tor',interval:25000,infrastructure:true,lastRun:98000,lastCashBand:0},{name:'other',interval:30000,lastRun:98000}];
 const launched=[],context={periodicScripts,Date:{now:()=>100000},infrastructureCashBand,infrastructureAffordable,torProgramsHandoff,resetInfo:{},getPlayerMoney:()=>1e10,
  tryRunTool:async(ns,tool)=>{launched.push(tool.name);return true;},getTool:s=>s,dictSourceFiles:{},options:{}};
 // The slice ends in an open documentation comment, so retain only the balanced function body.
 const close=body.lastIndexOf('    }');vm.runInNewContext(body.slice(0,close+5)+';globalThis.run=runPeriodicScripts;',context);
 await context.run({read:()=>'',sleep:async()=>{}});assert.deepEqual(launched,['tor']);
 launched.length=0;await context.run({read:()=>'',sleep:async()=>{}});assert.deepEqual(launched,[]);
});
test('actual autopilot wires minimal funding startup before normal managers',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(s,/if\(casinoSeedPending\)\{\s*await checkOnRunningScripts\(ns,player,true\)/);
 const bootstrap=s.indexOf('if(bootstrapOnly)return;'),optional=s.indexOf('const priorityManagers =');assert.ok(bootstrap>0&&bootstrap<optional);
 assert.match(s,/bootstrapOnly[\s\S]*--initial-max-targets/);
 assert.match(s,/--initial-study-time',0,'--initial-hack-xp-time',0/);
});

test('casino funding postpones the Stanek launch that would reserve all home RAM',async()=>{
 const s=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(s,/if \(!bootstrapOnly && homeRam >= 128 && !stanekLaunched/);
});
test('consolidated upgrade polling buys a bounded burst before yielding',async()=>{
 const s=await readFile(new URL('../hacknet-upgrade-manager.js',import.meta.url),'utf8');
 const start=s.indexOf('export async function main('),end=s.indexOf('let lastUpgradeLog',start);
 let purchases=0,yieldCount=null;const stop=new Error('stop after first poll');
 const context={argsSchema:[],isScriptPaused:()=>false,getConfiguration:()=>({c:true,interval:1000,'adaptive-tiers':true,'max-spend':1000,'max-payoff-time':'1h'}),
  tryGetBitNodeMultipliers:async()=>({HacknetNodeMoney:1}),hacknetOptionsError:()=>null,registerAutomation(){},automationHeartbeat(){},maintenanceRequested:()=>false,
  disableLogs(){},setStatus(){},formatDuration:String,formatMoney:String,upgradeHacknet:()=>{purchases++;return 1;}};
 vm.runInNewContext(s.slice(start,end).replace('export async function','async function')+';globalThis.run=main;',context);
 await assert.rejects(context.run({getScriptName:()=> 'hacknet-upgrade-manager.js',hacknet:{numNodes:()=>0},sleep:async()=>{yieldCount=purchases;throw stop;}}),error=>error===stop);
 assert.equal(yieldCount,10);
});
