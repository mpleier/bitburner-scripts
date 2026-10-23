import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {collectHackingIncome} from '../hacking-income-policy.js';
import {collectHgwTelemetry} from '../hgw-telemetry-policy.js';
import {hackingProcessInventory} from '../hacking-process-policy.js';
import {hashSpendingDecision,spendHashesWithPolicy} from '../hash-spending-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
function fixture(){
 const files={},player={skills:{hacking:500},mults:{hacking_money:1}},server={moneyMax:1e9,minDifficulty:2};
 let money=0,completions=0,risks=0;
 const ns={pid:7,read:f=>files[f]||'',write:(f,s)=>files[f]=s,getPlayer:()=>player,getServer:()=>server,
  getResetInfo:()=>reset,ps:()=>[{pid:7,filename:'daemon.js',args:[]}],scan:()=>[],getScriptRam:()=>2,weakenAnalyze:()=>.05,
  hacknet:{numHashes:()=>1000,hashCapacity:()=>2000,hashCost:()=>4},
  formulas:{hacking:{hackPercent:()=>.01,hackChance:()=>1,weakenTime:()=>10000,growThreads:()=>10}}};
 const inventory={complete:true,allocations:{target:{ram:200,manual:false}}};
 const sample=(at,extra={})=>{
  money+=200000;completions+=2;
  files['tasks/hgw-misfires.json']=JSON.stringify({at,ownerPid:7,nodeReset:1,augReset:2,blocked:false,income:{'[7,"target"]':{at,money,completions,risks}}});
  return collectHackingIncome(ns,reset,7,inventory,at,...(extra.lag===undefined?[]:[extra.lag]));
 };
 const warm=()=>{let s;for(let i=0;i<=24;i++)s=sample(1000+i*5000);return s;};
 return {ns,files,player,server,inventory,sample,warm,setRisks:v=>risks=v};
}
test('income windows measure actual receipts per allocated RAM-second after sufficient evidence',()=>{
 const f=fixture(),s=f.warm(),r=s.targets.target;
 assert.equal(r.durationSeconds,120);assert.equal(r.completions,48);assert.equal(r.incomePerRamSecond,200);
 assert.equal(r.risks,0);assert.match(s.basis,/not causal/);
});

test('combat and social progression preserve completed and accumulating income windows',()=>{
 const f=fixture();let s;
 for(let i=0;i<=24;i++){
  f.player.skills.strength=i;f.player.skills.defense=i;f.player.skills.dexterity=i;f.player.skills.agility=i;f.player.skills.charisma=i;
  f.player.mults.strength=1+i/100;f.player.mults.faction_rep=1+i/100;
  s=f.sample(1000+i*5000);
 }
 assert.equal(s.targets.target.measuredAt,121000);assert.equal(s.targets.target.incomePerRamSecond,200);
 const before=s.targets.target;f.player.skills.strength++;
 const after=f.sample(126000).targets.target;
 assert.equal(after.measuredAt,before.measuredAt);assert.equal(after.continuitySignature,before.continuitySignature);
 assert.notEqual(after.signature,before.signature);
 assert.equal(after.signature,JSON.stringify([f.server.moneyMax,f.server.minDifficulty,f.player.skills,f.player.mults,[],null]));
});

test('hacking intelligence and all hacking multipliers invalidate income continuity',()=>{
 for(const key of ['hacking','intelligence']){
  const f=fixture();f.warm();f.player.skills[key]=(f.player.skills[key]||0)+1;
  assert.equal(f.sample(126000).targets.target.measuredAt,undefined,key);
 }
 for(const key of ['hacking','hacking_exp','hacking_chance','hacking_speed','hacking_money','hacking_grow','hacking_future']){
  const f=fixture();f.warm();f.player.mults[key]=(f.player.mults[key]||1)+.01;
  assert.equal(f.sample(126000).targets.target.measuredAt,undefined,key);
 }
});

test('legacy income rows rewarm and multiplier key order cannot disrupt continuity',()=>{
 const legacy=fixture();legacy.warm();const saved=JSON.parse(legacy.files['tasks/hacking-income.json']);
 delete saved.targets.target.continuitySignature;legacy.files['tasks/hacking-income.json']=JSON.stringify(saved);
 assert.equal(legacy.sample(126000).targets.target.measuredAt,undefined);
 const ordered=fixture();ordered.player.mults={hacking_money:1,hacking_speed:1};ordered.warm();
 ordered.player.mults={hacking_speed:1,hacking_money:1};
 assert.equal(ordered.sample(126000).targets.target.measuredAt,121000);
});

