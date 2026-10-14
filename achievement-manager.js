import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {achievementCatalog} from './achievement-catalog.js';
import {campaignReady,achievementGoals,achievementActionAllowed,sourceEditAchievements} from './achievement-policy.js';
import {achievementWorkerSources} from './achievement-worker-sources.js';
import {achievementButton,unclickablePuzzle,readAchievementCatalog} from './achievement-ui.js';
import {autopilotSourceFiles} from './autopilot-policy.js';
import {claimSpending} from './spending-policy.js';
import {isScriptPaused} from './automation-control.js';
import {activityBusy,claimActivity,releaseActivity} from './activity-coordination.js';
import {transitionActive,transitionFile} from './progression-coordination.js';
import {getNsDataThroughFile} from './helpers.js';
export async function main(ns) {
 registerAutomation(ns);
 ns.disableLog('ALL');if(isScriptPaused(ns,ns.getScriptName())||ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 const reset=ns.getResetInfo(),access=autopilotSourceFiles(reset),levels=autopilotSourceFiles(reset,false);
 if(!access[4]){await ns.write('tasks/achievement-status.json',JSON.stringify({at:Date.now(),state:'waiting-for-SF4',catalog:achievementCatalog.length}),'w');return;}
 let catalog=achievementCatalog,catalogVerified=false;try{const c=JSON.parse(ns.read('tasks/achievement-runtime-catalog.json'));if(Array.isArray(c)&&c.length>40){catalog=c;catalogVerified=true;}}catch{}
 const children=new Set(),loads=new Set(),puzzles=new Map(),attempted=new Set();let ownedWork=null;let loadDeadline=0,loadRetryAt=0,bitverseStarted=0,lastUi=0;
 ns.atExit(()=>{for(const pid of children)ns.kill(pid);try{const lease=JSON.parse(ns.read('tasks/activity-lock.json'));if(lease.ownerPid===ns.pid&&['achievement-training','achievement-debt'].includes(lease.kind)){ns.write('tasks/achievement-cleanup-owner.json',JSON.stringify({ownerPid:ns.pid,at:Date.now(),work:ownedWork}),'w');ns.run('achievement-cleanup.js',1,ns.pid);}}catch{}releaseActivity(ns);});
 while(!isScriptPaused(ns,ns.getScriptName())) {
 automationHeartbeat(ns);
  try {
   const owned=await getNsDataThroughFile(ns,'ns.singularity.getUnlockedAchievements()','/Temp/achievement-unlocked.txt');
   if(!Array.isArray(owned))throw new Error('Achievement API returned invalid data');
   let profile;try{profile=JSON.parse(ns.read('tasks/achievement-profile.json'));}catch{}profile??={active:false};
   if(profile.kind==='debt'&&owned.includes('MONEY_M1B')){await getNsDataThroughFile(ns,`(${achievementWorkerSources.recoverDebt})(ns)`,'/Temp/achievement-debt-recovery.txt');profile={...profile,active:false,kind:'complete',disabledScripts:[],deniedActions:[]};await ns.write('tasks/achievement-profile.json',JSON.stringify(profile),'w');releaseActivity(ns);}
   let transition;try{transition=JSON.parse(ns.read(transitionFile));}catch{}
   if(transitionActive(transition,ns.ps('home'))){await ns.sleep(1000);continue;}
   const player=ns.getPlayer();let overclock=0;
   if(access[7])try{overclock=await getNsDataThroughFile(ns,'ns.bladeburner.inBladeburner()?ns.bladeburner.getSkillLevel("Overclock"):0','/Temp/achievement-overclock.txt');}catch{}
   const queues=await getNsDataThroughFile(ns,'({installed:ns.singularity.getOwnedAugmentations(false).length,total:ns.singularity.getOwnedAugmentations(true).length})','/Temp/achievement-queues.txt');
   const goals=achievementGoals({owned,levels,node:reset.currentNode,profile,queued:queues.total-queues.installed,overclock,money:player.money,ownerPid:ns.pid,nodeReset:reset.lastNodeReset});
   goals.holdPuzzle=!owned.includes('PROTOTYPETAMPERING')&&puzzles.has('PROTOTYPETAMPERING')&&ns.isRunning(puzzles.get('PROTOTYPETAMPERING'));
   goals.holdAugmentations ||= goals.holdPuzzle;
   let departure;try{departure=JSON.parse(ns.read('tasks/achievement-departure.json'));}catch{}
   if(departure?.nodeReset!==reset.lastNodeReset||owned.includes('INDECISIVE'))departure=null;
   if(departure?.nodeReset===reset.lastNodeReset&&!owned.includes('INDECISIVE')&&departure.route==='hacking') {
    if(!bitverseStarted){bitverseStarted=Date.now();await claimActivity(ns,'achievement-bitverse');
     await getNsDataThroughFile(ns,'await (async()=>{ns.singularity.connect("home");const q=[["home",[]]],seen=new Set(["home"]);while(q.length){const [h,path]=q.shift();if(h==="w0r1d_d43m0n"){for(const hop of path)if(!ns.singularity.connect(hop))return false;await ns.singularity.installBackdoor();return true;}for(const next of ns.scan(h))if(!seen.has(next)){seen.add(next);q.push([next,[...path,next]]);}}return false;})()','/Temp/achievement-bitverse.txt');}
    if(Date.now()-bitverseStarted<65*60000){await claimActivity(ns,'achievement-bitverse');goals.holdDeparture=['INDECISIVE'];goals.deniedActions.push('ui');}
    else{await ns.write('tasks/achievement-bitverse-attempt.json',JSON.stringify({nodeReset:reset.lastNodeReset,status:'timed-out'}),'w');releaseActivity(ns);ns.rm('tasks/achievement-departure.json','home');departure=null;bitverseStarted=0;}
   }
   if(owned.includes('INDECISIVE')&&bitverseStarted){releaseActivity(ns);bitverseStarted=0;ns.rm('tasks/achievement-departure.json','home');}
   if(catalogVerified){const supported=new Set(catalog.map(a=>a.ID));goals.holdDeparture=goals.holdDeparture.filter(id=>supported.has(id));if(!supported.has('QUEUE_40')){goals.minimumQueue=0;goals.holdAugmentations=goals.holdPuzzle;}}
   const missing=catalog.filter(a=>!owned.includes(a.ID)).map(a=>a.ID);
   await ns.write('tasks/achievement-goals.json',JSON.stringify(goals),'w');
   if(goals.debt&&!activityBusy(ns)&&await claimActivity(ns,'achievement-debt')){const receipt=await getNsDataThroughFile(ns,`(() => {const result=(${achievementWorkerSources.debtMilestone})(ns);return {result,work:ns.singularity.getCurrentWork()};})()`,'/Temp/achievement-debt.txt');ownedWork=receipt.work;}
   if(!activityBusy(ns)&&!departure&&goals.stats) {
    let black=false;if(access[7])try{black=await getNsDataThroughFile(ns,'ns.bladeburner.inBladeburner()&&/black/i.test(ns.bladeburner.getCurrentAction()?.type||"")','/Temp/achievement-blackops.txt');}catch{}
    if(!black&&await claimActivity(ns,'achievement-training')){const focus=await getNsDataThroughFile(ns,`(() => {const result=(${achievementWorkerSources.milestoneFocus})(ns,JSON.parse(ns.args[0]));return {result,work:ns.singularity.getCurrentWork()};})()`,'/Temp/achievement-focus.txt',[JSON.stringify(goals)]);if(['idle','protected-work'].includes(focus.result)){ownedWork=null;releaseActivity(ns);}else ownedWork=focus.work;}
   }else if(!goals.stats&&!goals.debt&&!bitverseStarted)releaseActivity(ns);
   if(!bitverseStarted&&!goals.debt&&!profile.active)await getNsDataThroughFile(ns,`(${achievementWorkerSources.achievementInfrastructure})(ns,JSON.parse(ns.args[0]),action=>(${achievementActionAllowed.toString()})(ns,action),${claimSpending.toString()})`,'/Temp/achievement-infrastructure.txt',[JSON.stringify(missing)]);
   if(goals.deniedActions.includes('stockInvesting'))try{await getNsDataThroughFile(ns,`(${achievementWorkerSources.achievementCashBank})(ns)`,'/Temp/achievement-cash-bank.txt');}catch{}
   // Idle load jobs use only spare rooted RAM and are cleaned up when the native achievement appears.
   if(missing.includes('RUNNING_SCRIPTS_1000')&&!bitverseStarted) {
    const servers=['home'],seen=new Set(servers);for(let i=0;i<servers.length;i++)try{for(const h of ns.scan(servers[i]))if(!seen.has(h)){seen.add(h);servers.push(h);}}catch{}
    const count=servers.reduce((n,h)=>{try{return n+ns.ps(h).length;}catch{return n;}},0);
    if(!loadDeadline&&Date.now()>=loadRetryAt)loadDeadline=Date.now()+45000;
    if(loadDeadline&&Date.now()<loadDeadline){let launched=0;const ram=ns.getScriptRam('achievement-load.js','home');
     for(const host of servers){let server;try{server=ns.getServer(host);}catch{continue;}if(!server.hasAdminRights||!(ram>0))continue;
      const free=Math.max(0,server.maxRam-server.ramUsed-(host==='home'?64:0));
      if(free<ram)continue;if(host!=='home')await ns.scp('achievement-load.js',host,'home');
      for(let i=0;i<Math.min(Math.floor(free/ram),200-launched,1005-count-launched);i++){const pid=ns.exec('achievement-load.js',host,1,ns.pid,Date.now(),launched);if(!pid)break;loads.add(pid);children.add(pid);launched++;}
      if(launched>=200)break;
     }}else if(loadDeadline){for(const pid of loads){ns.kill(pid);children.delete(pid);}loads.clear();loadDeadline=0;loadRetryAt=Date.now()+60000;}
   }else if(loads.size&&owned.includes('RUNNING_SCRIPTS_1000')){for(const pid of loads){ns.kill(pid);children.delete(pid);}loads.clear();}
   // Puzzle probes make bounded attempts and leave native unlock checking to the game.
   for(const [id,kind]of [['UNDOCUMENTEDFUNCTIONCALL','undocumented'],['BYPASS','bypass'],['TIMECOMPRESSION','time'],['PROTOTYPETAMPERING','prototype'],['RAINBOW','rainbow'],['FROZE','reload-url']]) {
    if(missing.includes(id)&&!attempted.has(id)&&!bitverseStarted){const pid=ns.run(kind==='bypass'?'achievement-bypass.js':'achievement-puzzles.js',1,kind);if(pid){attempted.add(id);children.add(pid);puzzles.set(id,pid);}}
   }
   if(!activityBusy(ns)&&!bitverseStarted&&Date.now()-lastUi>60000&&achievementActionAllowed(ns,'ui')) {
    const document=globalThis['doc'+'ument'];
    if(document){
     if(!catalogVerified&&achievementButton(document,/^Achievements$/)) {await ns.sleep(100);const c=readAchievementCatalog(document);if(c.length>40){catalog=c;catalogVerified=true;await ns.write('tasks/achievement-runtime-catalog.json',JSON.stringify(c),'w');}}
     unclickablePuzzle(document);
     if(missing.includes('DEVMENU')&&!attempted.has('DEVMENU')&&await claimActivity(ns,'achievement-devmenu')){try{const pid=ns.run('achievement-puzzles.js',1,'devmenu');if(pid){attempted.add('DEVMENU');children.add(pid);await ns.sleep(200);await getNsDataThroughFile(ns,'ns.singularity.goToLocation("Sector-12 City Hall")','/Temp/achievement-return-city.txt');}}finally{releaseActivity(ns);}}
     if(missing.includes('THE_VOID')&&!attempted.has('THE_VOID')){try{await getNsDataThroughFile(ns,'ns.singularity.goToLocation(ns.enums.LocationName.Void||"The Void")','/Temp/achievement-void.txt',[],false,1,0,true);}catch{}attempted.add('THE_VOID');}

     if(missing.includes('N00DLES')&&player.money>400000+Math.max(0,Number(ns.read('reserve.txt'))||0)&&await claimActivity(ns,'achievement-noodles')){
      try{const origin=player.city;const entered=await getNsDataThroughFile(ns,'(() => {const w=ns.singularity.getCurrentWork();if(["GRAFTING","CREATE_PROGRAM"].includes(w?.type))return false;if(ns.getPlayer().city!=="New Tokyo"&&!ns.singularity.travelToCity("New Tokyo"))return false;return ns.singularity.goToLocation("Noodle Bar");})()','/Temp/achievement-noodles.txt');if(entered){await ns.sleep(100);achievementButton(document,/^Eat noodles$/);if(origin!=='New Tokyo')await getNsDataThroughFile(ns,'ns.singularity.travelToCity(ns.args[0])','/Temp/achievement-noodles-return.txt',[origin]);}}finally{releaseActivity(ns);}}
    }lastUi=Date.now();
   }
   ns.rm('tasks/achievement-error.json','home');
   await ns.write('tasks/achievement-status.json',JSON.stringify({at:Date.now(),ownerPid:ns.pid,node:reset.currentNode,known:catalog.length,catalogVerified,unlocked:owned,profile,goals,
    uiResults:{void:ns.read('/Temp/achievement-void.txt').slice(0,240),noodles:ns.read('/Temp/achievement-noodles.txt').slice(0,240)},unsupportedSourceEntries:catalogVerified?achievementCatalog.filter(a=>!catalog.some(c=>c.ID===a.ID)).map(a=>a.ID):[],achievements:catalog.map(a=>({...a,status:owned.includes(a.ID)?'unlocked':sourceEditAchievements.has(a.ID)?'requires-source-or-save-edit-or-external-minigame':/^CHALLENGE_BN/.test(a.ID)?'scheduled-run':/^SF/.test(a.ID)||a.ID==='BN_DESTROYER'?'source-file-progression':'automatic',
     note:a.ID==='FROZE'?'Uses the native noScripts URL condition temporarily; restores the URL without freezing or killing scripts':a.ID==='RAINBOW'?'Bounded password probes; unresolved versions require the game puzzle password':undefined})),loadWorkers:loads.size}),'w');
  }catch(error){ns.print('Achievements waiting: '+String(error));await ns.write('tasks/achievement-error.json',JSON.stringify({at:Date.now(),error:String(error)}),'w');}
  await ns.sleep(5000);
 }
}
