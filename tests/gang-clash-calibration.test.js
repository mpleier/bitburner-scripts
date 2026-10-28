import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangAttritionCalibration,startGangAttrition,gangAttritionSignature,planGangAttrition} from '../gang-attrition-policy.js';
const now=Date.now(),scope={nodeReset:1,augReset:2,faction:'Own'};
const metric=(actual,min,max=min)=>({actual,expected:{min,max}});
function row(key,at=now,patch={}){return {key,...scope,at,scored:true,elapsedSeconds:20,power:metric(100,100,110),territory:metric(.2,.2,.21),rivals:[{name:'R',power:metric(100,90,110),territory:metric(.8,.79,.8)}],...patch};}
const bad=(key,at=now)=>row(key,at,{power:metric(95,100,110)});
test('two material misses among three recent comparable trials pause only early attempts',()=>{
 const result=gangAttritionCalibration([bad('a',now-2000),row('b',now-1000),bad('c')],scope,now);
 assert.equal(result.suspended,true);assert.equal(result.samples,3);assert.equal(result.misses,2);assert.equal(result.resumeAt,now+90*60000);
 assert.equal(gangAttritionCalibration([bad('a'),row('b'),row('c')],scope,now).suspended,false);
 assert.equal(planGangAttrition({calibration:result}).engage,false);
});
test('power, territory and stronger-than-forecast rivals can each reveal optimism',()=>{
 for(const patch of [{power:metric(98,100)},{territory:metric(.1998,.2)},{rivals:[{name:'R',power:metric(112,90,110),territory:metric(.8,.8)}]},{rivals:[{name:'R',power:metric(100,100),territory:metric(.8002,.8)}]}]){
  const history=[row('a',now-1,patch),row('b',now,patch)];assert.equal(gangAttritionCalibration(history,scope,now).suspended,true);
 }
 assert.equal(gangAttritionCalibration([row('a',now-1,{power:metric(99.1,100)}),row('b',now,{power:metric(99.1,100)})],scope,now).suspended,false);
});
test('duplicates, partials, future, stale, foreign-faction and reset-mismatched records do not count',()=>{
 assert.equal(gangAttritionCalibration([bad('same'),bad('same')],scope,now).misses,1);
 for(const patch of [{scored:false},{at:now+1},{at:now-21600001},{nodeReset:3},{augReset:3},{faction:'Other'},{power:metric(NaN,100)},{elapsedSeconds:200}, {rivals:null}]){
  const result=gangAttritionCalibration([bad('a'),{...bad('b'),...patch}],scope,now);assert.equal(result.suspended,false);assert.equal(result.samples,1);
 }
 assert.equal(gangAttritionCalibration([bad('a'),bad('b')],{...scope,augReset:3},now).samples,0);
});
test('three newer good windows replace old misses and a finite pause can expire',()=>{
 const history=[bad('a',now-4000),bad('b',now-3000),row('c',now-2000),row('d',now-1000),row('e')];
 const good=gangAttritionCalibration(history,scope,now);assert.equal(good.suspended,false);assert.equal(good.misses,0);
 const misses=[bad('a',now-1),bad('b')];assert.equal(gangAttritionCalibration(misses,scope,now+5400000).suspended,false);
 assert.equal(gangAttritionCalibration(misses,scope,now+5399999).suspended,true);
});
test('missing history bootstraps existing forecast checks; malformed history fails closed',()=>{
 assert.equal(gangAttritionCalibration([],scope,now).suspended,false);assert.equal(gangAttritionCalibration([],scope,now).samples,0);
 for(const input of [null,{},'[]']){const result=gangAttritionCalibration(input,scope,now);assert.equal(result.known,false);assert.equal(result.suspended,true);}
});
function native(){
 const list=Array.from({length:12},(_,i)=>({name:'M'+i,def:1e6,upgrades:[],augmentations:[],...Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k+'_exp',1000]))}));
 const files={},calls=[],at=Date.now(),g={faction:'Own',power:22000,territory:.2,territoryWarfareEngaged:false,territoryClashChance:0};
 const ns={args:[7],read:f=>files[f]||'',write:(f,v)=>files[f]=v,isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),
  gang:{getGangInformation:()=>g,getMemberNames:()=>list.map(m=>m.name),getMemberInformation:n=>list.find(m=>m.name===n),getAllGangInformation:()=>({Own:g,R:{power:10000,territory:.8}}),setTerritoryWarfare:v=>calls.push(v)}};
 const q={engage:true,calibrationRequired:true,ownerPid:7,nodeReset:1,augReset:2,at,deadline:at+20000,faction:'Own',power:22000,territory:.2,signature:gangAttritionSignature(list),rivals:[{name:'R',power:10000}]};
 return {ns,q,files,calls};
}
test('native dispatch independently rereads calibration rather than trusting an earlier plan',()=>{
 const f=native();f.files['tasks/gang-attrition-observations.json']=JSON.stringify([bad('a'),bad('b')]);
 assert.equal(startGangAttrition(f.ns,f.q,()=>true,gangAttritionCalibration),false);assert.equal(f.calls.length,0);
 const good=native();assert.equal(startGangAttrition(good.ns,good.q,()=>true,gangAttritionCalibration),true);
 const missing=native();assert.equal(startGangAttrition(missing.ns,missing.q,()=>true),false);
 const malformed=native();malformed.files['tasks/gang-attrition-observations.json']='not json';assert.equal(startGangAttrition(malformed.ns,malformed.q,()=>true,gangAttritionCalibration),false);
});
test('serialized calibration guard is self-contained and restart ownership does not erase samples',()=>{
 const check=Function('return ('+gangAttritionCalibration.toString()+')')();
 assert.equal(check([{...bad('a'),ownerPid:1},{...bad('b'),ownerPid:999}],scope,now).suspended,true);
});
test('controller records calibration and gates only the bounded attempt path',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/calibration.known&&!calibration.suspended&&!shouldEngage/);assert.match(source,/calibrationRequired:true/);assert.match(source,/gangAttritionCalibration.toString/);
 assert.match(source,/gang-attrition-calibration.json/);assert.match(source,/let shouldEngage = warfareDecision/);
});
