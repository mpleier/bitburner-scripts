import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('gangs.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='onTerritoryTick');
const branch=fn.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).startsWith('tick.observed || lastTerritoryPower'));
function fixture(){return vm.createContext({tick:{observed:true,powerPulseState:'power-increased'},lastTerritoryPower:10,myGangInfo:{power:11},consecutiveTerritoryDetections:6,missedTerritoryTicks:0,territoryTickWaitPadding:400,updateInterval:200,log(){},ns:{},formatNumberShort:String});}
function pulse(c,state){c.tick.powerPulseState=state;vm.runInContext(branch.getText(ast),c);}
test('failed pulses retain timing allowance until six consecutive power gains',()=>{
 for(const state of ['power-unchanged','assignment-mismatch',undefined]){
  const c=fixture();pulse(c,state);assert.equal(c.consecutiveTerritoryDetections,0);assert.equal(c.territoryTickWaitPadding,400);
  for(let i=0;i<5;i++)pulse(c,'power-increased');assert.equal(c.territoryTickWaitPadding,400);
  pulse(c,'power-increased');assert.equal(c.territoryTickWaitPadding,200);
 }
});
test('each timing reduction requires another complete successful streak',()=>{
 const c=fixture();c.consecutiveTerritoryDetections=5;c.territoryTickWaitPadding=800;
 pulse(c,'power-increased');assert.equal(c.territoryTickWaitPadding,600);
 for(let i=0;i<5;i++)pulse(c,'power-increased');assert.equal(c.territoryTickWaitPadding,600);
 pulse(c,'power-increased');assert.equal(c.territoryTickWaitPadding,400);
});
