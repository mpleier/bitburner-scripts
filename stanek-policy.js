export function stanekChargePlan(fragments,maxCharges,continueForRep=false,peakCharge=0) {
  const chargeable=fragments.filter(fragment=>fragment.id<100);
  if(!chargeable.length)return {complete:false,blocked:true,fragments:[]};
  const pending=continueForRep?chargeable:chargeable.filter(fragment=>!(Number(fragment.numCharge)>=maxCharges)||(maxCharges>0&&(Number(fragment.highestCharge)||0)<peakCharge));
  return {complete:pending.length===0,blocked:false,fragments:[...pending].sort((a,b)=>a.numCharge-b.numCharge)};
}
export function stanekThreadBudget(freeRam,workerRam,reservedRam,idealRam,pendingRam=0) {
  if(![freeRam,workerRam,reservedRam,idealRam,pendingRam].every(Number.isFinite)||workerRam<=0)return {threads:0,reserve:0};
  const reserve=Math.max(0,reservedRam,pendingRam,freeRam>0&&idealRam/freeRam<=.05?idealRam:0);
  return {threads:Math.max(0,Math.floor((freeRam-reserve)/workerRam)),reserve};
}
export function selectStanekLayout(layouts,width,height,node=0) {
  if(!(width>0&&height>0))return null;
  const best=layouts.filter(layout=>layout.width<=width&&layout.height<=height)
    .sort((a,b)=>(height-a.height+width-a.width)-(height-b.height+width-b.width))[0];
  if(!best)return null;
  const copy={...best,fragments:best.fragments.map(fragment=>({...fragment}))};
  if([6,7].includes(node)&&!copy.fragments.some(f=>f.id===30)) {
    const hacking=copy.fragments.find(f=>f.id===0);if(hacking)hacking.id=30;
  }
  return copy;
}
export function stanekOptionsError(options) {
  for(const name of ['reserved-ram','reserved-ram-ideal','max-charges'])
    if(!Number.isFinite(options[name])||options[name]<0)return name+' must be a finite nonnegative number.';
  if(!Number.isFinite(options['reputation-threshold'])||options['reputation-threshold']<0||options['reputation-threshold']>1)
    return 'reputation-threshold must be between zero and one.';
  return null;
}
/** Read optional SF4 access without requiring Singularity to read Source Files. */
export function stanekSourceLevel(reset,id) {
  const read=map=>typeof map?.get==='function'?map.get(id):map?.[id];
  const override=read(reset.bitNodeOptions?.sourceFileOverrides);
  if(override!==undefined)return Math.max(0,Number(override)||0);
  return Math.max(Number(read(reset.ownedSF))||0,reset.currentNode===id?(id===4?3:1):0);
}

/** Forced sizes may reduce the grid but cannot exceed its actual bounds. */
export function stanekLayoutDimensions(actualWidth,actualHeight,forcedWidth,forcedHeight) {
 const width=forcedWidth??actualWidth,height=forcedHeight??actualHeight;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>actualWidth||height>actualHeight)return null;
 return {width,height};
}
