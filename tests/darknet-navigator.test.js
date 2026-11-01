import test from 'node:test';
import assert from 'node:assert/strict';
import {mazeMovementReport,navigatorFile,navigatorReportFile} from '../darknet-navigator-policy.js';
import {main as navigate,claimRewardCaches} from '../darknet-maze.js';
import {electMazeLeases,mazeLeaseFile} from '../darknet-development-policy.js';
import {readDarknetReports} from '../darknet-throughput-policy.js';
import {packLabyrinthProgress} from '../darknet-labyrinth-policy.js';
import {refreshDarknetScouts} from '../darknet-rollout.js';
const scope=[1,2,'lab','(The Labyrinth)',4,'numeric',''];
test('movement responses update position only when native coordinates and local map agree',()=>{
 const previous={coords:[1,1],east:true};const moved={success:false,code:401,message:'You have moved to 3,1.',data:'###\n @ \n###'};
 assert.deepEqual(mazeMovementReport(moved,previous,'east').coords,[3,1]);
 for(const patch of [{code:408},{message:'You have moved to 5,1.'},{data:'unknown'},{message:'ambiguous response'}])assert.equal(mazeMovementReport({...moved,...patch},previous,'east'),null);
 assert.deepEqual(mazeMovementReport({...moved,message:'You cannot go that way. You are still at 1,1.'},previous,'east').coords,[1,1]);
});
function fixture(clock,pid=43,checkpoint=null){
 const lease=electMazeLeases(null,[{host:'origin',pid,at:clock.now,live:true,navigator:true,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at:clock.now}]}],{lastNodeReset:1,lastAugReset:2},3,clock.now);
 const files=new Map([[mazeLeaseFile,JSON.stringify(lease)],['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]);if(checkpoint)files.set('tasks/dnet-maze-lab.json',JSON.stringify(checkpoint));
 const moves=[],reports=[];let x=1;const messages=[];
 const ns={pid,args:['lab',JSON.stringify(scope)],disableLog(){},getHostname:()=> 'origin',getRunningScript:()=>({threads:1}),read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),fileExists:f=>files.has(f),scp:async()=>true,rm:f=>files.delete(f),isRunning:()=>true,hasRootAccess:()=>false,getPlayer:()=>({skills:{charisma:1700}}),print:s=>messages.push(s),sleep:async ms=>{clock.now+=ms;},formulas:{dnet:{getAuthenticateTime:()=>12000}},
  dnet:{probe:()=>['lab'],getServerDetails:()=>({modelId:'(The Labyrinth)',passwordLength:4,passwordFormat:'numeric',data:'',requiredCharismaSkill:1500}),labreport:async()=>{reports.push([x,1]);clock.now+=12000;return {success:true,coords:[x,1],north:false,east:true,south:false,west:x>1};},labradar:async()=>{clock.now+=12000;return {success:false};},authenticate:async(_host,direction)=>{moves.push(direction);clock.now+=12000;x+=2;return x===5?{success:true,code:200,data:'native-password'}:{success:false,code:401,message:'You have moved to '+x+',1.',data:'###\n @ \n###'};}}};
 return {ns,files,moves,reports,messages};
}
test('slow report and radar reads cannot starve a move; successful responses avoid per-move polling',async()=>{
 const original=Date.now,clock={now:1000000};Date.now=()=>clock.now;
 try{const f=fixture(clock);await navigate(f.ns);assert.deepEqual(f.moves,['east','east']);assert.deepEqual(f.reports,[[1,1]]);assert.ok(clock.now>=1036000);assert.equal(JSON.parse(f.files.get(navigatorReportFile('origin','lab'))).phase,'complete');assert.equal(JSON.parse(f.files.get('tasks/credentials-report-navigator-43.json')).entries[0][1],'native-password');assert.equal(f.messages.some(m=>/TypeError|ReferenceError/.test(m)),false,f.messages.join('\n'));}finally{Date.now=original;}
});
test('maze completion opens reward caches on the target or navigating host',async()=>{
 const exec=[],ns={ls:host=>host==='lab'?['reward.cache']:[],fileExists:()=>true,exec:(...args)=>{exec.push(args);return 9;}};
 await claimRewardCaches(ns,'lab','origin');assert.deepEqual(exec[0],['darknet-cache.js','lab',1]);
 const opened=[],self={ls:host=>host==='origin'?['self.cache']:[],fileExists:()=>false,dnet:{openCache:file=>opened.push(file)}};
 await claimRewardCaches(self,'lab','origin');assert.deepEqual(opened,['self.cache']);
});
test('a restarted PID resumes map knowledge but reads its own real entrance position',async()=>{
 const original=Date.now,clock={now:2000000};Date.now=()=>clock.now;
 try{const checkpoint=packLabyrinthProgress({labMap:{'1,1':2,'3,1':10},labVisited:new Set(['1,1','3,1']),labEnd:null},scope,clock.now);checkpoint.coords=[99,99];const f=fixture(clock,44,checkpoint);await navigate(f.ns);assert.deepEqual(f.reports,[[1,1]]);assert.deepEqual(f.moves,['east','east']);}finally{Date.now=original;}
});
test('unknown movement feedback forces a new native position report instead of replaying the move',async()=>{
 const original=Date.now,clock={now:3000000};Date.now=()=>clock.now;
 try{const f=fixture(clock);let count=0;f.ns.dnet.authenticate=async()=>{clock.now+=12000;return ++count===1?{success:false,code:408}:{success:true,code:200,data:'pw'};};await navigate(f.ns);assert.equal(f.reports.length,2);assert.deepEqual(f.reports,[[1,1],[1,1]]);}finally{Date.now=original;}
});
test('a live navigator is discovered without its scout and retains ownership during a slow native call',async()=>{
 const now=1000000,r={version:1,type:'navigator',host:'origin',pid:43,target:'lab',scope,at:now-600000,phase:'move',inFlight:true,expectedMs:240000,progressAt:0,neighbours:['lab']};let running=true;
 const ns={ls:()=>[navigatorReportFile('origin','lab')],read:()=>JSON.stringify(r),ps:()=>running?[{filename:navigatorFile,pid:43,args:['lab',JSON.stringify(scope)]}]:[]};
 const snapshot=await readDarknetReports(ns,now);assert.equal(snapshot.navigators.length,1);
 const source={host:'other',pid:7,live:true,at:now,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at:now}]},reset={lastNodeReset:1,lastAugReset:2};
 const chosen=electMazeLeases({nodeReset:1,augReset:2,at:now-1000,leases:[{maze:'lab',scope,host:'origin',pid:43,startedAt:now-300000}]},[source,...snapshot.navigators],reset,3,now);assert.equal(chosen.leases[0].pid,43);
 running=false;assert.equal((await readDarknetReports(ns,now)).navigators.length,0);
});
test('routine scout rollout preserves the navigator PID and its position',async()=>{
 const killed=[],ns={ls:()=>['report'],read:()=>JSON.stringify({version:3,host:'origin',pid:7,revision:'old'}),ps:()=>[{filename:'darknet-node.js',pid:7},{filename:navigatorFile,pid:43}].filter(p=>!killed.includes(p.pid)),scp:async()=>true,kill:pid=>killed.push(pid),exec:()=>8,print(){}};
 await refreshDarknetScouts(ns,['darknet-node.js',navigatorFile],'new');assert.ok(killed.includes(7));assert.equal(killed.includes(43),false);
});
test('failed in-flight publication delays the action without losing the navigator PID',async()=>{
 const original=Date.now,clock={now:4000000};Date.now=()=>clock.now;
 try{const f=fixture(clock);let failed=false;f.ns.scp=async file=>{if(file===navigatorReportFile('origin','lab')){const r=JSON.parse(f.files.get(file));if(r.inFlight&&r.phase==='move'&&!failed){assert.equal(f.moves.length,0);failed=true;return false;}}return true;};await navigate(f.ns);assert.equal(failed,true);assert.deepEqual(f.moves,['east','east']);assert.equal(f.reports.length,2);}finally{Date.now=original;}
});
test('navigator report names cannot collide for different source and target pairs',()=>{
 assert.notEqual(navigatorReportFile('a-b','c'),navigatorReportFile('a','b-c'));
});

