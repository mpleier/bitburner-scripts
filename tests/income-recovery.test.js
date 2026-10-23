import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createXpCapacityRecord} from '../xp-capacity-policy.js';
import {qualifiedRecoveryIncome,observeIncomeRecovery,incomeRecoveryQuote} from '../income-recovery-policy.js';
import {progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
const minute=60000,reset={lastNodeReset:1,lastAugReset:2};
function fixture(r,now,measuredAt=now,rate=100,ownerPid=7){
 const xpCapacity=createXpCapacityRecord({ownerPid,reset:r,now,mode:'income',hosts:[{host:'home',maxRam:64,usableRam:32,cores:1}],targets:['n00dles']});
 return {snapshot:{nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at:now,xpMode:'income',xpCapacity,hackingIncomeFactors:[1,1,1,1,1]},
  income:{version:1,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,at:now,ownerPid,targets:{n00dles:{signature:JSON.stringify([1e9,1,{}, {},[],null]),measuredAt,durationSeconds:120,completions:60,risks:0,incomePerRamSecond:rate/10,ram:10}}},
  reset:r,route:{at:now,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,selected:'hacking'},now};
}
const observe=(saved,r,now,measuredAt=now,rate=100,extra={})=>observeIncomeRecovery(saved,{...fixture(r,now,measuredAt,rate),...extra});
function baseline(){let s;for(let at=200000;at<=320000;at+=30000)s=observe(s,reset,at,at===320000?320000:200000);return s;}
function completed(){
 let s=baseline();const next={...reset,lastAugReset:320001};
 for(let t=30000;t<=240000;t+=30000){const at=next.lastAugReset+t;
  s=observe(s,next,at,t<240000?next.lastAugReset+120000:at,120,t<120000?{income:null}:{});
 }
 return {s,next};
}

test('income recovery uses qualified receipts and ignores wallet, stock and casino changes',()=>{
 const f=fixture(reset,200000),q=qualifiedRecoveryIncome(f.snapshot,f.income,reset,200000);
 assert.equal(q.rate,100);f.snapshot.worth=1e15;f.snapshot.money=1e15;f.snapshot.casinoWinnings=1e15;
 assert.deepEqual(qualifiedRecoveryIncome(f.snapshot,f.income,reset,200000),q);
 for(const patch of [{risks:1},{durationSeconds:119},{completions:29},{measuredAt:200001},{incomePerRamSecond:NaN},{ram:0}]){
  const g=fixture(reset,200000);Object.assign(g.income.targets.n00dles,patch);assert.equal(qualifiedRecoveryIncome(g.snapshot,g.income,reset,200000),null);
 }
 const wrong=fixture(reset,200000);wrong.income.ownerPid=8;assert.equal(qualifiedRecoveryIncome(wrong.snapshot,wrong.income,reset,200000),null);
});

test('duplicate overlapping and unstable measurements cannot establish sustained income',()=>{
 let s=observe(null,reset,200000);assert.equal(s.baseline,null);
 s=observe(s,reset,230000,200000);assert.equal(s.baseline,null);
 const overlap=fixture(reset,320000);overlap.income.targets.n00dles.durationSeconds=180;
 let o=observeIncomeRecovery(s,overlap);assert.equal(o.baseline,null);
 for(let at=260000;at<=320000;at+=30000)s=observe(s,reset,at,at===320000?320000:200000,at===320000?1000:100);
 assert.equal(s.baseline,null);assert.equal(baseline().baseline.rate,100);
});

test('income recovery spans an ordinary install and requires two recovered windows',()=>{
 const b=baseline(),next={...reset,lastAugReset:320001};
 let s=observe(b,next,350001,350001,100,{income:null});assert.equal(s.recovering,true);assert.equal(s.baseline,null);
 const {s:done}=completed();assert.equal(done.recovering,false);assert.equal(done.samples.length,1);assert.equal(done.samples[0].durationMs,4*minute);
 const again=observe(done,next,590001,560001,120);assert.equal(again.samples.length,1);
});

test('changed owner resets confirmation and changed mode or target context invalidates recovery',()=>{
 const b=baseline(),next={...reset,lastAugReset:320001},p=observe(b,next,350001,350001,100,{income:null});
 const mode=fixture(next,380001);mode.snapshot.xpMode='xp';assert.equal(observeIncomeRecovery(p,mode).recovering,false);
 const changed=fixture(next,470001);changed.income.targets.n00dles.signature=JSON.stringify([2e9,1,{}, {},[],null]);
 let s=observe(p,next,380001,380001,100,{income:null});s=observe(s,next,410001,410001,100,{income:null});s=observe(s,next,440001,440001,100,{income:null});
 assert.equal(observeIncomeRecovery(s,changed).recovering,false);
 const owner=fixture(reset,350000,350000,100,70);assert.equal(observeIncomeRecovery(b,owner).baseline,null);
});

test('income quotes require comparable rate context and current multipliers',()=>{
 const {s,next}=completed(),args={nodeReset:1,augReset:next.lastAugReset,now:570000};
 // A recovered 100/sec milestone cannot price a new 120/sec baseline.
 assert.equal(incomeRecoveryQuote(s,args).durationMs,15*minute);
 const same={...s,baseline:{...s.baseline,rate:100}};assert.equal(incomeRecoveryQuote(same,args).durationMs,4*minute);
 assert.match(incomeRecoveryQuote(same,args).basis,/Measured/);
 for(const r of [{...same,baseline:{...same.baseline,rate:101}},{...same,currentFactors:[.5,1,1,1,1]},{...same,baseline:{...same.baseline,signature:'different'}}])
  assert.equal(incomeRecoveryQuote(r,args).durationMs,15*minute);
});

test('temporary multiplier boosts and slower matching histories cannot create optimistic quotes',()=>{
 let s=baseline();const next={...reset,lastAugReset:320001};
 for(let t=30000;t<=240000;t+=30000){const at=next.lastAugReset+t,f=fixture(next,at,t<240000?next.lastAugReset+120000:at,120);
  if(t<120000)f.income=null;if(t===60000)f.snapshot.hackingIncomeFactors=[1,2,1,1,1];
  s=observeIncomeRecovery(s,f);
 }
 assert.equal(s.samples[0].factors[1],2);
 assert.equal(incomeRecoveryQuote({...s,baseline:{...s.baseline,rate:100}},{nodeReset:1,augReset:next.lastAugReset,now:570000}).durationMs,15*minute);
 const {s:clean}=completed(),sample=clean.samples[0];
 const slower={...clean,baseline:{...clean.baseline,rate:100},samples:[sample,{...sample,durationMs:10*minute}]};
 assert.equal(incomeRecoveryQuote(slower,{nodeReset:1,augReset:next.lastAugReset,now:570000}).durationMs,10*minute);
});

test('stale interrupted cross-reset and malformed evidence cannot create usable quotes',()=>{
 const {s,next}=completed(),args={nodeReset:1,augReset:next.lastAugReset,now:570000};
 for(const r of [{...s,at:1},{...s,nodeReset:9},{...s,augReset:3},{...s,at:570001}])assert.equal(incomeRecoveryQuote(r,args).durationMs,0);
 const pending=observe(baseline(),next,350001,350001,100,{income:null});
 assert.equal(observe(pending,next,470002).recovering,false);
 assert.doesNotThrow(()=>observeIncomeRecovery({...pending,pending:{...pending.pending,factors:null}},fixture(next,380001)));
});

test('income and level recovery use their maximum, and active income recovery blocks ordinary resets',()=>{
 const {s,next}=completed(),now=570000;
 const record={...s,baseline:{...s.baseline,rate:100},samples:[{...s.samples[0],durationMs:30*minute}]};
 const snapshot={at:now,augReset:next.lastAugReset,worth:1e9,ready:[{name:'Aug',stats:{hacking:2}}],targets:[],resetEconomics:{known:true,replacementCost:0}};
 const p=progressionSpeed({snapshot,now,augReset:next.lastAugReset,nodeReset:1,incomeRecovery:record});
 assert.equal(p.recoveryMs,30*minute);assert.equal(p.recoveryComponents.capabilityMs,15*minute);assert.equal(p.recoveryComponents.incomeMs,30*minute);
 const blocked=progressionSpeed({snapshot,now,augReset:next.lastAugReset,nodeReset:1,incomeRecovery:{...record,recovering:true}});
 assert.equal(augmentationResetDecision({requested:true,speed:blocked}).allowed,false);
 const combat=progressionSpeed({snapshot,now,augReset:next.lastAugReset,nodeReset:1,incomeRecovery:record,combat:true});assert.equal(combat.recoveryMs,30*minute);
});

test('autopilot reads existing income diagnostics and routes expose existing player multipliers',()=>{
 const a=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),n=readFileSync(new URL('../node-route-policy.js',import.meta.url),'utf8');
 assert.match(a,/observeIncomeRecovery\(incomeRecovery,\{reset:resetInfo,route:routePlan,snapshot:s,income:qualifiedIncome,now:Date.now\(\)\}\)/);
 assert.match(a,/ns.read\('tasks\/hacking-income.json'\)/);assert.match(a,/ns.write\('tasks\/income-recovery.json'/);
 assert.match(n,/s.hackingIncomeFactors=\[s.hackMult,p.mults.hacking_money,p.mults.hacking_speed,p.mults.hacking_chance,p.mults.hacking_exp\]/);
});
