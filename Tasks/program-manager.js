/** Purchase port openers once, or wait until all are owned with -c. */
export async function main(ns) {
 const programNames = ['BruteSSH.exe','FTPCrack.exe','relaySMTP.exe','HTTPWorm.exe','SQLInject.exe'];
 const keepRunning = ns.args.includes('-c');
 if (!keepRunning) ns.print('program-manager will run once. Use -c to wait for all programs.');
 let missing;
 do {
  for (const program of programNames) {
   if (ns.fileExists(program, 'home')) continue;
   try { if (ns.singularity.purchaseProgram(program)) ns.toast('Purchased ' + program, 'success'); }
   catch (error) { ns.print('Program purchase unavailable: ' + String(error)); return; }
  }
  missing = programNames.some(program => !ns.fileExists(program, 'home'));
  if (keepRunning && missing) await ns.sleep(2000);
 } while (keepRunning && missing);
}
