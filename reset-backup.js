import { getNsDataThroughFile } from './helpers.js';
export function matchingBackup(receipt,id) {return receipt?.id===id&&receipt.status==='saved'&&Number.isFinite(receipt.bytes)&&receipt.bytes>0;}
/** Export gives the bonus; the Remote API separately stores an importable local save. */
export async function prepareResetBackup(ns,reason,timeout=12000) {
 let exportStatus='unavailable',exportError=null;
 try {
  // Select before generating the worker: an unknown static API name can prevent RAM calculation.
  const modern=await getNsDataThroughFile(ns,'"hasExportGameBonus" in ns.singularity','/Temp/reset-export-interface.txt');
  const command=exportBonusCommand(modern);
  exportStatus=await getNsDataThroughFile(ns,command,'/Temp/reset-export-bonus.txt');
 }catch(error){exportError=String(error);}
 const reset=ns.getResetInfo(),id=Date.now()+'-'+ns.pid;
 await ns.write('tasks/save-backup-request.json',JSON.stringify({id,reason,node:reset.currentNode,reset:reset.lastAugReset,expiresAt:Date.now()+timeout}),'w');
 let receipt;
 const end=Date.now()+timeout;
 while(Date.now()<end){try{receipt=JSON.parse(ns.read('tasks/save-backup-receipt.json'));}catch{}
  if(matchingBackup(receipt,id))break;if(receipt?.id===id&&receipt.status==='failed')break;await ns.sleep(200);}
 const result={at:Date.now(),reason,exportStatus,exportError,backup:matchingBackup(receipt,id)?'saved':'unavailable',receipt:receipt?.id===id?receipt:null};
 await ns.write('tasks/reset-backup-status.json',JSON.stringify(result),'w');
 if(result.backup!=='saved')ns.print('Reset backup: local Remote API backup unavailable; proceeding with configured reset policy.');
 return result;
}

export function exportBonusCommand(modern) {
 const check=modern?'ns.singularity.hasExportGameBonus()':'ns.singularity.exportGameBonus()';
 return `await (async()=>{if(!${check})return "not-due";await ns.singularity.exportGame();return ${check}?"failed":"claimed";})()`;
}
