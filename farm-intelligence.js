import { activityBusy } from './activity-coordination.js';
import { autopilotSourceFiles } from './autopilot-policy.js';
import { getConfiguration } from './helpers.js';
import { intelligenceSessionDecision, intelligenceUnlocked } from './intelligence-policy.js';
import { prepareResetBackup } from './reset-backup.js';
const schema=[['target',200],['max-resets',100],['max-minutes',10],['resume','autopilot.js']];
export async function main(ns) {
 const o=getConfiguration(ns,schema);if(!o)return;ns.disableLog('ALL');
 const reset=ns.getResetInfo(),sf=autopilotSourceFiles(reset);
 if(!Number(sf[4]))return ns.tprint('Intelligence farming requires Singularity access.');
 if(!intelligenceUnlocked(reset))return ns.tprint('Intelligence farming requires BitNode 5 or permanent Source-File 5.');
 if(ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 let state;try{state=JSON.parse(ns.read('tasks/intelligence-session.json'));}catch{}
 if(state?.nodeReset!==reset.lastNodeReset)state={nodeReset:reset.lastNodeReset,startedAt:Date.now(),resets:0,status:'ready'};
 let invites=ns.singularity.checkFactionInvitations();
 if(invites.length<10&&Date.now()-reset.lastAugReset<5000){await ns.sleep(1200);invites=ns.singularity.checkFactionInvitations();}
 const owned=ns.singularity.getOwnedAugmentations(true),installed=ns.singularity.getOwnedAugmentations(false);
 let busy=activityBusy(ns)||['GRAFTING','CREATE_PROGRAM'].includes(ns.singularity.getCurrentWork()?.type);
 try{busy ||= /black/i.test(ns.bladeburner.getCurrentAction()?.type||'');}catch{}
 const decision=intelligenceSessionDecision({state,reset,intelligence:ns.getPlayer().skills.intelligence,target:Number(o.target),
  maxResets:Number(o['max-resets']),maxMinutes:Number(o['max-minutes']),invites:invites.length,queued:owned.length>installed.length,busy});
 if(decision!=='farm') {
  state.status=decision==='complete'?'complete':'blocked';state.reason=decision;
  await ns.write('tasks/intelligence-session.json',JSON.stringify(state),'w');ns.print('Intelligence farming: '+decision);
  if(decision==='complete'&&ns.fileExists(o.resume,'home')&&!ns.ps('home').some(p=>p.filename===o.resume))ns.run(o.resume,1);
  return;
 }
 // Persist bounded options because reset callbacks cannot receive arguments.
 await ns.write(ns.getScriptName()+'.config.txt',JSON.stringify(schema.map(([k])=>[k,o[k]])),'w');
 if(!state.backedUp){await prepareResetBackup(ns,'intelligence session');state.backedUp=true;}
 const freshOwned=ns.singularity.getOwnedAugmentations(true),freshInstalled=ns.singularity.getOwnedAugmentations(false);
 let freshBusy=activityBusy(ns)||['GRAFTING','CREATE_PROGRAM'].includes(ns.singularity.getCurrentWork()?.type);
 try{freshBusy ||= /black/i.test(ns.bladeburner.getCurrentAction()?.type||'');}catch{}
 if(freshOwned.length>freshInstalled.length||freshBusy) {
  state.status='blocked';state.reason='protected-progress';await ns.write('tasks/intelligence-session.json',JSON.stringify(state),'w');return;
 }
 invites.forEach(f=>ns.singularity.joinFaction(f));
 state.resets++;state.status='farming';ns.write('tasks/intelligence-session.json',JSON.stringify(state),'w');
 ns.singularity.softReset(ns.getScriptName());
}
