import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {claimSpending} from '../spending-policy.js';
function fixture(){
 let time=100000,money=100000000;const files={'reserve.txt':'0'},paused=new Set(),dead=new Set();
 const plan={epoch:99000,expiresAt:160000,reset:3,ownerPid:7,homeRam:4096,signals:{augmentationCashTarget:{name:'Goal',cost:300000000},augmentationFunding:{at:100000,rate:100000,nodeReset:1,augReset:3}},allowances:{gang:1000000,hacknet:1000000,servers:1000000}};
 const processes=[{pid:7,filename:'autopilot.js'},{pid:8,filename:'gangs.js'},{pid:9,filename:'hacknet-upgrade-manager.js'}];
 files['tasks/spending-plan.json']=JSON.stringify(plan);
 const ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:3}),getPlayer:()=>({money}),ps:()=>processes.filter(p=>!dead.has(p.pid)),read:f=>f.startsWith('remote-control/paused/')&&paused.has(f)?'true':files[f]||'',write:(f,v)=>files[f]=v};
 const claim=vm.runInNewContext('('+claimSpending.toString()+')',{Date:{now:()=>time}});
 const proof=(category,gain=category==='gang'?100000:200000,cost=10000)=>({category,kind:category==='gang'?'gang-equipment':'hacknet-production',ownerPid:category==='gang'?8:9,at:time,nodeReset:1,augReset:3,cost,gainPerSecond:gain,member:category==='gang'?'A':undefined,equipment:category==='gang'?'Bat':undefined,upgrade:category==='hacknet'?'level':undefined,index:category==='hacknet'?0:undefined});
 const submit=(category,gain,cost)=>{const p=proof(category,gain,cost);return claim(ns,category,p.cost,p);};
 return {files,ns,claim,plan,proof,submit,dead,paused,board:()=>JSON.parse(files['tasks/growth-investment-auction.json']),usage:()=>files['tasks/spending-usage.json']?JSON.parse(files['tasks/spending-usage.json']):null,
  at:t=>{time=t;plan.expiresAt=t+60000;plan.signals.augmentationFunding.at=t;files['tasks/spending-plan.json']=JSON.stringify(plan);},money:n=>money=n,refresh:()=>files['tasks/spending-plan.json']=JSON.stringify(plan)};
}
test('a qualifying request opens a fixed collection window and consumes no allowance',()=>{
 const f=fixture();assert.equal(f.submit('gang'),false);assert.equal(f.board().collectUntil,130000);assert.equal(f.board().state,'collecting');assert.equal(f.usage(),null);
 f.at(110000);f.submit('gang');assert.equal(f.board().startedAt,100000);assert.equal(f.board().collectUntil,130000);
});
test('the greatest projected funding reduction wins regardless of which manager bids first',()=>{
 for(const first of ['gang','hacknet']){const f=fixture();assert.equal(f.submit(first),false);f.at(105000);assert.equal(f.submit(first==='gang'?'hacknet':'gang'),false);
  f.at(130000);assert.equal(f.submit('gang'),false);assert.equal(f.board().winner.category,'hacknet');assert.equal(f.submit('hacknet'),true);assert.equal(f.usage().growthException.category,'hacknet');assert.ok(f.usage().growthException.savedSeconds>900);
 }
});
test('a sole qualified bidder can proceed when collection closes',()=>{
 const f=fixture();f.submit('gang');f.at(130000);assert.equal(f.submit('gang'),true);assert.equal(f.board().state,'claimed');assert.equal(f.usage().spent.gang,10000);
});
test('cached winning proposals alone cannot authorize a purchase without a fresh native quote',()=>{
 const f=fixture();f.submit('gang');f.at(105000);const old=f.proof('hacknet');f.claim(f.ns,'hacknet',old.cost,old);f.at(130000);
 assert.equal(f.claim(f.ns,'hacknet',old.cost,old),false);assert.equal(f.usage(),null);assert.equal(f.submit('hacknet'),true);
});
test('fresh changes replace the same investment rather than retaining its old overstated gain',()=>{
 const f=fixture();f.submit('gang');f.at(105000);f.submit('hacknet',500000);f.at(130000);assert.equal(f.submit('hacknet',80000),false);assert.equal(f.board().winner.category,'gang');assert.equal(f.submit('gang'),true);
});
test('current allowance and explicit cash reserves remove unfundable competitors',()=>{
 for(const change of [f=>f.plan.allowances.hacknet=9999,f=>{f.files['reserve.txt']='99995000';}]){
  const f=fixture();f.submit('gang',100000,1000);f.at(105000);f.submit('hacknet',500000,10000);f.at(130000);change(f);f.refresh();assert.equal(f.submit('gang',100000,1000),true);assert.equal(f.usage().growthException.category,'gang');
 }
});
test('cash and income are repriced at selection rather than trusting stored savings scores',()=>{
 const f=fixture();f.submit('gang');f.at(105000);f.submit('hacknet',500000,500000);f.at(130000);f.money(1000000);assert.equal(f.submit('gang'),true);assert.equal(f.board().winner.category,'gang');
});
test('dead and paused competitors cannot hold a grant',()=>{
 for(const change of [f=>f.dead.add(9),f=>f.paused.add('remote-control/paused/hacknet-upgrade-manager.js.txt')]){const f=fixture();f.submit('gang');f.at(105000);f.submit('hacknet');f.at(130000);change(f);assert.equal(f.submit('gang'),true);}
});
test('budget renewals cannot postpone collection but goal changes start a matching new round',()=>{
 const f=fixture();f.submit('gang');f.at(110000);f.plan.epoch=109000;f.refresh();f.submit('hacknet');assert.equal(f.board().collectUntil,130000);
 f.at(130000);f.plan.signals.augmentationCashTarget={name:'Changed',cost:310000000};f.refresh();assert.equal(f.submit('gang'),false);assert.equal(f.board().startedAt,130000);assert.equal(f.board().collectUntil,160000);
});
test('an unclaimed stale winner expires and cannot block later rounds indefinitely',()=>{
 const f=fixture();f.submit('gang');f.at(105000);f.submit('hacknet');f.at(130000);assert.equal(f.submit('gang'),false);
 f.at(160000);assert.equal(f.submit('gang'),false);assert.equal(f.board().startedAt,160000);f.at(190000);assert.equal(f.submit('gang'),true);
});
test('malformed and future board clocks restart collection instead of granting permission',()=>{
 for(const patch of [{collectUntil:0},{expiresAt:Infinity},{startedAt:200000},{schemaVersion:2},{bids:null}]){const f=fixture();f.submit('gang');f.at(130000);f.files['tasks/growth-investment-auction.json']=JSON.stringify({...f.board(),...patch});assert.equal(f.submit('gang'),false);assert.equal(f.board().startedAt,130000);}
});
test('ties are deterministic across arrival order',()=>{
 for(const first of ['gang','hacknet']){const f=fixture();f.submit(first,100000);f.at(105000);f.submit(first==='gang'?'hacknet':'gang',100000);f.at(130000);assert.equal(f.submit('hacknet',100000),false);assert.equal(f.board().winner.category,'gang');assert.equal(f.submit('gang',100000),true);}
});
test('bounded boards retain strongest proposals without dropping the eventual fresh winner',()=>{
 const f=fixture();for(let i=0;i<40;i++){const p={...f.proof('hacknet',100000+i*10000),index:i};assert.equal(f.claim(f.ns,'hacknet',p.cost,p),false);}
 assert.equal(f.board().bids.length,16);assert.equal(f.board().bids[0].index,39);f.at(130000);const p={...f.proof('hacknet',490000),index:39};assert.equal(f.claim(f.ns,'hacknet',p.cost,p),true);
});
test('collection delay is priced before a marginal savings exception can qualify',()=>{
 const f=fixture();f.plan.signals.augmentationFunding.rate=1000000;f.refresh();assert.equal(f.submit('gang',600000),false);assert.equal(f.files['tasks/growth-investment-auction.json'],undefined);
});
test('ordinary cash-preserving purchases do not wait and shared cooldown remains authoritative',()=>{
 const f=fixture();f.money(400000000);assert.equal(f.claim(f.ns,'hacknet',10000,null),true);assert.equal(f.files['tasks/growth-investment-auction.json'],undefined);
 const g=fixture();g.submit('gang');g.at(130000);assert.equal(g.submit('gang'),true);g.at(131000);assert.equal(g.submit('hacknet'),false);assert.equal(g.usage().spent.hacknet,undefined);
});

