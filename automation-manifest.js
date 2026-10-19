import {moduleManifest} from './remote-api-command-policy.js';
export {moduleManifest};
export const runtimeScripts=moduleManifest.filter(m=>m.supervised).map(m=>m.script);
export const watchedScripts=moduleManifest.filter(m=>m.watched).map(m=>m.script);
export const statusFiles=Object.fromEntries(moduleManifest.filter(m=>m.statusFile).map(m=>[m.script,m.statusFile]));
export const automaticManagerScripts=moduleManifest.filter(m=>m.launchOrder).sort((a,b)=>a.launchOrder-b.launchOrder).map(m=>m.script);

/** Shared with actual autopilot startup. No API calls or mutations. */
export function priorityManagerPlan({homeRam=0,sourceFiles={},node=1,options={},bladeburnerRank=1,corporationReady=false,corporationKnown=true,corporationRunning=false},manifest=moduleManifest){
 const enabled=name=>{
  switch(name){
   case 'remote-api-agent.js':case 'reliability-manager.js':return true;
   case 'grafting-manager.js':return homeRam>=64&&!!sourceFiles[10]&&!!sourceFiles[4];
   case 'spend-hacknet-hashes.js':return homeRam>=64&&!!sourceFiles[9];
   case 'bladeburner.js':return homeRam>=64&&!options['disable-bladeburner']&&!!(sourceFiles[6]||sourceFiles[7])&&bladeburnerRank!==0;
   case 'sleeve.js':return 10 in sourceFiles;
   case 'sleeve-expansion.js':return node===10;
   case 'corporation-manager.js':return corporationReady||!corporationKnown&&corporationRunning;
   case 'achievement-manager.js':return homeRam>=64&&!options['disable-achievements']&&Number(sourceFiles[4])>0;
   case 'soa-manager.js':case 'health-manager.js':return homeRam>=64&&Number(sourceFiles[4])>0;
   case 'go.js':return !options['disable-go']&&homeRam>=32;
   case 'infiltration-manager.js':return !options['disable-infiltration']&&homeRam>=64;
   case 'work-for-factions.js':return Number(sourceFiles[4])>0;
   default:return homeRam>=64;
  }
 };
 return manifest.filter(m=>m.priority).sort((a,b)=>a.priority-b.priority).map(m=>({name:m.script,enabled:!!enabled(m.script),priority:m.priority}));
}
