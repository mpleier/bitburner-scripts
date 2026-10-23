import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readBladeburnerMissionProgress as read,bladeburnerMissionProgress as reuse,readBladeburnerTrainingProgress} from '../bladeburner-growth-clock-policy.js';
import {bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {valueBladeburnerStaminaGrowth as value,bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
const stamp=Date.now(),snapshot={at:stamp,type:'Contracts',name:'Tracking',city:'A',level:3,team:0,autoLevel:false,time:10000,progressMs:9000};
const candidate={type:'Contracts',name:'Tracking',city:'A',level:3,team:0,time:10000,restart:false};
const api=()=>({getCurrentAction:()=>({type:'Contract',name:'Tracking'}),getCity:()=> 'A',getActionCurrentLevel:()=>3,getTeamSize:()=>2,getActionAutolevel:()=>false,getActionTime:()=>10000,getActionCurrentTime:()=>9000});
const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
test('native snapshot captures repeatable configuration and aliases without mutating the game',()=>{
 const b=api(),calls=[];for(const key of ['startAction','setActionLevel','switchCity','setTeamSize'])b[key]=()=>{calls.push(key);throw Error('mutation');};
 assert.deepEqual(read(b,stamp),snapshot);assert.equal(reuse(read(b,stamp),candidate,stamp),9000);
 b.getCurrentAction=()=>({type:'Operation',name:'Tracking'});assert.equal(read(b,stamp).type,'Operations');assert.equal(read(b,stamp).team,2);assert.deepEqual(calls,[]);
});
test('unsupported actions and optional API failures discard every partial mission snapshot',()=>{
 for(const a of [null,{type:'General',name:'Training'},{type:'Black Operations',name:'Tracking'},{type:'Contracts',name:''}]){const b=api();b.getCurrentAction=()=>a;assert.equal(read(b,stamp),null);}
 for(const key of ['getCurrentAction','getCity','getActionCurrentLevel','getActionAutolevel','getActionTime','getActionCurrentTime']){const b=api();b[key]=()=>{throw Error('Source File unavailable');};assert.equal(read(b,stamp),null);}
 const b=api();b.getCurrentAction=()=>({type:'Operations',name:'Tracking'});b.getTeamSize=()=>{throw Error('unknown team');};assert.equal(read(b,stamp),null);
});
test('every changed configuration and restart requirement removes progress credit',()=>{
 for(const patch of [{type:'Operations'},{name:'Retirement'},{city:'B'},{level:4},{team:1},{time:10001},{restart:true},{restart:undefined}])assert.equal(reuse(snapshot,{...candidate,...patch},stamp),0,JSON.stringify(patch));
 assert.equal(reuse({...snapshot,autoLevel:true},candidate,stamp),0);assert.equal(reuse({...snapshot,autoLevel:undefined},candidate,stamp),0);
 assert.equal(reuse({...snapshot,type:'Operations',team:2},{...candidate,type:'Operations',team:2},stamp),9000);
});
test('stale, future, malformed and impossible progress observations cannot be reused',()=>{
 assert.equal(reuse(snapshot,candidate,stamp+5000),9000);assert.equal(reuse(snapshot,candidate,stamp+5001),0);assert.equal(reuse(snapshot,candidate,stamp-1),0);
 for(const patch of [{at:NaN},{at:Infinity},{type:'General'},{level:0},{level:1.5},{team:-1},{team:.5},{city:''},{name:''},{time:0},{time:Infinity},{progressMs:-1},{progressMs:10001},{progressMs:NaN}])assert.equal(reuse({...snapshot,...patch},candidate,stamp),0);
 assert.equal(reuse(null,candidate,stamp),0);assert.equal(reuse(snapshot,null,stamp),0);assert.equal(reuse(snapshot,candidate,NaN),0);
});
function parentActions(s=snapshot,plan=null){
 const start=source.indexOf('        const actions=unreservedActions.filter',source.indexOf('const q=await getNsDataThroughFile(ns,`(()=>{const b=ns.bladeburner,reaper=')),end=source.indexOf('        const growthContext=',start);
 const c={rank:100,rankReserves:{},bladeburnerRankSupply:()=>10,q:{missionProgress:s},unreservedActions:['Tracking','Retirement'],nextBlackOp:'Target',getCount:()=>10,minChance:()=>1,getChance:()=>[1,1],options:{'success-threshold':.99},actionMetrics:{Tracking:{time:10000,gain:1,loss:0,level:3},Retirement:{time:10000,gain:1,loss:0,level:3}},bladeburnerDifficulty:{Tracking:{base:1,factor:1},Retirement:{base:1,factor:1}},levelPlans:plan?{Tracking:plan}:{},bladeburnerRankRate:(_chance,_metrics,timing)=>{timing.duty=1;return 1;},bladeburnerXpWeights:{Tracking:{strength:1},Retirement:{strength:1}},contractNames:['Tracking','Retirement'],currentCity:'A',bladeburnerMissionProgress:reuse};
 assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end)+';globalThis.result=actions;',c);return c.result;
}
test('executed parent forwards progress only for an unchanged action and continuing level/team plan',()=>{
 const fresh={...snapshot,at:Date.now()},keep={level:3,currentLevel:3,autoLevel:false};
 assert.equal(parentActions(fresh)[0].progressMs,9000);assert.equal(parentActions(fresh)[1].progressMs,0);assert.equal(parentActions(fresh,keep)[0].progressMs,9000);
 for(const patch of [{level:4},{currentLevel:2},{autoLevel:true},{team:1,currentTeam:0}])assert.equal(parentActions(fresh,{...keep,...patch})[0].progressMs,0);
 assert.equal(parentActions(null)[0].progressMs,0);assert.equal(parentActions({...fresh,city:'B'})[0].progressMs,0);
});
test('actual generated native context embeds the reader and isolates its optional failure',()=>{
 const literal=source.match(/const q=await getNsDataThroughFile\(ns,(`[^`]+`),`\/Temp\/bladeburner-growth-context.txt`/)[1];
 const body=Function('readBladeburnerTrainingProgress','readBladeburnerMissionProgress','return '+literal)(readBladeburnerTrainingProgress,read);
 const b={...api(),getSkillLevel:()=>0,getBonusTime:()=>0,getStamina:()=>[100,100]},ns={bladeburner:b,getPlayer:()=>({})};
 const q=vm.runInNewContext(body,{ns});assert.equal(q.missionProgress.progressMs,9000);assert.equal(q.trainingProgressMs,0);
 b.getActionCurrentLevel=()=>{throw Error('Unavailable');};const fallback=vm.runInNewContext(body,{ns});assert.equal(fallback.missionProgress,null);assert.equal(fallback.stamina[1],100);
});
const keys=['strength','defense','dexterity','agility'],context={player:{skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{}},metadata:{baseDifficulty:100,weights:{strength:1},decays:{strength:1}}};
test('progress advances whole completion budget without changing raw XP or per-completion rewards',()=>{
 const training={kind:'training',name:'Training',time:30000,score:.001,rates:{agility:0}},q=quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000});
 const raw=bladeburnerGrowthChoice([{name:'Tracking',time:10000,difficulty:1,chance:1,duty:1,weights:{strength:1},progressMs:9000}],context),fresh=value({...raw,progressMs:0},training,q,5),continuing=value(raw,training,q,5);
 assert.equal(raw.progressMs,9000);assert.equal(fresh.score,0);assert.equal(continuing.completion.count,1);assert.equal(continuing.completion.progressMs,9000);assert.equal(continuing.rates,raw.rates);assert.equal(continuing.xpScore,raw.score);assert.equal(continuing.score,raw.score*2);
 for(const progressMs of [NaN,-1,10001])assert.equal(value({...raw,progressMs},training,q,5).completion.count,0);
 const upkeep=value({...raw,duty:.5},training,q,15);assert.equal(upkeep.completion.count,1);assert.equal(upkeep.score,raw.score*20/15);
});
test('generated probe evaluator retains fresh-start scoring without hidden parent progress',()=>{
 const b={getActionTime:()=>30000,getSkillLevel:()=>0,getStamina:()=>[100,100],getBonusTime:()=>0,getCurrentAction:()=>({type:'Contracts',name:'Tracking'}),getActionCurrentTime:()=>9000};
 const evaluate=vm.runInNewContext(bladeburnerStaminaGrowthSource)(b,context,0,bladeburnerGrowthChoice,5);
 const raw={name:'Tracking',time:10000,difficulty:1,chance:1,duty:1,weights:{strength:1}};
 assert.equal(evaluate([raw],context,{}).completion.count,0);
});
