export async function main(ns) {
  const out=[];
  const push=async(o)=>{out.push(o);try{await ns.write('tasks/dw-step.json',JSON.stringify(out),'w');}catch(e){}};
  const h='cellgenesis';
  await push({s:'begin',host:h});
  try { await push({s:'root',v:ns.hasRootAccess(h)}); } catch(e){ await push({s:'rooterr',e:String(e)});}
  try { await push({s:'max',v:ns.getServerMaxRam(h),used:ns.getServerUsedRam(h)}); } catch(e){ await push({s:'ramerr',e:String(e)});}
  try { await push({s:'file',v:ns.fileExists('dw-probe-neighbours.js',h)}); } catch(e){ await push({s:'fileerr',e:String(e)});}
  try { await push({s:'ram2',v:ns.getScriptRam('dw-probe-neighbours.js',h)}); } catch(e){ await push({s:'ram2err',e:String(e)});}
  try { await push({s:'ps',v:ns.ps(h).map(p=>p.filename+':'+p.threads)}); } catch(e){ await push({s:'pserr',e:String(e)});}
  try { const r=await ns.dnet.authenticate(h,''); await push({s:'auth',v:r}); } catch(e){ await push({s:'autherr',e:String(e)});}
  try { const p=ns.exec('dw-probe-neighbours.js',h,1,'ub3r_l4byr1nth'); await push({s:'exec',v:p}); } catch(e){ await push({s:'execerr',e:String(e)});}
  try { await ns.sleep(1000); await push({s:'ps2',v:ns.ps(h).map(p=>p.filename+':'+p.threads)}); } catch(e){ await push({s:'ps2err',e:String(e)});}
  try { await ns.scp('tasks/dw-step.json','home','darkweb'); } catch(e){}
}
