import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {captureAugmentationEconomics,augmentationEconomicsChange,invalidateAugmentationFunding} from '../augmentation-economics-policy.js';
import {captureAugmentationOwnership} from '../augmentation-ownership-policy.js';
import {factionPurchaseBatch,factionControlAllowed} from '../faction-policy.js';
function fixture(){
 const f={price:1000,requirement:100000,rep:10000,favor:150,favorToDonate:150,mult:1,money:1e12,joined:['A'],queued:[],bought:[],donations:[]};
 f.watch={augmentations:['Target'],factions:[{name:'A',augmentations:['Target']}]};
 f.ns={pid:7,getResetInfo:()=>({lastAugReset:1,lastNodeReset:2,ownedAugs:{}}),getPlayer:()=>({money:f.money,factions:f.joined,mults:{faction_rep:f.mult}}),getFavorToDonate:()=>f.favorToDonate,
 read:()=>'',isRunning:()=>true,singularity:{getAugmentationPrice:()=>f.price,getAugmentationRepReq:()=>f.requirement,getFactionRep:()=>f.rep,getFactionFavor:()=>f.favor,
 getOwnedAugmentations:p=>p?f.queued:[],purchaseAugmentation:(name,aug)=>{f.bought.push(aug);f.money-=f.price;f.queued.push(aug);return true;},donateToFaction:(name,money)=>{f.donations.push(money);f.rep+=money*f.mult/1e6;f.money-=money;return true;}}};
 f.capture=()=>captureAugmentationEconomics(f.ns,f.watch);return f;
}
test('serialized market capture collects one complete set of native quotes, rep, favor and membership',()=>{
 const f=fixture(),capture=Function('return ('+captureAugmentationEconomics.toString()+')')(),s=capture(f.ns,f.watch);
 assert.equal(s.complete,true);assert.equal(s.quotes.Target.price,1000);assert.equal(s.factions.A.rep,10000);assert.deepEqual(s.factions.A.thresholds,[100000]);assert.equal(s.repMultiplier,1);
 assert.equal(augmentationEconomicsChange(s,f.capture()).changed,false);
});
test('prices, augmentation requirements, membership, donation factors and favor invalidate immediately',()=>{
 for(const mutate of [f=>f.price++,f=>f.price/=2,f=>f.requirement++,f=>f.joined=[],f=>f.mult=2,f=>f.favor++,f=>f.favorToDonate++]){
  const f=fixture(),before=f.capture();mutate(f);assert.equal(augmentationEconomicsChange(before,f.capture(),{allowRepDrift:true}).changed,true);
 }
});
test('reputation unlocks invalidate in either direction regardless of fresh-plan tolerance',()=>{
 const f=fixture();f.rep=99999;const before=f.capture();f.rep=100001;const after=f.capture();
 assert.match(augmentationEconomicsChange(before,after,{allowRepDrift:true}).reason,/unlock/);
 assert.equal(augmentationEconomicsChange(after,before,{allowRepDrift:true}).changed,true);
});
test('small natural rep drift cannot perpetually invalidate newly published plans',()=>{
 const f=fixture(),before=f.capture();f.rep+=10;assert.equal(augmentationEconomicsChange(before,f.capture()).changed,false);
 f.rep=12000;assert.equal(augmentationEconomicsChange(before,f.capture()).changed,true);assert.equal(augmentationEconomicsChange(before,f.capture(),{allowRepDrift:true}).changed,false);
 f.rep=25000;assert.equal(augmentationEconomicsChange(before,f.capture(),{allowRepDrift:true}).changed,true);
 f.rep=200000;const unlocked=f.capture();f.rep=1e9;assert.equal(augmentationEconomicsChange(unlocked,f.capture()).changed,false);
});
test('invalid, partial, nonfinite, reordered-time and reset-mismatched snapshots fail closed',()=>{
 const f=fixture(),before=f.capture();
 for(const patch of [{complete:false},{nodeReset:99},{augReset:99},{at:before.at-1},{watch:null},{quotes:null}])assert.equal(augmentationEconomicsChange(before,{...before,...patch}).changed,true);
 for(const patch of [f=>f.price=NaN,f=>f.rep=-1,f=>f.mult=0]){const g=fixture();patch(g);assert.equal(g.capture().complete,false);}
 assert.equal(captureAugmentationEconomics(f.ns,{augmentations:Array(257).fill('Target'),factions:[]}).complete,false);
 f.ns.singularity.getAugmentationPrice=()=>{throw Error('SF4');};assert.equal(f.capture().complete,false);
});
function harness(f){
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
 const context={ns:f.ns,watch:f.watch,captureAugmentationEconomics,augmentationEconomicsChange,captureAugmentationOwnership,factionPurchaseBatch,factionControlAllowed,achievementActionAllowed:()=>true,
 getNsDataThroughFile:async(ns,expr,file,args)=>{ns.args=args;return vm.runInNewContext(expr,{ns});}};
 vm.runInNewContext(source+';ownershipSnapshot=captureAugmentationOwnership(ns);economicsSnapshot=captureAugmentationEconomics(ns,watch);options={};bitNodeMults={FactionWorkRepGain:1};globalThis.buy=executeFactionPurchases;',context);
 return context;
}
test('actual serialized purchase workers reject changed prices or reputation before spending',async()=>{
 for(const mutate of [f=>f.price*=2,f=>f.rep=100001,f=>f.rep=25000]){
  const f=fixture(),h=harness(f);mutate(f);assert.equal(await h.buy(f.ns,[{faction:'A',augmentation:'Target'}]),-2);assert.deepEqual(f.bought,[]);
 }
});
test('own successful donations refresh the baseline so they cannot block the following purchase',async()=>{
 const f=fixture(),h=harness(f);
 assert.equal(await h.buy(f.ns,[{faction:'A',targetRep:100000,repDonation:90e9}],true),1);
 assert.equal(f.rep,100000);assert.equal(await h.buy(f.ns,[{faction:'A',augmentation:'Target'}]),1);assert.deepEqual(f.bought,['Target']);
});
test('stale funding cleanup preserves other owners, allowances and bounded wait deadlines',async()=>{
 const files={summary:'old','tasks/augmentation-wait-plan.json':JSON.stringify({ownerPid:7,augReset:1,nodeReset:2,active:true,startedAt:20,expiresAt:500}),
 'tasks/spending-plan.json':JSON.stringify({ownerPid:7,reset:1,allowances:{home:100},signals:{augmentationCashTarget:{cost:50},route:'hacking'}})};
 const ns={read:f=>files[f]||'',write:(f,s)=>files[f]=s};const result=await invalidateAugmentationFunding(ns,7,{lastAugReset:1,lastNodeReset:2},'summary',100);
 assert.equal(result.expiresAt,500);assert.equal(result.startedAt,20);assert.equal(result.active,false);assert.equal(files.summary,'');
 assert.equal(JSON.parse(files['tasks/spending-plan.json']).allowances.home,100);
 const protectedFile=files['tasks/spending-plan.json'];await invalidateAugmentationFunding(ns,8,{lastAugReset:1,lastNodeReset:2},'summary',200);assert.equal(files['tasks/spending-plan.json'],protectedFile);
});
test('producer and autopilot validate economics before summary publication or reset planning',()=>{
 const producer=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');assert.ok(producer.indexOf('const quoteChange=')<producer.indexOf('economics:economicsSnapshot'));
 const a=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=a.indexOf('let facman = getFactionManagerOutput'),validate=a.indexOf('const change=augmentationEconomicsChange',start),consume=a.indexOf('playerInstalledAugCount = facman.installed_count',start);
 assert.ok(validate>start&&validate<consume);assert.match(a,/allowRepDrift:Date.now\(\)-facman.at<5000/);
});
test('native quotes are applied before count-filler selection and refresh after automatic faction joins',async()=>{
 const f=fixture(),source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8'),start=source.indexOf('async function refreshAugmentationQuotes('),fn=source.slice(start);
 const context={captureAugmentationEconomics,getNsDataThroughFile:async(ns,expr,file,args)=>{ns.args=args;return vm.runInNewContext(expr,{ns});},ns:f.ns};
 vm.runInNewContext('let economicsSnapshot=null;const strNF="NeuroFlux Governor",gangFaction=null,factionsWithoutDonation=[];let favorToDonate=0;const augmentationData={Target:{name:"Target",owned:false,price:1,reputation:1}};const factionData={A:{name:"A",augmentations:["Target"],reputation:0,favor:0,joined:false}};const playerData={mults:{faction_rep:1}};'+fn+';globalThis.refresh=refreshAugmentationQuotes;globalThis.state=()=>({augmentationData,factionData});',context);
 assert.equal(await context.refresh(f.ns),true);assert.equal(context.state().augmentationData.Target.price,1000);assert.equal(context.state().factionData.A.reputation,10000);assert.equal(context.state().factionData.A.joined,true);
 assert.ok(source.indexOf('await refreshAugmentationQuotes(ns)')<source.indexOf('const countAugs=augmentationCountCandidates'));
 assert.match(source,/if\(joined&&!await refreshAugmentationQuotes\(ns\)\)/);
});
test('repeated requotes retain the actual install deadline while a cancelled plan starts a new window',()=>{
 const a=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=a.indexOf('if (reservedPurchase == 0){'),end=a.indexOf('            else {',start),snippet=a.slice(start,end);
 const run=new Function('state','now','installDelay','let {reservedPurchase,installWindowStarted,installCountdownResets,installCountdown}=state;const Date={now:()=>now};'+snippet+';return {reservedPurchase,installWindowStarted,installCountdownResets,installCountdown};');
 let state={reservedPurchase:0,installWindowStarted:1000,installCountdown:301000,installCountdownResets:2};
 for(let i=0;i<100;i++)state=run(state,2000+i*10000,300000);
 assert.equal(state.installWindowStarted,1000);assert.equal(state.installCountdown,301000);assert.equal(state.installCountdownResets,2);
 state=run({...state,installWindowStarted:0},1000000,300000);assert.equal(state.installCountdown,1300000);
 const check=a.slice(a.indexOf('const change=augmentationEconomicsChange'),a.indexOf('        if (!facman)',a.indexOf('const change=augmentationEconomicsChange')));
 assert.doesNotMatch(check,/installCountdown=0|installWindowStarted=0/);
});
