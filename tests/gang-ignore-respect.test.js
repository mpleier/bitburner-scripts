import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGangAscensions,ascendGangMemberSafely,forecastGangCrewAscensions,projectGangMember} from '../gang-policy.js';
test('respect-agnostic screening ignores caps, wanted-penalty floor and imminent recruitment',()=>{
 const names=['A','B'],gang={respect:900,wantedLevel:100,respectForNextRecruit:1000},results={A:{str:2,respect:900},B:{str:1.5,respect:1}};
 assert.deepEqual(chooseGangAscensions(results,gang,names,['str'],1.05,0,12,true,true).map(p=>p.name),['B']);
 const p=chooseGangAscensions(results,gang,names,['str'],1.05,0,12,true,true,true);assert.equal(p[0].name,'A');assert.equal(p.length,2);
 assert.equal(chooseGangAscensions({A:{str:1,respect:900}},gang,names,['str'],1.05,0,12,true,true,true).length,0);
 assert.equal(chooseGangAscensions({A:{str:2,respect:Infinity}},gang,names,['str'],1.05,0,12,true,true,true).length,0);
});
test('native worker honors the preference but still rejects stale quotes and changed candidate stats',()=>{
 const calls=[],results={str:2,respect:900},member={str:100};
 const ns={gang:{getMemberNames:()=>['A'],getGangInformation:()=>({respect:900,wantedLevel:1,respectForNextRecruit:1000}),getAscensionResult:()=>results,getMemberInformation:()=>member,setTerritoryWarfare:()=>calls.push('safe'),ascendMember:()=>{calls.push('ascend');return results;},setMemberTask:()=>true}};
 const plan={name:'A',ignoreRespectLoss:true,expiresAt:Date.now()+5000,paybackSeconds:20,horizonSeconds:900,gang:{respect:1000,wantedLevel:1},respectLoss:1,member:{str:100},ascension:{str:2}};
 const run=p=>ascendGangMemberSafely(ns,'A',['str'],1.05,0,chooseGangAscensions,()=>true,p,true);
 assert.equal(run({...plan,expiresAt:0}).success,false);assert.equal(run({...plan,member:{str:50}}).success,false);assert.equal(run({...plan,ignoreRespectLoss:false}).success,false);assert.deepEqual(calls,[]);
 assert.equal(run(plan).success,true);assert.deepEqual(calls,['safe','ascend']);
});
test('crew forecast drops the recruitment-respect veto without inventing retained respect',()=>{
 const A=projectGangMember({name:'A',str_exp:10000,str_mult:1,str_asc_mult:1,task:'Work',upgrades:[],augmentations:[]},null,0),B={...A,name:'B'},training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
 const f={members:{A,B},names:['A'],ascensions:{A:{member:{...A,str_exp:0,str_asc_mult:10},respectLoss:900}},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:{name:'Work',difficulty:1,strWeight:100,baseWanted:0},'Train Combat':training},horizonSeconds:900,goals:[{name:'recruit',resource:'respect',gangRespect:true,amount:10}],evaluate:(m,g,t)=>({task:t,value:t==='Work'?m.str:0,money:0,respect:t==='Work'?1:0,wanted:0})};
 assert.equal(forecastGangCrewAscensions(f).plans.length,0);
 const p=forecastGangCrewAscensions({...f,ignoreRespectLoss:true});assert.ok(p.plans.length);assert.equal(p.plans[0].ignoreRespectLoss,true);assert.equal(p.plans[0].ascensionMilestones.recruit,undefined);
 assert.ok(p.forecasts.A.respectLoss>0);
});
test('controller defaults to the requested preference and passes it into native execution',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/\['ignore-ascension-respect-loss', true\]/);assert.match(s,/ignoreRespectLoss:options\['ignore-ascension-respect-loss'\]===true/);assert.match(s,/JSON.parse\(ns.args\[5\]\),true,ns.args\[6\]/);
});