test('checkpoint copies are batched while completion forces a final durable map',async()=>{
 const original=Date.now,clock={now:5000000};Date.now=()=>clock.now;
 try{
  const f=fixture(clock);let x=1,copies=0;
  f.ns.scp=async file=>{if(file==='tasks/dnet-maze-lab.json')copies++;return true;};
  f.ns.dnet.labreport=async()=>({success:true,coords:[x,1],north:false,east:true,south:false,west:x>1});
  f.ns.dnet.labradar=async()=>({success:false});
  f.ns.dnet.authenticate=async(_host,direction)=>{assert.equal(direction,'east');x+=2;clock.now+=1000;return x===25?{success:true,code:200,data:'password'}:{success:false,code:401,message:'You have moved to '+x+',1.',data:'###\n @ \n###'};};
  await navigate(f.ns);assert.equal(x,25);assert.ok(copies<12);const saved=JSON.parse(f.files.get('tasks/dnet-maze-lab.json'));assert.ok(saved.map.some(([k])=>k==='23,1'));
 }finally{Date.now=original;}
});

 test('overdue native calls release only the verified navigator and allow another source to own the maze',async()=>{
 const now=2000000,r={version:1,type:'navigator',host:'origin',pid:43,target:'lab',scope,at:now-840001,phase:'move',inFlight:true,expectedMs:240000,progressAt:0,neighbours:['lab']},killed=[];
 const ns={ls:()=>[navigatorReportFile('origin','lab')],read:()=>JSON.stringify(r),ps:()=>[{filename:navigatorFile,pid:43,args:['lab',JSON.stringify(scope)]}],kill:pid=>{killed.push(pid);return true;}};
 const snapshot=await readDarknetReports(ns,now);assert.equal(snapshot.navigators.length,0);assert.deepEqual(killed,[43]);
 const source={host:'other',pid:7,live:true,at:now,neighbours:['lab'],mazeRequests:[{maze:'lab',scope,at:now}]};
 const leases=electMazeLeases(null,[source,...snapshot.navigators],{lastNodeReset:1,lastAugReset:2},3,now);assert.equal(leases.leases[0].pid,7);
 ns.ps=()=>[{filename:navigatorFile,pid:43,args:['different',JSON.stringify(scope)]}];killed.length=0;await readDarknetReports(ns,now);assert.deepEqual(killed,[]);
 });

