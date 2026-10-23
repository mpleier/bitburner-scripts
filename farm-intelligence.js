import {factionJoinAllowed,rankFactionInvites} from './faction-policy.js';
import {activityBusy} from './activity-coordination.js';
import {autopilotSourceFiles} from './autopilot-policy.js';
import {getConfiguration} from './helpers.js';
import {intelligenceSessionDecision,intelligenceUnlocked,observeIntelligenceFarm,intelligenceFarmPlan} from './intelligence-policy.js';
import {prepareResetBackup} from './reset-backup.js';
const schema=[['target',200],['max-resets',100],['max-minutes',10],['payback-hours',24],['probe-resets',2],['resume','autopilot.js']];
export async function main(ns){
 const o=getConfiguration(ns,schema);if(!o)return;ns.disableLog('ALL');
 const reset=ns.getResetInfo(),sf=autopilotSourceFiles(reset);
 const resume=()=>{if(ns.fileExists(o.resume,'home')&&!ns.ps('home').some(p=>p.filename===o.resume))ns.run(o.resume,1);};
 if(!Number(sf[4])||!intelligenceUnlocked(reset)){ns.print('Intelligence farming requires Singularity and unlocked Intelligence.');resume();return;}
 if(ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 let state;try{state=JSON.parse(ns.read('tasks/intelligence-session.json'));}catch{}
 if(state?.nodeReset!==reset.lastNodeReset||state.target!==undefined&&state.target!==Number(o.target)){
  state={nodeReset:reset.lastNodeReset,startedAt:Date.now(),resets:0,status:'ready',target:Number(o.target),measurements:[]};
  try{const p=JSON.parse(ns.read('tasks/intelligence-progress.json'));
   if(p.augReset===reset.lastAugReset&&p.nodeReset===reset.lastNodeReset&&p.at<=Date.now()&&Date.now()-p.at<30000&&ns.isRunning(p.pid)&&Number.isFinite(p.xpPerSecond)&&p.xpPerSecond>0)state.passiveXpPerSecond=p.xpPerSecond;
  }catch{}
 }
 const finish=async reason=>{
  state.status=reason==='complete'?'complete':'blocked';state.reason=reason;
  await ns.write('tasks/intelligence-session.json',JSON.stringify(state),'w');ns.print('Intelligence farming: '+reason);resume();
 };
 const protectedProgress=()=>{
  const owned=ns.singularity.getOwnedAugmentations(true),installed=ns.singularity.getOwnedAugmentations(false);
  let busy=activityBusy(ns)||['GRAFTING','CREATE_PROGRAM'].includes(ns.singularity.getCurrentWork()?.type);
  try{busy ||= /black/i.test(ns.bladeburner.getCurrentAction()?.type||'');}catch{}
  try{busy ||= Number(ns.getMoneySources().sinceInstall.casino)>0;}catch{}
  return {busy,queued:owned.length>installed.length};
 };
 try{
  const player=ns.getPlayer(),now=Date.now();state=observeIntelligenceFarm(state,player.exp.intelligence,now,reset.lastAugReset);
  let invites=ns.singularity.checkFactionInvitations();
  if(invites.length<10&&now-reset.lastAugReset<5000){await ns.sleep(1200);invites=ns.singularity.checkFactionInvitations();}
  const economics=intelligenceFarmPlan({state,xp:player.exp.intelligence,intelligence:player.skills.intelligence,target:Number(o.target),
   maxResets:Number(o['max-resets']),maxMinutes:Number(o['max-minutes']),paybackHours:Number(o['payback-hours']),probeResets:Number(o['probe-resets']),now:Date.now()});
  state.economics=economics;
  const decision=intelligenceSessionDecision({state,reset,intelligence:player.skills.intelligence,target:Number(o.target),
   maxResets:Number(o['max-resets']),maxMinutes:Number(o['max-minutes']),invites:invites.length,...protectedProgress(),economics});
  if(decision!=='farm'){await finish(decision);return;}
  await ns.write(ns.getScriptName()+'.config.txt',JSON.stringify(schema.map(([k])=>[k,o[k]])),'w');
  if(!state.backedUp){await prepareResetBackup(ns,'intelligence session');state.backedUp=true;}
  let fresh=protectedProgress();if(fresh.busy||fresh.queued){await finish('protected-progress');return;}
  const before=ns.getPlayer().exp.intelligence,cycleAt=Date.now();let joins=0;
  for(const f of rankFactionInvites(ns.singularity.checkFactionInvitations()))
   if(factionJoinAllowed({joined:()=>ns.getPlayer().factions,read:path=>ns.read(path),reset:()=>ns.getResetInfo()},f)&&ns.singularity.joinFaction(f))joins++;
  if(!joins||!(ns.getPlayer().exp.intelligence>before)){await finish('no-measured-intelligence-gain');return;}
  state.resets++;state.status='farming';state.lastCycle={at:cycleAt,xp:before,joins,resetNumber:state.resets,augReset:reset.lastAugReset};
  await ns.write('tasks/intelligence-session.json',JSON.stringify(state),'w');
  fresh=protectedProgress();if(fresh.busy||fresh.queued){await finish('protected-progress');return;}
  if(!ns.singularity.softReset(ns.getScriptName()))await finish('reset-rejected');
 }catch(error){await finish('API unavailable: '+String(error));}
}
