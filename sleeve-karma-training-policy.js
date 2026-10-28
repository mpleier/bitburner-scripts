import {bestSleeveCrime,sleeveCrimeChance} from './sleeve-policy.js';
/** Free crime conditioning; compare both paths with their own evolving XP and karma. */
export function sleeveKarmaTrainingPlan({sleeves=[],tasks=[],crimes={},workers=[],assignments=null,karma=0,nodeMultiplier=1,crimeExpMultiplier=1,levelMultipliers={},recoveryRates=[],enabled=true,canEvaluate=()=>true}){
 const result={choices:{},best:null,evaluations:0,deferred:false};
 if(!enabled||!Number.isFinite(karma)||karma<=-54000||!Number.isFinite(crimeExpMultiplier)||crimeExpMultiplier<0)return result;
 const activeWorkers=[...new Set(workers)].filter(i=>Number.isSafeInteger(i)&&i>=0&&i<sleeves.length&&(assignments?assignments[i]==='karma':!['RECOVERY','SYNCHRO'].includes(tasks[i]?.type)));
 result.activeWorkers=activeWorkers;result.otherKarmaPerSecond={};
 const keys=['hacking','strength','defense','dexterity','agility','charisma'];
 const rate=s=>{const c=crimes[bestSleeveCrime(s,crimes,'karma',nodeMultiplier)];return c?.time>0?sleeveCrimeChance(s,c,nodeMultiplier)*Math.max(0,c.karma||0)*s.sync/100/(c.time/1000):0;};
 const remaining=54000+karma;
 const forecast=(s,other,training=null,seconds=0,goal=remaining)=>{
  const p={...s,skills:{...s.skills},exp:{...s.exp}},shock=Math.max(0,1-s.shock/100);let elapsed=0,earned=0;
  for(let n=0;n<1000&&elapsed<900;n++){
   const name=elapsed<seconds?training:bestSleeveCrime(p,crimes,'karma',nodeMultiplier),c=crimes[name];
   if(!c||!Number.isFinite(c.time)||c.time<1000||c.time>300000)return Infinity;
   const dt=c.time/1000,chance=sleeveCrimeChance(p,c,nodeMultiplier);
   earned+=other*dt+chance*Math.max(0,c.karma||0)*p.sync/100;elapsed+=dt;
   if(earned>=goal)return elapsed;
   for(const k of keys){p.exp[k]+=Math.max(0,c[k+'_exp']||0)*(p.mults?.[k+'_exp']??1)*crimeExpMultiplier*(.25+.75*chance)*shock;p.skills[k]=Math.max(1,Math.floor((32*Math.log(p.exp[k]+534.6)-200)*(p.mults?.[k]??1)*(levelMultipliers[k]??1)));}
  }
  const tail=other+rate(p);return tail>0?elapsed+Math.max(0,goal-earned)/tail:Infinity;
 };
 for(const i of activeWorkers){
  const s=sleeves[i],task=tasks[i];if(!s||s.sync!==100||!(s.shock>=0&&s.shock<100)||keys.some(k=>!Number.isFinite(s.exp?.[k])||s.exp[k]<0||!Number.isFinite(s.skills?.[k])||!Number.isFinite(s.mults?.[k]??1)||!Number.isFinite(levelMultipliers[k]??1)))continue;
  if(task?.type==='CRIME'&&task.cyclesWorked>0&&task.cyclesNeeded>task.cyclesWorked&&crimes[task.crimeType]){result.choices[i]=task.crimeType;continue;}
  if(!canEvaluate()){result.deferred=true;break;}
  const other=activeWorkers.filter(j=>j!==i).reduce((sum,j)=>sum+rate(sleeves[j]),0);
  result.otherKarmaPerSecond[i]=other;
  let baseline=forecast(s,other);const recovery=recoveryRates[i];
  if(Number.isFinite(recovery)&&recovery>0){const delay=s.shock/recovery,left=remaining-other*delay;if(left<=0)baseline=Math.min(baseline,remaining/other);else {const recovered=forecast({...s,shock:0},other,null,0,left);baseline=Math.min(baseline,delay+recovered);}}
  const weights=crimes[bestSleeveCrime(s,crimes,'karma',nodeMultiplier)]||{};
  const candidates=Object.entries(crimes).filter(([,c])=>Number.isFinite(c.time)&&c.time>=1000&&c.time<=60000).map(([name,c])=>({name,score:keys.reduce((sum,k)=>sum+Math.max(0,weights[k+'_success_weight']||0)*Math.max(0,c[k+'_exp']||0)*(s.mults?.[k+'_exp']??1),0)/c.time})).sort((a,b)=>b.score-a.score).slice(0,3);
  for(const c of candidates)for(const seconds of [60,180,300]){
   if(!canEvaluate()){result.deferred=true;break;}
   result.evaluations++;const eta=forecast(s,other,c.name,seconds),gain=baseline-eta;
   if(Number.isFinite(baseline)&&Number.isFinite(eta)&&eta<baseline*.9&&gain>(result.best?.gainSeconds||0))result.best={index:i,name:c.name,trainingSeconds:seconds,baselineSeconds:baseline,etaSeconds:eta,gainSeconds:gain};
  }
 }
 if(result.best)result.choices[result.best.index]=result.best.name;
 return result;
}