test('remote diagnostics summarize bounded selection state and expose expiration',()=>{
 const s=readFileSync(new URL('../remote-api-command.js',import.meta.url),'utf8');
 const expression=s.match(/growthInvestment:(\(a=>a\?\{[^;]+?\}:null\)\(read\("tasks\/growth-investment-auction.json"\)\))/)[1];
 const board={at:1,state:'ready',expiresAt:50,collectUntil:20,winner:{category:'gang'},bids:[{category:'gang'},{category:'hacknet'}]};
 const result=vm.runInNewContext(expression,{Date:{now:()=>100},read:()=>board});
 assert.equal(result.proposalCount,2);assert.equal(result.expired,true);assert.equal(result.best.category,'gang');assert.equal(result.bids,undefined);
});

test('next-round collection overlaps the second half of cooldown without allowing early spending',()=>{
 const f=fixture();f.submit('gang');f.at(130000);assert.equal(f.submit('gang'),true);
 f.at(159999);assert.equal(f.submit('hacknet'),false);assert.equal(f.board().state,'claimed');
 f.at(160000);assert.equal(f.submit('hacknet'),false);assert.equal(f.board().collectUntil,190000);
 f.at(180000);f.plan.epoch=179000;f.refresh();assert.equal(f.submit('hacknet'),false);assert.equal(f.usage().spent.hacknet,undefined);
 f.at(190000);assert.equal(f.submit('hacknet'),true);assert.equal(f.usage().growthException.at,190000);
});
test('elapsed cooldown does not permit a second exception in the same unrenewed budget epoch',()=>{
 const f=fixture();f.submit('gang');f.at(130000);assert.equal(f.submit('gang'),true);
 f.at(160000);f.submit('hacknet');f.at(190000);assert.equal(f.submit('hacknet'),false);assert.equal(f.usage().growthException.at,130000);
});
