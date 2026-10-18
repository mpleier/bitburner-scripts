export function parseNativeQc(stdout) {
 const replies=String(stdout).split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 const reply=replies.findLast(r=>r.state);
 if(!reply)return {ok:false,message:'No completed reply. Check the Remote API connection and worker.'};
 if(reply.state!=='completed')return {ok:false,message:reply.error||'Native preflight did not complete'};
 if(reply.result?.check!=='native-ram'||!Array.isArray(reply.result.scripts))return {ok:false,message:'Unexpected native preflight response'};
 const failures=reply.result.scripts.filter(s=>s.status!=='ready'||!Number.isFinite(s.ram)||s.ram<=0);
 const ok=reply.result.ok===true&&!failures.length&&reply.result.scripts.length>0;
 return {ok,scripts:reply.result.scripts,failures,message:ok?'Native RAM preflight passed':reply.result.scripts.length?'Native preflight failed':'Native preflight returned no checks'};
}
