import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangMoneyAllowed,gangTerritoryDevelopmentFocus,gangStatReputationAnchor} from '../gang-stat-policy.js';
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
