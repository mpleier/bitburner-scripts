import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, renderCommandJob } from '../remote-api-command.js';
const command = (method,args=[]) => ({id:'test-id',method,args,expiresAt:Date.now()+60000});
test('remote controls reject expired, arbitrary, and destructive API requests', () => {
 for (const method of ['killall','deleteServer','corporation.expandIndustry','singularity.destroyW0r1dD43m0n','constructor']) assert.throws(()=>validateCommand(command(method)));
 assert.throws(()=>validateCommand({...command('status'),expiresAt:0}));
 assert.throws(()=>validateCommand(command('start',['other.js'])));
 assert.throws(()=>validateCommand(command('start',['autopilot.js','--custom'])));
});
test('remote controls permit state queries and named project start/stop', () => {
 for (const method of ['status','getPlayer','corporation.getCorporation']) assert.equal(validateCommand(command(method)).method,method);
 for (const method of ['start','stop']) assert.equal(validateCommand(command(method,['casino.js'])).method,method);
});
async function job(request) { return await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(request)).toString('base64')); }
test('remote jobs report unavailable API errors without throwing', async () => {
 const writes=[]; const request=command('corporation.getCorporation');
 const worker=await job(request);
 await worker.main({pid:1,args:[JSON.stringify(request.args),'result.json',request.id],write:async(file,text)=>writes.push(JSON.parse(text)),corporation:{getCorporation:()=>{throw new Error('Source File unavailable');}}});
 assert.equal(writes[0].state,'running'); assert.equal(writes.at(-1).state,'failed'); assert.match(writes.at(-1).error,/Source File/);
});
test('starting an existing managed script does not duplicate it', async () => {
 const request=command('start',['casino.js']); const writes=[]; const worker=await job(request);
 await worker.main({pid:1,args:[JSON.stringify(request.args),'result.json',request.id],write:async(file,text)=>writes.push(JSON.parse(text)),ps:()=>[{filename:'casino.js',pid:9}],run:()=>{throw new Error('Must not launch twice');}});
 assert.deepEqual(writes.at(-1).result,{pid:9,alreadyRunning:true});
});
