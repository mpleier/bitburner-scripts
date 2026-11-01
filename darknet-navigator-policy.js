import {yieldDarknetLoot,clearLootYield} from './darknet-throughput-policy.js';
export const navigatorFile='darknet-maze.js';
export const navigatorReportFile=(host,target)=>'tasks/dnet-navigator-'+encodeURIComponent(JSON.stringify([host,target]))+'.json';
export const mazeCheckpointFile=target=>'tasks/dnet-maze-'+encodeURIComponent(target)+'.json';
const deltas={north:[0,-2],east:[2,0],south:[0,2],west:[-2,0]};
/** Trust only native coordinates matching the issued move and its returned local map. */
export function mazeMovementReport(result,previous,direction){
 if(!previous||Number(result?.code)!==401||typeof result.message!=='string'||typeof result.data!=='string')return null;
 const moved=/^You have moved to (-?\d+),(-?\d+)\.$/.exec(result.message),blocked=/^You cannot go that way\. You are still at (-?\d+),(-?\d+)\.$/.exec(result.message),match=moved||blocked;
 const delta=deltas[direction];if(!match||!delta)return null;
 const coords=[Number(match[1]),Number(match[2])],expected=moved?[previous.coords[0]+delta[0],previous.coords[1]+delta[1]]:previous.coords;
 const rows=result.data.replace(/\r/g,'').split('\n');
 if(!coords.every(Number.isSafeInteger)||coords.some((v,i)=>v!==expected[i])||rows.length!==3||rows.some(r=>r.length!==3)||rows[1][1]!=='@')return null;
 return {success:true,coords,north:rows[0][1]===' ',east:rows[1][2]===' ',south:rows[2][1]===' ',west:rows[1][0]===' '};
}
export async function scheduleNavigator(ns,target,scope,leasePid=null){
 const self=ns.getHostname();
 if(ns.ps(self).some(p=>p.filename===navigatorFile&&p.args?.[0]===target&&p.args?.[1]===JSON.stringify(scope)))return 0;
 if(!ns.fileExists(navigatorFile,self))return 0;
 const ram=ns.getScriptRam(navigatorFile,self);if(!(ram>0))return 0;
 const loot=ns.ps(self).find(p=>p.filename==='darknet-loot.js');
 const reclaimable=loot?loot.threads*ns.getScriptRam('darknet-loot.js',self):0;
 const available=Math.min(64,Math.floor((ns.getServerMaxRam(self)-ns.getServerUsedRam(self)+reclaimable)/ram));
 const threads=chooseMazeThreads(available,n=>ns.formulas.dnet.getAuthenticateTime(ns.dnet.getServerDetails(target),n,ns.getPlayer()));
 if(threads>0&&!await yieldDarknetLoot(ns,ram*threads,'navigator'))return 0;
 if(threads<1)return 0;
 // The spawning scout already holds the lease; pass its PID so the navigator can start before the
 // home manager re-elects it, instead of idling through the first lease cycle.
 const args=[target,JSON.stringify(scope),Date.now()];
 if(Number.isSafeInteger(leasePid)&&leasePid>0)args.push(leasePid);
 const pid=ns.exec(navigatorFile,self,threads,...args);if(pid)await clearLootYield(ns,'navigator');return pid;
}

/** Use the least RAM within ten percent of the fastest bounded native quote.
 * This accepts cumulative gains beyond a small marginal improvement without paying for flat returns. */
export function chooseMazeThreads(available,quote){
 if(!Number.isSafeInteger(available)||available<1)return 0;
 const quotes=[];
 for(let n=1;n<=Math.min(64,available);n++){
  let ms;try{ms=quote(n);}catch{break;}
  if(!Number.isFinite(ms)||ms<=0)break;
  quotes.push({n,ms});
 }
 if(!quotes.length)return 1;
 const fastest=Math.min(...quotes.map(q=>q.ms));
 return quotes.find(q=>q.ms<=fastest*1.1).n;
}

/** Require a known lower bound on remaining moves to repay a restart and retracing with margin. */
export function mazeResizePlan({currentThreads,available,quote,remainingMoves,retraceMoves,restartMs=30000}){
 if(!Number.isSafeInteger(currentThreads)||currentThreads<1||!Number.isSafeInteger(remainingMoves)||remainingMoves<1||!Number.isSafeInteger(retraceMoves)||retraceMoves<0||!Number.isFinite(restartMs)||restartMs<0)return null;
 const threads=chooseMazeThreads(available,quote);if(threads<=currentThreads)return null;
 let before,after;try{before=quote(currentThreads);after=quote(threads);}catch{return null;}
 if(!(Number.isFinite(before)&&before>0&&Number.isFinite(after)&&after>0&&after<before*.8))return null;
 const savings=(before-after)*remainingMoves,cost=restartMs+after*(retraceMoves+1);
 return savings>cost*1.5?{threads,beforeMs:before,afterMs:after,savingsMs:savings,restartCostMs:cost}:null;
}
