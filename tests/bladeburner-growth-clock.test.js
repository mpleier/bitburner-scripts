import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerGrowthClock as clock,forecastBladeburnerGrowthDuty as duty} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {valueBladeburnerStaminaGrowth as value,bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import {bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {choosePlayerCombatTraining} from '../player-combat-training-policy.js';
import {readBladeburnerMaintenance} from '../bladeburner-snapshot-readers.js';
const stats=['strength','defense','dexterity','agility'];
const player={skills:Object.fromEntries(stats.map(k=>[k,100])),exp:Object.fromEntries(stats.map(k=>[k,1000])),mults:{}};
const context={player,metadata:{baseDifficulty:100,weights:{strength:1,agility:1},decays:{strength:1,agility:1}}};
const quote=bonusMs=>quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000,bonusMs});
const rates={strength:2,agility:5},training={kind:'training',name:'Training',score:.001,rates,time:30000};
const recovery={combatMs:1000,otherMs:2000,recoveryMs:10000/3,cost:16,passive:2,hrc:1};
const mission={kind:'mission',name:'Tracking',score:.002,rates,time:1000,duty:3/19,recovery};
test('finite bonus clock reserves one tick and spends a single shared work budget',()=>{
 for(const [bonus,work]of [[0,30],[1000,30],[11000,40],[61000,90],[121000,150],[999999,150]]){
  const c=clock(30,bonus);assert.equal(c.workSeconds,work);assert.equal(c.consumedMs,(work-30)*1000);assert.equal(c.remainingMs,bonus-c.consumedMs);assert.ok(c.multiplier>=1&&c.multiplier<=5);
 }
 assert.equal(clock(10,41000).multiplier,5);
 for(const seconds of [0,-1,31,Infinity,NaN])assert.equal(clock(seconds,1000),null);
 for(const bonus of [-1,Infinity,NaN])assert.equal(clock(30,bonus),null);
});
test('regeneration reprices only recovery and never exceeds the original duty ceiling',()=>{
 const q=quote(0),d=duty(q,mission,30);
 assert.ok(d.factor>1);assert.ok(d.recoveryMs<recovery.recoveryMs);assert.equal(d.otherMs,2000);
 assert.ok(d.factor*mission.duty<=1);assert.equal(d.factor,(3000+recovery.recoveryMs)/(3000+d.recoveryMs));
 assert.ok(d.endRegen>d.startRegen);assert.ok(d.endMax>q.max);
 assert.equal(duty(q,{...mission,recovery:{...recovery,recoveryMs:0}},30).factor,1);
 assert.ok(Math.abs(duty(q,{...mission,rates:{agility:0}},30).factor-1)<1e-12);
});
test('unknown or malformed recovery cannot invent a duty improvement',()=>{
 for(const c of [training,{...mission,recovery:null},{...mission,recovery:{...recovery,recoveryMs:99999}},{...mission,duty:0},{...mission,rates:{agility:Infinity}},{...mission,recovery:{...recovery,hrc:NaN}},{...mission,recovery:{...recovery,otherMs:-1}}])assert.equal(duty(quote(0),c,30).factor,1);
 assert.equal(duty(null,mission,30).factor,1);assert.equal(duty(quote(0),mission,31).factor,1);
});
test('finite acceleration scales native capacity and XP while raw rates remain unchanged',()=>{
 const normal=value(training,training,quote(0)),partial=value(training,training,quote(61000)),full=value(training,training,quote(121000));
 assert.equal(partial.score,normal.score*3);assert.equal(full.score,normal.score*5);
 assert.equal(partial.stamina.bonusCapacity,normal.stamina.bonusCapacity*3);
 assert.equal(partial.rates,rates);assert.equal(partial.xpScore,training.score);
 const raw={...mission,recovery:null},m=value(raw,training,quote(61000));assert.equal(m.score,raw.score*Math.floor(90000/(raw.time/raw.duty))*(raw.time/raw.duty)/30000);assert.equal(m.rates,rates);
 const improved=value(mission,training,quote(61000));assert.equal(improved.bonus.multiplier,3);assert.ok(improved.regeneration.factor>1);assert.equal(improved.rates,rates);
});
test('serialized worker reads bonus time and safely handles unavailable optional API',()=>{
 const factory=vm.runInNewContext(bladeburnerStaminaGrowthSource);
 const api={getActionTime:()=>30000,getStamina:()=>[100,100],getSkillLevel:()=>0,getBonusTime:()=>61000};
 const evaluate=()=>factory(api,context,0,bladeburnerGrowthChoice)([],context,{trainingTime:30000,trainingAllowed:true});
 assert.equal(evaluate().bonus.multiplier,3);
 for(const invalid of [NaN,-1,Infinity]){api.getBonusTime=()=>invalid;assert.equal(evaluate().bonus.multiplier,1);}
 api.getBonusTime=()=>{throw Error('Unavailable');};assert.equal(evaluate().bonus.multiplier,1);
});
test('external work is not accelerated and finite bonus can change the preferred comparison',()=>{
 const candidate={kind:'crime',name:'Mug',score:2,costPerSecond:0,time:1000,rates:{strength:2}};
 const options={baselineScore:1,remainingMs:30000,quotaLeft:1,money:1000,reserve:0};
 const normal=choosePlayerCombatTraining([candidate],options),partial=choosePlayerCombatTraining([candidate],{...options,bonusMs:11000});
 assert.equal(partial.projectedGain,normal.projectedGain);assert.equal(partial.baselineGain,40);
 assert.equal(choosePlayerCombatTraining([candidate],{...options,bonusMs:121000}),null);
});
test('snapshot exposes bonus milliseconds and city cache saturates without losing depletion changes',()=>{
 const snapshot=readBladeburnerMaintenance({bladeburner:{getBonusTime:()=>61000,getActionCountRemaining:()=>1}},[]);assert.equal(snapshot.maintenance.bonusMs,61000);
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),line=s.split('\n').find(l=>l.includes('const key=JSON.stringify([cityGrowthTarget'));
 const key=bonusMs=>{const c={cityGrowthTarget:'T',candidates:[],actions:[],options:{},maintenanceKey:'m',rankReserves:{},reserveSupply:[],currentCity:'A',squadKey:'s',cityState:{maintenance:{bonusMs}},developmentBudget:{spentMs:0}};vm.runInNewContext(line+';globalThis.result=key;',c);return c.result;};
 assert.notEqual(key(61000),key(60000));assert.equal(key(61000),key(61999));assert.equal(key(121000),key(999999));
});
