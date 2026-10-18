import {controllerReloadBlocked} from '../runtime-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseNodeRoute} from '../node-route-selection-policy.js';
import {hackingDrainActive,hackingWorker,hackingLoopWorker,advanceHackingDrain,hackingLoopShouldStop,coordinateHackingDrain} from '../hacking-drain-policy.js';
import {sleeveAugmentedOutput,sleeveAugRecoveryPlan,sleeveCombatWorkers} from '../sleeve-development-policy.js';
import {main as hack} from '../Remote/hack-target.js';
import {main as grow} from '../Remote/grow-target.js';
import {main as weak} from '../Remote/weak-target.js';
const context={now:1000000,augReset:2,nodeReset:1,node:9};
const previous={at:999000,augReset:2,nodeReset:1,selected:'hacking',policy:'measured'};
const known=(lowerMs,upperMs)=>({actionable:true,lowerMs,upperMs});
test('brief forecast gaps retain a fresh measured route and disclose the hold',()=>{
 const p=chooseNodeRoute({},previous,context);assert.equal(p.selected,'hacking');assert.equal(p.policy,'measured-hold');assert.equal(p.lastComparableAt,999000);assert.match(p.reason,/brief forecast gap/);
});
test('frequent unknown forecasts cannot extend the two-minute hold indefinitely',()=>{
 let p=previous;for(let t=1000000;t<=1090000;t+=30000)p=chooseNodeRoute({},p,{...context,now:t});
 p=chooseNodeRoute({},p,{...context,now:1120000});assert.equal(p.selected,'bladeburner');assert.equal(p.policy,'bn-default');
});
test('route availability, overrides and reset boundaries outrank a measured hold',()=>{
 assert.equal(chooseNodeRoute({},previous,{...context,availability:{hacking:false,bladeburner:true}}).selected,'bladeburner');
 assert.equal(chooseNodeRoute({},previous,{...context,override:'bb'}).selected,'bladeburner');
 assert.equal(chooseNodeRoute({},previous,{...context,augReset:3}).selected,'bladeburner');
 assert.equal(chooseNodeRoute({},previous,{...context,now:1100000}).selected,'bladeburner');
});
test('returning comparable forecasts resume measured policy and normal switch confirmation',()=>{
 const held=chooseNodeRoute({},previous,context),p=chooseNodeRoute({hacking:known(1,2),bladeburner:known(100,200)},held,{...context,now:1030000});
 assert.equal(p.selected,'hacking');assert.equal(p.policy,'measured');assert.equal(p.lastComparableAt,1030000);
});
const reset={lastNodeReset:1,lastAugReset:2},meta={nodeReset:1,augReset:2,drainProtocol:1};
function worker(pid,host,tool,loop=true,owner=7,protocol=true){return {pid,host,filename:'Remote/'+(tool==='weak'?'weak-target':tool+'-target')+'.js',threads:1,args:['n',1000,100,'XP',...(tool==='weak'?[]:[false]),true,loop,owner,JSON.stringify({...meta,drainProtocol:protocol?1:0})]};}
function drainFixture(){
 const files=new Map(),remote=new Map(),copies=[];let workers=[worker(1,'home','hack'),worker(2,'alpha','grow'),worker(3,'alpha','weak')],badHost=null,copyOk=true;
 files.set('tasks/home-ram-reclaim.json',JSON.stringify({at:1000,ownerPid:99,satisfied:false,target:50}));
 const ns={pid:7,read:f=>files.get(f)||'',write:async(f,s)=>files.set(f,s),isRunning:()=>true,getServerMaxRam:()=>100,getServerUsedRam:()=>100,
  ps:host=>{if(host===badHost)throw Error('offline');return workers.filter(p=>p.host===host);},scp:async(f,host)=>{copies.push(host);if(copyOk)remote.set(host,JSON.parse(files.get(f)));return copyOk;}};
 return {ns,files,remote,copies,setWorkers:w=>workers=w,setBadHost:h=>badHost=h,setCopyOk:v=>copyOk=v};
}
test('worker parsing distinguishes finite work, loops, ownership and weak argument positions',()=>{
 for(const tool of ['hack','grow','weak']){const p=worker(1,'home',tool);assert.equal(hackingLoopWorker(p).owner,7);assert.equal(hackingLoopWorker({...p,args:p.args.map((a,i)=>i===(tool==='weak'?5:6)?false:a)}),null);}
 assert.equal(hackingWorker(worker(1,'home','hack',false)).loop,false);assert.equal(hackingWorker(worker(1,'home','hack',true,0)),null);
});
test('cross-host drain stops attacks before grow and weaken, then acknowledges remote clearing',async()=>{
 const f=drainFixture();let p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.targets.n.stage,'attack');assert.equal(f.remote.get('alpha').targets.n.stage,'attack');
 f.setWorkers([worker(2,'alpha','grow'),worker(3,'alpha','weak')]);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,2000);assert.equal(p.targets.n.stage,'grow');
 f.setWorkers([worker(3,'alpha','weak')]);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,3000);assert.equal(p.targets.n.stage,'weaken');
 f.setWorkers([]);f.files.set('tasks/home-ram-reclaim.json',JSON.stringify({at:4000,ownerPid:99,satisfied:true,target:50}));p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,4000);
 assert.deepEqual(p.completed,['n']);assert.deepEqual(p.targets,{});assert.equal(f.remote.get('alpha').targets.n.stage,'clearing');
});
test('finite attacks in the same target prevent prematurely stopping recovery loops',async()=>{
 const f=drainFixture();await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);
 f.setWorkers([worker(8,'alpha','hack',false),worker(2,'alpha','grow'),worker(3,'alpha','weak')]);
 const p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,2000);assert.equal(p.targets.n.stage,'attack');
});
test('missing server snapshots and failed copies cannot acknowledge completed drains',async()=>{
 const f=drainFixture();await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);f.setWorkers([]);f.setBadHost('alpha');
 let p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,2000);assert.equal(p.targets.n.stage,'attack');assert.equal(p.incomplete,true);
 f.setBadHost(null);f.files.set('tasks/hgw-drain-7.json',JSON.stringify({...p,targets:{n:{stage:'weaken',stageAt:1000,hosts:['home','alpha']}}}));f.files.delete('tasks/home-ram-reclaim.json');f.setCopyOk(false);
 p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,3000);assert.equal(p.targets.n.stage,'clearing');assert.deepEqual(p.copyErrors,['alpha']);
 f.setCopyOk(true);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,4000);assert.deepEqual(p.targets,{});
});
test('foreign owners, unsupported old looping workers and expired pressure are not interrupted',async()=>{
 const f=drainFixture();f.setWorkers([worker(1,'home','hack',true,8),worker(2,'home','hack',true,7,false)]);
 let p=await coordinateHackingDrain(f.ns,['home'],reset,1000);assert.equal(p.unsupported,1);assert.deepEqual(p.targets,{});
 p=await coordinateHackingDrain(f.ns,['home'],reset,40000);assert.equal(p,null);
});
test('worker drain guards are scoped to owner, target and both reset epochs',()=>{
 const plan={ownerPid:7,nodeReset:1,augReset:2,targets:{n:{stage:'attack',stageAt:1000}}},ns={read:()=>JSON.stringify(plan)};
 assert.equal(hackingLoopShouldStop(ns,7,'n','hack',0,meta),true);
 for(const [owner,target,m]of [[8,'n',meta],[7,'other',meta],[7,'n',{...meta,augReset:3}]])assert.equal(hackingLoopShouldStop(ns,owner,target,'hack',0,m),false);
 assert.equal(hackingLoopShouldStop({read:()=>'{bad'},7,'n','hack',0,meta),false);
});
test('grow and weaken must complete recovery after the relevant phase began',()=>{
 const plan={ownerPid:7,nodeReset:1,augReset:2,targets:{n:{stage:'grow',stageAt:1000}}},ns={read:()=>JSON.stringify(plan)};
 assert.equal(hackingLoopShouldStop(ns,7,'n','grow',1000,meta),false);assert.equal(hackingLoopShouldStop(ns,7,'n','grow',1001,meta),true);
 assert.equal(hackingLoopShouldStop(ns,7,'n','weaken',2000,meta),false);plan.targets.n.stage='weaken';assert.equal(hackingLoopShouldStop(ns,7,'n','weaken',1001,meta),true);
});
test('native worker implementations finish their current operation before stopping at a drain boundary',async()=>{
 for(const [main,tool] of [[hack,'hack'],[grow,'grow'],[weak,'weak']]){
  let calls=0,plan=tool==='hack'?null:{ownerPid:7,nodeReset:1,augReset:2,targets:{n:{stage:tool==='weak'?'weaken':'grow',stageAt:1}}};
  const ns={args:worker(1,'home',tool).args,isRunning:()=>calls<3,read:()=>JSON.stringify(plan),print(){},toast(){},getHackTime:()=>1,getGrowTime:()=>1,getWeakenTime:()=>1,
   [tool==='weak'?'weaken':tool]:async()=>{calls++;plan={ownerPid:7,nodeReset:1,augReset:2,targets:{n:{stage:tool==='hack'?'attack':tool==='weak'?'weaken':'grow',stageAt:1}}};return tool==='grow'?2:1;}};
  await main(ns);assert.equal(calls,1,tool);
 }
});
test('copied worker guards stay identical to the tested policy without remote imports',()=>{
 const helper=hackingLoopShouldStop.toString().replace(/\r\n/g,'\n');
 for(const name of ['hack','grow','weak','manualhack']){const source=readFileSync(new URL('../Remote/'+name+'-target.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');assert.ok(source.includes(helper));}
});

const sleeve=(shock=1)=>({shock,sync:100,skills:{strength:100,defense:100,dexterity:100,agility:100,intelligence:0},exp:{strength:1e6},mults:{strength:1,strength_exp:1,crime_success:1}});
const crimes={Mug:{time:1000,difficulty:100,strength_success_weight:1,strength_exp:100}};
test('augmentation projection includes native XP reset and discounts incomplete crimes',()=>{
 const strong=sleeve(0),unaug=sleeveAugmentedOutput(strong,{},crimes,60),aug=sleeveAugmentedOutput(strong,{strength_exp:3},crimes,60);
 assert.ok(aug>unaug);assert.equal(strong.exp.strength,1e6);assert.equal(sleeveAugmentedOutput(strong,{strength_exp:3},crimes,.1),0);
});
test('augmentation recovery planning credits only known, affordable offers with shared budget',()=>{
 const sleeves=[sleeve(),sleeve()],offers=[[{name:'XP',cost:100,stats:{strength_exp:5}}],[{name:'XP',cost:100,stats:{strength_exp:5}}]],observation={sleeves:[{rate:.01},{rate:.01}]};
 const plan=sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,100);assert.equal(Object.keys(plan).length,1);assert.equal(Object.values(plan)[0].cost,100);assert.equal(Object.values(plan)[0].resetXp,true);
 for(const budget of [0,-1,NaN,Infinity,99])assert.deepEqual(sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,budget),{});
 assert.deepEqual(sleeveAugRecoveryPlan(sleeves,[[{name:'Unknown',cost:1}]],crimes,observation,100),{});
});
test('augmentation cooldowns, long recovery and explicit minimum batches bound projected benefits',()=>{
 const sleeves=[sleeve()],observation={sleeves:[{rate:.01}]},offers=[[{name:'XP',cost:100,stats:{strength_exp:5}},{name:'x',cost:1000,stats:{}},{name:'y',cost:2000,stats:{}}]];
 assert.deepEqual(sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,100,1,null,900,{cooldowns:[1000]}),{});
 assert.deepEqual(sleeveAugRecoveryPlan(sleeves,offers,crimes,observation,100,1,null,900,{minBatch:2}),{});
 assert.deepEqual(sleeveAugRecoveryPlan(sleeves,offers,crimes,{sleeves:[{rate:.0001}]},100),{});
});
test('an affordable augmentation benefit can change a shocked sleeve from XP work to recovery',()=>{
 const sleeves=[sleeve(.1),sleeve(1)],observation={sleeves:[{rate:.001},{rate:.001}]};
 const before=sleeveCombatWorkers(sleeves,crimes,[],1,null,observation);assert.equal(before.length,1);
 const after=sleeveCombatWorkers(sleeves,crimes,[],1,null,observation,900,{1:{output:1e20}});assert.deepEqual(after,[]);
});

