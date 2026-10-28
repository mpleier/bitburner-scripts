import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCorporationCalibration,corporationCalibrationQuote,observeCorporationCalibration,calibrateCorporationGrowth} from '../corporation-calibration-policy.js';
import {executeCorporationGrowth} from '../corporation-policy.js';
const scope='node/aug/corp',key=JSON.stringify(['Smart Factories','production']);
const plan=(extra={})=>({label:'Level Smart Factories',cost:100,score:.1,profitPerSecond:100,market:{kind:'production'},run:()=>true,...extra});
const snapshot=(level=0,profit=100,extra={})=>({settings:'settings',levels:{'Smart Factories':level,'Smart Storage':0,'ABC SalesBots':0},environment:[['demand',1],['boost',100]],profit,...extra});
const event=(p=plan())=>({state:'purchased',market:p.market,calibrationQuote:corporationCalibrationQuote(p)});
function experiment({before=[100,100,100],after=[120,120,120],mutate=null}={}){
 let state=null,at=0;
 const tick=(s,events=[])=>state=observeCorporationCalibration(state,{scope,at:at+=10000,snapshot:s,events});
 for(const profit of before)tick(snapshot(0,profit));
 tick(snapshot(1,after[0]),[event()]);assert.ok(state.pending);
 tick(snapshot(1,after[0]));
 for(const profit of after){const s=snapshot(1,profit);if(mutate)mutate(s);tick(s);}
 return state;
}

test('isolated upgrade waits for settlement and records a conservative observed profit response',()=>{
 const s=experiment();assert.equal(s.pending,null);assert.equal(s.stats[key].length,1);
 assert.equal(s.stats[key][0].ratio,2);assert.equal(s.stats[key][0].observedProfitChange,20);assert.equal(s.stats[key][0].expectedGain,10);
 assert.equal(calibrateCorporationGrowth([plan()],s,{scope,at:s.at})[0].score,.1);
});

test('three independent purchases calibrate rankings within a bounded factor without feedback inflation',()=>{
 let state=null,at=0,level=0,profit=100;
 const tick=(s,events=[])=>state=observeCorporationCalibration(state,{scope,at:at+=10000,snapshot:s,events});
 for(let n=0;n<3;n++)tick(snapshot());
 for(let n=0;n<3;n++){
  profit+=20;level++;tick(snapshot(level,profit),[event()]);
  for(let cycle=0;cycle<4;cycle++)tick(snapshot(level,profit));
 }
 const ranked=calibrateCorporationGrowth([plan()],state,{scope,at});assert.equal(ranked[0].score,.125);assert.equal(ranked[0].calibration.samples,3);
 assert.equal(corporationCalibrationQuote(ranked[0]).expected,10);
 let cash=1000;const p={...ranked[0],run:()=>{cash-=100;return true;}};
 const result=executeCorporationGrowth([p],100,()=>cash,0);assert.equal(result.decisions[0].calibration.factor,1.25);assert.equal(result.decisions[0].calibrationQuote.expected,10);
});

test('learned evidence changes the funded upgrade when an optimistic estimate repeatedly underperforms',()=>{
 const at=100000,state={schemaVersion:1,scope,at,stats:{[key]:[1,2,3].map(n=>({at:at-n*1000,ratio:0}))}};
 function purchase(calibrated){
  let cash=1000;const purchased=[];
  const factory=plan({run:()=>{cash-=100;purchased.push('factory');return true;}}),sales=plan({label:'Level ABC SalesBots',market:{kind:'sales'},score:.09,run:()=>{cash-=100;purchased.push('sales');return true;}});
  const plans=calibrated?calibrateCorporationGrowth([factory,sales],state,{scope,at}):[factory,sales];
  executeCorporationGrowth(plans,100,()=>cash,900-1);return purchased;
 }
 assert.deepEqual(purchase(false),['factory']);assert.deepEqual(purchase(true),['sales']);
});

test('observed losses can reduce a ranking while profit noise never creates evidence',()=>{
 assert.equal(experiment({after:[80,80,80]}).stats[key][0].ratio,0);
 const noisy=experiment({before:[100,100.5,100.1],after:[100.7,100.6,100.4]});assert.equal(noisy.stats[key],undefined);
 const volatile=experiment({after:[120,130,120]});assert.equal(volatile.stats[key],undefined);
 for(const mutate of [s=>s.settings='different staffing/prices/research/products',s=>s.environment[0][1]=1.1,s=>s.levels['Smart Storage']=1])assert.equal(experiment({mutate}).stats[key],undefined);
});

