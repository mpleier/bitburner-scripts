import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blackOpMetadata} from '../bladeburner-action-data.js';
import {nextBladeburnerProgressSkill,nextSkill} from '../bladeburner-policy.js';
import {bestSleeveCrime,sleeveCrimeChance,sleeveStartupPlan,bestFactionWork,sleeveRepAssignments} from '../sleeve-policy.js';
import {seedSleevesSource} from '../casino-bootstrap-policy.js';
import {autopilotSourceFiles,autopilotStockReserve} from '../autopilot-policy.js';
import {fallbackBitNodeMultipliers} from '../bitnode-fallbacks.js';

const context=(name,extra={})=>({target:name,metadata:blackOpMetadata[name],rank:1e9,requiredRank:2500,chance:[.5,.6],threshold:.99,staminaPct:1,...extra});
const choose=(name,names,levels={},costs={},extra={})=>nextBladeburnerProgressSkill(names,Object.fromEntries(names.map(n=>[n,levels[n]||0])),Object.fromEntries(names.map(n=>[n,costs[n]||10])),100,{},context(name,extra),nextSkill);
test('all 21 Black Ops carry native category flags and full stat coefficients',()=>{
 assert.equal(Object.keys(blackOpMetadata).length,21);
 assert.equal(blackOpMetadata['Operation Typhoon'].isKill,true);
 assert.equal(blackOpMetadata['Operation Zero'].isStealth,true);
 assert.equal(blackOpMetadata['Operation Typhoon'].weights.strength,.2);
 assert.equal(blackOpMetadata['Operation Typhoon'].decays.strength,.8);
 for(const data of Object.values(blackOpMetadata))for(const stat of ['hacking','strength','defense','dexterity','agility','charisma','intelligence']){
  assert.ok(Number.isFinite(data.weights[stat]));assert.ok(Number.isFinite(data.decays[stat]));
 }
});
test('retirement and stealth skill bonuses are considered only on applicable Black Ops',()=>{
 assert.equal(choose('Operation Typhoon',['Short-Circuit','Cloak','Digital Observer']),'Short-Circuit');
 assert.equal(choose('Operation Zero',['Short-Circuit','Cloak','Digital Observer']),'Cloak');
 assert.equal(choose('Operation Typhoon',['Cloak']),null);
 assert.equal(choose('Operation Zero',['Short-Circuit']),null);
 assert.equal(choose('Unknown operation',['Short-Circuit','Cloak']),null);
});
test('category skills honor affordability and native diminishing marginal bonuses',()=>{
 assert.equal(choose('Operation Typhoon',['Short-Circuit','Digital Observer'],{}, {'Short-Circuit':200,'Digital Observer':10}),'Digital Observer');
 assert.equal(choose('Operation Typhoon',['Short-Circuit','Digital Observer'],{'Short-Circuit':100}),'Digital Observer');
});
test('combat skill gains use the operation weighted competence and decay exponents',()=>{
 const skills={hacking:100,strength:100,defense:100,dexterity:100,agility:100,charisma:100,intelligence:100};
 // All combat stats versus only dexterity and agility; native Typhoon gives equal combat weights.
 const competence=(reaper,evasive)=>Object.entries(blackOpMetadata['Operation Typhoon'].weights).reduce((sum,[k,w])=>{
  let stat=skills[k];if(['strength','defense','dexterity','agility'].includes(k))stat*=1+.02*reaper;
  if(['dexterity','agility'].includes(k))stat*=1+.04*evasive;
  return sum+w*stat**blackOpMetadata['Operation Typhoon'].decays[k];
 },0);
 const base=competence(0,0),expected=competence(1,0)/base-1>competence(0,1)/base-1?'Reaper':'Evasive Systems';
 assert.equal(choose('Operation Typhoon',['Reaper','Evasive Systems'],{}, {},{skills}),expected);
 const hackingOnly={isKill:false,isStealth:false,weights:{hacking:1},decays:{hacking:.6}};
 assert.equal(choose('Operation Typhoon',['Reaper','Digital Observer'],{}, {},{skills,metadata:hackingOnly}),'Digital Observer');
});
test('source-aligned skill helper remains executable after native worker serialization',()=>{
 const worker=new Function('return ('+nextBladeburnerProgressSkill.toString()+')')();
 assert.equal(worker(['Short-Circuit'],{'Short-Circuit':0},{'Short-Circuit':10},100,{},context('Operation Typhoon'),nextSkill),'Short-Circuit');
});

