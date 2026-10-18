/** Sample warning windows frequently; materialize full logs only once per minute. */
export function collectControllerDiagnostics(ns,processes,previous,now=Date.now()) {
 const valid=previous&&Number.isFinite(previous.detailAt)&&previous.detailAt<=now;
 const detailDue=!valid||now-previous.detailAt>=60000;
 const fingerprints={},warnings=valid?(previous.warnings||[]).filter(w=>(w.lastSeenAt??w.at)<=now&&now-(w.lastSeenAt??w.at)<300000).map(w=>({...w})):[],logs=[];
 const key=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16)+':'+text.length;};
 for(const p of processes.slice(0,32)){
  const prior=valid&&previous.fingerprints?.[p.pid]&&!Array.isArray(previous.fingerprints[p.pid])?previous.fingerprints[p.pid]:{};
  const counts={},messages={};
  const observe=text=>{const id=key(text);counts[id]=(counts[id]||0)+1;messages[id]=text.slice(0,512);};
  try{
   const lines=ns.getScriptLogs(p.pid);
   for(const line of lines.slice(-120).map(String))if(/warn|error|failed|exception/i.test(line))observe(line);
   if(detailDue)logs.push({script:p.filename,pid:p.pid,args:p.args,at:now,lines:lines.slice(-120).map(l=>String(l).slice(0,2048))});
  }catch(error){
   if(detailDue)logs.push({script:p.filename,pid:p.pid,at:now,error:String(error).slice(0,512),lines:[]});
   observe('Log collection failed: '+String(error));
  }
  fingerprints[p.pid]=counts;
  for(const [id,count]of Object.entries(counts)){
   const entry=warnings.find(w=>w.pid===p.pid&&w.key===id),increase=Math.max(0,count-(prior[id]||0));
   if(entry){entry.lastSeenAt=now;entry.visibleCount=count;entry.observations=(entry.observations||1)+1;entry.confirmedOccurrences=(entry.confirmedOccurrences||0)+increase;if(increase)entry.lastNewOccurrenceAt=now;}
   else warnings.push({key:id,script:p.filename,pid:p.pid,at:now,firstSeenAt:now,lastSeenAt:now,lastNewOccurrenceAt:increase?now:null,visibleCount:count,observations:1,confirmedOccurrences:count,line:messages[id]});
  }
 }
 warnings.sort((a,b)=>(a.lastSeenAt??a.at)-(b.lastSeenAt??b.at));
 return {trackedProcesses:Math.min(32,processes.length),omittedProcesses:Math.max(0,processes.length-32),at:now,detailAt:detailDue?now:previous.detailAt,detailDue,logs:detailDue?logs:previous.logs,fingerprints,warnings:warnings.slice(-24)};
}
