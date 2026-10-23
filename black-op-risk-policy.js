/** v3.0.1 hospital bill, including damage below zero HP. Self-contained for native dispatch. */
export function blackOpHospitalCost(money,hp,damage){
 if(![money,hp?.current,hp?.max,damage].every(Number.isFinite)||money<0||hp.max<=0||hp.current<=0||hp.current>hp.max||damage<0)return null;
 return damage<hp.current?0:Math.min(money*.1,(hp.max-hp.current+damage)*100000);
}

/** Conservative wall-time cash replacement rate. Windfalls cannot establish recurring income. */
export function observeBlackOpCash(previous,q){
 const scope=JSON.stringify([q?.nodeReset,q?.augReset]);
 const keys=['hacking','hacknet','gang','corporation','crime','work','sleeves'];
 const values=keys.map(k=>q?.moneySources?.[k]);
 if(!q||![q.at,q.money,q.nodeReset,q.augReset,...values].every(v=>Number.isFinite(v)&&v>=0))return {scope,samples:[],rate:null,at:q?.at};
 let samples=previous?.scope===scope&&Array.isArray(previous.samples)?previous.samples.filter(a=>Number.isFinite(a.at)&&a.at<=q.at&&q.at-a.at<=120000&&Number.isFinite(a.money)&&Array.isArray(a.values)&&a.values.length===keys.length&&a.values.every(v=>Number.isFinite(v)&&v>=0)):[];
 const last=samples.at(-1);
 if(last&&(q.at-last.at>30000||values.some((v,i)=>v<last.values[i])))samples=[];
 if(!samples.length||q.at-samples.at(-1).at>=15000)samples.push({at:q.at,money:q.money,values});
 let rate=Infinity;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],earned=b.values.reduce((sum,v,j)=>sum+v-a.values[j],0);
  rate=Math.min(rate,Math.max(0,Math.min(earned,b.money-a.money))*1000/(b.at-a.at));
 }
 const ready=samples.length>=3&&samples.at(-1).at-samples[0].at>=30000;
 // Halve the observed lower bound; spending and earnings may change before a failed attempt ends.
 return {scope,samples,rate:ready&&Number.isFinite(rate)?rate*.5:null,at:q.at,nodeReset:q.nodeReset,augReset:q.augReset};
}

/** Shared, depleting bonus budget. Self-contained so the native start worker can recheck it. */
export function blackOpBonusComparison({time,p,recoveryMs,bonusMs,waits,threshold,failureWallMs=0}={}){
 if(![time,p,recoveryMs,bonusMs,threshold,failureWallMs].every(Number.isFinite)||time<=0||p<.9||p>1||recoveryMs<0||failureWallMs<0||bonusMs<0||threshold<.9||threshold>1||!Array.isArray(waits)||!waits.length)return null;
 // At 5x, work consumes four extra milliseconds of backlog per real millisecond.
 // Attempt-now pricing reserves a tick and discards one burst at phase boundaries.
 // Waiting uses continuous, no-overflow-loss timing to favor improving first.
 const clock=(work,bonus,optimistic)=>{
  if(work===0)return {wall:0,bonus};
  if(!optimistic&&bonus<1000)return {wall:work,bonus:0};
  const usable=optimistic?bonus:Math.max(0,bonus-1000),saved=Math.min(work*.8,usable),fluid=work-saved;
  return {wall:optimistic?fluid:Math.ceil(fluid/1000)*1000+1000,bonus:Math.max(0,bonus-saved-(optimistic?0:5000))};
 };
 const expectation=(probability,recovery,initialBonus,optimistic)=>{
  let mass=1,elapsed=0,bonus=initialBonus,expected=0;
  // Enumerate the geometric failure tail; converting expected work once underprices depletion.
  for(let i=0;i<16&&mass>0;i++){
   const attempt=clock(time,bonus,optimistic);elapsed+=attempt.wall;bonus=attempt.bonus;
   expected+=mass*probability*elapsed;mass*=1-probability;
   if(mass>0){const after=clock(recovery,bonus,optimistic);elapsed+=after.wall;bonus=after.bonus;}
  }
  const tail=(time+(1-probability)*recovery)/probability;
  // Remaining probability is at most 1e-16: pessimistic normal speed for now, optimistic 5x for waiting.
  return expected+mass*(elapsed+tail/(optimistic?5:1));
 };
 // Cash opportunity cost is additive wall time, never accelerated or charged to the bonus balance.
 const nowMs=expectation(p,recoveryMs,bonusMs,false)+(1-p)/p*failureWallMs,candidates=[];
 for(const wait of waits){
  if(!Number.isFinite(wait?.ms)||wait.ms<0||wait.ms>3600000||wait.chance!==threshold||!['work','wall',undefined].includes(wait.units))continue;
  let wall,after;
  if(wait.units==='work'){const result=clock(wait.ms,bonusMs,true);wall=result.wall;after=result.bonus;}
  else {
   wall=wait.ms;
   // Unknown external XP can keep improving at its measured wall rate after BB bonus depletes.
   if(Number.isFinite(wait.workMs)&&wait.workMs>=0)wall=Math.min(wall,clock(wait.workMs,bonusMs,true).wall);
   after=Math.max(0,bonusMs-Math.max(0,4*wall-5000));
  }
  candidates.push(.5*wall+expectation(wait.chance,0,after,true));
 }
 if(!candidates.length)return null;
 const waitMs=Math.min(...candidates),savingMs=waitMs-nowMs;
 return [nowMs,waitMs,savingMs].every(Number.isFinite)?{nowMs,waitMs,savingMs,comparisonVersion:4}:null;
}

