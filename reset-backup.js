import { getNsDataThroughFile } from './helpers.js';
export function matchingBackup(receipt,id) {return receipt?.id===id&&receipt.status==='saved'&&Number.isFinite(receipt.bytes)&&receipt.bytes>0;}
/** Export gives the bonus; the Remote API separately stores an importable local save.
 *  The listener polls every two seconds and the socket reconnects on its own, so a single request that lands
 *  during a reconnect expired unanswered (receipt null, backup "unavailable"). Retry once inside one budget. */
export async function prepareResetBackup(ns,reason,timeout=45000) {
 let exportStatus='unavailable',exportError=null;
 try {
  // Select before generating the worker: an unknown static API name can prevent RAM calculation.
  const modern=await getNsDataThroughFile(ns,'"hasExportGameBonus" in ns.singularity','/Temp/reset-export-interface.txt');
  const command=exportBonusCommand(modern);
  exportStatus=await getNsDataThroughFile(ns,command,'/Temp/reset-export-bonus.txt');
 }catch(error){exportError=String(error);}
 const reset=ns.getResetInfo(),deadline=Date.now()+timeout;
 let receipt,id;
 for(let attempt=0;attempt<2&&Date.now()<deadline;attempt++){
  id=Date.now()+'-'+ns.pid+'-'+attempt;
  // The listener rejects an expiry beyond a minute, so keep each request inside that window.
  await ns.write('tasks/save-backup-request.json',JSON.stringify({id,reason,node:reset.currentNode,reset:reset.lastAugReset,expiresAt:Math.min(deadline,Date.now()+55000)}),'w');
  // Split the budget: a first window that took the whole deadline left the retry nothing to work with.
  const until=attempt===0?Math.min(deadline,Date.now()+Math.floor(timeout/2)):deadline;
  while(Date.now()<until){try{receipt=JSON.parse(ns.read('tasks/save-backup-receipt.json'));}catch{}
   if(matchingBackup(receipt,id))break;if(receipt?.id===id&&receipt.status==='failed')break;await ns.sleep(200);}
  if(matchingBackup(receipt,id))break;if(receipt?.id===id&&receipt.status==='failed')break;
 }
 const saved=matchingBackup(receipt,id);
 const result={at:Date.now(),reason,exportStatus,exportError,backup:saved?'saved':'unavailable',receipt:receipt?.id===id?receipt:null};
 await ns.write('tasks/reset-backup-status.json',JSON.stringify(result),'w');
 if(!saved)ns.print('Reset backup: local Remote API backup unavailable after '+Math.round(timeout/1000)+'s; proceeding with configured reset policy.');
 return result;
}

export function exportBonusCommand(modern) {
 const check=modern?'ns.singularity.hasExportGameBonus()':'ns.singularity.exportGameBonus()';
 return `await (async()=>{if(!${check})return "not-due";await ns.singularity.exportGame();return ${check}?"failed":"claimed";})()`;
}
