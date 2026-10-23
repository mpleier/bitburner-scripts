import {xpCapacityKey} from './xp-capacity-policy.js';
const minute=60000,positive=n=>Number.isFinite(n)&&n>0;
const factors=s=>Array.isArray(s?.hackingIncomeFactors)&&s.hackingIncomeFactors.length===5&&s.hackingIncomeFactors.every(positive)?s.hackingIncomeFactors:null;
const validBaseline=b=>b&&positive(b.rate)&&typeof b.signature==='string'&&Array.isArray(b.factors)&&b.factors.length===5&&b.factors.every(positive);

/** Qualified hack receipts only: never infer income from wallet or stock-value changes. */
export function qualifiedRecoveryIncome(snapshot,income,reset,now=Date.now()) {
 if(!snapshot||snapshot.nodeReset!==reset?.lastNodeReset||snapshot.augReset!==reset?.lastAugReset||snapshot.xpMode!=='income'||
  !Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>45000||snapshot.xpCapacity===undefined||xpCapacityKey(snapshot)===null||
  !/^xp-recovery-v1:[a-f0-9]+:[a-f0-9]+:\d+$/.test(snapshot.xpCapacity?.recoverySignature||'')||!factors(snapshot))return null;
 if(income?.version!==1||income.ownerPid!==snapshot.xpCapacity.ownerPid||income.nodeReset!==reset.lastNodeReset||income.augReset!==reset.lastAugReset||
  !Number.isFinite(income.at)||income.at>now||now-income.at>15000||!income.targets||typeof income.targets!=='object'||Array.isArray(income.targets))return null;
 const rows=Object.entries(income.targets).sort(([a],[b])=>a.localeCompare(b));
 if(!rows.length||rows.length>64)return null;
 let rate=0;const times=[],starts=[],market=[];
 for(const [name,r]of rows){
  if(!r||!Number.isFinite(r.measuredAt)||r.measuredAt<reset.lastAugReset||r.measuredAt>now||now-r.measuredAt>150000||
   !Number.isFinite(r.durationSeconds)||r.durationSeconds<120||!Number.isSafeInteger(r.completions)||r.completions<30||r.risks!==0||
   !positive(r.incomePerRamSecond)||!positive(r.ram))return null;
  let context;try{context=JSON.parse(r.signature);}catch{return null;}
  if(!Array.isArray(context)||!positive(context[0])||!Number.isFinite(context[1])||context[1]<0)return null;
  rate+=r.incomePerRamSecond*r.ram;times.push(r.measuredAt);starts.push(r.measuredAt-r.durationSeconds*1000);market.push([name,context[0],context[1],context[5]??null]);
 }
 if(!positive(rate)||Math.max(...times)-Math.min(...times)>30000)return null;
 if(starts.some(at=>at<reset.lastAugReset))return null;
 return {rate,at:Math.min(...times),startAt:Math.min(...starts),endAt:Math.max(...times),id:JSON.stringify([income.ownerPid,times]),ownerPid:income.ownerPid,
  signature:JSON.stringify([snapshot.xpCapacity.recoverySignature,market]),factors:[...factors(snapshot)]};
}

