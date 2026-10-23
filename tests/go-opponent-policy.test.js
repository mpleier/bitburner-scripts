import test from 'node:test';
import assert from 'node:assert/strict';
import {goProgressionContext,planGoOpponents} from '../go-opponent-policy.js';
import {recordGoPerformance} from '../go-policy.js';

const now=10_000_000;
const opts={goal:'auto','board-size':13};
const ctx={now,cheats:false,bottleneck:'hacking',source:'test planner',sourceFileLevel:1};
function bucket(opponent,extra={}) {
 const history=Array.from({length:3},(_,i)=>({at:now-i*1000,ms:60000,win:1,bonus:1,logGain:.01}));
 return {opponent,size:13,cheats:false,games:3,wins:3,completed:8,totalMs:180000,totalBonus:3,totalReward:100,history,at:now,...extra};
}
function mock(files={},extra={}) {
 return {read:f=>JSON.stringify(files[f]??null),getResetInfo:()=>({lastAugReset:100,lastNodeReset:10}),
  isRunning:pid=>pid===7,getPlayer:()=>({factions:['Netburners']}),...extra};
}
function row(plan,name){return plan.ranked.find(r=>r.name===name);}

test('automatic opponents follow fresh progression, retaining the BN9 baseline',()=>{
 const p=planGoOpponents({},opts,9,{},ctx);
 assert.equal(p.goal,'hacking');assert.equal(p.source,'test planner');
 assert.equal(p.ranked[0].name,'????????????');assert.equal(row(p,'Illuminati').weight,4);assert.equal(row(p,'Netburners').weight,2);
 assert.equal(planGoOpponents({},opts,9,{}, {now}).ranked[0].name,'Netburners');
});
test('explicit goals and opponents survive progression hints and trial slots',()=>{
 const stats={Netburners:{wins:3}};
 const p=planGoOpponents(stats,{...opts,goal:'reputation',opponent:'Netburners'},9,{},ctx);
 assert.equal(p.goal,'reputation');assert.equal(p.ranked.length,1);assert.equal(p.ranked[0].name,'Netburners');assert.equal(p.trial,false);
 const q=planGoOpponents({}, {...opts,goal:'combat'},9,{},ctx);assert.equal(q.goal,'combat');assert.equal(q.ranked[0].name,'Tetrads');
});
test('only current, live, unexpired spending plans affect the goal',()=>{
 const plan={reset:100,epoch:now-100,expiresAt:now+1000,ownerPid:7,signals:{bottleneck:'hacking'}};
 const valid=goProgressionContext(mock({'tasks/spending-plan.json':plan}),1,now);assert.equal(valid.bottleneck,'hacking');
 assert.deepEqual(valid.factions,['Netburners']);
 for(const change of [{reset:99},{epoch:now+1},{epoch:now-60001},{expiresAt:now},{ownerPid:8}])
  assert.equal(goProgressionContext(mock({'tasks/spending-plan.json':{...plan,...change}}),1,now).bottleneck,null);
});
test('progression fallback is reset-scoped, recent and tolerant of unavailable APIs',()=>{
 const speed={augReset:100,at:now,bottleneck:'reputation'};
 assert.equal(goProgressionContext(mock({'tasks/progression-speed.json':speed}),0,now).bottleneck,'reputation');
 for(const change of [{augReset:99},{at:now+1},{at:now-120001}])
  assert.equal(goProgressionContext(mock({'tasks/progression-speed.json':{...speed,...change}}),0,now).bottleneck,null);
 assert.deepEqual(goProgressionContext(mock({}, {getPlayer(){throw Error('unavailable');}}),0,now).factions,[]);
});
test('opponent trials occupy one slot per eight completed native games',()=>{
 for(let completed=0;completed<40;completed++) {
  const p=planGoOpponents({Netburners:{wins:completed}},opts,9,{},ctx);
  assert.equal(p.trial,completed%8===3);
  if(p.trial){assert.equal(p.ranked[0].name,'Illuminati');assert.equal(p.ranked[0].boardTrial,false);}
 }
});
test('three fresh matching samples end the cold trial and unavailable opponents are excluded',()=>{
 const buckets={a:bucket('Illuminati'),b:bucket('Netburners'),c:bucket('????????????')};
 assert.equal(planGoOpponents({Netburners:{wins:3}},opts,9,buckets,ctx).trial,false);
 const p=planGoOpponents({Netburners:{wins:3}},opts,9,{}, {...ctx,unavailable:['Illuminati','????????????']});
 assert.equal(p.ranked.some(r=>['Illuminati','????????????'].includes(r.name)),false);
 const q=planGoOpponents({}, {...opts,opponent:'Illuminati'},9,{}, {...ctx,unavailable:['Illuminati']});
 assert.equal(q.ranked.length,0);
});
test('streak achievements disable opponent and board trials',()=>{
 const p=planGoOpponents({Netburners:{wins:3}},opts,9,{a:bucket('Illuminati',{completed:3})},{...ctx,protectStreak:true});
 assert.equal(p.ranked[0].name,'Illuminati');assert.equal(p.ranked[0].size,13);assert.equal(p.trial,false);assert.equal(p.ranked[0].boardTrial,false);
});
test('explicit board size and disabled adaptation are authoritative for trials too',()=>{
 for(const context of [{...ctx,boardSizeExplicit:true},ctx]) {
  const p=planGoOpponents({Netburners:{wins:3}},{...opts,'board-size':9,'adaptive-boards':false},9,{},context);
  assert.ok(p.ranked.every(r=>r.size===9&&r.comparisonSize===9));
 }
});
test('measurements match established board, cheat mode, and a thirty-minute window',()=>{
 const b=bucket('Illuminati'),history=b.history;
 const rows={good:b,cheat:bucket('Illuminati',{cheats:true}),size:bucket('Illuminati',{size:7}),
  old:bucket('Illuminati',{history:history.map(g=>({...g,at:now-1800001}))}),
  future:bucket('Illuminati',{history:history.map(g=>({...g,at:now+1}))}),
  legacy:bucket('Illuminati',{history:history.map(({at,logGain,...g})=>g)}),bad:bucket('Illuminati',{history:[null,{},...history.map(g=>({...g,logGain:NaN}))]})};
 const r=row(planGoOpponents({},opts,9,rows,ctx),'Illuminati');assert.equal(r.samples,3);assert.equal(r.measured,true);assert.ok(Math.abs(r.logGainPerMinute-.01)<1e-12);
});
test('measured zero gain is evidence, never a fallback promotion',()=>{
 const zero=bucket('????????????',{history:bucket('????????????').history.map(g=>({...g,logGain:0,bonus:0}))});
 const p=planGoOpponents({},opts,9,{a:zero},ctx),r=row(p,'????????????');
 assert.equal(r.measured,true);assert.equal(r.score,0);assert.notEqual(p.ranked[0].name,'????????????');
});
test('rate scoring already includes losses and does not multiply by win probability',()=>{
 const a=bucket('????????????'),b=bucket('Illuminati',{history:bucket('Illuminati').history.map(g=>({...g,win:0}))});
 const p=planGoOpponents({},opts,9,{a,b},ctx);
 assert.equal(row(p,'????????????').score/5,row(p,'Illuminati').score/4);
});
test('remaining faction favor requires membership and respects Source File cap',()=>{
 const stats={Netburners:{rep:200000}};
 for(const [level,remaining] of [[0,0],[1,0],[2,100000],[3,200000]]) {
  const p=planGoOpponents(stats,opts,9,{}, {...ctx,sourceFileLevel:level,factions:['Netburners']});
  assert.equal(row(p,'Netburners').remainingFavorRep,remaining);
 }
 assert.equal(row(planGoOpponents({},opts,9,{},ctx),'Netburners').remainingFavorRep,0);
 assert.equal(row(planGoOpponents({},opts,9,{}, {...ctx,factions:['Netburners']}),'Netburners').remainingFavorRep,200000);
});
test('a capped favor allowance does not cap global multiplier utility',()=>{
 const p=planGoOpponents({Netburners:{rep:200000}},opts,9,{}, {...ctx,factions:['Netburners']});
 assert.ok(row(p,'Netburners').score>0);assert.equal(row(p,'Netburners').favorWeight,0);
});
test('board trials do not change the board used for opponent comparison',()=>{
 const p=planGoOpponents({}, {...opts,opponent:'Netburners'},9,{a:bucket('Netburners',{completed:3})},ctx);
 assert.equal(p.ranked[0].size,7);assert.equal(p.ranked[0].comparisonSize,13);assert.equal(p.ranked[0].boardTrial,true);assert.equal(p.ranked[0].samples,3);
});
test('switching requires a fifteen percent advantage over a measured incumbent',()=>{
 const a=bucket('????????????'),b=bucket('Illuminati',{history:bucket('Illuminati').history.map(g=>({...g,logGain:.011}))});
 const p=planGoOpponents({},opts,9,{a,b},{...ctx,currentOpponent:'Illuminati'});
 assert.equal(p.ranked[0].name,'Illuminati');
 const q=planGoOpponents({},opts,9,{a,b},{...ctx,currentOpponent:'Netburners'});assert.equal(q.ranked[0].name,'????????????');
});
test('BN8 automatic scoring excludes ordinary hacking income',()=>{
 const p=planGoOpponents({},opts,8,{}, {...ctx,bottleneck:'cash'});assert.equal(row(p,'The Black Hand').score,0);
});
test('performance records relative gain, time and bounded legacy history safely',()=>{
 const game={opponent:'Netburners',size:13,cheats:false,startedAt:now-60000,wins:3,losses:1,bonus:100,winStreak:1};
 const stats={Netburners:{wins:4,losses:1,bonusPercent:102,winStreak:2}};
 const b=recordGoPerformance({a:null,'Netburners:13:normal':{history:[null,{}]}},game,stats,now);
 const h=b['Netburners:13:normal'].history;assert.equal(h.length,1);assert.equal(h[0].at,now);assert.equal(h[0].logGain,Math.log1p(2/200));
 assert.equal(row(planGoOpponents(stats,opts,9,b,ctx),'Netburners').samples,1);
});

test('opponent throughput includes only interruption cost from its thirty-minute window',()=>{
 const base=bucket('Netburners'),options={goal:'hacknet',opponent:'Netburners','board-size':13,'adaptive-boards':false};
 const before=planGoOpponents({},options,9,{a:base},ctx).ranked[0];
 const rows={a:{...base,interruptions:[{id:'partial',at:now,ms:180000},{id:'old',at:now-1800001,ms:180000}]}};
 const after=planGoOpponents({},options,9,rows,ctx).ranked[0];assert.ok(Math.abs(after.logGainPerMinute-before.logGainPerMinute/2)<1e-12);
 assert.equal(after.samples,before.samples);
});
