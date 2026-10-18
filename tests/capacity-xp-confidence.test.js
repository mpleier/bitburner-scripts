import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withHackingLoopCapacity,hackingLoopCapacity,coordinateHackingDrain} from '../hacking-drain-policy.js';
import {observeSleeveXp,incomingSleeveXp} from '../sleeve-xp-policy.js';
import {sleeveWorkOutput,planSleeveWorkAugPurchase} from '../sleeve-work-policy.js';
import {sleeveAugmentedOutput,planSleeveAugPurchase} from '../sleeve-development-policy.js';
import {stockForecastBounds,stockForecastUncertainty} from '../stock-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
function worker(pid,tool,threads,expected=threads,job=tool,target='n',host='alpha'){
 const weak=tool==='weak',args=[target,1000,100,'job',...(weak?[]:[false]),true,true,7,JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2})];
 return {pid,filename:'Remote/'+tool+'-target.js',threads,host,args:withHackingLoopCapacity(args,tool,expected,job)};
}
const workers=()=>[worker(1,'hack',6),worker(2,'grow',30,60,'g'),worker(3,'grow',30,60,'g'),worker(4,'weak',10)];
test('capacity metadata is immutable, shared across fragments and respects weak argument positions',()=>{
 const p=worker(1,'grow',30,60,'g'),m=JSON.parse(p.args[8]);assert.equal(m.expectedThreads,60);assert.equal(m.jobId,'g');assert.equal(p.args[7],7);
 const weak=worker(2,'weak',5,10,'w');assert.equal(JSON.parse(weak.args[7]).expectedThreads,10);assert.equal(weak.args[6],7);
 const args=p.args.slice(),next=withHackingLoopCapacity(args,'grow',100,'new');assert.notEqual(args,next);assert.equal(JSON.parse(args[8]).expectedThreads,60);
});
test('finite, foreign and unsupported jobs cannot acquire a loop capacity contract',()=>{
 const p=worker(1,'grow',1);p.args[6]=false;assert.equal(withHackingLoopCapacity(p.args,'grow',1,'x'),p.args);
 p.args[6]=true;p.args[7]=0;assert.equal(withHackingLoopCapacity(p.args,'grow',1,'x'),p.args);
 assert.equal(withHackingLoopCapacity([], 'custom',1,'x').length,0);
});
test('complete split jobs reconcile actual thread sums and duplicate inventory rows do not inflate them',()=>{
 const ps=workers(),r=hackingLoopCapacity([...ps,ps[1]],7,reset);assert.equal(r.damaged.length,0);assert.equal(r.jobs.g.liveThreads,60);assert.equal(r.observedGroups,3);
});
test('a surviving split fragment exposes its missing threads',()=>{
 const r=hackingLoopCapacity(workers().filter(p=>p.pid!==3),7,reset);assert.equal(r.jobs.g.liveThreads,30);assert.equal(r.jobs.g.expectedThreads,60);assert.deepEqual(r.targets,['n']);
});
test('the previous manifest detects a completely missing recovery group while target work remains',()=>{
 const prior=hackingLoopCapacity(workers(),7,reset);
 const next=hackingLoopCapacity(workers().filter(p=>p.args[8]===undefined||!p.filename.includes('grow')),7,reset,prior.jobs);
 assert.equal(next.jobs.g.liveThreads,0);assert.deepEqual(next.targets,['n']);
 assert.equal(hackingLoopCapacity([],7,reset,prior.jobs).damaged.length,0);
 assert.equal(hackingLoopCapacity(workers(),7,reset,prior.jobs,['n']).damaged.length,0);
});
test('unknown metadata stays unmeasurable and foreign owners are excluded',()=>{
 const p=worker(1,'grow',1);p.args[8]=JSON.stringify({drainProtocol:1,nodeReset:1,augReset:2});
 assert.equal(hackingLoopCapacity([p],7,reset).unknownGroups,1);assert.deepEqual(hackingLoopCapacity([p],7,reset).targets,[]);
 assert.equal(hackingLoopCapacity(workers(),9,reset).observedGroups,0);
});
function fixture(){
 const files=new Map();let ps=workers(),bad=null;
 const ns={pid:7,getHostname:()=> 'home',read:f=>files.get(f)||'',write:async(f,s)=>files.set(f,s),ps:h=>{if(h===bad)throw Error('offline');return ps.filter(p=>p.host===h);},isRunning:()=>true,scp:async()=>true};
 return {files,ns,set:v=>ps=v,bad:v=>bad=v};
}
test('capacity repair starts an owned target drain rather than killing fragments',async()=>{
 const f=fixture();let r=await coordinateHackingDrain(f.ns,['alpha'],reset,1000,{checkCapacity:true});assert.deepEqual(r.targets,{});
 f.set(workers().filter(p=>p.pid!==3));r=await coordinateHackingDrain(f.ns,['alpha'],reset,2000,{checkCapacity:true});
 assert.equal(r.targets.n.stage,'attack');assert.equal(r.targets.n.reason,'missing-loop-capacity');assert.equal(r.capacity.damaged[0].liveThreads,30);
 f.set(workers().filter(p=>![1,3].includes(p.pid)));r=await coordinateHackingDrain(f.ns,['alpha'],reset,3000,{checkCapacity:true});assert.equal(r.targets.n.stage,'grow');
});
test('failed inventory cannot replace the capacity ledger or create damage',async()=>{
 const f=fixture();await coordinateHackingDrain(f.ns,['alpha'],reset,1000,{checkCapacity:true});const ledger=f.files.get('tasks/hgw-capacity-7.json');
 f.bad('alpha');const r=await coordinateHackingDrain(f.ns,['alpha'],reset,2000,{checkCapacity:true});assert.equal(r.incomplete,true);assert.deepEqual(r.targets,{});assert.equal(f.files.get('tasks/hgw-capacity-7.json'),ledger);
});
test('damage pending on another target remains in the manifest while one target drains',async()=>{
 const f=fixture(),ps=[...workers(),...workers().map(p=>({...p,pid:p.pid+10,args:p.args.map((a,i)=>i===0?'m':i===(p.filename.includes('weak')?7:8)?JSON.stringify({...JSON.parse(a),jobId:'m-'+JSON.parse(a).jobId}):a)}))];
 f.set(ps);await coordinateHackingDrain(f.ns,['alpha'],reset,1000,{checkCapacity:true});
 f.set(ps.filter(p=>!p.filename.includes('grow')));await coordinateHackingDrain(f.ns,['alpha'],reset,2000,{checkCapacity:true});
 await coordinateHackingDrain(f.ns,['alpha'],reset,3000,{checkCapacity:true});
 const ledger=JSON.parse(f.files.get('tasks/hgw-capacity-7.json'));assert.equal(ledger.jobs['m-g'].liveThreads,0);
});
test('daemon stamps capacity once before splitting and checks it before scheduling more work',()=>{
 const s=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');
 assert.ok(s.indexOf('args=withHackingLoopCapacity')<s.indexOf('const pid = await exec(ns, tool.name, targetServer.name'));
 assert.ok(s.includes('{checkCapacity:loopingMode}'));
});
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const sleeve=(xp=0)=>({shock:0,sync:100,storedCycles:0,exp:Object.fromEntries(keys.map(k=>[k,xp])),skills:{...Object.fromEntries(keys.map(k=>[k,1])),intelligence:1},mults:Object.fromEntries([...keys,...keys.map(k=>k+'_exp'),'faction_rep'].map(k=>[k,1]))});
const tasks=[{type:'FACTION',factionName:'F',factionWorkType:'hacking'},{type:'SUPPORT'}];
function observation(){let record=null;for(let t=0;t<=60;t++)record=observeSleeveXp(record,[sleeve(t*100),sleeve(t*100)],tasks,1000+t*1000,reset,7);return record;}
test('two thirty-second windows calibrate the shared XP pool without sampling every loop as a window',()=>{
 const r=observation();assert.equal(r.samples.length,2);assert.equal(r.pool.hacking,100);assert.equal(r.observedAt,61000);
 const fresh=observeSleeveXp(r,[sleeve(6100),sleeve(6100)],tasks,62000,reset,7);assert.equal(fresh.samples.length,2);
});
test('peer XP subtracts current own work with a timing margin and is never negative',()=>{
 const r=observation(),own=Object.fromEntries(keys.map(k=>[k,40]));const incoming=incomingSleeveXp(r,sleeve(),own,reset,7,62000);
 assert.equal(incoming.hacking,56);assert.equal(incoming.strength,56);
 assert.equal(incomingSleeveXp(r,sleeve(),Object.fromEntries(keys.map(k=>[k,200])),reset,7,62000).hacking,0);
});
test('stale, reset-mismatched, owner-mismatched and malformed measurements cannot credit peer XP',()=>{
 const r=observation(),own=Object.fromEntries(keys.map(k=>[k,0]));
 for(const patch of [{pid:8},{augReset:3},{observedAt:63000},{samples:undefined}])assert.deepEqual(incomingSleeveXp({...r,...patch},sleeve(),own,reset,7,62000),{});
 assert.deepEqual(incomingSleeveXp(r,sleeve(),own,reset,7,152000),{});assert.deepEqual(incomingSleeveXp(r,{...sleeve(),shock:1},own,reset,7,62000),{});
});
test('task changes, sleeve XP resets and bonus cycles reset calibration',()=>{
 const r=observation();
 assert.equal(observeSleeveXp(r,[sleeve(6100),sleeve(6100)],[{type:'CRIME'},tasks[1]],62000,reset,7).pool,null);
 assert.equal(observeSleeveXp(r,[sleeve(0),sleeve(6100)],tasks,62000,reset,7).reason,'xp-reset-or-invalid');
 assert.equal(observeSleeveXp(r,[{...sleeve(6100),storedCycles:30},sleeve(6100)],tasks,62000,reset,7).reason,'bonus-cycles-or-unknown');
 assert.equal(observeSleeveXp(r,[sleeve(6100)],tasks.slice(0,1),62000,reset,7).pool,null);
});
test('work projections apply incoming XP only to skill rebuilding, without aug multiplication or output duplication',()=>{
 const work={objective:'reputation',rates:p=>({reputation:p.skills.hacking,hackExp:0}),externalXpPerSecond:{hacking:100},externalXpSeconds:60};
 const s=sleeve();const withPeer=sleeveWorkOutput(s,{},900,work),without=sleeveWorkOutput(s,{},900,{...work,externalXpSeconds:0});
 assert.ok(withPeer>without);assert.equal(sleeveWorkOutput(s,{hacking_exp:100},900,work),withPeer);
 const xp={objective:'xp',rates:()=>({hackExp:1}),externalXpPerSecond:{hacking:100},externalXpSeconds:60};
 assert.equal(sleeveWorkOutput(s,{},900,xp),4500);
});
test('peer XP expiry prevents extrapolating a fresh observation through the entire fifteen-minute forecast',()=>{
 const work={objective:'reputation',rates:p=>({reputation:p.skills.hacking}),externalXpPerSecond:{hacking:100}};
 assert.ok(sleeveWorkOutput(sleeve(),{},900,{...work,externalXpSeconds:900})>sleeveWorkOutput(sleeve(),{},900,{...work,externalXpSeconds:60}));
});
test('native sleeve work helper accepts serialized XP calibration while preserving guards',()=>{
 const r=observation();r.observedAt=Date.now();r.samples=r.samples.map(s=>({...s,at:Date.now()}));
 const s=sleeve(),task=tasks[0],ns={sleeve:{getSleeve:()=>s,getTask:()=>task},singularity:{getFactionFavor:()=>0},formulas:{work:{factionGains:p=>({reputation:p.skills.hacking*p.mults.faction_rep,hackExp:1})}},isRunning:()=>true,getResetInfo:()=>reset};
 const incoming=Function('return ('+incomingSleeveXp.toString()+')')();
 const p=planSleeveWorkAugPurchase(ns,0,[{name:'Rep',cost:1,stats:{faction_rep:3}}],100,{task,minBatch:1,ownerPid:7,xpObservation:r},planSleeveAugPurchase,sleeveWorkOutput,incoming);
 assert.equal(p.xpSource,'observed-peer-xp');assert.ok(Number.isFinite(p.baseline));
});
test('Wilson bounds retain uncertainty at both endpoints and narrow with more observations',()=>{
 assert.ok(stockForecastBounds(1,20).lower<1);assert.ok(stockForecastBounds(0,20).upper>0);
 assert.ok(stockForecastUncertainty(1,20)>0);assert.ok(stockForecastUncertainty(1,150)<stockForecastUncertainty(1,20));
 assert.deepEqual(stockForecastBounds(.5,0),{lower:0,upper:1});assert.equal(stockForecastUncertainty(NaN,10),1);
});
test('endpoint-safe uncertainty is symmetric and never creates a contrary trading direction',()=>{
 for(let n=1;n<=150;n++)for(let i=0;i<=20;i++){
  const p=i/20,b=stockForecastBounds(p,n),mirror=stockForecastBounds(1-p,n);
  assert.ok(b.lower<=p+1e-12&&b.upper>=p-1e-12);assert.ok(Math.abs(b.lower-(1-mirror.upper))<1e-12);
  const edge=Math.max(0,Math.abs(p-.5)-stockForecastUncertainty(p,n));assert.ok(edge<=Math.abs(p-.5)+1e-12);
 }
});
test('4S remains native and checkpoint restoration recomputes the same estimated confidence model',()=>{
 const s=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8'),p=readFileSync(new URL('../stock-policy.js',import.meta.url),'utf8');
 assert.ok(s.includes('if (!has4s) {'));assert.ok(s.includes('stk.probStdDev = stockForecastUncertainty('));
 assert.ok(p.includes('const probStdDev=stockForecastUncertainty('));
});

