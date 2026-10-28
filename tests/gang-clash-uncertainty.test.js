import test from 'node:test';
import assert from 'node:assert/strict';
import {gangClashUncertainty,observeGangAttrition,gangAttritionCalibration,planGangAttrition} from '../gang-attrition-policy.js';

const scope={ownerPid:7,nodeReset:1,augReset:2,faction:'Own'};
function input(n=1){return {power:22000,territory:.2,rivals:Array.from({length:n},(_,i)=>({name:'R'+i,power:10000+i*1000,territory:.8/n}))};}
function observation(){
 const w=input(),uncertainty=gangClashUncertainty(w,22100),expected={power:22050,territory:.2001,rivals:[{name:'R0',power:9950,territory:.7999}]};
 const lease={...scope,faction:'Own',startedAt:100000,expectedTickAt:100100,observationForecast:{wallSeconds:20,expected:[expected,structuredClone(expected),structuredClone(expected)],uncertainty}};
 const cycle={at:100100,info:{faction:'Own',power:22100/1.008**2,territory:.1997},others:{R0:{power:10000,territory:.8003}}};
 return {w,lease,cycle};
}
const within=(value,band)=>value>=band.min-1e-10&&value<=band.max+1e-10;

test('two gangs always clash twice and the envelope includes two full losses',()=>{
 const w=input(),r=gangClashUncertainty(w,22100);
 assert.equal(r.maxClashes,2);assert.equal(r.coverageLowerBound,1);assert.equal(r.confidence,.99);
 assert.equal(r.power.min,22100/1.008**2);assert.equal(r.power.max,22100);
 assert.ok(r.territory.min<=.1997);assert.ok(r.rivals[0].power.max>=10000+3);
});
test('all active-gang counts receive simultaneous coverage, using an independent count enumeration',()=>{
 for(let n=1;n<=6;n++){
  const r=gangClashUncertainty(input(n),22100);
  // Exhaust the n Bernoulli selection indicators, independently of the DP solver.
  let tail=0;
  for(let mask=0;mask<2**n;mask++){
   let k=0,probability=1;
   for(let i=0;i<n;i++){const selected=!!(mask&(1<<i));k+=Number(selected);probability*=selected?1/n:1-1/n;}
   if(1+k>r.maxClashes)tail+=probability;
  }
  assert.ok(1-(n+1)*tail>=.99-1e-12);
  assert.ok(Math.abs(r.coverageLowerBound-(1-(n+1)*tail))<1e-12);
  assert.ok(r.maxClashes<=n+1);assert.ok(r.maxClashes>=2);
 }
});
test('invalid or unsupported snapshots fail closed instead of inventing a probability band',()=>{
 for(const mutate of [w=>w.power=NaN,w=>w.territory=0,w=>w.territory=.3,w=>w.rivals[0].power=0,w=>w.rivals[0].territory=NaN,w=>w.rivals.push({...w.rivals[0]}),w=>w.rivals=[]]){
  const w=input();mutate(w);assert.equal(gangClashUncertainty(w,22100),null);
 }
 assert.equal(gangClashUncertainty(input(7),22100),null);
 for(const p of [NaN,0,21999])assert.equal(gangClashUncertainty(input(),p),null);
});
test('an unlucky outcome outside the mean scenarios stays inside the predictive envelope',()=>{
 const f=observation(),row=observeGangAttrition(f.lease,f.cycle,scope)[0];
 assert.equal(row.scored,true);assert.equal(row.territory.insideRange,false);
 assert.equal(row.territory.insidePredictiveRange,true);
 assert.equal(row.power.insidePredictiveRange,true);
 assert.equal(row.uncertaintyModel,'native-pairing-v1');
 const second={...structuredClone(row),key:'second',at:100101};
 const result=gangAttritionCalibration([row,second],scope,100101);
 assert.equal(result.samples,2);assert.equal(result.misses,0);assert.equal(result.suspended,false);
});
test('repeated adverse outcomes outside the predictive envelope still suspend early attempts',()=>{
 const f=observation();f.cycle.info.territory=.19;
 const row=observeGangAttrition(f.lease,f.cycle,scope)[0];
 assert.equal(row.territory.insidePredictiveRange,false);
 const result=gangAttritionCalibration([row,{...row,key:'second',at:100101}],scope,100101);
 assert.equal(result.misses,2);assert.equal(result.suspended,true);
});
test('new prediction ranges contain mean-scenario ranges and preserve raw diagnostic errors',()=>{
 const f=observation();f.lease.observationForecast.expected[0].power=23000;
 const row=observeGangAttrition(f.lease,f.cycle,scope)[0];
 assert.equal(row.power.predictive.max,23000);
 assert.equal(row.power.errorFromBaseline,f.cycle.info.power-22050);
 assert.ok(row.power.predictive.min<=row.power.expected.min);
});
test('malformed forecast bands and corrupted saved prediction ranges are not usable evidence',()=>{
 for(const mutate of [u=>u.coverageLowerBound=.98,u=>u.power.min=NaN,u=>u.territory.max=2,u=>u.rivals=[],u=>u.rivals[0].name='other',u=>u.confidence=1]){
  const f=observation();mutate(f.lease.observationForecast.uncertainty);
  assert.equal(observeGangAttrition(f.lease,f.cycle,scope),null);
 }
 const f=observation(),row=observeGangAttrition(f.lease,f.cycle,scope)[0];
 for(const patch of [{uncertaintyModel:'unknown'},{coverageLowerBound:NaN},{power:{...row.power,predictive:{min:1,max:2}}},{territory:{...row.territory,predictive:{min:0,max:NaN}}}]){
  const result=gangAttritionCalibration([{...row,...patch}],scope,100100);assert.equal(result.samples,0);
 }
});
test('serialized native calibration honors prediction ranges without hidden dependencies',()=>{
 const f=observation(),row=observeGangAttrition(f.lease,f.cycle,scope)[0];
 const check=Function('return ('+gangAttritionCalibration.toString()+')')();
 const result=check([row,{...row,key:'second',at:100101}],scope,100101);
 assert.equal(result.known,true);assert.equal(result.samples,2);assert.equal(result.misses,0);
});

