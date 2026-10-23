import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bladeburnerDevelopmentAction,prepareBladeburnerTeam,requiredBladeburnerTeam,bladeburnerStaminaChance} from '../bladeburner-policy.js';

const blocked={rank:5000,requiredRank:5000,chance:[.8,1],remainingMs:0,trainingEnabled:false};
test('analysis survives training count and time limits but respects global disable and rank gates',()=>{
 assert.equal(bladeburnerDevelopmentAction(blocked),'Field Analysis');
 assert.equal(bladeburnerDevelopmentAction({...blocked,chance:[.5,.6],remainingMs:120000}),null);
 assert.equal(bladeburnerDevelopmentAction({...blocked,enabled:false}),null);
 assert.equal(bladeburnerDevelopmentAction({...blocked,rank:100}),null);
 assert.equal(bladeburnerDevelopmentAction({...blocked,chance:[1,1]}),null);
 assert.equal(bladeburnerDevelopmentAction({...blocked,trainingEnabled:true,chance:[.5,.6],remainingMs:120000}),'Training');
});
function teamApi({available=10,previous=3,stamina=[100,100],base=.9}={}){
 const state={assigned:previous,changes:0,stamina};
 const api={getTeamSize:type=>type?state.assigned:available,setTeamSize:(_t,_n,n)=>{state.changes++;state.assigned=n;return n;},getStamina:()=>state.stamina,getActionEstimatedSuccessChance:()=>{const p=Math.min(1,base*(state.assigned+1)**.05);return [p,p];}};
 return {state,api};
}
test('team probes use projected chances and choose the smallest verified squad',()=>{
 const {state,api}=teamApi();const calls=[];
 const forecast=(chance,stamina,difficulty)=>{calls.push({chance,stamina,difficulty});return bladeburnerStaminaChance(chance,stamina,difficulty);};
 const plan=prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,forecast,2000);
 assert.equal(plan.state,'ready');assert.equal(plan.required,6);assert.equal(state.assigned,6);assert.ok(plan.chance[0]>=.99);
 assert.ok(calls.length>=4);assert.ok(calls.every(c=>c.difficulty===2000));
});
test('depleted stamina cannot trigger ineffective recruitment or mutate existing assignments',()=>{
 const {state,api}=teamApi({available:0,previous:0,stamina:[50,100],base:.99});
 const plan=prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,bladeburnerStaminaChance,2000);
 assert.equal(plan.state,'needs-stamina');assert.match(plan.reason,/Recover stamina/);assert.equal(state.changes,0);
 state.stamina=[1,1];
 const small=prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,bladeburnerStaminaChance,2000);
 assert.equal(small.state,'needs-stamina');assert.match(small.reason,/maximum stamina/);assert.equal(state.changes,0);
});
test('missing predictor data fails closed without spending or changing the team',()=>{
 const {state,api}=teamApi();
 assert.equal(prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,bladeburnerStaminaChance,null).state,'unavailable');
 assert.equal(state.changes,0);assert.equal(state.assigned,3);
});
test('projected team probing restores prior assignment on cancellation by native errors',()=>{
 const {state,api}=teamApi();let calls=0;
 const forecast=(c,s,d)=>{if(++calls===4)throw Error('native probe failed');return bladeburnerStaminaChance(c,s,d);};
 assert.equal(prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,forecast,2000).state,'unavailable');
 assert.equal(state.assigned,3);
});
test('insufficient safe teams still produce bounded recruitment requirements',()=>{
 const {state,api}=teamApi({available:2,previous:1});
 const plan=prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam,bladeburnerStaminaChance,2000);
 assert.equal(plan.state,'needs-recruitment');assert.equal(plan.required,6);assert.equal(state.assigned,2);
});
test('team and development helpers serialize without hidden imports',()=>{
 const prepare=Function('return ('+prepareBladeburnerTeam.toString()+')')();
 const forecast=Function('return ('+bladeburnerStaminaChance.toString()+')')();
 const required=Function('return ('+requiredBladeburnerTeam.toString()+')')();
 const {api}=teamApi();assert.equal(prepare(api,'X',.99,30,required,forecast,2000).state,'ready');
 const development=Function('return ('+bladeburnerDevelopmentAction.toString()+')')();
 assert.equal(development(blocked),'Field Analysis');
});
test('actual team worker executes native stamina API and serializes the forecast',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(source.includes('getStamina:()=>ns.bladeburner.getStamina()'));
 assert.ok(source.includes('requiredBladeburnerTeam.toString()}),(${bladeburnerStaminaChance.toString()}),ns.args[4]'));
 assert.ok(source.includes("trainingEnabled:trainingMilestone.eligible"));
 assert.ok(source.includes("teamPlan.state==='needs-stamina'"));
});

test('small post-cost penalties increase the verified team requirement instead of reusing raw sizing',()=>{
 const cost=.285*(2000**.28+2000/650);
 const raw=teamApi({available:30,previous:0,stamina:[cost+49.75,100]});
 const rawPlan=prepareBladeburnerTeam(raw.api,'X',.99,30,requiredBladeburnerTeam);
 const projected=teamApi({available:30,previous:0,stamina:[cost+49.75,100]});
 const plan=prepareBladeburnerTeam(projected.api,'X',.99,30,requiredBladeburnerTeam,bladeburnerStaminaChance,2000);
 assert.equal(rawPlan.required,6);assert.equal(plan.required,7);assert.equal(projected.state.assigned,7);
 assert.ok(plan.chance[0]>=.99);
});
