import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {chooseGangStatTraining,gangStatTaskRate} from '../gang-stat-policy.js';
const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('gangs.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='memberBestValue');
function context(focus){
 const keys=['hack','str','def','dex','agi','cha'],member=Object.fromEntries(keys.map(k=>[k,100]));member.name='A';
 const allTaskStats=Object.fromEntries(['Train Combat','Train Hacking','Train Charisma','Work'].map(name=>[name,{name}]));
 const c=vm.createContext({chooseGangStatTraining,gangStatTaskRate,projectGangMember:(m,t)=>({...m,hack:m.hack+(t.name==='Train Hacking'?100:t.name==='Train Combat'?20:1)}),growthFocus:focus,isHackGang:false,allTaskStats,allTaskNames:Object.keys(allTaskStats),options:{manualTasks:{}},purchaseFocusQuote:null,purchaseGoal:null,gangObjectiveWeight:()=>1,gangObjectiveValue:(r,f)=>f==='stats'?r.stats:r.money,calculateMoneyGains:()=>0,computeRepGains:()=>0,computeWantedGains:()=>0,forecastWantedLimits:{}});
 vm.runInContext(fn.getText(ast),c);return {c,member};
}
test('stat forecast baseline uses best native skill training rather than gang type',()=>{const {c,member}=context('stats');assert.equal(c.memberBestValue(member,{}).task,'Train Hacking');});
test('manual and forced tasks remain authoritative; ordinary focus retains default',()=>{const {c,member}=context('stats');assert.equal(c.memberBestValue(member,{},null,'Train Charisma').task,'Train Charisma');c.options.manualTasks.A='Work';assert.equal(c.memberBestValue(member,{}).task,'Work');const ordinary=context('respect');assert.equal(ordinary.c.memberBestValue(ordinary.member,{}).task,'Train Combat');});