/** Constant-odds approximation; callers must requote after every one-shot Black Op attempt. */
export function blackOpExpectedTime(time,p,recovery){
 return [time,p,recovery].every(Number.isFinite)&&time>0&&p>0&&p<=1&&recovery>=0?(time+(1-p)*recovery)/p:null;
}

/** Bounded observed improvement, with a deliberately fast forecast favoring waiting. */
export function observeBlackOpImprovement(previous,q,threshold){
 q=q||{};
 const scope=JSON.stringify([q.target,q.nodeReset,q.augReset,q.city,q.team,q.supporting]);
 const valid=Number.isFinite(q.at)&&Number.isFinite(q.p)&&q.p>0&&q.p<=1&&Number.isFinite(q.rank)&&q.rank>=0&&Number.isFinite(q.bonusMs)&&q.bonusMs>=0&&q.stamina?.[1]>0&&q.stamina[0]/q.stamina[1]>=.99;
 if(!valid)return {scope,samples:[],waitMs:null};
 let samples=previous?.scope===scope&&Array.isArray(previous.samples)?previous.samples.filter(s=>Number.isFinite(s.at)&&s.at<=q.at&&q.at-s.at<=300000&&Number.isFinite(s.p)&&s.p>0&&s.p<=1&&Number.isFinite(s.rank)&&Number.isFinite(s.bonusMs)&&s.bonusMs>=0):[];
 const last=samples.at(-1);
 if(last&&(q.at-last.at>30000||q.rank<last.rank||q.p<last.p-.001||q.bonusMs>last.bonusMs+q.at-last.at+1000||last.bonusMs-q.bonusMs>4*(q.at-last.at)+5000))samples=[];
 if(!samples.length||q.at>samples.at(-1).at)samples.push({at:q.at,p:q.p,rank:q.rank,bonusMs:q.bonusMs});
 samples=samples.slice(-160);
 let workRate=0,wallRate=0;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],dt=b.at-a.at,work=dt+a.bonusMs-b.bonusMs;
  if(dt>=1000&&work>0&&work<=5*dt+5000){const gain=b.p-a.p;workRate=Math.max(workRate,gain/work);wallRate=Math.max(wallRate,gain/dt);}
 }
 const span=q.at-samples[0].at,ready=samples.length>=3&&span>=30000&&q.p>samples[0].p&&workRate>0&&wallRate>0&&threshold>q.p;
 const workMs=ready?(threshold-q.p)/(2*workRate):null,wallBound=ready?(threshold-q.p)/(2*wallRate):null;
 // Keep the faster wall-rate alternative: external XP need not slow with the BB clock.
 const clockBound=ready?workMs-Math.min(.8*workMs,q.bonusMs):null;
 const waitMs=ready?Math.min(wallBound,clockBound):null;
 return {scope,samples,waitMs:Number.isFinite(waitMs)&&waitMs>=0?waitMs:null,workMs:Number.isFinite(workMs)&&workMs>=0?workMs:null};
}

