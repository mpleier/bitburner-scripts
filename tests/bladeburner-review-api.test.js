import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,commandPolicyVersion} from '../remote-api-command-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const command=(method,args=[],id='bladeburner-review')=>({id,method,args,expiresAt:Date.now()+60000});
const job=async request=>await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(request)).toString('base64'));

test('bladeburner review queries are read-only and mutating actions remain unavailable',()=>{
 assert.equal(commandPolicyVersion,33);
 for(const method of ['bladeburner.getRank','bladeburner.getCity','bladeburner.getStamina','bladeburner.getTeamSize','bladeburner.getBonusTime','bladeburner.getSkillNames','bladeburner.getBlackOpNames','bladeburner.getCityChaos'])assert.doesNotThrow(()=>validateCommand(command(method)),method);
 for(const method of ['bladeburner.getSkillLevel','bladeburner.getBlackOpRank','bladeburner.getActionCountRemaining','bladeburner.getActionTime','bladeburner.getActionEstimatedSuccessChance','bladeburner.getActionRepGain'])assert.doesNotThrow(()=>validateCommand(command(method,['Operations','Assassination'])),method);
 for(const method of ['bladeburner.startAction','bladeburner.stopBladeburnerAction','bladeburner.switchCity','bladeburner.upgradeSkill','bladeburner.setActionAutolevel','bladeburner.recruitTeamMember','bladeburner.setTeamSize','bladeburner.joinBladeburnerDivision'])assert.throws(()=>validateCommand(command(method)),/Unsupported/,method);
});

test('bladeburner review queries dispatch through the native namespace and keep their arguments',async()=>{
 const rank=command('bladeburner.getRank'),rankWrites=[],rankJob=await job(rank);
 await rankJob.main({pid:1,args:[JSON.stringify(rank.args),'result.json',rank.id],write:async(_f,text)=>rankWrites.push(JSON.parse(text)),bladeburner:{getRank:()=>11694}});
 assert.equal(rankWrites.at(-1).state,'completed');assert.equal(rankWrites.at(-1).result,11694);

 const chance=command('bladeburner.getActionEstimatedSuccessChance',['Operations','Assassination']),chanceWrites=[],seen=[];
 const chanceJob=await job(chance);
 await chanceJob.main({pid:1,args:[JSON.stringify(chance.args),'result.json',chance.id],write:async(_f,text)=>chanceWrites.push(JSON.parse(text)),bladeburner:{getActionEstimatedSuccessChance:(...args)=>{seen.push(args);return [1,1];}}});
 assert.equal(chanceWrites.at(-1).state,'completed');assert.deepEqual(chanceWrites.at(-1).result,[1,1]);assert.deepEqual(seen,[['Operations','Assassination']]);
});

test('bladeburner review queries report unavailable Bladeburner API failures without throwing',async()=>{
 const request=command('bladeburner.getCity'),writes=[],worker=await job(request);
 await worker.main({pid:1,args:[JSON.stringify(request.args),'result.json',request.id],write:async(_f,text)=>writes.push(JSON.parse(text)),bladeburner:{getCity:()=>{throw new Error('Bladeburner API unavailable');}}});
 assert.equal(writes.at(-1).state,'failed');assert.match(writes.at(-1).error,/Bladeburner API unavailable/);
});