test('navigator publishes separate native action and coordination timings',async()=>{
 const original=Date.now,clock={now:6000000};Date.now=()=>clock.now;
 try{const f=fixture(clock);const scp=f.ns.scp;f.ns.scp=async(...args)=>{clock.now+=2;return scp(...args);};await navigate(f.ns);
 const r=JSON.parse(f.files.get(navigatorReportFile('origin','lab')));
 assert.equal(r.threads,1);assert.equal(r.timing.actions.position.count,1);assert.equal(r.timing.actions.move.count,2);
 assert.equal(r.timing.actions.position.ms,12000);assert.equal(r.timing.actions.move.ms,24000);assert.equal(r.timing.actions.radar.count,0);
 assert.ok(r.timing.coordinationMs>0);assert.ok(r.timing.coordinationMs<1000);
 }finally{Date.now=original;}
});

test('live thread resize checkpoints before spawning and refuses to restart if checkpoint copy fails',async()=>{
 const original=Date.now;
 try{for(const failCopy of [false,true]){
 const clock={now:7000000};Date.now=()=>clock.now;
 const saved=packLabyrinthProgress({labMap:{'1,1':2},labVisited:new Set(['1,1']),labEnd:'43,1'},scope,clock.now);
 const f=fixture(clock,43,saved),spawned=[];f.ns.args.push(clock.now-120001);
 f.ns.getScriptRam=()=>1;f.ns.getServerMaxRam=()=>8;f.ns.getServerUsedRam=()=>1;
 f.ns.formulas.dnet.getAuthenticateTime=(_d,n)=>10000/n;
 f.ns.scp=async (file,dest)=>!(failCopy&&file==='tasks/dnet-maze-lab.json'&&dest==='home');
 f.ns.spawn=(file,options,...args)=>{const checkpoint=JSON.parse(f.files.get('tasks/dnet-maze-lab.json'));assert.equal(checkpoint.entrance,'1,1');spawned.push({file,options,args});};
 await navigate(f.ns);
 if(failCopy){assert.equal(spawned.length,0);assert.deepEqual(f.moves,['east','east']);}
 else{assert.equal(spawned.length,1);assert.equal(spawned[0].options.threads,8);assert.equal(spawned[0].options.spawnDelay,100);assert.equal(spawned[0].args.at(-1),43);assert.deepEqual(f.moves,[]);}
 }}finally{Date.now=original;}
});

