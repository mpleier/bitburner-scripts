/** @param {NS} ns */
export async function main(ns) {
  const darkweb = 'darkweb';
  const r = { at: Date.now(), steps: [] };
  const note = (s) => { r.steps.push(s); ns.tprint('STASIS_ORCH ' + s); };
  const freeRam = () => ns.getServer(darkweb).maxRam - ns.getServer(darkweb).ramUsed;

  note('free before ' + freeRam().toFixed(2));
  const killed = ns.kill('darknet-promote.js', darkweb);
  note('killed promote ' + killed + ' free ' + freeRam().toFixed(2));
  if (freeRam() < 4) {
    const killedLoot = ns.kill('darknet-loot.js', darkweb);
    note('killed loot ' + killedLoot + ' free ' + freeRam().toFixed(2));
  }
  const pid = ns.exec('deploy-labyrinth-stasis.js', darkweb, 1);
  note('deploy pid ' + pid);

  for (let i = 0; i < 16 && pid; i++) {
    await ns.sleep(3000);
    if (!ns.isRunning(pid, darkweb)) break;
  }
  note('deploy finished ' + (pid ? !ns.isRunning(pid, darkweb) : 'no pid'));

  let deploy = null;
  try {
    if (await ns.scp('stasis-deploy.txt', 'home', darkweb)) deploy = JSON.parse(ns.read('stasis-deploy.txt'));
  } catch (e) { note('scp report error ' + String(e)); }
  r.deploy = deploy;

  let result = null;
  try {
    if (await ns.scp('stasis-link-result.txt', 'home', 'th3_l4byr1nth')) result = JSON.parse(ns.read('stasis-link-result.txt'));
  } catch (e) { note('scp result error ' + String(e)); }
  r.result = result;

  // restore the processes we stopped, unless another script already did
  for (const f of ['darknet-promote.js', 'darknet-loot.js']) {
    if (!ns.ps(darkweb).some((p) => p.filename === f)) {
      const p = ns.exec(f, darkweb, 1);
      note('restored ' + f + ' pid ' + p);
    }
  }
  await ns.write('tasks/labyrinth-stasis-orchestration.json', JSON.stringify(r), 'w');
}
