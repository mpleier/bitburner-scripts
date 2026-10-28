export const anchorValueFile='tasks/dnet-anchor-values.json',mazeLeaseFile='tasks/dnet-maze-leases.json';
/** Exact cache cash and newly observed neighbours only; phishing text is not priced. */
export function observeAnchorValue(previous,report,reset,now){
 const r=report;if(!r||typeof r.host!=='string'||!r.host||r.host.length>100)return null;const cache=r.cacheRewards;
 if(!r.live||!Number.isFinite(r.at)||r.at>now||now-r.at>90000||!Array.isArray(r.neighbours))return null;
 const identity=JSON.stringify([reset.lastNodeReset,reset.lastAugReset,r.host,r.modelId,r.depth,r.passwordLength,r.passwordFormat,r.data]);
 const validCash=cache?.host===r.host&&cache.nodeReset===reset.lastNodeReset&&cache.augReset===reset.lastAugReset&&typeof cache.epoch==='string'&&Number.isFinite(cache.at)&&cache.at>=reset.lastAugReset&&cache.at<=r.at&&Number.isFinite(cache.totals?.money)&&cache.totals.money>=0;
 const epoch=validCash?cache.epoch:null,money=validCash?cache.totals.money:null;
 const validPoint=p=>p&&Number.isFinite(p.at)&&p.at>=reset.lastAugReset&&p.at<=now&&Number.isSafeInteger(p.discoveries)&&p.discoveries>=0&&p.discoveries<=64&&(p.money===null||Number.isFinite(p.money)&&p.money>=0);
 const validWindow=w=>w&&validPoint(w.start)&&validPoint(w.end)&&w.end.at-w.start.at>=20000&&w.end.at-w.start.at<=120000&&w.end.discoveries>=w.start.discoveries&&(w.start.money===null||w.end.money===null||w.end.money>=w.start.money);
 const same=previous?.identity===identity&&previous.epoch===epoch&&validPoint(previous.last)&&previous.last.discoveries<=64&&Array.isArray(previous.seen)&&previous.seen.length<=64&&previous.seen.every(h=>typeof h==='string'&&h.length<=100)&&Array.isArray(previous.windows)&&previous.windows.length<=5&&previous.windows.every((w,i)=>validWindow(w)&&(!i||JSON.stringify(previous.windows[i-1].end)===JSON.stringify(w.start)))&&(!previous.windows.length||JSON.stringify(previous.windows.at(-1).end)===JSON.stringify(previous.last))&&previous.last.at<=r.at;
 const seen=new Set(same?previous.seen:[]),initial=!same;let discoveries=same?previous.last.discoveries:0,complete=same?previous.complete!==false:true;
 for(const h of new Set(r.neighbours)){if(typeof h!=='string'||h.length>100){complete=false;continue;}if(!seen.has(h)){if(seen.size>=64){complete=false;continue;}seen.add(h);if(!initial)discoveries++;}}
 let windows=same?previous.windows.filter(w=>now-w.end.at<=300000):[],last=same?previous.last:null;
 const point={at:r.at,money,discoveries};
 if(last&&r.at===last.at)return {...previous,cashKnown:false,discoveryKnown:false,...anchorRates(windows,complete,now)};
 if(last){const duration=r.at-last.at;if(duration>=20000&&duration<=120000&&(money===null||last.money===null||money>=last.money)){windows=[...windows,{start:last,end:point}].slice(-5);}else if(duration<20000)return {...previous,...anchorRates(windows,complete,now)};else windows=[];}
 return {identity,epoch,host:r.host,last:point,seen:[...seen],complete,windows,...anchorRates(windows,complete,now)};
}
function anchorRates(windows,complete,now){
 const usable=windows.filter(w=>now-w.end.at<=300000),fresh=usable.length>=3&&now-usable.at(-1).end.at<=90000;
 const rate=(key,rows)=>{const rates=rows.map(w=>(w.end[key]-w.start[key])/((w.end.at-w.start.at)/1000));return Math.min(rates.at(-1),[...rates].sort((a,b)=>a-b)[Math.floor((rates.length-1)/2)]);};
 const cash=usable.filter(w=>w.start.money!==null&&w.end.money!==null);
 return {cashKnown:fresh&&cash.length>=3,cashRate:fresh&&cash.length>=3?rate('money',cash):0,discoveryKnown:fresh&&complete,discoveryRate:fresh&&complete?rate('discoveries',usable):0,at:usable.at(-1)?.end.at??null};
}
/** Only the home manager grants leases; a live owner is retained while progressing. */
export function electMazeLeases(previous,reports,reset,managerPid,now){
 const same=previous?.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.at<=now;
 const candidates=new Map();
 for(const r of reports){if(!r.live||!Number.isFinite(r.at)||r.at>now||now-r.at>90000||!Number.isSafeInteger(r.pid)||r.pid<=0||!Array.isArray(r.neighbours))continue;
  for(const q of (Array.isArray(r.mazeRequests)?r.mazeRequests:[]).slice(0,8)){
   if(typeof q.maze!=='string'||q.maze.length>100||!Array.isArray(q.scope)||q.scope.length<3||q.scope.length>8||JSON.stringify(q.scope).length>2000||q.scope[0]!==reset.lastNodeReset||q.scope[1]!==reset.lastAugReset||q.scope[2]!==q.maze||!Number.isFinite(q.at)||q.at>now||now-q.at>90000||!r.neighbours.includes(q.maze))continue;
   const key=q.maze,rows=candidates.get(key)||[];rows.push({host:r.host,pid:r.pid,maze:q.maze,scope:q.scope,requestedAt:q.at,progressAt:Number.isFinite(q.progressAt)&&q.progressAt<=now?q.progressAt:0});candidates.set(key,rows);
  }
 }
 const leases=[];
 for(const [key,allRows]of candidates){if(leases.length>=8)break;
  const latest=[...allRows].sort((a,b)=>b.requestedAt-a.requestedAt||a.pid-b.pid)[0],rows=allRows.filter(r=>JSON.stringify(r.scope)===JSON.stringify(latest.scope));
  const prior=same&&Array.isArray(previous.leases)&&previous.leases.slice(0,8).find(l=>l&&l.maze===key&&JSON.stringify(l.scope)===JSON.stringify(latest.scope)),old=prior&&rows.find(r=>r.host===prior.host&&r.pid===prior.pid);
  const started=prior&&Number.isFinite(prior.startedAt)&&prior.startedAt<=now?prior.startedAt:prior?.at;
  const advancing=old&&(now-old.progressAt<90000||now-started<90000);
  const alternatives=rows.filter(r=>!old||r.pid!==old.pid||r.host!==old.host);
  const selected=advancing?old:(alternatives.length?alternatives:rows).sort((a,b)=>a.pid-b.pid||a.host.localeCompare(b.host))[0];
  leases.push({...selected,startedAt:selected===old?started:now,managerPid,at:now,expiresAt:now+90000});
 }
 return {version:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,leases};
}
export async function mazeLeaseOwned(ns,scope){
 if(!Array.isArray(scope)||!ns.fileExists(mazeLeaseFile,'home')||!await ns.scp(mazeLeaseFile,ns.getHostname(),'home'))return false;
 try{const raw=ns.read(mazeLeaseFile);if(raw.length>50000)return false;const f=JSON.parse(raw),now=Date.now();
  if(f.version!==1||f.nodeReset!==scope[0]||f.augReset!==scope[1]||f.at>now||now-f.at>90000)return false;
  return f.leases.some(l=>l.host===ns.getHostname()&&l.pid===ns.pid&&l.at<=now&&l.expiresAt>now&&l.expiresAt-l.at<=90000&&JSON.stringify(l.scope)===JSON.stringify(scope)&&ns.isRunning(l.managerPid));
 }catch{return false;}
}
export async function coordinateDarknetDevelopment(ns,reports,reset){
 const now=Date.now();let saved=null,prior=null;try{const raw=ns.read(anchorValueFile);if(raw.length<1000000)saved=JSON.parse(raw);}catch{}try{const raw=ns.read(mazeLeaseFile);if(raw.length<50000)prior=JSON.parse(raw);}catch{}
 const same=saved?.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset,hosts={};
 const linked=new Set(ns.dnet.getStasisLinkedServers());
 for(const r of [...reports].sort((a,b)=>Number(linked.has(b.host))-Number(linked.has(a.host))||(b.depth||0)-(a.depth||0)||String(a.host).localeCompare(String(b.host))).slice(0,128)){const value=observeAnchorValue(same?saved.hosts?.[r.host]:null,r,reset,now);if(value)Object.defineProperty(hosts,r.host,{value,enumerable:true,configurable:true});}
 const warn=error=>{if(now-(coordinateDarknetDevelopment.warningAt??-Infinity)>=60000){ns.print('Dark Net development persistence deferred: '+String(error));coordinateDarknetDevelopment.warningAt=now;}};
 try{await ns.write(anchorValueFile,JSON.stringify({version:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,hosts}),'w');}catch(error){warn(error);}
 try{await ns.write(mazeLeaseFile,JSON.stringify(electMazeLeases(prior,reports,reset,ns.pid,now)),'w');}catch(error){warn(error);}
 return hosts;
}
