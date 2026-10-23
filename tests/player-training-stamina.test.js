import test from 'node:test';
import assert from 'node:assert/strict';
import {quotePlayerTrainingStamina,playerTrainingStaminaPayoff} from '../player-training-stamina-policy.js';
import {choosePlayerCombatTraining} from '../player-combat-training-policy.js';
const context={player:{skills:{strength:100,agility:100},exp:{agility:1000},mults:{}},metadata:{baseDifficulty:50000,weights:{strength:1},decays:{strength:1}},effective:{agility:1}};
const cost=.285*(Math.pow(50000,.28)+50000/650);
const quote=(max=cost*1.5,extra={})=>quotePlayerTrainingStamina(context,{stamina:[max,max],cyber:0,time:30000,...extra});
const zero={agility:0},args={nativeRates:zero,rates:zero,seconds:30,baselineGain:.03,projectedGain:.039};
const candidate={kind:'gym',name:'strength',time:30000,costPerSecond:0,score:.0013,rates:zero};
const options={baselineScore:.001,remainingMs:30000,quotaLeft:10,money:1e9,reserve:0};
test('native permanent capacity applies Cyber\'s Edge twice and max-stamina augmentations once',()=>{
 const boosted={...context,player:{...context.player,mults:{bladeburner_max_stamina:2}}};
 const q=quotePlayerTrainingStamina(boosted,{stamina:[100,100],cyber:10,time:30000,speed:5});
 assert.ok(Math.abs(q.capacityPerCompletion-.04*1.2*1.2*2)<1e-12);
 assert.ok(Math.abs(playerTrainingStaminaPayoff(q,args).stamina.bonusCapacity-q.capacityPerCompletion*5)<1e-12);
 assert.equal(quote().capacityPerCompletion,.04);
});
test('permanent Training capacity can reverse a marginal external-XP preference',()=>{
 assert.ok(choosePlayerCombatTraining([candidate],options));
 const result=playerTrainingStaminaPayoff(quote(),args);assert.ok(result.baselineGain>result.projectedGain);assert.ok(result.stamina.nativePenalty>result.stamina.startPenalty);
 assert.equal(choosePlayerCombatTraining([candidate],{...options,stamina:quote(),nativeRates:zero}),null);
});
test('capacity above twice action cost does not change XP decisions',()=>{
 const result=playerTrainingStaminaPayoff(quote(cost*3),args);
 assert.equal(result.baselineGain,args.baselineGain);assert.equal(result.projectedGain,args.projectedGain);assert.equal(result.stamina.startPenalty,1);
 assert.ok(choosePlayerCombatTraining([candidate],{...options,stamina:quote(cost*3),nativeRates:zero}));
});
test('parallel native Training retains its capacity benefit instead of charging it as lost',()=>{
 const result=playerTrainingStaminaPayoff(quote(),{...args,parallel:true});
 assert.equal(result.stamina.parallel,true);assert.equal(result.stamina.nativeMax,result.stamina.externalMax);assert.equal(result.stamina.nativePenalty,result.stamina.externalPenalty);
 assert.ok(choosePlayerCombatTraining([candidate],{...options,simulacrum:true,parallelNative:true,stamina:quote(),nativeRates:zero}));
 assert.equal(choosePlayerCombatTraining([candidate],{...options,simulacrum:true,parallelNative:false,stamina:quote(),nativeRates:zero}),null);
});
test('external agility training receives its own capacity benefit including the zero-penalty boundary',()=>{
 const result=playerTrainingStaminaPayoff(quote(),{...args,rates:{agility:100}});
 assert.ok(result.stamina.externalCapacity>0);assert.ok(result.projectedGain>playerTrainingStaminaPayoff(quote(),args).projectedGain);
 assert.ok(choosePlayerCombatTraining([{...candidate,rates:{agility:100}}],{...options,stamina:quote(),nativeRates:zero}));
 const blocked=quote(cost*.99);const crossing=playerTrainingStaminaPayoff(blocked,{...args,rates:{agility:100}});assert.equal(crossing.stamina.startPenalty,0);assert.ok(crossing.stamina.externalPenalty>0);assert.ok(crossing.projectedGain>0);
});
test('both models credit agility capacity and the decision retains money, quota and rank guards',()=>{
 const result=playerTrainingStaminaPayoff(quote(),{...args,nativeRates:{agility:1}});assert.ok(result.stamina.nativeCapacity>result.stamina.bonusCapacity);
 for(const patch of [{remainingMs:500},{quotaLeft:0},{reserve:Infinity},{rankGap:1,rankRate:1}])assert.equal(choosePlayerCombatTraining([candidate],{...options,...patch,stamina:quote(),nativeRates:zero}),null);
 const paid={...candidate,costPerSecond:100};assert.equal(choosePlayerCombatTraining([paid],{...options,money:1000,reserve:900,stamina:quote(cost*3),nativeRates:zero}),null);
});
test('unknown, corrupt and impossible stamina inputs decline the optional quote safely',()=>{
 for(const patch of [{stamina:null},{stamina:[1,0]},{stamina:[101,100]},{stamina:[NaN,100]},{cyber:-1},{cyber:1.5},{time:0},{speed:6}])assert.equal(quote(undefined,patch),null);
 assert.equal(quotePlayerTrainingStamina({...context,metadata:{}},{stamina:[100,100],cyber:0,time:30000}),null);
 for(const patch of [{seconds:0},{seconds:31},{nativeRates:null},{rates:null},{rates:{agility:Infinity}},{baselineGain:NaN}])assert.equal(playerTrainingStaminaPayoff(quote(),{...args,...patch}),null);
 assert.equal(playerTrainingStaminaPayoff({...quote(),max:-1},args),null);
});


test('capacity credit matches an independent post-cost penalty calculation',()=>{
 const q=quote(),actual=playerTrainingStaminaPayoff(q,args),start=2*(1-cost/q.max),after=2*(1-cost/(q.max+.04));
 const expectedNative=.03*after+100*(after-start),expectedExternal=.039*start;
 assert.ok(Math.abs(actual.baselineGain-expectedNative)<1e-10);assert.ok(Math.abs(actual.projectedGain-expectedExternal)<1e-10);
 const atLimit=playerTrainingStaminaPayoff(quote(cost*2),args);assert.equal(atLimit.stamina.startPenalty,1);assert.equal(atLimit.baselineGain,.03);
});
