import {automationReloadFits} from './runtime-policy.js';
/** Independent, idle-only worker upgrades. Preserve compatibility with a running older autopilot. */
export function upgradeRemoteWorker(ns,{policy,signature,reset,now=Date.now(),reserve=0,blocked=false}={}) {
 const file='tasks/remote-worker-upgrade.json',read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}};
 const old=read(file),same=old?.nodeReset===reset.lastNodeReset&&old.augReset===reset.lastAugReset&&old.at<=now&&old.signature===signature&&Number.isFinite(old.candidateAt)&&old.candidateAt>=0&&old.candidateAt<=now&&Number.isFinite(old.windowAt)&&old.windowAt>=0&&old.windowAt<=now&&Number.isSafeInteger(old.attempts)&&old.attempts>=0;
 const attempts=same&&now-old.windowAt<900000?old.attempts||0:0;
 const record={legacyPolicy:old?.nodeReset===reset.lastNodeReset&&old.augReset===reset.lastAugReset?old.legacyPolicy:undefined,at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,signature,candidateAt:same?old.candidateAt:now,attempts,windowAt:attempts?old.windowAt:now};
 const finish=(state,extra={})=>{const value={...record,state,...extra};ns.write(file,JSON.stringify(value),'w');return value;};
 if(blocked||ns.read('remote-control/paused/remote-api-agent.js.txt').trim()==='true')return finish('blocked');
 if(!Number.isSafeInteger(policy)||policy<=0||typeof signature!=='string'||!signature)return finish('invalid-target');
 const processes=ns.ps('home'),worker=processes.find(p=>p.filename.replace(/^\//,'')==='remote-api-agent.js'),heartbeat=read('remote-control/heartbeat.json');
 const fresh=worker&&heartbeat?.pid===worker.pid&&heartbeat.at<=now&&now-heartbeat.at<10000;
 const protocol=worker?.args?.some((arg,i)=>arg==='--protocol-version'&&worker.args[i+1]===2);
 if(fresh&&protocol&&(heartbeat.activePolicy??heartbeat.policy)>=policy&&heartbeat.signature===signature)return finish('current',{pid:worker.pid,legacyPolicy:heartbeat.policy,activePolicy:heartbeat.activePolicy??heartbeat.policy});
 if(attempts>=3)return finish('retry-limit');
 if(now-record.candidateAt<10000)return finish('settling');
 const request=read('remote-control/request.json');
 const response=/^[a-zA-Z0-9_-]{1,80}$/.test(request?.id||'')?read('remote-control/results/'+request.id+'.json'):null;
 if(processes.some(p=>p.filename.replace(/^\//,'')==='remote-control/job.js')||request?.expiresAt>now&&(!response||response.id!==request.id||!['completed','failed','uncertain'].includes(response.state)))return finish('waiting-command');
 const script='remote-api-agent.js',newRam=ns.getScriptRam(script,'home'),running=worker?ns.getRunningScript(worker.pid):null;
 const oldRam=running?.ramUsage??0,threads=running?.threads??1;
 if(worker&&!running||!automationReloadFits({free:ns.getServerMaxRam('home')-ns.getServerUsedRam('home'),newRam,oldRam,threads,reserve}))return finish('waiting-ram');
 const priorLegacy=fresh?heartbeat.policy:old?.legacyPolicy;
 const legacyPolicy=Number.isSafeInteger(priorLegacy)&&priorLegacy>0&&priorLegacy<=policy?priorLegacy:policy;
 if(worker&&!ns.kill(worker.pid))return finish('stop-failed');
 const pid=ns.run(script,1,'--protocol-version',2,'--legacy-policy',legacyPolicy);
 return finish(pid?'started':'start-failed',{pid,legacyPolicy,attempts:attempts+1,windowAt:attempts?old.windowAt:now});
}
