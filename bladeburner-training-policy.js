import {trainingBackgroundDelta} from './player-training-calibration-policy.js';
const trainingStats=['strength','defense','dexterity','agility'];
/** Per-target quota survives reloads; empirical XP is scoped to one uninterrupted owner/profile. */
export function bladeburnerTrainingMilestone(saved,{reset,ownerPid,target,total,externalTotal=0,limit=50,now,observe=false,training=false,player=null,background=null,workIdle=false,clock=null}){
 const nativeTotal=total;total=Number.isFinite(externalTotal)&&externalTotal>=0?total+externalTotal:Infinity;
 const valid=saved?.schemaVersion===1&&saved.target===target&&saved.nodeReset===reset.lastNodeReset&&saved.augReset===reset.lastAugReset&&Number.isFinite(saved.at)&&saved.at<=now&&Number.isFinite(saved.baseTotal)&&saved.baseTotal>=0&&saved.baseTotal<=total;
 const baseTotal=valid?saved.baseTotal:total,used=Number.isFinite(total)&&total>=baseTotal?(total-baseTotal):Infinity;
 const baseNativeTotal=valid?(Number.isFinite(saved.baseNativeTotal)?saved.baseNativeTotal:saved.baseTotal):nativeTotal,nativeUsed=Number.isFinite(nativeTotal)&&nativeTotal>=baseNativeTotal?nativeTotal-baseNativeTotal:Infinity;
 const cap=Number.isFinite(limit)&&limit>=0?limit:0;
 const profile=observe?JSON.stringify(player?.mults||null):valid?saved.profile:null;
 const same=valid&&saved.ownerPid===ownerPid&&saved.profile===profile;
 let probeUntil=same&&Number.isFinite(saved.probeUntil)?Math.min(cap,saved.probeUntil):Math.min(cap,nativeUsed+2);
 const evidenceSame=same&&saved.evidenceVersion===3;
 let samples=evidenceSame&&Array.isArray(saved.samples)?saved.samples.filter(s=>s?.backgroundCorrected===true&&s.completionAligned===true&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=300000&&trainingStats.every(k=>Number.isFinite(s.rates?.[k])&&s.rates[k]>=0)).slice(-3):[];
 let anchor=evidenceSame?saved.anchor:null;
 const validClock=c=>c&&Number.isFinite(c.progress)&&c.progress>=0&&Number.isFinite(c.duration)&&c.duration>0&&c.duration<=120000&&c.progress<=c.duration;
 const clockKnown=validClock(clock);
 const previousClock=evidenceSame?saved.clock:null;
 if(clockKnown&&validClock(previousClock)&&clock.duration!==previousClock.duration){samples=[];anchor=null;}
 const completed=observe&&training&&saved?.training===true&&clockKnown&&validClock(previousClock)&&clock.duration===previousClock.duration&&Number.isFinite(saved.observedAt)&&now>saved.observedAt&&now-saved.observedAt<=60000&&clock.progress<previousClock.progress;
 if(observe){
  const xp=player?.exp;
  const continuous=same&&training&&saved.training===true&&Number.isFinite(saved.observedAt)&&now>saved.observedAt&&now-saved.observedAt<=60000;
  if(!training||!continuous||!anchor||!Number.isFinite(anchor.at)||anchor.at>now||now-anchor.at>120000||!trainingStats.every(k=>Number.isFinite(xp?.[k])&&xp[k]>=0&&Number.isFinite(anchor.exp?.[k])&&xp[k]>=anchor.exp[k]))anchor=null;
  const backgroundKnown=trainingBackgroundDelta(background,background)!==null;
  if(anchor&&clockKnown&&anchor.duration!==clock.duration)anchor=null;
  if(!workIdle||!backgroundKnown||!clockKnown)anchor=null;
  else if(training&&trainingStats.every(k=>Number.isFinite(xp?.[k])&&xp[k]>=0)){
   const nextAnchor=()=>({at:now,exp:Object.fromEntries(trainingStats.map(k=>[k,xp[k]])),background,duration:clock.duration});
   const incoming=anchor?trainingBackgroundDelta(anchor.background,background):null;
   if(!anchor||incoming===null)anchor=nextAnchor();
   else if(completed&&now-anchor.at>=15000){const seconds=(now-anchor.at)/1000;samples=[...samples,{at:now,backgroundCorrected:true,completionAligned:true,rates:Object.fromEntries(trainingStats.map(k=>[k,Math.max(0,xp[k]-anchor.exp[k]-incoming[k])/seconds]))}].slice(-3);anchor=nextAnchor();}
  }
 }
 const measured=samples.length>0&&samples.every(s=>trainingStats.every(k=>s.rates[k]>0));
 let lastProbeAt=same&&Number.isFinite(saved.lastProbeAt)?saved.lastProbeAt:now;
 if(!measured&&nativeUsed>=probeUntil&&used<cap&&now-lastProbeAt>=600000){probeUntil=Math.min(cap,nativeUsed+2);lastProbeAt=now;}
 const eligible=typeof target==='string'&&target.length>0&&Number.isFinite(used)&&used<cap&&(nativeUsed<probeUntil||measured);
 return {schemaVersion:1,evidenceVersion:3,clock:observe&&training&&clockKnown?{...clock}:observe?null:evidenceSame?saved.clock:null,completionStatus:observe?(clockKnown?(completed?'wrapped':'waiting-for-wrap'):'unknown-clock'):evidenceSame?saved.completionStatus:'not-observed',backgroundStatus:observe?(training?(workIdle?(trainingBackgroundDelta(background,background)!==null?'verified':'unknown'):'player-work-or-unknown'):'not-training'):same?saved.backgroundStatus:'not-observed',at:now,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,ownerPid,target,baseTotal,baseNativeTotal,nativeUsed,used,limit:cap,probeUntil,lastProbeAt,profile,anchor,samples,training:observe?training:same?saved.training:false,observedAt:observe?now:same?saved.observedAt:null,eligible,reason:cap===0?'Training disabled':used>=cap?'Milestone quota exhausted':nativeUsed<probeUntil?'Bounded milestone probe':measured?'Recent XP gain observed; compare with mission work':'Waiting for useful measured Training XP'};
}
/** Only corrected samples can extend Training beyond its bounded probe; retain the native model ceiling. */
export function bladeburnerTrainingPayoff(state,candidate,alternativeScore=0,now=Date.now()){
 if(!state?.eligible||!Number.isFinite(state.at)||state.at>now||now-state.at>15000||candidate?.kind!=='training'||!Number.isFinite(candidate.score)||candidate.score<=0||!Number.isFinite(alternativeScore)||alternativeScore<0)return false;
 if((state.nativeUsed??state.used)<state.probeUntil)return candidate.score>alternativeScore*1.1;
 const samples=(Array.isArray(state.samples)&&state.evidenceVersion===3?state.samples:[]).filter(s=>s?.backgroundCorrected===true&&s.completionAligned===true&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=300000&&trainingStats.every(k=>Number.isFinite(s.rates?.[k])&&s.rates[k]>=0));
 if(!samples.length||!trainingStats.every(k=>Number.isFinite(candidate.rates?.[k])&&candidate.rates[k]>0))return false;
 const fraction=Math.min(1,...trainingStats.map(k=>Math.min(...samples.map(s=>s.rates[k]))/candidate.rates[k]));
 return candidate.score*fraction>alternativeScore*1.1;
}