test('a zero spawn result keeps the current navigator running instead of ending the maze',async()=>{
 const original=Date.now;
 try{const clock={now:7000000};Date.now=()=>clock.now;const saved=packLabyrinthProgress({labMap:{'1,1':2},labVisited:new Set(['1,1']),labEnd:'43,1'},scope,clock.now);const f=fixture(clock,43,saved);let calls=0;f.ns.args.push(clock.now-120001);f.ns.getScriptRam=()=>1;f.ns.getServerMaxRam=()=>8;f.ns.getServerUsedRam=()=>1;f.ns.formulas.dnet.getAuthenticateTime=(_d,n)=>10000/n;f.ns.spawn=()=>{calls++;return 0;};await navigate(f.ns);assert.equal(calls,1);assert.deepEqual(f.moves,['east','east']);}finally{Date.now=original;}
});
test('exploration can upgrade threads before the exit is found',async()=>{
 const original=Date.now;
 try{const clock={now:9500000};Date.now=()=>clock.now;const map={'1,1':2};for(let x=3;x<=41;x+=2)map[x+',1']=2;const saved=packLabyrinthProgress({labMap:map,labVisited:new Set(['1,1']),labEnd:null},scope,clock.now);const f=fixture(clock,43,saved),spawned=[];f.ns.args.push(clock.now-120001);f.ns.getScriptRam=()=>1;f.ns.getServerMaxRam=()=>8;f.ns.getServerUsedRam=()=>1;f.ns.formulas.dnet.getAuthenticateTime=(_d,n)=>10000/n;f.ns.spawn=(...args)=>{spawned.push(args);};await navigate(f.ns);assert.equal(spawned.length,1);assert.deepEqual(f.moves,[]);}finally{Date.now=original;}
});
test('a navigator can start under the spawning scout lease before the manager re-elects it',async()=>{
 const original=Date.now;
 try{const clock={now:9000000};Date.now=()=>clock.now;const f=fixture(clock,43),lease=JSON.parse(f.files.get(mazeLeaseFile));lease.leases[0].pid=99;f.files.set(mazeLeaseFile,JSON.stringify(lease));f.ns.args[3]=99;await navigate(f.ns);assert.deepEqual(f.moves,['east','east']);}finally{Date.now=original;}
});
test('fresh native geometry is applied before any resize and an uncertain entrance stays unknown',async()=>{
 const original=Date.now,clock={now:8000000};Date.now=()=>clock.now;
 try{
 const saved=packLabyrinthProgress({labMap:{'1,1':1},labVisited:new Set(['1,1']),labEnd:'43,1',labEntrance:'1,1'},scope,clock.now);
 const f=fixture(clock,43,saved);f.ns.args.push(clock.now-120001);let spawned=false;
 f.ns.getScriptRam=()=>1;f.ns.getServerMaxRam=()=>8;f.ns.getServerUsedRam=()=>1;
 f.ns.formulas.dnet.getAuthenticateTime=(_d,n)=>10000/n;f.ns.spawn=()=>{spawned=true;};
 await navigate(f.ns);assert.equal(spawned,false);assert.deepEqual(f.moves,['east','east']);
 const checkpoint=JSON.parse(f.files.get('tasks/dnet-maze-lab.json'));assert.equal(checkpoint.entrance,null);
 }finally{Date.now=original;}
});
