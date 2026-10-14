/** Remove temporary files only when home automation is stopped. */
export async function main(ns) {
 const active=ns.ps('home').filter(p=>p.pid!==ns.pid&&p.filename!=='remote-api-agent.js');
 if(active.length){ns.print('Cleanup deferred while scripts are running on home. Stop automation before removing temporary data.');return;}
 for(const file of ns.ls('home').filter(f=>/^\/?Temp\//.test(f)))ns.print((ns.rm(file)?'Removed ':'Failed to remove ')+file);
}
