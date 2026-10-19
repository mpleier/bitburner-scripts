/** Observed throughput, not a causal claim about hash upgrades. All windows are reset/owner scoped. */
export function collectHackingIncome(ns,reset,ownerPid,inventory,now=Date.now(),lagMs=0) {
 const file='tasks/hacking-income.json',read=f=>{try{return JSON.parse(ns.read(f));}catch{return null;}};
 const old=read(file),telemetry=read('tasks/hgw-misfires.json'),upgrades=read('tasks/hash-server-upgrades.json');
 const same=old?.version===1&&old.ownerPid===ownerPid&&old.nodeReset===reset.lastNodeReset&&old.augReset===reset.lastAugReset&&old.at<=now;
 const status={version:1,at:now,ownerPid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,targets:{},basis:'Observed hack receipts divided by sampled allocated RAM-seconds; not causal upgrade gains'};
 const valid=inventory?.complete===true&&lagMs<250&&telemetry?.blocked===false&&telemetry.ownerPid===ownerPid&&
  telemetry.nodeReset===reset.lastNodeReset&&telemetry.augReset===reset.lastAugReset&&telemetry.at<=now&&now-telemetry.at<15000;
 if(!valid){status.reason='Waiting for complete, fresh income and allocation evidence';ns.write(file,JSON.stringify(status),'w');return status;}
 const player=ns.getPlayer(),daemon=ns.ps('home').find(p=>p.pid===ownerPid&&p.filename.replace(/^\//,'')==='daemon.js');
 for(const [target,a]of Object.entries(inventory.allocations||{}).slice(0,64))try{
  if(a.manual||!(a.ram>0)||!daemon||daemon.args.some(v=>['--xp-only','-x','--x','--hack-only','-h'].includes(v)))continue;
  const c=telemetry.income?.[JSON.stringify([ownerPid,target])];
  if(!c||![c.money,c.completions,c.risks].every(v=>Number.isFinite(v)&&v>=0))continue;
  const server=ns.getServer(target);
  const savedPacing=read('tasks/hgw-pacing.json');
    const pacing=savedPacing?.pid===ownerPid&&savedPacing.at<=now&&now-savedPacing.at<15000?
     [savedPacing.cycleMs,savedPacing.queueMs,savedPacing.targetCap]:null;
    const signature=JSON.stringify([server.moneyMax,server.minDifficulty,player.skills,player.mults,daemon.args,pacing]);
  let previous=same?old.targets?.[target]:null;
  const continuous=previous?.signature===signature&&now-old.at<=15000&&Math.abs(previous.lastRam/a.ram-1)<=.05&&
   c.money>=previous.lastMoney&&c.completions>=previous.lastCompletions&&c.risks===previous.lastRisks;
  if(!continuous)previous=null;
  const window=previous?.window?{...previous.window}:{at:now,money:c.money,completions:c.completions,risks:c.risks,ramSeconds:0};
  if(previous)window.ramSeconds+=(now-old.at)/1000*(previous.lastRam+a.ram)/2;
  const durationSeconds=(now-window.at)/1000,completions=c.completions-window.completions,risks=c.risks-window.risks;
  const row={signature,lastRam:a.ram,lastMoney:c.money,lastCompletions:c.completions,lastRisks:c.risks,window,
   ...(previous?.measuredAt?{measuredAt:previous.measuredAt,durationSeconds:previous.durationSeconds,completions:previous.completions,risks:previous.risks,incomePerRamSecond:previous.incomePerRamSecond,ram:previous.ram,...(previous.upgradeComparison?{upgradeComparison:previous.upgradeComparison}:{})}:{})};
  // At least two minutes and thirty receipts; no positive-gain extrapolation from noisy samples.
  if(durationSeconds>=120&&completions>=30&&risks===0&&window.ramSeconds>0){
   Object.assign(row,{measuredAt:now,durationSeconds,completions,risks,incomePerRamSecond:(c.money-window.money)/window.ramSeconds,ram:window.ramSeconds/durationSeconds});
   const entry=upgrades?.nodeReset===reset.lastNodeReset&&upgrades.augReset===reset.lastAugReset&&Array.isArray(upgrades.entries)?
    [...upgrades.entries].reverse().find(e=>e.target===target):null;
   const before=entry?.projection?.calibration?.observation;
   if(before&&before.at<=entry.at&&entry.at<=now&&entry.moneyMax===server.moneyMax&&entry.minDifficulty===server.minDifficulty&&
    entry.projection.calibration.context===JSON.stringify([player.skills,player.mults,daemon.args,pacing])&&
    window.at>=entry.at+Math.max(0,entry.projection.retuneSeconds)*1000&&before.incomePerRamSecond>0)
    row.upgradeComparison={upgradeAt:entry.at,action:entry.action,beforeIncomePerRamSecond:before.incomePerRamSecond,
     afterIncomePerRamSecond:row.incomePerRamSecond,observedRelative:row.incomePerRamSecond/before.incomePerRamSecond-1,
     projectedRelative:entry.projection.relative,basis:'Observational before/after rates; not isolated causal upgrade gains'};
   row.window={at:now,money:c.money,completions:c.completions,risks:c.risks,ramSeconds:0};
  }else if(durationSeconds>600){row.window={at:now,money:c.money,completions:c.completions,risks:c.risks,ramSeconds:0};}
  status.targets[target]=row;
 }catch{} // A deleted target cannot keep an old qualified sample alive.
 ns.write(file,JSON.stringify(status),'w');return status;
}