/** Conservative local completion comparison. Productive preparation gets 50% future-progress credit. */
export function decideBlackOpRisk(q,c,now=Date.now()){
 const threshold=Number.isFinite(c?.threshold)&&c.threshold>=0&&c.threshold<=1?c.threshold:.99;
 const no=reason=>({adaptive:false,threshold,reason});
 if(c?.enabled!==true)return no('Adaptive Black Op risk disabled');
 if(typeof q?.target!=='string'||!q.target||typeof q.city!=='string'||!q.city||![q.nodeReset,q.augReset].every(v=>Number.isFinite(v)&&v>=0)||!Number.isSafeInteger(q.ownerPid)||q.ownerPid<=0)return no('Native risk identity unavailable');
 const floor=c.floor??.9;
 if(!Number.isFinite(floor)||floor<.9||floor>1||threshold<=floor)return no('Standard threshold retained');
 if(!Number.isFinite(now)||!q||!Number.isFinite(q.at)||q.at>now||now-q.at>=5000||q.target!==c.target||q.ownerPid!==c.ownerPid||q.nodeReset!==c.reset?.lastNodeReset||q.augReset!==c.reset?.lastAugReset)return no('Fresh matching risk quote unavailable');
 if(![q.p,q.rank,c.requiredRank,q.loss,q.time,q.money,q.hp?.current,q.hp?.max,q.hrcTime,c.hpLoss,c.difficulty].every(Number.isFinite)||q.p<floor||q.p>=threshold||q.rank<0||c.requiredRank<0||q.rank<c.requiredRank||q.loss<0||q.time<=0||q.money<0||q.hp.max<=0||q.hp.current<q.hp.max*.9||q.hp.current>q.hp.max||q.hrcTime<=0||c.hpLoss<0||c.difficulty<=0)return no('Risk prerequisites unavailable');
 if(q.bonusMs<0||!Number.isFinite(q.bonusMs)||!Array.isArray(q.stamina)||q.stamina.length!==2||!q.stamina.every(Number.isFinite)||q.stamina[1]<=0||q.stamina[0]/q.stamina[1]<.99||q.stamina[0]>q.stamina[1])return no('Recover stamina or obtain a valid bonus-time quote first');
 if(![q.team,q.totalTeam,q.supporting].every(v=>Number.isSafeInteger(v)&&v>=0)||q.team>q.totalTeam-q.supporting)return no('Failure could shock supporting sleeves');
 const loss=q.loss*1.1,deficit=Math.max(0,loss-(q.rank-c.requiredRank));
 let rankMs=0;
 if(deficit>0){
  const rates=Array.isArray(c.rankRecovery)?c.rankRecovery.filter(r=>[r?.rate,r?.supply,r?.net].every(Number.isFinite)&&r.rate>0&&Number.isSafeInteger(r.supply)&&r.supply>0&&r.net>0&&r.supply*r.net>=deficit*1.25):[];
  const fastest=Math.max(0,...rates.map(r=>r.rate));
  if(!(fastest>0&&Number.isFinite(c.observedRankRate)&&c.observedRankRate>0))return no('Reserved stock or observed rank recovery insufficient');
  rankMs=deficit/Math.min(fastest,c.observedRankRate/(q.bonusMs>=1000?5:1))*1000;
 }
 const factor=Math.pow(c.difficulty,.28)+c.difficulty/650,damage=Math.ceil(c.hpLoss*factor*1.1),minimumDamage=Math.ceil(c.hpLoss*factor*.9);
 const hospitalCost=blackOpHospitalCost(q.money,q.hp,damage);
 if(hospitalCost===null)return no('Hospitalization cost unavailable');
 const expectedCashLoss=(1-q.p)/q.p*hospitalCost;
 if(expectedCashLoss>q.money*.01)return no('Expected hospitalization loss exceeds 1% of cash');
 const cash=c.cashIncome;
 const cashRate=hospitalCost>0&&cash?.nodeReset===q.nodeReset&&cash?.augReset===q.augReset&&Number.isFinite(cash.at)&&cash.at<=now&&now-cash.at<5000&&Number.isFinite(cash.rate)&&cash.rate>0?cash.rate:null;
 if(hospitalCost>0&&cashRate===null)return no('Observed cash recovery income unavailable');
 const failureWallMs=hospitalCost>0?hospitalCost/cashRate*1000:0;
 if(!Number.isFinite(failureWallMs))return no('Cash recovery time unavailable');
 let teamMs=0;
 if(q.team>0){if(![q.recruit?.time,q.recruit?.chance].every(Number.isFinite)||q.recruit.time<=0||q.recruit.chance<=0||q.recruit.chance>1)return no('Team replacement quote unavailable');teamMs=q.team*q.recruit.time/q.recruit.chance;}
 // HRC heals HP and stamina together. Ignore passive regeneration and parallel sleeve recruitment.
 // A high roll can hospitalize while a smaller roll needs HRC healing. Bound both costs.
 // Use full HP for the nonfatal bound, so passive healing before dispatch cannot increase it.
 const nonfatalDamage=minimumDamage<q.hp.max?Math.max(0,Math.min(damage,Math.ceil(q.hp.max)-1)):0;
 const healthCycles=Math.ceil(nonfatalDamage/2),staminaCycles=Math.ceil(.285*factor/(q.stamina[1]*.01));
 const recoveryMs=Math.max(healthCycles,staminaCycles)*q.hrcTime+teamMs+rankMs;
 const comparison=blackOpBonusComparison({time:q.time,p:q.p,recoveryMs,bonusMs:q.bonusMs,waits:c.waits,threshold,failureWallMs});
 if(!comparison)return no('Improvement ETA unavailable');
 const {nowMs,waitMs,savingMs}=comparison;
 if(!Number.isFinite(nowMs)||!Number.isFinite(waitMs)||savingMs<Math.max(30000,.2*waitMs))return {...no('Improving first remains preferable'),nowMs,waitMs,recoveryMs,savingMs,cashRate,failureWallMs,expectedCashLoss,hospitalCost,damage,minimumDamage,nonfatalDamage,expectedCashDelayMs:(1-q.p)/q.p*failureWallMs};
 return {adaptive:true,mode:'adaptive',comparisonVersion:4,cashRate,failureWallMs,expectedCashDelayMs:(1-q.p)/q.p*failureWallMs,bonusMs:q.bonusMs,waits:c.waits.map(w=>({...w})),threshold:q.p,fallback:threshold,at:q.at,expiresAt:q.at+5000,target:q.target,ownerPid:q.ownerPid,nodeReset:q.nodeReset,augReset:q.augReset,city:q.city,rank:q.rank,time:q.time,loss:q.loss,hrcTime:q.hrcTime,recruit:{...q.recruit},team:q.team,totalTeam:q.totalTeam,supporting:q.supporting,hp:{...q.hp},money:q.money,stamina:[...q.stamina],p:q.p,nowMs,waitMs,recoveryMs,savingMs,expectedCashLoss,hospitalCost,damage,minimumDamage,nonfatalDamage,reason:'Earlier Black Op attempt has a conservative estimated time advantage'};
}

