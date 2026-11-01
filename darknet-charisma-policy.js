export const charismaGoalFile='tasks/dnet-charisma-goal.json',charismaTrainingFile='tasks/dnet-charisma-training.json',charismaLedgerFile='tasks/dnet-charisma-ledger.json',charismaTrainerFile='darknet-charisma.js';
const labAugmentOrder=['The Broken Wings','The Boots','The Hammer','The Staff','The Law','The Sword'];
const labAugmentOrderBn15=['The Broken Wings','The Boots','The Hammer','The Staff','The Red Pill','The Law','The Sword'];
const labCharismaTargets=[300,600,1500,2500,3000,3500,4000,4000];
/** The next labyrinth is selected by installed lab augmentations, not by a currently visible host. */
export function nextLabCharismaTarget(owned=[],bitNode=null){
 const list=Array.isArray(owned)?owned:[],order=Number(bitNode)===15?labAugmentOrderBn15:labAugmentOrder;
 const installed=order.filter(name=>list.includes(name)).length;
 const index=Math.min(installed,labCharismaTargets.length-1);
 return {target:labCharismaTargets[index],labIndex:index};
}
export function charismaGate(info,charisma,feedback=false){return (info?.modelId==='(The Labyrinth)'||feedback)&&Number.isFinite(info.requiredCharismaSkill)&&Number.isFinite(charisma)&&charisma<info.requiredCharismaSkill;}
export function passiveCharismaRate(previous,current){
 if(!previous||previous.signature!==current.signature||!Number.isFinite(previous.at)||current.at-previous.at<10000||current.at-previous.at>120000||!Number.isFinite(previous.exp)||!Number.isFinite(current.exp)||current.exp<previous.exp)return null;
 return (current.exp-previous.exp)/((current.at-previous.at)/1000);
}
export function planCharismaStudy({remainingXp,passiveRate,quotes,secondsUsed=0,cashUsed=0,money,reserve,secondsBudget=600,cashBudget=5000000}){
 if(![remainingXp,passiveRate,secondsUsed,cashUsed,money,reserve,secondsBudget,cashBudget].every(Number.isFinite)||remainingXp<=0||passiveRate<0||secondsUsed<0||cashUsed<0||secondsBudget<=0||cashBudget<=0)return {state:'waiting',reason:'Waiting for a reliable passive XP sample'};
 const secondsLeft=Math.max(0,secondsBudget-secondsUsed),cashLeft=Math.max(0,cashBudget-cashUsed),available=Math.max(0,money-reserve);
 if(secondsLeft<1||cashLeft<=0)return {state:'bounded',reason:'Charisma training budget reached'};
 let best=null;
 for(const q of quotes||[]){
  if(![q.rate,q.costPerSecond,q.travelCost].every(Number.isFinite)||q.rate<=0||q.costPerSecond<0||q.travelCost<0||q.rate<=passiveRate*.1)continue;
  const eta=remainingXp/(passiveRate+q.rate),seconds=Math.min(30,secondsLeft,Math.ceil(eta));
  const cost=q.travelCost+q.costPerSecond*(seconds+1);
  if(eta>secondsLeft||q.travelCost+q.costPerSecond*(Math.ceil(eta)+1)>cashLeft||cost>Math.min(cashLeft,available*.01))continue;
  if(!best||q.rate>best.rate||q.rate===best.rate&&cost<best.cost)best={...q,state:'study',reason:'Bounded study improves the next labyrinth unlock',seconds,cost,etaSeconds:eta,passiveEtaSeconds:passiveRate>0?remainingXp/passiveRate:null};
 }
 return best||{state:'passive',reason:'Passive XP preferred; study gain or remaining budget is insufficient',passiveEtaSeconds:passiveRate>0?remainingXp/passiveRate:null};
}
/** Bounded short burst that may interrupt a low-value crime, separate from the 600s/$5m study budget. */
export function planCharismaInterrupt({remainingXp,passiveRate,quotes,secondsUsed=0,cashUsed=0,money,reserve,maxSeconds=45,maxCash=1000000,maxPassiveSeconds=60}={}){
 if(![remainingXp,passiveRate,secondsUsed,cashUsed,money,reserve,maxSeconds,maxCash,maxPassiveSeconds].every(Number.isFinite)||remainingXp<=0||passiveRate<0||secondsUsed<0||cashUsed<0||maxSeconds<=0||maxCash<0)return {state:'waiting',reason:'Waiting for a reliable interrupt budget'};
 const leftSeconds=Math.max(0,maxSeconds-secondsUsed),leftCash=Math.max(0,maxCash-cashUsed),available=Math.max(0,money-reserve);
 if(leftSeconds<1||leftCash<=0)return {state:'bounded',reason:'Interrupt budget reached'};
 if(passiveRate>0&&remainingXp/passiveRate<=maxPassiveSeconds)return {state:'passive',reason:'Passive gain should close the gap soon'};
 let best=null;
 for(const q of quotes||[]){
  if(![q.rate,q.costPerSecond,q.travelCost].every(Number.isFinite)||q.rate<=0||q.costPerSecond<0||q.travelCost<0||q.rate<=passiveRate*.1)continue;
  const eta=remainingXp/q.rate,seconds=Math.ceil(eta),cost=q.travelCost+q.costPerSecond*(seconds+1);
  if(seconds<1||seconds>leftSeconds||cost>Math.min(leftCash,available*.01))continue;
  if(!best||q.rate>best.rate||q.rate===best.rate&&cost<best.cost)best={...q,state:'study',reason:'Short interrupt closes the last Charisma gap',seconds,cost,etaSeconds:eta};
 }
 return best||{state:'defer',reason:'No affordable short interrupt course'};
}
/** Live adjacent observations take priority; installed lab progress supplies a standing target. */
export async function coordinateCharismaGoal(ns,reports,reset,now=Date.now()){
 const player=ns.getPlayer(),candidates=[];
 for(const r of reports){if(!r.live||r.at>now||now-r.at>90000||!Array.isArray(r.neighbours))continue;for(const t of (r.charismaBlocked||[]).slice(0,16))if(t&&r.neighbours.includes(t.host)&&t.at<=now&&now-t.at<=120000&&t.modelId==='(The Labyrinth)'&&Number.isFinite(t.required)&&t.required>player.skills.charisma)candidates.push(t);}
 const seen=new Set();let selected=null;
 for(const t of candidates.sort((a,b)=>a.required-b.required).slice(0,32)){if(seen.has(t.host))continue;seen.add(t.host);try{const d=ns.dnet.getServerDetails(t.host);if(d.isOnline!==false&&d.hasSession!==true&&d.modelId===t.modelId&&d.requiredCharismaSkill===t.required){selected=t;break;}}catch{}}
 // No labyrinth is visible yet: keep training toward the next lab unlocked by installed lab augments.
 if(!selected)try{const next=nextLabCharismaTarget(ns.singularity?.getOwnedAugmentations(false),reset.currentNode);if(next.target>player.skills.charisma)selected={host:null,required:next.target,modelId:'(The Labyrinth)',fallback:true};}catch{}
 const goal={version:1,ownerPid:ns.pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,expiresAt:now+90000,state:selected?'target':'none',host:selected?.host??null,target:selected?.required??null,current:player.skills.charisma};
 await ns.write(charismaGoalFile,JSON.stringify(goal),'w');
 if(selected&&ns.fileExists(charismaTrainerFile,'home')&&!ns.ps('home').some(p=>p.filename===charismaTrainerFile)){
  const ram=ns.getScriptRam(charismaTrainerFile,'home');if(ram>0&&ns.getServerMaxRam('home')-ns.getServerUsedRam('home')>=ram+64)ns.exec(charismaTrainerFile,'home',1,ns.pid);
 }
 return goal;
}
