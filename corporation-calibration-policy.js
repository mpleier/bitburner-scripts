// Only upgrades with an immediate operating effect are comparable over a few cycles.
const immediateUpgrades=new Set(['Smart Factories','Smart Storage','ABC SalesBots']);
const upgradeKinds={'Smart Factories':'production','Smart Storage':'storage','ABC SalesBots':'sales'};
function validQuote(q){return immediateUpgrades.has(q?.upgrade)&&q.key===JSON.stringify([q.upgrade,upgradeKinds[q.upgrade]])&&Number.isFinite(q.expected)&&q.expected>0;}
function calibrationSamples(value,at){
 const times=new Set();return (Array.isArray(value)?value:[]).filter(s=>{
  if(!Number.isFinite(s?.at)||s.at>at||at-s.at>21600000||!Number.isFinite(s.ratio)||s.ratio<0||s.ratio>3||times.has(s.at))return false;
  times.add(s.at);return true;
 }).sort((a,b)=>a.at-b.at).slice(-8).map(s=>({at:s.at,ratio:s.ratio,...(Number.isFinite(s.observedProfitChange)?{observedProfitChange:s.observedProfitChange}:{}),...(Number.isFinite(s.expectedGain)?{expectedGain:s.expectedGain}:{}),...(Number.isFinite(s.baselineProfit)?{baselineProfit:s.baselineProfit}:{})}));
}
export function corporationCalibrationQuote(plan){
 const upgrade=typeof plan?.label==='string'&&plan.label.startsWith('Level ')?plan.label.slice(6):null;
 const score=plan?.uncalibratedScore??plan?.score,expected=score*plan?.cost;
 if(!immediateUpgrades.has(upgrade)||upgradeKinds[upgrade]!==plan?.market?.kind||!(plan.profitPerSecond>0)||!Number.isFinite(expected)||expected<=0)return null;
 return {key:JSON.stringify([upgrade,plan.market.kind]),upgrade,expected};
}

