import test from 'node:test';
import assert from 'node:assert/strict';
import {main as solve,codingContractTypesMetadata as metadata} from '../Tasks/contractor.js.solver.js';
import {contractKey,solverVersion} from '../contract-policy.js';
function fixture(contracts){
 const files=new Map(),logs=[],toasts=[],attempts=[];
 const version=solverVersion(metadata);
 files.set('tasks/contract-validation.json',JSON.stringify({version,types:Object.fromEntries(metadata.map(m=>[m.name,{state:'passed'}]))}));
 const ns={args:[JSON.stringify(contracts)],read:f=>files.get(f)||'',write:async(f,s)=>files.set(f,s),print:m=>logs.push(m),tprint:m=>logs.push(m),toast:(m,type)=>toasts.push({m,type}),sleep:async()=>{},
  codingcontract:{attempt:(_answer,file)=>{attempts.push(file);if(file.startsWith('error'))throw Error('API unavailable');return file.startsWith('wrong')?'':'reward';}},tail:()=>assert.fail('must not open tails')};
 return {ns,files,logs,toasts,attempts,result:()=>JSON.parse(files.get('tasks/contracts-results.json'))};
}
const contract=(name,type='Find Largest Prime Factor',dataJson='9')=>({hostname:'home',contract:name+'.cct',type,dataJson});
test('large batches partition solved, failed, deferred and unsupported without counting skipped work as success',async()=>{
 const rows=[];
 for(let i=0;i<3;i++)rows.push(contract('good'+i),contract('wrong'+i),contract('error'+i),contract('parse'+i,undefined,'invalid JSON'),contract('pending'+i,'Subarray with Maximum Sum','[1]'),contract('quarantine'+i),contract('unknown'+i,'Future Contract'));
 const f=fixture(rows),v=JSON.parse(f.files.get('tasks/contract-validation.json'));v.types['Subarray with Maximum Sum'].state='retrying';f.files.set('tasks/contract-validation.json',JSON.stringify(v));
 f.files.set('tasks/contract-quarantine.json',JSON.stringify(Object.fromEntries(rows.filter(c=>c.contract.startsWith('quarantine')).map(c=>[contractKey(c),{version:v.version}]))));
 await solve(f.ns);const p=f.result();assert.equal(p.total,21);assert.equal(p.attempted,9);assert.equal(p.solved,3);assert.equal(p.failed,9);assert.equal(p.deferred,6);assert.equal(p.unsupported,3);
 assert.equal(p.solved+p.failed+p.deferred+p.unsupported,p.total);assert.equal(f.attempts.length,9);assert.equal(f.toasts.at(-1).type,'warning');assert.ok(f.logs.some(s=>s.includes('3 solved, 9 failed, 6 deferred, 3 unsupported')));
});
test('unvalidated and unsupported batches produce no successful result notification or real attempts',async()=>{
 const f=fixture(Array.from({length:22},(_,i)=>contract(String(i),i%2?'Future Contract':'Find Largest Prime Factor')));f.files.delete('tasks/contract-validation.json');await solve(f.ns);
 assert.equal(f.result().solved,0);assert.equal(f.result().deferred,11);assert.equal(f.result().unsupported,11);assert.equal(f.attempts.length,0);assert.equal(f.toasts.at(-1).type,'info');
});
test('successful large batches retain success reporting and exact attempt totals',async()=>{
 const f=fixture(Array.from({length:21},(_,i)=>contract('good'+i)));await solve(f.ns);assert.equal(f.result().solved,21);assert.equal(f.result().attempted,21);assert.equal(f.toasts.at(-1).type,'success');
});
test('solver exceptions are failures with no attempts and are deferred on later scans',async()=>{
 const f=fixture([contract('broken',undefined,'bad')]);await solve(f.ns);assert.equal(f.result().failed,1);assert.equal(f.result().attempted,0);await solve(f.ns);assert.equal(f.result().failed,0);assert.equal(f.result().deferred,1);
});
test('a supported solver returning no answer is failed and quarantined',async()=>{
 const m=metadata.find(m=>m.name==='Find Largest Prime Factor'),saved=m.solver;
 try{m.solver=()=>null;const f=fixture([contract('empty')]);await solve(f.ns);assert.equal(f.result().failed,1);assert.equal(f.result().unsupported,0);assert.equal(f.result().attempted,0);}finally{m.solver=saved;}
});
test('valid zero and empty-string answers reach the API',async()=>{
 const f=fixture([contract('zero','Array Jumping Game','[0,0]'),contract('empty','Shortest Path in a Grid','[[0,1],[1,0]]')]);await solve(f.ns);assert.equal(f.result().solved,2);assert.equal(f.attempts.length,2);
});
test('malformed stored notification and quarantine data does not abort reporting',async()=>{
 const f=fixture([contract('wrong')]);f.files.set('/Temp/unsolved-contracts.txt','invalid');f.files.set('tasks/contract-quarantine.json','"invalid"');await solve(f.ns);assert.equal(f.result().failed,1);
});
test('failure notification identity includes hostname as well as filename',async()=>{
 const f=fixture([contract('wrong'),{...contract('wrong'),hostname:'n00dles'}]);await solve(f.ns);assert.equal(f.toasts.length,2);assert.equal(f.result().failed,2);
});
test('empty batches have zero outcomes and release worker ownership for the next call',async()=>{
 const f=fixture([]);await solve(f.ns);assert.equal(f.result().total,0);assert.equal(f.result().attempted,0);f.ns.args=[JSON.stringify([contract('good')])];await solve(f.ns);assert.equal(f.result().solved,1);
});
