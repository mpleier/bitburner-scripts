export function stockReserve(override,text){return Math.max(0,Number(override===null||override===undefined||override==='__default__'?text:override)||0);}
export function stockOptionsError(o){
 for(const key of ['fracB','fracH','diversification','buy-4s-budget'])if(!Number.isFinite(o[key])||o[key]<0||o[key]>1)return key+' must be between 0 and 1';
 if(o.fracB<o.fracH)return 'fracB must be at least fracH';
 if(o.reserve!==null&&o.reserve!==undefined&&(!Number.isFinite(o.reserve)||o.reserve<0))return 'reserve must be nonnegative and finite';
 for(const key of ['buy-threshold','sell-threshold','pre-4s-buy-threshold-return','pre-4s-sell-threshold-return'])if(!Number.isFinite(o[key])||o[key]<0)return key+' must be nonnegative and finite';
 for(const key of ['pre-4s-min-tick-history','pre-4s-forecast-window','pre-4s-inversion-detection-window'])if(!Number.isInteger(o[key])||o[key]<2)return key+' must be an integer of at least 2';
 if(o['pre-4s-forecast-window']>151||o['pre-4s-inversion-detection-window']>151)return 'history windows cannot exceed 151 stored observations';
 if(o['pre-4s-min-tick-history']>o['pre-4s-forecast-window'])return 'forecast-window must cover min-tick-history';
 for(const key of ['pre-4s-min-blackout-window','pre-4s-minimum-hold-time'])if(!Number.isInteger(o[key])||o[key]<0)return key+' must be a nonnegative integer';
 const probability=o['pre-4s-buy-threshold-probability'];if(!Number.isFinite(probability)||probability<0||probability>.5)return 'pre-4s probability margin must be between 0 and 0.5';
 return null;
}
export function holdYoungStock(stock,minTicks,margin){
 const reversed=(stock.sharesLong>0&&stock.prob<.5)||(stock.sharesShort>0&&stock.prob>.5);
 return stock.ticksHeld<minTicks&&!(reversed&&Math.abs(stock.prob-.5)>=margin);
}
/** Synchronous native trade receipt. No await between guard, quote, trade and cash measurement. */
export function stockTradeReceipt(api,wallet,sym,count,action,reserve,allowed,commission=100000,budget=Number.MAX_VALUE){
 const empty={price:0,shares:0,cash:0};
 if(!allowed()||!Number.isSafeInteger(count)||count<=0||!['buyStock','buyShort','sellStock','sellShort'].includes(action))return empty;
 const buy=action.startsWith('buy'),long=action.endsWith('Stock'),index=long?0:2;
 const before=api.getPosition(sym),money=wallet();
 if(buy){
  if(before[long?2:0]>0)return empty;
  count=Math.min(count,Math.max(0,api.getMaxShares(sym)-before[0]-before[2]));if(!count)return empty;
  const cost=api.getPurchaseCost(sym,count,long?'L':'S');
  if(!Number.isFinite(budget)||budget<0||!Number.isFinite(cost)||cost<=0||cost>Math.min(money-reserve,budget))return empty;
  if(api.has4SDataTixApi()){const forecast=api.getForecast(sym);if(!Number.isFinite(forecast)||(long?forecast<=.5:forecast>=.5))return empty;}
 }else{count=Math.min(count,before[index]);if(!count)return empty;}
 const price=api[action](sym,count);if(!(price>0)||!Number.isFinite(price))return empty;
 const after=api.getPosition(sym),shares=buy?after[index]-before[index]:before[index]-after[index];
 if(!(shares>0))return empty;
 const cash=buy?money-wallet():wallet()-money;
 const fill=buy?(cash-commission)/shares:long?(cash+commission)/shares:2*before[3]-(cash+commission)/shares;
 return {price:fill,shares,cash,entry:before[index+1]};
}


export function stockControlAllowed(ns,parent,explicit=false) {
 if(!ns.isRunning(parent))return false;
 if(explicit)return true;
 if(ns.read('remote-control/paused/stockmaster.js.txt').trim()==='true')return false;
 try{const r=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(r.expiresAt>Date.now()&&ns.isRunning(r.ownerPid))return false;}catch{}
 return true;
}
export function stockCycleAgreement(previous,detected) {return Math.min(14,Math.max(previous,detected));}
export function stockHistoryForecast(history) {
 if(history.length<2)return .5;
 return history.reduce((ups,price,idx)=>idx===0?0:history[idx-1]>price?ups+1:ups,0)/(history.length-1);
}
export function stockSnapshotExpression(has4s,mock) {
 return `Object.fromEntries(ns.args.map(sym=>[sym,{ask:ns.stock.getAskPrice(sym),bid:ns.stock.getBidPrice(sym),vol:${has4s?'ns.stock.getVolatility(sym)':'null'},prob:${has4s?'ns.stock.getForecast(sym)':'null'},position:${mock?'null':'ns.stock.getPosition(sym)'}}]))`;
}

