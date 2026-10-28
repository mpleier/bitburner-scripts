import {observeDarknetRefresh} from './darknet-refresh-policy.js';
import {applyStormReceipt} from './darknet-storm-policy.js';
import {mergeDarknetRewards} from './darknet-reward-policy.js';
export const darknetObservationFile='tasks/dnet-refresh-observations.json';
export function darknetCapabilityContext(reset,player){
 const values=[player?.skills?.charisma,player?.mults?.dnet_money,player?.mults?.crime_money,player?.mults?.crime_success];
 return values.every(Number.isFinite)?JSON.stringify([reset.lastNodeReset,reset.lastAugReset,Math.floor(values[0]/250),...values.slice(1)]):null;
}
/** Called by the supervisor, which is the only writer of observation/aggregate files. */
export async function sampleDarknetObservations(ns,readNative){
 const read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}};
 const reset=ns.getResetInfo(),now=Date.now();
 const reports=[];
 for(const file of ns.ls('home','tasks/dnet-survey-'))try{
  const r=read(file);if(r&&typeof r.host==='string'&&Number.isFinite(r.at)&&r.at<=now){r.live=false;try{r.live=Number.isInteger(r.pid)&&ns.ps(r.host).some(p=>p.pid===r.pid&&p.filename==='darknet-node.js');}catch{}if(r.live||now-r.at<=90000)reports.push(r);}
 }catch{}
 const state=applyStormReceipt(read('tasks/dnet-storm-state.json'),read('tasks/dnet-storm-result.json'),reset.lastNodeReset,now);
 let history=read(darknetObservationFile);
 if(!history||history.nodeReset!==reset.lastNodeReset||history.augReset!==reset.lastAugReset)history={samples:(Array.isArray(state?.refresh?.samples)?state.refresh.samples:[]).filter(s=>s?.reset===reset.lastNodeReset&&s.augReset===reset.lastAugReset)};
 const pending=state?.refresh?.active;
 if(pending&&pending.reset===reset.lastNodeReset&&pending.augReset===reset.lastAugReset&&history.lastDispatch!==pending.id){
  history={...history,active:pending,lastDispatch:pending.id};
 }
 const dispatch=history.lastDispatch;
 const priorRewards=read('tasks/dnet-cache-rewards-summary.json');
 const hosts=[...new Set(reports.filter(r=>r.live).map(r=>r.host))].sort(),cursor=Number.isSafeInteger(priorRewards?.cursor)&&priorRewards.cursor>=0?priorRewards.cursor:0;
 const selected=Array.from({length:Math.min(16,hosts.length)},(_,i)=>hosts[(cursor+i)%hosts.length]);
 let native=null;
 if(history.active||selected.length){
  native=await readNative(ns,`(async()=>{
   const rewards=[],pulls={checked:0,missing:0,copied:0,failed:0};
   for(const host of JSON.parse(ns.args[0]))try{
    const file='tasks/dnet-cache-rewards-'+encodeURIComponent(host)+'.json';pulls.checked++;
    if(!ns.fileExists(file,host))pulls.missing++;
    else if(await ns.scp(file,'home',host)){rewards.push({host,cacheRewards:JSON.parse(ns.read(file))});pulls.copied++;}
    else pulls.failed++;
   }catch{pulls.failed++;}
   return {reset:ns.getResetInfo(),player:ns.getPlayer(),income:ns.getMoneySources().sinceInstall.darknet,rewards,pulls,at:Date.now()};
  })()`,'/Temp/dnet-observation.txt',[JSON.stringify(selected)]);
  if(native.reset.lastNodeReset!==reset.lastNodeReset||native.reset.lastAugReset!==reset.lastAugReset)return;
  for(const r of native.rewards||[]){const report=reports.find(x=>x.host===r.host);if(report&&r.cacheRewards?.host===r.host&&r.cacheRewards.nodeReset===reset.lastNodeReset&&r.cacheRewards.augReset===reset.lastAugReset){report.cacheRewards=r.cacheRewards;if(Number.isFinite(r.cacheRewards.at))report.lastCacheAt=Math.max(report.lastCacheAt||0,r.cacheRewards.at);}}
 }
 const rewards=mergeDarknetRewards(priorRewards,reports,reset,native?.at??now);rewards.cursor=hosts.length?(cursor+selected.length)%hosts.length:0;rewards.pulls=native?.pulls??null;
 if(reports.length)await ns.write('tasks/dnet-cache-rewards-summary.json',JSON.stringify(rewards),'w');
 if(history.active&&native){
  const lastCacheAt=Math.max(0,...reports.filter(r=>r.live&&Number.isFinite(r.lastCacheAt)&&r.lastCacheAt<=native.at).map(r=>r.lastCacheAt));
  history=observeDarknetRefresh(history,{at:native.at,reset:reset.lastNodeReset,augReset:reset.lastAugReset,context:darknetCapabilityContext(reset,native.player),income:native.income,lastCacheAt,reports,receipt:state?.lastResult});
 }

 await ns.write(darknetObservationFile,JSON.stringify({...history,lastDispatch:dispatch,at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset}),'w');
}
