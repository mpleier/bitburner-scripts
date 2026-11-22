export async function main(ns) {
  const out = [];
  let creds = {};
  try { creds = JSON.parse(ns.read('tasks/credentials-home.json')); } catch(e){ out.push(['creds',String(e)]); }
  const entries = Array.isArray(creds.entries) ? creds.entries : [];
  const findPw = h => { for(const row of entries){ if(row[0]===h||row[0]===h.replace(/:[0-9]+$/,'')) return row[1]; } return ''; };
  for (const h of ['dark-citadel','granny-s::industries','iker_molina_casino.systems','cellgenesis','nitesec']) {
    const pw = findPw(h);
    let ok=false, err='';
    try { const r = await ns.dnet.authenticate(h, pw); ok=!!(r&&r.success); } catch(e){ err=String(e); }
    const ram = ns.getScriptRam('dw-probe-neighbours.js', h);
    const free = ns.getServerMaxRam(h)-ns.getServerUsedRam(h);
    let pid=0;
    try { pid=ns.exec('dw-probe-neighbours.js',h,1,'ub3r_l4byr1nth'); } catch(e){ err+=' exec:'+String(e); }
    out.push({host:h,pwlen:pw.length,auth:ok,err,ram,free,pid});
  }
  await ns.write('tasks/dw-exectest2.json',JSON.stringify(out),'w');
  try { await ns.scp('tasks/dw-exectest2.json','home','darkweb'); } catch(e){}
}