/** Confirm stable rates using separate, non-overlapping two-minute measurement windows. */
export function observeIncomeRecovery(saved,{reset,route,snapshot,income,now=Date.now()}={}) {
 if(!reset||![now,reset.lastNodeReset,reset.lastAugReset].every(Number.isFinite)||now<reset.lastAugReset)return null;
 const old=saved?.schemaVersion===1&&saved.nodeReset===reset.lastNodeReset&&Number.isFinite(saved.at)&&saved.at<=now?saved:null;
 const same=old?.augReset===reset.lastAugReset;
 const samples=Array.isArray(old?.samples)?old.samples.filter(s=>s?.nodeReset===reset.lastNodeReset&&Number.isFinite(s.augReset)&&s.augReset<=reset.lastAugReset&&
  Number.isFinite(s.finishedAt)&&s.finishedAt<=now&&now-s.finishedAt<=24*60*minute&&positive(s.durationMs)&&s.durationMs<=24*60*minute).slice(-8):[];
 let state={schemaVersion:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,mode:snapshot?.xpMode??null,currentFactors:factors(snapshot),
  samples,baseline:null,evidence:null,pending:null,recovering:false};
 if(same)state={...state,baseline:old.baseline,evidence:old.evidence,pending:old.pending?{...old.pending,factors:Array.isArray(old.pending.factors)?[...old.pending.factors]:[]}:null,recovering:!!old.recovering};
 else if(old&&old.augReset<reset.lastAugReset&&validBaseline(old.baseline)&&old.at<=reset.lastAugReset&&reset.lastAugReset-old.at<=90000)
  state={...state,pending:{...old.baseline,factors:[...old.baseline.factors],startedAt:reset.lastAugReset},recovering:true};
 const fresh=r=>r&&r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=45000;
 const freshRoute=fresh(route),freshSnapshot=fresh(snapshot),selected=freshRoute&&['hacking','bladeburner'].includes(route.selected);
 const q=selected?qualifiedRecoveryIncome(snapshot,income,reset,now):null;
 const cancel=reason=>{state.recovering=false;state.pending=null;state.reason=reason;};
 if(state.recovering){
  if(!validBaseline(state.pending)||!Number.isFinite(state.pending.startedAt)||state.pending.startedAt>now||now-state.pending.startedAt>24*60*minute)cancel('Invalid or expired income recovery');
  else if(same&&now-old.at>90000)cancel('Income observation interrupted');
  else if(freshRoute&&!selected)cancel('Selected route unavailable');
  else if(freshSnapshot&&snapshot.xpMode!=='income')cancel('Income mode changed');
  else if(q&&q.signature!==state.pending.signature)cancel('Income capacity or target context changed');
  if(state.recovering&&freshSnapshot&&factors(snapshot))state.pending.factors=state.pending.factors.map((v,i)=>Math.max(v,factors(snapshot)[i]));
 }
 const previous=state.evidence;
 if(!q){state.baseline=null;state.evidence=null;}
 else if(!previous||previous.signature!==q.signature||previous.ownerPid!==q.ownerPid||q.at<previous.at||q.at-previous.at>300000){state.baseline=null;state.evidence=q;}
 else if(q.id!==previous.id&&q.at-previous.at>=120000&&q.startAt>=previous.endAt){
  const stable=Math.max(previous.rate,q.rate)/Math.min(previous.rate,q.rate)<=1.25;
  state.baseline=stable?{rate:Math.min(previous.rate,q.rate),signature:q.signature,factors:previous.factors.map((v,i)=>Math.max(v,q.factors[i]))}:null;
  state.evidence=q;
 }else if(q.signature!==state.baseline?.signature)state.baseline=null;
 if(state.recovering&&validBaseline(state.baseline)&&state.baseline.signature===state.pending.signature&&state.baseline.rate>=state.pending.rate){
  const durationMs=now-state.pending.startedAt;
  if(durationMs>0)state.samples=[...samples,{nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,finishedAt:now,durationMs,
   rate:state.pending.rate,signature:state.pending.signature,factors:[...state.pending.factors]}].slice(-8);
  cancel('Sustained pre-install hacking income recovered');
 }
 return state;
}

/** Income and capability rebuild concurrently; consumers take the maximum, never their sum. */
export function incomeRecoveryQuote(record,{nodeReset,augReset,now=Date.now()}={}) {
 const absent={durationMs:0,blocked:false,basis:null};
 if(record?.schemaVersion!==1||record.nodeReset!==nodeReset||record.augReset!==augReset||!Number.isFinite(record.at)||record.at>now||now-record.at>90000||record.mode!=='income')return absent;
 const b=record.baseline;
 const samples=validBaseline(b)&&Array.isArray(record.currentFactors)&&record.currentFactors.length===5&&record.currentFactors.every(positive)&&Array.isArray(record.samples)?record.samples.filter(s=>s?.nodeReset===nodeReset&&Number.isFinite(s.augReset)&&s.augReset<=augReset&&
  Number.isFinite(s.finishedAt)&&s.finishedAt<=now&&now-s.finishedAt<=24*60*minute&&positive(s.durationMs)&&s.durationMs<=24*60*minute&&
  validBaseline(s)&&s.rate>=b.rate&&s.signature===b.signature&&s.factors.every((v,i)=>v<=record.currentFactors[i])):[];
 return {durationMs:samples.length?Math.max(minute,...samples.map(s=>s.durationMs)):15*minute,blocked:record.recovering===true,
  basis:samples.length?'Measured time to regain sustained hacking income':'Conservative hacking income recovery fallback'};
}
