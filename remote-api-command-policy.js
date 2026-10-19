// Import-free module registry and command validation shared with the local listener.
export const commandFile = 'remote-control/request.json';
export const heartbeatFile = 'remote-control/heartbeat.json';
export const commandPolicyVersion = 22;
export const resultFile = id => 'remote-control/results/' + id + '.json';
// Authoritative module metadata lives beside import-free command validation so the local
// listener can hot-reload both together without stale dependency caches.
export const moduleManifest=Object.freeze([
 Object.freeze({"script":"reliability-manager.js","remoteControl":true,"supervised":false,"diagnostic":true,"homeOnly":true,"priority":2,"launchOrder":1,"watched":false}),
 Object.freeze({"script":"contract-validation.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/contract-validation.json","priority":3,"launchOrder":2,"watched":true}),
 Object.freeze({"script":"automation-dashboard.js","remoteControl":true,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"autopilot.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/automation-status.json","watched":true}),
 Object.freeze({"script":"corporation-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/corporation-status.json","priority":11,"watched":true}),
 Object.freeze({"script":"darknet-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"priority":5,"launchOrder":7,"watched":true}),
 Object.freeze({"script":"casino.js","remoteControl":true,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"daemon.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"watched":true}),
 Object.freeze({"script":"gangs.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/gang-status.json","watched":true}),
 Object.freeze({"script":"grafting-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/grafting-status.json","priority":6,"launchOrder":8,"watched":true}),
 Object.freeze({"script":"sleeve.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/sleeve-status.json","priority":9,"watched":true}),
 Object.freeze({"script":"sleeve-expansion.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"priority":10,"watched":true}),
 Object.freeze({"script":"health-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"priority":14,"launchOrder":5,"watched":true}),
 Object.freeze({"script":"infiltration-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/infiltration-status.json","priority":16,"launchOrder":12,"watched":true}),
 Object.freeze({"script":"work-for-factions.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/faction-work-status.json","priority":17,"watched":true}),
 Object.freeze({"script":"bladeburner.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"priority":8,"launchOrder":10,"watched":true}),
 Object.freeze({"script":"stockmaster.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/stock-status.json","watched":true}),
 Object.freeze({"script":"soa-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/soa-status.json","priority":13,"launchOrder":4,"watched":true}),
 Object.freeze({"script":"go.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/go-status.json","priority":15,"launchOrder":11,"watched":true}),
 Object.freeze({"script":"optimize-stanek.js","remoteControl":true,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"achievement-manager.js","remoteControl":true,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/achievement-status.json","priority":12,"launchOrder":3,"watched":true}),
 Object.freeze({"script":"stats.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"priority":4,"launchOrder":6,"watched":true}),
 Object.freeze({"script":"remote-api-agent.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"priority":1,"watched":false}),
 Object.freeze({"script":"hacknet-upgrade-manager.js","remoteControl":false,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/hacknet-upgrade-status.json","watched":true}),
 Object.freeze({"script":"spend-hacknet-hashes.js","remoteControl":false,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/hacknet-hash-status.json","priority":7,"launchOrder":9,"watched":true}),
 Object.freeze({"script":"stanek.js","remoteControl":false,"supervised":true,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/stanek-status.json","watched":true}),
 Object.freeze({"script":"host-manager.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"statusFile":"tasks/cloud-purchase-status.json","watched":false}),
 Object.freeze({"script":"Tasks/ram-manager.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"Tasks/contractor.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"Tasks/contractor.js.solver.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":false,"requiresLease":true,"watched":false}),
 Object.freeze({"script":"automation-preview.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":true,"watched":false}),
 Object.freeze({"script":"Remote/share.js","remoteControl":false,"supervised":false,"diagnostic":true,"homeOnly":false,"watched":false})
]);
export const managedScripts=moduleManifest.filter(m=>m.remoteControl).map(m=>m.script);
export const diagnosticScripts=moduleManifest.filter(m=>m.diagnostic).map(m=>m.script);
const queries = new Set(['getPlayer','getMoneySources','getResetInfo','ps','scan','getServer','getScriptRam','cloud.getServerNames','getPurchasedServers','ls','singularity.getCurrentWork','singularity.getOwnedAugmentations','corporation.hasCorporation','corporation.getCorporation','corporation.getDivision','corporation.getOffice','corporation.getWarehouse','corporation.getProduct','corporation.getInvestmentOffer','corporation.getMaterial','sleeve.getNumSleeves','sleeve.getSleeve','gang.inGang','gang.getGangInformation','gang.getMemberNames','bladeburner.inBladeburner','bladeburner.getCurrentAction']);
export function validateCommand(command, now = Date.now()) {
 if (!command || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.id || '')) throw new Error('Invalid command ID');
 if (!Number.isFinite(command.expiresAt) || command.expiresAt <= now) throw new Error('Command expired');
 if (!Array.isArray(command.args) || command.args.length > 100) throw new Error('Invalid arguments');
 if (['start','stop'].includes(command.method)) {
  if (command.args.length !== 1 || !managedScripts.includes(command.args[0])) throw new Error('Choose a managed project script; custom arguments are not supported');
 } else if(command.method==='automation.preflight'){
  if(command.args.length>32||command.args.some(s=>!diagnosticScripts.includes(s)))throw new Error('Choose managed entrypoints for native preflight');
 } else if(command.method==='automation.logsFresh'){
  if(command.args.length!==1||!diagnosticScripts.includes(command.args[0]))throw new Error('Choose one managed script for fresh logs');
 } else if(command.method==='automation.logs'){
  if(command.args.length>1||command.args.length===1&&!['stats.js','remote-api-agent.js',...managedScripts].includes(command.args[0]))throw new Error('Choose a managed script log');
 } else if(command.method==='automation.files'){
  if(command.args.length>2||command.args.some((n,i)=>!Number.isSafeInteger(n)||n<(i===0?0:1)||i===1&&n>100))throw new Error('File audit requires a nonnegative offset and a limit of 1 through 100');
 } else if(command.method==='automation.preview'){
  if(command.args.length)throw new Error('Automation preview takes no arguments');
 } else if(command.method==='automation.status'){
  if(command.args.length)throw new Error('Automation status takes no arguments');
 } else if (command.method === 'measurement.xp') {
  if(command.args.length!==1||!Number.isInteger(command.args[0])||command.args[0]<60||command.args[0]>600)throw new Error('XP measurement requires 60 through 600 seconds');
 } else if (!['status','automation.status'].includes(command.method) && !queries.has(command.method)) throw new Error('Unsupported command');
 return command;
}
