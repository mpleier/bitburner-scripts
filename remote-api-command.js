export const commandFile = 'remote-control/request.json';
export const heartbeatFile = 'remote-control/heartbeat.json';
export const resultFile = id => 'remote-control/results/' + id + '.json';
export const managedScripts = ['autopilot.js','corporation-manager.js','darknet-manager.js','casino.js','daemon.js','grafting-manager.js','sleeve-expansion.js'];
const queries = new Set(['getPlayer','getResetInfo','ps','scan','getServer','getScriptRam','getPurchasedServers','ls','singularity.getCurrentWork','singularity.getOwnedAugmentations','corporation.hasCorporation','corporation.getCorporation','corporation.getDivision','corporation.getOffice','corporation.getWarehouse','corporation.getProduct','corporation.getInvestmentOffer','corporation.getMaterial','sleeve.getNumSleeves','sleeve.getSleeve','gang.inGang','gang.getGangInformation','gang.getMemberNames','bladeburner.inBladeburner','bladeburner.getCurrentAction']);
export function validateCommand(command, now = Date.now()) {
 if (!command || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.id || '')) throw new Error('Invalid command ID');
 if (!Number.isFinite(command.expiresAt) || command.expiresAt <= now) throw new Error('Command expired');
 if (!Array.isArray(command.args) || command.args.length > 100) throw new Error('Invalid arguments');
 if (['start','stop'].includes(command.method)) {
  if (command.args.length !== 1 || !managedScripts.includes(command.args[0])) throw new Error('Choose a managed project script; custom arguments are not supported');
 } else if (command.method !== 'status' && !queries.has(command.method)) throw new Error('Unsupported command');
 return command;
}
export function renderCommandJob(command) {
 validateCommand(command);
 let expression;
 if (command.method === 'status') expression = "({player: ns.getPlayer(), reset: ns.getResetInfo(), processes: ns.ps('home'), home: ns.getServer('home')})";
 else if (command.method === 'start') expression = "(() => { const script = JSON.parse(ns.args[0])[0]; const existing = ns.ps('home').find(p => p.filename === script); return existing ? {pid:existing.pid,alreadyRunning:true} : {pid:ns.run(script,1)}; })()";
 else if (command.method === 'stop') expression = "ns.ps('home').filter(p => p.filename === JSON.parse(ns.args[0])[0]).map(p => ({pid:p.pid,stopped:ns.kill(p.pid)}))";
 else expression = 'ns.' + command.method + '(...JSON.parse(ns.args[0]))';
 return 'export async function main(ns) { await ns.write(ns.args[1], JSON.stringify({id:ns.args[2],state:"running",pid:ns.pid,at:Date.now()}),"w"); const serialize = (key,value) => value instanceof Map ? Object.fromEntries(value) : typeof value === "bigint" ? value.toString() : value; let response; try { const value = await (' + expression + '); response = {state:"completed",result:value === undefined ? null : value}; } catch(error) { response = {state:"failed",error:String(error)}; } await ns.write(ns.args[1], JSON.stringify({id:ns.args[2],at:Date.now(),...response},serialize),"w"); }';
}