/** A producer-owned, reset-scoped signal contract. Mock holdings cannot drive real hacks. */
export function stockManipulationSnapshot(stocks,pid,reset,mock=false,at=Date.now()) {
 return {schemaVersion:1,pid,at,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,mock,
  positions:Object.fromEntries(stocks.map(s=>[s.sym,{prob:s.prob,sharesLong:s.sharesLong,sharesShort:s.sharesShort}]))};
}
export function readStockManipulationSnapshot(raw,reset,processes,symbols,now=Date.now(),maxAge=60000) {
 const invalid=reason=>({positions:null,reason});let data;
 try{data=JSON.parse(raw);}catch{return invalid('missing-or-malformed');}
 if(data?.schemaVersion!==1)return invalid('unsupported-schema');
 if(data.mock!==false)return invalid('mock-signal');
 if(data.nodeReset!==reset.lastNodeReset||data.augReset!==reset.lastAugReset)return invalid('reset-mismatch');
 if(!Number.isFinite(data.at)||data.at>now||now-data.at>maxAge)return invalid('stale-signal');
 if(!processes.some(p=>p.pid===data.pid&&p.filename.replace(/^\//,'')==='stockmaster.js'))return invalid('producer-exited');
 const positions={};
 for(const symbol of symbols){
  const p=data.positions?.[symbol];
  if(!p||!Number.isFinite(p.prob)||p.prob<0||p.prob>1||![p.sharesLong,p.sharesShort].every(n=>Number.isSafeInteger(n)&&n>=0))return invalid('invalid-or-missing-symbol');
  positions[symbol]={prob:p.prob,sharesLong:p.sharesLong,sharesShort:p.sharesShort};
 }
 return {positions,reason:'valid'};
}

/** Persist only forecast state; cash, positions and native 4S quotes remain authoritative. */
export function stockHistoryCheckpoint(stocks,{pid,reset,settings,mock,has4s,lastTick,marketCycleDetected,detectedCycleTick,inversionAgreementThreshold,at=Date.now()}) {
 return {schemaVersion:1,pid,at,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,settings,mock,has4s,
  lastTick,marketCycleDetected,detectedCycleTick,inversionAgreementThreshold,
  stocks:Object.fromEntries(stocks.map(s=>[s.sym,{ask:s.ask_price,bid:s.bid_price,priceHistory:s.priceHistory.slice(0,settings.maxHistory),
   lastInversion:s.lastInversion,lastTickProbability:s.lastTickProbability??s.prob,prob:s.prob,probStdDev:s.probStdDev,vol:s.vol,
   nearTermForecast:s.nearTermForecast,longTermForecast:s.longTermForecast,ticksHeld:s.ticksHeld||0,
   position:[s.sharesLong||0,s.boughtPrice||0,s.sharesShort||0,s.boughtPriceShort||0]}]))};
}

/** Unchanged fresh quotes demonstrate continuity; changed quotes cannot reveal missed ticks. */
export function restoreStockHistory(raw,{reset,settings,mock,has4s,quotes,pid,processes=[],now=Date.now(),maxAge=15000}) {
 const reject=reason=>({state:null,reason});let saved;
 if(typeof raw!=='string'||raw.length>1000000)return reject('missing-or-oversized');
 try{saved=JSON.parse(raw);}catch{return reject('missing-or-malformed');}
 if(saved?.schemaVersion!==1)return reject('unsupported-schema');
 if(saved.nodeReset!==reset.lastNodeReset||saved.augReset!==reset.lastAugReset)return reject('reset-mismatch');
 if(saved.mock!==mock||saved.has4s!==has4s)return reject('mode-mismatch');
 if(!Number.isFinite(saved.at)||saved.at>now||now-saved.at>maxAge)return reject('expired');
 if(processes.some(p=>p.pid===saved.pid&&p.pid!==pid))return reject('producer-still-running');
 if(!settings||JSON.stringify(saved.settings)!==JSON.stringify(settings))return reject('settings-mismatch');
 const integer=(n,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 const probability=n=>Number.isFinite(n)&&n>=0&&n<=1;
 if(!integer(saved.pid,1)||!Number.isFinite(saved.lastTick)||saved.lastTick<=0||saved.lastTick>saved.at||typeof saved.marketCycleDetected!=='boolean'||
  !integer(saved.detectedCycleTick,0,settings.cycleLength-1)||!integer(saved.inversionAgreementThreshold,1,14))return reject('invalid-phase');
 const symbols=Object.keys(quotes||{});
 if(!symbols.length||!saved.stocks||Object.keys(saved.stocks).length!==symbols.length)return reject('symbol-mismatch');
 const restored={};
 for(const symbol of symbols){
  const s=saved.stocks[symbol],q=quotes[symbol];
  if(!s||!q||![s.ask,s.bid,q.ask,q.bid].every(n=>Number.isFinite(n)&&n>0)||s.ask<s.bid||q.ask<q.bid)return reject('invalid-quote');
  if(s.ask!==q.ask||s.bid!==q.bid)return reject('quote-changed');
  if(!Array.isArray(s.priceHistory)||!s.priceHistory.length||s.priceHistory.length>settings.maxHistory||
   !s.priceHistory.every(n=>Number.isFinite(n)&&n>0)||s.priceHistory[0]!==(s.ask+s.bid)/2)return reject('invalid-history');
  if(!integer(s.lastInversion,0)||!integer(s.ticksHeld,0)||!probability(s.prob)||!probability(s.lastTickProbability)||
   !probability(s.nearTermForecast)||!probability(s.longTermForecast)||!Number.isFinite(s.vol)||s.vol<0||!Number.isFinite(s.probStdDev)||s.probStdDev<0)return reject('invalid-forecast');
  const position=q.position;
  const samePosition=Array.isArray(position)&&Array.isArray(s.position)&&position.length===4&&s.position.length===4&&position.every((n,i)=>Number.isFinite(n)&&n>=0&&n===s.position[i]);
  const history=s.priceHistory.slice(),longTermForecast=stockHistoryForecast(history.slice(0,Math.min(settings.longWindow,s.lastInversion))),nearTermForecast=stockHistoryForecast(history.slice(0,settings.nearWindow));
  const vol=history.reduce((max,price,i)=>Math.max(max,i===0?0:Math.abs(history[i-1]-price)/price),0);
  const probStdDev=stockForecastUncertainty(longTermForecast,Math.max(0,Math.min(settings.longWindow,s.lastInversion,history.length)-1));
  restored[symbol]={...s,priceHistory:history,longTermForecast,nearTermForecast,...has4s?{}:{prob:longTermForecast,vol,probStdDev},ticksHeld:samePosition?s.ticksHeld:0};
 }
 return {state:{...saved,stocks:restored},reason:'restored'};
}

/** One-sigma Wilson interval keeps uncertainty at all-up/all-down endpoints. */
export function stockForecastBounds(prob,samples,z=1) {
 if(!Number.isFinite(prob)||prob<0||prob>1||!Number.isSafeInteger(samples)||samples<=0||!Number.isFinite(z)||z<=0)return {lower:0,upper:1};
 const z2=z*z,denom=1+z2/samples,center=(prob+z2/(2*samples))/denom;
 const half=z*Math.sqrt(prob*(1-prob)/samples+z2/(4*samples*samples))/denom;
 return {lower:Math.max(0,center-half),upper:Math.min(1,center+half)};
}
export function stockForecastUncertainty(prob,samples) {
 const bounds=stockForecastBounds(prob,samples);
 return Number.isFinite(prob)&&prob>=0&&prob<=1?Math.max(0,prob>=.5?prob-bounds.lower:bounds.upper-prob):1;
}

/** Weak estimated exits need distinct market ticks; strong/native reversals exit immediately. */
export function stockExitDecision(stock,previous,{estimated,tick,threshold=0,margin=.1,commission=100000}={}) {
 const signature=JSON.stringify([stock.sharesLong,stock.boughtPrice,stock.sharesShort,stock.boughtPriceShort]);
 const reverse=stock.sharesLong>0?stock.prob<.5:stock.sharesShort>0&&stock.prob>.5;
 const candidate=stock.absReturn()<=threshold||reverse;
 const state={signature,tick,count:0,side:reverse?'reversed':'weak'};
 if(!candidate)return {...state,sell:false,reason:'forecast-supports-position'};
 if(!estimated||reverse&&Math.abs(stock.prob-.5)>=margin)return {...state,sell:true,reason:'native-or-strong-reversal'};
 const same=previous?.signature===signature&&previous.side===state.side;
 state.count=same?previous.count+(tick>previous.tick?1:0):1;
 const edge=Math.max(0,Math.abs(stock.prob-.5)-Math.max(0,stock.probStdDev||0));
 const notional=(stock.sharesLong||stock.sharesShort)*((stock.ask_price+stock.bid_price)/2);
 const expectedLoss=reverse?notional*stock.vol*edge*3:0;
 const required=expectedLoss>=commission?2:3;
 return {...state,expectedLoss,commission,sell:state.count>=required,reason:state.count>=required?'confirmed-estimated-exit':'awaiting-market-confirmation'};
}