// Independent one-update replay of source rules, used only for coverage checks.
function replay(w,ownPower,random){
 const gangs=[{power:ownPower,territory:w.territory},...w.rivals.map(r=>({power:r.power,territory:r.territory}))];
 for(let i=1;i<gangs.length;i++){
  const r=random(),g=gangs[i];g.power+=r<.5?Math.min(.85,g.power*.005):.75*r*g.territory*5;
 }
 const counts=gangs.map(()=>0);
 for(let i=0;i<gangs.length;i++){
  const others=gangs.map((_,k)=>k).filter(k=>k!==i),j=others[Math.floor(random()*others.length)];
  const won=random()<gangs[i].power/(gangs[i].power+gangs[j].power),winner=won?i:j,loser=won?j:i;
  if(gangs[loser].territory<=0)break;
  counts[i]++;counts[j]++;
  const amount=Math.min(gangs[loser].territory,.0001*Math.max(1,1+Math.log(gangs[winner].power/gangs[loser].power)/Math.log(50))*(random()+.5));
  gangs[winner].territory+=amount;gangs[loser].territory-=amount;
  gangs[loser].power/=loser===0?1.008:1.01;
  const total=gangs.reduce((s,g)=>s+g.territory,0);for(const g of gangs)g.territory/=total;
 }
 return {gangs,counts};
}
test('held-out native-rule replays remain inside the envelope whenever clash counts are bounded',()=>{
 let seed=918273645;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let n=1;n<=6;n++){
  const w=input(n),r=gangClashUncertainty(w,22100),bands=[r,...r.rivals];
  let inside=0;
  for(let trial=0;trial<4000;trial++){
   const {gangs,counts}=replay(w,22100,random);
   const included=gangs.every((g,i)=>within(g.power,bands[i].power)&&within(g.territory,bands[i].territory));
   if(counts.every(k=>k<=r.maxClashes))assert.equal(included,true);
   inside+=Number(included);
  }
  assert.ok(inside>=3960,`coverage ${inside}/4000 with ${n+1} gangs`);
 }
});
test('power ratios and near-elimination territory do not break finite bounded envelopes',()=>{
 const w={power:1e9,territory:.999999,rivals:[{name:'R',power:.001,territory:.000001}]};
 const r=gangClashUncertainty(w,1e9);assert.ok(r);
 assert.equal(r.rivals[0].territory.min,0);assert.equal(r.territory.max,1);
 const {gangs}=replay(w,1e9,()=>.99),bands=[r,...r.rivals];
 gangs.forEach((g,i)=>{assert.ok(within(g.power,bands[i].power));assert.ok(within(g.territory,bands[i].territory));});
});
test('planner attaches uncertainty while retaining the existing conservative entry decision',()=>{
 const w={...input(),active:true,powerPriority:true,threshold:.75,rivals:input().rivals.map(r=>({...r,highRate:.0425,samples:4}))};
 const f={w,cumulative:Array.from({length:180},(_,i)=>({at:(i+1)*20,power:22000+(i+1)*100})),members:Array.from({length:12},(_,i)=>({name:'M'+i,def:1e6})),powerFraction:1};
 const r=planGangAttrition(f);assert.equal(r.engage,true);assert.equal(r.observationForecast.uncertainty.model,'native-pairing-v1');
 const slower=planGangAttrition({...f,powerFraction:.5});assert.equal(slower.observationForecast.uncertainty.power.max,22050);
 w.rivals[0].territory=.7;const invalid=planGangAttrition(f);assert.equal(invalid.engage,false);assert.equal(invalid.observationForecast,null);
});