/** Explicit native fields avoid deprecated division getters. Missing APIs disable learning. */
export function captureCorporationCalibration(api,info,constants={}){
 try{
  if(!Array.isArray(info?.divisions)||!info.divisions.length||info.divisions.length>20)return null;
  const settings=[],environment=[],levels={},profits=[];
  const number=(value)=>{if(!Number.isFinite(value)||value<0)throw Error('Incomplete calibration reading');return value;};
  const env=(key,value)=>environment.push([key,number(value)]);
  const names=[...(constants.upgradeNames||[])].sort();if(!names.length||names.length>64)return null;
  for(const name of names)levels[name]=number(api.getUpgradeLevel(name));
  if([...immediateUpgrades].some(n=>!Number.isSafeInteger(levels[n])))return null;
  const research=[...new Set([...(constants.researchNamesBase||[]),...(constants.researchNamesProductOnly||[])])].sort();if(!research.length||research.length>128)return null;
  const unlocks=[...(constants.unlockNames||[])].sort();if(unlocks.length>64)return null;
  settings.push(unlocks.map(n=>[n,api.hasUnlock(n)]));
  for(const name of [...info.divisions].sort()){
   const d=api.getDivision(name),cities=[...(d.cities||[])].sort(),products=[...(d.products||[])].sort();
   if(!cities.length||cities.length>6||products.length>8)return null;
   const profit=d.lastCycleRevenue-d.lastCycleExpenses;if(!Number.isFinite(profit))return null;profits.push(profit);
   settings.push([name,d.industry,cities,products,number(d.numAdVerts),research.map(r=>[r,api.hasResearched(name,r)])]);
   env(name+'/research',d.researchPoints);env(name+'/awareness',d.awareness);env(name+'/popularity',d.popularity);
   const industry=api.getIndustryData(d.industry),materials=[...new Set([...(industry.producedMaterials||[]),...Object.keys(industry.requiredMaterials||{}),'Hardware','Robots','AI Cores','Real Estate'])].sort();
   if(materials.length>32)return null;
   for(const city of cities){
    const key=name+'/'+city,o=api.getOffice(name,city),jobs=['Operations','Engineer','Business','Management','Research & Development','Intern','Unassigned'];
    settings.push([key,number(o.size),number(o.numEmployees),jobs.map(j=>number(o.employeeJobs?.[j]))]);
    env(key+'/energy',o.avgEnergy);env(key+'/morale',o.avgMorale);env(key+'/experience',o.totalExperience/Math.max(1,o.numEmployees));
    const has=api.hasWarehouse(name,city);settings.push([key,'warehouse',has]);if(!has)continue;
    const w=api.getWarehouse(name,city);settings.push([key,'warehouse-level',number(w.level),w.smartSupplyEnabled]);
    for(const material of materials){
     const m=api.getMaterial(name,city,material),id=key+'/'+material;
     settings.push([id,m.desiredSellPrice,m.desiredSellAmount,(m.exports||[]).map(e=>[e.division,e.city,e.amount])]);
     env(id+'/quality',m.quality);env(id+'/price',m.marketPrice);
     if(['Hardware','Robots','AI Cores','Real Estate'].includes(material))env(id+'/boost',m.stored);
     if(m.demand!==undefined)env(id+'/demand',m.demand);if(m.competition!==undefined)env(id+'/competition',m.competition);
    }
    for(const product of products){
     const p=api.getProduct(name,city,product),id=key+'/'+product;
     if(p.developmentProgress!==100)return null;
     settings.push([id,p.desiredSellPrice,p.desiredSellAmount]);
     env(id+'/rating',p.effectiveRating);env(id+'/cost',p.productionCost);
     if(p.demand!==undefined)env(id+'/demand',p.demand);if(p.competition!==undefined)env(id+'/competition',p.competition);
    }
   }
  }
  // A bounded identity for settings; numeric environmental controls remain directly comparable.
  const text=JSON.stringify(settings);let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return {settings:text.length+':'+(a>>>0)+':'+(b>>>0),environment,levels,profit:profits.reduce((a,b)=>a+b,0)};
 }catch{return null;}
}

function validSnapshot(s){return s&&typeof s.settings==='string'&&s.settings.length<200&&Number.isFinite(s.profit)&&s.profit>0&&Array.isArray(s.environment)&&s.environment.length<=20000&&s.environment.every(e=>Array.isArray(e)&&typeof e[0]==='string'&&Number.isFinite(e[1])&&e[1]>=0)&&s.levels&&typeof s.levels==='object'&&!Array.isArray(s.levels)&&Object.keys(s.levels).length<=64&&Object.values(s.levels).every(v=>Number.isSafeInteger(v)&&v>=0);}
function comparable(a,b,upgrade=null){
 if(!validSnapshot(a)||!validSnapshot(b)||a.settings!==b.settings||a.environment.length!==b.environment.length)return false;
 if(a.environment.some(([key,v],i)=>key!==b.environment[i][0]||Math.abs(v-b.environment[i][1])>Math.max(1,v,b.environment[i][1])*.02))return false;
 const keys=Object.keys(a.levels);return keys.length===Object.keys(b.levels).length&&keys.every(k=>b.levels[k]===a.levels[k]+(k===upgrade?1:0))&&(!upgrade||keys.includes(upgrade));
}
function stable(samples){const values=samples.map(s=>s.profit);return Math.max(...values)<=Math.min(...values)*1.02;}

