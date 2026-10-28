/** Self-contained native guard for one optional trainee at positive clash exposure. */
export function validateGangTraineePulse(ns,order,owner,now=Date.now()){
 const no=reason=>({valid:false,reason});
 try{
  const q=order.pulseQuote,read=p=>{const s=ns.read(p);return s?JSON.parse(s):null;};
  if(order.task!=='Territory Warfare'||!q||q.version!==1||q.name!==order.name||q.ownerPid!==owner||!ns.isRunning(owner)||!Number.isFinite(q.at)||q.at>now||now-q.at>2000||q.expiresAt!==Math.min(q.at+2000,q.targetTickAt)||q.expiresAt<=now||!Number.isFinite(q.targetTickAt)||q.targetTickAt<=q.at||q.targetTickAt>q.at+3000)return no('stale-pulse-quote');
  const reset=ns.getResetInfo(),g=ns.gang.getGangInformation();
  if(q.nodeReset!==reset.lastNodeReset||q.augReset!==reset.lastAugReset||q.at<reset.lastAugReset||q.faction!==g.faction||!Number.isFinite(g.power)||g.power<=0||!Number.isFinite(g.territory)||!Number.isFinite(q.power)||q.power<=0||Math.abs(g.power-q.power)>q.power*.02||Math.abs(g.territory-q.territory)>.001)return no('pulse-state-changed');
  let config=read('gangs.js.config.txt')||{};if(Array.isArray(config))config=Object.fromEntries(config);
  if(!config||typeof config!=='object'||config['disable-adaptive-growth']===true||config['no-training']===true||config['power-focus']===false)return no('pulse-disabled');
  let manual=config['manual-task-overrides']??{};if(typeof manual==='string')manual=JSON.parse(manual);
  if(!manual||typeof manual!=='object'||Array.isArray(manual)||Object.hasOwn(manual,order.name))return no('manual-task');
  const saved=read('tasks/gang-training.json'),episode=saved?.episodes?.[order.name],lease=read('tasks/gang-warfare-lease.json'),supervisor=read('tasks/gang-aggression-guard.json');
  if(saved?.ownerPid!==owner||saved.nodeReset!==q.nodeReset||saved.augReset!==q.augReset||!Number.isFinite(saved.at)||saved.at>now||now-saved.at>900000||episode?.growthFirst!==true||episode.developmentCycle===true||!Number.isFinite(episode.startedAt)||episode.startedAt>now||!Number.isFinite(episode.until)||episode.until<=now||episode.until!==q.episodeUntil||episode.until-episode.startedAt>900000||episode.resetAt!==saved.members?.[order.name]||!Number.isFinite(episode.resetAt)||now-episode.resetAt<2000||saved.ascensionRecoveries?.[order.name]?.until>now||saved.wantedPreparation?.until>now)return no('mandatory-or-changed-training');
  if(lease?.ownerPid!==owner||lease.nodeReset!==q.nodeReset||lease.augReset!==q.augReset||lease.faction!==g.faction||!Number.isFinite(lease.at)||lease.at>now||lease.expiresAt!==lease.at+60000||lease.expiresAt<=now||lease.tasks?.[order.name]!==q.task||supervisor?.nodeReset!==q.nodeReset||supervisor.augReset!==q.augReset||!Number.isFinite(supervisor.at)||supervisor.at>now||now-supervisor.at>15000||!ns.isRunning(supervisor.ownerPid))return no('pulse-supervision-unavailable');
  const rows=Object.entries(ns.gang.getAllGangInformation());
  const threshold=Math.max(.75,q.threshold,Number(config['warfare-win-chance']??.7));
  const rivals=rows.filter(([name,r])=>name!==g.faction&&r.territory>0);
  if(!Number.isFinite(threshold)||threshold>=1||!rows.length||!rivals.length||rows.some(([,r])=>!Number.isFinite(r?.power)||r.power<0||!Number.isFinite(r.territory)||r.territory<0||r.territory>1)||rivals.some(([,r])=>g.power/(g.power+r.power)<threshold))return no('pulse-odds-changed');
  const crew=ns.gang.getMemberNames().map(n=>ns.gang.getMemberInformation(n)),m=crew.find(m=>m.name===order.name),maxDefense=Math.max(...crew.map(m=>m.def));
  if(!m||m.task!==q.task||!['Train Combat','Train Hacking','Train Charisma'].includes(q.task)||!Number.isFinite(maxDefense)||!Number.isFinite(m.def)||m.def<1000||m.def<Math.min(10000,maxDefense*.1)||crew.some(v=>v.name!==m.name&&v.task==='Territory Warfare'&&saved.episodes?.[v.name]?.growthFirst===true))return no('pulse-crew-changed');
  const keys=['hack','str','def','dex','agi','cha'],fields=keys.flatMap(k=>[k,k+'_exp',k+'_mult',k+'_asc_mult']);
  if(fields.some(k=>!Number.isFinite(q.member?.[k])||q.member[k]<0||!Number.isFinite(m[k])||m[k]<0||Math.abs(m[k]-q.member[k])>Math.max(1e-6,q.member[k]*.02)))return no('pulse-member-changed');
  if(!Number.isFinite(q.horizon)||q.horizon<=0||q.horizon>21600||!Number.isFinite(q.bonusSeconds)||q.bonusSeconds<0||!Number.isFinite(q.trainingLoss)||q.trainingLoss<0||!Number.isFinite(q.fraction)||q.fraction<0||q.fraction>.5)return no('invalid-pulse-economics');
  const game=q.horizon+Math.min(q.bonusSeconds,q.horizon*24);
  if(!Number.isFinite(q.riskGameSeconds)||q.riskGameSeconds<Math.max(3750,game)||q.riskGameSeconds>540000)return no('invalid-pulse-risk-horizon');
  const deaths=2*Math.ceil(q.riskGameSeconds/20)*.35*.01/Math.pow(m.def,.6),total=keys.reduce((s,k)=>s+m[k],0);
  if(!Number.isFinite(deaths)||deaths>.005||!Number.isFinite(total)||total<=q.trainingLoss*1.25)return no('pulse-cost-or-risk');
  return {valid:true,reason:'verified-optional-pulse',expectedDeaths:deaths};
 }catch{return no('pulse-evidence-unavailable');}
}
