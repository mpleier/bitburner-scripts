import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCorporationAdvertisingBundle,executeCorporationAdvertisingBundle,refreshCorporationAdvertisingRecovery} from '../corporation-advert-bundle-policy.js';
import {corporationAdvertBenefit,executeCorporationGrowth} from '../corporation-policy.js';

function fixture(){
 const state={money:1000,reserve:100,level:0,adverts:1,wilsonCost:10,advertCost:100,allowed:true},calls=[];
 const quote={division:'D',level:0,adverts:1,wilsonCost:10,advertCost:100,cost:110};
 const api={getUpgradeLevel:()=>state.level,getDivision:()=>({numAdVerts:state.adverts}),getUpgradeLevelCost:()=>state.wilsonCost,getHireAdVertCost:()=>state.advertCost,
  levelUpgrade:()=>{calls.push('wilson');state.money-=state.wilsonCost;state.level++;},hireAdVert:()=>{calls.push('advert');state.money-=state.advertCost;state.adverts++;}};
 const options={cash:()=>state.money,reserve:()=>state.reserve,allowed:()=>state.allowed};
 return {state,api,calls,quote,options};
}

test('bundle competes with advertising alone using only the next advertisement benefit',()=>{
 const args={division:{name:'D',awareness:1e6,popularity:1e6,numAdVerts:1},industry:{advertisingFactor:.2},level:0,wilsonCost:1e6,advertCost:1e9,benefit:corporationAdvertBenefit};
 const q=quoteCorporationAdvertisingBundle(args);assert.ok(q.score>q.aloneScore*1.05);assert.equal(q.cost,1001e6);
 assert.equal(q.benefit,corporationAdvertBenefit(args.division,args.industry,1));
 assert.equal(quoteCorporationAdvertisingBundle({...args,wilsonCost:1e9}),null);
 for(const patch of [{level:NaN},{wilsonCost:Infinity},{advertCost:-1},{benefit:()=>{throw Error('unavailable');}},{division:{...args.division,numAdVerts:undefined}}])assert.equal(quoteCorporationAdvertisingBundle({...args,...patch}),null);
});
test('native execution upgrades Wilson first, verifies advertising and preserves reserves',()=>{
 const f=fixture(),r=executeCorporationAdvertisingBundle(f.api,f.quote,f.options);
 assert.deepEqual(f.calls,['wilson','advert']);assert.equal(r.state,'purchased');assert.equal(f.state.money,890);assert.ok(f.state.money>f.state.reserve);
});
test('changed native prices, state, reserves, pause or malformed quotes block purchases before spending',()=>{
 for(const mutate of [f=>f.state.wilsonCost++,f=>f.state.advertCost++,f=>f.state.level++,f=>f.state.adverts++,f=>f.state.reserve=900,f=>f.state.allowed=false,f=>f.quote.cost=Infinity,f=>f.quote.level=Number.MAX_SAFE_INTEGER]){
  const f=fixture();mutate(f);assert.equal(executeCorporationAdvertisingBundle(f.api,f.quote,f.options).state,'rejected');assert.deepEqual(f.calls,[]);
 }
});
test('after-Wilson pause and repricing produce a partial receipt with no unverified second purchase',()=>{
 for(const mutate of [f=>f.state.allowed=false,f=>f.state.advertCost=101,f=>f.state.reserve=950]){
  const f=fixture(),upgrade=f.api.levelUpgrade;f.api.levelUpgrade=()=>{upgrade();mutate(f);};
  const r=executeCorporationAdvertisingBundle(f.api,f.quote,f.options);assert.equal(r.state,'partial');assert.equal(r.wilsonPurchased,true);assert.equal(r.advertPurchased,false);assert.deepEqual(f.calls,['wilson']);
 }
});
test('native errors after mutations are confirmed rather than losing partial purchase recovery',()=>{
 const f=fixture(),upgrade=f.api.levelUpgrade;f.api.levelUpgrade=()=>{upgrade();throw Error('post-mutation failure');};
 const r=executeCorporationAdvertisingBundle(f.api,f.quote,f.options);assert.equal(r.state,'partial');assert.equal(r.wilsonPurchased,true);
 const g=fixture(),advert=g.api.hireAdVert;g.api.hireAdVert=()=>{advert();throw Error('post-mutation failure');};
 assert.equal(executeCorporationAdvertisingBundle(g.api,g.quote,g.options).state,'purchased');
});
test('exclusive alternatives allow one Wilson bundle, no duplicate advert, and ordinary ads elsewhere',()=>{
 let cash=1000;const bought=[];
 const p=(label,cost,score,exclusive)=>({label,cost,score,exclusive,run:()=>{cash-=cost;bought.push(label);return true;}});
 const plans=[p('bundle A',110,4,['wilson','advert:A']),p('bundle B',110,3,['wilson','advert:B']),p('advert A',100,2,['advert:A']),p('advert B',100,1,['advert:B'])];
 executeCorporationGrowth(plans,500,()=>cash,100);assert.deepEqual(bought,['bundle A','advert B']);
});
test('an unaffordable bundle falls back to advertising alone without buying standalone Wilson',()=>{
 let cash=1000;const bought=[];
 const plans=[{label:'bundle',cost:110,score:4,exclusive:['wilson','ad'],run:()=>{throw Error('unaffordable');}},{label:'ad',cost:100,score:2,exclusive:['ad'],run:()=>{cash-=100;bought.push('ad');return true;}}];
 executeCorporationGrowth(plans,100,()=>cash,100);assert.deepEqual(bought,['ad']);
});
test('partial spending consumes only the actual charge and blocks same-cycle duplicate alternatives',()=>{
 const f=fixture(),receipt={};f.api.hireAdVert=()=>{throw Error('native advert failure');};let duplicate=false;
 const p={label:'bundle',cost:110,score:3,exclusive:['wilson','ad'],advertisingBundle:f.quote,advertisingReceipt:receipt,run:()=>{Object.assign(receipt,executeCorporationAdvertisingBundle(f.api,f.quote,f.options));return receipt.state==='purchased';}};
 const result=executeCorporationGrowth([p,{label:'ad',cost:100,score:2,exclusive:['ad'],run:()=>{duplicate=true;return true;}}],110,()=>f.state.money,100);
 assert.equal(result.spent,10);assert.equal(result.remaining,100);assert.equal(result.decisions[0].advertisingReceipt.state,'partial');assert.equal(duplicate,false);
});
test('recovery survives missing readings, clears after a manual advert and removes deleted divisions',()=>{
 const saved=[['D',{level:1,adverts:1}]];
 assert.equal(refreshCorporationAdvertisingRecovery(saved,[{name:'D',numAdVerts:1}]).size,1);
 assert.equal(refreshCorporationAdvertisingRecovery(saved,[{name:'D'}]).size,1);
 assert.equal(refreshCorporationAdvertisingRecovery(saved,[{name:'D',numAdVerts:2}]).size,0);
 assert.equal(refreshCorporationAdvertisingRecovery(saved,[]).size,0);
 assert.equal(refreshCorporationAdvertisingRecovery([['D',{level:-1,adverts:1}],null],[{name:'D'}]).size,0);
});