const person={shock:0,sync:100,skills:{strength:975,intelligence:0},mults:{crime_success:1}};
const crimes={Easy:{difficulty:.5,strength_success_weight:1,time:1000,money:100,karma:1},Hard:{difficulty:1.25,strength_success_weight:1,time:1000,money:200,karma:2}};
test('BN14 crime penalty applies before the native probability cap and changes optimal crimes',()=>{
 const multiplier=fallbackBitNodeMultipliers(14).CrimeSuccessRate;assert.equal(multiplier,.4);
 assert.ok(Math.abs(sleeveCrimeChance(person,crimes.Hard,multiplier)-.32)<1e-12);
 assert.equal(bestSleeveCrime(person,crimes,'money',1),'Hard');
 assert.equal(bestSleeveCrime(person,crimes,'money',multiplier),'Easy');
 assert.equal(bestSleeveCrime(person,crimes,'karma',multiplier),'Easy');
});
test('startup gang ETA includes the same BitNode crime penalty as normal scoring',()=>{
 const input={sleeves:[person],crimes,money:300000,casinoPending:false,gangAvailable:true,karma:-53900};
 const normal=sleeveStartupPlan({...input,nodeMultiplier:1}),penalty=sleeveStartupPlan({...input,nodeMultiplier:.4});
 assert.equal(normal.workers.length,1);assert.ok(penalty.etaSeconds>normal.etaSeconds);
 assert.ok(Math.abs(normal.etaSeconds-100/1.6)<1e-8);assert.ok(Math.abs(penalty.etaSeconds-100/.8)<1e-8);
});
test('serialized low-RAM casino sleeve seeding also uses the node penalty',()=>{
 const seed=new Function('return ('+seedSleevesSource+')')();
 const run=multiplier=>{
  let selected;const ns={isRunning:()=>true,read:()=>'',ps:()=>[],getPlayer:()=>({money:0}),getResetInfo:()=>({lastNodeReset:1}),sleeve:{getNumSleeves:()=>1,getSleeve:()=>({skills:{strength:250,defense:250,dexterity:250,agility:250},mults:{crime_success:1}}),getTask:()=>null,setToCommitCrime:(_i,name)=>{selected=name;return true;}}};
  seed(ns,1,300000,sleeveCrimeChance,()=>true,multiplier);return selected;
 };
 assert.equal(run(1),'Homicide');assert.equal(run(.4),'Mug');
});

// Independent native expressions, omitting only the common same-faction multipliers.
function nativeFactionRank(person,types,share=1,sf15=0){
 const s={hacking:0,strength:0,defense:0,dexterity:0,agility:0,charisma:0,intelligence:0,...person.skills};
 const c=s.strength+s.defense+s.dexterity+s.agility,d=sf15>=3?s.charisma:0;
 const rates={hacking:(s.hacking+s.intelligence/3+.1*d)/975*share,
  security:.9*(c+.3*d+(s.hacking+s.intelligence)*share)/975/4.5,
  field:.9*(c+s.charisma+(s.hacking+s.intelligence+.3*d)*share)/975/5.5};
 return [...types].sort((a,b)=>rates[b]-rates[a])[0];
}
test('sleeve faction selection matches native expressions across stats, share power and SF15 levels',()=>{
 for(const hacking of [0,100,1000])for(const combat of [10,100,1000])for(const charisma of [0,200,2000])for(const intelligence of [0,150])for(const shareBonus of [1,1.5,3])for(const sf15Level of [0,2,3]){
  const p={skills:{hacking,strength:combat,defense:combat,dexterity:combat,agility:combat,charisma,intelligence}},types=['hacking','field','security'];
  assert.equal(bestFactionWork(p,types,{shareBonus,sf15Level}),nativeFactionRank(p,types,shareBonus,sf15Level));
 }
});
test('reputation assignments propagate share context and filter unsupported work types',()=>{
 const p={shock:0,sync:100,skills:{hacking:100,strength:100,defense:100,dexterity:100,agility:100}};
 const target={type:'FACTION',name:'Tetrads',workTypes:['hacking','security','field']};
 const result=sleeveRepAssignments([p],[target],{},-1,false,[],null,false,{shareBonus:3,sf15Level:0});
 assert.equal(result[0].workType,'hacking');assert.equal(bestFactionWork(p,['invalid']),undefined);
 assert.equal(bestFactionWork(p,['security']),'security');
 assert.equal(autopilotSourceFiles({currentNode:9,ownedSF:{15:3},bitNodeOptions:{sourceFileOverrides:{15:0}}})[15],undefined);
});
test('controllers pass effective node, share and metadata inputs through every corrected path',async()=>{
 const sleeve=await readFile(new URL('../sleeve.js',import.meta.url),'utf8'),autopilot=await readFile(new URL('../autopilot.js',import.meta.url),'utf8'),bb=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(sleeve,/nodeMultipliers.CrimeSuccessRate/);assert.match(sleeve,/nodeMultiplier:crimeNodeMultiplier/);
 assert.match(sleeve,/crimeStats,crimeNodeMultiplier/);assert.match(sleeve,/openingTask,crimeNodeMultiplier/);
 assert.match(sleeve,/worldDaemonPriority,repContext/);assert.match(sleeve,/ns.getSharePower\(\)/);
 assert.match(autopilot,/ns.stock.hasTixApiAccess\(\)/);assert.doesNotMatch(autopilot,/ns.stock.hasTIXAPIAccess\(\)/);
 assert.match(autopilot,/casinoSeedMoney,bitNodeMults.CrimeSuccessRate/);
 assert.match(bb,/JSON.stringify\(blackOpMetadata\)/);assert.match(bb,/skills:ns.getPlayer\(\).skills/);
});

test('restoring native stock API detection cannot starve Bladeburner or augmentation funding',()=>{
 assert.equal(autopilotStockReserve(100e6,300e6,20,true,true),0);
 assert.equal(autopilotStockReserve(100e6,300e6,20,true,false),7.7e9);
 // The early cash-buffer component remains protected even during a progression priority.
 assert.equal(autopilotStockReserve(100e6,300e6,0,true,true),80e6);
});
