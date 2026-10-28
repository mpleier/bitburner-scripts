import test from 'node:test';
import assert from 'node:assert/strict';
import {officeOnlyResearchJobs,corporationProductBaseline} from '../corporation-policy.js';
import {corporationFundingDiagnostics} from '../corporation-priority-policy.js';
test('research-only offices preserve headcount and support large-office upkeep',()=>{
 assert.deepEqual(officeOnlyResearchJobs({numEmployees:3,avgEnergy:100,avgMorale:100}),[0,0,0,0,3,0]);
 assert.deepEqual(officeOnlyResearchJobs({numEmployees:9,avgEnergy:100,avgMorale:100}),[0,0,0,0,8,1]);
 assert.deepEqual(officeOnlyResearchJobs({numEmployees:9,avgEnergy:90,avgMorale:90}),[0,0,0,0,7,2]);
 assert.equal(officeOnlyResearchJobs({numEmployees:3}),null);
 assert.equal(officeOnlyResearchJobs({numEmployees:3.5,avgEnergy:100,avgMorale:100}),null);
});
test('replacement baseline never borrows another product launch',()=>{
 const old={name:'Old',research:10},latest={name:'New',research:100};
 assert.equal(corporationProductBaseline({Old:old},latest,'Old'),old);
 assert.deepEqual(corporationProductBaseline({},latest,'Old'),{});
 assert.equal(corporationProductBaseline({},latest,'New'),latest);
 assert.deepEqual(corporationProductBaseline({Old:latest},null,'Old'),{});
});
test('funding diagnostics expose cash and allocation gaps without inventing savings',()=>{
 const plans=[{label:'Warehouse',cost:5e9},{label:'Warehouse',cost:5e9},{label:'Affordable',cost:1}];
 const original=JSON.stringify(plans),info={funds:1e9,revenue:20000,expenses:10000};
 const rows=corporationFundingDiagnostics(plans,info,1e8,2e8);
 assert.equal(rows.length,1);assert.equal(rows[0].shortfall,4.8e9);assert.equal(rows[0].cashGap,4.1e9);assert.equal(rows[0].estimatedSeconds,640000);
 assert.equal(corporationFundingDiagnostics(plans,{...info,expenses:30000},1e8,2e8)[0].estimatedSeconds,null);
 assert.equal(JSON.stringify(plans),original);
 assert.deepEqual(corporationFundingDiagnostics(plans,{...info,funds:NaN},0,0),[]);
});