test('drain snapshots are throttled and unchanged commands are not recopied every scheduler iteration',async()=>{
 const f=drainFixture();await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);const copies=f.copies.length;
 await coordinateHackingDrain(f.ns,['home','alpha'],reset,1500);await coordinateHackingDrain(f.ns,['home','alpha'],reset,2000);assert.equal(f.copies.length,copies);
});
test('remote daemon hosts do not publish drain files from the wrong source server',async()=>{
 const f=drainFixture();f.ns.getHostname=()=> 'alpha';assert.equal(await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000),null);assert.deepEqual(f.copies,[]);
});
test('active drain ownership protects daemon reloads until all recovery phases finish',()=>{
 const record={at:1000,ownerPid:7,nodeReset:1,augReset:2,targets:{n:{stage:'grow'}}},processes=[{pid:7,filename:'daemon.js'}];
 assert.equal(hackingDrainActive(record,reset,processes,2000),true);
 for(const patch of [{augReset:3},{ownerPid:8},{targets:{}},{targets:{n:{stage:'clearing'}}}])assert.equal(hackingDrainActive({...record,...patch},reset,processes,2000),false);
 const source=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');assert.ok(source.includes('protectedWork:reloadBlocked(script)'));assert.equal(controllerReloadBlocked('daemon.js',{drainProtected:true}),true);assert.ok(source.includes('filter(job=>!drainProtected'));
});

test('recovery waits for one crime completion rather than waiting forever for zero residual cycles',()=>{
 const sleeves=[sleeve(.1),sleeve(1)],observation={sleeves:[{rate:.001},{rate:.001}]},holds={},task={type:'CRIME',crimeType:'Mug',cyclesWorked:3,cyclesNeeded:20,tasksCompleted:10};
 let workers=sleeveCombatWorkers(sleeves,crimes,[null,task],1,null,observation,900,{1:{output:1e20}},holds);
 assert.equal(workers[0].finishingBeforeRecovery,true);task.cyclesWorked=8;
 workers=sleeveCombatWorkers(sleeves,crimes,[null,task],1,null,observation,900,{1:{output:1e20}},holds);assert.equal(workers.length,1);
 task.cyclesWorked=3;task.tasksCompleted=11;
 workers=sleeveCombatWorkers(sleeves,crimes,[null,task],1,null,observation,900,{1:{output:1e20}},holds);assert.deepEqual(workers,[]);assert.deepEqual(holds,{});
});
test('recovery offer snapshots deduplicate augmentation-stat queries across sleeves',()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8'),start=source.indexOf("'(()=>{const offers=Array.from");assert.ok(start>=0);
 const query=source.slice(start+1,source.indexOf("'",start+1));let calls=0;
 const ns={args:[2],sleeve:{getSleevePurchasableAugs:()=>[{name:'XP',cost:100}]},singularity:{getAugmentationStats:()=>{calls++;return {strength_exp:2};}}};
 const result=new Function('ns','return '+query)(ns);assert.equal(calls,1);assert.equal(result[1][0].stats.strength_exp,2);
});

test('pressure needing several targets drains them sequentially while completed targets remain blocked',async()=>{
 const f=drainFixture(),second=worker(4,'home','hack');second.args[0]='second';
 f.setWorkers([worker(1,'home','hack'),second]);let p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.targets.n.stage,'attack');
 f.setWorkers([second]);
 for(const at of [2000,3000,4000])p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,at);
 assert.equal(p.targets.n.stage,'complete');
 p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,5000);assert.equal(p.targets.n.stage,'complete');assert.equal(p.targets.second.stage,'attack');
});

test('stock cleanup cannot kill recovery legs while the drain coordinator owns their shutdown',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    async function terminateScriptsManipulatingStock('),end=source.indexOf('        const processes=',start),prefix=source.slice(start,end);
 const filter=prefix.slice(prefix.indexOf('        servers='));
 const run=new Function('servers','hackingDrain',filter+';return servers;');
 assert.deepEqual(run(['n','other'],{targets:{n:{stage:'grow'}}}),['other']);assert.equal(run(['n'],{targets:{n:{stage:'weaken'}}}),undefined);
});
