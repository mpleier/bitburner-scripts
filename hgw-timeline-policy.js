/** Reuse the scheduler's process inventory; no additional host scans. */
export function recordHgwTimeline(rows,p,owner){
 if(rows.length>=128)return false;
 const match=/^\/?Remote\/(hack|grow|weak|manualhack)-target\.js$/.exec(p.filename||'');if(!match)return true;
 const a=p.args||[],weak=match[1]==='weak',loop=a[weak?5:6];
 if(a[weak?6:7]!==owner||typeof a[0]!=='string'||a[0].length>100||!Number.isSafeInteger(p.threads)||p.threads<=0)return true;
 const deadline=loop?null:Number.isFinite(a[1])&&Number.isFinite(a[2])?a[1]+a[2]:null;
 rows.push({target:a[0],tool:weak?'weaken':match[1],threads:p.threads,pid:p.pid,deadline,loop:!!loop,phase:String(a[3]||'').startsWith('Batch')?'batch':'preparation / other'});return true;
}
export function summarizeHgwTimeline(rows,now){
 const groups=new Map();
 for(const r of rows){let g=groups.get(r.target);if(!g){g={target:r.target,workers:0,threads:0,phases:[],nextDeadline:null,overdue:0,legs:[]};groups.set(r.target,g);}
  g.workers++;g.threads+=r.threads;if(!g.phases.includes(r.phase))g.phases.push(r.phase);
  if(Number.isFinite(r.deadline)){if(r.deadline<now)g.overdue++;else g.nextDeadline=Math.min(g.nextDeadline??Infinity,r.deadline);}
  if(g.legs.length<8)g.legs.push({tool:r.tool,threads:r.threads,deadline:r.deadline,loop:r.loop});
 }
 return [...groups.values()].sort((a,b)=>(a.nextDeadline??Infinity)-(b.nextDeadline??Infinity)||a.target.localeCompare(b.target)).slice(0,12);
}
/** A stale or different-owner sample must never appear as currently running work. */
export function readHgwTimeline(ns,reset,now){
 try{const raw=ns.read('tasks/hgw-timeline.json');if(raw.length>50000)return null;const t=JSON.parse(raw);
  if(t.schemaVersion!==1||t.nodeReset!==reset.lastNodeReset||t.augReset!==reset.lastAugReset||!Number.isFinite(t.at)||t.at>now||now-t.at>15000||!ns.isRunning(t.ownerPid)||!Array.isArray(t.targets)||t.targets.length>12)return null;return t;
 }catch{return null;}
}
export function renderHgwTimeline(t,escape,now){
 if(!t||!Number.isFinite(t.at)||t.at>now||now-t.at>15000)return '<p>Waiting for a fresh hacking timeline.</p>';
 return '<h4>Hacking timeline — observed active workers</h4><p>'+escape(t.complete?'Complete inventory':'Partial inventory')+' · '+escape(t.capacityBlocked?'Worker limit reached':'Worker capacity available')+'</p><table><tr><th>Target</th><th>Phase</th><th>Workers / threads</th><th>Next planned completion</th><th>Observed legs</th></tr>'+t.targets.map(r=>'<tr><td>'+escape(r.target)+'</td><td>'+escape(r.phases.join(', '))+'</td><td>'+escape(r.workers)+' / '+escape(r.threads)+'</td><td>'+escape(Number.isFinite(r.nextDeadline)?Math.max(0,Math.ceil((r.nextDeadline-now)/1000))+'s':r.overdue?'Past deadline; awaiting receipt':'Unknown / looping')+'</td><td>'+escape(r.legs.map(l=>l.tool+' ×'+l.threads).join(', '))+'</td></tr>').join('')+'</table><p>Snapshot age '+escape(Math.round((now-t.at)/1000))+'s. Deadlines are plans, not confirmed completions; at most 128 workers and 12 targets are shown.</p>';
}
