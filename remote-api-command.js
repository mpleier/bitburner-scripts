import { pauseFile } from './automation-control.js';
export const commandFile = 'remote-control/request.json';
export const heartbeatFile = 'remote-control/heartbeat.json';
export const commandPolicyVersion = 14;
export const resultFile = id => 'remote-control/results/' + id + '.json';
export const managedScripts = ['reliability-manager.js','contract-validation.js','automation-dashboard.js','autopilot.js','corporation-manager.js','darknet-manager.js','casino.js','daemon.js','gangs.js','grafting-manager.js','sleeve.js','sleeve-expansion.js','health-manager.js','infiltration-manager.js','work-for-factions.js','bladeburner.js','stockmaster.js','soa-manager.js','go.js','optimize-stanek.js','achievement-manager.js'];
const queries = new Set(['getPlayer','getMoneySources','getResetInfo','ps','scan','getServer','getScriptRam','cloud.getServerNames','getPurchasedServers','ls','singularity.getCurrentWork','singularity.getOwnedAugmentations','corporation.hasCorporation','corporation.getCorporation','corporation.getDivision','corporation.getOffice','corporation.getWarehouse','corporation.getProduct','corporation.getInvestmentOffer','corporation.getMaterial','sleeve.getNumSleeves','sleeve.getSleeve','gang.inGang','gang.getGangInformation','gang.getMemberNames','bladeburner.inBladeburner','bladeburner.getCurrentAction']);
export function validateCommand(command, now = Date.now()) {
 if (!command || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.id || '')) throw new Error('Invalid command ID');
 if (!Number.isFinite(command.expiresAt) || command.expiresAt <= now) throw new Error('Command expired');
 if (!Array.isArray(command.args) || command.args.length > 100) throw new Error('Invalid arguments');
 if (['start','stop'].includes(command.method)) {
  if (command.args.length !== 1 || !managedScripts.includes(command.args[0])) throw new Error('Choose a managed project script; custom arguments are not supported');
 } else if (!['status','automation.status'].includes(command.method) && !queries.has(command.method)) throw new Error('Unsupported command');
 return command;
}
export function renderCommandJob(command) {
 validateCommand(command);
 let expression;
 if (command.method === 'status') expression = "({player: ns.getPlayer(), reset: ns.getResetInfo(), processes: ns.ps('home'), home: ns.getServer('home')})";
 else if (command.method === 'automation.status') expression = '(() => { const read = path => { try { return JSON.parse(ns.read(path)); } catch { return null; } }; return {dashboard:read("tasks/dashboard.json"),reliabilityError:read("tasks/reliability-error.json"),achievements:read("tasks/achievement-status.json"),achievementError:read("tasks/achievement-error.json"),exportInterface:{modern:!!ns.singularity&&"hasExportGameBonus" in ns.singularity,legacy:!!ns.singularity&&"exportGameBonus" in ns.singularity},stanekLayout:read("tasks/stanek-layout.json"),spending:read("tasks/spending-plan.json"),spendingUsage:read("tasks/spending-usage.json"),soa:read("tasks/soa-status.json"),go:read("tasks/go-status.json"),resetBackup:read("tasks/reset-backup-status.json"),intelligence:read("tasks/intelligence-session.json"),automation:read("tasks/automation-status.json"),gang:read("tasks/gang-status.json"),corporation:read("tasks/corporation-status.json"),stanek:read("tasks/stanek-status.json"),casino:read("tasks/casino-status.json"),sleeves:read("tasks/sleeve-status.json"),infiltration:read("tasks/infiltration-status.json"),infiltrationHistory:read("tasks/infiltration-history.json"),activity:read("tasks/activity-lock.json"),reserve:read("tasks/automation-ram-reserve.json")}; })()';
 else if (command.method === 'start') {
  const paused = JSON.stringify(pauseFile(command.args[0]));
  expression = '(async () => { const script = JSON.parse(ns.args[0])[0]; const paused = '+paused+'; const wasPaused = ns.read(paused).trim() === "true"; ns.rm(paused,"home"); const existing = ns.ps("home").find(p => p.filename === script); if(existing) return {pid:existing.pid,alreadyRunning:true}; const pid = ns.run(script,1); if(!pid || !ns.isRunning(pid)) { if(wasPaused) await ns.write(paused,"true","w"); throw new Error("Failed to start " + script + ": insufficient RAM, missing script, or unavailable API"); } return {pid}; })()';
 }

 else if (command.method === 'stop') {
  const paused = JSON.stringify(pauseFile(command.args[0]));
  expression = '(async () => { const script = JSON.parse(ns.args[0])[0]; await ns.write('+paused+',"true","w"); const stopped = ns.ps("home").filter(p => p.filename === script).map(p => ({pid:p.pid,stopped:ns.kill(p.pid)})); if(stopped.some(p => !p.stopped)) throw new Error("Some instances could not be stopped; automation remains paused"); return {paused:true,processes:stopped}; })()';
 }
 else if (command.method === 'getPurchasedServers') expression = 'ns.cloud.getServerNames(...JSON.parse(ns.args[0]))';
 else expression = 'ns.' + command.method + '(...JSON.parse(ns.args[0]))';
 return 'export async function main(ns) { await ns.write(ns.args[1], JSON.stringify({id:ns.args[2],state:"running",pid:ns.pid,at:Date.now()}),"w"); const serialize = (key,value) => value instanceof Map ? Object.fromEntries(value) : typeof value === "bigint" ? value.toString() : value; let response; try { const value = await (' + expression + '); response = {state:"completed",result:value === undefined ? null : value}; } catch(error) { response = {state:"failed",error:String(error)}; } await ns.write(ns.args[1], JSON.stringify({id:ns.args[2],at:Date.now(),...response},serialize),"w"); }';
}
