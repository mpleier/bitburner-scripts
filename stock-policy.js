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
