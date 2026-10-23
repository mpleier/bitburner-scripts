/** Observational refresh receipts; income is net change, not causal proof of a storm benefit. */
export function beginDarknetRefresh(previous, {id,at,reset,augReset,context,hosts}) {
 return {...previous,active:{id,requestedAt:at,reset,augReset,context,hosts:hosts.map(r=>[r.host,r.pid]).slice(0,256)}};
}
export function observeDarknetRefresh(previous, input) {
 const {at,reset,augReset,context,income,lastCacheAt,reports,receipt}=input;
 const valid=Number.isFinite(at)&&Number.isFinite(income)&&income>=0&&Number.isFinite(lastCacheAt)&&lastCacheAt<=at;
 const samples=Array.isArray(previous?.samples)?previous.samples.filter(s=>s&&s.reset===reset&&s.augReset===augReset&&s.at<=at&&at-s.at<=21600000).slice(-8):[];
 const state={samples},a=previous?.active;
 if(!a)return state;
 if(!valid||typeof context!=='string'||!context||a.reset!==reset||a.augReset!==augReset||a.context!==context||!Number.isFinite(a.requestedAt)||a.requestedAt>at||!Array.isArray(a.hosts)||a.hosts.length>256)return state;
 if(a.lastAt!==undefined&&(!Number.isFinite(a.lastAt)||a.lastAt>at||at-a.lastAt>90000||income<a.lastIncome))return {...state,samples:[...samples,{reset,augReset,context,at,complete:false,reason:'Observation gap or income reset'}].slice(-8),lastExcluded:'Observation gap or income reset'};
 const active={...a,lastAt:at,lastIncome:income};state.active=active;
 if(!active.startedAt){
  if(receipt?.id!==a.id||receipt.success!==true||!Number.isFinite(receipt.at)||receipt.at<a.requestedAt||receipt.at>a.requestedAt+30000||receipt.at>at){if(at-a.requestedAt>60000)delete state.active;return state;}
  active.startedAt=receipt.at;
 }
 const age=at-active.startedAt;
 if(age>1800000){state.samples=[...samples,{reset,augReset,context,at,complete:false,reason:'No completed reward recovery window within thirty minutes'}].slice(-8);delete state.active;return state;}
 // Rebase after the engine's thirty-second storm; old-network payouts must not establish recovery.
 if(age<30000)return state;
if(active.baselineAt===undefined){active.baselineAt=at;active.baselineIncome=income;return state;}
 if(!active.recoveredAt){
  const live=[...new Map(reports.filter(r=>r.live&&typeof r.host==='string'&&Number.isInteger(r.pid)&&r.pid>0&&r.at>=active.startedAt+30000&&r.at<=at&&at-r.at<=90000).map(r=>[r.host,r])).values()];
  const target=Math.max(1,Math.min(3,active.hosts.length));
  const renewed=live.some(r=>!active.hosts.some(([host,pid])=>host===r.host&&pid===r.pid));
  if(live.length>=target&&renewed&&(income>active.baselineIncome||lastCacheAt>=active.baselineAt&&lastCacheAt>active.startedAt+30000)){
   active.recoveredAt=at;active.recoveryMs=at-active.startedAt;active.windowIncome=income;
  }
  return state;
 }
 if(at-active.recoveredAt<600000)return state;
 const gain=income-active.windowIncome,windowMs=at-active.recoveredAt;
 state.samples=[...samples,{reset,augReset,context,at,complete:true,recoveryMs:active.recoveryMs,windowMs,gain}].slice(-8);delete state.active;
 return state;
}
export function darknetRefreshEvidence(history,{reset,augReset,context},now=Date.now()) {
 if(typeof context!=='string'||!context)return {ready:false,samples:0};
 const rows=(Array.isArray(history?.samples)?history.samples:[]).filter(s=>s&&s.reset===reset&&s.augReset===augReset&&s.context===context&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=21600000).slice(-3);
 const ready=rows.length===3&&rows.every(s=>s.complete===true&&[s.recoveryMs,s.windowMs,s.gain].every(Number.isFinite)&&s.recoveryMs>=30000&&s.recoveryMs<=1800000&&s.windowMs>=600000&&s.windowMs<=690000&&s.gain>=0);
 return ready?{ready:true,measuredRebuild:true,samples:3,rebuildMs:Math.max(...rows.map(s=>s.recoveryMs))*1.25,netRate:Math.min(...rows.map(s=>s.gain/((s.windowMs+s.recoveryMs)/1000)))}:{ready:false,samples:rows.length,measuredRebuild:rows.length>0&&rows.every(s=>s.complete===true&&Number.isFinite(s.recoveryMs)&&s.recoveryMs>=30000&&s.recoveryMs<=1800000),rebuildMs:rows.length?Math.max(...rows.map(s=>s.recoveryMs))*1.25:undefined};
}