test('damaged groups beyond the persistence bound stay visible and are retained first',()=>{
 const ps=Array.from({length:2050},(_,i)=>worker(i+1,'grow',10,10,'g'+i));ps[2049].threads=5;
 const p=hackingLoopCapacity(ps,7,reset);assert.equal(p.observedGroups,2050);assert.equal(p.untrackedGroups,2);
 assert.equal(p.jobs.g2049.liveThreads,5);assert.equal(p.damaged[0].jobId,'g2049');
});
test('reset-incompatible loops cannot strand a new recovery drain',async()=>{
 const f=fixture(),ps=workers().filter(p=>p.pid!==3);ps[0].args[8]=JSON.stringify({...JSON.parse(ps[0].args[8]),augReset:99});f.set(ps);
 const p=await coordinateHackingDrain(f.ns,['alpha'],reset,1000,{checkCapacity:true});assert.deepEqual(p.targets,{});assert.equal(p.unsupported,1);
});
test('zero-XP post-install crime stats use native level multipliers immediately',()=>{
 const s=sleeve(),c={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:0,money:100}};
 const base=sleeveAugmentedOutput(s,{},c,1,1,null,true,'money'),boosted=sleeveAugmentedOutput(s,{strength:100},c,1,1,null,true,'money');
 assert.ok(boosted>base*10);
});
test('peer XP can rebuild crime skills but is not counted as this sleeve own earnings',()=>{
 const s=sleeve(),c={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:0,money:100}};
 const plain=sleeveAugmentedOutput(s,{},c,60,1,null,true,'money');
 const helped=sleeveAugmentedOutput(s,{},c,60,1,{externalXpPerSecond:{strength:1000},externalXpSeconds:30},true,'money');
 assert.ok(helped>plain);assert.equal(sleeveAugmentedOutput(s,{},c,60,1,{externalXpPerSecond:{strength:1000},externalXpSeconds:0},true,'money'),plain);
});
