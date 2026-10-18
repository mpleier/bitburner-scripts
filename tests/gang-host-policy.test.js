import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {planGangHost,gangHostPreferences,factionForcedJoins,rankFactionInvites} from '../faction-policy.js';
import {gangMutationAllowed} from '../gang-policy.js';

const combat=['Speakers for the Dead','The Dark Army','The Syndicate','Tetrads','Slum Snakes'];
const reset={lastNodeReset:10,lastAugReset:20,currentNode:9};
function api(files={},alive=true){return {read:f=>files[f]||'',getResetInfo:()=>reset,isRunning:()=>alive};}
function active(preferences,extra={}){return JSON.stringify({preferences,nodeReset:10,augReset:20,ownerPid:1,...extra});}

test('hacking membership cannot stop default combat host pursuit',()=>{
 const p=planGangHost(['NiteSec','The Black Hand']);
 assert.equal(p.type,'combat');assert.equal(p.host,null);assert.equal(p.inviteOrder[0],'Slum Snakes');
 assert.deepEqual(planGangHost(['Slum Snakes','NiteSec']).ready,['Slum Snakes']);
});
test('default policy creates with an available combat host without waiting for stronger factions',()=>{
 for(const host of combat)assert.equal(planGangHost([host]).host,host);
 assert.equal(planGangHost([]).host,null);
});
test('explicit hacking preference supports NiteSec and Black Hand',()=>{
 for(const host of ['NiteSec','The Black Hand'])assert.equal(planGangHost([host],{'gang-type':'hacking'}).host,host);
 assert.equal(planGangHost(['Slum Snakes'],{'gang-type':'hacking'}).host,null);
 assert.deepEqual(planGangHost([],{'gang-type':'hacking'}).inviteOrder,['NiteSec','The Black Hand']);
});
test('explicit exact host implies type and never substitutes another host',()=>{
 const pref={'gang-faction':'The_Black_Hand'};
 assert.equal(planGangHost(['NiteSec','Slum Snakes'],pref).host,null);
 assert.equal(planGangHost(['The Black Hand'],pref).type,'hacking');
 assert.deepEqual(planGangHost([],pref).inviteOrder,['The Black Hand']);
});
test('excluded and invalid host preferences defer safely',()=>{
 assert.equal(planGangHost(['Slum Snakes'],{},['Slum Snakes']).host,null);
 assert.equal(planGangHost(['Slum Snakes'],{'gang-skip':['Slum Snakes']}).host,null);
 for(const pref of [{'gang-type':'invalid'},{'gang-faction':'Daedalus'},{'gang-skip':42},{'gang-skip':{}},{'gang-faction':'NiteSec','gang-skip':['NiteSec']},{error:'unreadable'}]){
  const p=planGangHost(combat,pref);assert.ok(p.error);assert.equal(p.host,null);assert.deepEqual(p.inviteOrder,[]);
 }
});
test('host ranking uses retained favor, then unowned unique count, with deterministic ties',()=>{
 const joined=['Speakers for the Dead','Slum Snakes'];
 assert.equal(planGangHost(joined,{},[],{'Slum Snakes':{favor:20}}).host,'Slum Snakes');
 assert.equal(planGangHost(joined,{},[],{'Slum Snakes':{unique:2}}).host,'Slum Snakes');
 assert.equal(planGangHost(joined,{},[],{'Speakers for the Dead':{favor:1},'Slum Snakes':{unique:20}}).host,'Speakers for the Dead');
 assert.equal(planGangHost(joined).host,'Speakers for the Dead');
 assert.equal(planGangHost(joined,{},[],{'Slum Snakes':{rep:1e9}}).host,'Speakers for the Dead');
});
test('configuration supports object and pair forms before the gang manager starts',()=>{
 for(const config of [{'gang-type':'hacking'},[['gang-type','hacking']]]){
  const p=gangHostPreferences(api({'gangs.js.config.txt':JSON.stringify(config)}));
  assert.equal(planGangHost(['NiteSec'],p).host,'NiteSec');
 }
});
test('live preference overrides require matching resets and a living owner',()=>{
 const files={'gangs.js.config.txt':'{"gang-type":"combat"}','tasks/gang-host-preferences.json':active({'gang-type':'hacking'})};
 assert.equal(gangHostPreferences(api(files))['gang-type'],'hacking');
 assert.equal(gangHostPreferences(api(files,false))['gang-type'],'combat');
 for(const extra of [{nodeReset:9},{augReset:19}])assert.equal(gangHostPreferences(api({...files,'tasks/gang-host-preferences.json':active({'gang-type':'hacking'},extra)}))['gang-type'],'combat');
});
test('current shared faction exclusions apply to both joining and creation',()=>{
 const p={nodeReset:10,augReset:20,skip:['Slum Snakes']};
 const files={'tasks/faction-join-plan.json':JSON.stringify(p)};
 assert.equal(planGangHost(['Slum Snakes'],gangHostPreferences(api(files))).host,null);
 files['tasks/faction-join-plan.json']=JSON.stringify({...p,augReset:19});
 assert.equal(planGangHost(['Slum Snakes'],gangHostPreferences(api(files))).host,'Slum Snakes');
});
test('corrupt preferences fail closed and corrupt expired runtime files do not block defaults',()=>{
 assert.ok(planGangHost(combat,gangHostPreferences(api({'gangs.js.config.txt':'invalid'}))).error);
 assert.equal(planGangHost(['Slum Snakes'],gangHostPreferences(api({'tasks/gang-host-preferences.json':'invalid','tasks/faction-join-plan.json':'invalid'}))).host,'Slum Snakes');
});
test('forced invitations and ordering honor host preference and BN2 karma exemption',()=>{
 assert.deepEqual(factionForcedJoins(null,2,'',true,0),['Slum Snakes','Tetrads','The Syndicate','The Dark Army','Speakers for the Dead']);
 assert.deepEqual(factionForcedJoins(null,9,'',true,0),[]);
 assert.deepEqual(factionForcedJoins(null,9,'',true,-54000,{'gang-type':'hacking'}),['NiteSec','The Black Hand']);
 assert.deepEqual(factionForcedJoins(null,9,'NiteSec',true,-54000),[]);
 assert.deepEqual(rankFactionInvites(['NiteSec','Slum Snakes','Daedalus'],true),['Daedalus','Slum Snakes','NiteSec']);
 assert.deepEqual(rankFactionInvites(['Slum Snakes','NiteSec','Daedalus'],true,{'gang-type':'hacking'}),['Daedalus','NiteSec','Slum Snakes']);
});

