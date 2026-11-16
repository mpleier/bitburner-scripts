import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangMoneyAllowed,gangTerritoryDevelopmentFocus,gangStatReputationAnchor,gangTerritoryTrend,gangIncomeEscape} from '../gang-stat-policy.js';
test('money is allowed strictly above ninety percent territory, never at or below it',()=>{
 for(const territory of [0,.1429,.75,.899999,.9,undefined,null,NaN,Infinity,-1,1.01,'0.99'])assert.equal(gangMoneyAllowed({territory}),false,String(territory));
 assert.equal(gangMoneyAllowed(null),false);
 for(const territory of [.900000001,.95,1])assert.equal(gangMoneyAllowed({territory}),true);
});
test('territory gate overrides cash focus while preserving recruitment, reputation and training controls',()=>{
 assert.equal(gangTerritoryDevelopmentFocus({territory:.9},12,'money',{'money-focus':true}),'stats');
 assert.equal(gangTerritoryDevelopmentFocus({territory:.9},11,'money'),'respect');
 for(const options of [{'no-training':true},{'reputation-focus':true},{'disable-adaptive-growth':true}])assert.equal(gangTerritoryDevelopmentFocus({territory:.1},12,'money',options),'respect');
 assert.equal(gangTerritoryDevelopmentFocus({territory:.9001},12,'money'),'money');
 assert.equal(gangTerritoryDevelopmentFocus({territory:.9001},12,'respect'),'respect');
 // A territory loss locks money optimization again on the next evaluation.
 assert.equal(gangTerritoryDevelopmentFocus({territory:.89},12,'money'),'stats');
});
test('controller gates the cash anchor, cash purchase focus and both forecast cash objectives',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/statAnchor=gangMoneyAllowed\(myGangInfo\)\?gangStatFundingAnchor/);
 assert.match(s,/if\(gangMoneyAllowed\(gang\)&&!options\['disable-adaptive-growth'\]/);
 assert.match(s,/forceMoney:gangMoneyAllowed\(gang\)&&options\['money-focus'\]/);
 assert.match(s,/if\(gangMoneyAllowed\(gangInfo\)&&cash>0\)goals.push/);
 assert.match(s,/if\(gangMoneyAllowed\(gang\)&&cash>0\)goals.push/);
 assert.match(s,/growthFocus=gangTerritoryDevelopmentFocus\(gang/);
 assert.match(s,/moneyPolicy:\{allowed:gangMoneyAllowed\(status\)/);
});
test('the replacement productive anchor is ranked by reputation, never money',()=>{
 const rates={A:[{name:'Cash',money:1e15,respect:1,wanted:0,stats:1}],B:[{name:'Respect',money:0,respect:10,wanted:0,stats:1}]};
 assert.equal(gangStatReputationAnchor(rates).name,'B');
 assert.equal(gangStatReputationAnchor(rates,['B']).name,'A');
 assert.equal(gangStatReputationAnchor({B:[{name:'Train Combat',respect:100,wanted:0}]}),null);
});
test('territory samples thin to one per five minutes and a trend spans the kept window',()=>{
 const now=10_000_000;
 const dense=[];for(let i=0;i<120;i++)dense.push({at:now-7200000+i*60000,territory:.10+i*.0002});
 const trend=gangTerritoryTrend(dense,now);
 assert.ok(trend.samples.length<=12);
 assert.equal(trend.samples.at(-1).territory,dense.at(-1).territory);
 const spanHours=trend.spanMs/3600000;
 assert.ok(trend.pointsPerHour>0&&Number.isFinite(trend.pointsPerHour));
 assert.ok(Math.abs(trend.pointsPerHour-(trend.samples.at(-1).territory-trend.samples[0].territory)/spanHours)<1e-9);
 // A value that changed inside the thinning bucket replaces that bucket's sample.
 const inside=gangTerritoryTrend([{at:now-600000,territory:.2},{at:now-120000,territory:.21},{at:now,territory:.22}],now);
 assert.equal(inside.samples.at(-1).territory,.22);
 assert.ok(inside.flatMs<=120000);
 // Garbage is ignored rather than trusted.
 assert.deepEqual(gangTerritoryTrend([{at:now+1,territory:.2},{at:now,territory:'x'},null],now).samples,[]);
 assert.deepEqual(gangTerritoryTrend(null,now).samples,[]);
});
test('the income gate is released only when the measured territory trend cannot reach ninety percent',()=>{
 const now=10_000_000,trend=(pointsPerHour,flatMs=0)=>({pointsPerHour,spanMs:3600000,flatMs});
 // Still locked: the gate arrives inside the route horizon.
 const reachable=gangIncomeEscape({territory:.5,trend:trend(20),routeRemainingMs:5*3600000,now});
 assert.equal(reachable.allowed,false);assert.ok(reachable.projectedHours>0);
 // Released: the same territory needs far longer than the route has left (0.66 points at 0.36/hour ≈ 1.8 h).
 assert.equal(gangIncomeEscape({territory:.24,trend:trend(.36),routeRemainingMs:3600000,now}).allowed,true);
 assert.match(gangIncomeEscape({territory:.24,trend:trend(.36),routeRemainingMs:3600000,now}).reason,/beyond the remaining route horizon/);
 // Locked: the same trend reaches the gate inside the route horizon (0.66 points at 3.6/hour ≈ 11 min).
 assert.equal(gangIncomeEscape({territory:.24,trend:trend(3.6),routeRemainingMs:3600000,now}).allowed,false);
 // Released: territory has not moved for half an hour, whatever the route says.
 assert.equal(gangIncomeEscape({territory:.24,trend:trend(0,1800000),routeRemainingMs:null,now}).allowed,true);
 assert.match(gangIncomeEscape({territory:.24,trend:trend(0,1800000)}).reason,/flat for 30 minutes/);
 // Released: territory is shrinking.
 assert.equal(gangIncomeEscape({territory:.24,trend:trend(-2),routeRemainingMs:3600000,now}).allowed,true);
 // Locked: too little evidence, unknown inputs, or the gate is already open.
 for(const input of [{territory:.24,trend:trend(10),routeRemainingMs:null},{territory:.24,trend:{pointsPerHour:10,spanMs:60000,flatMs:0},routeRemainingMs:3600000},{territory:NaN,trend:trend(10)},{territory:.95,trend:trend(10)}])
  assert.equal(gangIncomeEscape(input).allowed,false,JSON.stringify(input));
});
test('the controller publishes a territory trend and applies the escape to the growth focus',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/await refreshTerritoryTrend\(ns,myGangInfo,resetInfo\)/);
 assert.match(s,/gangTerritoryTrend\(\[\.\.\.\(Array\.isArray\(saved\?\.samples\)\?saved\.samples:\[\]\),\{at:now,territory:gang\.territory\}\],now\)/);
 assert.match(s,/incomeEscape=gangIncomeEscape\(\{territory:gang\.territory,trend:territoryTrend,routeRemainingMs:/);
 assert.match(s,/if\(growthFocus!=='money'&&incomeEscape\?\.allowed\)growthFocus='money'/);
 assert.match(s,/Income gate released \('\+incomeEscape\.reason\+'\)/);
});
test('ascension diagnostics name a skipped pass instead of publishing null',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(s,/ascensionDiagnostics=\{passAt:Date\.now\(\),skipped:'planning-yield'\}/);
 // One bounded projection feeds both growth-record writers (detailed valuation and collect-all gear).
 assert.match(s,/const ascensionRecord=\(\)=>ascensionDiagnostics\?\{at:ascensionDiagnostics\.passAt,skipped:/);
 assert.match(s,/recoveryCap:ascensionDiagnostics\.recoveryCap\?\?null/);
 assert.equal((s.match(/ascension:ascensionRecord\(\)/g)||[]).length,2);
 assert.doesNotMatch(s,/ascension:null/);
});
