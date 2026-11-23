/** @param {NS} ns */
export async function main(ns) {
  const script = ns.args[0] || 'labyrinth-state.js';
  const darkweb = 'darkweb';
  const outFile = ns.args[1] || (script === 'dnet-status.js' ? 'tasks/dnet-status-darkweb.json' : script === 'stasis-darkweb.js' ? 'tasks/dw-stasis.json' : 'tasks/labyrinth-state.json');
  await ns.scp(script, darkweb, 'home');
  const r = { at: Date.now(), script, steps: [] };
  const note = (s) => { r.steps.push(s); ns.tprint('DW_RUN ' + s); };
  const freeRam = () => ns.getServer(darkweb).maxRam - ns.getServer(darkweb).ramUsed;
  note('free before ' + freeRam().toFixed(2));
  const victims = ['darknet-promote.js', 'darknet-loot.js'];
  for (const v of victims) {
    if (freeRam() >= ns.getScriptRam(script, darkweb) + 0.2) break;
    note('kill ' + v + ' -> ' + ns.kill(v, darkweb) + ' free ' + freeRam().toFixed(2));
  }
  const needed = ns.getScriptRam(script, darkweb);
  note('needed ' + needed.toFixed(2));
  const pid = ns.exec(script, darkweb, 1);
  note('pid ' + pid);
  for (let i = 0; i < 20 && pid; i++) {
    await ns.sleep(3000);
    if (!ns.isRunning(pid, darkweb)) break;
  }
  note('finished ' + (pid ? !ns.isRunning(pid, darkweb) : 'no pid'));
  if (outFile) {
    try {
      if (await ns.scp(outFile, 'home', darkweb)) r.output = ns.read(outFile);
    } catch (e) { note('scp error ' + String(e)); }
  }
  for (const f of victims) {
    if (!ns.ps(darkweb).some((p) => p.filename === f)) {
      note('restore ' + f + ' -> ' + ns.exec(f, darkweb, 1));
    }
  }
  await ns.write('tasks/dw-run-result.json', JSON.stringify(r), 'w');
}
