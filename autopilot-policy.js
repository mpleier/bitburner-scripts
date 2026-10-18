function entries(value) { return value instanceof Map ? [...value.entries()] : Object.entries(value || {}); }
export function autopilotSourceFiles(reset, active=true) {
  const result=Object.fromEntries(entries(reset.ownedSF).filter(([,level])=>Number(level)>0).map(([id,level])=>[id,Number(level)]));
  if(!active)return result;
  if(reset.currentNode>0)result[reset.currentNode]=Math.max(result[reset.currentNode]||0,[4,8].includes(reset.currentNode)?3:1);
  for(const [id,level] of entries(reset.bitNodeOptions?.sourceFileOverrides)) {
    if(Number(level)>0)result[id]=Number(level);else delete result[id];
  }
  return result;
}
export function installedAugmentationsFromReset(reset) {
  return entries(reset.ownedAugs).filter(([,level])=>Number(level)>0).map(([name])=>name);
}
export function daemonArgumentsChanged(existing,wanted) {
  const normalize=args=>{
    const flags={};let name='_';
    for(const value of args) {
      if(typeof value==='string'&&value.startsWith('--')) {
        name=value;
        if(name==='--disable-script')flags[name]??=[];else flags[name]=[];
      } else (flags[name]??=[]).push(value);
    }
    // Recovery padding follows hacking skill; allow it to grow without frequent restarts.
    if(flags['--recovery-thread-padding'])flags['--recovery-thread-padding']=['dynamic'];
    if(flags['--disable-script'])flags['--disable-script']=[...new Set(flags['--disable-script'])].sort();
    return JSON.stringify(Object.fromEntries(Object.entries(flags).sort(([a],[b])=>a.localeCompare(b))));
  };
  return normalize(existing)!==normalize(wanted);
}
export function autopilotOptionsError(options) {
  if(options['node-route']!==undefined&&!['auto','wd','bb','hacking','bladeburner'].includes(options['node-route']))return 'node-route must be auto, wd, or bb.';
  if(options['intelligence-farming']) {
    for(const key of ['intelligence-target','intelligence-max-minutes'])if(!Number.isFinite(options[key])||options[key]<=0)return key+' must be positive and finite.';
    if(!Number.isInteger(options['intelligence-max-resets'])||options['intelligence-max-resets']<1)return 'intelligence-max-resets must be a positive integer.';
  }
  for(const name of ['interval','interval-check-scripts','xp-mode-interval-minutes','high-hack-threshold'])
    if(!Number.isFinite(options[name])||options[name]<=0)return name+' must be a positive finite number.';
  for(const name of ['install-countdown','time-before-boosting-best-hack-server','reduced-aug-requirement-per-hour','xp-mode-duration-minutes','spend-hashes-on-server-hacking-threshold'])
    if(!Number.isFinite(options[name])||options[name]<0)return name+' must be a nonnegative finite number.';
  for(const name of ['install-at-aug-count','install-at-aug-plus-nf-count'])
    if(!Number.isInteger(options[name])||options[name]<0)return name+' must be a nonnegative integer.';
  if(!(options['wait-for-4s-threshold']>=0&&options['wait-for-4s-threshold']<=1))return 'wait-for-4s-threshold must be between zero and one.';
  if(options['xp-mode-duration-minutes']>options['xp-mode-interval-minutes'])return 'xp-mode-duration-minutes must not exceed xp-mode-interval-minutes.';
  return null;
}
export function autopilotStockReserve(money,stocksValue,hours,stockApiAvailable,progressionPriority=false) {
  const percent=Math.max(0,.8-.1*Math.max(0,Number(hours)||0));
  return Math.min(1e12,Math.max(0,money*percent,stockApiAvailable&&!progressionPriority?8e9-stocksValue:0));
}

/** Priority augmentations can be affordable or already purchased, but must still await installation. */
export function priorityAugmentationReady(priority, summary) {
  const installed = new Set(summary?.installed_augs || []);
  const ready = new Set([...(summary?.affordable_augs || []), ...(summary?.awaiting_install_augs || [])]);
  return (priority || []).some(name => !installed.has(name) && ready.has(name));
}


/** Unversioned, stale, malformed or previous-reset summaries cannot trigger installs. */
export function freshFactionManagerOutput(raw,reset,now=Date.now(),maxAge=120000) {
 try{
  if(!Number.isFinite(now)||!Number.isFinite(maxAge)||maxAge<=0||!Number.isFinite(reset?.lastAugReset)||!Number.isFinite(reset?.lastNodeReset))return null;
  const value=typeof raw==='string'?JSON.parse(raw):raw;
  if(value?.schemaVersion!==1||value.augReset!==reset.lastAugReset||value.nodeReset!==reset.lastNodeReset||!Number.isFinite(value.at)||value.at>now||now-value.at>maxAge)return null;
  for(const field of ['installed_augs','affordable_augs','awaiting_install_augs'])if(!Array.isArray(value[field])||value[field].some(n=>typeof n!=='string'))return null;
  for(const field of ['installed_count','affordable_count_ex_nf','awaiting_install_count_ex_nf','affordable_count_nf','awaiting_install_count_nf','unpurchased_count'])if(!Number.isSafeInteger(value[field])||value[field]<0)return null;
  for(const field of ['total_rep_cost','total_aug_cost'])if(!Number.isFinite(value[field])||value[field]<0)return null;
  if(value.installed_count!==value.installed_augs.length)return null;
  for(const prefix of ['affordable','awaiting_install']){
   const names=value[prefix+'_augs'],nf=names.filter(n=>n==='NeuroFlux Governor').length;
   if(value[prefix+'_count_nf']!==nf||value[prefix+'_count_ex_nf']!==names.length-nf)return null;
  }
  return value;
 }catch{return null;}
}