/** One-shot permission: native start code also rechecks rank, post-cost chance and player activity. */
export function blackOpRiskStartAllowed(ticket,live,now=Date.now(),compare=blackOpBonusComparison,hospital=blackOpHospitalCost){
 if(!Number.isFinite(now)||!live||ticket?.adaptive!==true||ticket.mode!=='adaptive'||ticket.comparisonVersion!==4||![ticket.at,ticket.expiresAt,ticket.p,ticket.threshold,ticket.fallback].every(Number.isFinite)||ticket.at>now||ticket.expiresAt<=now||ticket.expiresAt-ticket.at!==5000||ticket.p<.9||ticket.p>=ticket.fallback||ticket.threshold!==ticket.p)return false;
 if(![ticket.rank,ticket.time,ticket.loss,ticket.hrcTime,ticket.bonusMs,ticket.recoveryMs,ticket.failureWallMs,ticket.hospitalCost,ticket.damage,ticket.money,ticket.hp?.current,ticket.hp?.max,ticket.nodeReset,ticket.augReset].every(v=>Number.isFinite(v)&&v>=0)||ticket.hp.max<=0||ticket.hp.current>ticket.hp.max||!Number.isSafeInteger(ticket.ownerPid)||ticket.ownerPid<=0||ticket.fallback>1)return false;
 if(typeof hospital!=='function'||ticket.hospitalCost!==hospital(ticket.money,ticket.hp,ticket.damage))return false;
 if(ticket.hospitalCost>0&&(!(Number.isFinite(ticket.cashRate)&&ticket.cashRate>0)||ticket.failureWallMs!==ticket.hospitalCost/ticket.cashRate*1000))return false;
 if(ticket.hospitalCost===0&&ticket.failureWallMs!==0)return false;
 if(typeof ticket.target!=='string'||!ticket.target||typeof ticket.city!=='string'||!ticket.city)return false;
 if(ticket.target!==live.target||ticket.ownerPid!==live.ownerPid||ticket.nodeReset!==live.nodeReset||ticket.augReset!==live.augReset||ticket.city!==live.city)return false;
 if(!Array.isArray(live.stamina))return false;
 if(![live.rank,live.money,live.hp?.current,live.hp?.max,live.p,live.bonusMs,...(live.stamina||[])].every(Number.isFinite)||live.rank<ticket.rank||live.money<ticket.money||live.hp.max!==ticket.hp?.max||live.hp.current<ticket.hp.current||live.p<ticket.p||live.bonusMs<0)return false;
 const liveHospitalCost=hospital(live.money,live.hp,ticket.damage);
 if(liveHospitalCost===null||liveHospitalCost>0&&!(Number.isFinite(ticket.cashRate)&&ticket.cashRate>0)||(1-ticket.p)/ticket.p*liveHospitalCost>live.money*.01)return false;
 if(![live.time,live.loss,live.hrcTime].every(Number.isFinite)||live.time<=0||live.time>ticket.time||live.loss<0||live.loss>ticket.loss||live.hrcTime<=0||live.hrcTime>ticket.hrcTime)return false;
 if(ticket.team>0&&(![live.recruit?.time,live.recruit?.chance,ticket.recruit?.time,ticket.recruit?.chance].every(Number.isFinite)||live.recruit.time<=0||live.recruit.time>ticket.recruit.time||live.recruit.chance<ticket.recruit.chance||live.recruit.chance<=0||live.recruit.chance>1))return false;
 if(![live.team,live.totalTeam,live.supporting].every(v=>Number.isSafeInteger(v)&&v>=0)||live.team!==ticket.team||live.totalTeam!==ticket.totalTeam||live.supporting!==ticket.supporting||live.team>live.totalTeam-live.supporting)return false;
 if(!(Array.isArray(live.stamina)&&live.stamina.length===2&&Array.isArray(ticket.stamina)&&ticket.stamina.length===2&&live.stamina[1]===ticket.stamina[1]&&live.stamina[0]>=ticket.stamina[0])||typeof compare!=='function'||!Array.isArray(ticket.waits))return false;
 const elapsed=now-ticket.at,waits=ticket.waits.map(w=>({...w,ms:Math.max(0,w.ms-elapsed*(w.units==='work'?5:1)),...(Number.isFinite(w.workMs)?{workMs:Math.max(0,w.workMs-5*elapsed)}:{})}));
 const result=compare({time:ticket.time,p:ticket.p,recoveryMs:ticket.recoveryMs,bonusMs:live.bonusMs,waits,threshold:ticket.fallback,failureWallMs:liveHospitalCost>0?liveHospitalCost/ticket.cashRate*1000:0});
 return !!result&&result.savingMs>=Math.max(30000,.2*result.waitMs);
}
