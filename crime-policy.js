export const crimeNames = ['Shoplift','Rob Store','Mug','Larceny','Deal Drugs','Bond Forgery','Traffick Arms','Homicide','Grand Theft Auto','Kidnap','Assassination','Heist'];
export function parseCrimeOptions(args) {
  const options={crime:null,fast:false,focus:false,goal:'balanced'}, words=[];
  for(let i=0;i<args.length;i++) {
    const arg=String(args[i]);
    if(arg==='--fast-crimes-only')options.fast=true;
    else if(arg==='--focus')options.focus=true;
    else if(arg==='--goal')options.goal=String(args[++i]);
    else if(arg.startsWith('--'))throw new Error('Unknown option: '+arg);
    else words.push(arg);
  }
  if(!['balanced','money','karma','kills','stats'].includes(options.goal))throw new Error('Choose --goal balanced, money, karma, kills, or stats.');
  if(words.length) {
    options.crime=crimeNames.find(name=>name.toLowerCase()===words.join(' ').toLowerCase());
    if(!options.crime)throw new Error('Unknown crime: '+words.join(' '));
  }
  return options;
}
export function choosePlayerCrime(stats,chances,options) {
  if(options.crime)return options.crime;
  if(options.goal==='balanced') {
    return [['Heist',.75],['Assassination',.9],['Homicide',.5],['Mug',0]]
      .find(([name,chance])=>stats[name]?.time>0&&(!options.fast||stats[name].time<=6000)&&(Number(chances[name])||0)>=chance)?.[0] || 'Shoplift';
  }
  const score=(name,item)=>{
    const chance=Math.max(0,Math.min(1,Number(chances[name])||0));
    // Player crimes award one quarter of karma and experience on failure.
    const partial=.25+.75*chance;
    const reward=options.goal==='karma'?partial*(Number(item.karma)||0):options.goal==='kills'?chance*(Number(item.kills)||0):
      options.goal==='stats'?partial*['strength_exp','defense_exp','dexterity_exp','agility_exp'].reduce((sum,key)=>sum+(Number(item[key])||0),0):chance*(Number(item.money)||0);
    return reward/item.time;
  };
  return Object.entries(stats).filter(([,item])=>item.time>0&&(!options.fast||item.time<=6000))
    .sort((a,b)=>score(b[0],b[1])-score(a[0],a[1]))[0]?.[0] || 'Mug';
}
export function crimePauseReason(snapshot, now=Date.now()) {
  if(snapshot.activity?.expiresAt>now&&snapshot.activity.alive)return 'another activity owns the player';
  if(snapshot.processes?.some(p=>/(^|\/)(casino|ascend)\.js$/.test(p.filename)))return 'casino or augmentation reset';
  if(snapshot.transition?.expiresAt>now&&snapshot.transition.alive)return 'BitNode or augmentation transition';
  if(snapshot.bladeburnerBlocked)return 'Bladeburner action';
  if(snapshot.work?.type&&snapshot.work.type!=='CRIME')return snapshot.work.type.toLowerCase()+' work';
  return null;
}
/** A single iteration, independent of game helpers so progress and race handling can be tested. */
export async function crimeTick(state,snapshot,options,commit,now=Date.now(),stopOwned=null) {
  const work=snapshot.work;
  const cycles=Number(work?.cyclesWorked)||0;
  // Another owner changed or restarted the action: release our old cleanup claim.
  if(state.ownedCrime&&(work?.type!=='CRIME'||work.crimeType!==state.ownedCrime||cycles<(state.lastCycles||0)))state.ownedCrime=null;
  state.lastCycles=cycles;
  const duration=Number(snapshot.stats[work?.crimeType]?.time)||0;
  const completed=duration>0?Math.floor((Number(work?.cyclesWorked)||0)*200/duration):0;
  const boundary=state.observed===work?.crimeType&&completed>state.completed;
  state.observed=work?.crimeType;state.completed=completed;
  const reason=crimePauseReason(snapshot,now);
  if(reason) {
    if(stopOwned&&work?.type==='CRIME'&&state.ownedCrime===work.crimeType) {
      await stopOwned(work.crimeType,Number(work.cyclesWorked)||0);
      state.ownedCrime=null;
    }
    return {mode:'waiting',reason};
  }
  const crime=choosePlayerCrime(snapshot.stats,snapshot.chances,options);
  if(work?.type==='CRIME') {
    if(work.crimeType===crime)return {mode:'running',crime};
    if(!boundary)return {mode:'finishing',crime:work.crimeType,nextCrime:crime};
  }
  const durationStarted=await commit(crime,options.focus,work?.crimeType||null,work?.type==='CRIME'?cycles:null);
  if(!(Number.isFinite(durationStarted)&&durationStarted>0))return {mode:'waiting',reason:'crime start rejected or another activity began'};
  state.observed=crime;state.completed=0;state.ownedCrime=crime;state.lastCycles=0;
  return {mode:'running',crime,started:true,duration:durationStarted};
}
/** Self-contained for the generated helper: repeat priority checks immediately before committing. */
export function guardedCommitCrime(ns,crime,focus,expectedCrime,checkBladeburner,expectedCycles=null) {
  if(ns.read('remote-control/paused/crime.js.txt').trim()==='true')return 0;
  const activeFile=path=>{try{const value=JSON.parse(ns.read(path));return value.expiresAt>Date.now()&&ns.isRunning(value.ownerPid);}catch{return false;}};
  if(activeFile('tasks/activity-lock.json')||activeFile('tasks/progression-transition.json')||
    ns.ps('home').some(p=>/(^|\/)(casino|ascend)\.js$/.test(p.filename)))return 0;
  const work=ns.singularity.getCurrentWork();
  if(work?.type&&work.type!=='CRIME')return 0;
  if((work?.crimeType||null)!==(expectedCrime||null))return 0;
  if(expectedCycles!==null&&(Number(work?.cyclesWorked)||0)<expectedCycles)return 0;
  if(checkBladeburner)try {
    if(ns.bladeburner.inBladeburner()) {
      const action=ns.bladeburner.getCurrentAction();
      if(action?.type&&!/^(idle|none)$/i.test(action.type)&&(/black/i.test(action.type)||!ns.singularity.getOwnedAugmentations(false).includes("The Blade's Simulacrum")))return 0;
    }
  }catch { return 0; }
  return ns.singularity.commitCrime(crime,focus);
}

export function guardedStopCrime(ns,crime,cyclesWorked) {
  const current=ns.singularity.getCurrentWork();
  if(current?.type!=='CRIME'||current.crimeType!==crime||(Number(current.cyclesWorked)||0)<cyclesWorked)return false;
  ns.singularity.stopAction();return true;
}
