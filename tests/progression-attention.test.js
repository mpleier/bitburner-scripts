import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sleeveCombatCrime,sleeveCombatWorker,sleeveDevelopmentActive} from '../sleeve-development-policy.js';
import {adaptiveHgwTiming,restoreHgwTiming} from '../progression-improvements-policy.js';
import {collectHgwTelemetry} from '../hgw-telemetry-policy.js';
import {progressionSpeed} from '../progression-speed-policy.js';
const sleeve=(extra={})=>({shock:30,sync:100,skills:{strength:100,defense:100,dexterity:100,agility:100,intelligence:0},mults:{crime_success:1},...extra});
const crimes={Train:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:10},Risky:{time:1000,difficulty:100,strength_success_weight:1,strength_exp:100}};
test('combat crime scoring includes failed-crime quarter XP and transferred shock/sync',()=>{
 const result=sleeveCombatCrime(sleeve(),crimes,0);
 assert.equal(result.name,'Risky');assert.equal(result.rate,17.5);
 assert.equal(sleeveCombatCrime(sleeve({shock:0,sync:50}),crimes,0).rate,12.5);
 assert.equal(sleeveCombatCrime(sleeve({shock:100}),crimes),null);
 assert.equal(sleeveCombatCrime(sleeve(),{}),null);
 assert.equal(sleeveCombatCrime(sleeve(),{Bad:{time:NaN,strength_exp:1e9}}),null);
});
test('combat support borrows only one synchronized sleeve below fifty shock and retains near-equal worker',()=>{
 const sleeves=[sleeve({shock:40}),sleeve({shock:30}),sleeve({shock:51}),sleeve({shock:0}),sleeve({sync:99})];
 assert.equal(sleeveCombatWorker(sleeves,crimes).index,1);
 assert.equal(sleeveCombatWorker([sleeve({shock:51}),sleeve({shock:0}),sleeve({sync:99})],crimes),null);
 assert.equal(sleeveCombatWorker([sleeve({shock:30}),sleeve({shock:31})],crimes,[null,{type:'CRIME',crimeType:'Risky'}]).index,1);
});
test('combat development requires fresh chance-blocked target from live Bladeburner owner in same reset',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},ps=[{pid:8,filename:'bladeburner.js'}];
 const record={pid:8,at:1000,nodeReset:1,augReset:2,chanceBlocked:true,target:'Operation Typhoon'};
 assert.equal(sleeveDevelopmentActive(record,reset,ps,2000),true);
 for(const patch of [{pid:9},{at:3000},{at:-30000},{nodeReset:3},{augReset:3},{chanceBlocked:false},{target:null}])
  assert.equal(sleeveDevelopmentActive({...record,...patch},reset,ps,2000),false,JSON.stringify(patch));
 assert.equal(sleeveDevelopmentActive(record,reset,[],2000),false);
});
const pacing=(s,t,ops,late,samples,risks)=>adaptiveHgwTiming(s,{at:t,augReset:1,nodeReset:2,counts:{operations:ops,deadlineOverruns:late,spacingSamples:samples,spacingRisks:risks}},{now:t,targetCount:4});
test('complete spacing evidence distinguishes small deadline misses from sustained spacing risks',()=>{
 let s=pacing(null,100000,0,0,0,0);
 s=pacing(s,130000,100,20,100,0);assert.equal(s.multiplier,1);assert.equal(s.lateFraction,.2);assert.equal(s.riskFraction,0);
 assert.equal(s.evidenceMode,'half-leg-spacing');
 s=pacing(s,190000,200,40,200,10);assert.equal(s.multiplier,1.5);
});
test('mixed legacy or partial spacing evidence falls back to raw deadlines',()=>{
 let s=pacing(null,100000,0,0,0,0);
 s=pacing(s,130000,100,20,99,0);assert.equal(s.multiplier,1.5);assert.equal(s.evidenceMode,'deadline-fallback');
 s=pacing(s,190000,200,40,199,10);assert.equal(s.multiplier,2.25);
});
test('spacing-aware pacing recovers gradually despite minor deadline misses; silence cannot recover',()=>{
 let s=pacing(null,100000,0,0,0,0);
 for(let i=1;i<=5;i++)s=pacing(s,100000+i*60000,i*100,i*20,i*100,i*10);
 assert.equal(s.multiplier,4);
 for(let i=1;i<=3;i++)s=pacing(s,400000+i*60000,500+i*100,100+i*10,500+i*100,50);
 assert.equal(s.multiplier,3.2);
 s=pacing(s,800000,800,130,800,50);assert.equal(s.multiplier,3.2);
});
test('all native HGW reporters preserve raw lateness and count conservative half-spacing risks',()=>{
 for(const file of ['Remote/hack-target.js','Remote/grow-target.js','Remote/weak-target.js']) {
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.match(source,/legSpacingMs:Number.isFinite\(meta\?\.legSpacingMs\)/);
  const report=vm.runInNewContext(source.slice(source.indexOf('function report('))+';report');
  let queue='NULL PORT DATA';
  const ns={getPortHandle:()=>({peek:()=>queue,read:()=>{const result=queue;queue='NULL PORT DATA';return result;},write:s=>queue=s})};
  const event={at:1000,tool:'hack',target:'x',lateMs:1000,toleranceMs:250,legSpacingMs:4000,outcome:'effect',value:1};
  const meta={port:20,augReset:1,nodeReset:2};
  report(ns,meta,event,true);let data=JSON.parse(queue);
  assert.equal(data.counts.deadlineOverruns,1);assert.equal(data.counts.spacingSamples,1);assert.equal(data.counts.spacingRisks,0);
  report(ns,meta,{...event,lateMs:2001},true);data=JSON.parse(queue);assert.equal(data.counts.spacingRisks,1);
  report(ns,meta,{...event,legSpacingMs:null},true);data=JSON.parse(queue);assert.equal(data.counts.spacingSamples,2);
  report(ns,meta,{...event,lateMs:0,error:'native error'},true);data=JSON.parse(queue);assert.equal(data.counts.spacingRisks,2);
 }
});
test('telemetry collector retains spacing counters and legacy history across controller reloads',()=>{
 let queue=JSON.stringify({channel:'hgw-v1',augReset:1,nodeReset:2,counts:{operations:3,spacingSamples:3,spacingRisks:1,deadlineOverruns:2}});
 const files=new Map();
 const ns={read:f=>files.get(f)||'',write:(f,t)=>files.set(f,t),print(){},toast(){},getPortHandle:()=>({peek:()=>queue,read:()=>{const q=queue;queue='NULL PORT DATA';return q;}})};
 collectHgwTelemetry(ns,{lastAugReset:1,lastNodeReset:2},7,1000);
 const result=JSON.parse(files.get('tasks/hgw-misfires.json'));assert.equal(result.counts.spacingSamples,3);assert.equal(result.counts.spacingRisks,1);
 collectHgwTelemetry(ns,{lastAugReset:1,lastNodeReset:2},8,7000);
 assert.equal(JSON.parse(files.get('tasks/hgw-misfires.json')).counts.spacingRisks,1);
});
test('BN9 reset holds explain weak gains or unknown rebuild costs without dropping protection',()=>{
 const now=1e7,augReset=1;
 const snapshot={at:now,augReset,worth:1e6,ready:[{name:'Weak',stats:{strength:1.01}}],targets:[],reputation:{},resetEconomics:{known:true,replacementCost:1e12,gangLossPerSecond:0}};
 const args={snapshot,now,augReset,elapsed:now,node:9,firstBn9:true,combat:true,homeRam:1024};
 let result=progressionSpeed(args);assert.equal(result.earlyInstall,false);assert.match(result.reason,/little route improvement/);
 result=progressionSpeed({...args,snapshot:{...snapshot,resetEconomics:{known:false}}});assert.match(result.reason,/unknown/);
});
test('live wiring keeps casino, karma, explicit sleeve options and disabled-XP protections ahead of combat support',()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 assert.match(source,/startupPlan.stage === 'conditioning'/);assert.match(source,/disable-combat-xp-support/);
 assert.match(source,/!reset.bitNodeOptions\?\.disableSleeveExpAndAugmentation/);
 assert.ok(source.indexOf("if(openingTask==='combat-xp')")<source.indexOf("if (sleeve.shock > options['min-shock-recovery'])"));
 assert.match(source,/selected === 'bladeburner'/);
});