test('retained combat-era income remains usable by serialized hash calibration with a fresh full signature',()=>{
 const f=fixture(),now=Date.now();
 f.ns.ps=()=>[{pid:7,filename:'daemon.js',args:[]},{filename:'Remote/hack-target.js',threads:100,args:['target',0,0,0,0,0,0,7]}];
 f.ns.getPlayer=()=>({...f.player,money:1e12});
 f.files['/Temp/analyze-hack.txt']=JSON.stringify([{hostname:'target',gainRate:100000}]);
 f.files['/Temp/analyze-hack-meta.txt']=JSON.stringify({at:now,augReset:2,nodeReset:1});
 for(let i=0;i<=24;i++)f.sample(now-125000+i*5000);
 f.player.skills.strength=100;const row=f.sample(now).targets.target;assert.equal(row.measuredAt,now-5000);
 const decide=Function('return ('+hashSpendingDecision.toString()+')')();
 let d=decide(f.ns,'Increase Maximum Money',{target:'target'});
 assert.equal(d.serverProjection.calibration.observation.incomePerRamSecond,200);
 assert.equal(d.serverProjection.calibration.factor,.002);
 f.player.skills.intelligence=1;
 d=decide(f.ns,'Increase Maximum Money',{target:'target'});assert.equal(d.serverProjection.calibration.observation,null);
});