test('concurrent purchases, unquoted orders and missing native readings cancel attribution',()=>{
 let state=null;for(const at of [10000,20000,30000])state=observeCorporationCalibration(state,{scope,at,snapshot:snapshot()});
 for(const events of [[event(),event()],[{state:'ordered'}],[{state:'purchased'}],[{state:'rejected',cost:5}]]){
  const next=observeCorporationCalibration(state,{scope,at:40000,snapshot:snapshot(1,120),events});assert.equal(next.pending,null);assert.equal(next.stats[key],undefined);
 }
 const pending=observeCorporationCalibration(state,{scope,at:40000,snapshot:snapshot(1,120),events:[event()]});
 assert.equal(observeCorporationCalibration(pending,{scope,at:50000,snapshot:snapshot(1,120),events:[event()]}).pending,null);
 assert.equal(observeCorporationCalibration(pending,{scope,at:50000,snapshot:null}).pending,null);
});

test('reset, future, stale, duplicate, corrupt and unsupported evidence cannot alter decisions',()=>{
 const at=100000,samples=[1,2,3].map(n=>({at:at-n*1000,ratio:0})),state={schemaVersion:1,scope,at,stats:{[key]:samples}};
 assert.equal(calibrateCorporationGrowth([plan()],state,{scope,at})[0].score,.07500000000000001);
 for(const s of [{...state,scope:'other'},{...state,at:at+1},{...state,at:at-120001},{...state,stats:{[key]:[samples[0],samples[0],samples[0]]}},{...state,stats:{[key]:samples.map(s=>({...s,ratio:NaN}))}}])assert.equal(calibrateCorporationGrowth([plan()],s,{scope,at})[0].score,.1);
 for(const p of [plan({label:'Level Wilson Analytics'}),plan({market:{kind:'research'}}),plan({profitPerSecond:0})])assert.equal(corporationCalibrationQuote(p),null);
 const next=observeCorporationCalibration({...state,pending:'corrupt',history:'corrupt'},{scope,at:at+10000,snapshot:snapshot()});assert.equal(next.pending,null);
 assert.equal(Object.keys(observeCorporationCalibration(state,{scope:'other',at:at+1,snapshot:snapshot()}).stats).length,0);
 const capped=observeCorporationCalibration({...state,stats:{[key]:Array.from({length:50},(_,i)=>({at:at-i,ratio:1}))}},{scope,at:at+1,snapshot:snapshot()});assert.equal(capped.stats[key].length,8);
});

function nativeFixture(){
 let calls=0;const constants={upgradeNames:['Smart Factories','Smart Storage','ABC SalesBots'],researchNamesBase:['Hi-Tech R&D Laboratory'],unlockNames:['Office API']};
 const d={industry:'Agriculture',cities:['Aevum'],products:[],numAdVerts:0,researchPoints:100,awareness:10,popularity:10,lastCycleRevenue:200,lastCycleExpenses:100};
 Object.defineProperty(d,'type',{enumerable:true,get(){throw Error('deprecated getter');}});
 const jobs=Object.fromEntries(['Operations','Engineer','Business','Management','Research & Development','Intern','Unassigned'].map(n=>[n,1]));
 const api={getUpgradeLevel:()=>0,hasUnlock:()=>true,getDivision:()=>d,hasResearched:()=>false,getIndustryData:()=>({producedMaterials:['Plants'],requiredMaterials:{Water:.5}}),
  getOffice:()=>({size:7,numEmployees:7,employeeJobs:jobs,avgEnergy:100,avgMorale:100,totalExperience:700}),hasWarehouse:()=>true,getWarehouse:()=>({level:1,smartSupplyEnabled:true}),
  getMaterial:()=>{calls++;return {desiredSellPrice:'MP',desiredSellAmount:'MAX',quality:1,marketPrice:10,stored:100,exports:[],demand:1,competition:1};}};
 return {api,constants,info:{divisions:['Agri']},calls:()=>calls,d};
}
test('native snapshots use explicit supported fields, track settings and fail closed on missing access',()=>{
 const f=nativeFixture(),s=captureCorporationCalibration(f.api,f.info,f.constants);assert.equal(s.profit,100);assert.equal(f.calls(),6);
 f.api.getOffice=()=>{throw Error('Source File/API unavailable');};assert.equal(captureCorporationCalibration(f.api,f.info,f.constants),null);
 assert.equal(captureCorporationCalibration(f.api,{divisions:Array(21).fill('A')},f.constants),null);
 assert.equal(captureCorporationCalibration(f.api,f.info,{}),null);
 const changed=nativeFixture();changed.api.getMaterial=()=>({desiredSellPrice:'MP*2',desiredSellAmount:'MAX',quality:1,marketPrice:10,stored:100,exports:[]});assert.notEqual(captureCorporationCalibration(changed.api,changed.info,changed.constants).settings,s.settings);
});
