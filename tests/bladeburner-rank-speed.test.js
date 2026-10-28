import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {planBladeburnerLevels,bladeburnerRankRate,nextBladeburnerProgressSkill,bladeburnerSkillContext,spendBladeburnerSkills,bladeburnerSkillGoal,nextSkill,bladeburnerStaminaChance} from '../bladeburner-policy.js';
import {bladeburnerRankDetour,bladeburnerSwitchWorthwhile} from '../bladeburner-rank-policy.js';
import {valueBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';

function levelFixture(){let level=37,calls=0;return {api:{getActionCurrentLevel:()=>level,getActionMaxLevel:()=>160,getActionAutolevel:()=>false,setActionLevel:(_t,_n,l)=>{level=l;calls++;},getActionEstimatedSuccessChance:()=>[1,1],getActionTime:()=>1000*Math.ceil(Math.max(1,1.02**(level-149))),getActionRankGain:()=>.3*1.041**(level-1),getActionRankLoss:()=>0},level:()=>level,calls:()=>calls};}
test('duration boundary search finds the exhaustive optimum within the existing budget and restores native level',()=>{
 const f=levelFixture(),r=planBladeburnerLevels(f.api,[['Tracking','Contracts']],.99,bladeburnerRankRate,()=>true).Tracking;
 let exhaustive={score:0};for(let l=1;l<=160;l++){f.api.setActionLevel('Contracts','Tracking',l);const score=bladeburnerRankRate([1,1],{time:f.api.getActionTime(),gain:f.api.getActionRankGain(),loss:0});if(score>exhaustive.score)exhaustive={level:l,score};}
 assert.equal(r.level,149);assert.deepEqual({level:r.level,score:r.score},exhaustive);assert.ok(r.probes<=128);
 const g=levelFixture();planBladeburnerLevels(g.api,[['Tracking','Contracts']],.99,bladeburnerRankRate,()=>true);assert.equal(g.level(),37);
});
test('limited or interrupted duration search never exceeds its budget and restores settings',()=>{
 for(const budget of [1,8,32]){const f=levelFixture(),r=planBladeburnerLevels(f.api,[['Tracking','Contracts']],.99,bladeburnerRankRate,()=>true,null,null,budget);assert.ok(!r.Tracking||r.Tracking.probes<=budget);assert.equal(f.level(),37);}
 const f=levelFixture();let polls=0;planBladeburnerLevels(f.api,[['Tracking','Contracts']],.99,bladeburnerRankRate,()=>++polls<12);assert.equal(f.level(),37);
});
function skills(){let level=0,points=50;const bought=[];let costReads=0;const factor=.5*(100**.04+100**.035+.01+.01),context={target:'X',rank:100,requiredRank:1000,chance:[1,1],threshold:.99,skills:{agility:100,dexterity:100},mults:{bladeburner_stamina_gain:1},stamina:[1e9,1e9],throughputs:[{type:'Contracts',difficulty:10*factor*32,gain:100,loss:0,chance:1}]};
 const api={getSkillLevel:n=>n==='Overclock'?level:0,getSkillPoints:()=>points,getSkillUpgradeCost:(_n,count=1)=>{costReads++;let sum=0;for(let i=0;i<count;i++)sum+=Math.ceil(3+1.4*(level+i));return sum;},upgradeSkill:(name,count=1)=>{const cost=api.getSkillUpgradeCost(name,count);assert.ok(cost<=points);assert.ok(level+count<=90);points-=cost;level+=count;bought.push({name,count,cost});return true;}};
 return {api,context,bought,level:()=>level,points:()=>points,reads:()=>costReads};
}
test('Overclock can cross a rounded timing plateau using a natively priced bundle',()=>{
 const f=skills(),names=['Overclock'],levels={Overclock:0},costs={Overclock:3};
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,50,{},f.context,nextSkill),null);
 const q=bladeburnerSkillContext(f.api,names,()=>f.context),choice=nextBladeburnerProgressSkill(names,levels,costs,50,{},q,nextSkill);
 assert.equal(choice.name,'Overclock');assert.ok(choice.count>=4);assert.ok(Math.ceil(32*(1-.01*choice.count))<32);
 const bought=spendBladeburnerSkills(f.api,names,{},nextBladeburnerProgressSkill,()=>true,()=>f.context,bladeburnerSkillContext);
 assert.equal(bought.length,f.level());assert.ok(f.bought.some(x=>x.count>1));assert.ok(f.points()>=0);
 const goal=bladeburnerSkillGoal(f.api,names,{},nextBladeburnerProgressSkill,()=>f.context,bladeburnerSkillContext);
 assert.equal(goal.name,'Overclock');assert.ok(goal.count>=1);assert.equal(goal.cost,f.api.getSkillUpgradeCost('Overclock',goal.count));
});
test('native skill batches reprice, honor pause and reject malformed bundle sizes',()=>{
 let mutations=0;const api={getSkillLevel:()=>0,getSkillPoints:()=>10,getSkillUpgradeCost:()=>100,upgradeSkill:()=>{mutations++;return true;}};
 for(const count of [0,91,NaN,2.5])assert.deepEqual(spendBladeburnerSkills(api,['Overclock'],{},()=>({name:'Overclock',count}),()=>true),[]);
 assert.deepEqual(spendBladeburnerSkills(api,['Overclock'],{},()=>({name:'Overclock',count:4,cost:1}),()=>true),[]);
 let checks=0;assert.deepEqual(spendBladeburnerSkills({...api,getSkillUpgradeCost:()=>1},['Overclock'],{},()=>({name:'Overclock',count:4}),()=>++checks===1),[]);assert.equal(mutations,0);
});
test('bundle quotes cache only within a synchronous batch and fail gracefully on unavailable multi-cost API',()=>{
 const f=skills(),cache=new Map();bladeburnerSkillContext(f.api,['Overclock'],()=>f.context,cache);const reads=f.reads();bladeburnerSkillContext(f.api,['Overclock'],()=>f.context,cache);assert.equal(f.reads()-reads,1);
 const legacy=bladeburnerSkillContext({...f.api,getSkillUpgradeCost:(_n,count=1)=>{if(count>1)throw Error('unavailable');return 3;}},['Overclock'],()=>f.context);assert.equal(legacy,f.context);
 const native=Function('return ('+bladeburnerSkillContext.toString()+')')();assert.ok(native(f.api,['Overclock'],()=>f.context).overclockBundles.length<=89);
});
test('growth detours explicitly price rank delay and reject an unproved expensive sacrifice',()=>{
 const before={name:'Rank',level:1,score:1,rankRate:10},candidate={name:'Grow',level:1,kind:'mission',score:2,rankRate:5};
 assert.equal(bladeburnerRankDetour(candidate,before,{rankEtaMs:600000}).allowed,false);
 const good=bladeburnerRankDetour(candidate,before,{rankEtaMs:600000,statEtaMs:900000});assert.equal(good.allowed,true);assert.equal(good.rankDelayMs,15000);assert.ok(good.afterEtaMs<good.beforeEtaMs);
 assert.equal(bladeburnerRankDetour(candidate,before,{rankEtaMs:600000,statEtaMs:200000}).allowed,false);
 assert.equal(bladeburnerRankDetour({...candidate,rankRate:9.6},before,{rankEtaMs:600000}).allowed,true);
 assert.equal(bladeburnerRankDetour({...candidate,rankRate:null},before,{rankEtaMs:600000}).allowed,false);
 assert.equal(bladeburnerRankDetour({...candidate,rankRate:11},before,{}).allowed,true);
});
test('detour runway uses the counterfactual rank action instead of a slower observed growth rate',()=>{
 const base={name:'Rank',level:1,score:1,rankRate:10},candidate={name:'Grow',level:1,kind:'mission',score:2,rankRate:9.6};
 assert.equal(bladeburnerRankDetour(candidate,base,{rankEtaMs:600000}).allowed,true);
 assert.equal(bladeburnerRankDetour(candidate,base,{rankEtaMs:600000,rankGap:1}).allowed,false);
});
test('growth rank rates price whole completions and stock limits using the same finite horizon',()=>{
 const raw={name:'X',kind:'mission',time:10000,score:1,duty:1,rates:{},supply:1,rankPerCycle:100};
 const q=valueBladeburnerStaminaGrowth(raw,null,{bonusMs:0},30);assert.equal(q.completion.count,1);assert.equal(q.rankRate,100/30);
 assert.equal(valueBladeburnerStaminaGrowth({...raw,supply:0},null,{bonusMs:0},30).rankRate,0);
});
test('switch hysteresis charges partial progress but eventually adopts small sustained gains',()=>{
 const q={beforeScore:10,afterScore:10.5,timeMs:30000,progressMs:0};assert.equal(bladeburnerSwitchWorthwhile(q),false);
 assert.equal(bladeburnerSwitchWorthwhile({...q,afterScore:20}),true);
 assert.equal(bladeburnerSwitchWorthwhile({...q,afterScore:11.1,progressMs:29000}),false);
 assert.equal(bladeburnerSwitchWorthwhile({...q,afterScore:10.2,heldMs:60000}),true);
 assert.equal(bladeburnerSwitchWorthwhile({...q,beforeScore:NaN}),true);
});
test('actual controller hysteresis bypasses recovery, Black Ops, high chaos and unsafe incumbent chances',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),a=s.indexOf('        let keepIncumbent=false;'),b=s.indexOf('        if(bestActionName===currentAction.name',a),block=s.slice(a,b)+';globalThis.keep=keepIncumbent;';
 const fixture=()=>({urgent:false,interrupted:false,currentAction:{name:'Tracking'},bestActionName:'Bounty Hunter',nextBlackOp:'Black',contractNames:['Tracking','Bounty Hunter'],operationNames:[],currentCity:'A',chaosByCity:{A:0},options:{'chaos-recovery-threshold':50,'success-threshold':.99,'update-interval':2000},actionProgress:{metrics:{level:1,time:1000,gain:10,loss:0,chance:[1,1],team:0},progress:0},bladeburnerDifficulty:{Tracking:{base:1,factor:1}},stamina:[100,100],actionMetrics:{Tracking:{time:1000,gain:10,loss:0},'Bounty Hunter':{time:1000,gain:10.5,loss:0}},getChance:()=>[1,1],bladeburnerStaminaChance,bladeburnerRankRate,bladeburnerSwitchWorthwhile,growthChoice:null,growthComparisons:null,mainLoop:{lastActionSwitchAt:Date.now()}});
 const base=fixture();vm.runInNewContext(block,base);assert.equal(base.keep,true);
 const differentLevel=fixture();differentLevel.growthChoice={score:10.5};differentLevel.growthComparisons={Tracking:{level:2,score:100}};vm.runInNewContext(block,differentLevel);assert.equal(differentLevel.keep,false);
 for(const change of [x=>x.urgent=true,x=>x.nextBlackOp='Bounty Hunter',x=>x.chaosByCity.A=100,x=>x.actionProgress.metrics.chance=[.5,.5]]){const c=fixture();change(c);vm.runInNewContext(block,c);assert.equal(c.keep,false);}
});
