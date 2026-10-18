/** Keep helper space on small home servers; explicit reservations remain authoritative. */
export function daemonHomeReserve(maximum,configured=null,doubled=false) {
 const base=configured==null?Math.min(32,Math.max(0,maximum)*.25):Math.max(0,Number(configured)||0);
 return base*(doubled?2:1);
}
/** A growing cash milestone can wake infrastructure checks before their ordinary timer. */
export function infrastructureCashBand(money) {
 return Number.isFinite(money)&&money>=100000?Math.floor(Math.log2(money/100000)):-1;
}

export function factionWorkerReady(record,process,reset,now=Date.now()) {
 return !!process&&record?.pid===process.pid&&record.augReset===reset.lastAugReset&&record.nodeReset===reset.lastNodeReset&&
  Number.isFinite(record.at)&&record.at<=now&&record.state==='ready';
}
/** One-shot workers publish current native costs; unavailable costs do not create wakeups. */
export function publishInfrastructureCost(ns,kind,cost,budget=1) {
 const reset=ns.getResetInfo();
 ns.write('tasks/infrastructure-'+kind+'.json',JSON.stringify({at:Date.now(),augReset:reset.lastAugReset,nodeReset:reset.lastNodeReset,
  cost:Number.isFinite(cost)&&cost>0?cost:null,budget:budget>0&&budget<=1?budget:1}),'w');
}
export function torProgramsHandoff(record,lastToken,reset,now=Date.now()) {
 return !!record&&typeof record.token==='string'&&record.token!==lastToken&&record.augReset===reset.lastAugReset&&record.nodeReset===reset.lastNodeReset&&
  Number.isFinite(record.at)&&record.at<=now&&now-record.at<=120000;
}
export function infrastructureAffordable(record,money,reserve,reset,now=Date.now()) {
 if(!record||record.augReset!==reset.lastAugReset||record.nodeReset!==reset.lastNodeReset||
  !Number.isFinite(record.at)||record.at>now||now-record.at>300000||!(record.cost>0)||!Number.isFinite(record.cost))return false;
 const budget=record.budget>0&&record.budget<=1?record.budget:1;
 return money>=Math.max(record.cost+Math.max(0,reserve||0),record.cost/budget);
}
