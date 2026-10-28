import test from 'node:test';
import assert from 'node:assert/strict';
import {planCorporationAdvertisingGroups,executeCorporationAdvertisingGroup,quoteCorporationAdvertisingBundle} from '../corporation-advert-bundle-policy.js';
import {executeCorporationGrowth} from '../corporation-policy.js';
const row=(division,extra={})=>({division,level:0,wilsonCost:40,adverts:0,advertCost:100,aloneBenefit:1,benefit:1.2,aloneValue:100,...extra});
const opts={level:0,wilsonCost:40,maxCost:1000};

test('three planned adverts can justify shared Wilson when every individual pair fails',()=>{
 const rows=['A','B','C'].map(n=>row(n)),groups=planCorporationAdvertisingGroups(rows,opts);
 assert.equal(groups.length,1);assert.equal(groups[0].advertisements.length,3);assert.equal(groups[0].cost,340);
 assert.ok(Math.abs(groups[0].score-360/340)<1e-12);assert.equal(groups[0].aloneScore,1);
 for(const r of rows)assert.equal(quoteCorporationAdvertisingBundle({division:{name:r.division,numAdVerts:0,awareness:1,popularity:1},industry:{},level:0,wilsonCost:40,advertCost:100,benefit:(_d,_i,l)=>l?1.2:1}),null);
});
test('subset enumeration matches an independent exhaustive search with unequal division values and costs',()=>{
 const rows=[row('A',{aloneValue:80,benefit:1.5}),row('B',{aloneValue:500,advertCost:200,benefit:1.3}),row('C',{aloneValue:20,advertCost:50,benefit:1.8}),row('D',{aloneValue:60,advertCost:80,benefit:1.4})];
 const groups=planCorporationAdvertisingGroups(rows,{...opts,maxCost:400}),expected=[];
 for(let mask=1;mask<16;mask++){
  const selected=rows.filter((_r,i)=>mask&(1<<i));if(selected.length>3)continue;
  const ads=selected.reduce((s,r)=>s+r.advertCost,0),base=selected.reduce((s,r)=>s+r.aloneValue,0),value=selected.reduce((s,r)=>s+r.aloneValue*r.benefit/r.aloneBenefit,0),cost=ads+40;
  if(cost<=400&&value/cost>base/ads*1.05)expected.push({names:selected.map(r=>r.division).sort().join(','),score:value/cost,cost});
 }
 const actual=groups.map(g=>({names:g.advertisements.map(r=>r.division).sort().join(','),score:g.score,cost:g.cost})).sort((a,b)=>a.names.localeCompare(b.names));
 expected.sort((a,b)=>a.names.localeCompare(b.names));assert.deepEqual(actual,expected);
});
test('search is bounded, deduplicates divisions, rejects stale cohorts and honours combined treasury caps',()=>{
 const rows=Array.from({length:20},(_,i)=>row('D'+i,{wilsonCost:1,benefit:2})),groups=planCorporationAdvertisingGroups(rows,{level:0,wilsonCost:1,maxCost:1e6,maxAds:100,maxCandidates:100});
 assert.equal(groups.length,92);assert.ok(groups.every(g=>g.advertisements.length<=3&&new Set(g.advertisements.map(r=>r.division)).size===g.advertisements.length));
 assert.equal(planCorporationAdvertisingGroups(['A','B','C'].map(n=>row(n)),{...opts,maxCost:339}).length,0);
 assert.equal(planCorporationAdvertisingGroups([row('A'),row('B'),row('C',{level:1})],opts).length,0);
 assert.equal(planCorporationAdvertisingGroups([row('A'),row('B'),row('A')],opts).length,0);
});
function native(){
 const state={money:1000,reserve:100,level:0,allowed:true,adverts:{A:0,B:0,C:0},prices:{A:100,B:100,C:100}},calls=[];
 const api={getUpgradeLevel:()=>state.level,getUpgradeLevelCost:()=>40,getDivision:n=>({numAdVerts:state.adverts[n]}),getHireAdVertCost:n=>state.prices[n],
  levelUpgrade:()=>{state.money-=40;state.level++;calls.push('Wilson');},hireAdVert:n=>{state.money-=state.prices[n];state.adverts[n]++;calls.push(n);}};
 const quote=planCorporationAdvertisingGroups(['A','B','C'].map(n=>row(n)),opts)[0];
 return {state,calls,api,quote,options:{cash:()=>state.money,reserve:()=>state.reserve,allowed:()=>state.allowed}};
}
test('native group buys Wilson once before all adverts, without exceeding the quoted total',()=>{
 const f=native(),r=executeCorporationAdvertisingGroup(f.api,f.quote,f.options);assert.equal(r.state,'purchased');assert.deepEqual(f.calls,['Wilson','A','B','C']);assert.equal(f.state.money,660);assert.deepEqual(r.pending,[]);assert.equal(r.advertPurchased,true);
});
test('all native quotes are checked before Wilson and remaining bills are checked after it',()=>{
 const f=native();f.state.prices.C=101;assert.equal(executeCorporationAdvertisingGroup(f.api,f.quote,f.options).state,'rejected');assert.deepEqual(f.calls,[]);
 const g=native(),upgrade=g.api.levelUpgrade;g.api.levelUpgrade=()=>{upgrade();g.state.prices.C=101;};
 const r=executeCorporationAdvertisingGroup(g.api,g.quote,g.options);assert.equal(r.state,'partial');assert.deepEqual(g.calls,['Wilson']);assert.deepEqual(r.pending,['A','B','C']);
});
test('mid-group failure charges actual costs and identifies only unfinished recovery adverts',()=>{
 const f=native(),hire=f.api.hireAdVert;f.api.hireAdVert=n=>{if(n==='B')throw Error('native failure');hire(n);};const receipt={};
 const plan={label:'group',score:2,cost:340,exclusive:['wilson','ad:A','ad:B','ad:C'],advertisingBundle:f.quote,advertisingReceipt:receipt,run:()=>{Object.assign(receipt,executeCorporationAdvertisingGroup(f.api,f.quote,f.options));return receipt.state==='purchased';}};
 const r=executeCorporationGrowth([plan],340,()=>f.state.money,100);assert.equal(r.spent,140);assert.equal(r.remaining,200);assert.deepEqual(receipt.advertisementsPurchased,['A']);assert.deepEqual(receipt.pending,['B','C']);assert.equal(receipt.state,'partial');
});
test('a pause mid-group prevents later purchases and post-mutation exceptions retain confirmations',()=>{
 const f=native(),hire=f.api.hireAdVert;f.api.hireAdVert=n=>{hire(n);f.state.allowed=false;};assert.deepEqual(executeCorporationAdvertisingGroup(f.api,f.quote,f.options).pending,['B','C']);assert.deepEqual(f.calls,['Wilson','A']);
 const g=native(),ad=g.api.hireAdVert;g.api.hireAdVert=n=>{ad(n);if(n==='B')throw Error('post-mutation failure');};const r=executeCorporationAdvertisingGroup(g.api,g.quote,g.options);assert.deepEqual(r.advertisementsPurchased,['A','B']);assert.deepEqual(r.pending,['C']);
});
test('invalid or duplicate group quotes never mutate native state',()=>{
 for(const mutate of [q=>q.cost++,q=>q.advertisements.push(q.advertisements[0]),q=>q.advertisements[0].advertCost=NaN,q=>q.level=Infinity]){
  const f=native();mutate(f.quote);assert.equal(executeCorporationAdvertisingGroup(f.api,f.quote,f.options).state,'rejected');assert.deepEqual(f.calls,[]);
 }
});
