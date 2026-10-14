/** Stop only the controller's unchanged ordinary work; never a graft or a new action. */
export async function main(ns){let r;try{r=JSON.parse(ns.read('tasks/achievement-cleanup-owner.json'));}catch{return;}
 if(r.ownerPid!==Number(ns.args[0])||Date.now()-r.at>3000||!r.work)return;
 const current=ns.singularity.getCurrentWork(),previous=r.work;
 if(!['CLASS','FACTION','CRIME'].includes(current?.type)||current.type!==previous.type)return;
 for(const key of ['location','classType','crimeType','factionName','factionWorkType'])if(current[key]!==previous[key])return;
 if(Number.isFinite(previous.cyclesWorked)&&current.cyclesWorked<previous.cyclesWorked)return;
 ns.singularity.stopAction();
}
