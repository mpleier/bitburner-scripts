import {captureParallelTrainingObservation,parallelTrainingFragment,recordParallelTrainingCalibration} from '../parallel-training-measurement-policy.js';
import {chooseParallelCombatTraining} from '../bb-stat-development-policy.js';
import {readBladeburnerTrainingProgress} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {captureTrainingBackground,trainingBackgroundDelta,playerTrainingScope,recordPlayerTrainingCalibration,calibratePlayerTrainingQuotes} from '../player-training-calibration-policy.js';
import {combatXpValue} from '../combat-growth-policy.js';
import {quotePlayerCombatTraining,choosePlayerCombatTraining} from '../player-combat-training-policy.js';
import {augmentationCashReserve,claimSpending} from '../spending-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {bladeburnerRecruitmentBudget} from '../bladeburner-policy.js';
/** One bounded session, always supervised by its parent and an activity lease. */
export async function main(ns){
 ns.disableLog('ALL');let input;try{input=JSON.parse(ns.args[0]);}catch{return;}
 return runPlayerCombatTraining(ns,input);
}
export async function runPlayerCombatTraining(ns,input){
 if(!input||!Number.isSafeInteger(input.parent)||input.parent<=0||typeof input.target!=='string'||!input.target||input.target.length>100||![input.nodeReset,input.augReset,input.remainingMs].every(Number.isFinite)||input.remainingMs<=0||input.remainingMs>120000)return;
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}},file='tasks/bladeburner-external-training-'+input.parent+'.json',devFile='tasks/bladeburner-development.json';
 let own=null,lastCycles=0,startedAt=null,charged=false,choice=null,reason='unavailable',before=null,bbStopped=false;
 let missionIdentity=null,missionProgress=null,missionCompleted=false,measurementPrevious=null;const fragments=[];
 let backgroundBefore=null,stable=true,scope=null,nativeRates=null,nativeTime=null,parallelTraining=false;
 const calibrationFile='tasks/player-training-calibration.json';
 const identity=w=>w?JSON.stringify([w.type,w.crimeType??null,w.classType??null,w.location??null]):null;
 const owned=()=>{const w=ns.singularity.getCurrentWork();return !!own&&identity(w)===own&&(!Number.isFinite(w.cyclesWorked)||w.cyclesWorked>=lastCycles);};
 const cleanup=()=>{
  if(charged)return;charged=true;
  if(startedAt!==null)try{if(!guard())reason=missionCompleted?'mission-boundary':'guard-changed';}catch{stable=false;}
  if(input.parallelMission&&startedAt!==null)try{const next=captureParallelTrainingObservation(ns,input),fragment=parallelTrainingFragment(measurementPrevious,next);if(fragment&&fragments.length<160)fragments.push(fragment);measurementPrevious=next;}catch{}
  try{if(owned())ns.singularity.stopAction();}catch{}
  const end=Date.now(),elapsedMs=startedAt===null?0:Math.max(0,end-startedAt);
  try{const d=read(devFile),reset=ns.getResetInfo();if(elapsedMs>0&&d?.pid===input.parent&&d.nodeReset===reset.lastNodeReset&&d.augReset===reset.lastAugReset){
   const budget=bladeburnerRecruitmentBudget(d.budget,reset.lastNodeReset,end,startedAt,true,600000);
   ns.write(devFile,JSON.stringify({...d,at:end,training:false,budget,externalTrainingTotal:Math.max(0,Number(d.externalTrainingTotal)||0)+elapsedMs/30000,trainingMilestone:d.trainingMilestone?{...d.trainingMilestone,used:d.trainingMilestone.used+elapsedMs/30000,training:false,anchor:null,observedAt:end}:undefined}),'w');
  }}catch{}
  try{const plan=read('tasks/player-gym-plan.json');if(plan?.ownerPid===ns.pid)ns.rm('tasks/player-gym-plan.json');}catch{}
  try{const lock=read('tasks/activity-lock.json');if(lock?.ownerPid===input.parent&&lock.workerPid===ns.pid)ns.rm('tasks/activity-lock.json');}catch{}
  let after=null,calibration=null;try{
   const p=ns.getPlayer();after={...p.exp};
   if(startedAt!==null&&scope){
    const background=trainingBackgroundDelta(backgroundBefore,captureTrainingBackground(ns));
    const nativeUpper=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,parallelTraining?nativeRates[k]*(elapsedMs/1000*5+nativeTime/1000):0]));
    stable=stable&&playerTrainingScope(p,input)===scope;
    const saved=input.parallelMission?recordParallelTrainingCalibration(read(calibrationFile),{fragments,scope,at:end,id:input.parent+':'+ns.pid+':'+input.at,choice,elapsedMs,reason,stable}):recordPlayerTrainingCalibration(read(calibrationFile),{scope,at:end,id:input.parent+':'+ns.pid+':'+input.at,choice,before,after,background,nativeUpper,elapsedMs,reason,stable});
    ns.write(calibrationFile,JSON.stringify(saved),'w');calibration={accepted:saved.samples.some(s=>s.id===input.parent+':'+ns.pid+':'+input.at),backgroundKnown:background!==null,stable,parallelTraining,measurement:saved.measurement??null};
   }
  }catch{}
  ns.write(file,JSON.stringify({at:end,parent:input.parent,workerPid:ns.pid,requestAt:input.at,started:startedAt!==null,elapsedMs,reason,choice,before,after,bbStopped,calibration}),'w');
 };
 const guard=()=>{
  const now=Date.now(),r=ns.getResetInfo(),lock=read('tasks/activity-lock.json'),route=read('tasks/node-route-plan.json'),dev=read(devFile),action=ns.bladeburner.getCurrentAction();
  if(!ns.isRunning(input.parent)||r.lastNodeReset!==input.nodeReset||r.lastAugReset!==input.augReset||!lock||lock.ownerPid!==input.parent||lock.expiresAt<=now||lock.workerPid&&lock.workerPid!==ns.pid)return false;
  if(!route||route.selected!=='bladeburner'||route.nodeReset!==r.lastNodeReset||route.augReset!==r.lastAugReset||route.at>now||now-route.at>45000||!ns.isRunning(route.ownerPid))return false;
  if(!dev||dev.pid!==input.parent||dev.target!==input.target||dev.nodeReset!==r.lastNodeReset||dev.augReset!==r.lastAugReset||dev.at>now||now-dev.at>60000)return false;
  if(input.parallelMission){
   if(!dev.chanceBlocked&&!dev.preparingStats)return false;
   if(!['Contracts','Operations'].includes(action?.type)||action.name!==input.mission?.name||action.type!==input.mission?.type||!ns.singularity.getOwnedAugmentations(false).includes("The Blade's Simulacrum"))return false;
   const identity=JSON.stringify([action.type,action.name,ns.bladeburner.getCity(),ns.bladeburner.getActionCurrentLevel(action.type,action.name)]);
   if(missionIdentity&&identity!==missionIdentity)return false;
   if(startedAt!==null&&typeof ns.bladeburner.getActionCurrentTime==='function'){
    const progress=ns.bladeburner.getActionCurrentTime();if(Number.isFinite(progress)&&progress>=0){if(missionProgress!==null&&progress<missionProgress){missionCompleted=true;return false;}missionProgress=progress;}
   }
   const stamina=ns.bladeburner.getStamina();if(!(stamina[1]>0&&stamina[0]/stamina[1]>=.5))return false;
  }else if(action?.name&&!(action.type==='General'&&action.name==='Training'))return false;
  if(!achievementActionAllowed(ns,'bladeburner')||!achievementActionAllowed(ns,'crime')||ns.read('remote-control/paused/bladeburner.js.txt').trim()==='true'||ns.read('remote-control/paused/crime.js.txt').trim()==='true')return false;
  for(const f of ['tasks/automation-maintenance.json','tasks/progression-transition.json','tasks/augmentation-reset-plan.json']){const s=read(f);if(s&&s.expiresAt>now&&ns.isRunning(s.ownerPid)&&(f!=='tasks/augmentation-reset-plan.json'||s.pending))return false;}
  if(ns.ps('home').some(p=>p.pid!==input.parent&&/(^|\/)(casino|ascend|crime)\.js$/.test(p.filename)))return false;
  const p=ns.getPlayer();if(!p.hp||p.hp.max<=0||p.hp.current/p.hp.max<.75)return false;
  if(choice?.kind==='gym'&&(p.money<Math.max(Number(ns.read('reserve.txt'))||0,augmentationCashReserve(ns))+choice.costPerSecond||!achievementActionAllowed(ns,'cashSpending')))return false;
  if(startedAt!==null){
   if(!owned())return false;
   if(stable&&(playerTrainingScope(p,input)!==scope||ns.bladeburner.getActionTime('General','Training')!==nativeTime||trainingBackgroundDelta(backgroundBefore,captureTrainingBackground(ns))===null))stable=false;
   if(action?.name==='Training')parallelTraining=true;
  }
  return true;
 };
 ns.atExit(cleanup);
 try{
  if(!Number.isFinite(input.at)||Date.now()<input.at||Date.now()-input.at>5000||input.boundary!==true||!guard()||ns.singularity.getCurrentWork())return;
  const d=read(devFile),p=ns.getPlayer(),m=d.trainingMilestone;
  if(!m||m.target!==input.target||!(m.limit>m.used)||!(input.remainingMs>=1000))return;
  const b=ns.bladeburner,reaper=1+.02*b.getSkillLevel('Reaper'),evasive=1+.04*b.getSkillLevel('Evasive System'),context={metadata:d.metadata,player:p,speedWeight:.25,effective:{strength:reaper,defense:reaper,dexterity:reaper*evasive,agility:reaper*evasive},inferLevels:true};
  const time=b.getActionTime('General','Training'),rates=Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,30*(p.mults[k+'_exp']??1)/(time/1000)])),baselineScore=combatXpValue(rates,context);
  const reserve=Math.max(0,Number(ns.read('reserve.txt'))||0,augmentationCashReserve(ns));
  scope=playerTrainingScope(p,input);nativeRates=rates;nativeTime=time;
  const quotes=calibratePlayerTrainingQuotes(quotePlayerCombatTraining(ns,context,true),read(calibrationFile),scope,Date.now(),context);
  const simulacrum=ns.singularity.getOwnedAugmentations(false).includes("The Blade's Simulacrum");
  const parallelNative=simulacrum&&b.getCurrentAction()?.name==='Training',bonusMs=b.getBonusTime();
  const stamina=quotePlayerTrainingStamina(context,{stamina:b.getStamina(),cyber:b.getSkillLevel("Cyber's Edge"),time,bonusMs,progressMs:readBladeburnerTrainingProgress(b,time)});
  if(!stamina&&!input.parallelMission){reason='stamina-quote-unavailable';return;}
  const nativeComparisonRates=rates;
  choice=input.parallelMission?chooseParallelCombatTraining(quotes,{simulacrum,remainingMs:Math.min(input.remainingMs,120000-(d.budget?.spentMs||0)),quotaLeft:m.limit-m.used,money:p.money,reserve,localCity:p.city}):choosePlayerCombatTraining(quotes,{baselineScore,remainingMs:Math.min(input.remainingMs,120000-(d.budget?.spentMs||0)),quotaLeft:m.limit-m.used,money:p.money,reserve,rankGap:input.rankGap,rankRate:input.rankRate,simulacrum,stamina,nativeRates:nativeComparisonRates,parallelNative,bonusMs});
  if(!choice){reason='native-training-retained';return;}
  if(choice.kind==='gym'&&(!achievementActionAllowed(ns,'cashSpending')||!claimSpending(ns,'training',choice.cost))){choice=input.parallelMission?chooseParallelCombatTraining(quotes.filter(q=>q.kind==='crime'),{simulacrum,remainingMs:Math.min(input.remainingMs,120000-(d.budget?.spentMs||0)),quotaLeft:m.limit-m.used,money:p.money,reserve,localCity:p.city}):choosePlayerCombatTraining(quotes.filter(q=>q.kind==='crime'),{baselineScore,remainingMs:Math.min(input.remainingMs,120000-(d.budget?.spentMs||0)),quotaLeft:m.limit-m.used,money:p.money,reserve,rankGap:input.rankGap,rankRate:input.rankRate,simulacrum,stamina,nativeRates:nativeComparisonRates,parallelNative,bonusMs});if(!choice){reason='training-budget-held';return;}}
  if(!guard()||ns.singularity.getCurrentWork()){reason='state-changed';return;}
  if(!input.parallelMission&&simulacrum&&(b.getCurrentAction()?.name==='Training')!==parallelNative){reason='native-parallel-state-changed';return;}
  if(!simulacrum&&b.getCurrentAction()?.name==='Training'){b.stopBladeburnerAction();bbStopped=true;}
  if(input.parallelMission){const action=b.getCurrentAction();missionIdentity=JSON.stringify([action.type,action.name,b.getCity(),b.getActionCurrentLevel(action.type,action.name)]);}
  if(choice.kind==='gym'&&choice.city!==ns.getPlayer().city){
   if(choice.fromCity!==ns.getPlayer().city||!achievementActionAllowed(ns,'cashSpending')||ns.getPlayer().money-reserve<choice.cost||!ns.singularity.travelToCity(choice.city)){reason='travel-rejected';return;}
   scope=playerTrainingScope(ns.getPlayer(),input);
  }
  const ok=choice.kind==='crime'?ns.singularity.commitCrime(choice.name,true):ns.singularity.gymWorkout(choice.gym,choice.gymType,true);
  if(!ok){reason='start-rejected';return;}
  const work=ns.singularity.getCurrentWork();if(!work||work.type!==(choice.kind==='crime'?'CRIME':'CLASS')){reason='unexpected-work';return;}
  own=identity(work);lastCycles=Number(work.cyclesWorked)||0;startedAt=Date.now();before={...ns.getPlayer().exp};backgroundBefore=captureTrainingBackground(ns);parallelTraining=b.getCurrentAction()?.name==='Training';reason='completed';
  if(choice.kind==='gym')ns.write('tasks/player-gym-plan.json',JSON.stringify({at:startedAt,until:startedAt+choice.durationMs,ownerPid:ns.pid,parent:input.parent,nodeReset:input.nodeReset,augReset:input.augReset,gym:choice.gym,gymType:choice.gymType}),'w');
  if(input.parallelMission)measurementPrevious=captureParallelTrainingObservation(ns,input);
  while(Date.now()-startedAt<choice.durationMs){
   if(!guard()){reason=missionCompleted?'mission-boundary':'guard-changed';break;}
   const lock=read('tasks/activity-lock.json');ns.write('tasks/activity-lock.json',JSON.stringify({...lock,ownerPid:input.parent,workerPid:ns.pid,expiresAt:Date.now()+15000}),'w');
   if(input.parallelMission){const next=captureParallelTrainingObservation(ns,input),fragment=parallelTrainingFragment(measurementPrevious,next);if(fragment&&fragments.length<160)fragments.push(fragment);measurementPrevious=next;}
   const w=ns.singularity.getCurrentWork();if(Number.isFinite(w?.cyclesWorked))lastCycles=w.cyclesWorked;
   await ns.sleep(Math.min(200,choice.durationMs-(Date.now()-startedAt)));
  }
 }catch(error){reason='deferred: '+String(error).slice(0,180);}finally{cleanup();}
}