test('hot reload restores fresh measured pacing but rejects stale, reset or invalid state',()=>{
 let state=pacing(null,100000,0,0,0,0);state=pacing(state,130000,100,10,100,10);
 const telemetry={augReset:1,nodeReset:2,counts:{operations:100,deadlineOverruns:10,spacingSamples:100,spacingRisks:10}};
 assert.equal(restoreHgwTiming(JSON.parse(JSON.stringify(state)),telemetry,140000).multiplier,1.5);
 for(const patch of [{at:150000},{at:1},{multiplier:0},{multiplier:5},{operations:101},{late:11},{windowAt:150000},{nodeReset:3},{cleanWindows:-1}])
  assert.equal(restoreHgwTiming({...state,...patch},telemetry,140000),null,JSON.stringify(patch));
 assert.equal(restoreHgwTiming(state,{...telemetry,augReset:3},140000),null);
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');assert.match(source,/restoreHgwTiming\(JSON.parse\(ns.read\('tasks\/hgw-pacing.json'\)\),telemetry\)/);
});

test('augmentation count gain requires an actual noncombat crossing and excludes NeuroFlux duplicates',()=>{
 const now=1e7,augReset=1;
 const run=(installedCount,ready,combat=false,requiredCount=30)=>progressionSpeed({snapshot:{at:now,augReset,worth:1e6,installedCount,requiredCount,ready:ready.map(name=>({name,stats:{}})),targets:[],reputation:{}},now,augReset,combat,elapsed:now,homeRam:1024}).gain;
 assert.equal(run(29,['Unique']),.5);
 assert.equal(run(30,['Unique']),0);assert.equal(run(31,['Unique']),0);
 assert.equal(run(29,['Unique'],true),0);
 assert.equal(run(28,['Unique','Unique','NeuroFlux Governor']),0);
 assert.equal(run(29,['NeuroFlux Governor']),0);assert.equal(run(29,[]),0);
 assert.equal(run(9,['Unique'],false,10),.5);
});
test('combat sleeve finishes invested crime even if another crime or worker becomes optimal',()=>{
 const sleeves=[sleeve({shock:40}),sleeve({shock:30})];
 const tasks=[{type:'CRIME',crimeType:'Train',cyclesWorked:99,cyclesNeeded:100},null];
 let worker=sleeveCombatWorker(sleeves,crimes,tasks,0);
 assert.equal(worker.index,0);assert.equal(worker.name,'Train');assert.equal(worker.completingCrime,true);
 tasks[0].cyclesWorked=0;worker=sleeveCombatWorker(sleeves,crimes,tasks,0);assert.equal(worker.index,1);assert.equal(worker.name,'Risky');
 for(const invalid of [{cyclesWorked:NaN},{cyclesNeeded:NaN},{crimeType:'Unknown'},{cyclesWorked:101}]) {
  const current={...tasks[0],cyclesWorked:99,...invalid};
  assert.equal(sleeveCombatWorker(sleeves,crimes,[current,null],0).index,1);
 }
 assert.equal(sleeveCombatWorker([sleeve({shock:51}),sleeves[1]],crimes,[{...tasks[0],cyclesWorked:99},null],0).index,1);
});