/** Observational calibration, never a causal ROI claim. No purchases are delayed to collect data. */
export function observeCorporationCalibration(previous,{scope,at,snapshot,events=[]}={}){
 const scoped=previous?.schemaVersion===1&&previous.scope===scope&&Number.isFinite(previous.at)&&previous.at<=at;
 const stats=Object.create(null);
 if(scoped&&previous.stats&&typeof previous.stats==='object'&&!Array.isArray(previous.stats))for(const [key,value]of Object.entries(previous.stats).slice(0,32)){
  if(Array.isArray(value))stats[key]=calibrationSamples(value,at);
 }
 const state={schemaVersion:1,scope,at,stats,history:[],pending:null,events:[],status:'Collecting stable baseline'};
 if(typeof scope!=='string'||!Number.isFinite(at))return {...state,stats:{},status:'Invalid scope or time'};
 if(!validSnapshot(snapshot))return {...state,status:'Incomplete or nonprofitable native readings; keep estimates'};
 const fresh=scoped&&at>previous.at&&at-previous.at<=120000;
 const history=fresh&&Array.isArray(previous.history)?previous.history.filter(validSnapshot).slice(-3):[];
 const pending=fresh?previous.pending:null;
 if(!Array.isArray(events)||events.length>128)return {...state,status:'Incomplete mutation history'};
 if(events.length){
  const q=events.length===1&&events[0]?.state==='purchased'?events[0].calibrationQuote:null;
  const baseline=history.length===3&&history.every(s=>comparable(history[0],s))&&stable(history);
  if(!pending&&baseline&&validQuote(q)&&q.key===JSON.stringify([q.upgrade,events[0].market?.kind])&&comparable(history[2],snapshot,q.upgrade)){
   state.pending={quote:q,baseline:history[2],low:Math.min(...history.map(s=>s.profit)),high:Math.max(...history.map(s=>s.profit)),settle:1,after:[]};
   state.status='Settling isolated upgrade';return state;
  }
  state.status='Concurrent or unquoted changes; discard attribution';return state;
 }
 if(pending){
  const p=pending;
  if(!validSnapshot(p.baseline)||![p.low,p.high].every(Number.isFinite)||p.low<=0||p.high<p.low||!validQuote(p.quote)||!comparable(p.baseline,snapshot,p.quote.upgrade)||!Array.isArray(p.after)||p.after.length>2||!Number.isSafeInteger(p.settle)||p.settle<0||p.settle>1)return {...state,status:'Changed controls; discard attribution'};
  state.pending={...p,after:p.after.filter(validSnapshot)};
  if(p.settle>0){state.pending.settle--;state.status='Settling isolated upgrade';return state;}
  state.pending.after.push(snapshot);
  if(state.pending.after.length<3){state.status='Collecting settled profit';return state;}
  const after=state.pending.after,low=Math.min(...after.map(s=>s.profit)),high=Math.max(...after.map(s=>s.profit)),delta=low-p.high,noise=(p.high-p.low)+(high-low);
  if(stable(after)&&(Math.abs(delta)>noise||noise===0)){
   const ratio=Math.max(0,Math.min(3,delta/p.quote.expected));stats[p.quote.key]=[...(stats[p.quote.key]||[]),{at,ratio,observedProfitChange:delta,expectedGain:p.quote.expected,baselineProfit:p.high}].slice(-8);
   state.status='Recorded isolated observed profit response';
  }else state.status='Profit noise exceeds usable evidence';
  state.pending=null;state.history=after;return state;
 }
 state.history=history.length&&comparable(history[history.length-1],snapshot)?[...history,snapshot].slice(-3):[snapshot];
 return state;
}

export function calibrateCorporationGrowth(plans,state,{scope,at}={}){
 if(state?.schemaVersion!==1||state.scope!==scope||!Number.isFinite(state.at)||!Number.isFinite(at)||state.at>at||at-state.at>120000)return plans;
 return plans.map(plan=>{
  const quote=corporationCalibrationQuote(plan);if(!quote)return plan;
  const samples=calibrationSamples(state.stats?.[quote.key],at);
  if(samples.length<3)return plan;
  const values=samples.map(s=>s.ratio).sort((a,b)=>a-b),median=values[Math.floor(values.length/2)];
  const factor=Math.max(.75,Math.min(1.25,1+.25*(median-1)));
  return {...plan,uncalibratedScore:plan.score,score:plan.score*factor,calibration:{factor,samples:samples.length,medianResponse:median,basis:'Isolated observed profit response; causal effect unproven'}};
 });
}
