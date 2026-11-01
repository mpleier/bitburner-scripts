import {charismaGoalFile,charismaTrainingFile,charismaLedgerFile,passiveCharismaRate,planCharismaStudy,planCharismaInterrupt} from './darknet-charisma-policy.js';
import {activityBusy,activityRecord,claimActivity,releaseActivity,compatibleFocusWorkers} from './activity-coordination.js';
import {maintenanceRequested} from './runtime-policy.js';
import {isScriptPaused} from './automation-control.js';
import {achievementActionAllowed} from './achievement-policy.js';
/** Home-only, short study bursts. Never takes over existing player work. */
export async function main(ns){
 ns.disableLog('ALL');if(ns.getHostname()!=='home')return;
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 const reset=ns.getResetInfo(),parent=Number(ns.args[0]);let goal=read(charismaGoalFile),ledger=read(charismaLedgerFile),owns=false,course=null;
 const same=ledger?.nodeReset===reset.lastNodeReset&&ledger.augReset===reset.lastAugReset;
 ledger=same?ledger:{version:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,goals:{},sample:null};
 const save=async()=>ns.write(charismaLedgerFile,JSON.stringify(ledger),'w');
 const status=async(state,reason,extra={})=>ns.write(charismaTrainingFile,JSON.stringify({version:1,ownerPid:ns.pid,parentPid:parent,at:Date.now(),nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,host:goal?.host,target:goal?.target,current:ns.getPlayer().skills.charisma,state,reason,...extra}),'w');
 const cleanup=()=>{try{if(owns&&(!activityRecord(ns)||activityRecord(ns)?.ownerPid===ns.pid)){const w=ns.singularity.getCurrentWork();if(course&&w?.type==='CLASS'&&w.classType==='Leadership'&&w.location===course.location)ns.singularity.stopAction();releaseActivity(ns);}owns=false;}catch{}};
 ns.atExit(cleanup);
 const allowed=()=>{
  const now=Date.now(),g=read(charismaGoalFile),transition=read('tasks/progression-transition.json'),aug=read('tasks/augmentation-reset-plan.json');
  return g?.version===1&&g.state==='target'&&g.ownerPid===parent&&g.nodeReset===reset.lastNodeReset&&g.augReset===reset.lastAugReset&&g.at<=now&&g.expiresAt>now&&g.target===goal.target&&ns.ps('home').some(p=>p.pid===parent&&p.filename==='darknet-manager.js')&&!maintenanceRequested(ns)&&!isScriptPaused(ns,'darknet-manager.js')&&!activityBusy(ns)&&!((transition?.expiresAt>now&&ns.isRunning(transition.ownerPid))||(aug?.pending&&aug.expiresAt>now&&ns.isRunning(aug.ownerPid)))&&achievementActionAllowed(ns,'cashSpending');
 };
 try{
  if(!goal||!allowed())return;
  const p=ns.getPlayer(),work=ns.singularity.getCurrentWork(),processes=ns.ps('home');
  const installed=ns.singularity.getOwnedAugmentations(false);
  // Neuroreceptor removes the focused-study penalty, so use focus=true when it
  // is installed. The quote calculation below already assumes that rate.
  const focus=installed.includes('Neuroreceptor Management Implant');
  const key=String(goal.target),prior=ledger.goals[key]||{seconds:0,cash:0},interruptBudget=prior.interrupt||{count:0,seconds:0,cash:0,lastAt:0};
  const studySeconds=1800,studyCash=15000000;
  const gap=goal.target-p.skills.charisma,smallGap=gap>0&&gap<=Math.max(1,Math.ceil(goal.target*.05));
  const interruptSecondsLeft=Math.max(0,Math.min(45-interruptBudget.seconds,studySeconds-prior.seconds));
  const interruptCashLeft=Math.max(0,Math.min(1000000-interruptBudget.cash,studyCash-prior.cash));
  let gangUrgent=false;try{gangUrgent=!ns.gang.inGang()&&p.karma>-54000;}catch{}
  const interruptibleWork=!!work&&['CRIME','COMPANY','FACTION'].includes(work.type);
  const canInterrupt=work?.type==='CRIME'&&smallGap&&!gangUrgent&&interruptBudget.count<2&&interruptSecondsLeft>=1&&interruptCashLeft>0&&Date.now()-interruptBudget.lastAt>=600000;
  // A Charisma bottleneck is allowed one bounded takeover of low-value company or
  // faction work every ten minutes; work-for-factions resumes afterward.
  const canTakeover=!!work&&['COMPANY','FACTION'].includes(work.type)&&!gangUrgent&&interruptBudget.count<1&&interruptSecondsLeft>=1&&interruptCashLeft>0&&Date.now()-interruptBudget.lastAt>=600000;
  if((work&&!canInterrupt&&!canTakeover)||!compatibleFocusWorkers(ns,processes)||processes.some(p=>/(^|\/)(casino|ascend)\.js$/.test(p.filename))||processes.some(p=>p.filename==='bladeburner.js')&&!installed.includes("The Blade's Simulacrum")){
   ledger.sample=null;await save();await status('deferred','Existing player work has priority');return;
  }
  if(p.skills.charisma>=goal.target){await status('complete','Charisma threshold reached');return;}
  if(!Object.hasOwn(ledger.goals,key)&&Object.keys(ledger.goals).length>=32){await status('bounded','Goal ledger is full');return;}
  const sample={at:Date.now(),exp:p.exp.charisma,signature:JSON.stringify([p.mults.charisma,p.mults.charisma_exp])};
  const passiveRate=passiveCharismaRate(ledger.sample,sample);ledger.sample=sample;await save();
  if(passiveRate===null){await status('sampling','Measuring passive Charisma XP while idle');return;}
  const quotes=[],universities={'Sector-12':'Rothman University',Aevum:'Summit University',Volhaven:'ZB Institute of Technology'};
  for(const [city,university]of Object.entries(universities))try{const gains=ns.formulas.work.universityGains({...p,city},'Leadership',university);quotes.push({city,university,rate:5*gains.chaExp*(focus?1:.8),costPerSecond:-5*gains.money,travelCost:city===p.city?0:200000});}catch{}
  let remainingXp;try{remainingXp=ns.formulas.skills.calculateExp(goal.target,p.mults.charisma*ns.getBitNodeMultipliers().CharismaLevelMultiplier)-p.exp.charisma;}catch{await status('deferred','Native training formulas unavailable');return;}
  let plan=planCharismaStudy({remainingXp,passiveRate,quotes,secondsUsed:prior.seconds,cashUsed:prior.cash,money:p.money,reserve:Math.max(0,Number(ns.read('reserve.txt'))||0),secondsBudget:studySeconds,cashBudget:studyCash});
  const interruptPlan=canInterrupt?planCharismaInterrupt({remainingXp,passiveRate,quotes,secondsUsed:0,cashUsed:0,money:p.money,reserve:Math.max(0,Number(ns.read('reserve.txt'))||0),maxSeconds:interruptSecondsLeft,maxCash:interruptCashLeft}):null;
  if(work){
   if(canTakeover){
    if(plan.state!=='study'){await status(plan.state,plan.reason,{passiveRate,passiveEtaSeconds:plan.passiveEtaSeconds??null,budget:prior});return;}
   }else{
    if(interruptPlan?.state!=='study'){const why=interruptPlan||{state:'deferred',reason:'No bounded interrupt course'};await status(why.state,why.reason,{passiveRate,passiveEtaSeconds:why.passiveEtaSeconds??null,budget:prior});return;}
    plan=interruptPlan;
   }
  }else if(plan.state!=='study'){await status(plan.state,plan.reason,{passiveRate,passiveEtaSeconds:plan.passiveEtaSeconds??null,budget:prior});return;}
  if(!allowed()||!await claimActivity(ns,'Dark Net Charisma milestone'))return;
  owns=true;
  if(ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0)<plan.cost)return;
  const current=ns.singularity.getCurrentWork();
  if(current){if(!(canInterrupt||canTakeover)||!interruptibleWork)return;try{ns.singularity.stopAction();}catch{return;}await ns.sleep(100);}
  if(ns.singularity.getCurrentWork()||!allowed())return;
  ledger.goals[key]={...prior,seconds:prior.seconds+plan.seconds,cash:prior.cash+plan.cost,...((canInterrupt||canTakeover)?{interrupt:{count:interruptBudget.count+1,seconds:interruptBudget.seconds+plan.seconds,cash:interruptBudget.cash+plan.cost,lastAt:Date.now()}}:{})};ledger.sample=null;await save();
  if(p.city!==plan.city&&!ns.singularity.travelToCity(plan.city)){await status('deferred','Travel unavailable');return;}
  if(!allowed()||ns.singularity.getCurrentWork())return;
  try{
   if(typeof ns.hacknet?.spendHashes==='function'&&typeof ns.hacknet?.hashCost==='function'){
    const cost=ns.hacknet.hashCost('Improve Studying'),hashes=ns.hacknet.numHashes?.();
    if(Number.isFinite(cost)&&cost>0&&Number.isFinite(hashes)&&hashes>=cost*2&&ns.hacknet.spendHashes('Improve Studying'))
     ns.print('Spent hashes on Improve Studying for a faster Charisma course.');
   }
  }catch{}
  if(!ns.singularity.universityCourse(plan.university,'Leadership',focus)){await status('deferred','Study unavailable');return;}
  course={location:plan.university};const deadline=Date.now()+plan.seconds*1000;
  await status('studying',plan.reason,{passiveRate,studyRate:plan.rate,etaSeconds:plan.etaSeconds,budget:ledger.goals[key],interrupt:canInterrupt});
  while(Date.now()<deadline&&allowed()&&ns.getPlayer().skills.charisma<goal.target){
   const w=ns.singularity.getCurrentWork();if(w?.type!=='CLASS'||w.classType!=='Leadership'||w.location!==course.location)break;
   if(ns.getPlayer().money-(Math.max(0,Number(ns.read('reserve.txt'))||0))<plan.costPerSecond*2)break;
   await claimActivity(ns,'Dark Net Charisma milestone');await ns.sleep(1000);
  }
  await status(ns.getPlayer().skills.charisma>=goal.target?'complete':'paused','Study burst finished',{budget:ledger.goals[key]});
 }catch(error){await status('deferred',String(error));}
 finally{cleanup();}
}