async function creationHarness({joined=['Slum Snakes'],preferences={},beforeCreation=()=>{},existing=false,sf4=false}={}) {
 const source=await readFile(new URL('../gangs.js',import.meta.url),'utf8');
 const files={},calls=[],queries=[],done=new Error('INITIALIZATION_OBSERVED');let inGang=existing;
 const ns={...api(files),pid:1,args:[],getScriptName:()=> 'gangs.js',getPlayer:()=>({factions:joined}),heart:{break:()=>-54000},
  disableLog(){},print(){},sleep:async()=>{},write:async(f,s)=>{files[f]=s;},
  gang:{inGang:()=>inGang,createGang:f=>{calls.push(f);inGang=true;return true;}}};
 const context={planGangHost,gangHostPreferences,gangMutationAllowed,automationHeartbeat(){},isScriptPaused:()=>false,log(){},formatNumberShort:String,
  getNsDataThroughFile:async(ns,expression,file,args=[])=>{
   assert.ok(args.every(a=>['string','number','boolean'].includes(typeof a)),'Netscript arguments must be primitives');
   queries.push(expression);
   if(expression==='ns.getPlayer()')throw done;
   if(file==='/Temp/gang-createGang.txt')beforeCreation(files,ns);
   ns.args=args;return vm.runInNewContext(expression,{ns});
  }};
 const stripped=source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
 vm.runInNewContext(stripped+';options='+JSON.stringify({'training-percentage':.05,'gang-type':'combat','gang-faction':null,'gang-skip':[],...preferences})+';ownedSourceFiles='+JSON.stringify({2:1,...(sf4?{4:3}:{})})+';globalThis.init=initialize;',context);
 await assert.rejects(context.init(ns),error=>error===done);
 return {calls,queries,files};
}
test('actual generated creation worker runs without Singularity or object arguments',async()=>{
 const r=await creationHarness();assert.deepEqual(r.calls,['Slum Snakes']);
 const worker=r.queries.find(s=>s.includes('ns.gang.createGang'));
 assert.ok(worker);assert.ok(!worker.includes('ns.singularity.'));
});
test('actual generated worker can create a NiteSec gang on explicit preference',async()=>{
 assert.deepEqual((await creationHarness({joined:['NiteSec'],preferences:{'gang-type':'hacking'}})).calls,['NiteSec']);
});
test('missing optional host benefit APIs do not prevent gang creation',async()=>{
 assert.deepEqual((await creationHarness({sf4:true})).calls,['Slum Snakes']);
});
test('creation worker rechecks exclusions that change after scheduling',async()=>{
 // Let the second pass see an existing gang so the initialization harness exits without waiting forever.
 const r=await creationHarness({beforeCreation:(files,ns)=>{
  files['tasks/faction-join-plan.json']=JSON.stringify({nodeReset:10,augReset:20,skip:['Slum Snakes']});
  let first=true;ns.gang.inGang=()=>{if(first){first=false;return false;}return true;};
 }});
 assert.deepEqual(r.calls,[]);
});
test('existing gangs are never replaced by a new preferred type',async()=>{
 const r=await creationHarness({existing:true,preferences:{'gang-type':'hacking'}});
 assert.deepEqual(r.calls,[]);assert.ok(!r.queries.some(s=>s.includes('ns.gang.createGang')));
});