test('serialized income collector retains continuity across combat progression without imported helpers',()=>{
 const f=fixture();f.warm();f.player.skills.agility=123;
 const record=JSON.parse(f.files['tasks/hgw-misfires.json']);record.at=126000;
 f.files['tasks/hgw-misfires.json']=JSON.stringify(record);
 const collect=Function('return ('+collectHackingIncome.toString()+')')();
 assert.equal(collect(f.ns,reset,7,f.inventory,126000).targets.target.measuredAt,121000);
});
test('income samples invalidate on player, server, owner, allocation, gaps, risks, counters and incomplete evidence',()=>{
 for(const change of [f=>f.player.skills.hacking++,f=>f.server.moneyMax++,f=>f.inventory.allocations.target.ram*=2,f=>f.setRisks(1),f=>f.files["tasks/hgw-pacing.json"]=JSON.stringify({pid:7,at:126000,cycleMs:2000,queueMs:500,targetCap:1}),f=>f.inventory.complete=false,f=>f.inventory.allocations.target.manual=true]){
  const f=fixture();assert.ok(f.warm().targets.target.measuredAt);change(f);
  assert.equal(f.sample(126000).targets.target?.measuredAt,undefined);
 }
 const gap=fixture();gap.warm();assert.equal(gap.sample(150000).targets.target.measuredAt,undefined);
 const lag=fixture();lag.warm();assert.deepEqual(lag.sample(126000,{lag:300}).targets,{});
 const owner=fixture();owner.warm();assert.deepEqual(collectHackingIncome(owner.ns,reset,8,owner.inventory,126000).targets,{});
 const node=fixture();node.warm();assert.deepEqual(collectHackingIncome(node.ns,{...reset,lastNodeReset:3},7,node.inventory,126000).targets,{});
 const back=fixture();back.warm();const t=JSON.parse(back.files['tasks/hgw-misfires.json']);t.income['[7,"target"]'].money=1;t.at=126000;back.files['tasks/hgw-misfires.json']=JSON.stringify(t);
 assert.equal(collectHackingIncome(back.ns,reset,7,back.inventory,126000).targets.target.measuredAt,undefined);
});
test('all worker reporters preserve owner income; collector merges without double counting',()=>{
 let queue='NULL PORT DATA';const files={};
 const ns={read:f=>files[f]||'',write:(f,s)=>files[f]=s,print(){},toast(){},getPortHandle:()=>({peek:()=>queue,read:()=>{const q=queue;queue='NULL PORT DATA';return q;},write:s=>queue=s})};
 for(const [i,file]of ['Remote/hack-target.js','Remote/grow-target.js','Remote/weak-target.js'].entries()){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8'),report=vm.runInNewContext(source.slice(source.indexOf('function report('))+';report');
  report(ns,{port:20,augReset:2,nodeReset:1},{owner:7,at:1000+i,tool:i?'grow':'hack',target:'target',value:100,lateMs:0,toleranceMs:100,outcome:'effect'},true);
 }
 collectHgwTelemetry(ns,reset,7,2000);collectHgwTelemetry(ns,reset,7,8000);
 const income=JSON.parse(files['tasks/hgw-misfires.json']).income['[7,"target"]'];assert.equal(income.money,100);assert.equal(income.completions,1);
});
test('allocation inventory attributes weak owner correctly, includes manual marker and tolerates missing hosts',()=>{
 const ps=[{filename:'Remote/hack-target.js',threads:10,args:['target',0,0,0,0,0,0,7]},
  {filename:'Remote/weak-target.js',threads:5,args:['target',0,0,0,0,0,7]},
  {filename:'Remote/manualhack-target.js',threads:1,args:['other',0,0,0,0,0,0,7]},
  {filename:'Remote/grow-target.js',threads:100,args:['target',0,0,0,0,0,0,99]}];
 const ns={ps:()=>ps,getScriptRam:()=>2};const inv=hackingProcessInventory(ns,['home'],7);
 assert.equal(inv.workers,4);assert.equal(inv.allocations.target.ram,30);assert.equal(inv.allocations.other.manual,true);
 ns.getScriptRam=()=>NaN;assert.equal(hackingProcessInventory(ns,['home'],7).complete,false);
});
test('serialized hash decision applies only fresh qualified downward throughput calibration',()=>{
 const f=fixture(),now=Date.now();let value=100;
 f.ns.ps=()=>[{pid:7,filename:'daemon.js',args:[]},{filename:'Remote/hack-target.js',threads:100,args:['target',0,0,0,0,0,0,7]}];
 f.ns.getPlayer=()=>({...f.player,money:1e12});
 f.files['/Temp/analyze-hack.txt']=JSON.stringify([{hostname:'target',gainRate:100000}]);
 f.files['/Temp/analyze-hack-meta.txt']=JSON.stringify({at:now,augReset:2,nodeReset:1});
 const sample={signature:JSON.stringify([1e9,2,f.player.skills,f.player.mults,[],null]),measuredAt:now,durationSeconds:120,completions:30,risks:0,ram:200,incomePerRamSecond:value};
 const save=(patch={})=>f.files['tasks/hacking-income.json']=JSON.stringify({version:1,at:now,ownerPid:7,nodeReset:1,augReset:2,targets:{target:{...sample,...patch}}});
 const decide=Function('return ('+hashSpendingDecision.toString()+')')();save();
 let d=decide(f.ns,'Increase Maximum Money',{target:'target'});assert.equal(d.serverProjection.calibration.factor,.001);assert.equal(d.allowed,false);
 save({incomePerRamSecond:1e9});d=decide(f.ns,'Increase Maximum Money',{target:'target'});assert.equal(d.serverProjection.calibration.factor,1);
 for(const patch of [{measuredAt:now+10000},{measuredAt:now-600001},{completions:29},{durationSeconds:119},{risks:1},{ram:20},{signature:'bad'},{incomePerRamSecond:-1}]){
  save(patch);d=decide(f.ns,'Increase Maximum Money',{target:'target'});assert.equal(d.serverProjection.calibration.observation,null,JSON.stringify(patch));
 }
});
test('successful upgrade journal is bounded and write errors do not retry native spending',()=>{
 const f=fixture();let purchases=0;f.ns.hacknet.spendHashes=()=>{purchases++;return true;};
 f.files['tasks/hash-server-upgrades.json']=JSON.stringify({nodeReset:1,augReset:2,entries:Array.from({length:32},()=>({at:1}))});
 const spend=Function('return ('+spendHashesWithPolicy.toString()+')')();
 const decide=()=>({allowed:true,budget:100,serverProjection:{calibration:{factor:.5}}});
 assert.equal(spend(f.ns,'Increase Maximum Money','target',1,{},decide).success,true);
 assert.equal(JSON.parse(f.files['tasks/hash-server-upgrades.json']).entries.length,32);
 const write=f.ns.write;f.ns.write=(file,s)=>{if(file==='tasks/hash-server-upgrades.json')throw Error('disk');return write(file,s);};
 assert.equal(spend(f.ns,'Increase Maximum Money','target',1,{},decide).success,true);assert.equal(purchases,2);
});
test('upgrade comparisons wait for retuning and require unchanged player context',()=>{
 const f=fixture();f.warm();
 f.files['tasks/hash-server-upgrades.json']=JSON.stringify({nodeReset:1,augReset:2,entries:[{at:122000,target:'target',action:'Increase Maximum Money',moneyMax:2e9,minDifficulty:2,
  projection:{relative:.02,retuneSeconds:10,calibration:{context:JSON.stringify([f.player.skills,f.player.mults,[],null]),observation:{at:121000,incomePerRamSecond:200}}}}]});
 f.server.moneyMax=2e9;let s;
 for(let i=0;i<=24;i++)s=f.sample(126000+i*5000);
 assert.equal(s.targets.target.upgradeComparison,undefined);
 for(let i=1;i<=24;i++)s=f.sample(246000+i*5000);
 assert.equal(s.targets.target.upgradeComparison.observedRelative,0);
 assert.equal(s.targets.target.upgradeComparison.projectedRelative,.02);
 assert.match(s.targets.target.upgradeComparison.basis,/not isolated causal/);
 f.player.skills.hacking++;assert.equal(f.sample(371000).targets.target.upgradeComparison,undefined);
});
test('grow/weaken timing risks invalidate owner income while never crediting growth as cash',()=>{
 let queue='NULL PORT DATA';const source=readFileSync(new URL('../Remote/grow-target.js',import.meta.url),'utf8');
 const report=vm.runInNewContext(source.slice(source.indexOf('function report('))+';report');
 const ns={getPortHandle:()=>({peek:()=>queue,read:()=>{const q=queue;queue='NULL PORT DATA';return q;},write:s=>queue=s})};
 report(ns,{port:20,augReset:2,nodeReset:1},{owner:7,at:1000,tool:'grow',target:'target',value:999,lateMs:101,toleranceMs:100},true);
 const income=JSON.parse(queue).income['[7,"target"]'];assert.equal(income.money,0);assert.equal(income.completions,0);assert.equal(income.risks,1);
});
