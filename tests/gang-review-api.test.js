import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,commandPolicyVersion} from '../remote-api-command-policy.js';
test('gang review queries are read-only and mutating gang methods remain unavailable',()=>{
 assert.equal(commandPolicyVersion,31);
 const command=method=>({id:'gang-review',method,args:[],expiresAt:Date.now()+60000});
 for(const method of ['gang.getAllGangInformation','gang.getMemberInformation','gang.getAscensionResult','gang.getTaskStats','gang.getBonusTime'])assert.doesNotThrow(()=>validateCommand(command(method)));
 for(const method of ['gang.setTerritoryWarfare','gang.ascendMember','gang.purchaseEquipment','gang.setMemberTask'])assert.throws(()=>validateCommand(command(method)),/Unsupported/);
});

